// Shared TypeScript types

export type Role = 'admin' | 'operator' | 'resseler';

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  phone?: string;
  createdAt: string;
}

export interface Customer {
  id: number;
  name: string;
  email: string;
  phone: string;
  address: string;
  is_active: boolean;
  created_at: string;
}

export interface PackageItem {
  id: number;
  name: string;
  description: string;
  price: number;
  data_limit: string;
  speed: number;
  valid_days: number;
  is_active: boolean;
}

export interface Invoice {
  id: number;
  customer_id: number;
  amount: number;
  status: 'unpaid' | 'paid' | 'overdue' | 'partial';
  due_date: string;
  paid_date?: string;
  invoice_number: string;
  description: string;
}

export interface ServiceSession {
  id: number;
  customer_id: number;
  service_type: 'pppoe' | 'hotspot';
  status: 'active' | 'inactive' | 'expired';
  username: string;
  ip_address?: string;
  data_used: number;
  started_at: string;
  expires_at: string;
}

export interface AuditLog {
  id: number;
  user_id: number;
  action: string;
  details: string;
  ip_address: string;
  created_at: string;
}

export interface Config {
  db_host: string;
  freeradius_host: string;
  mikrotik_host: string;
}
