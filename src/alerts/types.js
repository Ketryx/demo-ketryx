/**
 * @typedef {'info' | 'warning' | 'critical' | 'error'} AlertSeverity
 */

/**
 * @enum {string}
 */
const AlertStatus = {
  NEW: 'NEW',
  ACKNOWLEDGED: 'ACKNOWLEDGED',
  RESOLVED: 'RESOLVED'
};

/**
 * @typedef {Object} Alert
 * @property {AlertSeverity} severity - The severity level of the alert
 * @property {string} message - Alert message describing the issue
 * @property {number} timestamp - Unix timestamp (milliseconds) when alert was generated
 * @property {string} source - Source identifier that generated the alert
 */

/**
 * @typedef {Object} SensorReading
 * @property {number} value - Sensor reading value
 * @property {number} timestamp - Unix timestamp (milliseconds) when reading was taken
 * @property {string} sensorId - Unique identifier of the sensor
 * @property {string} type - The sensor type (e.g., temperature, humidity)
 */

/**
 * @typedef {Object} ThresholdConfig
 * @property {number} upperLimit - Upper threshold limit for sensor readings
 * @property {number} lowerLimit - Lower threshold limit for sensor readings
 * @property {string} sensorType - The sensor type the threshold applies to
 */

/**
 * @typedef {Object} NotificationPayload
 * @property {string} recipient - Identifier or contact info of the notification recipient
 * @property {Alert} alert - Alert data to be delivered
 */

export { AlertStatus };