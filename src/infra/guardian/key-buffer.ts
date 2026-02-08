import type { DetectedKey, ApiKeyDetectionConfig } from "./api-key-detector.js";
import { detectApiKeys } from "./api-key-detector.js";

type BufferedMessage = {
  text: string;
  timestamp: number;
};

/**
 * Buffer for detecting API keys split across multiple messages
 * Maintains a rolling window of recent messages per session
 */
export class KeyBuffer {
  private buffers = new Map<string, BufferedMessage[]>();
  private readonly maxMessages: number;
  private readonly windowMs: number;

  constructor(maxMessages = 5, windowMs = 60000) {
    this.maxMessages = maxMessages;
    this.windowMs = windowMs;
  }

  /**
   * Add a message to the buffer for a session
   */
  addMessage(sessionKey: string, text: string, timestamp: number): void {
    if (!this.buffers.has(sessionKey)) {
      this.buffers.set(sessionKey, []);
    }

    const buffer = this.buffers.get(sessionKey)!;

    // Add new message
    buffer.push({ text, timestamp });

    // Trim to max messages
    if (buffer.length > this.maxMessages) {
      buffer.shift();
    }

    // Remove messages outside time window
    const cutoff = timestamp - this.windowMs;
    const validMessages = buffer.filter((msg) => msg.timestamp >= cutoff);
    this.buffers.set(sessionKey, validMessages);
  }

  /**
   * Detect API keys that may be split across buffered messages
   * Returns keys found in concatenated buffer
   */
  detectSplitKeys(sessionKey: string, config: ApiKeyDetectionConfig): DetectedKey[] {
    const buffer = this.buffers.get(sessionKey);
    if (!buffer || buffer.length < 2) {
      return [];
    }

    // Concatenate all buffered messages
    const concatenated = buffer.map((msg) => msg.text).join(" ");

    // Detect keys in concatenated text
    const detected = detectApiKeys(concatenated, config);

    // Filter to only keys that span multiple messages
    // (i.e., not fully contained in any single message)
    const splitKeys = detected.filter((key) => {
      return !buffer.some((msg) => msg.text.includes(key.value));
    });

    return splitKeys;
  }

  /**
   * Get buffered messages for a session
   */
  getBuffer(sessionKey: string): BufferedMessage[] {
    return this.buffers.get(sessionKey) ?? [];
  }

  /**
   * Clear buffer for a session
   */
  clearBuffer(sessionKey: string): void {
    this.buffers.delete(sessionKey);
  }

  /**
   * Cleanup old buffers (for sessions older than threshold)
   */
  cleanup(olderThanMs: number): void {
    const cutoff = Date.now() - olderThanMs;

    for (const [sessionKey, buffer] of this.buffers.entries()) {
      if (buffer.length === 0) {
        this.buffers.delete(sessionKey);
        continue;
      }

      const mostRecent = Math.max(...buffer.map((msg) => msg.timestamp));
      if (mostRecent < cutoff) {
        this.buffers.delete(sessionKey);
      }
    }
  }

  /**
   * Get total number of active buffers
   */
  get size(): number {
    return this.buffers.size;
  }
}

// Global instance
let globalBuffer: KeyBuffer | null = null;

/**
 * Get or create global key buffer instance
 */
export function getKeyBuffer(): KeyBuffer {
  if (!globalBuffer) {
    globalBuffer = new KeyBuffer();

    // Cleanup old buffers every 5 minutes
    setInterval(
      () => {
        globalBuffer?.cleanup(5 * 60 * 1000);
      },
      5 * 60 * 1000,
    );
  }

  return globalBuffer;
}
