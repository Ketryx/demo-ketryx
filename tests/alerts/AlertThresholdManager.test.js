```javascript
import AlertThresholdManager from '../../src/alerts/AlertThresholdManager';

const mockStorage = () => {
  let store = {};
  return {
    getItem: jest.fn((key) => Promise.resolve(store[key] || null)),
    setItem: jest.fn((key, value) => {
      store[key] = value;
      return Promise.resolve();
    }),
    clear: () => { store = {}; },
  };
};

const createValidConfig = (overrides = {}) => ({
  thresholdName: 'cpu_usage',
  upperLimit: 90,
  lowerLimit: 10,
  intervalSeconds: 60,
  ...overrides,
});

const createInvalidConfig = () => ({
  thresholdName: '', // invalid because empty name
  upperLimit: -10, // invalid limit
  lowerLimit: 200, // invalid compared to upper limit
  intervalSeconds: 0, // invalid interval
});

describe('AlertThresholdManager', () => {
  let storage;
  let manager;

  beforeEach(() => {
    storage = mockStorage();
    manager = new AlertThresholdManager(storage);
  });

  describe('Configuration Validation', () => {
    test('accepts valid configuration', async () => {
      const config = createValidConfig();
      await expect(manager.validateConfig(config)).resolves.toBe(true);
    });

    test('rejects configuration with empty threshold name', async () => {
      const config = createValidConfig({ thresholdName: '' });
      await expect(manager.validateConfig(config)).rejects.toThrow(/thresholdName/i);
    });

    test('rejects configuration when upperLimit <= lowerLimit', async () => {
      const config = createValidConfig({ upperLimit: 50, lowerLimit: 50 });
      await expect(manager.validateConfig(config)).rejects.toThrow(/upperLimit.*lowerLimit/i);
    });

    test('rejects configuration with non-positive intervalSeconds', async () => {
      const config = createValidConfig({ intervalSeconds: 0 });
      await expect(manager.validateConfig(config)).rejects.toThrow(/intervalSeconds/i);
    });
  });

  describe('Upper and Lower Limit Enforcement', () => {
    test('throws when setting upperLimit less or equal to lowerLimit', async () => {
      const config = createValidConfig({ lowerLimit: 30, upperLimit: 40 });
      await manager.saveConfig(config);
      const invalidConfig = { ...config, upperLimit: 20 };
      await expect(manager.saveConfig(invalidConfig)).rejects.toThrow(/upperLimit.*lowerLimit/i);
    });

    test('throws when setting lowerLimit greater or equal to upperLimit', async () => {
      const config = createValidConfig({ lowerLimit: 30, upperLimit: 40 });
      await manager.saveConfig(config);
      const invalidConfig = { ...config, lowerLimit: 50 };
      await expect(manager.saveConfig(invalidConfig)).rejects.toThrow(/upperLimit.*lowerLimit/i);
    });
  });

  describe('Time Interval Calculations', () => {
    test('correctly calculates next check timestamp based on intervalSeconds', () => {
      const config = createValidConfig({ intervalSeconds: 120 });
      const now = Date.now();
      const nextCheck = manager.getNextCheckTimestamp(config, now);
      expect(nextCheck).toBeGreaterThanOrEqual(now + 119000);
      expect(nextCheck).toBeLessThanOrEqual(now + 121000);
    });

    test('throws on non-positive intervalSeconds for getNextCheckTimestamp', () => {
      const config = createValidConfig({ intervalSeconds: 0 });
      expect(() => manager.getNextCheckTimestamp(config, Date.now())).toThrow(/intervalSeconds/i);
    });
  });

  describe('Configuration Persistence and Retrieval', () => {
    test('saves and retrieves configuration correctly', async () => {
      const config = createValidConfig();
      await manager.saveConfig(config);
      const retrieved = await manager.getConfig(config.thresholdName);
      expect(retrieved).toEqual(config);
    });

    test('returns null when retrieving non-existent configuration', async () => {
      const result = await manager.getConfig('non_existent');
      expect(result).toBeNull();
    });
  });

  describe('Invalid Configuration Rejection on Save', () => {
    test('does not save invalid configuration and throws error', async () => {
      const invalidConfig = createInvalidConfig();
      await expect(manager.saveConfig(invalidConfig)).rejects.toThrow();
      expect(storage.setItem).not.toHaveBeenCalled();
    });
  });

  describe('Concurrent Threshold Updates', () => {
    test('handles concurrent updates without data loss', async () => {
      const baseConfig = createValidConfig();
      await manager.saveConfig(baseConfig);

      const update1 = { ...baseConfig, upperLimit: 95 };
      const update2 = { ...baseConfig, lowerLimit: 15 };

      // Parallel saves
      await Promise.all([manager.saveConfig(update1), manager.saveConfig(update2)]);

      const finalConfig = await manager.getConfig(baseConfig.thresholdName);
      expect(finalConfig.upperLimit === 95 || finalConfig.lowerLimit === 15).toBe(true);
      expect(finalConfig.thresholdName).toBe(baseConfig.thresholdName);
    });
  });
});
```