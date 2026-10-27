import { describe, expect, it } from 'vitest';
import {
  parseOnuDesc,
  parseOnuOptical,
  parseOnuState,
} from '../src/app/modules/olt/vendors/vsol/vsol.parser';

/**
 * Fixture diambil dari keluaran asli OLT-MUNCANG (GLOBAL / VSOL V1.1.9),
 * sesi read-only 2026-10-27. Jangan "dirapikan": bentuk menempel tanpa spasi
 * itulah yang harus diurai.
 */

const STATE = [
  'OLT-MUNCANG(config-pon-0/1)# show onu state',
  '1:1enableenableworkingZICG295ebcf2',
  '1:2enableenableworkingZTEGcca25df4',
  '1:3enabledisablelosHWTC8a1b2c3d',
  '1:4disableenableofflineFHTT0000aaaa',
  'total: 4 working: 2',
  'OLT-MUNCANG(config-pon-0/1)#',
].join('\r\n');

const DESC = [
  'OLT-MUNCANG(config-pon-0/1)# show onu desc',
  'onu 1 Description: Uyang_Cibainun',
  'onu 2 Description: Warno_Ciloa',
  'onu 3 Description:',
  'OLT-MUNCANG(config-pon-0/1)#',
].join('\r\n');

const OPTICAL = [
  'OLT-MUNCANG(config-pon-0/1)# show onu optical-info',
  'ONU ID                     : 1',
  'Rx optical level(ONU)      : -9.53',
  'Rx optical level(OLT)      : -16.18',
  'Tx optical level           : 1.91',
  'Power feed voltage         : 3.26(V)',
  'Laser bias current         : 14.550(mA)',
  'Temperature                : 50.277(C)',
  'ONU ID                     : 2',
  'Rx optical level(ONU)      : -27.40',
  'Rx optical level(OLT)      : -20.05',
  'Tx optical level           : 2.10',
  'Power feed voltage         : 3.30(V)',
  'Laser bias current         : 13.100(mA)',
  'Temperature                : 47.000(C)',
  'OLT-MUNCANG(config-pon-0/1)#',
].join('\r\n');

describe('parser VSOL — show onu state', () => {
  it('memecah kolom yang menempel menjadi field terpisah', () => {
    const rows = parseOnuState(STATE);
    expect(rows).toHaveLength(4);

    expect(rows[0]).toEqual({
      onuId: '1',
      portIndex: '1',
      adminState: 'enable',
      omccState: 'enable',
      phaseState: 'working',
      serialNumber: 'ZICG295ebcf2',
      online: true,
    });
  });

  it('tidak menganggap ringkasan total/working sebagai ONU', () => {
    const rows = parseOnuState(STATE);
    expect(rows.map((row) => row.onuId)).toEqual(['1', '2', '3', '4']);
  });

  it('ONU los / offline tidak dihitung online', () => {
    const rows = parseOnuState(STATE);
    const byId = new Map(rows.map((row) => [row.onuId, row]));
    expect(byId.get('3')?.phaseState).toBe('los');
    expect(byId.get('3')?.online).toBe(false);
    expect(byId.get('4')?.online).toBe(false);
    expect(rows.filter((row) => row.online)).toHaveLength(2);
  });

  it('tetap membaca format yang memakai spasi antar kolom', () => {
    const spaced = [
      '1:1 enable enable working ZICG295ebcf2',
      '1:2 enable disable los HWTC8a1b2c3d',
    ].join('\n');
    const rows = parseOnuState(spaced);
    expect(rows).toHaveLength(2);
    expect(rows[0].serialNumber).toBe('ZICG295ebcf2');
    expect(rows[1].phaseState).toBe('los');
  });

  it('keluaran kosong / pesan galat tidak menghasilkan baris', () => {
    expect(parseOnuState('')).toEqual([]);
    expect(parseOnuState('% Unknown command, please check your input.')).toEqual([]);
  });
});

describe('parser VSOL — show onu desc', () => {
  it('membaca deskripsi dan mengabaikan yang kosong', () => {
    const map = parseOnuDesc(DESC);
    expect(map.get('1')).toBe('Uyang_Cibainun');
    expect(map.get('2')).toBe('Warno_Ciloa');
    expect(map.get('3')).toBe('');
    expect(map.has('9')).toBe(false);
  });
});

describe('parser VSOL — show onu optical-info', () => {
  it('membaca redaman, suhu, tegangan, dan bias sebagai angka', () => {
    const rows = parseOnuOptical(OPTICAL);
    expect(rows).toHaveLength(2);

    expect(rows[0]).toEqual({
      onuId: '1',
      rxPowerOnu: -9.53,
      rxPowerOlt: -16.18,
      txPower: 1.91,
      temperature: 50.277,
      voltage: 3.26,
      txBias: 14.55,
    });
  });

  it('ONU dengan redaman lemah tetap terbaca apa adanya', () => {
    const rows = parseOnuOptical(OPTICAL);
    expect(rows[1].rxPowerOnu).toBe(-27.4);
  });

  it('blok tanpa angka tidak menghasilkan nilai palsu 0', () => {
    const rows = parseOnuOptical(
      ['ONU ID                     : 1', 'Rx optical level(ONU)      : -', 'Tx optical level           : --'].join(
        '\n',
      ),
    );
    expect(rows[0].rxPowerOnu).toBeNull();
    expect(rows[0].txPower).toBeNull();
  });
});