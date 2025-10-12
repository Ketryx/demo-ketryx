```typescript
import { InsulinDoseWarning, DoseLimits, AuditLogEntry } from '../../src/warnings/InsulinDoseWarning';

describe('InsulinDoseWarning', () => {
  let warning: InsulinDoseWarning;

  const defaultLimits: DoseLimits = { lower: 1, upper: 50 };

  const doseFixtures = {
    belowLower: 0.5,
    atLower: 1,
    withinRange: 25,
    atUpper: 50,
    aboveUpper: 75,
    zeroDose: 0,
    veryLargeDose: 10000,
  };

  beforeEach(() => {
    warning = new InsulinDoseWarning(defaultLimits);
  });

  describe('Warning triggers', () => {
    test('trigger warning for dose above upper limit', () => {
      const dose = doseFixtures.aboveUpper;
      expect(warning.checkDose(dose)).toBe(true);
      expect(warning.lastWarning).toEqual({
        dose,
        type: 'aboveUpper',
        timestamp: expect.any(Number),
      });
    });

    test('trigger warning for dose below lower limit', () => {
      const dose = doseFixtures.belowLower;
      expect(warning.checkDose(dose)).toBe(true);
      expect(warning.lastWarning).toEqual({
        dose,
        type: 'belowLower',
        timestamp: expect.any(Number),
      });
    });

    test('no warning for valid doses', () => {
      const doses = [doseFixtures.atLower, doseFixtures.withinRange, doseFixtures.atUpper];
      doses.forEach((dose) => {
        expect(warning.checkDose(dose)).toBe(false);
        expect(warning.lastWarning).toBeNull();
      });
    });
  });

  describe('Threshold configuration updates', () => {
    test('update limits and reflect in warning', () => {
      warning.setLimits({ lower: 5, upper: 10 });
      expect(warning.limits.lower).toBe(5);
      expect(warning.limits.upper).toBe(10);

      expect(warning.checkDose(4)).toBe(true);
      expect(warning.checkDose(6)).toBe(false);
      expect(warning.checkDose(11)).toBe(true);
    });
  });

  describe('Historical tracking', () => {
    test('track warnings over time', () => {
      const doses = [0.8, 55, 30, 0.5, 60];
      const expectedWarnings = [
        { dose: 0.8, type: 'belowLower' },
        { dose: 55, type: 'aboveUpper' },
        { dose: 0.5, type: 'belowLower' },
        { dose: 60, type: 'aboveUpper' },
      ];

      doses.forEach((dose) => warning.checkDose(dose));

      const history = warning.getWarningHistory();
      expect(history.length).toBe(expectedWarnings.length);

      expectedWarnings.forEach(({ dose, type }, i) => {
        expect(history[i].dose).toBe(dose);
        expect(history[i].type).toBe(type);
        expect(typeof history[i].timestamp).toBe('number');
      });
    });
  });

  describe('Edge cases', () => {
    test('zero dose triggers below lower limit warning', () => {
      expect(warning.checkDose(doseFixtures.zeroDose)).toBe(true);
      expect(warning.lastWarning?.type).toBe('belowLower');
    });

    test('very large doses trigger above upper limit warning', () => {
      expect(warning.checkDose(doseFixtures.veryLargeDose)).toBe(true);
      expect(warning.lastWarning?.type).toBe('aboveUpper');
    });
  });

  describe('Audit logging', () => {
    test('audit log captures warning events', () => {
      warning.checkDose(doseFixtures.belowLower);
      warning.checkDose(doseFixtures.withinRange);
      warning.checkDose(doseFixtures.aboveUpper);

      const logs: AuditLogEntry[] = warning.getAuditLog();

      expect(logs.length).toBe(2);

      expect(logs[0]).toMatchObject({
        event: 'warningTriggered',
        dose: doseFixtures.belowLower,
        limitType: 'lower',
        timestamp: expect.any(Number),
      });

      expect(logs[1]).toMatchObject({
        event: 'warningTriggered',
        dose: doseFixtures.aboveUpper,
        limitType: 'upper',
        timestamp: expect.any(Number),
      });
    });

    test('no log entry for doses within limits', () => {
      warning.checkDose(doseFixtures.withinRange);
      expect(warning.getAuditLog().length).toBe(0);
    });
  });
});
```