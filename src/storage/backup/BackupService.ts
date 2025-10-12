```typescript
import AWS from "aws-sdk";
import { BlobServiceClient } from "@azure/storage-blob";
import crypto from "crypto";
import schedule from "node-schedule";
import EventEmitter from "events";

type BackupType = "FULL" | "INCREMENTAL";
type CloudProvider = "AWS" | "AZURE";

interface BackupOptions {
  type: BackupType;
  sourcePath: string;
  destinationPath: string;
  encryptionKey: Buffer;
  retentionDays: number;
  crossRegionReplication?: boolean;
  crossRegionDestination?: string;
}

interface BackupRecord {
  id: string;
  backupType: BackupType;
  timestamp: number;
  hash: string;
  cloudProvider: CloudProvider;
  location: string;
}

interface RestoreOptions {
  backupId: string;
  restorePath: string;
  encryptionKey: Buffer;
}

interface MonitoringAlert {
  level: "INFO" | "WARNING" | "CRITICAL";
  message: string;
  timestamp: number;
}

export class BackupService extends EventEmitter {
  private s3: AWS.S3;
  private azureBlobServiceClient: BlobServiceClient;
  private bucketName: string;
  private azureContainerName: string;
  private cloudProvider: CloudProvider;
  private backups: Map<string, BackupRecord> = new Map();
  private backupScheduleJob?: schedule.Job;

  constructor(
    cloudProvider: CloudProvider,
    config: {
      awsConfig?: AWS.S3.ClientConfiguration & { bucketName: string };
      azureConfig?: { connectionString: string; containerName: string };
    }
  ) {
    super();

    this.cloudProvider = cloudProvider;

    if (cloudProvider === "AWS") {
      if (!config.awsConfig) throw new Error("AWS config required.");
      AWS.config.update(config.awsConfig);
      this.s3 = new AWS.S3(config.awsConfig);
      this.bucketName = config.awsConfig.bucketName;
    } else {
      if (!config.azureConfig) throw new Error("Azure config required.");
      this.azureBlobServiceClient = BlobServiceClient.fromConnectionString(
        config.azureConfig.connectionString
      );
      this.azureContainerName = config.azureConfig.containerName;
    }
  }

  public scheduleBackup(cronSchedule: string, options: BackupOptions) {
    if (this.backupScheduleJob) this.backupScheduleJob.cancel();

    this.backupScheduleJob = schedule.scheduleJob(cronSchedule, async () => {
      try {
        await this.backup(options);
      } catch (error) {
        this.emitAlert("CRITICAL", `Scheduled backup failed: ${error}`);
      }
    });
  }

  public async backup(options: BackupOptions): Promise<BackupRecord> {
    const timestamp = Date.now();
    const id = crypto.randomUUID();

    const dataBuffer = await this.fetchSourceData(options.sourcePath, options.type);

    const encryptedData = this.encryptData(dataBuffer, options.encryptionKey);
    const backupKey = this.generateBackupKey(options.destinationPath, id, timestamp, options.type);

    await this.uploadBackup(backupKey, encryptedData);

    const hash = this.hashData(encryptedData);

    if (options.crossRegionReplication && options.crossRegionDestination) {
      await this.crossRegionReplicate(backupKey, options.crossRegionDestination);
    }

    const backupRecord: BackupRecord = {
      id,
      backupType: options.type,
      timestamp,
      hash,
      cloudProvider: this.cloudProvider,
      location: backupKey,
    };
    this.backups.set(id, backupRecord);

    this.enforceRetentionPolicy(options.destinationPath, options.retentionDays);

    this.emitAlert("INFO", `Backup completed successfully: ${id}`);

    return backupRecord;
  }

  public async restore(options: RestoreOptions): Promise<void> {
    const backupRecord = this.backups.get(options.backupId);
    if (!backupRecord) throw new Error("Backup record not found.");

    const encryptedData = await this.downloadBackup(backupRecord.location);

    const hash = this.hashData(encryptedData);
    if (hash !== backupRecord.hash) throw new Error("Backup integrity check failed.");

    const decryptedData = this.decryptData(encryptedData, options.encryptionKey);

    await this.restoreDataToDestination(decryptedData, options.restorePath);

    this.emitAlert("INFO", `Restore completed successfully: ${options.backupId}`);
  }

  private async fetchSourceData(sourcePath: string, type: BackupType): Promise<Buffer> {
    // Placeholder: Replace with actual data extraction logic
    // For incremental, only changed data since last backup
    return Buffer.from(`Backup data at ${new Date().toISOString()} - ${type}`);
  }

  private encryptData(data: Buffer, key: Buffer): Buffer {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]);
  }

  private decryptData(encryptedData: Buffer, key: Buffer): Buffer {
    const iv = encryptedData.slice(0, 16);
    const tag = encryptedData.slice(16, 32);
    const data = encryptedData.slice(32);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]);
  }

  private hashData(data: Buffer): string {
    return crypto.createHash("sha256").update(data).digest("hex");
  }

  private generateBackupKey(
    basePath: string,
    id: string,
    timestamp: number,
    type: BackupType
  ): string {
    return `${basePath}/${type.toLowerCase()}_${timestamp}_${id}.bak`;
  }

  private async uploadBackup(key: string, data: Buffer): Promise<void> {
    if (this.cloudProvider === "AWS") {
      await this.s3
        .putObject({
          Bucket: this.bucketName,
          Key: key,
          Body: data,
          ServerSideEncryption: "AES256",
        })
        .promise();
    } else {
      const containerClient = this.azureBlobServiceClient.getContainerClient(this.azureContainerName);
      const blockBlobClient = containerClient.getBlockBlobClient(key);
      await blockBlobClient.uploadData(data, { blobHTTPHeaders: { blobContentType: "application/octet-stream" } });
    }
  }

  private async downloadBackup(key: string): Promise<Buffer> {
    if (this.cloudProvider === "AWS") {
      const res = await this.s3.getObject({ Bucket: this.bucketName, Key: key }).promise();
      if (!res.Body) throw new Error("Backup data not found.");
      return Buffer.isBuffer(res.Body) ? res.Body : Buffer.from(res.Body as Uint8Array);
    } else {
      const containerClient = this.azureBlobServiceClient.getContainerClient(this.azureContainerName);
      const blobClient = containerClient.getBlobClient(key);
      const downloadRes = await blobClient.download();
      const chunks: Uint8Array[] = [];
      return new Promise<Buffer>((resolve, reject) => {
        downloadRes.readableStreamBody
          ?.on("data", (chunk) => chunks.push(chunk))
          .on("end", () => resolve(Buffer.concat(chunks)))
          .on("error", reject);
      });
    }
  }

  private async crossRegionReplicate(sourceKey: string, destinationRegionPath: string): Promise<void> {
    // Cross-region replication: Copy backup to another path (bucket/container)

    if (this.cloudProvider === "AWS") {
      const destinationKey = `${destinationRegionPath}/${sourceKey.split("/").pop()}`;
      await this.s3
        .copyObject({
          Bucket: this.bucketName,
          CopySource: `/${this.bucketName}/${sourceKey}`,
          Key: destinationKey,
          ServerSideEncryption: "AES256",
        })
        .promise();
    } else {
      const sourceContainer = this.azureBlobServiceClient.getContainerClient(this.azureContainerName);
      const sourceBlobClient = sourceContainer.getBlobClient(sourceKey);

      // Assuming destinationRegionPath is container name in azure for replication
      const destinationContainer = this.azureBlobServiceClient.getContainerClient(destinationRegionPath);
      const destinationBlobClient = destinationContainer.getBlobClient(sourceKey.split("/").pop() || "");

      const downloadBlockBlobResponse = await sourceBlobClient.download();
      const chunks: Uint8Array[] = [];
      const dataBuffer: Buffer = await new Promise((resolve, reject) => {
        downloadBlockBlobResponse.readableStreamBody
          ?.on("data", (chunk) => chunks.push(chunk))
          .on("end", () => resolve(Buffer.concat(chunks)))
          .on("error", reject);
      });

      await destinationBlobClient.uploadData(dataBuffer, { blobHTTPHeaders: { blobContentType: "application/octet-stream" } });
    }
  }

  private async restoreDataToDestination(data: Buffer, restorePath: string): Promise<void> {
    // Placeholder for restoring data to a local or network path
    // Implementation depends on environment (filesystem, DB, etc.)
    // Example: Write file locally
    const fs = await import("fs/promises");
    await fs.writeFile(restorePath, data, { flag: "w" });
  }

  private async listBackupsInPath(path: string): Promise<BackupRecord[]> {
    // List backups filtered by path prefix
    return [...this.backups.values()].filter((b) => b.location.startsWith(path));
  }

  private async deleteBackupByKey(key: string): Promise<void> {
    if (this.cloudProvider === "AWS") {
      await this.s3.deleteObject({ Bucket: this.bucketName, Key: key }).promise();
    } else {
      const containerClient = this.azureBlobServiceClient.getContainerClient(this.azureContainerName);
      const blobClient = containerClient.getBlobClient(key);
      await blobClient.deleteIfExists();
    }
  }

  private async enforceRetentionPolicy(basePath: string, retentionDays: number): Promise<void> {
    const now = Date.now();
    const backups = await this.listBackupsInPath(basePath);
    const expiredBackups = backups.filter(
      (b) => now - b.timestamp > retentionDays * 24 * 60 * 60 * 1000
    );

    for (const backup of expiredBackups) {
      await this.deleteBackupByKey(backup.location);
      this.backups.delete(backup.id);
      this.emitAlert("INFO", `Expired backup deleted: ${backup.id}`);
    }
  }

  private emitAlert(level: MonitoringAlert["level"], message: string) {
    const alert: MonitoringAlert = {
      level,
      message,
      timestamp: Date.now(),
    };
    this.emit("alert", alert);
  }
}
```