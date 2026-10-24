import { Injectable, NotFoundException } from '@nestjs/common';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';

export interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  is_active: boolean;
  created_at: Date;
}

@Injectable()
export class CustomersService {
  private customers: Customer[] = [];

  findAll() {
    return this.customers;
  }

  findOne(id: number) {
    const customer = this.customers.find((c) => c.id === id);
    if (!customer) {
      throw new NotFoundException(`Pelanggan dengan ID ${id} tidak ditemukan`);
    }
    return customer;
  }

  create(createDto: CreateCustomerDto) {
    const now = new Date();
    const customer: Customer = {
      id: this.customers.length + 1,
      name: createDto.name,
      email: createDto.email,
      phone: createDto.phone,
      address: createDto.address || '',
      is_active: createDto.is_active !== false,
      created_at: now,
    };
    this.customers.push(customer);
    return customer;
  }

  update(id: number, updateDto: UpdateCustomerDto) {
    const customer = this.findOne(id);
    Object.assign(customer, updateDto);
    return customer;
  }

  remove(id: number) {
    const index = this.customers.findIndex((c) => c.id === id);
    if (index === -1) {
      throw new NotFoundException(`Pelanggan dengan ID ${id} tidak ditemukan`);
    }
    this.customers.splice(index, 1);
    return { ok: true };
  }
}
