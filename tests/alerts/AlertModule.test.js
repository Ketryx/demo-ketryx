```javascript
import AlertModule from '../../src/alerts/AlertModule';

jest.useFakeTimers();

describe('AlertModule', () => {
  let alertModule;
  const mockNow = new Date('2024-01-01T12:00:00Z');

  const fixtures = {
    validReading: { sensorId: 'sensor1', value: 75, timestamp: new Date(mockNow.getTime()) },
    outdatedReading: { sensorId: 'sensor1', value: 75, timestamp: new Date(mockNow.getTime() - 3600 * 1000 * 2) }, // 2 hours old
    limitExceededReading: { sensorId: 'sensor1', value: 101, timestamp: new Date(mockNow.getTime()) },
    criticalReading: { sensorId: 'sensor1', value: 150, timestamp: new Date(mockNow.getTime()) },
  };

  const limits = {
    warning: 100,
    critical: 140,
  };

  beforeEach(() => {
    alertModule = new AlertModule({ limits });
    jest.setSystemTime(mockNow);
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
  });

  describe('alerts trigger correctly when limits are exceeded', () => {
    test('should not trigger alert for normal readings', () => {
      const alertSpy = jest.spyOn(alertModule, 'triggerAlert');
      alertModule.processReading(fixtures.validReading);
      expect(alertSpy).not.toHaveBeenCalled();
    });

    test('should trigger warning alert when value exceeds warning limit', () => {
      const alertSpy = jest.spyOn(alertModule, 'triggerAlert');
      alertModule.processReading(fixtures.limitExceededReading);
      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy).toHaveBeenCalledWith(expect.objectContaining({
        sensorId: fixtures.limitExceededReading.sensorId,
        priority: 'warning',
        value: fixtures.limitExceededReading.value,
      }));
    });

    test('should trigger critical alert when value exceeds critical limit', () => {
      const alertSpy = jest.spyOn(alertModule, 'triggerAlert');
      alertModule.processReading(fixtures.criticalReading);
      expect(alertSpy).toHaveBeenCalledTimes(1);
      expect(alertSpy).toHaveBeenCalledWith(expect.objectContaining({
        sensorId: fixtures.criticalReading.sensorId,
        priority: 'critical',
        value: fixtures.criticalReading.value,
      }));
    });
  });

  describe('outdated reading detection works properly', () => {
    test('should detect outdated reading and flag appropriately', () => {
      const outdatedSpy = jest.spyOn(alertModule, 'handleOutdatedReading');
      alertModule.processReading(fixtures.outdatedReading);
      expect(outdatedSpy).toHaveBeenCalledWith(fixtures.outdatedReading);
      // Should not trigger any new alerts for outdated reading by value
      expect(alertModule.getAlertHistory()).toHaveLength(0);
    });
  });

  describe('alert priority assignment is accurate', () => {
    test.each`
      value   | expectedPriority
      ${90}  | ${null}
      ${101} | ${'warning'}
      ${139} | ${'warning'}
      ${140} | ${'critical'}
      ${160} | ${'critical'}
    `('value $value sets priority $expectedPriority', ({ value, expectedPriority }) => {
      const reading = { ...fixtures.validReading, value };
      const priority = alertModule.assignPriority(reading.value);
      expect(priority).toBe(expectedPriority);
    });
  });

  describe('deduplication prevents duplicate alerts', () => {
    test('should not generate duplicate alerts for identical readings', () => {
      const triggerSpy = jest.spyOn(alertModule, 'triggerAlert');
      alertModule.processReading(fixtures.limitExceededReading);
      alertModule.processReading(fixtures.limitExceededReading);
      expect(triggerSpy).toHaveBeenCalledTimes(1);
    });

    test('should generate a new alert if reading changes significantly', () => {
      const triggerSpy = jest.spyOn(alertModule, 'triggerAlert');
      alertModule.processReading({...fixtures.limitExceededReading, value: 105});
      alertModule.processReading({...fixtures.limitExceededReading, value: 110});
      expect(triggerSpy).toHaveBeenCalledTimes(2);
    });
  });

  describe('critical alerts escalate appropriately', () => {
    test('should escalate alert on repeated critical readings', () => {
      const escalateSpy = jest.spyOn(alertModule, 'escalateAlert');
      alertModule.processReading(fixtures.criticalReading);
      alertModule.processReading({...fixtures.criticalReading, timestamp: new Date(mockNow.getTime() + 60000)});
      expect(escalateSpy).toHaveBeenCalledTimes(1);
      expect(escalateSpy).toHaveBeenCalledWith(expect.objectContaining({
        sensorId: fixtures.criticalReading.sensorId,
        priority: 'critical',
      }));
    });

    test('should not escalate if critical alert is not repeated', () => {
      const escalateSpy = jest.spyOn(alertModule, 'escalateAlert');
      alertModule.processReading(fixtures.criticalReading);
      alertModule.processReading({...fixtures.limitExceededReading, timestamp: new Date(mockNow.getTime() + 60000)});
      expect(escalateSpy).not.toHaveBeenCalled();
    });
  });

  describe('alert history is maintained', () => {
    test('should keep history of all triggered alerts', () => {
      alertModule.processReading(fixtures.limitExceededReading);
      alertModule.processReading(fixtures.criticalReading);
      const history = alertModule.getAlertHistory();
      expect(history).toHaveLength(2);
      expect(history[0]).toEqual(expect.objectContaining({
        sensorId: fixtures.limitExceededReading.sensorId,
        priority: 'warning',
      }));
      expect(history[1]).toEqual(expect.objectContaining({
        sensorId: fixtures.criticalReading.sensorId,
        priority: 'critical',
      }));
    });

    test('history should have timestamps and unique ids', () => {
      alertModule.processReading(fixtures.limitExceededReading);
      const history = alertModule.getAlertHistory();
      const entry = history[0];
      expect(entry.timestamp).toEqual(mockNow);
      expect(typeof entry.id).toBe('string');
      expect(entry.id).toHaveLength(36); // UUID v4 length
    });
  });

  describe('error conditions are handled gracefully', () => {
    test('should throw descriptive error on invalid reading structure', () => {
      expect(() => alertModule.processReading(null)).toThrow('Invalid reading');
      expect(() => alertModule.processReading({})).toThrow('Invalid reading');
    });

    test('should catch errors during alert triggering and log without throwing', () => {
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      jest.spyOn(alertModule, 'triggerAlert').mockImplementation(() => { throw new Error('Alert failure'); });

      expect(() => alertModule.processReading(fixtures.limitExceededReading)).not.toThrow();
      expect(consoleErrorSpy).toHaveBeenCalledWith(expect.stringContaining('Alert failure'));

      consoleErrorSpy.mockRestore();
    });
  });
});
```