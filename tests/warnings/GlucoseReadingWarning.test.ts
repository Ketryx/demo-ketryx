```typescript
import GlucoseReadingWarning from '../../src/warnings/GlucoseReadingWarning';
import { jest } from '@jest/globals';

describe('GlucoseReadingWarning', () => {
  const now = new Date('2024-06-15T12:00:00Z');

  beforeAll(() => {
    jest.useFakeTimers('modern');
    jest.setSystemTime(now);
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  const makeReading = (timestamp: string | null) => {
    if (!timestamp) return null;
    return {
      glucose: 100,
      timestamp: new Date(timestamp).toISOString(),
    };
  };

  it('triggers warning for stale glucose readings', () => {
    const staleReading = makeReading('2024-06-15T10:50:00Z'); // 70 mins old
    const warning = new GlucoseReadingWarning({
      reading: staleReading,
      stalenessThresholdMins: 60,
      timezone: 'UTC',
    });
    expect(warning.isWarning()).toBe(true);
    expect(warning.message).toMatch(/stale/i);
  });

  it('does not trigger warning for fresh glucose readings', () => {
    const freshReading = makeReading('2024-06-15T11:45:00Z'); // 15 mins old
    const warning = new GlucoseReadingWarning({
      reading: freshReading,
      stalenessThresholdMins: 60,
      timezone: 'UTC',
    });
    expect(warning.isWarning()).toBe(false);
  });

  it('respects configurable staleness threshold', () => {
    const reading = makeReading('2024-06-15T11:10:00Z'); // 50 mins old
    const warningThreshold45 = new GlucoseReadingWarning({
      reading,
      stalenessThresholdMins: 45,
      timezone: 'UTC',
    });
    expect(warningThreshold45.isWarning()).toBe(true);
    const warningThreshold60 = new GlucoseReadingWarning({
      reading,
      stalenessThresholdMins: 60,
      timezone: 'UTC',
    });
    expect(warningThreshold60.isWarning()).toBe(false);
  });

  it('correctly handles readings in different time zones', () => {
    // Reading timestamp is in America/New_York (EDT UTC-4)
    const readingInNY = {
      glucose: 100,
      timestamp: '2024-06-15T07:10:00-04:00', // UTC 11:10
    };
    const warning = new GlucoseReadingWarning({
      reading: readingInNY,
      stalenessThresholdMins: 45,
      timezone: 'UTC',
    });
    // Current time UTC 12:00, reading 50 mins ago => stale
    expect(warning.isWarning()).toBe(true);
  });

  it('gracefully handles missing reading data', () => {
    const warning = new GlucoseReadingWarning({
      reading: null,
      stalenessThresholdMins: 60,
      timezone: 'UTC',
    });
    expect(warning.isWarning()).toBe(false);
    expect(warning.message).toMatch(/no data/i);
  });

  it('correctly escalates warnings after configured escalation time', () => {
    const reading = makeReading('2024-06-15T10:30:00Z'); // 90 mins ago
    const escalationMinutes = 30;
    const warning = new GlucoseReadingWarning({
      reading,
      stalenessThresholdMins: 60,
      escalationThresholdMins: escalationMinutes,
      timezone: 'UTC',
    });
    expect(warning.isWarning()).toBe(true);
    expect(warning.isEscalated()).toBe(true);

    // Test just before escalation threshold
    jest.setSystemTime(new Date(now.getTime() - (60 + escalationMinutes - 1) * 60 * 1000)); // Shift time back close to threshold
    const warningBeforeEscalation = new GlucoseReadingWarning({
      reading,
      stalenessThresholdMins: 60,
      escalationThresholdMins: escalationMinutes,
      timezone: 'UTC',
    });
    expect(warningBeforeEscalation.isWarning()).toBe(true);
    expect(warningBeforeEscalation.isEscalated()).toBe(false);

    // Restore time
    jest.setSystemTime(now);
  });
});
```