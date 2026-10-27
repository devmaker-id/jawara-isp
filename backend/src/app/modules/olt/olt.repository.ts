import { Injectable } from '@nestjs/common';
import type { RowDataPacket } from 'mysql2/promise';
import { DatabaseService } from '../../database/database.service';
import type { OltOnu } from './driver/olt-driver';

/**
 * Akses data modul OLT.
 *
 * Seluruh SQL modul ini ada di sini; service hanya bicara soal perilaku.
 * Tidak ada tabel yang menyimpan konfigurasi OLT selain status koneksi —
 * perangkat tetap sumber kebenaran untuk inventori ONU.
 */

export interface OltDeviceRow {
  id: number;
  name: string;
  vendor: string;
  transport: 'ssh' | 'telnet';
  host: string;
  port: number;
  username: string;
  password_enc: string;
  enable_password_enc: string | null;
  pon_ports: string;
  prompt_pattern: string | null;
  read_only: number;
  is_active: number;
  last_checked_at: Date | null;
  last_connected: number | null;
  last_message: string | null;
  last_identity: string | null;
  last_version: string | null;
  created_at: Date;
  updated_at: Date;
}

export interface OltDeviceView {
  id: number;
  name: string;
  vendor: string;
  transport: 'ssh' | 'telnet';
  host: string;
  port: number;
  username: string;
  pon_ports: string;
  prompt_pattern: string | null;
  is_active: boolean;
  read_only: boolean;
  has_enable_password: boolean;
  last_checked_at: string | null;
  last_connected: boolean | null;
  last_message: string | null;
  last_identity: string | null;
  last_version: string | null;
  onu_total: number;
  onu_online: number;
}

export interface OltOnuRow {
  id: number;
  olt_id: number;
  olt_name?: string;
  port_id: string;
  onu_id: string;
  serial_number: string | null;
  onu_mac: string | null;
  onu_name: string | null;
  description: string | null;
  admin_state: string | null;
  omcc_state: string | null;
  phase_state: string | null;
  online: number;
  rx_power_onu: string | number | null;
  rx_power_olt: string | number | null;
  tx_power: string | number | null;
  temperature: string | number | null;
  voltage: string | number | null;
  tx_bias: string | number | null;
  last_seen_at: Date;
}

export interface OltOnuFilter {
  oltId?: number;
  online?: boolean;
  search?: string;
  /** Hanya ONU dengan Rx di bawah nilai ini (dBm). */
  maxRx?: number;
  limit?: number;
}

@Injectable()
export class OltRepository {
  constructor(private readonly db: DatabaseService) {}

  async listDevices(): Promise<OltDeviceView[]> {
    const rows = await this.db.query<RowDataPacket>(
      `SELECT d.*,
              COALESCE(n.total, 0)  AS onu_total,
              COALESCE(n.online, 0) AS onu_online
         FROM olt_devices d
         LEFT JOIN (
              SELECT olt_id,
                     COUNT(*) AS total,
                     SUM(online = 1) AS online
                FROM olt_onus
               GROUP BY olt_id
         ) n ON n.olt_id = d.id
        ORDER BY d.name`,
    );
    return rows.map((row) => this.view(row));
  }

  async findDevice(id: number): Promise<OltDeviceRow | null> {
    return this.db.queryOne<OltDeviceRow>('SELECT * FROM olt_devices WHERE id = ?', [id]);
  }

  async createDevice(values: {
    name: string;
    vendor: string;
    transport: 'ssh' | 'telnet';
    host: string;
    port: number;
    username: string;
    passwordEnc: string;
    enablePasswordEnc: string | null;
    ponPorts: string;
    promptPattern: string | null;
    createdBy: number;
  }): Promise<number> {
    const result = await this.db.execute(
      `INSERT INTO olt_devices
         (name, vendor, transport, host, port, username, password_enc, enable_password_enc,
          pon_ports, prompt_pattern, read_only, is_active, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, ?)`,
      [
        values.name,
        values.vendor,
        values.transport,
        values.host,
        values.port,
        values.username,
        values.passwordEnc,
        values.enablePasswordEnc,
        values.ponPorts,
        values.promptPattern,
        values.createdBy,
      ],
    );
    return Number(result.insertId);
  }

  async updateDevice(id: number, values: Record<string, unknown>): Promise<void> {
    const keys = Object.keys(values);
    if (keys.length === 0) return;
    const assignments = keys.map((key) => `${key} = ?`).join(', ');
    await this.db.execute(`UPDATE olt_devices SET ${assignments} WHERE id = ?`, [
      ...keys.map((key) => values[key]),
      id,
    ]);
  }

  async removeDevice(id: number): Promise<void> {
    await this.db.execute('DELETE FROM olt_devices WHERE id = ?', [id]);
  }

