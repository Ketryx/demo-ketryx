```typescript
import { DataPreprocessor } from '../../../sensors/preprocessing/DataPreprocessor';

jest.setTimeout(10000);

describe('DataPreprocessor', () => {
  let preprocessor: DataPreprocessor;

  beforeEach(() => {
    preprocessor = new DataPreprocessor();
  });

  const generateNoisySignal = (length: number, noiseLevel: number) => {
    const signal = Array.from({ length }, (_, i) => Math.sin(i / 5));
    return signal.map(v => v + (Math.random() * 2 - 1) * noiseLevel);
  };

  const generateNormalizedData = (length: number) => {
    const data = Array.from({ length }, (_, i) => i);
    return data;
  };

  const generateDataWithOutliers = () => {
    const data = [10, 11, 10.5, 10.8, 50, 10.2, 10.1, -40, 10.3];
    return data;
  };

  const generateDataWithMissing = () => {
    // null/undefined represents missing
    return [1, 2, null, 4, undefined, 6, 7];
  };

  const generateInvalidData = () => {
    return [1, 2, NaN, 'invalid', 5];
  };

  test('filters noise effectively', () => {
    const noisyData = generateNoisySignal(100, 0.5);
    const filtered = preprocessor.filterNoise(noisyData);

    // Expect filtered data to be closer to underlying sine wave than noisy data
    const sine = Array.from({ length: 100 }, (_, i) => Math.sin(i / 5));
    const noisyError = noisyData.reduce((acc, v, i) => acc + Math.abs(v - sine[i]), 0);
    const filteredError = filtered.reduce((acc, v, i) => acc + Math.abs(v - sine[i]), 0);

    expect(filteredError).toBeLessThan(noisyError);
  });

  test('normalizes data with accuracy', () => {
    const raw = generateNormalizedData(50);
    const normalized = preprocessor.normalize(raw);

    const min = Math.min(...normalized);
    const max = Math.max(...normalized);

    expect(min).toBeGreaterThanOrEqual(0);
    expect(max).toBeLessThanOrEqual(1);

    // Check linear normalization correctness for first and last elements
    expect(normalized[0]).toBeCloseTo(0);
    expect(normalized[normalized.length - 1]).toBeCloseTo(1);
  });

  test('detects and handles outliers correctly', () => {
    const data = generateDataWithOutliers();
    const { cleanedData, outliers } = preprocessor.detectAndHandleOutliers(data);

    // Outliers should be identified and excluded/replaced
    expect(outliers).toEqual(expect.arrayContaining([50, -40]));
    expect(cleanedData).not.toContain(50);
    expect(cleanedData).not.toContain(-40);

    // Cleaned data values should be within reasonable range near 10
    cleanedData.forEach(v => {
      expect(v).toBeGreaterThan(9);
      expect(v).toBeLessThan(12);
    });
  });

  test('interpolates missing data correctly', () => {
    const data = generateDataWithMissing();
    const interpolated = preprocessor.interpolateMissing(data);

    // No null or undefined remain
    expect(interpolated).not.toContain(null);
    expect(interpolated).not.toContain(undefined);

    // Interpolated values between 2 and 4 should be approx 3
    expect(interpolated[2]).toBeCloseTo(3);
    expect(interpolated[4]).toBeCloseTo(5); // between 4 and 6

    // Original known values remain intact
    expect(interpolated[0]).toBe(1);
    expect(interpolated[1]).toBe(2);
    expect(interpolated[5]).toBe(6);
    expect(interpolated[6]).toBe(7);
  });

  test('validates input data and throws on invalid', () => {
    const invalidData = generateInvalidData();
    expect(() => preprocessor.validate(invalidData)).toThrow();

    const validData = [1, 2, 3, 4];
    expect(() => preprocessor.validate(validData)).not.toThrow();
  });

  test('preprocessing performance meets real-time requirements', () => {
    const largeData = generateNoisySignal(10000, 0.3);

    const startTime = performance.now();
    const preprocessed = preprocessor.preprocess(largeData);
    const endTime = performance.now();

    const durationMs = endTime - startTime;

    // Assume real-time requires < 100ms for 10k samples
    expect(durationMs).toBeLessThan(100);
    expect(preprocessed.length).toBe(largeData.length);
  });
});
```