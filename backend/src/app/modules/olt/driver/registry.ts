import {
  OltAdapter,
  OltAdapterFactory,
  OltConnection,
  OltDriverUnsupportedError,
} from './olt-driver';
import { VsolAdapter } from '../vendors/vsol/vsol.adapter';

/**
 * Daftar driver yang terpasang di panel.
 *
 * Menambah vendor baru = menambah satu baris di sini + satu folder di
 * `vendors/`. Tidak ada perubahan di service, controller, atau skema database,
 * karena semuanya berbicara lewat kontrak `OltAdapter`.
 *
 * Kunci dicocokkan huruf kecil. "global" adalah alias: perangkat GLOBAL yang
 * dipakai di lapangan menjalankan platform VSOL dengan perintah yang sama.
 */
const DRIVERS: Record<string, OltAdapterFactory> = {
  vsol: (connection) => new VsolAdapter(connection),
  global: (connection) => new VsolAdapter(connection),
};

export const supportedVendors = (): string[] => Object.keys(DRIVERS).sort();

export const createAdapter = (connection: OltConnection): OltAdapter => {
  const key = (connection.vendor ?? '').trim().toLowerCase();
  const factory = DRIVERS[key];
  if (!factory) throw new OltDriverUnsupportedError(connection.vendor || '(kosong)');
  return factory(connection);
};