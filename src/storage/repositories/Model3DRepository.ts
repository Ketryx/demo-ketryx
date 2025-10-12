```typescript
import crypto from 'crypto';
import zlib from 'zlib';
import { promisify } from 'util';

const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

export interface SourceImageData {
  id: string;
  modality: string; // e.g. CT, MRI
  acquisitionDate: Date;
  metadata?: Record<string, any>;
}

export interface Model3DMetadata {
  patientId: string;
  version: number;
  createdDate: Date;
  description?: string;
  authorId: string;
  sourceImages: SourceImageData[];
}

export interface StoredModel3D {
  id: string;
  compressedData: Buffer;
  metadata: Model3DMetadata;
  integrityHash: string;
}

/**
 * Search filters for querying 3D models
 */
export interface Model3DQueryFilters {
  patientId?: string;
  fromDate?: Date;
  toDate?: Date;
  authorId?: string;
  minVersion?: number;
  maxVersion?: number;
}

interface AccessControl {
  userId: string;
  roles: string[]; // e.g. ['admin', 'radiologist', 'technician']
  allowedPatientIds: Set<string>;
}

export class Model3DRepository {
  // In-memory storage simulation
  private storage: Map<string, StoredModel3D[]> = new Map();

  constructor(private accessControlProvider: (userId: string) => AccessControl) {}

  /**
   * Compress raw 3D model JSON data buffer and generate integrity hash.
   * @param rawBuffer raw JSON data buffer representing the 3D model
   */
  private async compressAndHash(rawBuffer: Buffer): Promise<{ compressedData: Buffer; integrityHash: string }> {
    const compressedData = await gzip(rawBuffer);
    const integrityHash = crypto.createHash('sha256').update(compressedData).digest('hex');
    return { compressedData, integrityHash };
  }

  /**
   * Decompress data and validate integrity hash.
   */
  private async decompressAndValidate(
    compressedData: Buffer,
    expectedHash: string
  ): Promise<Buffer> {
    const computedHash = crypto.createHash('sha256').update(compressedData).digest('hex');
    if (computedHash !== expectedHash) {
      throw new Error('Integrity check failed: data corrupted or tampered.');
    }
    return gunzip(compressedData);
  }

  /**
   * Save a new model version with metadata.
   * Automatically increments versioning.
   * Throws if user has no access to the patient.
   * @param userId ID of user performing the save (for access control)
   * @param rawModelData raw JSON string representing the 3D model object
   * @param metadata model metadata except version (it will be calculated)
   */
  async saveModel(
    userId: string,
    rawModelData: string,
    metadata: Omit<Model3DMetadata, 'version' | 'createdDate'>
  ): Promise<StoredModel3D> {
    const access = this.accessControlProvider(userId);
    if (!access.allowedPatientIds.has(metadata.patientId)) {
      throw new Error(`User ${userId} does not have access to patient ${metadata.patientId}`);
    }

    const existingVersions = this.storage.get(metadata.patientId) || [];
    const nextVersion = existingVersions.length > 0
      ? existingVersions[existingVersions.length - 1].metadata.version + 1
      : 1;

    const fullMetadata: Model3DMetadata = {
      ...metadata,
      version: nextVersion,
      createdDate: new Date(),
    };

    const rawBuffer = Buffer.from(rawModelData, 'utf-8');
    const { compressedData, integrityHash } = await this.compressAndHash(rawBuffer);

    const id = crypto.randomUUID();

    const stored: StoredModel3D = {
      id,
      compressedData,
      integrityHash,
      metadata: fullMetadata,
    };

    this.storage.set(metadata.patientId, [...existingVersions, stored]);
    return stored;
  }

  /**
   * Retrieve a specific model version by patient ID and version.
   * Performs integrity check upon retrieval.
   * Throws if user has no access.
   * @returns Parsed JSON object of the 3D model
   */
  async getModelByVersion(userId: string, patientId: string, version: number): Promise<{ model: any; metadata: Model3DMetadata }> {
    const access = this.accessControlProvider(userId);
    if (!access.allowedPatientIds.has(patientId)) {
      throw new Error(`User ${userId} does not have access to patient ${patientId}`);
    }

    const versions = this.storage.get(patientId);
    if (!versions) {
      throw new Error(`No models found for patient ${patientId}`);
    }
    const stored = versions.find(v => v.metadata.version === version);
    if (!stored) {
      throw new Error(`Version ${version} for patient ${patientId} not found`);
    }

    const decompressed = await this.decompressAndValidate(stored.compressedData, stored.integrityHash);
    const model = JSON.parse(decompressed.toString('utf-8'));
    return { model, metadata: stored.metadata };
  }

  /**
   * Retrieve the latest model version for a patient.
   * Throws if no versions found or no access.
   * @returns Parsed JSON object of the 3D model
   */
  async getLatestModel(userId: string, patientId: string): Promise<{ model: any; metadata: Model3DMetadata }> {
    const access = this.accessControlProvider(userId);
    if (!access.allowedPatientIds.has(patientId)) {
      throw new Error(`User ${userId} does not have access to patient ${patientId}`);
    }

    const versions = this.storage.get(patientId);
    if (!versions || versions.length === 0) {
      throw new Error(`No models found for patient ${patientId}`);
    }

    const stored = versions[versions.length - 1];
    const decompressed = await this.decompressAndValidate(stored.compressedData, stored.integrityHash);
    const model = JSON.parse(decompressed.toString('utf-8'));
    return { model, metadata: stored.metadata };
  }

  /**
   * Get all versions metadata history for a patient.
   * Throws if no access.
   */
  async getModelHistory(userId: string, patientId: string): Promise<Model3DMetadata[]> {
    const access = this.accessControlProvider(userId);
    if (!access.allowedPatientIds.has(patientId)) {
      throw new Error(`User ${userId} does not have access to patient ${patientId}`);
    }

    const versions = this.storage.get(patientId) || [];
    return versions.map(v => v.metadata);
  }

  /**
   * Query stored models by filters.
   * Returns metadata array.
   * Throws if user access to patient(s) is denied.
   */
  async queryModels(userId: string, filters: Model3DQueryFilters): Promise<Model3DMetadata[]> {
    const access = this.accessControlProvider(userId);

    let results: Model3DMetadata[] = [];
    for (const [patientId, versions] of this.storage.entries()) {
      if (!access.allowedPatientIds.has(patientId)) continue;
      if (filters.patientId && filters.patientId !== patientId) continue;

      for (const model of versions) {
        if (filters.authorId && model.metadata.authorId !== filters.authorId) continue;

        const createdDate = model.metadata.createdDate;
        if (filters.fromDate && createdDate < filters.fromDate) continue;
        if (filters.toDate && createdDate > filters.toDate) continue;

        if (filters.minVersion && model.metadata.version < filters.minVersion) continue;
        if (filters.maxVersion && model.metadata.version > filters.maxVersion) continue;

        results.push(model.metadata);
      }
    }

    results.sort((a, b) => b.createdDate.getTime() - a.createdDate.getTime());
    return results;
  }
}
```
