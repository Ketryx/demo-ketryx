```javascript
import AlertModule from '../../src/alerts/AlertModule';
import BlockageDetectionModule from '../../src/blockage/BlockageDetectionModule';

jest.mock('../../src/blockage/BlockageDetectionModule');

describe('AlertModule', () => {
  let alertModule;
  let mockDashboardNotify;
  let now;

  beforeEach(() => {
    mockDashboardNotify = jest.fn();
    alertModule = new AlertModule({
      notifyDashboard: mockDashboardNotify,
      sensorThresholds: {
        temperature: { min: 0, max: 50 },
        pressure: { min: 10, max: 100 },
      },
      readingTimeoutMs: 60000, // 1 minute
      maxQueueSize: 5,
    });
    now = Date.now();
    jest.useFakeTimers('modern');
    jest.setSystemTime(now);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  const validSensorData = {
    id: 'sensor-1',
    type: 'temperature',
    value: 25,
    timestamp: now,
  };

  describe('alert triggering when sensor exceeds thresholds', () => {
    it('triggers alert when value exceeds max threshold', () => {
      const exceedingData = { ...validSensorData, value: 60 };
      alertModule.processSensorData(exceedingData);
      expect(alertModule.alertQueue).toHaveLength(1);
      const alert = alertModule.alertQueue[0];
      expect(alert.severity).toBe('high');
      expect(mockDashboardNotify).toHaveBeenCalledWith(alert);
    });

    it('triggers alert when value is below min threshold', () => {
      const lowData = { ...validSensorData, value: -5 };
      alertModule.processSensorData(lowData);
      expect(alertModule.alertQueue).toHaveLength(1);
      const alert = alertModule.alertQueue[0];
      expect(alert.severity).toBe('high');
      expect(mockDashboardNotify).toHaveBeenCalledWith(alert);
    });

    it('does not trigger alert when value is within thresholds', () => {
      alertModule.processSensorData(validSensorData);
      expect(alertModule.alertQueue).toHaveLength(0);
      expect(mockDashboardNotify).not.toHaveBeenCalled();
    });
  });

  describe('alert triggering for outdated sensor readings', () => {
    it('triggers alert when sensor reading is outdated', () => {
      const oldTimestamp = now - 120000; // 2 minutes old
      const outdatedData = { ...validSensorData, timestamp: oldTimestamp };
      alertModule.processSensorData(outdatedData);
      expect(alertModule.alertQueue).toHaveLength(1);
      const alert = alertModule.alertQueue[0];
      expect(alert.type).toBe('outdated-reading');
      expect(alert.severity).toBe('medium');
      expect(mockDashboardNotify).toHaveBeenCalledWith(alert);
    });

    it('does not trigger outdated alert if reading is fresh', () => {
      alertModule.processSensorData(validSensorData);
      expect(alertModule.alertQueue).toHaveLength(0);
    });
  });

  describe('proper severity level assignment', () => {
    it('assigns high severity for critical threshold breaches', () => {
      const criticalData = { ...validSensorData, value: 1000 }; // Extreme high value
      alertModule.processSensorData(criticalData);
      expect(alertModule.alertQueue[0].severity).toBe('high');
    });

    it('assigns medium severity for outdated readings', () => {
      const oldTimestamp = now - 90000;
      const outdatedData = { ...validSensorData, timestamp: oldTimestamp };
      alertModule.processSensorData(outdatedData);
      expect(alertModule.alertQueue[0].severity).toBe('medium');
    });

    it('assigns low severity for borderline threshold breaches', () => {
      alertModule.setSeverityRules({
        temperature: {
          lowThreshold: { min: 48, max: 52, severity: 'low' },
          criticalThreshold: { min: 0, max: 50, severity: 'high' },
        },
      });
      const borderlineData = { ...validSensorData, value: 49 };
      alertModule.processSensorData(borderlineData);
      expect(alertModule.alertQueue).toHaveLength(0);

      const borderlineHighData = { ...validSensorData, value: 51 };
      alertModule.processSensorData(borderlineHighData);
      expect(alertModule.alertQueue[0].severity).toBe('low');
    });
  });

  describe('alert queue management', () => {
    it('maintains max queue size by dropping oldest alerts', () => {
      const dataPoints = [
        { ...validSensorData, value: -5 },
        { ...validSensorData, value: 60 },
        { ...validSensorData, value: 70 },
        { ...validSensorData, value: -10 },
        { ...validSensorData, value: 80 },
        { ...validSensorData, value: 90 }, // 6th alert, should drop the first
      ];
      dataPoints.forEach(d => alertModule.processSensorData(d));
      expect(alertModule.alertQueue).toHaveLength(alertModule.maxQueueSize);
      expect(alertModule.alertQueue[0].sensorId).toBe('sensor-1');
      expect(alertModule.alertQueue[0].value).toBe(60);
    });

    it('allows removing alerts from queue', () => {
      const alertData = { ...validSensorData, value: 60 };
      alertModule.processSensorData(alertData);
      const idToRemove = alertModule.alertQueue[0].id;
      alertModule.removeAlert(idToRemove);
      expect(alertModule.alertQueue).toHaveLength(0);
    });
  });

  describe('notification delivery to dashboard', () => {
    it('calls dashboard notify on alert creation', () => {
      const alertData = { ...validSensorData, value: 60 };
      alertModule.processSensorData(alertData);
      expect(mockDashboardNotify).toHaveBeenCalledTimes(1);
      expect(mockDashboardNotify).toHaveBeenCalledWith(expect.objectContaining({
        sensorId: alertData.id,
        value: alertData.value,
      }));
    });

    it('does not notify when no alert is created', () => {
      alertModule.processSensorData(validSensorData);
      expect(mockDashboardNotify).not.toHaveBeenCalled();
    });
  });

  describe('error handling for invalid sensor data', () => {
    it('throws error when sensor data is missing required fields', () => {
      const invalidData = { value: 10, timestamp: now };
      expect(() => alertModule.processSensorData(invalidData)).toThrow(/Invalid sensor data/);
    });

    it('throws error when sensor value is not a number', () => {
      const invalidData = { ...validSensorData, value: 'NaN' };
      expect(() => alertModule.processSensorData(invalidData)).toThrow(/Invalid sensor value/);
    });

    it('handles error gracefully and does not add alert', () => {
      try {
        alertModule.processSensorData({ invalid: true });
      } catch (e) {
        // Expected error
      }
      expect(alertModule.alertQueue).toHaveLength(0);
      expect(mockDashboardNotify).not.toHaveBeenCalled();
    });
  });

  describe('performance under high alert volume', () => {
    it('processes 1000 alerts within reasonable time', () => {
      const heavyLoadData = Array.from({ length: 1000 }).map((_, i) => ({
        id: `sensor-${i}`,
        type: 'temperature',
        value: 60 + i, // All exceed max threshold
        timestamp: now,
      }));
      const start = performance.now();
      heavyLoadData.forEach((data) => alertModule.processSensorData(data));
      const end = performance.now();
      expect(alertModule.alertQueue.length).toBe(alertModule.maxQueueSize);
      expect(end - start).toBeLessThan(500); // Should process under 500ms
    });
  });

  describe('integration with blockage detection parent module', () => {
    let blockageDetectionInstance;

    beforeEach(() => {
      blockageDetectionInstance = {
        onBlockageAlert: jest.fn(),
      };
      BlockageDetectionModule.mockImplementation(() => blockageDetectionInstance);
      alertModule = new AlertModule({
        notifyDashboard: mockDashboardNotify,
        sensorThresholds: { temperature: { min: 0, max: 50 } },
        readingTimeoutMs: 60000,
        maxQueueSize: 5,
        blockageDetectionModule: new BlockageDetectionModule(),
      });
    });

    it('calls blockage detection on critical alerts', () => {
      const criticalData = { id: 'sensor-99', type: 'temperature', value: 100, timestamp: now };
      alertModule.processSensorData(criticalData);
      expect(blockageDetectionInstance.onBlockageAlert).toHaveBeenCalledTimes(1);
      expect(blockageDetectionInstance.onBlockageAlert).toHaveBeenCalledWith(expect.objectContaining({
        sensorId: 'sensor-99',
        severity: 'high',
      }));
    });

    it('does not call blockage detection for non-critical alerts', () => {
      const outdatedData = { id: 'sensor-99', type: 'temperature', value: 25, timestamp: now - 70000 };
      alertModule.processSensorData(outdatedData);
      expect(blockageDetectionInstance.onBlockageAlert).not.toHaveBeenCalled();
    });
  });
});
```
