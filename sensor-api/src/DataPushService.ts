```typescript
import { EventEmitter } from "events";

interface SensorData {
  timestamp: number; // Unix ms timestamp
  temperature: number; // Celsius
  humidity: number; // Percentage 0-100
  [key: string]: any;
}

interface ClientInfo {
  id: string;
  pollingRateMs: number; // client requested polling interval
  pushEndpoint: (data: SensorData[]) => Promise<void>;
  lastPushedTimestamp?: number;
  retryCount: number;
  maxRetries: number;
}

interface Metrics {
  totalPushes: number;
  successfulPushes: number;
  failedPushes: number;
  avgPushDurationMs: number;
  staleDataSkips: number;
  currentBatchSize: number;
  lastPushTimestamp?: number;
}

export class DataPushService extends EventEmitter {
  private clients = new Map<string, ClientInfo>();
  private dataSourceIntervalMs: number;
  private latestData: SensorData | null = null;
  private staleThresholdMs: number;
  private pushTimer?: NodeJS.Timeout;
  private metrics: Metrics;
  private pushing: boolean = false;

  constructor(
    dataSourceIntervalMs = 1000,
    staleThresholdMs = 5000 // data older than 5s is stale
  ) {
    super();
    this.dataSourceIntervalMs = dataSourceIntervalMs;
    this.staleThresholdMs = staleThresholdMs;
    this.metrics = {
      totalPushes: 0,
      successfulPushes: 0,
      failedPushes: 0,
      avgPushDurationMs: 0,
      staleDataSkips: 0,
      currentBatchSize: 0,
    };
    this.initDataSource();
  }

  private initDataSource() {
    setInterval(async () => {
      const data = await this.getSensorData();
      if (this.validateData(data)) {
        this.latestData = data;
        this.emit("data", data);
      }
    }, this.dataSourceIntervalMs);
  }

  // Example mock sensor data source - replace with real sensor integration
  private async getSensorData(): Promise<SensorData> {
    const timestamp = Date.now();
    return {
      timestamp,
      temperature: 15 + 10 * Math.sin(timestamp / 60000), // simulate temp oscillation
      humidity: 40 + 20 * Math.cos(timestamp / 40000), // simulate humidity oscillation
    };
  }

  private validateData(data: SensorData): boolean {
    if (!data || typeof data.timestamp !== "number") return false;
    if (
      typeof data.temperature !== "number" ||
      data.temperature < -50 ||
      data.temperature > 100
    )
      return false;
    if (
      typeof data.humidity !== "number" ||
      data.humidity < 0 ||
      data.humidity > 100
    )
      return false;
    return true;
  }

  registerClient(
    id: string,
    pollingRateMs: number,
    pushEndpoint: (data: SensorData[]) => Promise<void>,
    maxRetries = 3
  ) {
    if (this.clients.has(id)) {
      const c = this.clients.get(id)!;
      c.pollingRateMs = pollingRateMs;
      c.pushEndpoint = pushEndpoint;
      c.maxRetries = maxRetries;
      c.retryCount = 0;
      return;
    }
    this.clients.set(id, {
      id,
      pollingRateMs,
      pushEndpoint,
      retryCount: 0,
      maxRetries,
    });
    this.schedulePushes();
  }

  unregisterClient(id: string) {
    this.clients.delete(id);
  }

  private schedulePushes() {
    if (this.pushTimer) {
      clearTimeout(this.pushTimer);
    }
    if (this.clients.size === 0) {
      return;
    }
    // Compute next push time as min client next push interval remaining
    const now = Date.now();
    let nextPushIn = Infinity;
    for (const client of this.clients.values()) {
      const last = client.lastPushedTimestamp ?? 0;
      const elapsed = now - last;
      const wait = Math.max(client.pollingRateMs - elapsed, 0);
      if (wait < nextPushIn) nextPushIn = wait;
    }
    this.pushTimer = setTimeout(() => this.pushDataToClients(), nextPushIn);
  }

  private async pushDataToClients() {
    if (this.pushing) return; // prevent overlapping pushes
    if (!this.latestData) {
      this.metrics.staleDataSkips++;
      this.schedulePushes();
      return;
    }
    const now = Date.now();
    const dataAge = now - this.latestData.timestamp;
    if (dataAge > this.staleThresholdMs) {
      this.metrics.staleDataSkips++;
      this.schedulePushes();
      return;
    }
    this.pushing = true;

    try {
      const clientsToPush: ClientInfo[] = [];
      for (const client of this.clients.values()) {
        const last = client.lastPushedTimestamp ?? 0;
        if (now - last >= client.pollingRateMs || last === 0) {
          clientsToPush.push(client);
        }
      }

      if (clientsToPush.length === 0) {
        this.schedulePushes();
        this.pushing = false;
        return;
      }

      this.metrics.currentBatchSize = clientsToPush.length;
      this.metrics.totalPushes += clientsToPush.length;

      // Batch clients by identical push endpoint function to optimize calls
      const endpointMap = new Map<
        (data: SensorData[]) => Promise<void>,
        ClientInfo[]
      >();

      for (const client of clientsToPush) {
        const arr = endpointMap.get(client.pushEndpoint) ?? [];
        arr.push(client);
        endpointMap.set(client.pushEndpoint, arr);
      }

      const pushStart = Date.now();
      // Push data concurrently grouped by endpoint
      await Promise.all(
        Array.from(endpointMap.entries()).map(async ([endpoint, clients]) => {
          try {
            // Push single array batch for all clients using this endpoint
            await endpoint([this.latestData]);
            // On success update clients
            for (const c of clients) {
              c.lastPushedTimestamp = now;
              c.retryCount = 0;
              this.metrics.successfulPushes++;
            }
          } catch {
            // On failure handle retries individually
            for (const c of clients) {
              c.retryCount++;
              this.metrics.failedPushes++;
              if (c.retryCount <= c.maxRetries) {
                // schedule retry with exponential backoff
                setTimeout(() => {
                  this.pushSingleClient(c, [this.latestData]);
                }, 1000 * 2 ** (c.retryCount - 1));
              }
            }
          }
        })
      );
      const pushEnd = Date.now();
      const duration = pushEnd - pushStart;

      // Update average push duration (EMA ~ alpha=0.2)
      this.metrics.avgPushDurationMs =
        this.metrics.avgPushDurationMs * 0.8 + duration * 0.2;

      this.metrics.lastPushTimestamp = now;
    } finally {
      this.pushing = false;
      this.schedulePushes();
    }
  }

  private async pushSingleClient(client: ClientInfo, data: SensorData[]) {
    try {
      await client.pushEndpoint(data);
      client.lastPushedTimestamp = Date.now();
      client.retryCount = 0;
      this.metrics.successfulPushes++;
    } catch {
      client.retryCount++;
      this.metrics.failedPushes++;
      if (client.retryCount <= client.maxRetries) {
        setTimeout(() => {
          this.pushSingleClient(client, data);
        }, 1000 * 2 ** (client.retryCount - 1));
      }
    }
  }

  getMetrics(): Metrics {
    return { ...this.metrics };
  }
}
```