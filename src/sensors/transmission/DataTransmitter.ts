```typescript
import zlib from 'zlib';

type TransmissionData = Record<string, unknown>;

interface TransmissionMessage {
  id: string;
  priority: number;
  dataBatch: TransmissionData[];
  retries: number;
}

interface TransmissionMetrics {
  totalSent: number;
  totalRetries: number;
  totalFailures: number;
  avgLatencyMs: number;
  pendingMessages: number;
}

export class DataTransmitter {
  private readonly MAX_RETRY = 5;
  private readonly BATCH_SIZE = 10;
  private readonly RECONNECT_DELAY_MS = 2000;
  private readonly maxBatchByteSize = 64 * 1024; // 64KB max for compression batch

  private connection: WebSocket | null = null;
  private readonly url: string;

  private isConnected = false;
  private isConnecting = false;

  private transmissionQueue: TransmissionMessage[] = [];
  private pendingAckMessages: Map<string, number> = new Map();

  private metrics: TransmissionMetrics = {
    totalSent: 0,
    totalRetries: 0,
    totalFailures: 0,
    avgLatencyMs: 0,
    pendingMessages: 0,
  };

  private latencySamples: number[] = [];

  constructor(url: string) {
    this.url = url;
    this.connect();
  }

  private connect(): void {
    if (this.isConnecting || this.isConnected) return;
    this.isConnecting = true;

    this.connection = new WebSocket(this.url);
    this.connection.binaryType = 'arraybuffer';

    this.connection.onopen = () => {
      this.isConnected = true;
      this.isConnecting = false;
      this.drainQueue().catch(() => {});
    };

    this.connection.onclose = () => {
      this.isConnected = false;
      this.isConnecting = false;
      setTimeout(() => this.connect(), this.RECONNECT_DELAY_MS);
    };

    this.connection.onerror = (error) => {
      // Connection errors fallback handled by onclose
      // no-op here for now
    };

    this.connection.onmessage = (event) => {
      try {
        const msg = typeof event.data === 'string' ? JSON.parse(event.data) : null;
        if (msg && msg.ackId && this.pendingAckMessages.has(msg.ackId)) {
          const startTimestamp = this.pendingAckMessages.get(msg.ackId)!;
          const latency = Date.now() - startTimestamp;
          this.updateLatency(latency);
          this.pendingAckMessages.delete(msg.ackId);
        }
      } catch {
        // ignore malformed ack messages
      }
    };
  }

  private updateLatency(latency: number): void {
    this.latencySamples.push(latency);
    if (this.latencySamples.length > 50) this.latencySamples.shift();
    const sum = this.latencySamples.reduce((a, b) => a + b, 0);
    this.metrics.avgLatencyMs = sum / this.latencySamples.length;
  }

  async transmit(data: TransmissionData, priority = 0): Promise<void> {
    await this.enqueue({ id: this.generateId(), priority, dataBatch: [data], retries: 0 });
    await this.drainQueue();
  }

  private async enqueue(message: TransmissionMessage): Promise<void> {
    // Insert message by priority descending (higher number = higher priority)
    const idx = this.transmissionQueue.findIndex(m => m.priority < message.priority);
    if (idx === -1) {
      this.transmissionQueue.push(message);
    } else {
      this.transmissionQueue.splice(idx, 0, message);
    }
    this.metrics.pendingMessages = this.transmissionQueue.length;
  }

  private async drainQueue(): Promise<void> {
    if (!this.isConnected) return;

    // Batch messages by priority grouping while respecting batch size limit
    while (this.transmissionQueue.length > 0 && this.isConnected) {
      const batchMessages: TransmissionMessage[] = [];
      let batchByteSize = 0;
      let maxPriority = this.transmissionQueue[0].priority;

      for (let i = 0; i < this.transmissionQueue.length; i++) {
        const msg = this.transmissionQueue[i];
        if (msg.priority < maxPriority) break;

        const serialized = JSON.stringify(msg.dataBatch);
        const approxBytes = Buffer.byteLength(serialized, 'utf8');
        if (batchByteSize + approxBytes > this.maxBatchByteSize) break;

        batchMessages.push(msg);
        batchByteSize += approxBytes;
      }

      if (batchMessages.length === 0) {
        // Single message too large to batch, forcibly send one message anyway
        batchMessages.push(this.transmissionQueue[0]);
      }

      // Prepare combined batch data
      const combinedDataBatch = batchMessages.flatMap(m => m.dataBatch);
      const batchId = this.generateId();
      const compressedPayload = await this.compressData(JSON.stringify({ batchId, data: combinedDataBatch }));

      try {
        await this.sendPayload(batchId, compressedPayload);
        // Remove sent messages from queue and mark as pending ack
        for (const m of batchMessages) {
          this.transmissionQueue.splice(this.transmissionQueue.indexOf(m), 1);
          this.pendingAckMessages.set(m.id, Date.now());
        }
        this.metrics.totalSent += batchMessages.length;
      } catch (err) {
        for (const msg of batchMessages) {
          await this.handleSendError(msg, err);
        }
        break; // after error, wait for next connection or retry cycle
      }
      this.metrics.pendingMessages = this.transmissionQueue.length;
    }
  }

  private async sendPayload(batchId: string, payload: Uint8Array): Promise<void> {
    if (!this.connection || this.connection.readyState !== WebSocket.OPEN) throw new ConnectionError();

    return new Promise<void>((resolve, reject) => {
      const onError = (ev: Event) => {
        cleanup();
        reject(new TransmissionError('Send failed'));
      };
      const onAck = (event: MessageEvent) => {
        try {
          const msg = typeof event.data === 'string' ? JSON.parse(event.data) : null;
          if (msg && msg.batchAckId === batchId) {
            cleanup();
            resolve();
          }
        } catch {
          // ignore malformed ack message
        }
      };
      const cleanup = () => {
        if (!this.connection) return;
        this.connection.removeEventListener('error', onError);
        this.connection.removeEventListener('message', onAck);
      };

      if (!this.connection) return reject(new ConnectionError());

      this.connection.addEventListener('error', onError);
      this.connection.addEventListener('message', onAck);

      try {
        this.connection.send(payload);
      } catch (err) {
        cleanup();
        return reject(err);
      }

      // Timeout for ack after 5s
      setTimeout(() => {
        cleanup();
        reject(new TransmissionTimeoutError('Acknowledgment timeout'));
      }, 5000);
    });
  }

  private async handleSendError(message: TransmissionMessage, err: unknown): Promise<void> {
    message.retries++;
    this.metrics.totalFailures++;

    if (message.retries > this.MAX_RETRY) {
      // drop message after max retries
      this.pendingAckMessages.delete(message.id);
      return;
    }

    // re-insert for retry with delay
    setTimeout(() => {
      this.enqueue(message).catch(() => {});
      this.drainQueue().catch(() => {});
    }, this.retryDelay(message.retries));

    this.metrics.totalRetries++;
  }

  private retryDelay(retryCount: number): number {
    return Math.min(30000, 1000 * 2 ** retryCount);
  }

  private compressData(data: string): Promise<Uint8Array> {
    return new Promise((resolve, reject) => {
      zlib.deflate(Buffer.from(data, 'utf-8'), (err, buffer) => {
        if (err || !buffer) return reject(err ?? new CompressionError('Deflate failed'));
        resolve(buffer);
      });
    });
  }

  getMetrics(): TransmissionMetrics {
    return { ...this.metrics };
  }

  private generateId(): string {
    // Simple unique ID generator (not cryptographically safe)
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  }
}

export class TransmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransmissionError';
  }
}
export class TransmissionTimeoutError extends TransmissionError {
  constructor(message: string) {
    super(message);
    this.name = 'TransmissionTimeoutError';
  }
}
export class ConnectionError extends TransmissionError {
  constructor(message = 'Connection is not established') {
    super(message);
    this.name = 'ConnectionError';
  }
}
export class CompressionError extends TransmissionError {
  constructor(message: string) {
    super(message);
    this.name = 'CompressionError';
  }
}
```
