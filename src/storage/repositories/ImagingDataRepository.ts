```typescript
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { pipeline } from 'stream/promises';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { Readable } from 'stream';

export interface ImagingData {
  id: string;
  patientId: string;
  studyDate: string; // ISO Date string YYYY-MM-DD
  fileName: string;
  metadata: Record<string, any>;
  checksum: string;
  iv: Buffer; // initialization vector for AES encryption
  createdAt: Date;
  updatedAt: Date;
}

export interface Repository<T> {
  save(item: T, fileStream: Readable): Promise<T>;
  saveBatch(items: T[], fileStreams: Array<Readable>): Promise<T[]>;
  getById(id: string): Promise<T | null>;
  queryByPatientId(patientId: string): Promise<T[]>;
  queryByStudyDate(studyDate: string): Promise<T[]>;
  deleteById(id: string): Promise<void>;
  cleanupOrphanedData(validIds: Set<string>): Promise<void>;
}

interface StoredFileInfo {
  filePath: string;
  iv: Buffer;
  checksum: string;
}

const ENCRYPTION_ALGORITHM = 'aes-256-cbc';
const KEY_LENGTH = 32; // 256 bits
const STORAGE_DIR = path.resolve(__dirname, '../../storage/imaging-files');

export class ImagingDataRepository implements Repository<ImagingData> {
  private encryptionKey: Buffer;
  // Simulate a metadata index (replace with real DB in prod)
  private dataStore: Map<string, ImagingData> = new Map();

  constructor(encryptionKey?: Buffer) {
    if (encryptionKey && encryptionKey.length === KEY_LENGTH) {
      this.encryptionKey = encryptionKey;
    } else {
      throw new Error(
        `Encryption key must be a Buffer with length ${KEY_LENGTH}`
      );
    }
  }

  private async ensureStorageDir() {
    try {
      await fs.mkdir(STORAGE_DIR, { recursive: true });
    } catch {
      // ignore if already exists
    }
  }

  private async computeChecksum(stream: Readable): Promise<string> {
    const hash = crypto.createHash('sha256');
    return new Promise((resolve, reject) => {
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  private async encryptAndSaveFile(
    inputStream: Readable,
    fileName: string
  ): Promise<{ iv: Buffer; checksum: string; filePath: string }> {
    await this.ensureStorageDir();
    const iv = randomBytes(16);
    const cipher = createCipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
    const encryptedFilePath = path.join(STORAGE_DIR, fileName);

    const hash = crypto.createHash('sha256');
    // We will pipe inputStream -> hash & cipher -> file
    // So inputStream feeds two destinations simultaneously: hash and cipher, use PassThrough
    const passThroughForHash = new (await import('stream')).PassThrough();
    inputStream.pipe(passThroughForHash);

    // Hash stream
    const hashPromise = new Promise<string>((resolve, reject) => {
      hash.on('error', reject);
      passThroughForHash.on('data', (chunk) => hash.update(chunk));
      passThroughForHash.on('end', () => resolve(hash.digest('hex')));
    });

    // Encrypt and write file stream
    const encryptedWriteStream = (await import('fs')).createWriteStream(
      encryptedFilePath
    );

    // Re-create inputStream to avoid consumption?
    // We must clone inputStream? But it’s not possible with a generic Readable.
    // To process hash and encrypt at the same time, use Tee with PassThrough streams.
    // Since inputStream was already piped into passThroughForHash, instead pipe inputStream into two PassThrough:
    // Here, inputStream is piped to passThroughForHash, which feeds the hash.
    // But we also need to encrypt the original inputStream, so we create another PassThrough.
    // Practical way: use an intermediate Tee stream.

    // Redesign the method: buffer the stream entirely into memory (works only for reasonably sized files)
    // Given the complexity in streaming and computing hash and encryption simult., buffer file in memory:

    const buffers: Buffer[] = [];
    for await (const chunk of inputStream) {
      buffers.push(chunk);
    }
    const fileBuffer = Buffer.concat(buffers);

    // checksum
    const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
    // encrypt
    const encrypted = Buffer.concat([
      cipher.update(fileBuffer),
      cipher.final(),
    ]);
    await fs.writeFile(encryptedFilePath, encrypted);

    return { iv, checksum, filePath: encryptedFilePath };
  }

  private async decryptFile(
    filePath: string,
    iv: Buffer
  ): Promise<Buffer> {
    const encryptedData = await fs.readFile(filePath);
    const decipher = createDecipheriv(ENCRYPTION_ALGORITHM, this.encryptionKey, iv);
    const decrypted = Buffer.concat([
      decipher.update(encryptedData),
      decipher.final(),
    ]);
    return decrypted;
  }

  private extractMetadataFromDicomBuffer(buffer: Buffer): Record<string, any> {
    // Stub metadata extraction, real DICOM parsing requires complex libs.
    // We'll simulate extracting patientId, studyDate from "tags" in buffer, here returning empty object.

    // In real implementation, use libraries like dcmjs or dicom-parser
    return {};
  }

  async save(imagingData: ImagingData, fileStream: Readable): Promise<ImagingData> {
    try {
      if (!imagingData.id) {
        imagingData.id = crypto.randomUUID();
      }

      const fileName = `${imagingData.id}.dcm`;
      const { iv, checksum, filePath } = await this.encryptAndSaveFile(fileStream, fileName);
      const decryptedContent = await this.decryptFile(filePath, iv);
      const metadata = this.extractMetadataFromDicomBuffer(decryptedContent);

      if (
        imagingData.checksum &&
        imagingData.checksum !== checksum
      ) {
        throw new Error('File checksum mismatch detected');
      }

      const now = new Date();
      const record: ImagingData = {
        ...imagingData,
        fileName,
        metadata: metadata,
        checksum,
        iv,
        createdAt: imagingData.createdAt ?? now,
        updatedAt: now,
      };

      this.dataStore.set(record.id, record);
      return record;
    } catch (err) {
      throw new Error(`Failed to save imaging data: ${(err as Error).message}`);
    }
  }

  async saveBatch(
    imagingItems: ImagingData[],
    fileStreams: Array<Readable>
  ): Promise<ImagingData[]> {
    if (imagingItems.length !== fileStreams.length) {
      throw new Error('Items count must match file streams count');
    }
    const savedItems: ImagingData[] = [];
    for (let i = 0; i < imagingItems.length; i++) {
      const saved = await this.save(imagingItems[i], fileStreams[i]);
      savedItems.push(saved);
    }
    return savedItems;
  }

  async getById(id: string): Promise<ImagingData | null> {
    const record = this.dataStore.get(id) ?? null;
    return record;
  }

  async queryByPatientId(patientId: string): Promise<ImagingData[]> {
    const results: ImagingData[] = [];
    for (const item of this.dataStore.values()) {
      if (item.patientId === patientId) results.push(item);
    }
    return results;
  }

  async queryByStudyDate(studyDate: string): Promise<ImagingData[]> {
    const results: ImagingData[] = [];
    for (const item of this.dataStore.values()) {
      if (item.studyDate === studyDate) results.push(item);
    }
    return results;
  }

  async deleteById(id: string): Promise<void> {
    const record = this.dataStore.get(id);
    if (!record) {
      throw new Error(`Imaging data with id ${id} does not exist`);
    }
    const filePath = path.join(STORAGE_DIR, record.fileName);
    try {
      await fs.unlink(filePath);
    } catch (err) {
      // if file does not exist, ignore
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
    this.dataStore.delete(id);
  }

  async cleanupOrphanedData(validIds: Set<string>): Promise<void> {
    // Delete stored files + metadata with IDs not in validIds
    const toRemove: string[] = [];
    for (const id of this.dataStore.keys()) {
      if (!validIds.has(id)) {
        toRemove.push(id);
      }
    }
    for (const id of toRemove) {
      try {
        await this.deleteById(id);
      } catch {
        // log and continue
      }
    }
  }
}
```