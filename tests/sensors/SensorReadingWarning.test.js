```javascript
const SensorReadingWarning = require('../../sensors/SensorReadingWarning');

const mockNotify = jest.fn();

const notificationService = {
  notify: mockNotify,
};

const now = Date.now();

const validReading = {
  value: 50,
  timestamp: now,
};

const upperLimitReading = {
  value: 101,
  timestamp: now,
};

const lowerLimitReading = {
  value: -1,
  timestamp: now,
};

const staleReading = {
  value: 50,
  timestamp: now - 1000 * 60 * 60 * 24 * 2, // 2 days ago
};

describe('SensorReadingWarning', () => {
  let sensorWarning;

  beforeEach(() => {
    jest.clearAllMocks();
    sensorWarning = new SensorReadingWarning({
      upperLimit: 100,
      lowerLimit: 0,
      staleThresholdMs: 1000 * 60 * 60 * 24, // 1 day
      notificationService,
    });
  });

  test('triggers warning when reading exceeds upper limit', () => {
    sensorWarning.processReading(upperLimitReading);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    const notification = mockNotify.mock.calls[0][0];
    expect(notification.message).toMatch(/exceeds upper limit/);
    expect(notification.value).toBe(upperLimitReading.value);
  });

  test('triggers warning when reading is below lower limit', () => {
    sensorWarning.processReading(lowerLimitReading);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    const notification = mockNotify.mock.calls[0][0];
    expect(notification.message).toMatch(/below lower limit/);
    expect(notification.value).toBe(lowerLimitReading.value);
  });

  test('triggers warning for stale readings', () => {
    sensorWarning.processReading(staleReading);
    expect(mockNotify).toHaveBeenCalledTimes(1);
    const notification = mockNotify.mock.calls[0][0];
    expect(notification.message).toMatch(/stale reading/);
    expect(notification.timestamp).toBe(staleReading.timestamp);
  });

  test('does not trigger warning for valid reading within limits and timeframe', () => {
    sensorWarning.processReading(validReading);
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test('multiple consecutive warnings trigger multiple notifications', () => {
    sensorWarning.processReading(upperLimitReading);
    sensorWarning.processReading(lowerLimitReading);
    sensorWarning.processReading(staleReading);
    expect(mockNotify).toHaveBeenCalledTimes(3);
  });

  test('updates threshold configuration correctly', () => {
    sensorWarning.updateThresholds({
      upperLimit: 80,
      lowerLimit: 20,
    });

    // Reading above new upper limit
    sensorWarning.processReading({ value: 85, timestamp: now });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0][0].message).toMatch(/exceeds upper limit/);

    jest.clearAllMocks();

    // Reading below new lower limit
    sensorWarning.processReading({ value: 15, timestamp: now });
    expect(mockNotify).toHaveBeenCalledTimes(1);
    expect(mockNotify.mock.calls[0][0].message).toMatch(/below lower limit/);

    jest.clearAllMocks();

    // Reading within new limits
    sensorWarning.processReading({ value: 50, timestamp: now });
    expect(mockNotify).not.toHaveBeenCalled();
  });

  test('throws error when processReading called with invalid input', () => {
    expect(() => sensorWarning.processReading(null)).toThrow();
    expect(() => sensorWarning.processReading({})).toThrow();
    expect(() => sensorWarning.processReading({ value: 'abc', timestamp: now })).toThrow();
    expect(() => sensorWarning.processReading({ value: 50, timestamp: 'string' })).toThrow();
  });

  test('throws error when updateThresholds called with invalid configuration', () => {
    expect(() => sensorWarning.updateThresholds(null)).toThrow();
    expect(() => sensorWarning.updateThresholds({ upperLimit: 'high' })).toThrow();
    expect(() => sensorWarning.updateThresholds({ lowerLimit: {} })).toThrow();
    expect(() => sensorWarning.updateThresholds({ upperLimit: 10, lowerLimit: 20 })).toThrow();
  });
});
```