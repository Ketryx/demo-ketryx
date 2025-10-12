```javascript
class AlertThresholdManager {
  static _instance = null;

  constructor() {
    if (AlertThresholdManager._instance) {
      return AlertThresholdManager._instance;
    }

    this._upperLimits = new Map(); // sensorId -> upper limit (number)
    this._lowerLimits = new Map(); // sensorId -> lower limit (number)
    this._maxTimeIntervals = new Map(); // sensorId -> max allowable time interval (ms)

    this._thresholdHistory = new Map(); // sensorId -> array of {timestamp, upperLimit, lowerLimit, maxTimeInterval}

    AlertThresholdManager._instance = this;
  }

  static getInstance() {
    if (!AlertThresholdManager._instance) {
      AlertThresholdManager._instance = new AlertThresholdManager();
    }
    return AlertThresholdManager._instance;
  }

  _validateSensorId(sensorId) {
    if (typeof sensorId !== 'string' || !sensorId.trim()) {
      throw new TypeError('Sensor ID must be a non-empty string.');
    }
  }

  _validateLimit(value, name) {
    if (typeof value !== 'number' || !isFinite(value)) {
      throw new TypeError(`${name} must be a finite number.`);
    }
  }

  _validateTimeInterval(value) {
    if (
      typeof value !== 'number' ||
      !isFinite(value) ||
      value <= 0 ||
      !Number.isInteger(value)
    ) {
      throw new TypeError(
        `Max allowable time interval must be a positive integer (ms).`
      );
    }
  }

  configureUpperLimit(sensorId, upperLimit) {
    this._validateSensorId(sensorId);
    this._validateLimit(upperLimit, 'Upper limit');

    const lowerLimit = this._lowerLimits.get(sensorId);
    if (typeof lowerLimit === 'number' && upperLimit <= lowerLimit) {
      throw new RangeError(
        `Upper limit (${upperLimit}) must be greater than lower limit (${lowerLimit}).`
      );
    }

    this._upperLimits.set(sensorId, upperLimit);
    this._recordThresholdHistory(sensorId);
  }

  configureLowerLimit(sensorId, lowerLimit) {
    this._validateSensorId(sensorId);
    this._validateLimit(lowerLimit, 'Lower limit');

    const upperLimit = this._upperLimits.get(sensorId);
    if (typeof upperLimit === 'number' && lowerLimit >= upperLimit) {
      throw new RangeError(
        `Lower limit (${lowerLimit}) must be less than upper limit (${upperLimit}).`
      );
    }

    this._lowerLimits.set(sensorId, lowerLimit);
    this._recordThresholdHistory(sensorId);
  }

  configureMaxTimeInterval(sensorId, maxIntervalMs) {
    this._validateSensorId(sensorId);
    this._validateTimeInterval(maxIntervalMs);

    this._maxTimeIntervals.set(sensorId, maxIntervalMs);
    this._recordThresholdHistory(sensorId);
  }

  getUpperLimit(sensorId) {
    this._validateSensorId(sensorId);
    return this._upperLimits.get(sensorId) ?? null;
  }

  getLowerLimit(sensorId) {
    this._validateSensorId(sensorId);
    return this._lowerLimits.get(sensorId) ?? null;
  }

  getMaxTimeInterval(sensorId) {
    this._validateSensorId(sensorId);
    return this._maxTimeIntervals.get(sensorId) ?? null;
  }

  removeSensorConfig(sensorId) {
    this._validateSensorId(sensorId);

    this._upperLimits.delete(sensorId);
    this._lowerLimits.delete(sensorId);
    this._maxTimeIntervals.delete(sensorId);
    this._thresholdHistory.delete(sensorId);
  }

  validateThresholds(sensorId) {
    this._validateSensorId(sensorId);

    const upperLimit = this._upperLimits.get(sensorId);
    const lowerLimit = this._lowerLimits.get(sensorId);
    const maxInterval = this._maxTimeIntervals.get(sensorId);

    if (
      upperLimit === undefined ||
      lowerLimit === undefined ||
      maxInterval === undefined
    ) {
      return false;
    }
    if (typeof lowerLimit !== 'number' || typeof upperLimit !== 'number') {
      return false;
    }
    if (upperLimit <= lowerLimit) {
      return false;
    }

    if (
      typeof maxInterval !== 'number' ||
      maxInterval <= 0 ||
      !Number.isInteger(maxInterval)
    ) {
      return false;
    }

    return true;
  }

  adjustThreshold(sensorId, { upperLimit, lowerLimit, maxTimeInterval }) {
    this._validateSensorId(sensorId);

    if (
      upperLimit !== undefined &&
      (typeof upperLimit !== 'number' || !isFinite(upperLimit))
    ) {
      throw new TypeError('upperLimit must be a finite number if provided.');
    }
    if (
      lowerLimit !== undefined &&
      (typeof lowerLimit !== 'number' || !isFinite(lowerLimit))
    ) {
      throw new TypeError('lowerLimit must be a finite number if provided.');
    }
    if (
      maxTimeInterval !== undefined &&
      (typeof maxTimeInterval !== 'number' ||
        !Number.isInteger(maxTimeInterval) ||
        maxTimeInterval <= 0)
    ) {
      throw new TypeError(
        'maxTimeInterval must be a positive integer if provided.'
      );
    }

    const currentUpper = this._upperLimits.get(sensorId);
    const currentLower = this._lowerLimits.get(sensorId);

    // Validate constraints before applying
    const newUpper = upperLimit !== undefined ? upperLimit : currentUpper;
    const newLower = lowerLimit !== undefined ? lowerLimit : currentLower;

    if (
      typeof newUpper === 'number' &&
      typeof newLower === 'number' &&
      newUpper <= newLower
    ) {
      throw new RangeError(
        `Adjusted upper limit (${newUpper}) must be greater than lower limit (${newLower}).`
      );
    }

    if (upperLimit !== undefined) this._upperLimits.set(sensorId, upperLimit);
    if (lowerLimit !== undefined) this._lowerLimits.set(sensorId, lowerLimit);
    if (maxTimeInterval !== undefined)
      this._maxTimeIntervals.set(sensorId, maxTimeInterval);

    this._recordThresholdHistory(sensorId);
  }

  _recordThresholdHistory(sensorId) {
    const timestamp = Date.now();
    const snapshot = {
      timestamp,
      upperLimit: this._upperLimits.get(sensorId) ?? null,
      lowerLimit: this._lowerLimits.get(sensorId) ?? null,
      maxTimeInterval: this._maxTimeIntervals.get(sensorId) ?? null,
    };

    let history = this._thresholdHistory.get(sensorId);
    if (!history) {
      history = [];
      this._thresholdHistory.set(sensorId, history);
    }

    history.push(snapshot);
    // Optional: limit history length to prevent unbounded growth
    if (history.length > 1000) {
      history.shift();
    }
  }

  getThresholdHistory(sensorId) {
    this._validateSensorId(sensorId);

    const history = this._thresholdHistory.get(sensorId);
    if (!history) {
      return [];
    }
    return [...history];
  }

  loadConfigurations(configObj) {
    if (
      typeof configObj !== 'object' ||
      configObj === null ||
      Array.isArray(configObj)
    ) {
      throw new TypeError('Configuration object must be a non-null plain object.');
    }

    for (const [sensorId, cfg] of Object.entries(configObj)) {
      if (typeof cfg !== 'object' || cfg === null) continue;

      const { upperLimit, lowerLimit, maxTimeInterval } = cfg;

      try {
        if (upperLimit !== undefined) {
          this.configureUpperLimit(sensorId, upperLimit);
        }
        if (lowerLimit !== undefined) {
          this.configureLowerLimit(sensorId, lowerLimit);
        }
        if (maxTimeInterval !== undefined) {
          this.configureMaxTimeInterval(sensorId, maxTimeInterval);
        }
      } catch {
        // skip invalid configs silently or could log warnings
      }
    }
  }

  saveConfigurations() {
    const configObj = {};

    const sensorIds = new Set([
      ...this._upperLimits.keys(),
      ...this._lowerLimits.keys(),
      ...this._maxTimeIntervals.keys(),
    ]);

    for (const sensorId of sensorIds) {
      configObj[sensorId] = {
        upperLimit: this._upperLimits.get(sensorId) ?? null,
        lowerLimit: this._lowerLimits.get(sensorId) ?? null,
        maxTimeInterval: this._maxTimeIntervals.get(sensorId) ?? null,
      };
    }

    return configObj;
  }
}

export default AlertThresholdManager;
```