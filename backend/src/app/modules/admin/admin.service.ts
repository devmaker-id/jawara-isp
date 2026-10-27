import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PasswordService } from '../auth/password.service';
import { toPublicUser, PublicUser } from '../auth/auth.mapper';
import {
  CreateUserRecord,
  UpdateUserRecord,
  UserQuery,
  UsersRepository,
  UserRecord,
} from '../users/users.repository';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

export type { PublicUser };

export interface UserPage {
  rows: PublicUser[];
  total: number;
  page: number;
  limit: number;
}

// Manajemen akun memakai repository yang SAMA dengan AuthService, sehingga
// user yang dibuat di sini langsung dapat login. Password selalu di-hash di
// service; hash tidak pernah keluar dari lapisan ini (toPublicUser membuang
// password_hash).
@Injectable()
export class AdminService {
  constructor(
    private readonly passwords: PasswordService,
    private readonly users: UsersRepository,
  ) {}

  async findAll(): Promise<PublicUser[]> {
    const users = await this.users.findAll();
    return users.map(toPublicUser);
  }

  // Tanpa `page` hasil tetap berupa array (kompatibel dengan klien lama).
  // Dengan `page` hasil dipaginasi: { rows, total, page, limit }.
  async list(query: UserQuery): Promise<PublicUser[] | UserPage> {
    if (query.page === undefined) {
      const users = await this.users.findAll();
      const needle = query.search?.trim().toLowerCase();
      const visible = users.filter((user) => {
        if (query.role && user.role !== query.role) return false;
        if (query.isActive !== undefined && user.is_active !== query.isActive) return false;
        if (needle) {
          const haystack = `${user.name} ${user.email}`.toLowerCase();
          if (!haystack.includes(needle)) return false;
        }
        return true;
      });
      return visible.map(toPublicUser);
    }

    const limit = Math.max(1, Math.min(200, query.limit ?? 20));
    const page = Math.max(1, query.page);
    const { rows, total } = await this.users.findPage({ ...query, page, limit });
    return { rows: rows.map(toPublicUser), total, page, limit };
  }

