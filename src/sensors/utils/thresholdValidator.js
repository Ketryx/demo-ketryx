```javascript
/**
 * Validates sensor readings against thresholds and related utilities.
 */

/**
 * Checks if a value is within a specified inclusive range.
 * @param {number} value - The sensor reading value.
 * @param {{min: number, max: number}} range - Object with min and max thresholds.
 * @returns {boolean}
 */
function isWithinRange(value, range) {
  if (
    typeof value !== 'number' ||
    typeof range !== 'object' ||
    typeof range.min !== 'number' ||
    typeof range.max !== 'number'
  ) {
    return false;
  }
  return value >= range.min && value <= range.max;
}

/**
 * Checks if a value is strictly above a threshold.
 * @param {number} value - The sensor reading value.
 * @param {number} threshold - Threshold to compare.
 * @returns {boolean}
 */
function isAboveThreshold(value, threshold) {
  if (typeof value !== 'number' || typeof threshold !== 'number') return false;
  return value > threshold;
}

/**
 * Checks if a value is strictly below a threshold.
 * @param {number} value - The sensor reading value.
 * @param {number} threshold - Threshold to compare.
 * @returns {boolean}
 */
function isBelowThreshold(value, threshold) {
  if (typeof value !== 'number' || typeof threshold !== 'number') return false;
  return value < threshold;
}

/**
 * Validates that a timestamp is fresh relative to the current time.
 * @param {string|number|Date} timestamp - Timestamp to validate.
 * @param {number} maxAgeMs - Maximum allowed age in milliseconds.
 * @returns {boolean}
 */
function isTimestampFresh(timestamp, maxAgeMs) {
  if (!timestamp || typeof maxAgeMs !== 'number' || maxAgeMs < 0) return false;
  const ts = new Date(timestamp);
  if (isNaN(ts.getTime())) return false;
  const age = Date.now() - ts.getTime();
  return age >= 0 && age <= maxAgeMs;
}

/**
 * Parses a threshold configuration string or object into a standardized object.
 * Supports formats like:
 * - "min:10,max:20"
 * - { min: 10, max: 20 }
 * - { above: 15 }
 * - { below: 5 }
 * @param {string|object} config
 * @returns {object|null} Parsed threshold config or null if invalid
 */
function parseThresholdConfig(config) {
  if (typeof config === 'object' && config !== null) {
    const keys = ['min', 'max', 'above', 'below'];
    const hasValidKey = keys.some(k => k in config && typeof config[k] === 'number');
    if (!hasValidKey) return null;
    return {
      min: typeof config.min === 'number' ? config.min : undefined,
      max: typeof config.max === 'number' ? config.max : undefined,
      above: typeof config.above === 'number' ? config.above : undefined,
      below: typeof config.below === 'number' ? config.below : undefined,
    };
  }

  if (typeof config !== 'string') return null;

  const parts = config.split(',').map(s => s.trim());
  const result = {};
  for (const part of parts) {
    const [key, val] = part.split(':').map(s => s.trim());
    if (!key || !val) continue;
    const numVal = Number(val);
    if (isNaN(numVal)) continue;
    if (['min', 'max', 'above', 'below'].includes(key)) {
      result[key] = numVal;
    }
  }
  return Object.keys(result).length ? result : null;
}

/**
 * Formats validation results into a consistent object structure.
 * @param {boolean} isValid - Overall validation status.
 * @param {string[]} errors - Array of error messages.
 * @param {object} [details] - Additional validation details.
 * @returns {{ valid: boolean, errors: string[], details?: object }}
 */
function formatValidationResult(isValid, errors = [], details) {
  const result = {
    valid: Boolean(isValid),
    errors: Array.isArray(errors) ? errors : [],
  };
  if (details && typeof details === 'object') {
    result.details = details;
  }
  return result;
}

export {
  isWithinRange,
  isAboveThreshold,
  isBelowThreshold,
  isTimestampFresh,
  parseThresholdConfig,
  formatValidationResult,
};
```