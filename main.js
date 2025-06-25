#!/usr/bin/env node

import 'dotenv/config';
import { Command } from 'commander';
import { RealtimeAgent, RealtimeSession } from '@openai/agents/realtime';
import mic from 'mic';

if (!process.env.OPENAI_API_KEY) {
  console.error('Please set your OPENAI_API_KEY environment variable');
  process.exit(1);
}

const program = new Command();

program
  .name('nodejs-mic')
  .description('Record audio from microphone and transcribe using OpenAI Realtime API')
  .version('1.0.0')
  .option('-r, --rate <rate>', 'sample rate (Hz)', '24000')
  .option('-c, --channels <channels>', 'number of channels', '1')
  .action(async (options) => {
    const sampleRate = parseInt(options.rate);
    const channels = parseInt(options.channels);

    console.log(`Starting live transcription...`);
    console.log(`Sample rate: ${sampleRate}Hz, Channels: ${channels}`);
    console.log('Speak into your microphone. Press Ctrl+C to stop.\n');

    const agent = new RealtimeAgent({
      name: 'Transcription Agent',
      instructions: 'You are a transcription agent. Listen to audio and provide transcription only.'
    });

    const session = new RealtimeSession(agent, {
      transport: 'websocket',
      model: 'gpt-4o-realtime-preview-2025-06-03',
      config: {
        turnDetection: {
          type: 'server_vad',
        },
      },
    });

    // Log transcription events
    session.transport.on('conversation.item.input_audio_transcription.completed', (event) => {
      console.log('Transcription:', event.transcript);
    });

    try {
      console.log('Connecting...');
      await session.connect({ apiKey: process.env.OPENAI_API_KEY });
      console.log('Connected!');
      
      const micInstance = mic({
        rate: sampleRate,
        channels: channels,
        debug: false,
        exitOnSilence: 0
      });

      const micInputStream = micInstance.getAudioStream();
      
      micInputStream.on('data', (data) => {
        session.sendAudio(data);
      });

      micInputStream.on('error', (err) => {
        console.error('Microphone error:', err);
      });

      micInstance.start();
      
      // Handle cleanup on exit
      process.on('SIGINT', () => {
        console.log('\nStopping transcription...');
        micInstance.stop();
        session.close();
        process.exit(0);
      });
      
    } catch (error) {
      console.error('Error:', error.message);
      process.exit(1);
    }
  });

program.parse();
