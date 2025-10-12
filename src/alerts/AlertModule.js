```javascript
class AlertModule {
  static Severity = Object.freeze({
    INFO: 'INFO',
    WARNING: 'WARNING',
    CRITICAL: 'CRITICAL',
  });

  constructor({
    thresholds = {},
    maxRetryAttempts = 3,
    retryDelayMs = 1000,
  } = {}) {
    this.thresholds = thresholds;
    this.maxRetryAttempts = maxRetryAttempts;
    this.retryDelayMs = retryDelayMs;

    this.alertQueue = [];
    this.isProcessing = false;
  }

  checkSensorReading(sensorId, reading) {
    try {
      if (!this.thresholds[sensorId]) {
        console.warn(`No thresholds configured for sensor: ${sensorId}`);
        return null;
      }

      const { min, max, severityOnBreach } = this.thresholds[sensorId];
      if (reading < min) {
        return this._createAlert(
          sensorId,
          `Value ${reading} below minimum threshold ${min}`,
          severityOnBreach.min || AlertModule.Severity.WARNING
        );
      }

      if (reading > max) {
        return this._createAlert(
          sensorId,
          `Value ${reading} above maximum threshold ${max}`,
          severityOnBreach.max || AlertModule.Severity.WARNING
        );
      }

      return null;
    } catch (error) {
      console.error('Error checking sensor reading', error);
      return null;
    }
  }

  checkDataFreshness(sensorId, lastUpdateTimestamp, staleThresholdMs) {
    try {
      const now = Date.now();
      if (now - lastUpdateTimestamp > staleThresholdMs) {
        return this._createAlert(
          sensorId,
          `Sensor data outdated by ${now - lastUpdateTimestamp} ms`,
          AlertModule.Severity.WARNING
        );
      }
      return null;
    } catch (error) {
      console.error('Error checking data freshness', error);
      return null;
    }
  }

  triggerAlert(alert) {
    if (!alert || !alert.sensorId || !alert.message || !alert.severity) {
      console.error('Invalid alert object:', alert);
      return;
    }

    this.alertQueue.push({
      ...alert,
      attempts: 0,
      timestamp: Date.now(),
    });

    if (!this.isProcessing) {
      this._processQueue();
    }
  }

  async _processQueue() {
    this.isProcessing = true;

    while (this.alertQueue.length > 0) {
      const alert = this.alertQueue[0];

      try {
        await this._sendNotification(alert);
        this.alertQueue.shift(); // Remove alert on success
      } catch (error) {
        alert.attempts += 1;
        console.warn(
          `Notification failed for alert on sensor ${alert.sensorId}, attempt ${alert.attempts}`,
          error
        );

        if (alert.attempts >= this.maxRetryAttempts) {
          console.error(
            `Max retry attempts reached for alert on sensor ${alert.sensorId}. Dropping alert.`
          );
          this.alertQueue.shift(); // Drop alert after max attempts
        } else {
          await this._delay(this.retryDelayMs);
        }
      }
    }

    this.isProcessing = false;
  }

  _createAlert(sensorId, message, severity) {
    return {
      sensorId,
      message,
      severity,
      timestamp: Date.now(),
    };
  }

  async _sendNotification(alert) {
    // Simulate asynchronous notification sending.
    // Replace with actual implementation to clinician dashboard.

    // For demo: Randomly fail to test retry logic
    return new Promise((resolve, reject) => {
      // Simulated network delay
      setTimeout(() => {
        if (Math.random() < 0.85) {
          console.info(
            `[Alert][${alert.severity}][Sensor: ${alert.sensorId}] ${alert.message}`
          );
          resolve();
        } else {
          reject(new Error('Simulated notification failure'));
        }
      }, 200);
    });
  }

  _delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

export default AlertModule;
```