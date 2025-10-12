```typescript
import type { PerformanceEntry } from 'perf_hooks';

type TimingMetric = {
  name: string;
  startTime: number;
  duration: number;
};

type PerformanceReport = {
  timestamp: number;
  averageLatency: number;
  maxLatency: number;
  minLatency: number;
  slowWarningsCount: number;
  thresholdViolated: boolean;
};

type AlertCallback = (report: PerformanceReport) => void;

export interface ITimelinessMonitorOptions {
  latencyThresholdMs: number;
  sampleWindowSize: number;
  alertCallback?: AlertCallback;
}

/**
 * TimelinessMonitor monitors the end-to-end latency of the warning system,
 * collecting performance metrics, detecting threshold violations,
 * identifying slow warnings, reporting performance, and alerting on degraded performance.
 */
export class TimelinessMonitor {
  private latencyThresholdMs: number;
  private sampleWindowSize: number;
  private samples: number[];
  private slowWarningsCount: number;
  private alertCallback?: AlertCallback;

  constructor(options: ITimelinessMonitorOptions) {
    this.latencyThresholdMs = options.latencyThresholdMs;
    this.sampleWindowSize = options.sampleWindowSize;
    this.samples = [];
    this.slowWarningsCount = 0;
    this.alertCallback = options.alertCallback;
  }

  /**
   * Record a latency measurement in milliseconds.
   * @param latencyMs End-to-end latency for a warning operation
   */
  recordLatency(latencyMs: number): void {
    if (latencyMs < 0) return;

    this.samples.push(latencyMs);
    if (latencyMs > this.latencyThresholdMs) {
      this.slowWarningsCount++;
    }

    if (this.samples.length > this.sampleWindowSize) {
      const removed = this.samples.shift();
      if (removed !== undefined && removed > this.latencyThresholdMs) {
        this.slowWarningsCount--;
      }
    }
  }

  /**
   * Analyze collected latencies and generate a performance report.
   */
  generateReport(): PerformanceReport {
    if (this.samples.length === 0) {
      return {
        timestamp: Date.now(),
        averageLatency: 0,
        maxLatency: 0,
        minLatency: 0,
        slowWarningsCount: 0,
        thresholdViolated: false,
      };
    }

    let sum = 0;
    let max = -Infinity;
    let min = Infinity;

    for (const latency of this.samples) {
      sum += latency;
      if (latency > max) max = latency;
      if (latency < min) min = latency;
    }

    const avg = sum / this.samples.length;
    const thresholdViolated = this.slowWarningsCount > 0;

    const report: PerformanceReport = {
      timestamp: Date.now(),
      averageLatency: avg,
      maxLatency: max,
      minLatency: min,
      slowWarningsCount: this.slowWarningsCount,
      thresholdViolated,
    };

    return report;
  }

  /**
   * Check performance and trigger alert if degraded performance detected.
   */
  checkAndAlert(): void {
    if (!this.alertCallback) return;

    const report = this.generateReport();

    if (report.thresholdViolated) {
      this.alertCallback(report);
    }
  }

  /**
   * Extract and record latency based on browser performance timing APIs.
   * Suitable for browser environments.
   * @param warningStartMarkName User-defined start mark name for warning start event.
   * @param warningEndMarkName User-defined end mark name for warning completion event.
   */
  recordLatencyFromPerformanceMarks(warningStartMarkName: string, warningEndMarkName: string): void {
    if (typeof performance === 'undefined' || !performance.getEntriesByName) return;

    const startMarks = performance.getEntriesByName(warningStartMarkName);
    const endMarks = performance.getEntriesByName(warningEndMarkName);
    if (startMarks.length === 0 || endMarks.length === 0) return;

    // Consider the last recorded marks
    const startMark = startMarks[startMarks.length - 1];
    const endMark = endMarks[endMarks.length - 1];

    const latency = endMark.startTime - startMark.startTime;

    this.recordLatency(latency);
  }
}
```