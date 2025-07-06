import { TranscriptionConfig } from '../config/types';

export interface TranscriptEntry {
  speaker: 'caller' | 'ai';
  text: string;
  timestamp: Date;
}

export interface TranscriptionManagerConfig {
  transcriptionConfig: TranscriptionConfig;
  callId: string;
  onTranscriptReceived?: (entry: TranscriptEntry) => void;
}

export class TranscriptionManager {
  private readonly config: TranscriptionManagerConfig;
  private readonly transcripts: TranscriptEntry[] = [];

  constructor(config: TranscriptionManagerConfig) {
    this.config = config;
  }

  /**
   * Add a completed transcript from either the caller or AI
   */
  public addCompletedTranscript(speaker: 'caller' | 'ai', text: string): void {
    if (!this.config.transcriptionConfig.enabled) {
      return;
    }

    const timestamp = new Date();
    const entry: TranscriptEntry = {
      speaker,
      text: text.trim(),
      timestamp
    };

    // Skip empty transcripts
    if (!entry.text) {
      return;
    }

    this.transcripts.push(entry);

    // Display to console if enabled
    if (this.config.transcriptionConfig.displayToConsole) {
      this.displayTranscriptToConsole(entry);
    }

    // Call the callback if provided
    if (this.config.onTranscriptReceived) {
      this.config.onTranscriptReceived(entry);
    }
  }

  /**
   * Display a transcript entry to console with formatted output
   */
  private displayTranscriptToConsole(entry: TranscriptEntry): void {
    const timeStr = entry.timestamp.toLocaleTimeString('en-GB', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    const speaker = entry.speaker === 'caller' ? 'CALLER' : 'AI';
    const output = `[${timeStr}] ${speaker}: ${entry.text}`;

    // Use console.log for transcripts to ensure they're always visible
    console.log(output);
  }

  /**
   * Get all transcripts for the session
   */
  public getAllTranscripts(): TranscriptEntry[] {
    return [...this.transcripts];
  }

  /**
   * Get transcripts formatted for file output
   */
  public getFormattedTranscript(): string {
    if (this.transcripts.length === 0) {
      return '';
    }

    const lines: string[] = [];

    for (const entry of this.transcripts) {
      const timeStr = entry.timestamp.toLocaleTimeString('en-GB', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      const speaker = entry.speaker === 'caller' ? 'CALLER' : 'AI';
      lines.push(`[${timeStr}] ${speaker}: ${entry.text}`);
    }

    return lines.join('\n');
  }

  /**
   * Get transcript statistics
   */
  public getStats(): { totalEntries: number; callerEntries: number; aiEntries: number } {
    const callerEntries = this.transcripts.filter(t => t.speaker === 'caller').length;
    const aiEntries = this.transcripts.filter(t => t.speaker === 'ai').length;

    return {
      totalEntries: this.transcripts.length,
      callerEntries,
      aiEntries
    };
  }

  /**
   * Clear all transcripts (useful for cleanup)
   */
  public clear(): void {
    this.transcripts.length = 0;
  }
}