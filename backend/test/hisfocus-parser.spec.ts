import { describe, expect, it } from 'vitest';
import {
  parseOnuTable,
  parseOptical,
  parseSystem,
  parseOnuInfoCtc,
} from '../src/app/modules/olt/vendors/hisfocus/hisfocus.parser';

/**
 * Fixture dari keluaran asli OLT Bibitnet Nanggela (HiFocus/Hioso EPON,
 * software V2.2.67), sesi read-only. Spasi kolom dipertahankan apa adanya:
 * nama pelanggan mengandung spasi tunggal, sedangkan kolom lain dipisah
 * beberapa spasi.
 */

const TABLE = [
  'OLT_BIBITNET# show onu info epon 0/1 all',
  'OnuId  MacAddress        Status  Firmware ChipId Ge Fe Pots CtcStatus      CtcVer Activate Uptime           Name ',
  '===================================================================================================================',
  '0/1:1  a4:f3:3b:61:77:bb Up      101      9127   1  3  1    CtcNegDone     30     Yes      7D7H29M10S       Noval - NUNGGUL ',
  '0/1:2  5c:e8:83:f2:36:dc Up      3230     6301   4  17 2    CtcNegDone     30     Yes      5D6H20M20S       POP VEGASUS ',
  '0/1:3  6c:d2:ba:5a:a7:ec Down    101      9127   1  3  1    CtcNegFail     30     No       0H0M0S           Oktaviani - NUNGGUL ',
  '0/1:4  64:f8:8a:82:22:c0 Up      3132     cce4   1  3  1    CtcNegDone     30     Yes      4D10H3M4S        budi_rismawan ',
  'OLT_BIBITNET#',
].join('\r\n');

const OPTICAL = [
  'OLT_BIBITNET# show onu optical-ddm epon 0/1 1',
  ' Temperature  : 53.00 C ',
  ' Voltage      : 3.00  V ',
  ' TxBias       : 17.00 mA',
  ' TxPower      : 2.40 dBm',
  ' RxPower      : -12.24 dBm',
  'OLT_BIBITNET#',
].join('\r\n');

const SYSTEM = [
  'OLT_BIBITNET# show system',
  'Current configuration:',
  ' MAC          : 78:5c:72:a4:5b:bc',
  ' Name         : OLT_BIBITNET',
  ' Description  : Pt. Bibit Networks Indonesia',
  ' Model        : OLT',
  ' Software     : V2.2.67',
  ' UpTime       : 37 days 16 hours 13 minites 11 seconds',
  'OLT_BIBITNET#',
].join('\r\n');

describe('parser HiFocus — show onu info epon all', () => {
  it('memecah baris tabel menjadi field yang benar', () => {
    const rows = parseOnuTable(TABLE);
    expect(rows).toHaveLength(4);

    expect(rows[0]).toEqual({
      portId: '0/1',
      onuId: '1',
      onuMac: 'a4:f3:3b:61:77:bb',
      adminState: 'enable',
      omccState: 'enable',
      phaseState: 'up',
      connectionState: 'ONLINE',
      online: true,
      name: 'Noval - NUNGGUL',
    });
  });

  it('nama pelanggan dengan spasi tunggal tidak terpotong', () => {
    const rows = parseOnuTable(TABLE);
    expect(rows[1].name).toBe('POP VEGASUS');
    expect(rows[3].name).toBe('budi_rismawan');
  });

  it('status CTC tidak dipakai sebagai status link', () => {
    const rows = parseOnuTable(TABLE);
    const down = rows.find((row) => row.onuId === '3');
    expect(down?.online).toBe(false);
    // CtcNegFail hanya berarti negosiasi CTC belum selesai.
    expect(down?.omccState).toBe('disable');
  });

  it('ctcStatus menjelaskan sebab offline (power off / LOS / auth gagal)', () => {
    const raw = [
      '0/1:5  aa:bb:cc:dd:ee:01 Up   101 9127 1 3 1 CtcNegDone    30 Yes 1H0M0S Nama_Online',
      '0/1:6  aa:bb:cc:dd:ee:02 Down 101 9127 1 3 1 MpcpDiscovery 30 Yes 0H0M0S Nama_PowerOff',
      '0/1:7  aa:bb:cc:dd:ee:03 Down 101 9127 1 3 1 --            30 Yes 0H0M0S Nama_FiberLos',
      '0/1:8  aa:bb:cc:dd:ee:04 Down 101 9127 1 3 1 CtcInfo       30 Yes 0H0M0S Nama_AuthFailed',
    ].join('\n');
    const rows = parseOnuTable(raw);
    const byId = new Map(rows.map((row) => [row.onuId, row.connectionState]));
    expect(byId.get('5')).toBe('ONLINE');
    expect(byId.get('6')).toBe('ONU_POWER_OFF');
    expect(byId.get('7')).toBe('FIBER_LOS');
    expect(byId.get('8')).toBe('ONU_AUTH_FAILED');
  });

  it('header, garis pemisah, dan prompt tidak dianggap ONU', () => {
    const rows = parseOnuTable(TABLE);
    expect(rows.map((row) => row.onuId)).toEqual(['1', '2', '3', '4']);
  });

  it('keluaran kosong / galat menghasilkan daftar kosong', () => {
    expect(parseOnuTable('')).toEqual([]);
    expect(parseOnuTable('% Invalid parameter')).toEqual([]);
  });
});

describe('parser HiFocus — show onu optical-ddm', () => {
  it('membaca Rx, Tx, suhu, tegangan, dan bias', () => {
    expect(parseOptical(OPTICAL)).toEqual({
      rxPowerOnu: -12.24,
      rxPowerOlt: null,
      txPower: 2.4,
      temperature: 53,
      voltage: 3,
      txBias: 17,
    });
  });

  it('blok tanpa angka tidak menghasilkan nilai palsu', () => {
    const result = parseOptical('RxPower      : --\nTemperature  : --');
    expect(result?.rxPowerOnu ?? null).toBeNull();
  });

  it('keluaran kosong menghasilkan null, bukan objek berisi nol', () => {
    expect(parseOptical('OLT_BIBITNET#')).toBeNull();
  });
});

describe('parser HiFocus — show system', () => {
  it('mengambil nama dan versi perangkat', () => {
    expect(parseSystem(SYSTEM)).toEqual({ identity: 'OLT_BIBITNET', version: 'V2.2.67' });
  });
});

describe('parser HiFocus — show onu info (detail) ctc_autoneg', () => {
  it('memetakan ctc_autoneg ke penyebab offline (format asli memakai spasi)', () => {
    expect(parseOnuInfoCtc('Ctc autoneg      : CtcNegDone')).toBe('ONLINE');
    expect(parseOnuInfoCtc('Ctc autoneg      : MpcpDiscovery')).toBe('ONU_POWER_OFF');
    expect(parseOnuInfoCtc('Ctc autoneg      : --')).toBe('FIBER_LOS');
    expect(parseOnuInfoCtc('Ctc autoneg      : CtcInfo')).toBe('ONU_AUTH_FAILED');
  });

  it('tetap membaca bentuk underscore (firmware lain)', () => {
    expect(parseOnuInfoCtc('ctc_autoneg : MpcpDiscovery')).toBe('ONU_POWER_OFF');
  });

  it('tanpa baris ctc autoneg -> null', () => {
    expect(parseOnuInfoCtc('Onu Id : 0/3:12\nOnline status : Down')).toBeNull();
  });
});