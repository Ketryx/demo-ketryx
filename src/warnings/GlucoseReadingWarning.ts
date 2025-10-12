```typescript
type GlucoseReading = {
  timestamp: number; // Unix ms timestamp
  value: number; // mg/dL or mmol/L, depending on usage context
};

type WarningLevel = 'none' | 'info' | 'warning' | 'critical';

interface Warning {
  level: WarningLevel;
  message: string;
  readingTimestamp?: number;
  agedByMs?: number;
}

export class GlucoseReadingWarning {
  private maxAgeMs: number;
  private escalationThresholdsMs: { info: number; warning: number; critical: number };
  private readingsHistory: GlucoseReading[];
  private latestTimestamp: number | null;

  constructor(
    maxAgeMinutes: number = 10,
    escalationThresholdsMinutes: { info: number; warning: number; critical: number } = {
      info: 5,
      warning: 10,
      critical: 15,
    }
  ) {
    this.maxAgeMs = maxAgeMinutes * 60 * 1000;
    this.escalationThresholdsMs = {
      info: escalationThresholdsMinutes.info * 60 * 1000,
      warning: escalationThresholdsMinutes.warning * 60 * 1000,
      critical: escalationThresholdsMinutes.critical * 60 * 1000,
    };
    this.readingsHistory = [];
    this.latestTimestamp = null;
  }

  addReading(reading: GlucoseReading): void {
    if (typeof reading.timestamp !== 'number' || Number.isNaN(reading.timestamp)) return;
    if (typeof reading.value !== 'number' || Number.isNaN(reading.value)) return;

    this.latestTimestamp = !this.latestTimestamp || reading.timestamp > this.latestTimestamp ? reading.timestamp : this.latestTimestamp;
    this.readingsHistory.push(reading);
    // Prune history older than maxAgeMs * 3 to keep size manageable
    const threshold = Date.now() - this.maxAgeMs * 3;
    this.readingsHistory = this.readingsHistory.filter(r => r.timestamp >= threshold);
  }

  getLatestReading(): GlucoseReading | null {
    if (!this.latestTimestamp) return null;
    return this.readingsHistory.reduce((latest, r) => (r.timestamp === this.latestTimestamp ? r : latest), null as GlucoseReading | null);
  }

  checkStaleness(currentTime: number = Date.now()): Warning {
    if (!this.latestTimestamp) {
      return {
        level: 'critical',
        message: 'No glucose readings have been received.',
      };
    }

    const ageMs = currentTime - this.latestTimestamp;

    if (ageMs < this.escalationThresholdsMs.info) {
      return { level: 'none', message: 'Glucose readings are current.', readingTimestamp: this.latestTimestamp, agedByMs: ageMs };
    }

    if (ageMs < this.escalationThresholdsMs.warning) {
      return {
        level: 'info',
        message: `Glucose reading is slightly stale (last received ${(ageMs / 60000).toFixed(1)} minutes ago).`,
        readingTimestamp: this.latestTimestamp,
        agedByMs: ageMs,
      };
    }

    if (ageMs < this.escalationThresholdsMs.critical) {
      return {
        level: 'warning',
        message: `Glucose reading is stale (last received ${(ageMs / 60000).toFixed(1)} minutes ago). Consider checking your device connection.`,
        readingTimestamp: this.latestTimestamp,
        agedByMs: ageMs,
      };
    }

    return {
      level: 'critical',
      message: `Glucose reading is critically outdated (last received ${(ageMs / 60000).toFixed(1)} minutes ago). Immediate action required!`,
      readingTimestamp: this.latestTimestamp,
      agedByMs: ageMs,
    };
  }

  getReadingHistory(sinceMs: number = Date.now() - this.maxAgeMs * 3): GlucoseReading[] {
    return this.readingsHistory.filter(r => r.timestamp >= sinceMs);
  }
}
```