#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import WebSocket from 'ws';
import mic from 'mic';
import Speaker from 'speaker';

if (!process.env.OPENAI_API_KEY) {
  console.error('Please set your OPENAI_API_KEY environment variable');
  process.exit(1);
}

const program = new Command();

program
  .name('chat')
  .description('AI voice chat using OpenAI Realtime API')
  .version('1.0.0')
  .option('-r, --rate <rate>', 'sample rate (Hz)', '24000')
  .option('-c, --channels <channels>', 'number of channels', '1')
  .action(async (options) => {
    const sampleRate = parseInt(options.rate);
    const channels = parseInt(options.channels);

    console.log(`Starting AI voice chat...`);
    console.log(`Sample rate: ${sampleRate}Hz, Channels: ${channels}`);
    console.log('Speak into your microphone to chat with AI. Press Ctrl+C to stop.\n');

    console.log('Connecting to OpenAI Realtime API...');

    const ws = new WebSocket('wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview', {
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'OpenAI-Beta': 'realtime=v1'
      }
    });

    let micInstance = null;
    let micInputStream = null;
    let currentSpeaker = null;

    ws.on('open', () => {
      console.log('Connected! Configuring session...');

      // Configure session for conversation
      ws.send(JSON.stringify({
        type: 'session.update',
        session: {
          modalities: ['text', 'audio'],
          instructions: 'You are a helpful AI assistant. Keep responses conversational and concise.',
          voice: 'alloy',
          input_audio_format: 'pcm16',
          output_audio_format: 'pcm16',
          input_audio_transcription: {
            model: 'gpt-4o-transcribe'
          },
          turn_detection: {
            type: 'semantic_vad'
          }
        }
      }));

      startMicrophoneCapture();
    });

    ws.on('message', (data) => {
      try {
        const event = JSON.parse(data.toString());
        // console.log('📨 Event:', event.type);

        switch (event.type) {
          case 'session.created':
            console.log('Session created!');
            break;

          case 'session.updated':
            console.log('Session configured! Start speaking...\n');
            break;



          case 'conversation.item.input_audio_transcription.delta':
            if (event.delta) {
              process.stdout.write(event.delta);
            }
            break;

          case 'conversation.item.input_audio_transcription.completed':
            if (event.transcript) {
              console.log(`\n👤 You said: "${event.transcript}"`);
            }
            break;

          case 'response.audio_transcript.delta':
            if (event.delta) {
              process.stdout.write(event.delta);
            }
            break;

          case 'response.audio_transcript.done':
            if (event.transcript) {
              console.log(`\n🤖 AI said: "${event.transcript}"`);
            }
            break;

          case 'response.audio.delta':
            if (event.delta) {
              // Create speaker if it doesn't exist for this response
              if (!currentSpeaker) {
                currentSpeaker = new Speaker({
                  channels: channels,
                  bitDepth: 16,  // PCM16
                  sampleRate: sampleRate,
                  signed: true
                });

                currentSpeaker.on('error', (err) => {
                  console.error('Speaker error:', err);
                });
              }

              // Play audio chunk
              const audioBuffer = Buffer.from(event.delta, 'base64');
              currentSpeaker.write(audioBuffer);
            }
            break;

          case 'response.audio.done':
            // Close the current speaker to prevent buffer underflow warnings
            if (currentSpeaker) {
              currentSpeaker.end();
              currentSpeaker = null;
            }
            break;

          case 'response.done':
            console.log('---\n');
            break;

          case 'error':
            console.error('❌ API Error:', event.error);
            break;

          default:
            // Uncomment for debugging
            // console.log('📨 Event:', event.type, JSON.stringify(event, null, 2));
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
        console.log('Microphone started!\n');

      } catch (error) {
        console.error('Failed to start microphone:', error.message);
        console.error('Make sure microphone permissions are granted');
        cleanup();
      }
    }

    function cleanup() {
      console.log('\nCleaning up...');

      if (micInstance) {
        micInstance.stop();
      }

      if (currentSpeaker) {
        currentSpeaker.end();
      }

      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.close();
      }

      process.exit(0);
    }

    // Handle cleanup on exit
    process.on('SIGINT', () => {
      console.log('\nStopping chat...');
      cleanup();
    });

    process.on('SIGTERM', cleanup);
  });

program.parse();