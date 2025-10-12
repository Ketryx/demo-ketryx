```typescript
import { MongoClient, Collection, WithId, Document } from 'mongodb';

export type AnalysisType = 'blockage_detection' | 'anomaly_finding' | 'risk_assessment';

export interface AnalysisResultBase {
  patientId: string;
  analysisType: AnalysisType;
  softwareVersion: string;
  resultVersion: number;
  data: any;
  analyzedAt: Date;
  createdAt: Date;
  updatedAt: Date;
  archived?: boolean;
}

export interface BlockageDetectionResult extends AnalysisResultBase {
  analysisType: 'blockage_detection';
  data: {
    blockages: Array<{
      location: string;
      severity: 'mild' | 'moderate' | 'severe';
      confidence: number;
    }>;
  };
}

export interface AnomalyFindingResult extends AnalysisResultBase {
  analysisType: 'anomaly_finding';
  data: {
    anomalies: Array<{
      description: string;
      location?: string;
      confidence: number;
    }>;
  };
}

export interface RiskAssessmentResult extends AnalysisResultBase {
  analysisType: 'risk_assessment';
  data: {
    riskScore: number;
    riskLevel: 'low' | 'medium' | 'high' | 'critical';
    contributingFactors: string[];
  };
}

export type AnalysisResult =
  | BlockageDetectionResult
  | AnomalyFindingResult
  | RiskAssessmentResult;

export interface AuditLogEntry {
  timestamp: Date;
  userId: string;
  action: 'read' | 'write' | 'archive' | 'delete';
  targetId: string;
  details?: string;
}

export interface QueryFilters {
  patientId?: string;
  analysisTypes?: AnalysisType[];
  fromDate?: Date;
  toDate?: Date;
  includeArchived?: boolean;
  minResultVersion?: number;
  maxResultVersion?: number;
}

interface AnalysisResultsRepositoryOptions {
  uri: string;
  dbName: string;
  retentionDays?: number;
  archiveOlderThanDays?: number;
}

export class AnalysisResultsRepository {
  private client: MongoClient;
  private collection: Collection<AnalysisResult>;
  private auditCollection: Collection<AuditLogEntry>;
  private retentionDays: number;
  private archiveOlderThanDays: number;

  constructor(opts: AnalysisResultsRepositoryOptions) {
    this.client = new MongoClient(opts.uri);
    this.retentionDays = opts.retentionDays ?? 365 * 3; // default 3 years
    this.archiveOlderThanDays = opts.archiveOlderThanDays ?? 365 * 2; // default 2 years
    const db = this.client.db(opts.dbName);
    this.collection = db.collection<AnalysisResult>('analysis_results');
    this.auditCollection = db.collection<AuditLogEntry>('analysis_results_audit');
  }

  async connect(): Promise<void> {
    await this.client.connect();
    await this.ensureIndexes();
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }

  private async ensureIndexes(): Promise<void> {
    await this.collection.createIndexes([
      { key: { patientId: 1 } },
      { key: { analyzedAt: -1 } },
      { key: { analysisType: 1 } },
      { key: { softwareVersion: 1 } },
      { key: { resultVersion: -1 } },
      { key: { archived: 1 } },
      // Compound index for frequent queries:
      {
        key: {
          patientId: 1,
          analysisType: 1,
          analyzedAt: -1,
          resultVersion: -1,
        },
      },
    ]);
    await this.auditCollection.createIndex({ timestamp: -1 });
    await this.auditCollection.createIndex({ userId: 1 });
  }

  private async auditLog(
    userId: string,
    action: 'read' | 'write' | 'archive' | 'delete',
    targetId: string,
    details?: string
  ): Promise<void> {
    await this.auditCollection.insertOne({
      timestamp: new Date(),
      userId,
      action,
      targetId,
      details,
    });
  }

  async saveResult(
    userId: string,
    result: Omit<AnalysisResult, 'createdAt' | 'updatedAt' | 'archived'>
  ): Promise<WithId<AnalysisResult>> {
    const now = new Date();
    const latestVersionDoc = await this.collection.findOne(
      {
        patientId: result.patientId,
        analysisType: result.analysisType,
        softwareVersion: result.softwareVersion,
      },
      {
        sort: { resultVersion: -1 },
        projection: { resultVersion: 1 },
      }
    );
    const nextVersion = (latestVersionDoc?.resultVersion ?? 0) + 1;

    const doc: AnalysisResult = {
      ...result,
      resultVersion: nextVersion,
      createdAt: now,
      updatedAt: now,
      archived: false,
    };
    const res = await this.collection.insertOne(doc);
    await this.auditLog(userId, 'write', res.insertedId.toString(), `Saved analysis result version ${nextVersion}`);

    return { _id: res.insertedId, ...doc };
  }

  async queryResults(
    userId: string,
    filters: QueryFilters
  ): Promise<WithId<AnalysisResult>[]> {
    const query: Document = { archived: { $ne: true } };
    if (filters.patientId) query.patientId = filters.patientId;
    if (filters.analysisTypes && filters.analysisTypes.length > 0) {
      query.analysisType = { $in: filters.analysisTypes };
    }
    if (filters.fromDate || filters.toDate) {
      query.analyzedAt = {};
      if (filters.fromDate) query.analyzedAt.$gte = filters.fromDate;
      if (filters.toDate) query.analyzedAt.$lte = filters.toDate;
    }
    if (filters.includeArchived) delete query.archived;
    if (filters.minResultVersion !== undefined || filters.maxResultVersion !== undefined) {
      query.resultVersion = {};
      if (filters.minResultVersion !== undefined) query.resultVersion.$gte = filters.minResultVersion;
      if (filters.maxResultVersion !== undefined) query.resultVersion.$lte = filters.maxResultVersion;
    }

    const results = await this.collection.find(query).sort({ analyzedAt: -1 }).toArray();
    await Promise.all(results.map(r => this.auditLog(userId, 'read', r._id.toString(), 'Queried analysis result')));
    return results;
  }

  async aggregateResultsByPatientAndType(
    userId: string,
    fromDate: Date,
    toDate: Date
  ): Promise<
    Array<{
      patientId: string;
      analysisType: AnalysisType;
      count: number;
      latestAnalyzedAt: Date;
    }>
  > {
    const pipeline = [
      {
        $match: {
          analyzedAt: { $gte: fromDate, $lte: toDate },
          archived: { $ne: true },
        },
      },
      {
        $group: {
          _id: { patientId: '$patientId', analysisType: '$analysisType' },
          count: { $sum: 1 },
          latestAnalyzedAt: { $max: '$analyzedAt' },
        },
      },
      {
        $project: {
          _id: 0,
          patientId: '$_id.patientId',
          analysisType: '$_id.analysisType',
          count: 1,
          latestAnalyzedAt: 1,
        },
      },
      {
        $sort: {
          patientId: 1,
          analysisType: 1,
        },
      },
    ];

    const aggResult = await this.collection.aggregate(pipeline).toArray();
    await this.auditLog(userId, 'read', 'aggregation', `Aggregated results between ${fromDate.toISOString()} and ${toDate.toISOString()}`);
    return aggResult;
  }

  async enforceDataRetentionPolicy(userId: string): Promise<void> {
    const retentionThreshold = new Date(Date.now() - this.retentionDays * 24 * 60 * 60 * 1000);

    // Hard delete results older than retentionDays AND already archived
    const deleteResult = await this.collection.deleteMany({
      archived: true,
      updatedAt: { $lt: retentionThreshold },
    });

    await this.auditLog(
      userId,
      'delete',
      'bulk',
      `Deleted ${deleteResult.deletedCount} archived analysis results older than ${retentionThreshold.toISOString()}`
    );
  }

  async archiveOldResults(userId: string): Promise<void> {
    const archiveThreshold = new Date(Date.now() - this.archiveOlderThanDays * 24 * 60 * 60 * 1000);

    const updateResult = await this.collection.updateMany(
      {
        archived: { $ne: true },
        updatedAt: { $lt: archiveThreshold },
      },
      {
        $set: { archived: true, updatedAt: new Date() },
      }
    );

    await this.auditLog(
      userId,
      'archive',
      'bulk',
      `Archived ${updateResult.modifiedCount} analysis results older than ${archiveThreshold.toISOString()}`
    );
  }

  async getResultById(userId: string, id: string): Promise<WithId<AnalysisResult> | null> {
    const objId = new MongoClient.ObjectId(id);
    const result = await this.collection.findOne({ _id: objId });
    if (result) {
      await this.auditLog(userId, 'read', id, 'Fetched analysis result by ID');
    }
    return result;
  }
}
```