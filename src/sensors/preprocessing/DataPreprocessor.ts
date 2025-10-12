```typescript
type NumericArray = number[];

export interface DataPreprocessorConfig {
  noiseFilter?: 'movingAverage' | 'median' | 'none';
  movingAverageWindow?: number;
  medianFilterWindow?: number;
  normalization?: 'minmax' | 'zscore' | 'none';
  scalingRange?: [number, number];
  outlierDetection?: 'zscore' | 'iqr' | 'none';
  outlierThreshold?: number;
  outlierHandling?: 'remove' | 'replaceWithMedian' | 'replaceWithMean' | 'none';
  missingDataHandling?: 'linearInterpolation' | 'fillMean' | 'fillMedian' | 'none';
  validationRanges?: { min: number; max: number };
  enableProfiling?: boolean;
}

export class DataPreprocessor {
  private config: DataPreprocessorConfig;

  constructor(config: Partial<DataPreprocessorConfig> = {}) {
    this.config = {
      noiseFilter: 'movingAverage',
      movingAverageWindow: 5,
      medianFilterWindow: 5,
      normalization: 'minmax',
      scalingRange: [0, 1],
      outlierDetection: 'zscore',
      outlierThreshold: 3,
      outlierHandling: 'replaceWithMedian',
      missingDataHandling: 'linearInterpolation',
      validationRanges: { min: Number.NEGATIVE_INFINITY, max: Number.POSITIVE_INFINITY },
      enableProfiling: false,
      ...config,
    };
  }

  preprocess(data: NumericArray): NumericArray {
    if (this.config.enableProfiling) console.time('DataPreprocessor.preprocess');

    let processed = data.slice();

    processed = this.validate(processed);
    processed = this.handleMissingData(processed);
    processed = this.filterNoise(processed);
    processed = this.handleOutliers(processed);
    processed = this.normalize(processed);

    if (this.config.enableProfiling) console.timeEnd('DataPreprocessor.preprocess');

    return processed;
  }

  private validate(data: NumericArray): NumericArray {
    const { min, max } = this.config.validationRanges!;
    return data.map((v) => (v < min ? min : v > max ? max : v));
  }

  private filterNoise(data: NumericArray): NumericArray {
    switch (this.config.noiseFilter) {
      case 'movingAverage':
        return this.movingAverageFilter(data, this.config.movingAverageWindow!);
      case 'median':
        return this.medianFilter(data, this.config.medianFilterWindow!);
      case 'none':
      default:
        return data;
    }
  }

  private movingAverageFilter(data: NumericArray, windowSize: number): NumericArray {
    const halfWindow = Math.floor(windowSize / 2);
    const len = data.length;
    const smoothed = new Array(len);

    let windowSum = 0;
    for (let i = 0; i < len; i++) {
      let count = 0;
      windowSum = 0;
      for (let j = i - halfWindow; j <= i + halfWindow; j++) {
        if (j >= 0 && j < len) {
          windowSum += data[j];
          count++;
        }
      }
      smoothed[i] = windowSum / count;
    }

    return smoothed;
  }

  private medianFilter(data: NumericArray, windowSize: number): NumericArray {
    const halfWindow = Math.floor(windowSize / 2);
    const len = data.length;
    const filtered = new Array(len);

    for (let i = 0; i < len; i++) {
      const windowVals: number[] = [];
      for (let j = i - halfWindow; j <= i + halfWindow; j++) {
        if (j >= 0 && j < len) windowVals.push(data[j]);
      }
      filtered[i] = this.median(windowVals);
    }

    return filtered;
  }

  private median(arr: number[]): number {
    const sorted = arr.slice().sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  private normalize(data: NumericArray): NumericArray {
    switch (this.config.normalization) {
      case 'minmax':
        return this.minMaxNormalize(data, this.config.scalingRange!);
      case 'zscore':
        return this.zScoreNormalize(data);
      case 'none':
      default:
        return data;
    }
  }

  private minMaxNormalize(data: NumericArray, [newMin, newMax]: [number, number]): NumericArray {
    const dMin = Math.min(...data);
    const dMax = Math.max(...data);
    if (dMax === dMin) return data.map(() => (newMin + newMax) / 2);
    return data.map((v) => ((v - dMin) / (dMax - dMin)) * (newMax - newMin) + newMin);
  }

  private zScoreNormalize(data: NumericArray): NumericArray {
    const mean = data.reduce((acc, val) => acc + val, 0) / data.length;
    const variance = data.reduce((acc, val) => acc + (val - mean) ** 2, 0) / data.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return data.map(() => 0);
    return data.map((v) => (v - mean) / stdDev);
  }

  private handleOutliers(data: NumericArray): NumericArray {
    if (this.config.outlierDetection === 'none' || this.config.outlierHandling === 'none') {
      return data;
    }

    const outliersMask = this.detectOutliers(data);

    const filtered = data.slice();

    switch (this.config.outlierHandling) {
      case 'remove':
        return filtered.filter((_, i) => !outliersMask[i]);
      case 'replaceWithMedian': {
        const median = this.median(filtered.filter((_, i) => !outliersMask[i]));
        for (let i = 0; i < filtered.length; i++) {
          if (outliersMask[i]) filtered[i] = median;
        }
        return filtered;
      }
      case 'replaceWithMean': {
        const mean = filtered.reduce((acc, val, i) => (outliersMask[i] ? acc : acc + val), 0) /
          filtered.filter((_, i) => !outliersMask[i]).length;
        for (let i = 0; i < filtered.length; i++) {
          if (outliersMask[i]) filtered[i] = mean;
        }
        return filtered;
      }
      case 'none':
      default:
        return data;
    }
  }

  private detectOutliers(data: NumericArray): boolean[] {
    const threshold = this.config.outlierThreshold!;
    switch (this.config.outlierDetection) {
      case 'zscore': {
        const mean = data.reduce((acc, val) => acc + val, 0) / data.length;
        const variance = data.reduce((acc, val) => acc + (val - mean) ** 2, 0) / data.length;
        const stdDev = Math.sqrt(variance);
        return data.map((v) => Math.abs((v - mean) / (stdDev || 1)) > threshold);
      }
      case 'iqr': {
        const sorted = data.slice().sort((a, b) => a - b);
        const q1 = this.quantile(sorted, 0.25);
        const q3 = this.quantile(sorted, 0.75);
        const iqr = q3 - q1;
        const lowerBound = q1 - threshold * iqr;
        const upperBound = q3 + threshold * iqr;
        return data.map((v) => v < lowerBound || v > upperBound);
      }
      case 'none':
      default:
        return data.map(() => false);
    }
  }

  private quantile(arr: number[], q: number): number {
    const pos = q * (arr.length - 1);
    const base = Math.floor(pos);
    const rest = pos - base;
    if (base + 1 < arr.length) {
      return arr[base] + rest * (arr[base + 1] - arr[base]);
    } else return arr[base];
  }

  private handleMissingData(data: NumericArray): NumericArray {
    switch (this.config.missingDataHandling) {
      case 'linearInterpolation':
        return this.linearInterpolation(data);
      case 'fillMean':
        return this.fillWithStatistic(data, 'mean');
      case 'fillMedian':
        return this.fillWithStatistic(data, 'median');
      case 'none':
      default:
        return data;
    }
  }

  private linearInterpolation(data: NumericArray): NumericArray {
    const filled = data.slice();
    let startIdx: number | null = null;
    for (let i = 0; i < filled.length; i++) {
      if (Number.isFinite(filled[i])) {
        if (startIdx !== null && startIdx < i - 1) {
          const endIdx = i;
          const startVal = filled[startIdx];
          const endVal = filled[endIdx];
          const gap = endIdx - startIdx;
          for (let j = startIdx + 1; j < endIdx; j++) {
            filled[j] = startVal + ((endVal - startVal) * (j - startIdx)) / gap;
          }
        }
        startIdx = i;
      }
    }
    // Fill leading NaNs if any
    if (startIdx === null) {
      // all missing, fill with zero
      return filled.map(() => 0);
    }
    for (let i = 0; i < startIdx; i++) {
      filled[i] = filled[startIdx];
    }
    // Fill trailing NaNs if any
    for (let i = filled.length - 1; i > startIdx; i--) {
      if (!Number.isFinite(filled[i])) {
        filled[i] = filled[startIdx];
      } else break;
    }
    return filled;
  }

  private fillWithStatistic(data: NumericArray, stat: 'mean' | 'median'): NumericArray {
    const finiteVals = data.filter(Number.isFinite);
    if (finiteVals.length === 0) return data.map(() => 0);
    const fillValue = stat === 'mean'
      ? finiteVals.reduce((acc, v) => acc + v, 0) / finiteVals.length
      : this.median(finiteVals);
    return data.map((v) => (Number.isFinite(v) ? v : fillValue));
  }
}
```