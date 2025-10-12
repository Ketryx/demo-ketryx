```typescript
// src/warnings/InsulinDoseWarning.ts

interface DoseData {
  patientId: string;
  doseUnits: number;
  timestamp: Date;
  insulinType: string;
}

interface Thresholds {
  lowerLimit: number;
  upperLimit: number;
  warningThreshold: number; // margin from limits to trigger warnings before hitting hard limits
}

interface Warning {
  patientId: string;
  doseUnits: number;
  timestamp: Date;
  insulinType: string;
  message: string;
  priority: AlertPriority;
}

enum AlertPriority {
  LOW = "LOW",
  MEDIUM = "MEDIUM",
  HIGH = "HIGH",
  CRITICAL = "CRITICAL",
}

interface NotificationSystem {
  sendNotification(warning: Warning): void;
}

interface AuditLogger {
  log(event: string, data: object): void;
}

export class InsulinDoseWarning {
  private thresholds: Thresholds;
  private history: Map<string, DoseData[]> = new Map(); // patientId -> DoseData[]
  private notifier: NotificationSystem;
  private logger: AuditLogger;

  constructor(
    thresholds: Thresholds,
    notifier: NotificationSystem,
    logger: AuditLogger
  ) {
    this.thresholds = thresholds;
    this.notifier = notifier;
    this.logger = logger;
  }

  updateThresholds(newThresholds: Partial<Thresholds>): void {
    if (typeof newThresholds.lowerLimit === "number") {
      this.thresholds.lowerLimit = newThresholds.lowerLimit;
    }
    if (typeof newThresholds.upperLimit === "number") {
      this.thresholds.upperLimit = newThresholds.upperLimit;
    }
    if (typeof newThresholds.warningThreshold === "number") {
      this.thresholds.warningThreshold = newThresholds.warningThreshold;
    }
    this.logger.log("ThresholdsUpdated", { newThresholds: this.thresholds });
  }

  addDose(dose: DoseData): void {
    if (!this.history.has(dose.patientId)) {
      this.history.set(dose.patientId, []);
    }
    this.history.get(dose.patientId)!.push(dose);
    this.logger.log("DoseAdded", { dose });
    this.verifyDose(dose);
  }

  private verifyDose(dose: DoseData): void {
    const { doseUnits } = dose;
    const { lowerLimit, upperLimit, warningThreshold } = this.thresholds;
    let warning: Warning | null = null;

    if (!this.isDoseValid(doseUnits)) {
      warning = this.generateWarning(
        dose,
        `Insulin dose of ${doseUnits} units is out of absolute bounds (${lowerLimit} - ${upperLimit})`,
        AlertPriority.CRITICAL
      );
    } else if (doseUnits <= lowerLimit + warningThreshold) {
      warning = this.generateWarning(
        dose,
        `Insulin dose of ${doseUnits} units is nearing the lower limit threshold (${lowerLimit})`,
        AlertPriority.HIGH
      );
    } else if (doseUnits >= upperLimit - warningThreshold) {
      warning = this.generateWarning(
        dose,
        `Insulin dose of ${doseUnits} units is nearing the upper limit threshold (${upperLimit})`,
        AlertPriority.HIGH
      );
    }

    if (warning) {
      this.notifier.sendNotification(warning);
      this.logger.log("WarningGenerated", { warning });
    }
  }

  private isDoseValid(doseUnits: number): boolean {
    return (
      doseUnits >= this.thresholds.lowerLimit &&
      doseUnits <= this.thresholds.upperLimit
    );
  }

  private generateWarning(
    dose: DoseData,
    message: string,
    priority: AlertPriority
  ): Warning {
    return {
      patientId: dose.patientId,
      doseUnits: dose.doseUnits,
      timestamp: dose.timestamp,
      insulinType: dose.insulinType,
      message,
      priority,
    };
  }

  getDoseHistory(patientId: string): DoseData[] {
    return this.history.get(patientId) ?? [];
  }

  getThresholds(): Thresholds {
    return { ...this.thresholds };
  }
}
```