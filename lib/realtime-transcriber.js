const WebSocket = require('ws');
const { spawn } = require('child_process');
const fs = require('fs');

class RealtimeTranscriber {
  constructor(options = {}) {
    this.apiKey = options.apiKey || process.env.OPENAI_API_KEY;
    this.sampleRate = options.sampleRate || 24000;
    this.channels = options.channels || 1;
    this.model = options.model || 'gpt-4o-transcribe';
    this.language = options.language || 'en';
    this.prompt = options.prompt || 'This is English speech with numbers and common words.';
    this.vadType = options.vadType || 'semantic_vad';
    this.vadEagerness = options.vadEagerness || 'high';

    this.ws = null;
    this.wsConnected = false;
    this.recording = false;

    // Event handlers
    this.onTranscriptionDelta = options.onTranscriptionDelta || ((delta) => console.log(delta));
    this.onTranscriptionComplete = options.onTranscriptionComplete || ((transcript) => console.log(`Final: "${transcript}"`));
    this.onSpeechStart = options.onSpeechStart || (() => console.log('🎤 Speech detected...'));
    this.onSpeechEnd = options.onSpeechEnd || (() => console.log('🔇 Speech ended'));
    this.onError = options.onError || ((error) => console.error('❌ Error:', error));
    this.onConnect = options.onConnect || (() => console.log('Connected to OpenAI Realtime API'));
    this.onDisconnect = options.onDisconnect || (() => console.log('Disconnected from OpenAI Realtime API'));
  }

  async connect() {
    if (!this.apiKey) {
      throw new Error('OPENAI_API_KEY is required');
    }

    return new Promise((resolve, reject) => {
      this.ws = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'OpenAI-Beta': 'realtime=v1'
        }
      });

      this.ws.on('open', () => {
        this.onConnect();
        this.wsConnected = true;
        this._configureSession();
        resolve();
      });

      this.ws.on('message', (data) => {
        this._handleMessage(data);
      });

      this.ws.on('error', (error) => {
        this.onError(error);
        reject(error);
      });

      this.ws.on('close', () => {
        this.onDisconnect();
        this.wsConnected = false;
      });
    });
  }

  _configureSession() {
    const vadConfig = this.vadType === 'semantic_vad'
      ? { type: 'semantic_vad', eagerness: this.vadEagerness }
      : {
          type: 'server_vad',
          threshold: 0.5,
          prefix_padding_ms: 300,
          silence_duration_ms: 500
        };

    this.ws.send(JSON.stringify({
      type: 'transcription_session.update',
      session: {
        input_audio_format: 'pcm16',
        input_audio_transcription: {
          model: this.model,
          prompt: this.prompt,
          language: this.language
        },
        turn_detection: vadConfig,
        input_audio_noise_reduction: {
          type: 'near_field'
        }
      }
    }));
  }

  _handleMessage(data) {
    try {
      const event = JSON.parse(data.toString());

      switch (event.type) {
        case 'transcription_session.created':
          // Session ready, caller can start sending audio
          break;

        case 'transcription_session.updated':
          // Configuration complete
          break;

        case 'input_audio_buffer.speech_started':
          this.onSpeechStart();
          break;

        case 'input_audio_buffer.speech_stopped':
          this.onSpeechEnd();
          break;

        case 'conversation.item.input_audio_transcription.completed':
          this.onTranscriptionComplete(event.transcript);
          break;

        case 'conversation.item.input_audio_transcription.delta':
          if (event.delta) {
            this.onTranscriptionDelta(event.delta);
          }
          break;

        case 'error':
          this.onError(event.error);
          break;

        default:
          // Uncomment to see all events
          console.log('📨 Event:', event.type);
          break;
      }
    } catch (error) {
      this.onError('Error parsing WebSocket message: ' + error.message);
    }
  }

  sendAudioChunk(audioBuffer) {
    if (this.wsConnected && this.ws) {
      const audioData = audioBuffer.toString('base64');
      this.ws.send(JSON.stringify({
        type: 'input_audio_buffer.append',
        audio: audioData
      }));
    }
  }

  startMicrophoneCapture() {
    return new Promise((resolve, reject) => {
      if (!this.wsConnected) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      this.recording = true;

      const args = [
        '-q',  // quiet mode
        '-r', this.sampleRate.toString(),
        '-c', this.channels.toString(),
        '-b', '16',
        '-t', 'raw',  // raw PCM output
        '-'  // output to stdout
      ];

      const recProcess = spawn('rec', args);

      recProcess.stdout.on('data', (chunk) => {
        if (this.recording) {
          this.sendAudioChunk(chunk);
        }
      });

      recProcess.stderr.on('data', (data) => {
        if (!data.toString().includes('Input File')) {
          this.onError('rec stderr: ' + data.toString());
        }
      });

      recProcess.on('error', (err) => {
        this.onError('Recording error: ' + err.message);
        reject(err);
      });

      recProcess.on('close', (code) => {
        if (this.recording) {
          this.recording = false;
        }
      });

      // Setup cleanup
      const cleanup = () => {
        this.recording = false;
        if (recProcess && !recProcess.killed) {
          recProcess.kill('SIGTERM');
          setTimeout(() => {
            if (!recProcess.killed) {
              recProcess.kill('SIGKILL');
            }
          }, 1000);
        }
      };

      process.on('SIGINT', cleanup);
      process.on('SIGTERM', cleanup);

      resolve({ stop: cleanup, process: recProcess });
    });
  }

  sendAudioFile(filePath, chunkSize = 8192) {
    return new Promise((resolve, reject) => {
      if (!this.wsConnected) {
        reject(new Error('WebSocket not connected'));
        return;
      }

      if (!fs.existsSync(filePath)) {
        reject(new Error(`File not found: ${filePath}`));
        return;
      }

      const stream = fs.createReadStream(filePath, { highWaterMark: chunkSize });

      stream.on('data', (chunk) => {
        this.sendAudioChunk(chunk);
      });

      stream.on('end', () => {
        // Commit the audio buffer to trigger transcription
        this.ws.send(JSON.stringify({
          type: 'input_audio_buffer.commit'
        }));
        resolve();
      });

      stream.on('error', (error) => {
        reject(error);
      });
    });
  }

  close() {
    this.recording = false;
    if (this.ws) {
      this.ws.close();
    }
  }
}

module.exports = RealtimeTranscriber;