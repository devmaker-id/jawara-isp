import { Injectable } from '@nestjs/common';
import type { PoolConnection, RowDataPacket } from 'mysql2/promise';
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
  /** Pelanggan pemilik ONU. null = ONU masih inventaris. */
  customer_id: number | null;
  customer_name?: string | null;
  internet_no?: string | null;
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
  /** Terisi = ONU tidak terlihat di perangkat pada sync terakhir port itu. */
  missing_at?: Date | null;
}

export interface OltOnuFilter {
  oltId?: number;
  online?: boolean;
  search?: string;
  /** Hanya ONU dengan Rx di bawah nilai ini (dBm). */
  maxRx?: number;
  /** 'assigned' = sudah dipasang di pelanggan; 'unassigned' = masih inventaris. */
  assigned?: 'assigned' | 'unassigned';
  /** 'active' (default) = ada di perangkat; 'missing' = tidak terlihat saat sync; 'all'. */
  missing?: 'active' | 'missing' | 'all';
  /** 1-based. */
  page?: number;
  size?: number;
}

/**
 * Bolehkah port ini menandai ONU yang tidak terlihat sebagai "hilang"?
 *
 * Port yang membaca 0 ONU padahal inventori punya baris = perintah gagal atau
 * sesi terputus, bukan port kosong. Port seperti itu tidak boleh menghapus
 * apa pun dari inventori.
 */
