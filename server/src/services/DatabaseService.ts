```typescript
import { Pool, PoolClient, QueryConfig, QueryResult } from 'pg';
import { performance } from 'perf_hooks';

interface DatabaseConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
  maxPoolSize?: number;
  connectionTimeoutMillis?: number;
  idleTimeoutMillis?: number;
  maxRetries?: number;
  retryDelayMillis?: number;
  backupCommand?: string;
}

export class DatabaseService {
  private pool: Pool;
  private config: Required<DatabaseConfig>;

  constructor(config: DatabaseConfig) {
    this.config = {
      maxPoolSize: 10,
      connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 10000,
      maxRetries: 5,
      retryDelayMillis: 2000,
      backupCommand: '',
      ...config,
    };
    this.pool = new Pool({
      host: this.config.host,
      port: this.config.port,
      user: this.config.user,
      password: this.config.password,
      database: this.config.database,
      max: this.config.maxPoolSize,
      idleTimeoutMillis: this.config.idleTimeoutMillis,
      connectionTimeoutMillis: this.config.connectionTimeoutMillis,
    });
    this.pool.on('error', (err) => {
      console.error('Unexpected pool error', err);
    });
  }

  private async connectWithRetry(): Promise<PoolClient> {
    let attempts = 0;
    while (attempts < this.config.maxRetries) {
      try {
        const client = await this.pool.connect();
        return client;
      } catch (err) {
        attempts++;
        console.warn(
          `DB connection attempt ${attempts} failed: ${(err as Error).message}`
        );
        if (attempts >= this.config.maxRetries) throw err;
        await new Promise((r) => setTimeout(r, this.config.retryDelayMillis));
      }
    }
    // Should never reach here
    throw new Error('Failed to connect to database after retries');
  }

  async query<T = any>(
    queryTextOrConfig: string | QueryConfig<any[]>
  ): Promise<QueryResult<T>> {
    const startTime = performance.now();
    let client: PoolClient | null = null;
    try {
      client = await this.connectWithRetry();
      const result = await client.query<T>(queryTextOrConfig);
      this.logQuery(queryTextOrConfig, performance.now() - startTime);
      return result;
    } finally {
      client?.release();
    }
  }

  async preparedQuery<T = any>(
    text: string,
    values: any[]
  ): Promise<QueryResult<T>> {
    const startTime = performance.now();
    let client: PoolClient | null = null;
    try {
      client = await this.connectWithRetry();
      const result = await client.query<T>({ text, values });
      this.logQuery({ text, values }, performance.now() - startTime);
      return result;
    } finally {
      client?.release();
    }
  }

  async transaction<T>(
    executor: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await this.connectWithRetry();
    const startTime = performance.now();
    try {
      await client.query('BEGIN');
      const result = await executor(client);
      await client.query('COMMIT');
      this.logTransaction(performance.now() - startTime, true);
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      this.logTransaction(performance.now() - startTime, false);
      throw err;
    } finally {
      client.release();
    }
  }

  private logQuery(query: string | QueryConfig<any[]>, durationMs: number) {
    const q =
      typeof query === 'string'
        ? query
        : `${query.text} -- values: ${JSON.stringify(query.values)}`;
    console.info(`[DB QUERY] (${durationMs.toFixed(2)}ms): ${q}`);
  }

  private logTransaction(durationMs: number, success: boolean) {
    console.info(
      `[DB TRANSACTION] (${durationMs.toFixed(2)}ms): ${success ? 'COMMIT' : 'ROLLBACK'}`
    );
  }

  async triggerBackup(): Promise<void> {
    if (!this.config.backupCommand) {
      console.warn('Backup command not configured. Skipping backup.');
      return;
    }
    // Backup triggered by external command, e.g. pg_dump or custom script
    const { exec } = await import('child_process');
    console.info('Starting database backup...');
    return new Promise((resolve, reject) => {
      exec(this.config.backupCommand, (error, stdout, stderr) => {
        if (error) {
          console.error('Database backup failed:', error);
          return reject(error);
        }
        if (stderr) {
          console.warn('Database backup stderr:', stderr);
        }
        console.info('Database backup completed successfully.');
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // Simple query builder helpers

  buildSelect(
    table: string,
    columns: string[] = ['*'],
    where?: Record<string, any>
  ): QueryConfig {
    let text = `SELECT ${columns.join(', ')} FROM ${table}`;
    const values: any[] = [];
    if (where && Object.keys(where).length > 0) {
      const whereClauses = Object.entries(where).map(([key, val], i) => {
        values.push(val);
        return `${key} = $${i + 1}`;
      });
      text += ` WHERE ${whereClauses.join(' AND ')}`;
    }
    return { text, values };
  }

  buildInsert(
    table: string,
    data: Record<string, any>
  ): QueryConfig {
    const keys = Object.keys(data);
    const values = Object.values(data);
    const params = keys.map((_, i) => `$${i + 1}`);
    const text = `INSERT INTO ${table} (${keys.join(
      ', '
    )}) VALUES (${params.join(', ')}) RETURNING *`;
    return { text, values };
  }

  buildUpdate(
    table: string,
    data: Record<string, any>,
    where: Record<string, any>
  ): QueryConfig {
    const setKeys = Object.keys(data);
    const whereKeys = Object.keys(where);
    const values = [...Object.values(data), ...Object.values(where)];

    const setClause = setKeys
      .map((key, i) => `${key} = $${i + 1}`)
      .join(', ');
    const whereClause = whereKeys
      .map((key, i) => `${key} = $${i + 1 + setKeys.length}`)
      .join(' AND ');

    const text = `UPDATE ${table} SET ${setClause} WHERE ${whereClause} RETURNING *`;
    return { text, values };
  }

  buildDelete(
    table: string,
    where: Record<string, any>
  ): QueryConfig {
    const whereKeys = Object.keys(where);
    const values = Object.values(where);

    const whereClause = whereKeys
      .map((key, i) => `${key} = $${i + 1}`)
      .join(' AND ');

    const text = `DELETE FROM ${table} WHERE ${whereClause}`;
    return { text, values };
  }
}
```
