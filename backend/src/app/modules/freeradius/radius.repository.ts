import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../../database/database.service';
import {
  NAS_PUBLIC_SELECT,
  NasRow,
  RADIUS_MIGRATION,
  RADIUS_TABLES,
  RadiusAuthLog as RadiusAuthLogRow,
  RadiusSession as RadiusSessionRow,
  RadiusUser as RadiusUserRow,
  RosVersion,
  requireMessageAuth,
} from './models/radius.model';

// Kontrak kolom & tabel ada di models/radius.model.ts (migrasi 004).
// Re-export dipertahankan agar pemanggil lama (service, test) tidak berubah.
export { RADIUS_TABLES, RADIUS_MIGRATION };
export type { NasRow, RadiusUserRow, RadiusSessionRow, RadiusAuthLogRow };

@Injectable()
export class RadiusRepository {
  constructor(private readonly db: DatabaseService) {}

  // Skema FreeRADIUS tidak dibuat otomatis oleh migrasi panel; semua query
  // diawali pemeriksaan tabel agar tidak menghasilkan error SQL mentah.
  async existingTables(): Promise<string[]> {
    const rows = await this.db.query<{ TABLE_NAME: string }>(
      `SELECT TABLE_NAME FROM information_schema.tables
        WHERE table_schema = DATABASE()
          AND table_name IN (${RADIUS_TABLES.map(() => '?').join(',')})`,
      [...RADIUS_TABLES],
    );
    return rows.map((row) => row.TABLE_NAME);
  }

  async counts(): Promise<{ nas: number; users: number; sessions: number; groups: number }> {
    const rows = await this.db.query<{ nas: number; users: number; sessions: number; groups: number }>(
      `SELECT
         (SELECT COUNT(*) FROM nas) AS nas,
         (SELECT COUNT(DISTINCT username) FROM radcheck) AS users,
         (SELECT COUNT(*) FROM radacct WHERE acctstoptime IS NULL) AS sessions,
         (SELECT COUNT(DISTINCT groupname) FROM radusergroup) AS \`groups\``,
    );
    return rows[0] ?? { nas: 0, users: 0, sessions: 0, groups: 0 };
  }

  async lastAccountingAt(): Promise<string | null> {
    const rows = await this.db.query<{ at: string | null }>(
      'SELECT MAX(acctstarttime) AS at FROM radacct',
    );
    return rows[0]?.at ?? null;
  }

  async listNas(query: { search?: string; page?: number; limit?: number }) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (query.search) {
      where.push('(nasname LIKE ? OR shortname LIKE ? OR description LIKE ?)');
      const like = `%${query.search}%`;
      params.push(like, like, like);
    }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const limit = query.page ? Math.min(Math.max(query.limit ?? 20, 1), 200) : 1000;
    const offset = query.page ? (Math.max(query.page, 1) - 1) * limit : 0;

