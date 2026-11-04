import {
  OltSyslogDriver,
  OltSyslogDriverFactory,
  OltSyslogUnsupportedError,
} from './olt-syslog-driver';
import { HisfocusSyslogDriver } from './hisfocus.syslog';
import { VsolSyslogDriver } from './vsol.syslog';
import { OltConnection } from '../driver/olt-driver';

/**
 * Daftar driver syslog per vendor. Dicocokkan huruf kecil; `global` = alias VSOL.
 * Berlaku pola yang sama seperti driver/registry.ts: menambah vendor = satu baris di sini.
 */
const DRIVERS: Record<string, OltSyslogDriverFactory> = {
  vsol: (connection) => new VsolSyslogDriver(connection),
  global: (connection) => new VsolSyslogDriver(connection),
  hisfocus: (connection) => new HisfocusSyslogDriver(connection),
  hioso: (connection) => new HisfocusSyslogDriver(connection),
};

export const supportedSyslogVendors = (): string[] => Object.keys(DRIVERS).sort();

export const createSyslogDriver = (connection: OltConnection): OltSyslogDriver => {
  const key = (connection.vendor ?? '').trim().toLowerCase();
  const factory = DRIVERS[key];
  if (!factory) throw new OltSyslogUnsupportedError(connection.vendor || '(kosong)');
  return factory(connection);
};