  /** Dipakai test koneksi & sync untuk melaporkan status terakhir apa adanya. */
  async touchStatus(
    id: number,
    values: {
      connected: boolean;
      message: string;
      identity: string | null;
      version: string | null;
    },
  ): Promise<void> {
    await this.db.execute(
      `UPDATE olt_devices
          SET last_checked_at = NOW(), last_connected = ?, last_message = ?,
              last_identity = ?, last_version = ?
        WHERE id = ?`,
      [values.connected ? 1 : 0, values.message.slice(0, 255), values.identity, values.version, id],
    );
  }

  /** ONU terpanjang 2000 baris per perangkat: cukup untuk satu PON penuh. */
  async listOnus(filter: OltOnuFilter): Promise<OltOnuRow[]> {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];

    if (filter.oltId !== undefined) {
      where.push('o.olt_id = ?');
      params.push(filter.oltId);
    }
    if (filter.online !== undefined) {
      where.push('o.online = ?');
      params.push(filter.online ? 1 : 0);
    }
    if (filter.search) {
      where.push(
        '(o.onu_id LIKE ? OR o.serial_number LIKE ? OR o.onu_mac LIKE ? OR o.description LIKE ? OR o.onu_name LIKE ?)',
      );
      const needle = `%${filter.search}%`;
      params.push(needle, needle, needle, needle, needle);
    }
    if (filter.maxRx !== undefined) {
      where.push('o.rx_power_onu IS NOT NULL AND o.rx_power_onu <= ?');
      params.push(filter.maxRx);
    }

