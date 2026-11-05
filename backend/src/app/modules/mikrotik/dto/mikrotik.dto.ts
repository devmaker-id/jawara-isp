import { IsBoolean, IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';

const boolFromInput = ({ value }: { value: unknown }): unknown => {
  if (value === 'true' || value === '1' || value === 1 || value === true) return true;
  if (value === 'false' || value === '0' || value === 0 || value === false) return false;
  return value;
};

// Angka RouterOS (distance/scope) boleh dikirim sebagai number atau string;
// dinormalisasi ke string supaya class-validator @IsString tidak menolaknya.
const stringifyInput = ({ value }: { value: unknown }): unknown =>
  value === undefined || value === null ? value : String(value);

export class HotspotUserDto {
  @IsString()
  @Length(1, 64, { message: 'Nama user 1-64 karakter' })
  @Matches(/^[A-Za-z0-9._@-]+$/, { message: 'Nama user hanya boleh huruf, angka, . _ @ -' })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64, { message: 'Password maksimal 64 karakter' })
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  profile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  server?: string;

  // RouterOS memakai string uptime, mis. "1d", "04:00:00", "30m".
  @IsOptional()
  @IsString()
  @MaxLength(32)
  limit_uptime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  comment?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean()
  disabled?: boolean;
}

export class UpdateHotspotUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  password?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  profile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  limit_uptime?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  comment?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean()
  disabled?: boolean;
}

export class PppSecretDto {
  @IsString()
  @Length(1, 64, { message: 'Nama PPP 1-64 karakter' })
  @Matches(/^[A-Za-z0-9._@-]+$/, { message: 'Nama PPP hanya boleh huruf, angka, . _ @ -' })
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  password?: string;

  @IsOptional()
  @IsIn(['any', 'pppoe', 'pptp', 'l2tp', 'ovpn'], { message: 'Service harus any/pppoe/pptp/l2tp/ovpn' })
  service?: 'any' | 'pppoe' | 'pptp' | 'l2tp' | 'ovpn';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  profile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  remote_address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  comment?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean()
  disabled?: boolean;
}

export class UpdatePppSecretDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  password?: string;

  @IsOptional()
  @IsIn(['any', 'pppoe', 'pptp', 'l2tp', 'ovpn'])
  service?: 'any' | 'pppoe' | 'pptp' | 'l2tp' | 'ovpn';

  @IsOptional()
  @IsString()
  @MaxLength(64)
  profile?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  remote_address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  comment?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean()
  disabled?: boolean;
}

export class InterfaceUpdateDto {
  @Transform(boolFromInput)
  @IsBoolean({ message: 'disabled harus true/false' })
  disabled!: boolean;
}

// ===== Firewall (filter / nat / mangle) =====

export type FirewallTable = 'filter' | 'nat' | 'mangle';

export const FIREWALL_TABLES: FirewallTable[] = ['filter', 'nat', 'mangle'];

export class FirewallRuleDto {
  @IsString()
  @Length(1, 64, { message: 'chain 1-64 karakter' })
  chain!: string;

  @IsString()
  @Length(1, 64, { message: 'action 1-64 karakter' })
  action!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  protocol?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  src_address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  dst_address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  src_port?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  dst_port?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  in_interface?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  out_interface?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  connection_state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  src_mac?: string;

  // NAT
  @IsOptional()
  @IsString()
  @MaxLength(128)
  to_addresses?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  to_ports?: string;

  // Mangle
  @IsOptional()
  @IsString()
  @MaxLength(64)
  new_connection_mark?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  new_routing_mark?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  new_packet_mark?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  comment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  place_before?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean()
  disabled?: boolean;
}

export class UpdateFirewallRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  chain?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  protocol?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  src_address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  dst_address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  src_port?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  dst_port?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  in_interface?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  out_interface?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  connection_state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  src_mac?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  to_addresses?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  to_ports?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  new_connection_mark?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  new_routing_mark?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  new_packet_mark?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  comment?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  place_before?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean()
  disabled?: boolean;
}

// ===== Firewall address-list =====

export class FirewallAddressListDto {
  @IsString()
  @Length(1, 64, { message: 'list 1-64 karakter' })
  @Matches(/^[A-Za-z0-9._-]+$/, { message: 'list hanya huruf, angka, . _ -' })
  list!: string;

  @IsString()
  @Length(1, 64, { message: 'address 1-64 karakter' })
  address!: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  comment?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean()
  disabled?: boolean;
}

export class UpdateFirewallAddressListDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  list?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  comment?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean()
  disabled?: boolean;
}

// ===== Route (/ip route) =====

export class RouteDto {
  @IsString()
  @Length(1, 64, { message: 'dst-address 1-64 karakter (mis. 0.0.0.0/0)' })
  dst_address!: string;

  @IsString()
  @Length(1, 64, { message: 'gateway 1-64 karakter' })
  gateway!: string;

  @IsOptional()
  @Transform(stringifyInput)
  @IsString()
  distance?: string;

  @IsOptional()
  @Transform(stringifyInput)
  @IsString()
  scope?: string;

  @IsOptional()
  @Transform(stringifyInput)
  @IsString()
  target_scope?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  routing_table?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  routing_mark?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  comment?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean()
  disabled?: boolean;
}

export class UpdateRouteDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  dst_address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  gateway?: string;

  @IsOptional()
  @Transform(stringifyInput)
  @IsString()
  distance?: string;

  @IsOptional()
  @Transform(stringifyInput)
  @IsString()
  scope?: string;

  @IsOptional()
  @Transform(stringifyInput)
  @IsString()
  target_scope?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  routing_table?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  routing_mark?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  comment?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean()
  disabled?: boolean;
}

// ===== Route rule (policy routing; /ip route rule ROS6, /routing rule ROS7) =====

export class RouteRuleDto {
  @IsString()
  @Length(1, 64, { message: 'table 1-64 karakter' })
  table!: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  src_address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  dst_address?: string;

  // Hanya bermakna di RouterOS 6 (/ip route rule).
  @IsOptional()
  @IsString()
  @MaxLength(64)
  routing_mark?: string;

  @IsOptional()
  @IsIn(['lookup', 'drop', 'unreachable'], { message: 'action harus lookup/drop/unreachable' })
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  comment?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean()
  disabled?: boolean;
}

export class UpdateRouteRuleDto {
  @IsOptional()
  @IsString()
  @MaxLength(64)
  table?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  src_address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  dst_address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  routing_mark?: string;

  @IsOptional()
  @IsIn(['lookup', 'drop', 'unreachable'])
  action?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  comment?: string;

  @IsOptional()
  @Transform(boolFromInput)
  @IsBoolean()
  disabled?: boolean;
}