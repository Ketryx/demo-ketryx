```javascript
import EventEmitter from 'events';

const POLLING_INTERVAL = 10000;
const MAX_RETRY_ATTEMPTS = 5;
const RETRY_BASE_DELAY_MS = 2000;

class AlertDispatcher extends EventEmitter {
  constructor({ websocketUrl, emailService, smsService, uiService }) {
    super();
    this.websocketUrl = websocketUrl;
    this.emailService = emailService;
    this.smsService = smsService;
    this.uiService = uiService;

    this.ws = null;
    this.pollingTimer = null;
    this.alertQueue = [];
    this.isConnected = false;
    this.retryCounts = new Map();

    this._connectWebSocket();
  }

  _connectWebSocket() {
    if (this.ws) {
      this.ws.removeAllListeners();
      this.ws.close();
      this.ws = null;
    }

    try {
      this.ws = new WebSocket(this.websocketUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.emit('connection:open');
        if (this.pollingTimer) {
          clearInterval(this.pollingTimer);
          this.pollingTimer = null;
        }
        this._flushQueue();
      };

      this.ws.onmessage = (event) => {
        let alert;
        try {
          alert = JSON.parse(event.data);
          this._handleIncomingAlert(alert);
        } catch (e) {
          this.emit('error', new Error(`Malformed alert data: ${e.message}`));
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.emit('connection:closed');
        this._startPolling();
      };

      this.ws.onerror = (err) => {
        this.emit('error', new Error(`WebSocket error: ${err.message || err}`));
        this.ws.close();
      };
    } catch (err) {
      this.isConnected = false;
      this.emit('error', new Error(`WebSocket connection failed: ${err.message}`));
      this._startPolling();
    }
  }

  _startPolling() {
    if (this.pollingTimer) return;
    this.pollingTimer = setInterval(() => this._pollAlerts(), POLLING_INTERVAL);
  }

  async _pollAlerts() {
    try {
      // Polling endpoint should be replaced with actual alert API URL
      const response = await fetch('/api/alerts/poll');
      if (!response.ok) throw new Error(`Polling failed: ${response.statusText}`);
      const alerts = await response.json();
      if (Array.isArray(alerts)) {
        alerts.forEach(alert => this._handleIncomingAlert(alert));
      }
    } catch (err) {
      this.emit('error', new Error(`Polling error: ${err.message}`));
      if (!this.isConnected) {
        this._connectWebSocket();
      }
    }
  }

  _handleIncomingAlert(alert) {
    this.emit('alert:received', alert);
    if (this._isOffline()) {
      this.alertQueue.push(alert);
      return;
    }
    this._dispatchAlert(alert).catch(() => {
      this._enqueueForRetry(alert);
    });
  }

  async _dispatchAlert(alert) {
    try {
      await Promise.all([
        this.uiService.displayAlert(alert),
        this._conditionallySendCritical(alert)
      ]);

      this.emit('alert:delivered', alert);
      this._clearRetry(alert.id);
    } catch (err) {
      this.emit('error', new Error(`Dispatch failure for alert ${alert.id}: ${err.message}`));
      throw err;
    }
  }

  async _conditionallySendCritical(alert) {
    if (alert.level && alert.level.toLowerCase() === 'critical') {
      const promises = [];
      if (this.emailService) promises.push(this.emailService.sendEmail(alert));
      if (this.smsService) promises.push(this.smsService.sendSms(alert));
      await Promise.all(promises);
    }
  }

  _enqueueForRetry(alert) {
    this.alertQueue.push(alert);
    const currentRetries = this.retryCounts.get(alert.id) || 0;
    if (currentRetries < MAX_RETRY_ATTEMPTS) {
      this.retryCounts.set(alert.id, currentRetries + 1);
      setTimeout(() => this._retryAlert(alert), this._getRetryDelay(currentRetries));
    } else {
      this.emit('alert:failed', alert);
      this._clearRetry(alert.id);
      this._removeFromQueue(alert.id);
    }
  }

  _retryAlert(alert) {
    // Only retry if alert still in queue
    const queued = this.alertQueue.find(a => a.id === alert.id);
    if (!queued) return;

    this._dispatchAlert(alert).then(() => {
      this._removeFromQueue(alert.id);
    }).catch(() => {
      // Failed again, will be retried again by _enqueueForRetry on next failure
    });
  }

  _flushQueue() {
    if (this.alertQueue.length === 0) return;
    const queueCopy = [...this.alertQueue];
    this.alertQueue.length = 0;
    queueCopy.forEach(alert => this._dispatchAlert(alert).catch(() => this._enqueueForRetry(alert)));
  }

  _removeFromQueue(alertId) {
    const idx = this.alertQueue.findIndex(a => a.id === alertId);
    if (idx !== -1) this.alertQueue.splice(idx, 1);
    this._clearRetry(alertId);
  }

  _clearRetry(alertId) {
    this.retryCounts.delete(alertId);
  }

  _getRetryDelay(retryCount) {
    return RETRY_BASE_DELAY_MS * Math.pow(2, retryCount);
  }

  _isOffline() {
    return !this.isConnected;
  }

  sendAlert(alert) {
    if (!alert || !alert.id) throw new Error('Alert must have an id');

    if (this._isOffline()) {
      this.alertQueue.push(alert);
      return Promise.resolve();
    }
    return this._dispatchAlert(alert).catch(() => this._enqueueForRetry(alert));
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
    }
    this.alertQueue.length = 0;
    this.retryCounts.clear();
    this.removeAllListeners();
  }
}

export default AlertDispatcher;
```