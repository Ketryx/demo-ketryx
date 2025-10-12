```javascript
class SensorThresholdValidator {
  #thresholds;
  #alertDelays;
  #violationTimers;

  /**
   * @param {Object} config Configuration object
   * Example:
   * {
   *   thresholds: {
   *     temperature: { lower: 0, upper: 50 },
   *     humidity: { lower: 20, upper: 80 },
   *   },
   *   alertDelays: {
   *     temperature: 5000, // ms
   *     humidity: 3000,
   *   }
   * }
   */
  constructor(config = {}) {
    if (
      !config.thresholds ||
      typeof config.thresholds !== "object" ||
      Array.isArray(config.thresholds)
    ) {
      throw new TypeError("Config must have a 'thresholds' object.");
    }

    this.#thresholds = {};
    this.#alertDelays = {};
    this.#violationTimers = new Map();

    for (const [sensorType, limits] of Object.entries(config.thresholds)) {
      if (
        !limits ||
        typeof limits !== "object" ||
        typeof limits.lower !== "number" ||
        typeof limits.upper !== "number" ||
        limits.lower >= limits.upper
      ) {
        throw new TypeError(
          `Thresholds for sensor '${sensorType}' must have valid 'lower' and 'upper' number limits where lower < upper.`
        );
      }
      this.#thresholds[sensorType] = { lower: limits.lower, upper: limits.upper };
    }

    if (config.alertDelays) {
      if (
        typeof config.alertDelays !== "object" ||
        Array.isArray(config.alertDelays)
      ) {
        throw new TypeError("'alertDelays' must be an object if provided.");
      }

      for (const [sensorType, delayMs] of Object.entries(config.alertDelays)) {
        if (typeof delayMs !== "number" || delayMs < 0) {
          throw new TypeError(
            `Alert delay for sensor '${sensorType}' must be a non-negative number.`
          );
        }
        this.#alertDelays[sensorType] = delayMs;
      }
    }
  }

  /**
   * Validates a sensor reading.
   * @param {string} sensorType The sensor type identifier.
   * @param {number} reading The value to validate.
   * @returns {Promise<{violation: boolean, margin: number|null}>} Resolves when alert delay is passed or immediately if no violation.
   *   - violation: true if the reading violates thresholds after alert delay,
   *   - margin: amount by which the reading exceeds the nearest limit (positive if above upper, negative if below lower), null if no violation.
   * @throws {TypeError} If inputs are invalid or sensorType is unsupported.
   */
  validateReading(sensorType, reading) {
    return new Promise((resolve, reject) => {
      if (typeof sensorType !== "string" || sensorType.trim() === "") {
        reject(new TypeError("sensorType must be a non-empty string."));
        return;
      }
      if (typeof reading !== "number" || Number.isNaN(reading)) {
        reject(new TypeError("reading must be a valid number."));
        return;
      }
      const limits = this.#thresholds[sensorType];
      if (!limits) {
        reject(new TypeError(`Sensor type '${sensorType}' is not configured.`));
        return;
      }

      const { lower, upper } = limits;

      if (reading < lower) {
        const margin = reading - lower;
        this.#handleViolation(sensorType, margin, resolve);
      } else if (reading > upper) {
        const margin = reading - upper;
        this.#handleViolation(sensorType, margin, resolve);
      } else {
        // Reading within threshold: clean up any existing timer and resolve immediately
        this.#clearViolationTimer(sensorType);
        resolve({ violation: false, margin: null });
      }
    });
  }

  #handleViolation(sensorType, margin, resolve) {
    const delay = this.#alertDelays[sensorType] ?? 0;

    if (delay === 0) {
      resolve({ violation: true, margin });
      return;
    }

    if (this.#violationTimers.has(sensorType)) {
      // Already waiting, no need to do anything; keep the first timer
      return;
    }

    const timerId = setTimeout(() => {
      resolve({ violation: true, margin });
      this.#violationTimers.delete(sensorType);
    }, delay);

    this.#violationTimers.set(sensorType, timerId);
  }

  #clearViolationTimer(sensorType) {
    if (this.#violationTimers.has(sensorType)) {
      clearTimeout(this.#violationTimers.get(sensorType));
      this.#violationTimers.delete(sensorType);
    }
  }
}

export default SensorThresholdValidator;
```