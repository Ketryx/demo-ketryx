```typescript
import { EventEmitter } from 'events';

export interface SensorData {
  timestamp: number;
  values: Record<string, number>;
}

export interface HardwareInterface {
  initialize(): Promise<void>;
  readData(): Promise<Record<string, number>>;
  getStatus(): Promise<'ok' | 'error' | 'disconnected'>;
  shutdown(): Promise<void>;
}

export interface DataAcquisitionOptions {
  samplingIntervalMs: number;
  hardwareInterface: HardwareInterface;
}

export type AcquisitionState = 'stopped' | 'running' | 'paused';

export interface AcquisitionError {
  message: string;
  code?: string;
  timestamp: number;
}

export class DataAcquisition extends EventEmitter {
  private samplingIntervalMs: number;
  private hardwareInterface: HardwareInterface;
  private timer: NodeJS.Timeout | null = null;
  private buffer: SensorData[] = [];
  private state: AcquisitionState = 'stopped';

  private lastTimestampSync: number | null = null;
  private acquisitionError: AcquisitionError | null = null;

  constructor(options: DataAcquisitionOptions) {
    super();
    this.samplingIntervalMs = options.samplingIntervalMs;
    this.hardwareInterface = options.hardwareInterface;
  }

  public get stateStatus(): AcquisitionState {
    return this.state;
  }

  public get bufferedData(): SensorData[] {
    return [...this.buffer];
  }

  public get currentError(): AcquisitionError | null {
    return this.acquisitionError;
  }

  public async start(): Promise<void> {
    if (this.state === 'running') return;
    try {
      await this.hardwareInterface.initialize();
      this.state = 'running';
      this.acquisitionError = null;
      this.lastTimestampSync = Date.now();
      this.buffer.length = 0;
      this.scheduleNextSample();
      this.emit('start');
    } catch (error: any) {
      this.handleError(error);
      throw error;
    }
  }

  public async stop(): Promise<void> {
    if (this.state === 'stopped') return;
    this.clearTimer();
    await this.hardwareInterface.shutdown();
    this.state = 'stopped';
    this.emit('stop');
  }

  public pause(): void {
    if (this.state !== 'running') return;
    this.clearTimer();
    this.state = 'paused';
    this.emit('pause');
  }

  public resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'running';
    this.scheduleNextSample();
    this.emit('resume');
  }

  public clearBuffer(): void {
    this.buffer.length = 0;
    this.emit('bufferCleared');
  }

  public async getSensorStatus(): Promise<'ok' | 'error' | 'disconnected'> {
    try {
      return await this.hardwareInterface.getStatus();
    } catch {
      return 'error';
    }
  }

  private scheduleNextSample(): void {
    this.timer = setTimeout(() => this.sampleData(), this.samplingIntervalMs);
  }

  private async sampleData(): Promise<void> {
    if (this.state !== 'running') return;
    try {
      const hwTimestamp = Date.now();
      const rawData = await this.hardwareInterface.readData();
      const timestamp = this.synchronizeTimestamp(hwTimestamp);

      const sensorData: SensorData = {
        timestamp,
        values: rawData,
      };

      this.buffer.push(sensorData);
      this.emit('data', sensorData);

      this.scheduleNextSample();
    } catch (error: any) {
      this.handleError(error);
      this.emit('error', this.acquisitionError);
      this.pause();
    }
  }

  private synchronizeTimestamp(hwTimestamp: number): number {
    if (this.lastTimestampSync === null) {
      this.lastTimestampSync = hwTimestamp;
      return hwTimestamp;
    }
    // Basic sync strategy: just return current hardware timestamp for now
    // Can be extended to handle clock drifts or advanced sync techniques
    this.lastTimestampSync = hwTimestamp;
    return hwTimestamp;
  }

  private handleError(error: any): void {
    this.acquisitionError = {
      message: error?.message || 'Unknown acquisition error',
      code: error?.code,
      timestamp: Date.now(),
    };
  }

  private clearTimer(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
```