export function portMarkAllowed(readCount: number, existingCount: number): boolean {
  if (readCount > 0) return true;
  return existingCount === 0;
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

  /**
   * Daftar ONU dengan pembagian halaman di server.
   *
   * Panel tidak pernah mengirim seluruh inventori ke browser: OLT besar bisa
   * punya ribuan ONU, dan tabel sebesar itu membuat halaman tersendat. Yang
   * dikirim hanya satu halaman + jumlah totalnya.
   */
  async listOnus(
    filter: OltOnuFilter,
  ): Promise<{
    rows: OltOnuRow[];
    total: number;
    stats: { online: number; offline: number; weak: number };
  }> {
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
      // Nama pelanggan & Nomor Internet ikut dicari: teknisi biasanya memegang
      // salah satu dari keduanya, bukan serial ONU.
      where.push(
        '(o.onu_id LIKE ? OR o.serial_number LIKE ? OR o.onu_mac LIKE ? OR o.description LIKE ? OR o.onu_name LIKE ? OR c.name LIKE ? OR c.internet_no LIKE ?)',
      );
      const needle = `%${filter.search}%`;
      params.push(needle, needle, needle, needle, needle, needle, needle);
    }
    if (filter.assigned === 'assigned') where.push('o.customer_id IS NOT NULL');
    if (filter.assigned === 'unassigned') where.push('o.customer_id IS NULL');
    // Default: ONU yang benar-benar ada di perangkat. Yang ditandai hilang
    // hanya muncul bila diminta — supaya daftar operasional tidak penuh data basi.
    if (filter.missing === 'missing') where.push('o.missing_at IS NOT NULL');
    else if (filter.missing !== 'all') where.push('o.missing_at IS NULL');
    if (filter.maxRx !== undefined) {
      where.push('o.rx_power_onu IS NOT NULL AND o.rx_power_onu <= ?');
      params.push(filter.maxRx);
    }

    const size = Math.min(Math.max(Math.trunc(filter.size ?? 25), 1), 1000);
    const page = Math.max(Math.trunc(filter.page ?? 1), 1);
    const offset = (page - 1) * size;
    const clause = where.join(' AND ');

    // Ringkasan dihitung dari SELURUH hasil filter, bukan dari halaman yang
    // dikirim — kartu "online/offline" tidak boleh berubah saat pindah halaman.
    const counted = await this.db.queryOne<{
      total: number;
      online: number;
      offline: number;
      weak: number;
    }>(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(o.online = 1), 0) AS online,
              COALESCE(SUM(o.online = 0), 0) AS offline,
              COALESCE(SUM(o.rx_power_onu IS NOT NULL AND o.rx_power_onu < -27), 0) AS weak
         FROM olt_onus o
         JOIN olt_devices d ON d.id = o.olt_id
         LEFT JOIN customers c ON c.id = o.customer_id
        WHERE ${clause}`,
      params,
    );

    const rows = await this.db.query<RowDataPacket>(
      `SELECT o.*, d.name AS olt_name, c.name AS customer_name, c.internet_no
         FROM olt_onus o
         JOIN olt_devices d ON d.id = o.olt_id
         LEFT JOIN customers c ON c.id = o.customer_id
        WHERE ${clause}
        ORDER BY d.name, o.port_id, CAST(o.onu_id AS UNSIGNED)
        LIMIT ${size} OFFSET ${offset}`,
      params,
    );

    return {
      rows: rows as OltOnuRow[],
      total: Number(counted?.total ?? 0),
      stats: {
        online: Number(counted?.online ?? 0),
        offline: Number(counted?.offline ?? 0),
        weak: Number(counted?.weak ?? 0),
      },
    };
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
   * ONU yang tidak terlihat TIDAK dihapus — hanya ditandai `missing_at`.
   * Alasannya: baris ONU membawa identitas (serial/MAC) dan relasi pelanggan;
   * menghapusnya saat sync berarti kehilangan keduanya, termasuk ketika yang
   * terjadi hanyalah satu perintah perangkat yang gagal.
   *
   * Port yang tidak mengembalikan satu pun ONU padahal inventori punya data
   * dianggap tidak terbaca (`skipped`), bukan kosong. Aturan ini mencegah satu
   * gangguan sesi menandai seluruh port hilang sekaligus.
   */
  async saveInventory(
    oltId: number,
    results: Array<{ port: string; onus: OltOnu[] }>,
  ): Promise<{ saved: number; missing: number; skipped: string[] }> {
    return this.db.withTransaction(async (connection) => {
      let saved = 0;
      for (const { onus } of results) {
        for (const onu of onus) {
          await connection.query(
            `INSERT INTO olt_onus
               (olt_id, port_id, onu_id, serial_number, onu_mac, onu_name, description,
                admin_state, omcc_state, phase_state, online,
                rx_power_onu, rx_power_olt, tx_power, temperature, voltage, tx_bias,
                last_seen_at, missing_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NULL)
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
               last_seen_at  = NOW(),
               -- Vendor yang membawa redaman di perintah inventori (VSOL) juga
               -- menstempel waktu baca optik, supaya UI tidak menampilkan
               -- "belum pernah dibaca" padahal angkanya baru.
               optical_read_at = CASE WHEN VALUES(rx_power_onu) IS NOT NULL
                                      THEN NOW() ELSE optical_read_at END,
               -- Muncul lagi di perangkat = penanda hilang dicabut.
               missing_at    = NULL`,
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
          saved += 1;
        }
      }

      let missing = 0;
      const skipped: string[] = [];
      for (const { port, onus } of results) {
        const existing = await connection.query<RowDataPacket[]>(
          'SELECT COUNT(*) AS total FROM olt_onus WHERE olt_id = ? AND port_id = ?',
          [oltId, port],
        );
        const existingCount = Number((existing[0] as RowDataPacket[])[0]?.total ?? 0);
        if (!portMarkAllowed(onus.length, existingCount)) {
          skipped.push(port);
          continue;
        }
        if (onus.length === 0) continue;

        const keep = onus.map((onu) => onu.onuId);
        const result = await connection.query(
          `UPDATE olt_onus
              SET missing_at = NOW()
            WHERE olt_id = ? AND port_id = ?
              AND missing_at IS NULL
              AND onu_id NOT IN (${keep.map(() => '?').join(',')})`,
          [oltId, port, ...keep],
        );
        const header = (result as unknown as Array<{ affectedRows?: number }>)[0];
        missing += Number(header?.affectedRows ?? 0);
      }

      return { saved, missing, skipped };
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

  // -------------------------------------------------------------------------
  // Pemasangan ONU ke pelanggan
  // -------------------------------------------------------------------------

  /** Satu ONU lengkap dengan nama OLT dan pemiliknya (kalau sudah dipasang). */
  async findOnu(id: number): Promise<OltOnuRow | null> {
    const row = await this.db.queryOne<RowDataPacket>(
      `SELECT o.*, d.name AS olt_name, c.name AS customer_name, c.internet_no
         FROM olt_onus o
         JOIN olt_devices d ON d.id = o.olt_id
         LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.id = ?`,
      [id],
    );
    return (row as OltOnuRow | null) ?? null;
  }

  /** Pelanggan untuk pemasangan ONU: dipilih lewat id atau Nomor Internet. */
  async findCustomer(input: {
    id?: number;
    internetNo?: string;
  }): Promise<{ id: number; name: string; internet_no: string | null } | null> {
    if (input.id !== undefined && Number.isFinite(Number(input.id))) {
      return this.db.queryOne<{ id: number; name: string; internet_no: string | null }>(
        'SELECT id, name, internet_no FROM customers WHERE id = ?',
        [input.id],
      );
    }
    if (input.internetNo) {
      return this.db.queryOne<{ id: number; name: string; internet_no: string | null }>(
        'SELECT id, name, internet_no FROM customers WHERE internet_no = ?',
        [input.internetNo],
      );
    }
    return null;
  }

  /** Semua ONU milik satu pelanggan (maksimal satu menurut unique index). */
  async onusOfCustomer(customerId: number): Promise<OltOnuRow[]> {
    const rows = await this.db.query<RowDataPacket>(
      `SELECT o.*, d.name AS olt_name, c.name AS customer_name, c.internet_no
         FROM olt_onus o
         JOIN olt_devices d ON d.id = o.olt_id
         LEFT JOIN customers c ON c.id = o.customer_id
        WHERE o.customer_id = ?`,
      [customerId],
    );
    return rows as OltOnuRow[];
  }

  /**
   * Pasang ONU ke pelanggan.
   *
   * Semua pemeriksaan dilakukan di dalam satu transaksi dengan SELECT ... FOR
   * UPDATE: dua operator yang menekan "Pasang" bersamaan tidak bisa membuat
   * satu pelanggan punya dua ONU atau satu ONU dipakai dua pelanggan.
   *
   * Kode error yang dikembalikan (dipakai service untuk memilih pesan):
   *   ONU_NOT_FOUND, CUSTOMER_NOT_FOUND, ONU_TAKEN, CUSTOMER_HAS_ONU
   */
  async assignOnu(input: {
    onuId: number;
    customerId: number;
    actorId: number;
    note?: string;
    /** true = izinkan memindahkan ONU yang sudah terpasang di pelanggan lain. */
    move?: boolean;
  }): Promise<{ action: 'assign' | 'move'; previousCustomerId: number | null }> {
    return this.db.withTransaction(async (conn) => {
      const [onuRows] = await conn.query<RowDataPacket[]>(
        `SELECT o.id, o.customer_id, o.missing_at, o.olt_id, o.port_id, o.onu_id,
                o.serial_number, o.onu_name, d.name AS olt_name
           FROM olt_onus o JOIN olt_devices d ON d.id = o.olt_id
          WHERE o.id = ? FOR UPDATE`,
        [input.onuId],
      );
      const onu = onuRows[0];
      if (!onu) throw Object.assign(new Error('ONU tidak ditemukan'), { code: 'ONU_NOT_FOUND' });
      if (onu.missing_at) {
        // ONU yang tidak terlihat di perangkat pada sync terakhir tidak boleh
        // dipasang: bisa jadi perangkat sudah dicabut atau terbaca gagal.
        throw Object.assign(new Error('ONU ditandai hilang'), { code: 'ONU_MISSING' });
      }

      const [customerRows] = await conn.query<RowDataPacket[]>(
        'SELECT id, name, internet_no FROM customers WHERE id = ? FOR UPDATE',
        [input.customerId],
      );
      const customer = customerRows[0];
      if (!customer) {
        throw Object.assign(new Error('Pelanggan tidak ditemukan'), { code: 'CUSTOMER_NOT_FOUND' });
      }

      if (onu.customer_id !== null && Number(onu.customer_id) !== Number(customer.id)) {
        // Pindah pemilik harus dinyatakan terang-terangan (`move: true`), supaya
        // salah pilih ONU tidak diam-diam mencabut perangkat pelanggan lain.
        if (!input.move) {
          throw Object.assign(new Error('ONU sudah dipakai pelanggan lain'), { code: 'ONU_TAKEN' });
        }
      }

      const [owned] = await conn.query<RowDataPacket[]>(
        'SELECT id FROM olt_onus WHERE customer_id = ? AND id <> ? FOR UPDATE',
        [customer.id, input.onuId],
      );
      if (owned.length > 0) {
        throw Object.assign(new Error('Pelanggan sudah punya ONU'), { code: 'CUSTOMER_HAS_ONU' });
      }

      if (onu.customer_id !== null && Number(onu.customer_id) === Number(customer.id)) {
        // Sudah terpasang di pelanggan yang sama: tidak ada perubahan, jangan
        // menulis riwayat palsu.
        return { action: 'assign' as const, previousCustomerId: Number(customer.id) };
      }

      const previousCustomerId = onu.customer_id === null ? null : Number(onu.customer_id);
      await conn.query('UPDATE olt_onus SET customer_id = ? WHERE id = ?', [customer.id, input.onuId]);
      await this.writeHistory(conn, {
        onuId: input.onuId,
        label: this.onuLabel(onu),
        action: previousCustomerId === null ? 'assign' : 'move',
        fromCustomerId: previousCustomerId,
        toCustomerId: Number(customer.id),
        actorId: input.actorId,
        note: input.note,
      });
      return { action: previousCustomerId === null ? ('assign' as const) : ('move' as const), previousCustomerId };
    });
  }

  /** Lepas ONU dari pelanggan. ONU tetap ada sebagai inventaris. */
  async releaseOnu(input: {
    onuId: number;
    actorId: number;
    note?: string;
  }): Promise<{ previousCustomerId: number | null }> {
    return this.db.withTransaction(async (conn) => {
      const [rows] = await conn.query<RowDataPacket[]>(
        `SELECT o.id, o.customer_id, o.missing_at, o.olt_id, o.port_id, o.onu_id,
                o.serial_number, o.onu_name, d.name AS olt_name
           FROM olt_onus o JOIN olt_devices d ON d.id = o.olt_id
          WHERE o.id = ? FOR UPDATE`,
        [input.onuId],
      );
      const onu = rows[0];
      if (!onu) throw Object.assign(new Error('ONU tidak ditemukan'), { code: 'ONU_NOT_FOUND' });

      const previousCustomerId = onu.customer_id === null ? null : Number(onu.customer_id);
      if (previousCustomerId === null) {
        // Sudah inventaris: tidak ada yang perlu dilepas.
        return { previousCustomerId: null };
      }

      await conn.query('UPDATE olt_onus SET customer_id = NULL WHERE id = ?', [input.onuId]);
      await this.writeHistory(conn, {
        onuId: input.onuId,
        label: this.onuLabel(onu),
        action: 'release',
        fromCustomerId: previousCustomerId,
        toCustomerId: null,
        actorId: input.actorId,
        note: input.note,
      });
      return { previousCustomerId };
    });
  }

  /** Riwayat pemasangan satu ONU, terbaru lebih dulu. */
  async onuHistory(onuId: number, limit = 50): Promise<RowDataPacket[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 200);
    return this.db.query<RowDataPacket>(
      `SELECT h.id, h.onu_id, h.onu_label, h.action, h.from_customer_id, h.to_customer_id,
              h.actor_id, h.note, h.created_at,
              cf.name AS from_customer_name, ct.name AS to_customer_name,
              cf.internet_no AS from_internet_no, ct.internet_no AS to_internet_no,
              u.name AS actor_name
         FROM onu_assignment_history h
         LEFT JOIN customers cf ON cf.id = h.from_customer_id
         LEFT JOIN customers ct ON ct.id = h.to_customer_id
         LEFT JOIN users u ON u.id = h.actor_id
        WHERE h.onu_id = ?
        ORDER BY h.id DESC
        LIMIT ${safeLimit}`,
      [onuId],
    );
  }

  /** Label ONU yang disimpan di riwayat supaya tetap terbaca setelah sync. */
  private onuLabel(onu: RowDataPacket): string {
    const parts = [onu.olt_name, `${onu.port_id}/${onu.onu_id}`];
    if (onu.serial_number) parts.push(String(onu.serial_number));
    return parts.filter(Boolean).join(' · ').slice(0, 190);
  }

  private async writeHistory(
    conn: PoolConnection,
    values: {
      onuId: number;
      label: string;
      action: 'assign' | 'release' | 'move';
      fromCustomerId: number | null;
      toCustomerId: number | null;
      actorId: number;
      note?: string;
    },
  ): Promise<void> {
    await conn.query(
      `INSERT INTO onu_assignment_history
         (onu_id, onu_label, action, from_customer_id, to_customer_id, actor_id, note)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        values.onuId,
        values.label,
        values.action,
        values.fromCustomerId,
        values.toCustomerId,
        values.actorId > 0 ? values.actorId : null,
        values.note?.slice(0, 255) ?? null,
      ],
    );
  }

  // -------------------------------------------------------------------------
  // Syslog client (kolektor + riwayat aksi)
  // -------------------------------------------------------------------------

  /** Daftar `host` perangkat (untuk filter sumber syslog; IPv4 disaring pemanggil). */
  async listDeviceIpAddresses(): Promise<string[]> {
    const rows = await this.db.query<RowDataPacket>('SELECT DISTINCT host FROM olt_devices');
    return rows.map((row) => String(row.host));
  }

  /** Perangkat OLT berdasarkan host (IP) — untuk menautkan event syslog. */
  async findDeviceByIp(ip: string): Promise<{ id: number; name: string } | null> {
    const row = await this.db.queryOne<{ id: number; name: string }>(
      'SELECT id, name FROM olt_devices WHERE host = ? LIMIT 1',
      [ip],
    );
    return row ?? null;
  }

  async insertSyslogEvent(event: {
    olt_id: number | null;
    olt_name: string | null;
    source_ip: string;
    event_type: string;
    port_id: string | null;
    onu_id: string | null;
    onu_mac: string | null;
    onu_name: string | null;
    raw_log: string;
  }): Promise<void> {
    await this.db.execute(
      `INSERT INTO olt_syslog_events
         (olt_id, olt_name, source_ip, event_type, port_id, onu_id, onu_mac, onu_name, raw_log)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        event.olt_id,
        event.olt_name?.slice(0, 80) ?? null,
        event.source_ip,
        event.event_type,
        event.port_id,
        event.onu_id,
        event.onu_mac,
        event.onu_name?.slice(0, 120) ?? null,
        event.raw_log,
      ],
    );
  }

  async listSyslogEvents(filter: {
    oltId?: number;
    type?: string;
    search?: string;
    page?: number;
    size?: number;
  }): Promise<{ rows: RowDataPacket[]; total: number }> {
    const where: string[] = ['1 = 1'];
    const params: unknown[] = [];
    if (filter.oltId !== undefined) {
      where.push('e.olt_id = ?');
      params.push(filter.oltId);
    }
    if (filter.type) {
      where.push('e.event_type = ?');
      params.push(filter.type);
    }
    if (filter.search) {
      where.push(
        '(e.onu_name LIKE ? OR e.onu_mac LIKE ? OR e.port_id LIKE ? OR e.onu_id LIKE ? OR e.event_type LIKE ? OR e.raw_log LIKE ?)',
      );
      const needle = `%${filter.search}%`;
      params.push(needle, needle, needle, needle, needle, needle);
    }
    const size = Math.min(Math.max(Math.trunc(filter.size ?? 50), 1), 1000);
    const page = Math.max(Math.trunc(filter.page ?? 1), 1);
    const offset = (page - 1) * size;
    const clause = where.join(' AND ');

    const counted = await this.db.queryOne<{ total: number }>(
      `SELECT COUNT(*) AS total FROM olt_syslog_events e WHERE ${clause}`,
      params,
    );
    const rows = await this.db.query<RowDataPacket>(
      `SELECT e.*, d.name AS olt_name_display
         FROM olt_syslog_events e
         LEFT JOIN olt_devices d ON d.id = e.olt_id
        WHERE ${clause}
        ORDER BY e.id DESC
        LIMIT ${size} OFFSET ${offset}`,
      params,
    );
    return { rows, total: Number(counted?.total ?? 0) };
  }

  /** Hapus banyak event syslog sekaligus. Mengembalikan jumlah baris terhapus. */
  async deleteSyslogEvents(ids: number[]): Promise<number> {
    const clean = ids.filter((id) => Number.isInteger(id) && id > 0);
    if (clean.length === 0) return 0;
    const result = await this.db.execute(
      `DELETE FROM olt_syslog_events WHERE id IN (${clean.map(() => '?').join(',')})`,
      clean,
    );
    return Number(result.affectedRows ?? 0);
  }

  /**
   * Terapkan kebijakan retensi log ONU; mengembalikan jumlah baris yang dihapus.
   *
   * `age`     hapus log lebih tua dari N hari.
   * `per_olt` pertahankan N log terbaru per OLT, hapus sisanya.
   */
  async enforceSyslogRetention(policy: {
    mode: 'age' | 'per_olt';
    days?: number;
    count?: number;
  }): Promise<number> {
    let result: { affectedRows?: number };
    if (policy.mode === 'age') {
      const days = Math.max(1, Math.trunc(policy.days ?? 30));
      result = await this.db.execute(
        'DELETE FROM olt_syslog_events WHERE created_at < (NOW() - INTERVAL ? DAY)',
        [days],
      );
    } else {
      const count = Math.max(1, Math.trunc(policy.count ?? 500));
      result = await this.db.execute(
        `DELETE e FROM olt_syslog_events e
         JOIN (
           SELECT id FROM (
             SELECT id, ROW_NUMBER() OVER (PARTITION BY olt_id ORDER BY id DESC) AS rn
             FROM olt_syslog_events
           ) ranked WHERE ranked.rn > ?
         ) d ON d.id = e.id`,
        [count],
      );
    }
    return Number(result.affectedRows ?? 0);
  }

  async insertSyslogAction(input: {
    oltId: number;
    action: 'apply' | 'rollback' | 'read';
    before?: unknown;
    after?: unknown;
    message?: string;
    userId: number;
  }): Promise<void> {
    await this.db.execute(
      `INSERT INTO olt_syslog_actions (olt_id, action, before_state, after_state, message, user_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        input.oltId,
        input.action,
        input.before ? JSON.stringify(input.before) : null,
        input.after ? JSON.stringify(input.after) : null,
        input.message?.slice(0, 255) ?? null,
        input.userId > 0 ? input.userId : null,
      ],
    );
  }

  /** Aksi terakhir sebuah perangkat — sumber nilai "diminta terakhir". */
  async latestSyslogAction(
    oltId: number,
    action: 'apply' | 'rollback',
  ): Promise<RowDataPacket | null> {
    return this.db.queryOne<RowDataPacket>(
      `SELECT * FROM olt_syslog_actions WHERE olt_id = ? AND action = ? ORDER BY id DESC LIMIT 1`,
      [oltId, action],
    );
  }

  async listSyslogActions(oltId: number, limit = 20): Promise<RowDataPacket[]> {
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    return this.db.query<RowDataPacket>(
      `SELECT a.id, a.action, a.before_state, a.after_state, a.message, a.created_at, u.name AS actor_name
         FROM olt_syslog_actions a
         LEFT JOIN users u ON u.id = a.user_id
        WHERE a.olt_id = ?
        ORDER BY a.id DESC
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