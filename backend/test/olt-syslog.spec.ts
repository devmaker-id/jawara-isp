import { describe, expect, it } from 'vitest';
import { parseLogServerIp } from '../src/app/modules/olt/syslog/hisfocus.syslog';
import {
  DEFAULT_VSOL_EVENT_SPECS,
  vsolApplyCommands,
  parseVsolLogging,
  parseVsolRemoteIp,
  parseVsolEvents,
} from '../src/app/modules/olt/syslog/vsol.syslog';
import { parseSyslogEvent } from '../src/app/modules/olt/syslog/syslog.parser';
import { normalizeRetentionPolicy } from '../src/app/modules/olt/syslog/syslog.retention';
import { normalizeHandlerConfig } from '../src/app/modules/olt/syslog/syslog.events';

describe('driver syslog — HiFocus (web GUI)', () => {
  it('parse IP dari logServer.asp', () => {
    expect(parseLogServerIp('var syslogInfo=new Array("10.200.10.10");')).toBe('10.200.10.10');
  });

  it('parse 0.0.0.0 (disabled)', () => {
    expect(parseLogServerIp('var syslogInfo=new Array("0.0.0.0");')).toBe('0.0.0.0');
  });

  it('tanpa syslogInfo = null', () => {
    expect(parseLogServerIp('var x = 1;')).toBeNull();
  });
});

describe('driver syslog — VSOL/GPON', () => {
  it('enable → configure, syslog server ip, event/alarm remote enable, save', () => {
    const cmds = vsolApplyCommands({ enabled: true, collectorIp: '172.10.0.20' });
    expect(cmds[0]).toBe('configure');
    expect(cmds[1]).toBe('syslog server ip 172.10.0.20 port 514');
    expect(cmds).toContain('event onu-register remote enable');
    expect(cmds).toContain('alarm onu-dying-gasp remote enable');
    expect(cmds[cmds.length - 1]).toBe('save');
  });

  it('disable → syslog server ip 0.0.0.0 + event/alarm remote disable', () => {
    const cmds = vsolApplyCommands({ enabled: false, collectorIp: '172.10.0.20' });
    expect(cmds[1]).toBe('syslog server ip 0.0.0.0 port 514');
    expect(cmds).toContain('event onu-register remote disable');
  });

  it('event custom menimpa bawaan', () => {
    const cmds = vsolApplyCommands({
      enabled: true,
      collectorIp: '172.10.0.20',
      events: ['event onu-register', 'alarm onu-link-lost'],
    });
    expect(cmds).toContain('event onu-register remote enable');
    expect(cmds).toContain('alarm onu-link-lost remote enable');
    expect(cmds).not.toContain('event onu-finish remote enable');
  });

  it('default event specs tercakup semua', () => {
    expect(DEFAULT_VSOL_EVENT_SPECS).toHaveLength(8);
  });

  it('parse show logging → enabled', () => {
    const out = 'Logging configuration for gpond:\nSyslog logging: enabled\nStdout logging: disabled';
    expect(parseVsolLogging(out)).toBe(true);
  });

  it('parse show logging → disabled', () => {
    expect(parseVsolLogging('Syslog logging: disabled\nSyslog logging: disabled')).toBe(false);
  });

  it('parse remote ip dari running-config', () => {
    expect(parseVsolRemoteIp('hostname OLT-MUNCANG\nsyslog server ip 172.10.0.20 port 514\n')).toBe('172.10.0.20');
  });

  it('parse daftar event remote enable', () => {
    const out = 'event onu-register remote enable\nalarm onu-deregister remote enable\nevent onu-register remote disable';
    expect(parseVsolEvents(out)).toEqual(['event onu-register', 'alarm onu-deregister']);
  });
});

