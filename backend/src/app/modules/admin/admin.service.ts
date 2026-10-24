import { Injectable, NotFoundException } from '@nestjs/common';
import { Role, RoleValues } from '../../config/config.service';
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

@Injectable()
export class AdminService {
  private users: User[] = [];

  findAll() {
    return this.users;
  }

  findOne(id: number) {
    const user = this.users.find((u) => u.id === id);
    if (!user) {
      throw new NotFoundException(`Pengguna dengan ID ${id} tidak ditemukan`);
    }
    return user;
  }

  findByEmail(email: string) {
    return this.users.find((u) => u.email === email);
  }

  create(createDto: CreateUserDto) {
    const now = new Date();
    const exists = this.findByEmail(createDto.email);
    if (exists) {
      throw new Error('Email sudah terdaftar');
    }
    const user: User = {
      id: this.users.length + 1,
      name: createDto.name,
      email: createDto.email,
      password_hash: process.env.ADMIN_DEFAULT_PASSWORD || 'change-me',
      role: createDto.role,
      phone: createDto.phone,
      address: createDto.address || '',
      is_active: createDto.is_active !== false,
      created_at: now,
      updated_at: now,
    };
    this.users.push(user);
    return user;
  }

  update(id: number, updateDto: UpdateUserDto) {
    const user = this.findOne(id);
    if (updateDto.email && updateDto.email !== user.email) {
      const exists = this.findByEmail(updateDto.email);
      if (exists) {
        throw new Error('Email sudah terdaftar');
      }
    }
    Object.assign(user, updateDto);
    user.updated_at = new Date();
    return user;
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
