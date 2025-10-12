```typescript
// src/sensors/SensorModule.ts

export interface SensorData {
  timestamp: number;
  rawValue: number;
  filteredValue?: number;
  normalizedValue?: number;
  valid: boolean;
}

export interface SensorConfig {
  samplingRateHz: number;
  filterConfig?: FilterConfig;
  normalizationConfig?: NormalizationConfig;
  calibrationConfig?: CalibrationConfig;
  validationThresholds?: ValidationThresholds;
  transmissionRetryLimit?: number;
  transmissionRetryIntervalMs?: number;
}

export interface FilterConfig {
  enabled: boolean;
  type: 'movingAverage' | 'lowPass' | 'highPass';
  windowSize?: number;
  cutoffFrequencyHz?: number;
}

export interface NormalizationConfig {
  enabled: boolean;
  minValue: number;
  maxValue: number;
}

export interface CalibrationConfig {
  offset: number;
  scale: number;
}

export interface ValidationThresholds {
  minValidValue: number;
  maxValidValue: number;
}

export interface HealthStatus {
  isCalibrated: boolean;
  lastCalibrationTimestamp: number | null;
  lastError: Error | null;
  sensorActive: boolean;
  dataLatencyMs: number;
  bufferFillLevel: number;
}

type TransmissionCallback = (data: SensorData) => Promise<void>;

export class SensorModule {
  private config: SensorConfig;
  private acquisitionIntervalId: NodeJS.Timeout | null = null;

  private rawDataBuffer: SensorData[] = [];
  private processedDataBuffer: SensorData[] = [];

  private transmissionQueue: SensorData[] = [];
  private transmissionInProgress: boolean = false;

  private filterState: number[] = [];
  private lastAcquisitionTime: number | null = null;

  private healthStatus: HealthStatus = {
    isCalibrated: false,
    lastCalibrationTimestamp: null,
    lastError: null,
    sensorActive: false,
    dataLatencyMs: 0,
    bufferFillLevel: 0,
  };

  private transmissionCallback: TransmissionCallback;

  constructor(config: SensorConfig, transmissionCallback: TransmissionCallback) {
    this.config = {
      transmissionRetryLimit: 3,
      transmissionRetryIntervalMs: 2000,
      ...config,
    };
    this.transmissionCallback = transmissionCallback;
    if (this.config.filterConfig?.enabled && this.config.filterConfig.type === 'movingAverage') {
      this.filterState = [];
    }
  }

  start(): void {
    if (this.acquisitionIntervalId) return;
    const intervalMs = 1000 / this.config.samplingRateHz;
    this.acquisitionIntervalId = setInterval(() => this.acquireData(), intervalMs);
    this.healthStatus.sensorActive = true;
  }

  stop(): void {
    if (this.acquisitionIntervalId) {
      clearInterval(this.acquisitionIntervalId);
      this.acquisitionIntervalId = null;
      this.healthStatus.sensorActive = false;
    }
  }

  private async acquireData(): Promise<void> {
    try {
      const timestamp = Date.now();
      const rawValue = await this.readSensorRawValue();
      const data: SensorData = {
        timestamp,
        rawValue,
        valid: false,
      };

      this.rawDataBuffer.push(data);
      this.healthStatus.bufferFillLevel = this.rawDataBuffer.length;

      this.preprocessData();
      this.lastAcquisitionTime = timestamp;
      this.healthStatus.dataLatencyMs = Date.now() - timestamp;

      this.enqueueTransmission();

    } catch (error) {
      this.setError(error instanceof Error ? error : new Error(String(error)));
      this.recoverFromError();
    }
  }

  private async readSensorRawValue(): Promise<number> {
    // Placeholder: Replace with actual hardware sensor reading implementation
    // Simulate sensor raw value as random number between 0 and 1000
    return Promise.resolve(Math.random() * 1000);
  }

  private preprocessData(): void {
    while (this.rawDataBuffer.length > 0) {
      const data = this.rawDataBuffer.shift()!;
      // Filtering
      if (this.config.filterConfig?.enabled) {
        data.filteredValue = this.applyFilter(data.rawValue);
      } else {
        data.filteredValue = data.rawValue;
      }
      // Normalization
      if (this.config.normalizationConfig?.enabled && data.filteredValue !== undefined) {
        data.normalizedValue = this.applyNormalization(data.filteredValue);
      } else {
        data.normalizedValue = data.filteredValue;
      }
      // Validation
      data.valid = this.validateData(data.normalizedValue);

      this.processedDataBuffer.push(data);
    }
  }

  private applyFilter(value: number): number {
    if (!this.config.filterConfig) return value;
    switch (this.config.filterConfig.type) {
      case 'movingAverage': {
        const windowSize = this.config.filterConfig.windowSize ?? 5;
        this.filterState.push(value);
        if (this.filterState.length > windowSize) {
          this.filterState.shift();
        }
        const sum = this.filterState.reduce((a, b) => a + b, 0);
        return sum / this.filterState.length;
      }
      case 'lowPass': {
        // Simple RC low pass filter
        const dt = 1 / this.config.samplingRateHz;
        const rc = 1 / (2 * Math.PI * (this.config.filterConfig.cutoffFrequencyHz ?? 1));
        const alpha = dt / (rc + dt);
        const last = this.filterState.length ? this.filterState[this.filterState.length - 1] : value;
        const filtered = last + alpha * (value - last);
        this.filterState.push(filtered);
        if (this.filterState.length > 1) this.filterState.shift();
        return filtered;
      }
      case 'highPass': {
        // Simple RC high pass filter
        if (this.filterState.length < 2) {
          this.filterState = [value, value];
          return value;
        }
        const dt = 1 / this.config.samplingRateHz;
        const rc = 1 / (2 * Math.PI * (this.config.filterConfig.cutoffFrequencyHz ?? 1));
        const alpha = rc / (rc + dt);
        const lastFiltered = this.filterState[1];
        const lastRaw = this.filterState[0];
        const filtered = alpha * (lastFiltered + value - lastRaw);
        this.filterState = [value, filtered];
        return filtered;
      }
      default:
        return value;
    }
  }

  private applyNormalization(value: number): number {
    const normConfig = this.config.normalizationConfig!;
    if (value < normConfig.minValue) return 0;
    if (value > normConfig.maxValue) return 1;
    return (value - normConfig.minValue) / (normConfig.maxValue - normConfig.minValue);
  }

  private validateData(value?: number): boolean {
    if (value === undefined) return false;
    if (!this.config.validationThresholds) return true;
    const { minValidValue, maxValidValue } = this.config.validationThresholds;
    return value >= minValidValue && value <= maxValidValue;
  }

  private enqueueTransmission(): void {
    // Add all valid processed data to transmission queue
    while (this.processedDataBuffer.length > 0) {
      const data = this.processedDataBuffer.shift()!;
      if (data.valid) {
        this.transmissionQueue.push(data);
      }
    }
    this.tryTransmitNext();
  }

  private async tryTransmitNext(): Promise<void> {
    if (this.transmissionInProgress || this.transmissionQueue.length === 0) return;
    this.transmissionInProgress = true;

    const data = this.transmissionQueue[0];
    let retryCount = 0;
    const retryLimit = this.config.transmissionRetryLimit ?? 3;
    const retryInterval = this.config.transmissionRetryIntervalMs ?? 2000;

    while (retryCount <= retryLimit) {
      try {
        await this.transmissionCallback(data);
        this.transmissionQueue.shift();
        break;
      } catch {
        retryCount++;
        if (retryCount > retryLimit) {
          this.setError(new Error('Transmission failure: max retries reached'));
          break;
        }
        await this.delay(retryInterval);
      }
    }
    this.transmissionInProgress = false;
    if (this.transmissionQueue.length > 0) {
      this.tryTransmitNext();
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  calibrate(offset: number, scale: number): void {
    this.config.calibrationConfig = { offset, scale };
    this.healthStatus.isCalibrated = true;
    this.healthStatus.lastCalibrationTimestamp = Date.now();
  }

  getHealthStatus(): HealthStatus {
    return { ...this.healthStatus };
  }

  private setError(error: Error): void {
    this.healthStatus.lastError = error;
  }

  private recoverFromError(): void {
    // Simple recovery: clear buffers, reset filter state and try restart acquisition if stopped
    this.rawDataBuffer = [];
    this.processedDataBuffer = [];
    this.filterState = [];
    if (!this.acquisitionIntervalId) {
      this.start();
    }
  }
}
```