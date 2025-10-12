```typescript
import EventEmitter from 'events';

type Channel = 'inApp' | 'push' | 'sms' | 'email';

interface UserPreferences {
  channels: Channel[];
  offlineMode: boolean;
}

interface NotificationPayload {
  userId: string;
  warningCode: string;
  message: string;
  timestamp: number;
}

interface DeliveryStatus {
  channel: Channel;
  success: boolean;
  error?: Error;
  timestamp: number;
  retryCount: number;
}

interface NotificationRecord {
  payload: NotificationPayload;
  deliveryStatus: DeliveryStatus[];
  delivered: boolean;
  confirmedAt?: number;
}

class NotificationDispatcher extends EventEmitter {
  private static readonly MAX_RETRIES = 3;
  private static readonly RETRY_DELAY_MS = 2000;

  private userPreferencesCache: Map<string, UserPreferences> = new Map();

  // Maps userId => notification history (sorted by timestamp desc)
  private notificationHistory: Map<string, NotificationRecord[]> = new Map();

  // Offline queue: userId => Array of notifications to send when back online
  private offlineQueue: Map<string, NotificationPayload[]> = new Map();

  constructor() {
    super();
  }

  async dispatchNotification(payload: NotificationPayload): Promise<void> {
    const prefs = await this.getUserPreferences(payload.userId);
    if (prefs.offlineMode) {
      this.queueOfflineNotification(payload);
      return;
    }

    const record: NotificationRecord = {
      payload,
      deliveryStatus: [],
      delivered: false,
    };

    this.addToHistory(record);

    await Promise.all(
      prefs.channels.map((channel) =>
        this.attemptDeliveryWithRetry(payload, channel, record),
      ),
    );

    record.delivered = record.deliveryStatus.every((ds) => ds.success);
    if (record.delivered) this.emit('delivered', payload.userId, payload.warningCode);
  }

  private async attemptDeliveryWithRetry(
    payload: NotificationPayload,
    channel: Channel,
    record: NotificationRecord,
  ): Promise<void> {
    let retryCount = 0;
    while (retryCount <= NotificationDispatcher.MAX_RETRIES) {
      try {
        await this.deliver(payload, channel);
        record.deliveryStatus.push({
          channel,
          success: true,
          timestamp: Date.now(),
          retryCount,
        });
        return;
      } catch (error) {
        retryCount++;
        record.deliveryStatus.push({
          channel,
          success: false,
          error: error instanceof Error ? error : new Error(String(error)),
          timestamp: Date.now(),
          retryCount,
        });
        if (retryCount > NotificationDispatcher.MAX_RETRIES) return;
        await this.delay(NotificationDispatcher.RETRY_DELAY_MS * retryCount);
      }
    }
  }

  private async deliver(payload: NotificationPayload, channel: Channel): Promise<void> {
    switch (channel) {
      case 'inApp':
        return this.sendInApp(payload);
      case 'push':
        return this.sendPush(payload);
      case 'sms':
        return this.sendSms(payload);
      case 'email':
        return this.sendEmail(payload);
      default:
        throw new Error(`Unsupported channel: ${channel}`);
    }
  }

  private async sendInApp(payload: NotificationPayload): Promise<void> {
    // Simulate async in-app notification delivery
    await Promise.resolve();
  }

  private async sendPush(payload: NotificationPayload): Promise<void> {
    // Simulate async push notification delivery
    await Promise.resolve();
  }

  private async sendSms(payload: NotificationPayload): Promise<void> {
    // Simulate async SMS delivery
    await Promise.resolve();
  }

  private async sendEmail(payload: NotificationPayload): Promise<void> {
    // Simulate async email delivery
    await Promise.resolve();
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private addToHistory(record: NotificationRecord): void {
    const userHistory = this.notificationHistory.get(record.payload.userId) || [];
    userHistory.unshift(record);
    this.notificationHistory.set(record.payload.userId, userHistory);
    if (userHistory.length > 100) userHistory.pop(); // Keep history capped to 100
  }

  confirmDelivery(userId: string, warningCode: string): boolean {
    const userHistory = this.notificationHistory.get(userId);
    if (!userHistory) return false;
    const record = userHistory.find(
      (r) => r.payload.warningCode === warningCode && r.delivered && !r.confirmedAt,
    );
    if (!record) return false;
    record.confirmedAt = Date.now();
    this.emit('confirmed', userId, warningCode);
    return true;
  }

  async getUserPreferences(userId: string): Promise<UserPreferences> {
    const cached = this.userPreferencesCache.get(userId);
    if (cached) return cached;

    // Simulated fetch - replace with DB/external service call
    const preferences: UserPreferences = {
      channels: ['inApp', 'push', 'sms', 'email'],
      offlineMode: false,
    };
    this.userPreferencesCache.set(userId, preferences);
    return preferences;
  }

  private queueOfflineNotification(payload: NotificationPayload): void {
    const queue = this.offlineQueue.get(payload.userId) || [];
    queue.push(payload);
    this.offlineQueue.set(payload.userId, queue);
    this.emit('queuedOffline', payload.userId, payload.warningCode);
  }

  async processOfflineQueue(userId: string): Promise<void> {
    const prefs = await this.getUserPreferences(userId);
    if (prefs.offlineMode) return;

    const queue = this.offlineQueue.get(userId);
    if (!queue || queue.length === 0) return;

    const notifications = [...queue];
    this.offlineQueue.set(userId, []);
    await Promise.all(notifications.map((payload) => this.dispatchNotification(payload)));
    this.emit('offlineQueueProcessed', userId);
  }

  getNotificationHistory(userId: string): NotificationRecord[] {
    return this.notificationHistory.get(userId) || [];
  }
}

export default new NotificationDispatcher();
```