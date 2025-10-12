```javascript
/**
 * @module SensorDataValidator
 * Utility functions for validating sensor data and detecting alert conditions.
 */

/**
 * Checks if a sensor reading exceeds the given thresholds.
 * @param {number} value - Sensor reading value.
 * @param {Object} thresholds - Thresholds object.
 * @param {number} [thresholds.min] - Minimum allowed value (inclusive).
 * @param {number} [thresholds.max] - Maximum allowed value (inclusive).
 * @returns {boolean} True if value is outside thresholds, false otherwise.
 */
export const isOutOfThreshold = (value, { min, max }) => {
  if (typeof value !== 'number' || isNaN(value)) return false;
  if (min !== undefined && value < min) return true;
  if (max !== undefined && value > max) return true;
  return false;
};

/**
 * Validates if the timestamp is within an acceptable time window compared to now.
 * @param {string|number|Date} timestamp - Timestamp to validate.
 * @param {number} maxAgeMs - Maximum allowable age in milliseconds.
 * @returns {boolean} True if timestamp is valid and not outdated, false otherwise.
 */
export const isTimestampValid = (timestamp, maxAgeMs) => {
  const ts = new Date(timestamp);
  if (Number.isNaN(ts.getTime())) return false;
  const age = Date.now() - ts.getTime();
  return age >= 0 && age <= maxAgeMs;
};

/**
 * Checks if the sensor data meets quality criteria.
 * @param {Object} data - Sensor data object.
 * @param {number} [data.signalStrength] - Signal strength indicator (0-100).
 * @param {number} [data.confidence] - Confidence level (0-1).
 * @param {number} minSignalStrength - Minimum signal strength required.
 * @param {number} minConfidence - Minimum confidence level required.
 * @returns {boolean} True if data quality is acceptable, false otherwise.
 */
export const isQualityAcceptable = (
  { signalStrength, confidence },
  minSignalStrength,
  minConfidence
) =>
  typeof signalStrength === 'number' &&
  signalStrength >= minSignalStrength &&
  typeof confidence === 'number' &&
  confidence >= minConfidence;

/**
 * Detects anomaly patterns in a sequence of sensor readings.
 * An anomaly is defined as a sequence where values change abruptly beyond a given threshold.
 * @param {number[]} values - Array of sensor readings ordered by time.
 * @param {number} anomalyThreshold - Minimum difference between consecutive readings to count as anomaly.
 * @param {number} minSequenceLength - Minimum length of consecutive anomalies to detect pattern.
 * @returns {boolean} True if an anomaly pattern is detected, false otherwise.
 */
export const detectAnomalyPattern = (values, anomalyThreshold, minSequenceLength) => {
  if (!Array.isArray(values) || values.length < minSequenceLength) return false;

  const anomalies = values
    .slice(1)
    .map((v, i) => Math.abs(v - values[i]) > anomalyThreshold);

  let count = 0;
  for (const isAnomaly of anomalies) {
    if (isAnomaly) {
      count += 1;
      if (count >= minSequenceLength - 1) return true;
    } else {
      count = 0;
    }
  }
  return false;
};

/**
 * Analyzes the rate-of-change for sensor readings and flags if it exceeds a threshold.
 * @param {number[]} values - Array of sensor readings ordered by time.
 * @param {number} maxRateOfChange - Maximum allowed absolute rate-of-change per unit time.
 * @param {number} timeIntervalMs - Time interval between consecutive readings in milliseconds.
 * @returns {boolean} True if rate-of-change exceeds threshold at any point, false otherwise.
 */
export const hasExcessiveRateOfChange = (values, maxRateOfChange, timeIntervalMs) => {
  if (!Array.isArray(values) || values.length < 2 || timeIntervalMs <= 0) return false;

  return values
    .slice(1)
    .some((v, i) => Math.abs(v - values[i]) / (timeIntervalMs / 1000) > maxRateOfChange);
};

/**
 * Sanitizes raw sensor data by filtering out invalid or corrupt entries.
 * Removes entries with missing required fields or invalid numeric values.
 * @param {Array<Object>} data - Array of sensor data objects.
 * @param {string[]} requiredFields - Fields required to be present and valid numbers.
 * @returns {Array<Object>} Sanitized array of sensor data.
 */
export const sanitizeSensorData = (data, requiredFields) =>
  Array.isArray(data)
    ? data.filter(
        (entry) =>
          entry &&
          requiredFields.every(
            (field) =>
              entry.hasOwnProperty(field) &&
              typeof entry[field] === 'number' &&
              !isNaN(entry[field])
          )
      )
    : [];
```