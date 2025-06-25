#!/usr/bin/env node

require('dotenv').config();
const { Command } = require('commander');
const RealtimeTranscriber = require('./lib/realtime-transcriber');

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

    const transcriber = new RealtimeTranscriber({
      sampleRate,
      channels
    });

    try {
      await transcriber.connect();
      
      // Wait a moment for session to be fully configured
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      try {
        const capture = await transcriber.startMicrophoneCapture();
        
        // Handle cleanup on exit
        process.on('SIGINT', () => {
          console.log('\nStopping transcription...');
          capture.stop();
          transcriber.close();
          process.exit(0);
        });
      } catch (error) {
        console.error('Failed to start microphone capture:', error.message);
        console.error('Make sure SoX is installed and microphone permissions are granted');
        process.exit(1);
      }
      
    } catch (error) {
      console.error('Failed to connect to OpenAI:', error.message);
      if (!process.env.OPENAI_API_KEY) {
        console.error('Please set your OPENAI_API_KEY environment variable');
      }
      process.exit(1);
    }
  });

program.parse();