describe('parser syslog → event kanonik', () => {
  it('HiFocus ONU linkup', () => {
    const raw =
      '<30>Jun 24 01:53:09 OLT_BIBITNET: [2026-06-24 01:53:09] ONU 0/4:26 [ 1C:27:04:B0:B3:AF ] [pak_mamay] linkup';
    expect(parseSyslogEvent(raw)).toMatchObject({
      oltName: 'OLT_BIBITNET',
      eventType: 'ONU_LINKUP',
      portId: '0/4',
      onuId: '26',
      onuMac: '1C:27:04:B0:B3:AF',
      onuName: 'pak_mamay',
    });
  });

  it('HiFocus ONU linkdown', () => {
    const raw =
      '<30>Jun 24 01:52:25 OLT_BIBITNET: [2026-06-24 01:52:25] ONU 0/4:26 [ 1C:27:04:B0:B3:AF ] [pak_mamay] linkdown';
    expect(parseSyslogEvent(raw).eventType).toBe('ONU_LINKDOWN');
  });

  it('HiFocus login', () => {
    const raw = '<30>Jun 24 01:52:01 OLT_BIBITNET: User admin login from CLI 172.10.0.247';
    const event = parseSyslogEvent(raw);
    expect(event.eventType).toBe('LOGIN');
    expect(event.oltName).toBe('OLT_BIBITNET');
  });

  it('VSOL ONU Online → LINKUP + serial', () => {
    const raw = '<27>Nov  5 17:51:06 gpon-olt auditd[0]: ONU Online  PON 0/1 ONU 12 sn ZTEGcbb6bd02 .';
    expect(parseSyslogEvent(raw)).toMatchObject({
      eventType: 'ONU_LINKUP',
      portId: '0/1',
      onuId: '12',
      onuSerial: 'ZTEGcbb6bd02',
      connectionState: 'ONLINE',
    });
  });

  it('VSOL ONU Offline → LINKDOWN + OFFLINE', () => {
    const raw = '<27>Nov  5 17:51:06 gpon-olt auditd[0]: ONU Offline  PON 0/1 ONU 8 sn ZTEGcc5c3bd5 .';
    const event = parseSyslogEvent(raw);
    expect(event.eventType).toBe('ONU_LINKDOWN');
    expect(event.connectionState).toBe('OFFLINE');
  });

  it('VSOL ONU Dying Gasp → DYING_GASP + listrik padam', () => {
    const raw = '<27>Nov  5 17:51:06 gpon-olt auditd[0]: ONU Dying Gasp  PON 0/1 ONU 6 sn HWTCb3f123a0 .';
    const event = parseSyslogEvent(raw);
    expect(event.eventType).toBe('ONU_DYING_GASP');
    expect(event.connectionState).toBe('ONU_POWER_OFF');
  });

  it('VSOL ONU Port Los → LINKDOWN + listrik padam', () => {
    const raw =
      '<27>Nov  5 17:50:53 gpon-olt auditd[0]: ONU Port Los  PON 0/1 ONU 8 sn ZTEGcc5c3bd5  LAN2 LINK DOWN.';
    const event = parseSyslogEvent(raw);
    expect(event.eventType).toBe('ONU_LINKDOWN');
    expect(event.connectionState).toBe('ONU_POWER_OFF');
  });

  it('HiFocus linkdown → OFFLINE (sebab dari ctcStatus, bukan syslog)', () => {
    const raw =
      '<30>Jun 24 01:52:25 OLT_BIBITNET: [2026-06-24 01:52:25] ONU 0/4:26 [ 1C:27:04:B0:B3:AF ] [pak_mamay] linkdown';
    expect(parseSyslogEvent(raw).connectionState).toBe('OFFLINE');
  });

  it('tidak dikenal → UNKNOWN', () => {
    expect(parseSyslogEvent('something else entirely').eventType).toBe('UNKNOWN');
  });
});

describe('retensi log ONU — normalisasi kebijakan', () => {
  it('mode age membulatkan days ke rentang aman', () => {
    expect(normalizeRetentionPolicy({ mode: 'age', days: 7 })).toEqual({ mode: 'age', days: 7 });
    expect(normalizeRetentionPolicy({ mode: 'age', days: 0 })).toEqual({ mode: 'age', days: 1 });
    expect(normalizeRetentionPolicy({ mode: 'age', days: 999 })).toEqual({ mode: 'age', days: 365 });
  });

  it('mode per_olt mempertahankan count sebagai batas', () => {
    expect(normalizeRetentionPolicy({ mode: 'per_olt', count: 500 })).toEqual({ mode: 'per_olt', count: 500 });
    expect(normalizeRetentionPolicy({ mode: 'per_olt', count: 0 })).toEqual({ mode: 'per_olt', count: 1 });
  });

  it('mode tidak dikenal jatuh ke age/day default', () => {
    expect(normalizeRetentionPolicy({ mode: 'age' } as never)).toEqual({ mode: 'age', days: 30 });
  });
});

describe('handler event ONU — normalisasi konfigurasi', () => {
  it('menyaring alert_events hanya ke jenis yang dikenal', () => {
    const config = normalizeHandlerConfig({
      inventory_sync: true,
      whatsapp_alert: true,
      routes: [{ olt_id: 1, whatsapp_group: '123@g.us' }],
      alert_events: ['ONU_LINKDOWN', 'ONU_DYING_GASP', 'HALO'],
    });
    expect(config.inventory_sync).toBe(true);
    expect(config.routes).toEqual([{ olt_id: 1, whatsapp_group: '123@g.us' }]);
    expect(config.alert_events).toEqual(['ONU_LINKDOWN', 'ONU_DYING_GASP']);
  });

  it('default menonaktifkan semua fitur', () => {
    const config = normalizeHandlerConfig({});
    expect(config.inventory_sync).toBe(false);
    expect(config.whatsapp_alert).toBe(false);
    expect(config.routes).toEqual([]);
  });

  it('menyaring rute yang tidak valid', () => {
    const config = normalizeHandlerConfig({
      routes: [
        { olt_id: 3, whatsapp_group: '456@g.us' },
        { olt_id: 'x' as never, whatsapp_group: '789@g.us' },
        { olt_id: 2, whatsapp_group: '' },
      ],
    });
    expect(config.routes).toEqual([{ olt_id: 3, whatsapp_group: '456@g.us' }]);
  });

  it('membatasi spacing_seconds pada rentang 1–3600', () => {
    expect(normalizeHandlerConfig({ spacing_seconds: 0 }).spacing_seconds).toBe(1);
    expect(normalizeHandlerConfig({ spacing_seconds: 99999 }).spacing_seconds).toBe(3600);
    expect(normalizeHandlerConfig({ spacing_seconds: 120 }).spacing_seconds).toBe(120);
    expect(normalizeHandlerConfig({}).spacing_seconds).toBe(300);
  });

  it('membatasi flap_threshold pada rentang 1–100', () => {
    expect(normalizeHandlerConfig({ flap_threshold: 0 }).flap_threshold).toBe(1);
    expect(normalizeHandlerConfig({ flap_threshold: 999 }).flap_threshold).toBe(100);
    expect(normalizeHandlerConfig({ flap_threshold: 5 }).flap_threshold).toBe(5);
    expect(normalizeHandlerConfig({}).flap_threshold).toBe(3);
  });
});