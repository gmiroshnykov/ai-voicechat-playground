#!/usr/bin/env node

require('dotenv').config();
const path = require('path');
const RealtimeTranscriber = require('./lib/realtime-transcriber');

async function testTranscription() {
  const audioFile = path.join(__dirname, 'count.raw');

  const transcriber = new RealtimeTranscriber({
    onTranscriptionDelta: (delta) => {
      // Show streaming transcription
      process.stdout.write(delta);
    },
    onTranscriptionComplete: (transcript) => {
      console.log(`\n\nFinal result: "${transcript}"`);
    },
    onSpeechStart: () => {
      console.log('🎤 Processing audio...');
    },
    onSpeechEnd: () => {
      console.log('\n🔇 Audio processing complete');
    },
    onError: (error) => {
      console.error('❌ Error:', error);
      process.exit(1);
    }
  });

  try {
    console.log('Connecting to OpenAI Realtime API...');
    await transcriber.connect();

    // Wait for session to be configured
    await new Promise(resolve => setTimeout(resolve, 1000));

    try {
      console.log('Sending audio file for transcription...\n');
      await transcriber.sendAudioFile(audioFile);

      // Give some time for final transcription to complete
      await new Promise(resolve => setTimeout(resolve, 5000));

      console.log('\nTest complete!');
      transcriber.close();
      process.exit(0);

    } catch (error) {
      console.error('Failed to send audio file:', error.message);
      process.exit(1);
    }

  } catch (error) {
    console.error('Failed to connect to OpenAI:', error.message);
    if (!process.env.OPENAI_API_KEY) {
      console.error('Please set your OPENAI_API_KEY environment variable');
    }
    process.exit(1);
  }
}

testTranscription();