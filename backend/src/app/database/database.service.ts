import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type { ResultSetHeader } from 'mysql2/promise';
import * as mysql from 'mysql2/promise';

// Satu pool untuk seluruh aplikasi. Sebelumnya setiap module membuat pool
// sendiri (ConfigService di-instantiate 3x), sehingga koneksi membengkak.
@Injectable()
export class DatabaseService implements OnModuleDestroy {
  private readonly logger = new Logger(DatabaseService.name);
  private pool: mysql.Pool | null = null;

  private getPool(): mysql.Pool {
    if (!this.pool) {
      this.pool = mysql.createPool({
        host: process.env.DB_HOST || '127.0.0.1',
        port: Number(process.env.DB_PORT) || 3306,
        user: process.env.DB_USER || 'isp_billing',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'isp_billing',
        waitForConnections: true,
        connectionLimit: 10,
        // DECIMAL dikembalikan sebagai string oleh mysql2; nominal rupiah butuh number.
        decimalNumbers: true,
      });
    }
    return this.pool;
  }

  async query<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const [rows] = await this.getPool().query(sql, params);
    return rows as T[];
  }

  async queryOne<T>(sql: string, params: unknown[] = []): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }

  async execute(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
    const [result] = await this.getPool().query<ResultSetHeader>(sql, params);
    return result;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.pool) {
      await this.pool.end();
      this.pool = null;
      this.logger.log('Pool database ditutup');
    }
  }
}
