```typescript
import { MongoClient, Db, Collection, ClientSession, Document, WithId } from "mongodb";
import crypto from "crypto";
import * as zlib from "zlib";

interface PatientImagingData {
  patientId: string;
  imagingType: string; // e.g., 'MRI', 'CT'
  imageData: Buffer; // raw or compressed encrypted data
  metadata: Record<string, any>;
  createdAt: Date;
  updatedAt: Date;
}

interface ThreeDModelVersion {
  version: number;
  modelData: Buffer; // encrypted binary 3D model data
  metadata: Record<string, any>;
  createdAt: Date;
}

interface AnalysisResult {
  analysisId: string;
  patientId: string;
  resultData: any; // JSON serializable encrypted data
  createdAt: Date;
}

interface AuditLogEntry {
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  timestamp: Date;
  details?: any;
  success: boolean;
}

interface BackupEntry {
  backupId: string;
  timestamp: Date;
  dataDump: Buffer; // encrypted, compressed dump of DB collections relevant
}

const ENC_ALGORITHM = 'aes-256-gcm';
const ENC_KEY_LENGTH = 32; // 256 bits
const IV_LENGTH = 12; // recommended for GCM

class PatientDataStorage {
  private client: MongoClient;
  private db: Db | null = null;
  private key: Buffer;

  private patientImagingCollection: Collection<PatientImagingData> | null = null;
  private threeDModelsCollection: Collection<Document> | null = null;
  private analysisResultsCollection: Collection<AnalysisResult> | null = null;
  private auditLogCollection: Collection<AuditLogEntry> | null = null;
  private backupsCollection: Collection<BackupEntry> | null = null;

  constructor(mongoUri: string, dbName: string, encryptionKey: string) {
    if (Buffer.from(encryptionKey, 'base64').length !== ENC_KEY_LENGTH) {
      throw new Error(`Encryption key must be a base64 encoded ${ENC_KEY_LENGTH} byte key`);
    }
    this.key = Buffer.from(encryptionKey, 'base64');
    this.client = new MongoClient(mongoUri, { useUnifiedTopology: true });
    this.init(dbName).catch(err => {
      throw err;
    });
  }

  private async init(dbName: string) {
    await this.client.connect();
    this.db = this.client.db(dbName);

    this.patientImagingCollection = this.db.collection("patient_imaging_data");
    this.threeDModelsCollection = this.db.collection("three_d_models");
    this.analysisResultsCollection = this.db.collection("analysis_results");
    this.auditLogCollection = this.db.collection("audit_logs");
    this.backupsCollection = this.db.collection("backups");

    // Create necessary indexes for performance and data integrity
    await this.patientImagingCollection.createIndex({ patientId: 1, imagingType: 1 });
    await this.threeDModelsCollection.createIndex({ patientId: 1, "versions.version": -1 });
    await this.analysisResultsCollection.createIndex({ patientId: 1, createdAt: -1 });
    await this.auditLogCollection.createIndex({ timestamp: -1 });
    await this.backupsCollection.createIndex({ timestamp: -1 });
  }

  private encryptData(plainData: Buffer | string): { cipherText: Buffer; iv: Buffer; authTag: Buffer } {
    if (typeof plainData === 'string') {
      plainData = Buffer.from(plainData, 'utf8');
    }
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv(ENC_ALGORITHM, this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plainData), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return { cipherText: encrypted, iv, authTag };
  }

  private decryptData(cipherText: Buffer, iv: Buffer, authTag: Buffer): Buffer {
    const decipher = crypto.createDecipheriv(ENC_ALGORITHM, this.key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(cipherText), decipher.final()]);
    return decrypted;
  }

  // Audit logging helper
  private async logAction(
    userId: string,
    action: string,
    resourceType: string,
    resourceId: string,
    success: boolean,
    details?: any,
    session?: ClientSession
  ): Promise<void> {
    if (!this.auditLogCollection) return;
    const entry: AuditLogEntry = {
      userId,
      action,
      resourceType,
      resourceId,
      timestamp: new Date(),
      details,
      success,
    };
    await this.auditLogCollection.insertOne(entry, { session });
  }

  // Access control example (very basic placeholder, should be extended)
  private checkAccess(userId: string, patientId: string): boolean {
    // This method should verify if userId has permissions on patientId's data.
    // Implement authentication + authorization logic as per system architecture.
    // For demonstration, we allow all access.
    return true;
  }

  // --- Patient Imaging Data ---

  async storePatientImaging(
    userId: string,
    patientId: string,
    imagingType: string,
    imageBuffer: Buffer,
    metadata: Record<string, any>
  ): Promise<string> {
    if (!this.patientImagingCollection) throw new Error("DB not initialized");
    if (!this.checkAccess(userId, patientId)) {
      await this.logAction(userId, "storePatientImaging", "PatientImagingData", patientId, false, { reason: "access denied" });
      throw new Error("Access Denied");
    }

    const compressed = zlib.deflateSync(imageBuffer);
    const { cipherText, iv, authTag } = this.encryptData(compressed);

    const doc: PatientImagingData & { enc: { iv: Buffer; tag: Buffer } } = {
      patientId,
      imagingType,
      imageData: cipherText,
      metadata,
      createdAt: new Date(),
      updatedAt: new Date(),
      enc: { iv, tag: authTag }
    };

    const session = this.client.startSession();
    try {
      session.startTransaction();
      const result = await this.patientImagingCollection.insertOne(doc, { session });
      await this.logAction(userId, "storePatientImaging", "PatientImagingData", patientId, true, { insertedId: result.insertedId }, session);
      await session.commitTransaction();
      return result.insertedId.toHexString();
    } catch (e) {
      await session.abortTransaction();
      await this.logAction(userId, "storePatientImaging", "PatientImagingData", patientId, false, { error: (e as Error).message }, session);
      throw e;
    } finally {
      await session.endSession();
    }
  }

  async retrievePatientImaging(
    userId: string,
    imagingId: string
  ): Promise<{ patientId: string; imagingType: string; imageData: Buffer; metadata: Record<string, any>; createdAt: Date; updatedAt: Date } | null> {
    if (!this.patientImagingCollection) throw new Error("DB not initialized");

    const _id = new MongoClient().db().collection("").s.db.bson.ObjectId?.createFromHexString
      ? new (require("mongodb").ObjectId)(imagingId)
      : imagingId;

    const doc = await this.patientImagingCollection.findOne({ _id });
    if (!doc) {
      await this.logAction(userId, "retrievePatientImaging", "PatientImagingData", imagingId, false, { reason: "not found" });
      return null;
    }

    if (!this.checkAccess(userId, doc.patientId)) {
      await this.logAction(userId, "retrievePatientImaging", "PatientImagingData", imagingId, false, { reason: "access denied" });
      throw new Error("Access Denied");
    }

    if (!doc.enc || !doc.enc.iv || !doc.enc.tag) {
      throw new Error("Encrypted metadata missing");
    }

    const decryptedCompressed = this.decryptData(doc.imageData.buffer, doc.enc.iv.buffer, doc.enc.tag.buffer);
    const decompressed = zlib.inflateSync(decryptedCompressed);

    await this.logAction(userId, "retrievePatientImaging", "PatientImagingData", imagingId, true);

    return {
      patientId: doc.patientId,
      imagingType: doc.imagingType,
      imageData: decompressed,
      metadata: doc.metadata,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  // --- 3D Model with Versioning ---

  async store3DModelVersion(
    userId: string,
    patientId: string,
    modelData: Buffer,
    metadata: Record<string, any>
  ): Promise<number> {
    if (!this.threeDModelsCollection) throw new Error("DB not initialized");
    if (!this.checkAccess(userId, patientId)) {
      await this.logAction(userId, "store3DModelVersion", "3DModel", patientId, false, { reason: "access denied" });
      throw new Error("Access Denied");
    }

    const session = this.client.startSession();
    try {
      session.startTransaction();
      const existing = await this.threeDModelsCollection.findOne({ patientId }, { session });

      const compressedModel = zlib.deflateSync(modelData);
      const { cipherText, iv, authTag } = this.encryptData(compressedModel);

      const newVersion: ThreeDModelVersion = {
        version: 1,
        modelData: cipherText,
        metadata,
        createdAt: new Date(),
      };

      if (existing) {
        const versions: ThreeDModelVersion[] = existing.versions || [];
        const lastVersion = versions[versions.length - 1];
        newVersion.version = lastVersion ? lastVersion.version + 1 : 1;

        await this.threeDModelsCollection.updateOne(
          { patientId },
          {
            $push: { versions: newVersion },
            $set: { updatedAt: new Date() },
          },
          { session }
        );
      } else {
        await this.threeDModelsCollection.insertOne(
          {
            patientId,
            versions: [newVersion],
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          { session }
        );
      }

      await this.logAction(userId, "store3DModelVersion", "3DModel", patientId, true, { version: newVersion.version }, session);
      await session.commitTransaction();
      return newVersion.version;
    } catch (e) {
      await session.abortTransaction();
      await this.logAction(userId, "store3DModelVersion", "3DModel", patientId, false, { error: (e as Error).message }, session);
      throw e;
    } finally {
      await session.endSession();
    }
  }

  async retrieve3DModelVersion(
    userId: string,
    patientId: string,
    version?: number
  ): Promise<{ modelData: Buffer; metadata: Record<string, any>; version: number; createdAt: Date } | null> {
    if (!this.threeDModelsCollection) throw new Error("DB not initialized");
    if (!this.checkAccess(userId, patientId)) {
      await this.logAction(userId, "retrieve3DModelVersion", "3DModel", patientId, false, { reason: "access denied" });
      throw new Error("Access Denied");
    }

    const doc = await this.threeDModelsCollection.findOne({ patientId });
    if (!doc || !doc.versions || doc.versions.length === 0) {
      await this.logAction(userId, "retrieve3DModelVersion", "3DModel", patientId, false, { reason: "model not found" });
      return null;
    }

    let modelVersion: ThreeDModelVersion | undefined;
    if (version === undefined) {
      modelVersion = doc.versions.reduce((prev: ThreeDModelVersion | undefined, curr: ThreeDModelVersion) =>
        prev && prev.version > curr.version ? prev : curr
      );
    } else {
      modelVersion = doc.versions.find((v: ThreeDModelVersion) => v.version === version);
    }
    if (!modelVersion) {
      await this.logAction(userId, "retrieve3DModelVersion", "3DModel", patientId, false, { reason: "version not found", requestedVersion: version });
      return null;
    }

    if (!modelVersion.modelData) return null;

    // modelData is encrypted; assume metadata includes iv and tag inside metadata.enc (must extend to store them)
    // To handle encryption details, we store iv and tag inside modelData encrypted blob or separately.
    // Here let's embed IV and tag prefixed for simplicity: [iv(12)][authTag(16)][cipherText]
    // Adjust if needed.

    // Extract iv and authTag from modelData buffer prefix:
    const modelBuffer = modelVersion.modelData;
    if (modelBuffer.length < IV_LENGTH + 16) throw new Error("Invalid encrypted model data");

    const iv = modelBuffer.slice(0, IV_LENGTH);
    const authTag = modelBuffer.slice(IV_LENGTH, IV_LENGTH + 16);
    const cipherText = modelBuffer.slice(IV_LENGTH + 16);

    const decryptedCompressed = this.decryptData(cipherText, iv, authTag);
    const decompressed = zlib.inflateSync(decryptedCompressed);

    await this.logAction(userId, "retrieve3DModelVersion", "3DModel", patientId, true, { requestedVersion: modelVersion.version });

    return {
      modelData: decompressed,
      metadata: modelVersion.metadata,
      version: modelVersion.version,
      createdAt: modelVersion.createdAt,
    };
  }

  // --- Analysis Results ---

  async storeAnalysisResult(
    userId: string,
    analysisId: string,
    patientId: string,
    resultData: any
  ): Promise<void> {
    if (!this.analysisResultsCollection) throw new Error("DB not initialized");
    if (!this.checkAccess(userId, patientId)) {
      await this.logAction(userId, "storeAnalysisResult", "AnalysisResult", analysisId, false, { reason: "access denied" });
      throw new Error("Access Denied");
    }

    const jsonString = JSON.stringify(resultData);
    const { cipherText, iv, authTag } = this.encryptData(jsonString);

    const session = this.client.startSession();
    try {
      session.startTransaction();
      await this.analysisResultsCollection.updateOne(
        { analysisId },
        {
          $set: {
            patientId,
            resultData: cipherText,
            enc: { iv, tag: authTag },
            createdAt: new Date(),
          },
        },
        { upsert: true, session }
      );
      await this.logAction(userId, "storeAnalysisResult", "AnalysisResult", analysisId, true, undefined, session);
      await session.commitTransaction();
    } catch (e) {
      await session.abortTransaction();
      await this.logAction(userId, "storeAnalysisResult", "AnalysisResult", analysisId, false, { error: (e as Error).message }, session);
      throw e;
    } finally {
      await session.endSession();
    }
  }

  async retrieveAnalysisResult(
    userId: string,
    analysisId: string
  ): Promise<any | null> {
    if (!this.analysisResultsCollection) throw new Error("DB not initialized");

    const doc = await this.analysisResultsCollection.findOne({ analysisId });
    if (!doc) {
      await this.logAction(userId, "retrieveAnalysisResult", "AnalysisResult", analysisId, false, { reason: "not found" });
      return null;
    }

    if (!this.checkAccess(userId, doc.patientId)) {
      await this.logAction(userId, "retrieveAnalysisResult", "AnalysisResult", analysisId, false, { reason: "access denied" });
      throw new Error("Access Denied");
    }

    if (!doc.enc || !doc.enc.iv || !doc.enc.tag) throw new Error("Encryption metadata missing");

    const decryptedBuffer = this.decryptData(doc.resultData.buffer, doc.enc.iv.buffer, doc.enc.tag.buffer);
    const jsonStr = decryptedBuffer.toString("utf8");
    const data = JSON.parse(jsonStr);

    await this.logAction(userId, "retrieveAnalysisResult", "AnalysisResult", analysisId, true);

    return data;
  }

  // --- Backup & Recovery ---

  async createBackup(userId: string): Promise<string> {
    if (!this.db || !this.backupsCollection) throw new Error("DB not initialized");

    // NOTE: This is a simplified backup strategy,
    // in real-world systems backup would be done with full consistency checks and off-site storage.

    const session = this.client.startSession();
    try {
      session.startTransaction();

      // Extract relevant collections data
      const patientImagingData = await this.patientImagingCollection!.find({}, { session }).toArray();
      const threeDModels = await this.threeDModelsCollection!.find({}, { session }).toArray();
      const analysisResults = await this.analysisResultsCollection!.find({}, { session }).toArray();

      const dumpObject = {
        patientImagingData,
        threeDModels,
        analysisResults,
      };

      const jsonDump = Buffer.from(JSON.stringify(dumpObject), "utf8");
      const compressed = zlib.deflateSync(jsonDump);
      const { cipherText, iv, authTag } = this.encryptData(compressed);

      // Store backup blob prefixed with iv + tag + cipherText
      const backupBlob = Buffer.concat([iv, authTag, cipherText]);

      const backupId = crypto.randomUUID();
      await this.backupsCollection.insertOne(
        {
          backupId,
          timestamp: new Date(),
          dataDump: backupBlob,
        },
        { session }
      );
      await this.logAction(userId, "createBackup", "Backup", backupId, true, undefined, session);
      await session.commitTransaction();
      return backupId;
    } catch (e) {
      await session.abortTransaction();
      await this.logAction(userId, "createBackup", "Backup", "N/A", false, { error: (e as Error).message }, session);
      throw e;
    } finally {
      await session.endSession();
    }
  }

  async restoreBackup(userId: string, backupId: string): Promise<void> {
    if (!this.db || !this.backupsCollection) throw new Error("DB not