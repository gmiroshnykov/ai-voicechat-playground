#!/usr/bin/env node

import fs from 'fs';
import Speaker from 'speaker';

function parseWavHeader(buffer) {
  // WAV header structure:
  // 0-3: "RIFF"
  // 4-7: File size - 8
  // 8-11: "WAVE"
  // 12-15: "fmt "
  // 16-19: Format chunk size (16 for PCM)
  // 20-21: Audio format (1 = PCM)
  // 22-23: Number of channels
  // 24-27: Sample rate
  // 28-31: Byte rate
  // 32-33: Block align
  // 34-35: Bits per sample
  // 36-39: "data"
  // 40-43: Data chunk size

  if (buffer.toString('ascii', 0, 4) !== 'RIFF') {
    throw new Error('Not a valid WAV file: missing RIFF header');
  }

  if (buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('Not a valid WAV file: missing WAVE identifier');
  }

  const audioFormat = buffer.readUInt16LE(20);
  if (audioFormat !== 1) {
    throw new Error(`Unsupported audio format: ${audioFormat} (only PCM is supported)`);
  }

  const channels = buffer.readUInt16LE(22);
  const sampleRate = buffer.readUInt32LE(24);
  const bitsPerSample = buffer.readUInt16LE(34);

  // Find the data chunk
  let dataOffset = 36;
  while (dataOffset < buffer.length - 8) {
    const chunkId = buffer.toString('ascii', dataOffset, dataOffset + 4);
    const chunkSize = buffer.readUInt32LE(dataOffset + 4);
    
    if (chunkId === 'data') {
      return {
        channels,
        sampleRate,
        bitsPerSample,
        dataOffset: dataOffset + 8,
        dataSize: chunkSize
      };
    }
    
    dataOffset += 8 + chunkSize;
  }

  throw new Error('No data chunk found in WAV file');
}

function playWavFile(filename) {
  console.log(`Playing: ${filename}`);
  
  const buffer = fs.readFileSync(filename);
  const wavInfo = parseWavHeader(buffer);
  
  console.log(`Format: ${wavInfo.channels} channels, ${wavInfo.sampleRate}Hz, ${wavInfo.bitsPerSample}-bit`);
  console.log(`Data size: ${wavInfo.dataSize} bytes`);
  
  const speaker = new Speaker({
    channels: wavInfo.channels,
    bitDepth: wavInfo.bitsPerSample,
    sampleRate: wavInfo.sampleRate,
    signed: true
  });

  const audioData = buffer.subarray(wavInfo.dataOffset, wavInfo.dataOffset + wavInfo.dataSize);
  
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

// Command line usage
const filename = process.argv[2];
if (!filename) {
  console.error('Usage: node play.js <wav-file>');
  console.error('Example: node play.js count.wav');
  process.exit(1);
}

if (!fs.existsSync(filename)) {
  console.error(`File not found: ${filename}`);
  process.exit(1);
}

try {
  playWavFile(filename);
} catch (error) {
  console.error('Error playing file:', error.message);
  process.exit(1);
}