import { Injectable } from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';

// Jejak keuangan append-only (migrasi 032). Dipisahkan dari audit_logs karena
// audit_logs tidak punya before/after dan FK user-nya ON DELETE CASCADE —
// jejak bisa hilang saat akun dihapus. Tabel ini tanpa FK dan tanpa endpoint
// ubah/hapus: satu-satunya operasi adalah INSERT dan SELECT.
export type FinanceEntityType = 'invoice' | 'payment';

export type FinanceAction =
  | 'INVOICE_CREATED'
  | 'INVOICE_UPDATED'
  | 'INVOICE_VOIDED'
  | 'PAYMENT_CREATED'
  | 'PAYMENT_VOIDED';

export interface FinanceActor {
  id: number;
  name: string;
  email: string;
  ip: string;
}

export interface NewFinanceEvent {
  entityType: FinanceEntityType;
  entityId: number;
  action: FinanceAction;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  reason?: string | null;
  actor: FinanceActor;
}

export interface FinanceEvent {
  id: number;
  entity_type: FinanceEntityType;
  entity_id: number;
  action: FinanceAction;
  before_json: Record<string, unknown> | null;
  after_json: Record<string, unknown> | null;
  reason: string | null;
  actor_id: number | null;
  actor_name: string | null;
  ip_address: string;
  created_at: Date;
}

// Ditulis di dalam transaksi pemanggil: bila INSERT gagal, perubahan bisnis
// ikut rollback. Jangan menambah .catch() di sini — kegagalan audit harus
// menggagalkan transaksi.
export async function writeFinanceEvent(
  conn: PoolConnection,
  event: NewFinanceEvent,
): Promise<void> {
  await conn.query(
    `INSERT INTO finance_events
       (entity_type, entity_id, action, before_json, after_json, reason, actor_id, actor_name, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      event.entityType,
      event.entityId,
      event.action,
      event.before ? JSON.stringify(event.before) : null,
      event.after ? JSON.stringify(event.after) : null,
      event.reason?.trim() || null,
      event.actor.id,
      event.actor.name.slice(0, 100),
      event.actor.ip.slice(0, 45),
    ],
  );
}

interface FinanceEventRow extends RowDataPacket {
  id: number;
  entity_type: FinanceEntityType;
  entity_id: number;
  action: FinanceAction;
  before_json: string | null;
  after_json: string | null;
  reason: string | null;
  actor_id: number | null;
  actor_name: string | null;
  ip_address: string;
  created_at: Date;
}

function parseJson(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as Record<string, unknown>;
  } catch {
    return null;
  }
}

@Injectable()
export class FinanceEventsRepository {
  constructor(private readonly db: DatabaseService) {}

  async list(entityType: FinanceEntityType, entityId: number): Promise<FinanceEvent[]> {
    const rows = await this.db.query<FinanceEventRow>(
      `SELECT id, entity_type, entity_id, action, before_json, after_json, reason,
              actor_id, actor_name, ip_address, created_at
         FROM finance_events
        WHERE entity_type = ? AND entity_id = ?
        ORDER BY id DESC`,
      [entityType, entityId],
    );
    return rows.map((row) => ({
      ...row,
      before_json: parseJson(row.before_json),
      after_json: parseJson(row.after_json),
    }));
  }
}