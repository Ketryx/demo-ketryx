```typescript
import fetch from 'node-fetch';

export interface PatientClinicalRecord {
  patientId: string;
  timestamp: string; // ISO 8601 date string
  vitalSigns: VitalSigns;
  labResults: LabResults;
  medications: Medication[];
  notes?: string;
}

export interface VitalSigns {
  heartRate: number; // bpm
  bloodPressureSystolic: number; // mmHg
  bloodPressureDiastolic: number; // mmHg
  respiratoryRate: number; // breaths per minute
  temperatureCelsius: number;
  oxygenSaturationPercent: number;
}

export interface LabResults {
  testName: string;
  testValue: number | string;
  unit: string;
  referenceRange?: string;
}

export interface Medication {
  name: string;
  dosage: string;
  frequency: string;
  startDate: string; // ISO 8601
  endDate?: string; // ISO 8601, if applicable
}

export interface PatientTrendAggregate {
  patientId: string;
  startDate: string;
  endDate: string;
  averageHeartRate: number | null;
  averageBloodPressureSystolic: number | null;
  averageBloodPressureDiastolic: number | null;
  averageRespiratoryRate: number | null;
  averageTemperatureCelsius: number | null;
  averageOxygenSaturationPercent: number | null;
  recordCount: number;
}

type RealTimeCallback = (record: PatientClinicalRecord) => void;

export class PatientDataService {
  private static BASE_API_URL = 'https://api.healthsystem.example.com/patient-data';

  private cache: Map<string, PatientClinicalRecord[]> = new Map();

  private realTimeCallbacks: Map<string, Set<RealTimeCallback>> = new Map();

  private maxRetryAttempts = 3;

  private retryDelayMs = 500;

  async fetchHistoricalData(
    patientId: string,
    startDate: string,
    endDate: string
  ): Promise<PatientClinicalRecord[]> {
    const cacheKey = this.getCacheKey(patientId, startDate, endDate);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const url = `${PatientDataService.BASE_API_URL}/${encodeURIComponent(
      patientId
    )}/history?start=${encodeURIComponent(startDate)}&end=${encodeURIComponent(endDate)}`;

    let attempts = 0;
    while (attempts < this.maxRetryAttempts) {
      try {
        const response = await fetch(url);
        if (!response.ok) {
          const errorText = await response.text();
          throw new FetchError(
            `Failed to fetch historical data: ${response.status} ${response.statusText} - ${errorText}`,
            response.status
          );
        }
        const data = (await response.json()) as unknown;
        const records = this.validateClinicalRecordsArray(data);
        this.cache.set(cacheKey, records);
        return records;
      } catch (error) {
        if (this.isRetryableError(error)) {
          attempts++;
          await this.delay(this.retryDelayMs);
          continue;
        }
        throw error;
      }
    }
    throw new FetchError('Exceeded max retry attempts for fetching historical data', 0);
  }

  subscribeToRealTimeUpdates(
    patientId: string,
    callback: RealTimeCallback
  ): () => void {
    if (!this.realTimeCallbacks.has(patientId)) {
      this.realTimeCallbacks.set(patientId, new Set());
      this.initializeRealTimeConnection(patientId);
    }
    this.realTimeCallbacks.get(patientId)!.add(callback);
    return () => {
      this.realTimeCallbacks.get(patientId)!.delete(callback);
      if (this.realTimeCallbacks.get(patientId)!.size === 0) {
        this.closeRealTimeConnection(patientId);
        this.realTimeCallbacks.delete(patientId);
      }
    };
  }

  aggregatePatientTrends(
    records: PatientClinicalRecord[],
    startDate: string,
    endDate: string
  ): PatientTrendAggregate {
    if (!records.length) {
      return {
        patientId: '',
        startDate,
        endDate,
        averageHeartRate: null,
        averageBloodPressureSystolic: null,
        averageBloodPressureDiastolic: null,
        averageRespiratoryRate: null,
        averageTemperatureCelsius: null,
        averageOxygenSaturationPercent: null,
        recordCount: 0,
      };
    }
    const filtered = records.filter((r) => r.timestamp >= startDate && r.timestamp <= endDate);
    const patientId = filtered[0]?.patientId ?? '';

    const count = filtered.length;
    if (count === 0) {
      return {
        patientId,
        startDate,
        endDate,
        averageHeartRate: null,
        averageBloodPressureSystolic: null,
        averageBloodPressureDiastolic: null,
        averageRespiratoryRate: null,
        averageTemperatureCelsius: null,
        averageOxygenSaturationPercent: null,
        recordCount: 0,
      };
    }

    const sum = {
      heartRate: 0,
      bloodPressureSystolic: 0,
      bloodPressureDiastolic: 0,
      respiratoryRate: 0,
      temperatureCelsius: 0,
      oxygenSaturationPercent: 0,
    };

    for (const r of filtered) {
      sum.heartRate += r.vitalSigns.heartRate;
      sum.bloodPressureSystolic += r.vitalSigns.bloodPressureSystolic;
      sum.bloodPressureDiastolic += r.vitalSigns.bloodPressureDiastolic;
      sum.respiratoryRate += r.vitalSigns.respiratoryRate;
      sum.temperatureCelsius += r.vitalSigns.temperatureCelsius;
      sum.oxygenSaturationPercent += r.vitalSigns.oxygenSaturationPercent;
    }

    return {
      patientId,
      startDate,
      endDate,
      averageHeartRate: sum.heartRate / count,
      averageBloodPressureSystolic: sum.bloodPressureSystolic / count,
      averageBloodPressureDiastolic: sum.bloodPressureDiastolic / count,
      averageRespiratoryRate: sum.respiratoryRate / count,
      averageTemperatureCelsius: sum.temperatureCelsius / count,
      averageOxygenSaturationPercent: sum.oxygenSaturationPercent / count,
      recordCount: count,
    };
  }

  // -- Internal helper methods --

  private async delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private getCacheKey(patientId: string, startDate: string, endDate: string): string {
    return `${patientId}:${startDate}:${endDate}`;
  }

  private isRetryableError(error: unknown): boolean {
    if (error instanceof FetchError && error.status >= 500) {
      return true;
    }
    if (error instanceof Error && (error.name === 'FetchError' || error.message.includes('network'))) {
      return true;
    }
    return false;
  }

  private validateClinicalRecordsArray(data: unknown): PatientClinicalRecord[] {
    if (!Array.isArray(data)) {
      throw new ValidationError('Expected array of clinical records');
    }
    const records: PatientClinicalRecord[] = [];
    for (const item of data) {
      records.push(this.validateClinicalRecord(item));
    }
    return records;
  }

  private validateClinicalRecord(data: any): PatientClinicalRecord {
    if (typeof data !== 'object' || data === null) {
      throw new ValidationError('Invalid clinical record: not an object');
    }
    const {
      patientId,
      timestamp,
      vitalSigns,
      labResults,
      medications,
      notes,
    } = data;

    if (typeof patientId !== 'string' || !patientId.trim()) {
      throw new ValidationError('Invalid or missing patientId');
    }
    if (typeof timestamp !== 'string' || Number.isNaN(Date.parse(timestamp))) {
      throw new ValidationError('Invalid or missing timestamp');
    }

    if (typeof vitalSigns !== 'object' || vitalSigns === null) {
      throw new ValidationError('Missing vitalSigns');
    }
    const validatedVitalSigns = this.validateVitalSigns(vitalSigns);

    if (!Array.isArray(labResults)) {
      throw new ValidationError('labResults must be an array');
    }
    const validatedLabResults = labResults.map((lr: any) => this.validateLabResult(lr));

    if (!Array.isArray(medications)) {
      throw new ValidationError('medications must be an array');
    }
    const validatedMedications = medications.map((m: any) => this.validateMedication(m));

    if (notes !== undefined && typeof notes !== 'string') {
      throw new ValidationError('notes must be a string if present');
    }

    return {
      patientId,
      timestamp,
      vitalSigns: validatedVitalSigns,
      labResults: validatedLabResults,
      medications: validatedMedications,
      notes,
    };
  }

  private validateVitalSigns(data: any): VitalSigns {
    const {
      heartRate,
      bloodPressureSystolic,
      bloodPressureDiastolic,
      respiratoryRate,
      temperatureCelsius,
      oxygenSaturationPercent,
    } = data;

    if (
      typeof heartRate !== 'number' ||
      typeof bloodPressureSystolic !== 'number' ||
      typeof bloodPressureDiastolic !== 'number' ||
      typeof respiratoryRate !== 'number' ||
      typeof temperatureCelsius !== 'number' ||
      typeof oxygenSaturationPercent !== 'number'
    ) {
      throw new ValidationError('Invalid vital signs: expected number fields');
    }
    return {
      heartRate,
      bloodPressureSystolic,
      bloodPressureDiastolic,
      respiratoryRate,
      temperatureCelsius,
      oxygenSaturationPercent,
    };
  }

  private validateLabResult(data: any): LabResults {
    const { testName, testValue, unit, referenceRange } = data;
    if (typeof testName !== 'string' || !testName.trim()) {
      throw new ValidationError('Invalid or missing labResults.testName');
    }
    if (
      (typeof testValue !== 'number' && typeof testValue !== 'string') ||
      testValue === ''
    ) {
      throw new ValidationError('Invalid labResults.testValue');
    }
    if (typeof unit !== 'string' || !unit.trim()) {
      throw new ValidationError('Invalid or missing labResults.unit');
    }
    if (referenceRange !== undefined && typeof referenceRange !== 'string') {
      throw new ValidationError('labResults.referenceRange must be string if present');
    }
    return { testName, testValue, unit, referenceRange };
  }

  private validateMedication(data: any): Medication {
    const { name, dosage, frequency, startDate, endDate } = data;
    if (typeof name !== 'string' || !name.trim()) {
      throw new ValidationError('Invalid or missing medication.name');
    }
    if (typeof dosage !== 'string' || !dosage.trim()) {
      throw new ValidationError('Invalid or missing medication.dosage');
    }
    if (typeof frequency !== 'string' || !frequency.trim()) {
      throw new ValidationError('Invalid or missing medication.frequency');
    }
    if (typeof startDate !== 'string' || Number.isNaN(Date.parse(startDate))) {
      throw new ValidationError('Invalid or missing medication.startDate');
    }
    if (endDate !== undefined && (typeof endDate !== 'string' || Number.isNaN(Date.parse(endDate)))) {
      throw new ValidationError('Invalid medication.endDate');
    }
    return { name, dosage, frequency, startDate, endDate };
  }

  // Real-time connection simulation and management (stub)

  private wsConnections: Map<string, WebSocket> = new Map();

  private initializeRealTimeConnection(patientId: string): void {
    // Stub WebSocket URL - replace with real endpoint as needed
    const wsUrl = `wss://api.healthsystem.example.com/realtime/${encodeURIComponent(patientId)}`;
    const ws = new WebSocket(wsUrl);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const record = this.validateClinicalRecord(data);
        this.cacheRecentRecord(patientId, record);
        const cbs = this.realTimeCallbacks.get(patientId);
        if (cbs) {
          for (const cb of cbs) {
            cb(record);
          }
        }
      } catch {
        // invalid data from websocket, ignore or log
      }
    };

    ws.onclose = () => {
      this.wsConnections.delete(patientId);
      // Optionally implement reconnect logic here
    };

    ws.onerror = () => {
      // Optionally handle error, for now silently close
      ws.close();
    };

    this.wsConnections.set(patientId, ws);
  }

  private closeRealTimeConnection(patientId: string): void {
    const ws = this.wsConnections.get(patientId);
    if (ws) {
      ws.close();
      this.wsConnections.delete(patientId);
    }
  }

  private cacheRecentRecord(patientId: string, record: PatientClinicalRecord): void {
    // Only cache recent records; older records are cached by fetchHistoricalData
    // Keep cache per patient for last 100 records
    const prefix = `${patientId}:recent`;
    const current = this.cache.get(prefix) ?? [];
    current.push(record);
    // Keep max 100 records
    if (current.length > 100) {
      current.shift();
    }
    this.cache.set(prefix, current);
  }
}

// Custom error types
export class FetchError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'FetchError';
    this.status = status;
  }
}

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
```