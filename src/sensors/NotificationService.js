```javascript
// src/sensors/NotificationService.js

class NotificationService {
  constructor() {
    this.notificationQueue = [];
    this.notificationHistory = [];
    this.userPreferences = new Map(); 
    this.isProcessing = false;
    this.retryLimit = 3;
  }

  setUserPreferences(userId, preferences) {
    // preferences: { channels: ['inApp', 'push', 'email'], mute: false }
    this.userPreferences.set(userId, preferences);
  }

  getUserPreferences(userId) {
    return this.userPreferences.get(userId) || { channels: ['inApp'], mute: false };
  }

  async sendWarning(message, priority = 1, channels = ['inApp'], userId = 'defaultUser') {
    if (typeof message !== 'string' || message.trim() === '') return;

    const prefs = this.getUserPreferences(userId);
    if (prefs.mute) return;

    const filteredChannels = channels.filter(ch => prefs.channels.includes(ch));
    if (filteredChannels.length === 0) return;

    const notification = {
      id: this._generateId(),
      message,
      priority,
      channels: filteredChannels,
      userId,
      attempts: 0,
      timestamp: Date.now(),
      status: 'pending'
    };
    this.notificationQueue.push(notification);
    this._sortQueue();
    if (!this.isProcessing) {
      this._processQueue();
    }
  }

  getNotificationHistory(userId = null) {
    if (!userId) return [...this.notificationHistory];
    return this.notificationHistory.filter(n => n.userId === userId);
  }

  clearNotifications(userId = null) {
    if (!userId) {
      this.notificationQueue = [];
      this.notificationHistory = [];
      return;
    }
    this.notificationQueue = this.notificationQueue.filter(n => n.userId !== userId);
    this.notificationHistory = this.notificationHistory.filter(n => n.userId !== userId);
  }

  async _processQueue() {
    this.isProcessing = true;
    while (this.notificationQueue.length > 0) {
      const nextNotification = this.notificationQueue.shift();
      nextNotification.status = 'processing';
      let success = await this._deliverNotification(nextNotification);
      if (!success) {
        nextNotification.attempts++;
        if (nextNotification.attempts < this.retryLimit) {
          nextNotification.status = 'pending';
          this.notificationQueue.push(nextNotification);
          this._sortQueue();
        } else {
          nextNotification.status = 'failed';
        }
      } else {
        nextNotification.status = 'delivered';
      }
      this.notificationHistory.push(nextNotification);
    }
    this.isProcessing = false;
  }

  async _deliverNotification(notification) {
    const { message, channels, userId } = notification;

    const results = await Promise.all(
      channels.map(ch => {
        switch (ch) {
          case 'inApp':
            return this._deliverInApp(message, userId);
          case 'push':
            return this._deliverPush(message, userId);
          case 'email':
            return this._deliverEmail(message, userId);
          default:
            return Promise.resolve(false);
        }
      })
    );

    return results.every(Boolean);
  }

  _deliverInApp(message, userId) {
    return new Promise((resolve) => {
      try {
        // Placeholder: Integrate with actual in-app notification UI system
        console.info(`[InApp][User:${userId}] Warning: ${message}`);
        resolve(true);
      } catch {
        resolve(false);
      }
    });
  }

  _deliverPush(message, userId) {
    return new Promise((resolve) => {
      try {
        // Placeholder: Integrate with push notification API
        console.info(`[Push][User:${userId}] Warning: ${message}`);
        resolve(true);
      } catch {
        resolve(false);
      }
    });
  }

  _deliverEmail(message, userId) {
    return new Promise((resolve) => {
      try {
        // Placeholder: Integrate with email sending service
        console.info(`[Email][User:${userId}] Warning: ${message}`);
        resolve(true);
      } catch {
        resolve(false);
      }
    });
  }

  _sortQueue() {
    this.notificationQueue.sort((a, b) => b.priority - a.priority || a.timestamp - b.timestamp);
  }

  _generateId() {
    return `notif_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

const notificationService = new NotificationService();

export const sendWarning = (message, priority, channels, userId) =>
  notificationService.sendWarning(message, priority, channels, userId);

export const getNotificationHistory = (userId) =>
  notificationService.getNotificationHistory(userId);

export const clearNotifications = (userId) =>
  notificationService.clearNotifications(userId);

export default notificationService;
```