#!/usr/bin/env node

import fs from 'fs';
import Speaker from 'speaker';

function playRawFile(filename, options = {}) {
  console.log(`Playing raw audio: ${filename}`);
  
  // Default format matches your mic recording format
  const format = {
    channels: options.channels || 1,
    sampleRate: options.sampleRate || 22050,
    bitDepth: options.bitDepth || 16,
    signed: options.signed !== false // default to true
  };
  
  console.log(`Format: ${format.channels} channels, ${format.sampleRate}Hz, ${format.bitDepth}-bit, ${format.signed ? 'signed' : 'unsigned'}`);
  
  const audioData = fs.readFileSync(filename);
  console.log(`Data size: ${audioData.length} bytes`);
  
  const speaker = new Speaker({
    channels: format.channels,
    bitDepth: format.bitDepth,
    sampleRate: format.sampleRate,
    signed: format.signed
  });

  speaker.on('open', () => {
    console.log('Audio playback started');
  });
  
  speaker.on('close', () => {
    console.log('Audio playback finished');
  });
  
  speaker.on('error', (err) => {
    console.error('Speaker error:', err);
  });

  speaker.write(audioData);
  speaker.end();
}

function parseArgs() {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.error('Usage: node play-raw.js <raw-file> [options]');
    console.error('');
    console.error('Options:');
    console.error('  --channels <n>      Number of audio channels (default: 1)');
    console.error('  --sample-rate <n>   Sample rate in Hz (default: 22050)');
    console.error('  --bit-depth <n>     Bit depth: 8, 16, 24, 32 (default: 16)');
    console.error('  --unsigned          Use unsigned PCM data (default: signed)');
    console.error('');
    console.error('Examples:');
    console.error('  node play-raw.js count.raw');
    console.error('  node play-raw.js count.raw --sample-rate 24000');
    console.error('  node play-raw.js audio.raw --channels 2 --sample-rate 44100');
    process.exit(1);
  }

  const filename = args[0];
  const options = {};
  
  for (let i = 1; i < args.length; i += 2) {
    const flag = args[i];
    const value = args[i + 1];
    
    switch (flag) {
      case '--channels':
        options.channels = parseInt(value);
        if (isNaN(options.channels) || options.channels < 1) {
          console.error('Invalid channels value');
          process.exit(1);
        }
        break;
      case '--sample-rate':
        options.sampleRate = parseInt(value);
        if (isNaN(options.sampleRate) || options.sampleRate < 1000) {
          console.error('Invalid sample rate value');
          process.exit(1);
        }
        break;
      case '--bit-depth':
        options.bitDepth = parseInt(value);
        if (![8, 16, 24, 32].includes(options.bitDepth)) {
          console.error('Invalid bit depth (must be 8, 16, 24, or 32)');
          process.exit(1);
        }
        break;
      case '--unsigned':
        options.signed = false;
        i--; // This flag doesn't consume a value
        break;
      default:
        console.error(`Unknown option: ${flag}`);
        process.exit(1);
    }
  }
  
  return { filename, options };
}

// Main execution
const { filename, options } = parseArgs();

if (!fs.existsSync(filename)) {
  console.error(`File not found: ${filename}`);
  process.exit(1);
}

try {
  playRawFile(filename, options);
} catch (error) {
  console.error('Error playing file:', error.message);
  process.exit(1);
}