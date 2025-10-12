```typescript
import { Client, Pool, PoolClient } from 'pg';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

interface Migration {
  version: number;
  name: string;
  up: (client: PoolClient) => Promise<void>;
  down: (client: PoolClient) => Promise<void>;
  checksum?: string;
}

interface MigrationRecord {
  version: number;
  name: string;
  applied_at: Date;
  checksum: string;
}

interface MigrationManagerOptions {
  migrationsPath: string;
  pool: Pool;
  dryRun?: boolean;
  backupCommand?: string | null;
  lockKey?: number;
  historyTable?: string;
  migrationFilePattern?: RegExp;
}

const DEFAULT_LOCK_KEY = 0x4d494752; // 'MIGR' as a number

export class MigrationManager {
  private migrationsPath: string;
  private pool: Pool;
  private dryRun: boolean;
  private backupCommand: string | null;
  private lockKey: number;
  private historyTable: string;
  private migrationFilePattern: RegExp;
  private migrations: Migration[];

  constructor(options: MigrationManagerOptions) {
    this.migrationsPath = options.migrationsPath;
    this.pool = options.pool;
    this.dryRun = options.dryRun ?? false;
    this.backupCommand = options.backupCommand ?? null;
    this.lockKey = options.lockKey ?? DEFAULT_LOCK_KEY;
    this.historyTable = options.historyTable ?? 'migration_history';
    this.migrationFilePattern = options.migrationFilePattern ?? /^(\d+)_(.+)\.ts$/;
    this.migrations = [];
  }

  async init() {
    await this.ensureHistoryTable();
    await this.loadMigrationsFromFs();
  }

  private async ensureHistoryTable() {
    const createTableSQL = `
      CREATE TABLE IF NOT EXISTS ${this.historyTable} (
        version INT PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        checksum TEXT NOT NULL
      );
    `;
    await this.pool.query(createTableSQL);
  }

  private async loadMigrationsFromFs() {
    const files = await fs.promises.readdir(this.migrationsPath);
    const migrations: Migration[] = [];

    for (const file of files) {
      const match = file.match(this.migrationFilePattern);
      if (!match) continue;

      const version = parseInt(match[1], 10);
      const name = match[2];
      const fullPath = path.join(this.migrationsPath, file);

      const source = await fs.promises.readFile(fullPath, 'utf-8');
      const checksum = crypto.createHash('sha256').update(source).digest('hex');

      // Import migration file dynamically
      // Use dynamic import with absolute path and ts-node or compiled js context assumed
      let mod: { up: (client: PoolClient) => Promise<void>; down: (client: PoolClient) => Promise<void> };
      try {
        mod = await import(fullPath);
        if (typeof mod.up !== 'function' || typeof mod.down !== 'function') {
          throw new Error(`Migration file ${file} must export async functions 'up' and 'down'`);
        }
      } catch (err) {
        throw new Error(`Failed to load migration file ${file}: ${String(err)}`);
      }

      migrations.push({
        version,
        name,
        up: mod.up,
        down: mod.down,
        checksum,
      });
    }

    // Sort by version ascending
    migrations.sort((a, b) => a.version - b.version);
    this.migrations = migrations;
  }

  private async getAppliedMigrations(): Promise<MigrationRecord[]> {
    const result = await this.pool.query(`SELECT version, name, applied_at, checksum FROM ${this.historyTable} ORDER BY version ASC`);
    return result.rows.map(row => ({
      version: row.version,
      name: row.name,
      applied_at: row.applied_at,
      checksum: row.checksum,
    }));
  }

  private async acquireLock(client: PoolClient) {
    // pg advisory lock for concurrency control
    const res = await client.query('SELECT pg_try_advisory_lock($1) as acquired', [this.lockKey]);
    if (!res.rows[0].acquired) {
      throw new Error('Could not acquire migration lock: another migration process is running');
    }
  }

  private async releaseLock(client: PoolClient) {
    await client.query('SELECT pg_advisory_unlock($1)', [this.lockKey]);
  }

  private async backupDatabase(): Promise<void> {
    if (!this.backupCommand) return;
    const { exec } = await import('child_process');
    return new Promise((resolve, reject) => {
      exec(this.backupCommand!, (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`Backup command failed: ${stderr || error.message}`));
          return;
        }
        resolve();
      });
    });
  }

  private validateMigrations(applied: MigrationRecord[]) {
    // Validate that applied migrations exist on disk and checksum match
    for (const record of applied) {
      const migration = this.migrations.find(m => m.version === record.version);
      if (!migration) {
        throw new Error(`Applied migration ${record.version} (${record.name}) is not found`);
      }
      if (migration.checksum !== record.checksum) {
        throw new Error(`Checksum mismatch for applied migration version ${record.version}: migration source has changed`);
      }
    }
  }

  async migrateUp(toVersion?: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.acquireLock(client);
      await this.backupDatabase();

      const appliedMigrations = await this.getAppliedMigrations();
      this.validateMigrations(appliedMigrations);
      const appliedVersions = new Set(appliedMigrations.map(m => m.version));

      const targetVersion = toVersion ?? Math.max(...this.migrations.map(m => m.version), 0);
      const migrationsToApply = this.migrations.filter(m => !appliedVersions.has(m.version) && m.version <= targetVersion);

      for (const migration of migrationsToApply) {
        if (this.dryRun) {
          console.log(`[Dry-run] Would apply migration ${migration.version}: ${migration.name}`);
          continue;
        }

        await client.query('BEGIN');
        try {
          await migration.up(client);
          await client.query(
            `INSERT INTO ${this.historyTable} (version, name, applied_at, checksum) VALUES ($1, $2, now(), $3)`,
            [migration.version, migration.name, migration.checksum]
          );
          await client.query('COMMIT');
          console.log(`Applied migration ${migration.version}: ${migration.name}`);
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Failed to apply migration ${migration.version} (${migration.name}): ${String(err)}`);
        }
      }
    } finally {
      try {
        await this.releaseLock(client);
      } finally {
        client.release();
      }
    }
  }

  async migrateDown(toVersion: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await this.acquireLock(client);
      await this.backupDatabase();

      const appliedMigrations = await this.getAppliedMigrations();
      this.validateMigrations(appliedMigrations);

      const appliedVersionsSet = new Set(appliedMigrations.map(m => m.version));
      if (!appliedVersionsSet.has(toVersion)) {
        throw new Error(`Target version ${toVersion} is not applied, cannot rollback to it`);
      }

      // Rollback in desc order from latest applied down to (toVersion + 1)
      const toRollback = appliedMigrations
        .filter(m => m.version > toVersion)
        .sort((a, b) => b.version - a.version);

      for (const record of toRollback) {
        const migration = this.migrations.find(m => m.version === record.version);
        if (!migration) {
          throw new Error(`Cannot rollback missing migration version ${record.version}`);
        }

        if (this.dryRun) {
          console.log(`[Dry-run] Would rollback migration ${migration.version}: ${migration.name}`);
          continue;
        }

        await client.query('BEGIN');
        try {
          await migration.down(client);
          await client.query(`DELETE FROM ${this.historyTable} WHERE version = $1`, [migration.version]);
          await client.query('COMMIT');
          console.log(`Rolled back migration ${migration.version}: ${migration.name}`);
        } catch (err) {
          await client.query('ROLLBACK');
          throw new Error(`Failed to rollback migration ${migration.version} (${migration.name}): ${String(err)}`);
        }
      }
    } finally {
      try {
        await this.releaseLock(client);
      } finally {
        client.release();
      }
    }
  }

  async currentVersion(): Promise<number> {
    const result = await this.pool.query(`SELECT MAX(version) AS max_version FROM ${this.historyTable}`);
    const maxVersion = result.rows[0]?.max_version;
    return maxVersion ?? 0;
  }

  async history(): Promise<MigrationRecord[]> {
    return this.getAppliedMigrations();
  }
}
```
