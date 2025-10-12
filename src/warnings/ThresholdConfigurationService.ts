```typescript
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

interface Threshold {
  id: string;
  name: string;
  minValue: number;
  maxValue: number;
  clinicalGuidelineId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  default: boolean;
}

interface PatientThreshold {
  patientId: string;
  thresholdId: string;
  minValue: number;
  maxValue: number;
  version: number;
  customizedAt: string;
}

interface AuditLogEntry {
  id: string;
  thresholdId: string;
  patientId?: string;
  timestamp: string;
  changedBy: string;
  changeType: 'CREATE' | 'UPDATE' | 'DELETE' | 'CUSTOMIZE' | 'REVERT';
  before?: Partial<Threshold> | Partial<PatientThreshold>;
  after?: Partial<Threshold> | Partial<PatientThreshold>;
  notes?: string;
}

interface ClinicalGuideline {
  id: string;
  name: string;
  description: string;
  minAllowedValue: number;
  maxAllowedValue: number;
}

type PersistedData = {
  thresholds: Threshold[];
  patientThresholds: PatientThreshold[];
  auditLogs: AuditLogEntry[];
  clinicalGuidelines: ClinicalGuideline[];
};

const DATA_FILE = path.resolve(__dirname, '../../data/thresholdConfig.json');

export class ThresholdConfigurationService {
  private data: PersistedData = {
    thresholds: [],
    patientThresholds: [],
    auditLogs: [],
    clinicalGuidelines: [],
  };

  private initialized = false;

  private async persist() {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(this.data, null, 2), 'utf-8');
  }

  private async load() {
    try {
      const content = await fs.readFile(DATA_FILE, 'utf-8');
      this.data = JSON.parse(content);
    } catch {
      this.data = {
        thresholds: [],
        patientThresholds: [],
        auditLogs: [],
        clinicalGuidelines: [],
      };
      await this.persist();
    }
    this.initialized = true;
  }

  private ensureInitialized() {
    if (!this.initialized) throw new Error('Service not initialized. Call init() before usage.');
  }

  public async init(): Promise<void> {
    await this.load();
  }

  private validateThresholdValues(minValue: number, maxValue: number): void {
    if (minValue < 0) throw new Error('minValue must be non-negative');
    if (maxValue <= minValue) throw new Error('maxValue must be greater than minValue');
  }

  private validateClinicalGuidelineCompliance(
    minValue: number,
    maxValue: number,
    guideline: ClinicalGuideline
  ): void {
    if (minValue < guideline.minAllowedValue || maxValue > guideline.maxAllowedValue) {
      throw new Error(
        `Threshold values must comply with clinical guideline "${guideline.name}" allowed range (${guideline.minAllowedValue}-${guideline.maxAllowedValue})`
      );
    }
  }

  // --- CLINICAL GUIDELINES ---

  public listClinicalGuidelines(): ClinicalGuideline[] {
    this.ensureInitialized();
    return [...this.data.clinicalGuidelines];
  }

  public addClinicalGuideline(payload: Omit<ClinicalGuideline, 'id'>): ClinicalGuideline {
    this.ensureInitialized();
    if (payload.minAllowedValue < 0) throw new Error('minAllowedValue must be non-negative');
    if (payload.maxAllowedValue <= payload.minAllowedValue) {
      throw new Error('maxAllowedValue must be greater than minAllowedValue');
    }
    const id = uuidv4();
    const newGuideline: ClinicalGuideline = { id, ...payload };
    this.data.clinicalGuidelines.push(newGuideline);
    this.persist();
    return newGuideline;
  }

  public getClinicalGuideline(id: string): ClinicalGuideline | undefined {
    this.ensureInitialized();
    return this.data.clinicalGuidelines.find((c) => c.id === id);
  }

  // --- THRESHOLDS ---

  public listThresholds(): Threshold[] {
    this.ensureInitialized();
    return [...this.data.thresholds];
  }

  public getThreshold(id: string): Threshold | undefined {
    this.ensureInitialized();
    return this.data.thresholds.find((t) => t.id === id);
  }

  public async createThreshold(
    params: Omit<Threshold, 'id' | 'version' | 'createdAt' | 'updatedAt'>
  ): Promise<Threshold> {
    this.ensureInitialized();

    const guideline = this.getClinicalGuideline(params.clinicalGuidelineId);
    if (!guideline) throw new Error('Clinical guideline not found');

    this.validateThresholdValues(params.minValue, params.maxValue);
    this.validateClinicalGuidelineCompliance(params.minValue, params.maxValue, guideline);

    if (params.default) {
      // Only one default threshold per clinical guideline allowed - reset others
      this.data.thresholds.forEach((t) => {
        if (t.clinicalGuidelineId === params.clinicalGuidelineId) t.default = false;
      });
    }

    const now = new Date().toISOString();
    const newThreshold: Threshold = {
      id: uuidv4(),
      name: params.name,
      minValue: params.minValue,
      maxValue: params.maxValue,
      clinicalGuidelineId: params.clinicalGuidelineId,
      version: 1,
      createdAt: now,
      updatedAt: now,
      default: !!params.default,
    };

    this.data.thresholds.push(newThreshold);

    await this.logChange({
      thresholdId: newThreshold.id,
      changeType: 'CREATE',
      timestamp: now,
      changedBy: 'system',
      after: newThreshold,
      notes: 'Threshold created',
    });

    await this.persist();
    return newThreshold;
  }

  public async updateThreshold(
    id: string,
    updates: Partial<Omit<Threshold, 'id' | 'createdAt' | 'version' | 'clinicalGuidelineId'> & { default?: boolean }>,
    changedBy: string
  ): Promise<Threshold> {
    this.ensureInitialized();
    const threshold = this.getThreshold(id);
    if (!threshold) throw new Error('Threshold not found');

    const guideline = this.getClinicalGuideline(threshold.clinicalGuidelineId);
    if (!guideline) throw new Error('Clinical guideline not found');

    const before = { ...threshold };

    const newMin = updates.minValue !== undefined ? updates.minValue : threshold.minValue;
    const newMax = updates.maxValue !== undefined ? updates.maxValue : threshold.maxValue;
    this.validateThresholdValues(newMin, newMax);
    this.validateClinicalGuidelineCompliance(newMin, newMax, guideline);

    if (updates.default === true && !threshold.default) {
      // Make this threshold default, clear others in same guideline
      this.data.thresholds.forEach((t) => {
        if (t.clinicalGuidelineId === threshold.clinicalGuidelineId) t.default = false;
      });
      threshold.default = true;
    } else if (updates.default === false && threshold.default) {
      // Cannot unset default without assigning another default
      throw new Error('Cannot unset default flag without reassigning default to another threshold');
    }

    if (updates.name !== undefined) threshold.name = updates.name;
    threshold.minValue = newMin;
    threshold.maxValue = newMax;
    threshold.version++;
    threshold.updatedAt = new Date().toISOString();

    await this.logChange({
      thresholdId: threshold.id,
      changeType: 'UPDATE',
      timestamp: threshold.updatedAt,
      changedBy,
      before,
      after: threshold,
      notes: 'Threshold updated',
    });

    await this.persist();
    return threshold;
  }

  public async deleteThreshold(id: string, changedBy: string): Promise<void> {
    this.ensureInitialized();

    const idx = this.data.thresholds.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error('Threshold not found');

    // Prevent deletion if default
    if (this.data.thresholds[idx].default) {
      throw new Error('Cannot delete the default threshold. Assign another default before deletion.');
    }

    const before = this.data.thresholds[idx];
    this.data.thresholds.splice(idx, 1);

    // Remove patient-specific thresholds referencing deleted threshold
    this.data.patientThresholds = this.data.patientThresholds.filter(
      (pt) => pt.thresholdId !== id
    );

    await this.logChange({
      thresholdId: id,
      changeType: 'DELETE',
      timestamp: new Date().toISOString(),
      changedBy,
      before,
      notes: 'Threshold deleted',
    });

    await this.persist();
  }

  // --- PATIENT-SPECIFIC THRESHOLDS ---

  public listPatientThresholds(patientId: string): PatientThreshold[] {
    this.ensureInitialized();
    return this.data.patientThresholds.filter((pt) => pt.patientId === patientId);
  }

  public getPatientThreshold(patientId: string, thresholdId: string): PatientThreshold | undefined {
    this.ensureInitialized();
    return this.data.patientThresholds.find(
      (pt) => pt.patientId === patientId && pt.thresholdId === thresholdId
    );
  }

  public async customizePatientThreshold(
    patientId: string,
    thresholdId: string,
    minValue: number,
    maxValue: number,
    changedBy: string
  ): Promise<PatientThreshold> {
    this.ensureInitialized();

    const baseThreshold = this.getThreshold(thresholdId);
    if (!baseThreshold) throw new Error('Base threshold not found');

    const guideline = this.getClinicalGuideline(baseThreshold.clinicalGuidelineId);
    if (!guideline) throw new Error('Clinical guideline not found');

    this.validateThresholdValues(minValue, maxValue);
    this.validateClinicalGuidelineCompliance(minValue, maxValue, guideline);

    const now = new Date().toISOString();

    let patientThreshold = this.getPatientThreshold(patientId, thresholdId);

    const before = patientThreshold ? { ...patientThreshold } : undefined;

    if (patientThreshold) {
      patientThreshold.minValue = minValue;
      patientThreshold.maxValue = maxValue;
      patientThreshold.version++;
      patientThreshold.customizedAt = now;
    } else {
      patientThreshold = {
        patientId,
        thresholdId,
        minValue,
        maxValue,
        version: 1,
        customizedAt: now,
      };
      this.data.patientThresholds.push(patientThreshold);
    }

    await this.logChange({
      thresholdId,
      patientId,
      changeType: 'CUSTOMIZE',
      timestamp: now,
      changedBy,
      before,
      after: patientThreshold,
      notes: 'Patient-specific threshold customized',
    });

    await this.persist();
    return patientThreshold;
  }

  public async revertPatientThresholdToDefault(
    patientId: string,
    thresholdId: string,
    changedBy: string
  ): Promise<void> {
    this.ensureInitialized();
    const idx = this.data.patientThresholds.findIndex(
      (pt) => pt.patientId === patientId && pt.thresholdId === thresholdId
    );
    if (idx === -1) return;

    const before = { ...this.data.patientThresholds[idx] };
    this.data.patientThresholds.splice(idx, 1);

    await this.logChange({
      thresholdId,
      patientId,
      changeType: 'REVERT',
      timestamp: new Date().toISOString(),
      changedBy,
      before,
      notes: 'Patient-specific threshold reverted to default',
    });

    await this.persist();
  }

  // --- AUDIT LOGGING ---

  private async logChange(log: Omit<AuditLogEntry, 'id'>): Promise<void> {
    const entry: AuditLogEntry = { id: uuidv4(), ...log };
    this.data.auditLogs.push(entry);
    await this.persist();
  }

  public listAuditLogs(
    thresholdId?: string,
    patientId?: string,
    limit: number = 50
  ): AuditLogEntry[] {
    this.ensureInitialized();
    let logs = this.data.auditLogs;
    if (thresholdId) logs = logs.filter((log) => log.thresholdId === thresholdId);
    if (patientId) logs = logs.filter((log) => log.patientId === patientId);
    return logs.slice(-limit).reverse();
  }

  // --- DEFAULT THRESHOLD MANAGEMENT ---

  public getDefaultThresholdForGuideline(clinicalGuidelineId: string): Threshold | undefined {
    this.ensureInitialized();
    return this.data.thresholds.find(
      (t) => t.clinicalGuidelineId === clinicalGuidelineId && t.default === true
    );
  }

  public async setDefaultThreshold(
    thresholdId: string,
    changedBy: string
  ): Promise<Threshold> {
    this.ensureInitialized();

    const threshold = this.getThreshold(thresholdId);
    if (!threshold) throw new Error('Threshold not found');

    const guidelineId = threshold.clinicalGuidelineId;

    this.data.thresholds.forEach((t) => {
      if (t.clinicalGuidelineId === guidelineId) t.default = false;
    });

    threshold.default = true;
    threshold.version++;
    threshold.updatedAt = new Date().toISOString();

    await this.logChange({
      thresholdId,
      changeType: 'UPDATE',
      timestamp: threshold.updatedAt,
      changedBy,
      after: threshold,
      notes: 'Default threshold reassigned',
    });

    await this.persist();
    return threshold;
  }
}
```