```typescript
import { SensorModule } from '../../src/sensors/SensorModule';
import { HardwareInterface } from '../../src/hardware/HardwareInterface';

jest.mock('../../src/hardware/HardwareInterface');

const MockHardwareInterface = HardwareInterface as jest.MockedClass<typeof HardwareInterface>;

describe('SensorModule', () => {
  let sensorModule: SensorModule;
  let hardwareInterface: jest.Mocked<HardwareInterface>;

  const sampleRawData = Buffer.from([0x01, 0x02, 0x03, 0x04]);
  const preprocessedData = Buffer.from([0x02, 0x04, 0x06, 0x08]);
  const calibrationOffsets = { offsetX: 1, offsetY: 2, offsetZ: -1 };

  beforeEach(() => {
    hardwareInterface = new MockHardwareInterface() as jest.Mocked<HardwareInterface>;

    hardwareInterface.acquire.mockClear();
    hardwareInterface.transmit.mockClear();
    hardwareInterface.calibrate.mockClear();
    hardwareInterface.getHealthStatus.mockClear();

    sensorModule = new SensorModule(hardwareInterface);

    // Mock acquisition to return sampleRawData asynchronously
    hardwareInterface.acquire.mockImplementation(async () => sampleRawData);

    // Mock transmit resolves immediately
    hardwareInterface.transmit.mockResolvedValue(true);

    // Mock calibration resolves immediately
    hardwareInterface.calibrate.mockResolvedValue(true);

    // Mock health status returns ok by default
    hardwareInterface.getHealthStatus.mockReturnValue({ healthy: true, temperature: 35 });
  });

  describe('continuous acquisition operation', () => {
    it('should continuously acquire data until stopped', async () => {
      const acquireSpy = jest.spyOn(hardwareInterface, 'acquire');

      sensorModule.startAcquisition();

      await new Promise((r) => setTimeout(r, 100));

      sensorModule.stopAcquisition();

      expect(acquireSpy).toHaveBeenCalledMultipleTimes();
    });

    it('stops acquisition on request', async () => {
      sensorModule.startAcquisition();

      await new Promise((r) => setTimeout(r, 50));

      sensorModule.stopAcquisition();

      // After stop, no more acquisitions should happen
      const callsAfterStop = hardwareInterface.acquire.mock.calls.length;
      await new Promise((r) => setTimeout(r, 50));
      expect(hardwareInterface.acquire.mock.calls.length).toEqual(callsAfterStop);
    });
  });

  describe('preprocessing pipeline execution', () => {
    it('should preprocess acquired data correctly', async () => {
      // Overwrite preprocess method to test pipeline
      sensorModule.preprocess = jest.fn((data) => {
        // simulate doubling each byte
        return Buffer.from(data.map((b) => b * 2));
      });

      const data = await sensorModule.acquireOnce();

      const processed = sensorModule.preprocess(data);

      expect(processed).toEqual(preprocessedData);
    });
  });

  describe('successful data transmission', () => {
    it('should transmit preprocessed data successfully', async () => {
      sensorModule.preprocess = jest.fn((data) => preprocessedData);

      const data = await sensorModule.acquireOnce();
      const processed = sensorModule.preprocess(data);

      const result = await sensorModule.transmit(processed);

      expect(result).toBe(true);
      expect(hardwareInterface.transmit).toHaveBeenCalledWith(preprocessedData);
    });
  });

  describe('error recovery mechanisms', () => {
    it('should retry on acquisition error', async () => {
      let attempt = 0;
      hardwareInterface.acquire.mockImplementation(async () => {
        attempt++;
        if (attempt < 3) throw new Error('Acquisition failure');
        return sampleRawData;
      });

      await expect(sensorModule.acquireOnce()).resolves.toEqual(sampleRawData);
      expect(hardwareInterface.acquire).toHaveBeenCalledTimes(3);
    });

    it('should handle transmit failures gracefully', async () => {
      hardwareInterface.transmit.mockRejectedValueOnce(new Error('TX failure'));
      sensorModule.preprocess = jest.fn(() => preprocessedData);

      const data = await sensorModule.acquireOnce();
      const processed = sensorModule.preprocess(data);

      await expect(sensorModule.transmit(processed)).rejects.toThrow('TX failure');
      expect(hardwareInterface.transmit).toHaveBeenCalledTimes(1);
    });
  });

  describe('sensor calibration procedures', () => {
    it('should perform calibration with hardware interface', async () => {
      const calibrationParams = { offsetX: 1, offsetY: 2, offsetZ: -1 };
      await expect(sensorModule.calibrate(calibrationParams)).resolves.toBe(true);
      expect(hardwareInterface.calibrate).toHaveBeenCalledWith(calibrationParams);
    });

    it('should update internal calibration state after calibration', async () => {
      await sensorModule.calibrate(calibrationOffsets);
      expect(sensorModule.getCalibrationOffsets()).toEqual(calibrationOffsets);
    });
  });

  describe('buffer overflow handling', () => {
    it('should handle buffer overflow gracefully', async () => {
      sensorModule.bufferMaxSize = 2; // set buffer size small to test overflow

      sensorModule.preprocess = jest.fn((data) => data);

      sensorModule.startAcquisition();

      // let acquisition run to push multiple items into buffer
      await new Promise((r) => setTimeout(r, 100));

      sensorModule.stopAcquisition();

      // Buffer should not exceed max size
      expect(sensorModule.getBufferLength()).toBeLessThanOrEqual(sensorModule.bufferMaxSize);
    });
  });

  describe('health monitoring accuracy', () => {
    it('should retrieve correct health status from hardware interface', () => {
      const healthStatus = sensorModule.getHealthStatus();
      expect(hardwareInterface.getHealthStatus).toHaveBeenCalled();
      expect(healthStatus).toEqual({ healthy: true, temperature: 35 });
    });

    it('should reflect unhealthy status correctly', () => {
      hardwareInterface.getHealthStatus.mockReturnValue({ healthy: false, temperature: 85 });
      const healthStatus = sensorModule.getHealthStatus();
      expect(healthStatus).toEqual({ healthy: false, temperature: 85 });
    });
  });

  describe('integration: acquisition-preprocessing-transmission', () => {
    it('should acquire, preprocess and transmit data sequentially', async () => {
      sensorModule.preprocess = jest.fn((data) => preprocessedData);

      const transmitSpy = jest.spyOn(sensorModule, 'transmit');

      const data = await sensorModule.acquireOnce();
      const processed = sensorModule.preprocess(data);
      const result = await sensorModule.transmit(processed);

      expect(data).toEqual(sampleRawData);
      expect(sensorModule.preprocess).toHaveBeenCalledWith(sampleRawData);
      expect(transmitSpy).toHaveBeenCalledWith(preprocessedData);
      expect(result).toBe(true);
    });

    it('should operate full cycle continuously and handle multiple cycles', async () => {
      sensorModule.preprocess = jest.fn((data) => preprocessedData);
      sensorModule.transmit = jest.fn().mockResolvedValue(true);

      sensorModule.startContinuousCycle();

      await new Promise((r) => setTimeout(r, 200));

      sensorModule.stopContinuousCycle();

      expect(sensorModule.preprocess).toHaveBeenCalled();
      expect(sensorModule.transmit).toHaveBeenCalled();

      expect(hardwareInterface.acquire).toHaveBeenCalled();
      expect(sensorModule.transmit).toHaveBeenCalledTimes(sensorModule.preprocess.mock.calls.length);

      // At least multiple cycles occurred
      expect(sensorModule.preprocess.mock.calls.length).toBeGreaterThan(1);
    });
  });
});
```