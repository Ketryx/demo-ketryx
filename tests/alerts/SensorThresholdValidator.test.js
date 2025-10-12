```javascript
const SensorThresholdValidator = require('../../src/alerts/SensorThresholdValidator');

describe('SensorThresholdValidator', () => {
  let validator;

  beforeEach(() => {
    validator = new SensorThresholdValidator();
  });

  describe('Configuration loading and validation', () => {
    test('loads valid configuration successfully', () => {
      const config = {
        temperature: { min: -10, max: 50, margin: 2 },
        humidity: { min: 0, max: 100, margin: 5 },
        pressure: { min: 950, max: 1050, margin: 1 }
      };
      expect(() => validator.loadConfig(config)).not.toThrow();
      expect(validator.config).toEqual(config);
    });

    test('throws error on invalid configuration format', () => {
      const badConfig = {
        temperature: { minimum: 0, maximum: 100 } // keys incorrect
      };
      expect(() => validator.loadConfig(badConfig)).toThrow(/Invalid configuration/);
    });

    test('throws error if config is missing required sensor type', () => {
      const partialConfig = {
        temperature: { min: 0, max: 100, margin: 1 }
      };
      expect(() => validator.loadConfig(partialConfig, ['temperature', 'humidity'])).toThrow(/Missing configuration for sensor type: humidity/);
    });
  });

  describe('Threshold validation', () => {
    beforeEach(() => {
      validator.loadConfig({
        temperature: { min: 0, max: 100, margin: 1 },
        humidity: { min: 20, max: 80, margin: 0 },
        pressure: { min: 950, max: 1050, margin: 2 }
      });
    });

    test.each([
      ['temperature', 50, false],
      ['temperature', -1, true],
      ['temperature', 101, true],
      ['humidity', 20, false],
      ['humidity', 19, true],
      ['humidity', 80, false],
      ['humidity', 81, true],
      ['pressure', 949, true],
      ['pressure', 950, false],
      ['pressure', 1050, false],
      ['pressure', 1053, true]
    ])('validates sensor %s reading %p as violation=%p', (type, reading, violationExpected) => {
      const result = validator.validate(type, reading);
      expect(result.isViolation).toBe(violationExpected);
    });

    test('correctly applies margin for violation detection', () => {
      // temperature margin is 1
      expect(validator.validate('temperature', -0.5).isViolation).toBe(false);
      expect(validator.validate('temperature', 100.5).isViolation).toBe(false);

      expect(validator.validate('temperature', -1.1).isViolation).toBe(true);
      expect(validator.validate('temperature', 101.5).isViolation).toBe(true);

      // pressure margin is 2
      expect(validator.validate('pressure', 948).isViolation).toBe(false);
      expect(validator.validate('pressure', 947).isViolation).toBe(true);
      expect(validator.validate('pressure', 1051).isViolation).toBe(false);
      expect(validator.validate('pressure', 1053).isViolation).toBe(true);
    });

    test('detects violation exactly at threshold without margin as non-violation', () => {
      expect(validator.validate('temperature', 0).isViolation).toBe(false);
      expect(validator.validate('temperature', 100).isViolation).toBe(false);
      expect(validator.validate('humidity', 20).isViolation).toBe(false);
      expect(validator.validate('humidity', 80).isViolation).toBe(false);
    });
  });

  describe('Handling of missing or null readings', () => {
    beforeEach(() => {
      validator.loadConfig({
        temperature: { min: 0, max: 100, margin: 0 },
      });
    });

    test.each([null, undefined, NaN, ''])(
      'returns violation flag false and appropriate message for invalid reading: %p',
      (reading) => {
        const result = validator.validate('temperature', reading);
        expect(result.isViolation).toBe(false);
        expect(result.message).toMatch(/Invalid or missing sensor reading/);
      }
    );

    test('throws error when sensor type is unknown in validate', () => {
      expect(() => validator.validate('unknownSensor', 25)).toThrow(/Unknown sensor type/);
    });
  });

  describe('Concurrent validation requests', () => {
    beforeEach(() => {
      validator.loadConfig({
        temperature: { min: 0, max: 100, margin: 0.5 },
      });
    });

    test('handles multiple concurrent validations correctly', async () => {
      const readings = [99.6, 100.4, 101, -1, 50];
      const promises = readings.map(r =>
        Promise.resolve().then(() => validator.validate('temperature', r))
      );
      const results = await Promise.all(promises);

      expect(results).toEqual([
        { isViolation: false, value: 99.6 },
        { isViolation: false, value: 100.4 },
        { isViolation: true, value: 101 },
        { isViolation: true, value: -1 },
        { isViolation: false, value: 50 }
      ]);
    });
  });

  describe('Edge cases and performance', () => {
    beforeEach(() => {
      validator.loadConfig({
        temperature: { min: Number.MIN_SAFE_INTEGER, max: Number.MAX_SAFE_INTEGER, margin: 0 },
      });
    });

    test('handles very large and small numbers correctly', () => {
      expect(validator.validate('temperature', Number.MIN_SAFE_INTEGER).isViolation).toBe(false);
      expect(validator.validate('temperature', Number.MAX_SAFE_INTEGER).isViolation).toBe(false);
      expect(validator.validate('temperature', Number.MIN_SAFE_INTEGER - 1).isViolation).toBe(true);
      expect(validator.validate('temperature', Number.MAX_SAFE_INTEGER + 1).isViolation).toBe(true);
    });

    test('performance test: validates 10000 readings in under 100ms', () => {
      const readings = Array(10000).fill(50);
      const start = process.hrtime.bigint();
      readings.forEach(r => validator.validate('temperature', r));
      const durationMs = Number(process.hrtime.bigint() - start) / 1e6;

      expect(durationMs).toBeLessThan(100);
    });
  });
});
```