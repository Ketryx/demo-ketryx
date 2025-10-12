```javascript
class DataFreshnessMonitor {
  /**
   * @param {Object} options
   * @param {Object<string, number>} options.maxIntervals - Maximum allowable interval in ms per data type
   * @param {number} options.checkInterval - Interval in ms for periodic freshness checks
   * @param {number} options.gracePeriod - Grace period in ms after max interval before alerting
   * @param {(dataType: string, lastUpdate: number, age: number) => void} options.alertHandler - Callback when stale data detected
   * @param {number} options.cleanupInterval - Interval in ms for cleaning old records
   * @param {number} options.recordTTL - Time in ms after which records are considered stale and cleanup runs
   */
  constructor({
    maxIntervals = {},
    checkInterval = 60000,
    gracePeriod = 10000,
    alertHandler = () => {},
    cleanupInterval = 3600000,
    recordTTL = 86400000,
  } = {}) {
    this.maxIntervals = maxIntervals;
    this.checkInterval = checkInterval;
    this.gracePeriod = gracePeriod;
    this.alertHandler = alertHandler;
    this.cleanupInterval = cleanupInterval;
    this.recordTTL = recordTTL;

    /** 
     * @type {Map<string, {timestamp: number, lastChecked: number}>} 
     * Stores latest timestamp per data type
     */
    this.records = new Map();

    this._freshnessTimer = null;
    this._cleanupTimer = null;
  }

  /**
   * Update or set last reading timestamp for a given data type
   * @param {string} dataType 
   * @param {number} timestamp Unix ms
   */
  updateTimestamp(dataType, timestamp) {
    this.records.set(dataType, { timestamp, lastChecked: Date.now() });
  }

  /**
   * Check if the given reading timestamp for a data type is fresh
   * @param {string} dataType 
   * @param {number} readingTimestamp Unix ms
   * @returns {Promise<boolean>} resolves to true if fresh, false if stale
   */
  async checkLastUpdateTime(dataType, readingTimestamp) {
    const now = Date.now();
    const maxInterval = this.maxIntervals[dataType];
    if (typeof maxInterval !== 'number') {
      // No configured max interval means always fresh
      return true;
    }
    const age = now - readingTimestamp;
    if (age <= maxInterval) {
      // Data within allowable range
      return true;
    }
    if (age <= maxInterval + this.gracePeriod) {
      // Within grace period - consider fresh but may warn
      return true;
    }

    // Stale data beyond grace period - alert
    await this._generateAlert(dataType, readingTimestamp, age);
    return false;
  }

  async _generateAlert(dataType, readingTimestamp, age) {
    try {
      await this.alertHandler(dataType, readingTimestamp, age);
    } catch {
      // Suppress errors from alert handler
    }
  }

  /**
   * Starts automatic periodic freshness monitoring
   */
  start() {
    if (!this._freshnessTimer) {
      this._freshnessTimer = setInterval(() => this._performFreshnessCheck(), this.checkInterval);
    }
    if (!this._cleanupTimer) {
      this._cleanupTimer = setInterval(() => this._cleanupOldRecords(), this.cleanupInterval);
    }
  }

  /**
   * Stops automatic periodic freshness monitoring
   */
  stop() {
    if (this._freshnessTimer) {
      clearInterval(this._freshnessTimer);
      this._freshnessTimer = null;
    }
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer);
      this._cleanupTimer = null;
    }
  }

  async _performFreshnessCheck() {
    const now = Date.now();
    const promises = [];
    for (const [dataType, { timestamp, lastChecked }] of this.records.entries()) {
      const maxInterval = this.maxIntervals[dataType];
      if (typeof maxInterval !== 'number') {
        continue;
      }
      const age = now - timestamp;
      if (age > maxInterval + this.gracePeriod) {
        // Only alert if not checked recently to avoid alert flooding
        if (now - lastChecked > this.checkInterval) {
          this.records.set(dataType, { timestamp, lastChecked: now });
          promises.push(this._generateAlert(dataType, timestamp, age));
        }
      } else {
        this.records.set(dataType, { timestamp, lastChecked: now });
      }
    }
    await Promise.all(promises);
  }

  _cleanupOldRecords() {
    const now = Date.now();
    for (const [dataType, { timestamp }] of this.records.entries()) {
      if (now - timestamp > this.recordTTL) {
        this.records.delete(dataType);
      }
    }
  }
}

export default DataFreshnessMonitor;
```