import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Role } from '../../config/config.service';
import { PasswordService } from '../auth/password.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';

export interface User {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  role: Role;
  phone?: string;
  address?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export type PublicUser = Omit<User, 'password_hash'>;

@Injectable()
export class AdminService {
  private users: User[] = [];

  constructor(private readonly passwords: PasswordService) {}

  private toPublicUser(user: User): PublicUser {
    const { password_hash: _passwordHash, ...publicUser } = user;
    return publicUser;
  }

  private findInternal(id: number): User {
    const user = this.users.find((u) => u.id === id);
    if (!user) {
      throw new NotFoundException(`Pengguna dengan ID ${id} tidak ditemukan`);
    }
    return user;
  }

  findAll(): PublicUser[] {
    return this.users.map((user) => this.toPublicUser(user));
  }

  findOne(id: number): PublicUser {
    return this.toPublicUser(this.findInternal(id));
  }

  findByEmail(email: string) {
    return this.users.find((u) => u.email === email);
  }

  async create(createDto: CreateUserDto): Promise<PublicUser> {
    const now = new Date();
    const exists = this.findByEmail(createDto.email);
    if (exists) {
      throw new ConflictException('Email sudah terdaftar');
    }
    const user: User = {
      id: this.users.length + 1,
      name: createDto.name,
      email: createDto.email,
      // Sebelumnya nilai mentah ADMIN_DEFAULT_PASSWORD ditulis ke kolom hash.
      // Sekarang selalu bcrypt dari password yang dikirim admin.
      password_hash: await this.passwords.hash(createDto.password),
      role: createDto.role,
      phone: createDto.phone,
      address: createDto.address || '',
      is_active: createDto.is_active !== false,
      created_at: now,
      updated_at: now,
    };
    this.users.push(user);
    return this.toPublicUser(user);
  }

  async update(id: number, updateDto: UpdateUserDto): Promise<PublicUser> {
    const user = this.findInternal(id);
    if (updateDto.email && updateDto.email !== user.email) {
      const exists = this.findByEmail(updateDto.email);
      if (exists) {
        throw new ConflictException('Email sudah terdaftar');
      }
    }

    const { password, ...rest } = updateDto;
    Object.assign(user, rest);
    if (password) {
      user.password_hash = await this.passwords.hash(password);
    }
    user.updated_at = new Date();
    return this.toPublicUser(user);
  }

  remove(id: number) {
    const index = this.users.findIndex((u) => u.id === id);
    if (index === -1) {
      throw new NotFoundException(`Pengguna dengan ID ${id} tidak ditemukan`);
    }
    this.users.splice(index, 1);
    return { ok: true };
  }
}