  async findOne(id: number): Promise<PublicUser> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException(`Pengguna dengan ID ${id} tidak ditemukan`);
    }
    return toPublicUser(user);
  }

  findByEmail(email: string): Promise<UserRecord | null> {
    return this.users.findByEmail(email);
  }

  async create(createDto: CreateUserDto): Promise<PublicUser> {
    const email = createDto.email.trim().toLowerCase();
    const exists = await this.users.existsByEmail(email);
    if (exists) {
      throw new ConflictException('Email sudah terdaftar');
    }

    const data: CreateUserRecord = {
      name: createDto.name.trim(),
      email,
      // Password selalu di-hash di sini; tidak pernah ditulis mentah.
      password_hash: await this.passwords.hash(createDto.password),
      role: createDto.role,
      phone: createDto.phone ?? null,
      address: createDto.address ?? null,
      is_active: createDto.is_active !== false,
    };

    try {
      const created = await this.users.create(data);
      return toPublicUser(created);
    } catch (error) {
      if ((error as { code?: string })?.code === 'ER_DUP_ENTRY') {
        throw new ConflictException('Email sudah terdaftar');
      }
      throw error;
    }
  }

  async update(id: number, updateDto: UpdateUserDto, actorId?: number): Promise<PublicUser> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException(`Pengguna dengan ID ${id} tidak ditemukan`);
    }

    const isSelf = actorId !== undefined && actorId === id;
    const roleChanged = updateDto.role !== undefined && updateDto.role !== user.role;

    // Admin tidak boleh mengunci dirinya sendiri: menurunkan role sendiri
    // membuatnya kehilangan akses manajemen akun pada request berikutnya.
    if (isSelf && roleChanged) {
      throw new ForbiddenException('Tidak dapat mengubah role akun sendiri');
    }
    if (isSelf && updateDto.is_active === false) {
      throw new ForbiddenException('Tidak dapat menonaktifkan akun sendiri');
    }

    // Admin terakhir yang masih aktif tidak boleh dinonaktifkan/diturunkan,
    // karena sistem akan kehilangan satu-satunya pengelola akun.
    const losesAdmin = user.role === 'admin' && user.is_active;
    const staysAdmin = (updateDto.role ?? user.role) === 'admin' && updateDto.is_active !== false;
    if (losesAdmin && !staysAdmin) {
      const others = await this.users.countActiveAdminsExcept(id);
      if (others === 0) {
        throw new ConflictException(
          'Admin aktif terakhir tidak boleh dinonaktifkan atau diturunkan role-nya',
        );
      }
    }

    if (updateDto.email && updateDto.email.toLowerCase() !== user.email.toLowerCase()) {
      const exists = await this.users.existsByEmail(updateDto.email);
      if (exists) {
        throw new ConflictException('Email sudah terdaftar');
      }
    }

    const { password, ...rest } = updateDto;
    const data: UpdateUserRecord = {
      ...rest,
      name: rest.name?.trim(),
      email: rest.email?.trim().toLowerCase(),
      // Password hanya dikirim ke repository dalam bentuk hash.
      password_hash: password ? await this.passwords.hash(password) : undefined,
    };

    try {
      const updated = await this.users.update(id, data);
      if (!updated) {
        throw new NotFoundException(`Pengguna dengan ID ${id} tidak ditemukan`);
      }
      return toPublicUser(updated);
    } catch (error) {
      if ((error as { code?: string })?.code === 'ER_DUP_ENTRY') {
        throw new ConflictException('Email sudah terdaftar');
      }
      throw error;
    }
  }

  /**
   * Hapus akun pengguna.
   *
   * Aturan yang berlaku:
   *  1. Administrator UTAMA tidak boleh dihapus, siapa pun yang meminta.
   *  2. Akun sendiri tidak boleh dihapus (mencegah panel kehilangan akses
   *     saat operatornya sendiri hilang).
   *  3. Role apa pun (admin/operator/resseler) boleh dihapus — TIDAK ada
   *     larangan karena role — asalkan akun itu tidak terikat data warisan.
   *  4. Penghapusan hanya berhasil bila akun tidak memiliki pelanggan,
   *     voucher, profil, perangkat, jejak audit, atau transaksi. Kalau ada,
   *     permintaan ditolak dengan menyebut APA yang menghalangi, karena
   *     menghapus akun seperti itu akan menghilangkan riwayat atau membuat
   *     data kehilangan penanggung jawab.
   *  5. Panel tidak boleh kehilangan seluruh admin aktif.
   */
  async remove(id: number, actorId?: number): Promise<{ ok: true }> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException(`Pengguna dengan ID ${id} tidak ditemukan`);
    }

    if (user.is_primary) {
      throw new ForbiddenException(
        'Administrator utama tidak dapat dihapus. Akun ini adalah pemilik panel dan satu-satunya yang dilindungi dari penghapusan.',
      );
    }

    if (actorId !== undefined && actorId === id) {
      throw new ForbiddenException('Tidak dapat menghapus akun sendiri');
    }

    if (user.role === 'admin' && user.is_active) {
      const others = await this.users.countActiveAdminsExcept(id);
      if (others === 0) {
        throw new ConflictException(
          'Akun admin aktif terakhir tidak boleh dihapus. Tambahkan admin lain lebih dulu.',
        );
      }
    }

    const blockers = await this.users.referenceBreakdown(id);
    if (blockers.length > 0) {
      const detail = blockers.map((item) => `${item.count} ${item.label}`).join(', ');
      throw new ConflictException(
        `Akun ini masih terikat data: ${detail}. Nonaktifkan akunnya, jangan dihapus — ` +
          'menghapus akan menghilangkan riwayat atau membuat data kehilangan pemilik. ' +
          'Pindahkan dulu kepemilikan datanya bila memang ingin dihapus permanen.',
      );
    }

    const deleted = await this.users.remove(id);
    if (!deleted) {
      throw new NotFoundException(`Pengguna dengan ID ${id} tidak ditemukan`);
    }
    return { ok: true };
  }
}