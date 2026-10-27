import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';

/**
 * Antrean persetujuan penghapusan.
 *
 * Reseller boleh mengubah data, tetapi TIDAK boleh menghapus (keputusan
 * pemilik). Permintaan hapusnya masuk sini; operator/admin memutuskan.
 *
 * Endpoint hapus memakai satu jalur: kalau pemanggil punya izin
 * `X.delete` → hapus langsung; kalau tidak → buat permintaan. Jadi tidak ada
 * endpoint terpisah yang bisa dipakai untuk melewati aturan.
 */

export type ApprovalStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface ApprovalRow {
  id: number;
  requested_by: number;
  requester_name: string | null;
  action: string;
  target_type: string;
  target_id: number;
  summary: string;
  status: ApprovalStatus;
  decided_by: number | null;
  decider_name: string | null;
  decided_at: Date | null;
  note: string | null;
  created_at: Date;
}

/** Target yang boleh diajukan penghapusannya, beserta tabelnya. */
export const APPROVABLE_TARGETS: Record<string, { table: string; label: (row: RowDataPacket) => string }> = {
  customer: {
    table: 'customers',
    label: (row) => String(row.name ?? `#${row.id}`),
  },
  voucher: {
    table: 'radius_vouchers',
    label: (row) => String(row.username ?? `#${row.id}`),
  },
  'hotspot-profile': {
    table: 'hotspot_profiles',
    label: (row) => String(row.name ?? `#${row.id}`),
  },
  'ppp-profile': {
    table: 'ppp_profiles',
    label: (row) => String(row.name ?? `#${row.id}`),
  },
  group: {
    table: 'group_profiles',
    label: (row) => String(row.name ?? `#${row.id}`),
  },
  invoice: {
    table: 'invoices',
    label: (row) => String(row.invoice_number ?? `#${row.id}`),
  },
};

@Injectable()
export class ApprovalService {
  private readonly logger = new Logger(ApprovalService.name);

  constructor(private readonly db: DatabaseService) {}

  async request(input: {
    actorId: number;
    action: string;
    targetType: string;
    targetId: number;
    note?: string;
  }): Promise<{ pending: true; request_id: number; message: string }> {
    const target = APPROVABLE_TARGETS[input.targetType];
    if (!target) {
      throw new BadRequestException(
        `Jenis data "${input.targetType}" tidak mendukung permintaan hapus.`,
      );
    }

    const row = await this.db.queryOne<RowDataPacket>(
      `SELECT * FROM \`${target.table}\` WHERE id = ?`,
      [input.targetId],
    );
    if (!row) {
      throw new NotFoundException(`Data ${input.targetType} #${input.targetId} tidak ditemukan.`);
    }

    // Permintaan ganda untuk target yang sama hanya membingungkan pemutus.
    const existing = await this.db.queryOne<RowDataPacket>(
      `SELECT id FROM approval_requests
        WHERE status = 'pending' AND target_type = ? AND target_id = ? LIMIT 1`,
      [input.targetType, input.targetId],
    );
    if (existing) {
      throw new BadRequestException(
        `Permintaan hapus untuk data ini sudah menunggu persetujuan (#${existing.id}).`,
      );
    }

    const summary = `${input.targetType}: ${target.label(row)}`;
    const result = await this.db.execute(
      `INSERT INTO approval_requests
         (requested_by, action, target_type, target_id, summary, note)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [input.actorId, input.action, input.targetType, input.targetId, summary, input.note ?? null],
    );

    this.logger.log(`Permintaan hapus #${result.insertId} dari akun #${input.actorId}: ${summary}`);
    return {
      pending: true,
      request_id: result.insertId,
      message:
        `Permintaan hapus dikirim ke operator/admin (${summary}). ` +
        'Data belum dihapus sampai disetujui.',
    };
  }

  async list(status: ApprovalStatus | 'all' = 'pending'): Promise<ApprovalRow[]> {
    const where = status === 'all' ? '' : 'WHERE a.status = ?';
    const params = status === 'all' ? [] : [status];
    const rows = await this.db.query<RowDataPacket>(
      `SELECT a.*, r.name AS requester_name, d.name AS decider_name
         FROM approval_requests a
         LEFT JOIN users r ON r.id = a.requested_by
         LEFT JOIN users d ON d.id = a.decided_by
         ${where}
        ORDER BY a.created_at DESC LIMIT 200`,
      params,
    );
    return rows.map((row) => ({
      id: Number(row.id),
      requested_by: Number(row.requested_by),
      requester_name: (row.requester_name as string | null) ?? null,
      action: String(row.action),
      target_type: String(row.target_type),
      target_id: Number(row.target_id),
      summary: String(row.summary ?? ''),
      status: row.status as ApprovalStatus,
      decided_by: row.decided_by === null ? null : Number(row.decided_by),
      decider_name: (row.decider_name as string | null) ?? null,
      decided_at: (row.decided_at as Date | null) ?? null,
      note: (row.note as string | null) ?? null,
      created_at: row.created_at as Date,
    }));
  }

  /** Menyetujui hanya menandai; penghapusan dijalankan pemanggil (controller). */
  async approve(id: number, actorId: number, note?: string): Promise<ApprovalRow> {
    const row = await this.requirePending(id);
    await this.db.execute(
      `UPDATE approval_requests
          SET status = 'approved', decided_by = ?, decided_at = NOW(), note = ?
        WHERE id = ?`,
      [actorId, note ?? null, id],
    );
    this.logger.log(`Permintaan #${id} disetujui akun #${actorId}: ${row.summary}`);
    return row;
  }

  async reject(id: number, actorId: number, note?: string): Promise<void> {
    await this.requirePending(id);
    await this.db.execute(
      `UPDATE approval_requests
          SET status = 'rejected', decided_by = ?, decided_at = NOW(), note = ?
        WHERE id = ?`,
      [actorId, note ?? null, id],
    );
  }

  /** Dipakai setelah penghapusan disetujui benar-benar dijalankan. */
  async markExecuted(id: number): Promise<void> {
    await this.db.execute(
      `UPDATE approval_requests SET action = CONCAT(action, ':executed') WHERE id = ?`,
      [id],
    );
  }

  private async requirePending(id: number): Promise<ApprovalRow> {
    const row = await this.db.queryOne<RowDataPacket>(
      'SELECT * FROM approval_requests WHERE id = ?',
      [id],
    );
    if (!row) throw new NotFoundException(`Permintaan #${id} tidak ditemukan.`);
    if (row.status !== 'pending') {
      throw new BadRequestException(`Permintaan #${id} sudah ${row.status}.`);
    }
    return {
      id: Number(row.id),
      requested_by: Number(row.requested_by),
      requester_name: null,
      action: String(row.action),
      target_type: String(row.target_type),
      target_id: Number(row.target_id),
      summary: String(row.summary ?? ''),
      status: row.status as ApprovalStatus,
      decided_by: null,
      decider_name: null,
      decided_at: null,
      note: (row.note as string | null) ?? null,
      created_at: row.created_at as Date,
    };
  }
}
