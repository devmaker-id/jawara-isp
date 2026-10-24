import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PasswordService } from '../auth/password.service';
import { toPublicUser, PublicUser } from '../auth/auth.mapper';
import {
  CreateUserRecord,
  UpdateUserRecord,
  UsersRepository,
  UserRecord,
} from '../users/users.repository';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

export type { PublicUser };

// Manajemen akun memakai repository yang SAMA dengan AuthService, sehingga
// user yang dibuat di sini langsung dapat login.
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
    const exists = await this.users.existsByEmail(createDto.email);
    if (exists) {
      throw new ConflictException('Email sudah terdaftar');
    }

    const data: CreateUserRecord = {
      name: createDto.name,
      email: createDto.email.trim(),
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

  async update(id: number, updateDto: UpdateUserDto): Promise<PublicUser> {
    const user = await this.users.findById(id);
    if (!user) {
      throw new NotFoundException(`Pengguna dengan ID ${id} tidak ditemukan`);
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
      email: rest.email?.trim(),
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

  async remove(id: number): Promise<{ ok: true }> {
    const deleted = await this.users.remove(id);
    if (!deleted) {
      throw new NotFoundException(`Pengguna dengan ID ${id} tidak ditemukan`);
    }
    return { ok: true };
  }
}
