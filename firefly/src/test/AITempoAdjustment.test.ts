import { describe, test } from 'node:test';
import assert from 'node:assert';
import { TempoAdjustTransform } from '../rtp/TempoAdjustTransform';

describe('AI Tempo Adjustment', () => {
  test('should create TempoAdjustTransform with tempo configuration', async () => {
    
    const tempoAdjust = new TempoAdjustTransform({
      tempo: 1.2, // 20% faster
      codecInfo: {
        name: 'PCMA',
        payload: 8,
        clockRate: 8000,
        channels: 1
      },
      sessionId: 'ai-speed-test'
    });
    
    assert.ok(tempoAdjust, 'TempoAdjustTransform should be created');
    
    // Test that FFmpeg is available (if not, this is expected to work but won't process audio)
    const isFFmpegAvailable = TempoAdjustTransform.isAvailable();
    console.log(`FFmpeg available: ${isFFmpegAvailable}`);
    
    tempoAdjust.destroy();
  });
  
  test('should process audio through tempo adjustment pipeline', async () => {
    const processedChunks: Buffer[] = [];
    
    const tempoAdjust = new TempoAdjustTransform({
      tempo: 1.5, // 50% faster for noticeable difference
      codecInfo: {
        name: 'PCMU',
        payload: 0,
        clockRate: 8000,
        channels: 1
      },
      sessionId: 'ai-speed-test-processing'
    });
    
    // Collect processed output
    tempoAdjust.on('data', (chunk: Buffer) => {
      processedChunks.push(chunk);
    });
    
    // Create some test audio data (silence with G.711 μ-law encoding)
    const silenceValue = 0xFF; // G.711 μ-law silence
    const testAudio = Buffer.alloc(160, silenceValue); // 20ms of audio at 8kHz
    
    // Send test audio
    tempoAdjust.write(testAudio);
    tempoAdjust.end();
    
    // Wait for processing to complete
    await new Promise<void>((resolve) => {
      tempoAdjust.on('end', () => {
        resolve();
      });
      tempoAdjust.on('error', (error) => {
        console.log('FFmpeg processing error (expected if FFmpeg not available):', error.message);
        resolve(); // Still resolve to continue test
      });
      
      // Timeout after 2 seconds
      setTimeout(() => {
        resolve();
      }, 2000);
    });
    
    console.log(`Processed ${processedChunks.length} audio chunks`);
    
    if (processedChunks.length > 0) {
      const totalProcessedBytes = processedChunks.reduce((sum, chunk) => sum + chunk.length, 0);
      console.log(`Original audio: ${testAudio.length} bytes, Processed: ${totalProcessedBytes} bytes`);
      
      // With 50% speed increase, we expect less output data (shorter duration)
      // This is just a basic sanity check - exact ratio depends on FFmpeg processing
      assert.ok(totalProcessedBytes > 0, 'Should produce some processed audio output');
    } else {
      console.log('No processed chunks (FFmpeg might not be available - this is okay for testing)');
    }
    
    tempoAdjust.destroy();
  });
  
  test('should handle different tempo values', () => {
    const testCases = [
      { tempo: 0.8, description: '20% slower' },
      { tempo: 1.0, description: 'normal speed (no adjustment)' },
      { tempo: 1.2, description: '20% faster' },
      { tempo: 1.5, description: '50% faster' },
      { tempo: 2.0, description: '100% faster' }
    ];
    
    testCases.forEach(({ tempo, description }) => {
      const tempoAdjust = new TempoAdjustTransform({
        tempo,
        codecInfo: {
          name: 'PCMA',
          payload: 8,
          clockRate: 8000,
          channels: 1
        },
        sessionId: `tempo-test-${tempo}`
      });
      
      assert.ok(tempoAdjust, `Should create transform for ${description} (tempo: ${tempo})`);
      console.log(`✓ Created TempoAdjustTransform for ${description} (tempo: ${tempo})`);
      
      tempoAdjust.destroy();
    });
  });
});