# Audio Files

This directory contains sample audio files for testing the voice chat and playback utilities.

## File Types

- **`.wav` files**: Standard WAV audio files with headers
- **`.raw` files**: Raw PCM audio data without headers

## Converting WAV to RAW

To convert a WAV file to raw PCM format, use the `sox` command (already included in the devbox environment):

```bash
# Basic conversion (uses WAV file's original format)
sox input.wav output.raw

# Convert to specific format (16-bit, 24kHz, mono)
sox input.wav -r 24000 -b 16 -c 1 output.raw

# Convert to 22.05kHz (common for voice)
sox input.wav -r 22050 -b 16 -c 1 output.raw
```

## Format Details

The raw files in this directory use:
- **Sample Rate**: 22050 Hz (some files use 24000 Hz)
- **Bit Depth**: 16-bit signed
- **Channels**: 1 (mono)
- **Encoding**: PCM (signed little-endian)

## Playing Audio Files

Use the provided utilities to play these files:

```bash
# Play WAV files
bin/play audio/count.wav

# Play raw files (using default format)
bin/play-raw audio/count.raw

# Play raw files with custom format
bin/play-raw audio/count.raw --sample-rate 24000
```

## Sample Files

- `count.wav/raw`: Counting from 1 to 10
- `count-padded.wav/raw`: Counting with padding
- `count-padded-10s.wav/raw`: 10-second padded counting
- `response.wav`: AI voice response sample