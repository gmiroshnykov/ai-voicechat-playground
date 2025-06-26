#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import WebSocket from 'ws';
import mic from 'mic';

if (!process.env.OPENAI_API_KEY) {
  console.error('Please set your OPENAI_API_KEY environment variable');
  process.exit(1);
}

const program = new Command();

program
  .name('mic-ws')
  .description('Record audio from microphone and transcribe using OpenAI Realtime API (WebSocket)')
  .version('1.0.0')
  .option('-r, --rate <rate>', 'sample rate (Hz)', '24000')
  .option('-c, --channels <channels>', 'number of channels', '1')
  .action(async (options) => {
    const sampleRate = parseInt(options.rate);
    const channels = parseInt(options.channels);

    console.log(`Starting live transcription with WebSocket...`);
    console.log(`Sample rate: ${sampleRate}Hz, Channels: ${channels}`);
    console.log('Speak into your microphone. Press Ctrl+C to stop.\n');

    console.log('Connecting to OpenAI Realtime API...');
    
    const ws = new WebSocket('wss://api.openai.com/v1/realtime?intent=transcription', {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

    let micInstance = null;
    let micInputStream = null;

    ws.on('open', () => {
      console.log('Connected! Configuring transcription session...');
      
      // Configure transcription session
      ws.send(JSON.stringify({
        type: 'transcription_session.update',
        session: {
          input_audio_format: 'pcm16',
          input_audio_transcription: {
            model: 'gpt-4o-transcribe',
            prompt: 'This is English speech with numbers and common words.',
            language: 'en'
          },
          turn_detection: {
            type: 'server_vad',
            threshold: 0.5,
            prefix_padding_ms: 300,
            silence_duration_ms: 500
          },
          input_audio_noise_reduction: {
            type: 'near_field'
          }
        }
      }));
    });

    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString());
        
        switch (event.type) {
          case 'transcription_session.created':
            console.log('Transcription session created!');
            startMicrophoneCapture();
            break;
            
          case 'transcription_session.updated':
            console.log('Transcription session configured!');
            break;
            
          case 'input_audio_buffer.speech_started':
            console.log('🎤 Speech detected...');
            break;
            
          case 'input_audio_buffer.speech_stopped':
            console.log('🔇 Speech ended');
            break;
            
          case 'conversation.item.input_audio_transcription.delta':
            if (event.delta) {
              process.stdout.write(event.delta);
            }
            break;
            
          case 'conversation.item.input_audio_transcription.completed':
            console.log(`\nFinal transcript: "${event.transcript}"`);
            break;
            
          case 'input_audio_buffer.committed':
            console.log('Audio buffer committed');
            break;
            
          case 'error':
            console.error('❌ API Error:', event.error);
            break;
            
          default:
            console.log('📨 Event:', event.type);
            break;
        }
      } catch (error) {
        console.error('Error parsing message:', error);
      }
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      cleanup();
    });

    ws.on('close', () => {
      console.log('WebSocket connection closed');
      cleanup();
    });

    function startMicrophoneCapture() {
      console.log('Starting microphone capture...');
      
      try {
        micInstance = mic({
          rate: sampleRate,
          channels: channels,
          debug: false,
          exitOnSilence: 0
        });

        micInputStream = micInstance.getAudioStream();
        
        micInputStream.on('data', (audioChunk) => {
          if (ws.readyState === WebSocket.OPEN) {
            const audioBase64 = audioChunk.toString('base64');
            ws.send(JSON.stringify({
              type: 'input_audio_buffer.append',
              audio: audioBase64
            }));
          }
        });

        micInputStream.on('error', (err) => {
          console.error('Microphone error:', err);
          cleanup();
        });

        micInstance.start();
        console.log('Microphone started! Speak now...\n');
        
      } catch (error) {
        console.error('Failed to start microphone:', error.message);
        console.error('Make sure microphone permissions are granted');
        cleanup();
      }
    }

    function cleanup() {
      if (micInstance) {
        micInstance.stop();
      }
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
      process.exit(0);
    }

    // Handle cleanup on exit
    process.on('SIGINT', () => {
      console.log('\nStopping transcription...');
      cleanup();
    });

    process.on('SIGTERM', cleanup);
  });

program.parse();