    const limit = Math.min(Math.max(filter.limit ?? 500, 1), 2000);
    const rows = await this.db.query<RowDataPacket>(
      `SELECT o.*, d.name AS olt_name
         FROM olt_onus o
         JOIN olt_devices d ON d.id = o.olt_id
        WHERE ${where.join(' AND ')}
        ORDER BY d.name, o.port_id, CAST(o.onu_id AS UNSIGNED)
        LIMIT ${limit}`,
      params,
    );
    return rows as OltOnuRow[];
  }

  async countOnus(oltId: number): Promise<{ total: number; online: number }> {
    const row = await this.db.queryOne<{ total: number; online: number }>(
      'SELECT COUNT(*) AS total, COALESCE(SUM(online = 1), 0) AS online FROM olt_onus WHERE olt_id = ?',
      [oltId],
    );
    return { total: Number(row?.total ?? 0), online: Number(row?.online ?? 0) };
  }

  /**
   * Simpan inventori hasil pembacaan.
   *
   * `seenAt` dipakai untuk membuang ONU yang sudah tidak ada di perangkat pada
   * port yang dibaca. Sengaja per port: port yang tidak dibaca pada run ini
   * tidak boleh kehilangan datanya.
   */
  async saveInventory(
    oltId: number,
    ports: string[],
    onus: OltOnu[],
  ): Promise<{ saved: number; removed: number }> {
    return this.db.withTransaction(async (connection) => {
      for (const onu of onus) {
        await connection.query(
          `INSERT INTO olt_onus
             (olt_id, port_id, onu_id, serial_number, onu_mac, onu_name, description,
              admin_state, omcc_state, phase_state, online,
              rx_power_onu, rx_power_olt, tx_power, temperature, voltage, tx_bias, last_seen_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
           ON DUPLICATE KEY UPDATE
             serial_number = VALUES(serial_number),
             onu_mac       = VALUES(onu_mac),
             onu_name      = VALUES(onu_name),
             description   = VALUES(description),
             admin_state   = VALUES(admin_state),
             omcc_state    = VALUES(omcc_state),
             phase_state   = VALUES(phase_state),
             online        = VALUES(online),
             -- Vendor yang membaca redaman terpisah (HiFocus) mengirim NULL
             -- di sini; nilai lama harus dipertahankan, bukan dihapus setiap
             -- sync. Vendor VSOL mengirim angka, jadi tetap menimpa.
             rx_power_onu  = COALESCE(VALUES(rx_power_onu), rx_power_onu),
             rx_power_olt  = COALESCE(VALUES(rx_power_olt), rx_power_olt),
             tx_power      = COALESCE(VALUES(tx_power), tx_power),
             temperature   = COALESCE(VALUES(temperature), temperature),
             voltage       = COALESCE(VALUES(voltage), voltage),
             tx_bias       = COALESCE(VALUES(tx_bias), tx_bias),
             last_seen_at  = NOW()`,
          [
            oltId,
            onu.portId,
            onu.onuId,
            onu.serialNumber,
            onu.onuMac ?? null,
            onu.name,
            onu.description,
            onu.adminState,
            onu.omccState,
            onu.phaseState,
            onu.online ? 1 : 0,
            onu.rxPowerOnu,
            onu.rxPowerOlt,
            onu.txPower,
            onu.temperature,
            onu.voltage,
            onu.txBias,
          ],
        );
      }

      let removed = 0;
      for (const port of ports) {
        // Hapus hanya ONU di port yang benar-benar dibaca pada run ini.
        const result = await connection.query(
          `DELETE FROM olt_onus
            WHERE olt_id = ? AND port_id = ?
              AND last_seen_at < NOW() - INTERVAL 1 MINUTE`,
          [oltId, port],
        );
        const header = result[0] as { affectedRows?: number };
        removed += Number(header?.affectedRows ?? 0);
      }

      return { saved: onus.length, removed };
    });
  }

  /**
   * ONU yang redamannya perlu dibaca: belum pernah dibaca atau paling lama.
   *
   * Vendor yang butuh satu perintah per ONU (HiFocus) dibaca bertahap, supaya
   * satu permintaan tidak menggantung lama untuk OLT dengan ratusan ONU.
   */
  async opticalCandidates(
    oltId: number,
    limit: number,
  ): Promise<Array<{ port_id: string; onu_id: string }>> {
    const safeLimit = Math.min(Math.max(limit, 1), 60);
    const rows = await this.db.query<RowDataPacket>(
      `SELECT port_id, onu_id
         FROM olt_onus
        WHERE olt_id = ? AND online = 1
        -- ONU yang belum punya Rx selalu didahulukan, lalu yang paling lama
        -- dibaca. Tanpa urutan ini, ONU yang gagal terus tertinggal di belakang.
        ORDER BY rx_power_onu IS NOT NULL, optical_read_at IS NULL DESC,
                 optical_read_at ASC, id
        LIMIT ${safeLimit}`,
      [oltId],
    );
    return rows.map((row) => ({ port_id: String(row.port_id), onu_id: String(row.onu_id) }));
  }

  async saveOptical(
    oltId: number,
    portId: string,
    onuId: string,
    optical: {
      rxPowerOnu: number | null;
      rxPowerOlt: number | null;
      txPower: number | null;
      temperature: number | null;
      voltage: number | null;
      txBias: number | null;
    },
  ): Promise<void> {
    await this.db.execute(
      `UPDATE olt_onus
          SET rx_power_onu = ?, rx_power_olt = ?, tx_power = ?,
              temperature = ?, voltage = ?, tx_bias = ?, optical_read_at = NOW()
        WHERE olt_id = ? AND port_id = ? AND onu_id = ?`,
      [
        optical.rxPowerOnu,
        optical.rxPowerOlt,
        optical.txPower,
        optical.temperature,
        optical.voltage,
        optical.txBias,
        oltId,
        portId,
        onuId,
      ],
    );
  }

  async startRun(oltId: number, userId: number): Promise<number> {
    const result = await this.db.execute(
      'INSERT INTO olt_sync_runs (olt_id, status, user_id) VALUES (?, ?, ?)',
      [oltId, 'running', userId],
    );
    return Number(result.insertId);
  }

  async finishRun(
    runId: number,
    values: { status: 'ok' | 'error'; total: number; online: number; message: string },
  ): Promise<void> {
    await this.db.execute(
      `UPDATE olt_sync_runs
          SET status = ?, onu_total = ?, onu_online = ?, message = ?, finished_at = NOW()
        WHERE id = ?`,
      [values.status, values.total, values.online, values.message.slice(0, 255), runId],
    );
  }

  async listRuns(oltId: number, limit = 20): Promise<RowDataPacket[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    return this.db.query<RowDataPacket>(
      `SELECT id, status, onu_total, onu_online, message, started_at, finished_at, user_id
         FROM olt_sync_runs
        WHERE olt_id = ?
        ORDER BY id DESC
        LIMIT ${safeLimit}`,
      [oltId],
    );
  }

  private view(row: RowDataPacket): OltDeviceView {
    return {
      id: Number(row.id),
      name: String(row.name),
      vendor: String(row.vendor),
      transport: row.transport as 'ssh' | 'telnet',
      host: String(row.host),
      port: Number(row.port),
      username: String(row.username),
      pon_ports: String(row.pon_ports),
      prompt_pattern: row.prompt_pattern ? String(row.prompt_pattern) : null,
      is_active: Number(row.is_active) === 1,
      read_only: Number(row.read_only) === 1,
      has_enable_password: Boolean(row.enable_password_enc),
      last_checked_at: row.last_checked_at ? new Date(row.last_checked_at).toISOString() : null,
      last_connected: row.last_connected === null ? null : Number(row.last_connected) === 1,
      last_message: row.last_message ? String(row.last_message) : null,
      last_identity: row.last_identity ? String(row.last_identity) : null,
      last_version: row.last_version ? String(row.last_version) : null,
      onu_total: Number(row.onu_total ?? 0),
      onu_online: Number(row.onu_online ?? 0),
    };
  }
}