```javascript
import EventEmitter from 'events';

class DashboardNotificationService extends EventEmitter {
  constructor({ websocketServer, pushNotificationService, auditLogger }) {
    super();
    this.websocketServer = websocketServer;
    this.pushNotificationService = pushNotificationService;
    this.auditLogger = auditLogger;
    this.subscribers = new Map(); // clinicianId -> { ws: WebSocket, pushToken: String }
    this.acknowledgments = new Map(); // notificationId -> Set of clinicianIds acknowledged
  }

  subscribeClinician(clinicianId, { ws = null, pushToken = null }) {
    this.subscribers.set(clinicianId, { ws, pushToken });
    this.emit('subscribe', { clinicianId });
  }

  unsubscribeClinician(clinicianId) {
    this.subscribers.delete(clinicianId);
    this.emit('unsubscribe', { clinicianId });
  }

  /**
   * Create formatted notification message and metadata
   * @param {Object} notification
   * @param {string} notification.id
   * @param {string} notification.clinicianId
   * @param {string} notification.type
   * @param {Object} notification.data
   * @param {string} notification.priority ('low'|'medium'|'high'|'critical')
   * @returns {{message: string, metadata: Object}}
   */
  formatNotification({ type, data, priority }) {
    let message;
    switch (type) {
      case 'lab_result':
        message = `Lab result for patient ${data.patientName}: ${data.testName} is ${data.result}.`;
        break;
      case 'medication_alert':
        message = `Medication alert: ${data.medicationName} for patient ${data.patientName} requires attention.`;
        break;
      case 'appointment_reminder':
        message = `Appointment reminder: Patient ${data.patientName} has an appointment on ${data.date}.`;
        break;
      case 'system_alert':
        message = `System alert: ${data.message}`;
        break;
      default:
        message = data.message || 'You have a new notification.';
    }
    return {
      message,
      metadata: {
        priority,
        timestamp: new Date().toISOString(),
        type,
      },
    };
  }

  /**
   * Send notification to clinician dashboard via multiple delivery channels
   * with priority-based routing, fallback, acknowledgment tracking and audit logging.
   * @param {Object} notification
   * @param {string} notification.id Unique notification ID
   * @param {string} notification.clinicianId
   * @param {string} notification.type
   * @param {Object} notification.data
   * @param {string} notification.priority ('low'|'medium'|'high'|'critical')
   * @returns {Promise<void>}
   */
  async sendNotification(notification) {
    const { id, clinicianId, priority } = notification;
    if (!this.subscribers.has(clinicianId)) {
      await this._logAudit({ notification, status: 'failed', reason: 'Clinician not subscribed' });
      return;
    }
    const subscriber = this.subscribers.get(clinicianId);
    const { message, metadata } = this.formatNotification(notification);

    const payload = {
      id,
      message,
      metadata,
    };

    let delivered = false;
    const deliveryAttempts = [];

    // Priority-based routing logic (for example: critical -> all channels)
    // Adjust channel preference by priority
    const channelPreference = this._getChannelPreference(priority);

    for (const channel of channelPreference) {
      try {
        if (channel === 'websocket' && subscriber.ws) {
          if (subscriber.ws.readyState === subscriber.ws.OPEN) {
            subscriber.ws.send(JSON.stringify(payload));
            deliveryAttempts.push({ channel, status: 'success' });
            delivered = true;
            if (priority !== 'critical') break; // non-critical: stop after first success
          } else {
            deliveryAttempts.push({ channel, status: 'failed', reason: 'WS not open' });
          }
        } else if (channel === 'push' && subscriber.pushToken) {
          const pushResult = await this.pushNotificationService.send(subscriber.pushToken, {
            title: 'Clinician Dashboard Alert',
            body: message,
            data: metadata,
          });
          if (pushResult.success) {
            deliveryAttempts.push({ channel, status: 'success' });
            delivered = true;
            if (priority !== 'critical') break;
          } else {
            deliveryAttempts.push({ channel, status: 'failed', reason: 'Push send failed' });
          }
        }
      } catch (err) {
        deliveryAttempts.push({ channel, status: 'failed', reason: err.message });
      }
    }

    if (!delivered) {
      deliveryAttempts.push({ channel: 'none', status: 'failed', reason: 'No delivery channels succeeded' });
    }

    await this._logAudit({ notification, status: delivered ? 'delivered' : 'failed', deliveryAttempts });

    this.emit('notification_sent', { notification, delivered, deliveryAttempts });
  }

  acknowledgeNotification(clinicianId, notificationId) {
    if (!this.acknowledgments.has(notificationId)) {
      this.acknowledgments.set(notificationId, new Set());
    }
    this.acknowledgments.get(notificationId).add(clinicianId);
    this.emit('notification_acknowledged', { clinicianId, notificationId });
  }

  isAcknowledged(clinicianId, notificationId) {
    return this.acknowledgments.has(notificationId) &&
      this.acknowledgments.get(notificationId).has(clinicianId);
  }

  _getChannelPreference(priority) {
    // Example routing:
    // critical: websocket + push both always sent
    // high: websocket first, fallback push
    // medium: websocket only
    // low: push only

    switch (priority) {
      case 'critical':
        return ['websocket', 'push'];
      case 'high':
        return ['websocket', 'push'];
      case 'medium':
        return ['websocket'];
      case 'low':
      default:
        return ['push'];
    }
  }

  async _logAudit({ notification, status, deliveryAttempts = [], reason = '' }) {
    if (!this.auditLogger) return;

    const auditRecord = {
      notificationId: notification.id,
      clinicianId: notification.clinicianId,
      type: notification.type,
      priority: notification.priority,
      timestamp: new Date().toISOString(),
      status,
      reason,
      deliveryAttempts,
      message: notification.data.message || '',
    };

    try {
      await this.auditLogger.log(auditRecord);
    } catch {
      // audit logging failure should not block main flow
    }
  }
}

export default DashboardNotificationService;
```