    const rows = await this.db.query<NasRow>(
      `SELECT ${NAS_PUBLIC_SELECT}
         FROM nas ${whereSql} ORDER BY nasname LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const totalRows = await this.db.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM nas ${whereSql}`,
      params,
    );
    return { rows, total: Number(totalRows[0]?.total ?? 0) };
  }

  async findNas(id: number): Promise<NasRow | null> {
    const rows = await this.db.query<NasRow>(
      `SELECT ${NAS_PUBLIC_SELECT} FROM nas WHERE id = ?`,
      [id],
    );
    return rows[0] ?? null;
  }

  async createNas(input: {
    nasname: string;
    shortname?: string;
    secret: string;
    type?: string;
    description?: string;
    ports?: number;
    ros_version?: RosVersion;
  }): Promise<number> {
    const rosVersion: RosVersion = input.ros_version === '7' ? '7' : '6';
    const result = await this.db.execute(
      `INSERT INTO nas (nasname, shortname, type, ports, server, description, secret, ros_version, require_ma)
       VALUES (?, ?, ?, ?, '', ?, ?, ?, ?)`,
      [
        input.nasname,
        input.shortname ?? input.nasname,
        input.type ?? 'other',
        input.ports ?? 1812,
        input.description ?? '',
        input.secret,
        rosVersion,
        requireMessageAuth(rosVersion),
      ],
    );
    return result.insertId;
  }

  async updateNas(
    id: number,
    input: {
      shortname?: string;
      secret?: string;
      type?: string;
      description?: string;
      ports?: number;
      ros_version?: RosVersion;
    },
  ): Promise<void> {
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [column, value] of Object.entries({
      shortname: input.shortname,
      secret: input.secret,
      type: input.type,
      description: input.description,
      ports: input.ports,
    })) {
      if (value === undefined) continue;
      sets.push(`${column} = ?`);
      params.push(value);
    }
    // ros_version dan require_ma selalu ditulis berpasangan: versi adalah sumbernya.
    if (input.ros_version !== undefined) {
      const rosVersion: RosVersion = input.ros_version === '7' ? '7' : '6';
      sets.push('ros_version = ?', 'require_ma = ?');
      params.push(rosVersion, requireMessageAuth(rosVersion));
    }
    if (sets.length === 0) return;
    params.push(id);
    await this.db.execute(`UPDATE nas SET ${sets.join(', ')} WHERE id = ?`, params);
  }

  async deleteNas(id: number): Promise<number> {
    const result = await this.db.execute('DELETE FROM nas WHERE id = ?', [id]);
    return result.affectedRows ?? 0;
  }

  // Baris akuntansi yang menyebut NAS ini. Tidak ada FK ke `nas`, jadi
  // keterkaitan diperiksa lewat kolom nasipaddress.
  async nasReferences(nasname: string): Promise<{ accounting: number }> {
    const rows = await this.db.query<{ total: number }>(
      'SELECT COUNT(*) AS total FROM radacct WHERE nasipaddress = ?',
      [nasname],
    );
    return { accounting: Number(rows[0]?.total ?? 0) };
  }

  async countNasUsingAddress(nasname: string): Promise<number> {
    const rows = await this.db.query<{ total: number }>(
      'SELECT COUNT(*) AS total FROM nas WHERE nasname = ?',
      [nasname],
    );
    return Number(rows[0]?.total ?? 0);
  }

  /** Semua alamat NAS terdaftar — dipakai untuk menandai perangkat yang sudah masuk. */
  async listNasAddresses(): Promise<string[]> {
    const rows = await this.db.query<{ nasname: string }>('SELECT nasname FROM nas');
    return rows.map((row) => row.nasname);
  }

  async listUsers(query: { search?: string; page?: number; limit?: number }) {
    const where: string[] = [`c.attribute IN ('Cleartext-Password','MD5-Password','SHA2-Password')`];
    const params: unknown[] = [];
    if (query.search) {
      where.push('c.username LIKE ?');
      params.push(`%${query.search}%`);
    }
    const whereSql = `WHERE ${where.join(' AND ')}`;
    const limit = query.page ? Math.min(Math.max(query.limit ?? 20, 1), 200) : 1000;
    const offset = query.page ? (Math.max(query.page, 1) - 1) * limit : 0;

    const rows = await this.db.query<RadiusUserRow>(
      `SELECT c.id, c.username, c.value AS password,
              (SELECT g.groupname FROM radusergroup g WHERE g.username = c.username LIMIT 1) AS groupname
         FROM radcheck c ${whereSql}
        ORDER BY c.username LIMIT ? OFFSET ?`,
      [...params, limit, offset],
    );
    const totalRows = await this.db.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM radcheck c ${whereSql}`,
      params,
    );
    return { rows, total: Number(totalRows[0]?.total ?? 0) };
  }

  async findUser(username: string): Promise<RadiusUserRow | null> {
    const rows = await this.db.query<RadiusUserRow>(
      `SELECT c.id, c.username, c.value AS password,
              (SELECT g.groupname FROM radusergroup g WHERE g.username = c.username LIMIT 1) AS groupname
         FROM radcheck c
        WHERE c.username = ? AND c.attribute = 'Cleartext-Password' LIMIT 1`,
      [username],
    );
    return rows[0] ?? null;
  }

  async createUser(input: { username: string; password: string; group?: string }): Promise<void> {
    await this.db.withTransaction(async (connection) => {
      await connection.query(
        `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Cleartext-Password', ':=', ?)`,
        [input.username, input.password],
      );
      if (input.group && input.group.trim() !== '') {
        await connection.query(
          'INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)',
          [input.username, input.group.trim()],
        );
      }
    });
  }

  async updateUser(
    username: string,
    input: { password?: string; group?: string },
  ): Promise<void> {
    await this.db.withTransaction(async (connection) => {
      if (input.password !== undefined) {
        const [result] = await connection.query(
          `UPDATE radcheck SET value = ? WHERE username = ? AND attribute = 'Cleartext-Password'`,
          [input.password, username],
        );
        const affected = (result as { affectedRows?: number }).affectedRows ?? 0;
        if (affected === 0) {
          await connection.query(
            `INSERT INTO radcheck (username, attribute, op, value) VALUES (?, 'Cleartext-Password', ':=', ?)`,
            [username, input.password],
          );
        }
      }
      if (input.group !== undefined) {
        await connection.query('DELETE FROM radusergroup WHERE username = ?', [username]);
        if (input.group.trim() !== '') {
          await connection.query(
            'INSERT INTO radusergroup (username, groupname, priority) VALUES (?, ?, 1)',
            [username, input.group.trim()],
          );
        }
      }
    });
  }

  async deleteUser(username: string): Promise<void> {
    await this.db.withTransaction(async (connection) => {
      await connection.query('DELETE FROM radcheck WHERE username = ?', [username]);
      await connection.query('DELETE FROM radreply WHERE username = ?', [username]);
      await connection.query('DELETE FROM radusergroup WHERE username = ?', [username]);
    });
  }

  async sessions(limit = 200) {
    return this.db.query<RadiusSessionRow>(
      `SELECT radacctid, username, nasipaddress, framedipaddress, acctstarttime,
              acctsessiontime, acctinputoctets, acctoutputoctets, callingstationid
         FROM radacct WHERE acctstoptime IS NULL
        ORDER BY acctstarttime DESC LIMIT ?`,
      [Math.min(Math.max(limit, 1), 500)],
    );
  }

  // ---- Log autentikasi ---------------------------------------------------
  // Kolom identitas perangkat (nasipaddress/nasportid/nasporttype/framedipaddress)
  // ditambahkan migrasi 011; database lama harus menjawab 503, bukan error SQL.
  async authLogReady(): Promise<boolean> {
    const rows = await this.db.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM information_schema.COLUMNS
        WHERE table_schema = DATABASE() AND table_name = 'radpostauth'
          AND column_name IN ('nasipaddress', 'nasportid', 'nasporttype', 'framedipaddress')`,
    );
    return Number(rows[0]?.total ?? 0) === 4;
  }

  async authLog(filters: {
    search?: string;
    nas?: string;
    mac?: string;
    iface?: string;
    station?: string;
    reply?: string;
    limit: number;
    offset: number;
  }): Promise<{ rows: RadiusAuthLogRow[]; total: number }> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (filters.search) {
      const like = `%${filters.search}%`;
      where.push('(username LIKE ? OR callingstationid LIKE ? OR framedipaddress LIKE ?)');
      params.push(like, like, like);
    }
    if (filters.nas) {
      where.push('nasipaddress = ?');
      params.push(filters.nas);
    }
    if (filters.mac) {
      where.push('callingstationid LIKE ?');
      params.push(`%${filters.mac}%`);
    }
    if (filters.iface) {
      where.push('nasportid = ?');
      params.push(filters.iface);
    }
    if (filters.station) {
      where.push('calledstationid LIKE ?');
      params.push(`%${filters.station}%`);
    }
    if (filters.reply) {
      where.push('reply = ?');
      params.push(filters.reply);
    }
    const clause = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

    const rows = await this.db.query<RadiusAuthLogRow>(
      `SELECT id, username, reply, callingstationid, calledstationid, nasipaddress,
              nasportid, nasporttype, framedipaddress, authdate
         FROM radpostauth ${clause}
        ORDER BY authdate DESC, id DESC
        LIMIT ? OFFSET ?`,
      [...params, filters.limit, filters.offset],
    );
    const counts = await this.db.query<{ total: number }>(
      `SELECT COUNT(*) AS total FROM radpostauth ${clause}`,
      params,
    );
    return { rows, total: Number(counts[0]?.total ?? 0) };
  }

  // Pilihan filter diambil dari data yang benar-benar ada.
  async authLogFacets(): Promise<{ nas: string[]; interfaces: string[]; replies: string[] }> {
    const [nas, interfaces, replies] = await Promise.all([
      this.db.query<{ v: string }>(
        "SELECT DISTINCT nasipaddress AS v FROM radpostauth WHERE nasipaddress <> '' ORDER BY v",
      ),
      this.db.query<{ v: string }>(
        "SELECT DISTINCT nasportid AS v FROM radpostauth WHERE nasportid <> '' ORDER BY v",
      ),
      this.db.query<{ v: string }>('SELECT DISTINCT reply AS v FROM radpostauth ORDER BY v'),
    ]);
    return {
      nas: nas.map((row) => row.v),
      interfaces: interfaces.map((row) => row.v),
      replies: replies.map((row) => row.v),
    };
  }

  // ---- Grup RADIUS -------------------------------------------------------
  // Grup = nama di radgroupreply/radgroupcheck, dihubungkan ke user lewat
  // radusergroup. Semuanya di database supaya profil di FreeRADIUS dan
  // MikroTik bisa dibandingkan dari satu sumber.
  async listGroups(): Promise<
    Array<{
      groupname: string;
      users: number;
      rate_limit: string | null;
      session_timeout: string | null;
      simultaneous_use: string | null;
      attributes: number;
    }>
  > {
    return this.db.query(
      `SELECT g.groupname,
              (SELECT COUNT(*) FROM radusergroup u WHERE u.groupname = g.groupname) AS users,
              (SELECT value FROM radgroupreply r WHERE r.groupname = g.groupname
                 AND r.attribute = 'Mikrotik-Rate-Limit' LIMIT 1) AS rate_limit,
              (SELECT value FROM radgroupreply r WHERE r.groupname = g.groupname
                 AND r.attribute = 'Session-Timeout' LIMIT 1) AS session_timeout,
              (SELECT value FROM radgroupcheck c WHERE c.groupname = g.groupname
                 AND c.attribute = 'Simultaneous-Use' LIMIT 1) AS simultaneous_use,
              (SELECT COUNT(*) FROM radgroupreply r WHERE r.groupname = g.groupname) +
              (SELECT COUNT(*) FROM radgroupcheck c WHERE c.groupname = g.groupname) AS attributes
         FROM (SELECT groupname FROM radgroupreply
               UNION SELECT groupname FROM radgroupcheck
               UNION SELECT groupname FROM radusergroup) g
        ORDER BY g.groupname`,
    ) as Promise<
      Array<{
        groupname: string;
        users: number;
        rate_limit: string | null;
        session_timeout: string | null;
        simultaneous_use: string | null;
        attributes: number;
      }>
    >;
  }

  async findGroup(groupname: string) {
    const reply = await this.db.query<{ attribute: string; op: string; value: string }>(
      'SELECT attribute, op, value FROM radgroupreply WHERE groupname = ? ORDER BY id',
      [groupname],
    );
    const check = await this.db.query<{ attribute: string; op: string; value: string }>(
      'SELECT attribute, op, value FROM radgroupcheck WHERE groupname = ? ORDER BY id',
      [groupname],
    );
    const users = await this.db.query<{ username: string; priority: number }>(
      'SELECT username, priority FROM radusergroup WHERE groupname = ? ORDER BY priority, username',
      [groupname],
    );
    return { reply, check, users };
  }

  // Mengganti seluruh atribut grup dalam satu transaksi.
  async saveGroup(
    groupname: string,
    input: {
      reply: Array<{ attribute: string; op?: string; value: string }>;
      check: Array<{ attribute: string; op?: string; value: string }>;
    },
  ): Promise<void> {
    await this.db.withTransaction(async (connection) => {
      await connection.query('DELETE FROM radgroupreply WHERE groupname = ?', [groupname]);
      await connection.query('DELETE FROM radgroupcheck WHERE groupname = ?', [groupname]);
      for (const row of input.reply) {
        await connection.query(
          'INSERT INTO radgroupreply (groupname, attribute, op, value) VALUES (?, ?, ?, ?)',
          [groupname, row.attribute, row.op ?? ':=', row.value],
        );
      }
      for (const row of input.check) {
        await connection.query(
          'INSERT INTO radgroupcheck (groupname, attribute, op, value) VALUES (?, ?, ?, ?)',
          [groupname, row.attribute, row.op ?? ':=', row.value],
        );
      }
    });
  }

  async countGroupUsers(groupname: string): Promise<number> {
    const rows = await this.db.query<{ total: number }>(
      'SELECT COUNT(*) AS total FROM radusergroup WHERE groupname = ?',
      [groupname],
    );
    return Number(rows[0]?.total ?? 0);
  }

  async deleteGroup(groupname: string): Promise<number> {
    const users = await this.countGroupUsers(groupname);
    await this.db.withTransaction(async (connection) => {
      await connection.query('DELETE FROM radgroupreply WHERE groupname = ?', [groupname]);
      await connection.query('DELETE FROM radgroupcheck WHERE groupname = ?', [groupname]);
      await connection.query('DELETE FROM radusergroup WHERE groupname = ?', [groupname]);
    });
    return users;
  }

  async accounting(limit = 100) {
    return this.db.query<RadiusSessionRow & { acctstoptime: string | null; acctterminatecause: string | null }>(
      `SELECT radacctid, username, nasipaddress, framedipaddress, acctstarttime, acctstoptime,
              acctsessiontime, acctinputoctets, acctoutputoctets, callingstationid, acctterminatecause
         FROM radacct ORDER BY acctstarttime DESC LIMIT ?`,
      [Math.min(Math.max(limit, 1), 500)],
    );
  }

  // ---- Cek pemakaian (dialog, dipakai semua role) ------------------------
  // Read-only: identitas layanan dari radius_vouchers + angka pemakaian dari
  // radacct. Tidak menyentuh password dan tidak menulis apa pun.
  async usageLookup(input: {
    userType: 'customer' | 'voucher';
    username?: string;
    mac?: string;
  }): Promise<UsageLookupResult> {
    const userTypes = input.userType === 'customer' ? ['customer', 'member'] : ['voucher'];
    const where: string[] = ['v.user_type IN (?)'];
    const params: unknown[] = [userTypes];

    if (input.username) {
      where.push('v.username = ?');
      params.push(input.username);
    }
    if (input.mac) {
      where.push(
        'v.username IN (SELECT DISTINCT username FROM radacct WHERE callingstationid LIKE ?)',
      );
      params.push(`%${input.mac}%`);
    }

    const accounts = await this.db.query<UsageAccountRow>(
      `SELECT v.username, v.user_type, v.profile_type, v.profile_name, v.status,
              v.expires_at, v.quota_used_bytes, v.online_seconds, v.customer_id,
              c.name AS customer_name, c.phone AS customer_phone, c.status AS customer_status
         FROM radius_vouchers v
         LEFT JOIN customers c ON c.id = v.customer_id
        WHERE ${where.join(' AND ')}
        ORDER BY v.username LIMIT 10`,
      params,
    );

    // Username yang hanya dikenal radacct (akun lama / belum terdaftar di
    // radius_vouchers) tetap dicari pemakaiannya lewat username maupun MAC.
    let usernames = accounts.map((row) => row.username);
    if (input.username || input.mac) {
      const conditions: string[] = ['username IS NOT NULL'];
      const radacctParams: unknown[] = [];
      if (input.username) {
        conditions.push('username = ?');
        radacctParams.push(input.username);
      }
      if (input.mac) {
        conditions.push('callingstationid LIKE ?');
        radacctParams.push(`%${input.mac}%`);
      }
      const byRadacct = await this.db.query<{ username: string }>(
        `SELECT DISTINCT username FROM radacct
          WHERE ${conditions.join(' AND ')} LIMIT 10`,
        radacctParams,
      );
      usernames = [...new Set([...usernames, ...byRadacct.map((row) => row.username)])];
    }

    // Jangan campur bucket: di mode voucher jangan tampilkan akun pelanggan
    // (dan sebaliknya) hanya karena punya jejak radacct.
    if (usernames.length > 0) {
      const opposite = input.userType === 'customer' ? ['voucher'] : ['customer', 'member'];
      const foreign = await this.db.query<{ username: string }>(
        `SELECT username FROM radius_vouchers WHERE username IN (?) AND user_type IN (?)`,
        [usernames, opposite],
      );
      const foreignSet = new Set(foreign.map((row) => row.username));
      usernames = usernames.filter((name) => !foreignSet.has(name));
    }
    usernames = usernames.slice(0, 5);

    if (usernames.length === 0) {
      return { results: [] };
    }

    const sessions = await this.db.query<UsageSessionRow>(
      `SELECT username, nasipaddress, framedipaddress, acctstarttime, acctstoptime,
              acctsessiontime, acctinputoctets, acctoutputoctets, callingstationid
         FROM radacct WHERE username IN (?)
        ORDER BY acctstarttime DESC LIMIT 500`,
      [usernames],
    );

    const results = usernames.map((username) => {
      const rows = sessions.filter((row) => row.username === username);
      const sum = (pick: (row: UsageSessionRow) => number | null) =>
        rows.reduce((total, row) => total + Number(pick(row) ?? 0), 0);
      return {
        account: accounts.find((row) => row.username === username) ?? null,
        username,
        usage: {
          sessions: rows.length,
          in_bytes: sum((row) => row.acctinputoctets),
          out_bytes: sum((row) => row.acctoutputoctets),
          last_seen: rows[0]?.acctstarttime ?? null,
        },
        active: rows.filter((row) => row.acctstoptime === null).slice(0, 5),
        recent: rows.slice(0, 5),
      };
    });

    return { results };
  }
}

export interface UsageAccountRow {
  username: string;
  user_type: 'voucher' | 'customer' | 'member';
  profile_type: string | null;
  profile_name: string | null;
  status: string;
  expires_at: string | null;
  quota_used_bytes: number;
  online_seconds: number;
  customer_id: number | null;
  customer_name: string | null;
  customer_phone: string | null;
  customer_status: string | null;
}

export interface UsageSessionRow {
  username: string;
  nasipaddress: string;
  framedipaddress: string;
  acctstarttime: string | null;
  acctstoptime: string | null;
  acctsessiontime: number | null;
  acctinputoctets: number | null;
  acctoutputoctets: number | null;
  callingstationid: string;
}

export interface UsageLookupResult {
  results: Array<{
    account: UsageAccountRow | null;
    username: string;
    usage: { sessions: number; in_bytes: number; out_bytes: number; last_seen: string | null };
    active: UsageSessionRow[];
    recent: UsageSessionRow[];
  }>;
}