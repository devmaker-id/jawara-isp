import { describe, expect, it } from 'vitest';
import {
  hisfocusApplyCommands,
  parseHisfocusRunningConfig,
} from '../src/app/modules/olt/syslog/hisfocus.syslog';
import {
  DEFAULT_VSOL_EVENT_SPECS,
  vsolApplyCommands,
  parseVsolLogging,
  parseVsolRemoteIp,
  parseVsolEvents,
} from '../src/app/modules/olt/syslog/vsol.syslog';
import { parseSyslogEvent } from '../src/app/modules/olt/syslog/syslog.parser';
import { normalizeRetentionPolicy } from '../src/app/modules/olt/syslog/syslog.retention';

describe('driver syslog — HiFocus (EPON)', () => {
  it('enable → syslog server <ip> + write', () => {
    const cmds = hisfocusApplyCommands({ enabled: true, collectorIp: '192.168.76.254' });
    expect(cmds).toEqual(['configure terminal', 'syslog server 192.168.76.254', 'write']);
  });

  it('disable → syslog server 0.0.0.0 + write', () => {
    const cmds = hisfocusApplyCommands({ enabled: false, collectorIp: '192.168.76.254' });
    expect(cmds[1]).toBe('syslog server 0.0.0.0');
  });

  it('parse running-config mencari syslog server', () => {
    const out = '! Syslog configuration\nsyslog server 192.168.76.254\nhostname OLT_BIBITNET';
    expect(parseHisfocusRunningConfig(out)).toEqual({ enabled: true, collectorIp: '192.168.76.254' });
  });

  it('parse 0.0.0.0 = disabled', () => {
    expect(parseHisfocusRunningConfig('syslog server 0.0.0.0')).toEqual({
      enabled: false,
      collectorIp: '0.0.0.0',
    });
  });

  it('tanpa baris syslog = disabled/null', () => {
    expect(parseHisfocusRunningConfig('hostname OLT_BIBITNET')).toEqual({
      enabled: false,
      collectorIp: null,
    });
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

  it('VSOL ONU_REGISTER', () => {
    const raw = 'ONU_REGISTER PON 0/1 ONU 5 sn ZTEGcc4382c5';
    expect(parseSyslogEvent(raw).eventType).toBe('ONU_REGISTER');
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