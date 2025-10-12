```javascript
import EventEmitter from 'events';

class SensorReadingWarning {
  #upperThreshold = null;
  #lowerThreshold = null;
  #maxAge = null;
  #emitter = new EventEmitter();

  setThresholds(upper, lower) {
    if (typeof upper !== 'number' || typeof lower !== 'number') {
      throw new TypeError('Thresholds must be numbers');
    }
    if (lower > upper) {
      throw new RangeError('Lower threshold cannot be greater than upper threshold');
    }
    this.#upperThreshold = upper;
    this.#lowerThreshold = lower;
  }

  setMaxAge(milliseconds) {
    if (typeof milliseconds !== 'number' || milliseconds < 0) {
      throw new TypeError('Max age must be a non-negative number');
    }
    this.#maxAge = milliseconds;
  }

  onWarning(callback) {
    if (typeof callback !== 'function') {
      throw new TypeError('Callback must be a function');
    }
    this.#emitter.on('warning', callback);
  }

  checkReading(value, timestamp) {
    try {
      if (typeof value !== 'number') {
        throw new TypeError('Reading value must be a number');
      }
      if (!(timestamp instanceof Date) || isNaN(timestamp)) {
        throw new TypeError('Timestamp must be a valid Date object');
      }

      const now = Date.now();
      const readingTime = timestamp.getTime();

      // Staleness check
      if (this.#maxAge !== null && (now - readingTime) > this.#maxAge) {
        this.#emitWarning({
          type: 'stale',
          message: `Reading is stale (age: ${now - readingTime}ms, max: ${this.#maxAge}ms)`,
          value,
          timestamp
        });
        return;
      }

      // Threshold checks
      if (this.#upperThreshold !== null && value > this.#upperThreshold) {
        this.#emitWarning({
          type: 'threshold',
          message: `Reading exceeds upper threshold (${value} > ${this.#upperThreshold})`,
          value,
          timestamp
        });
        return;
      }

      if (this.#lowerThreshold !== null && value < this.#lowerThreshold) {
        this.#emitWarning({
          type: 'threshold',
          message: `Reading below lower threshold (${value} < ${this.#lowerThreshold})`,
          value,
          timestamp
        });
        return;
      }
    } catch (error) {
      this.#logError(error);
    }
  }

  #emitWarning(details) {
    this.#emitter.emit('warning', details);
  }

  #logError(error) {
    // Extend or replace with a proper logging solution if needed
    console.error('[SensorReadingWarning] Error:', error);
  }
}

export default SensorReadingWarning;
```