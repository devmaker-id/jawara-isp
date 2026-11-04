import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createSocket, Socket } from 'node:dgram';
import { parseSyslogEvent, ParsedSyslogEvent } from './syslog.parser';
import { SyslogEventHandlerService } from './syslog.events';
import { OltRepository } from '../olt.repository';

/**
 * Kolektor syslog UDP.
 *
 * Menerima paket syslog (UDP/514) dari OLT yang terdaftar, memfilter sumber
 * (hanya IP perangkat di `olt_devices`), mem-parsing ke event kanonik, lalu
 * menyimpan ke `olt_syslog_events`.
 *
 * Port 514 berada di bawah 1024 (privileged). Saat dijalankan sebagai user
 * biasa, bind akan gagal dengan EACCES — kolektor mencatat peringatan dan TIDAK
 * menurunkan aplikasi. Solusi deploy: beri CAP_NET_BIND_SERVICE pada proses,
 * atau redirect iptables 514 → port tinggi (`SYSLOG_PORT`).
 */

const DEFAULT_PORT = Number(process.env.SYSLOG_PORT) || 514;
const DEFAULT_BIND = process.env.SYSLOG_BIND || '0.0.0.0';
const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

export interface StoredSyslogEvent {
  olt_id: number | null;
  olt_name: string | null;
  source_ip: string;
  event_type: string;
  port_id: string | null;
  onu_id: string | null;
  onu_mac: string | null;
  onu_name: string | null;
  raw_log: string;
}

@Injectable()
export class SyslogCollectorService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyslogCollectorService.name);
  private socket: Socket | null = null;
  private allowedIps = new Set<string>();
  private lastRefresh = 0;
  private readonly refreshMs = 60_000;

  constructor(
    private readonly repository: OltRepository,
    private readonly events: SyslogEventHandlerService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.refreshAllowlist();
    const socket = createSocket('udp4');

    socket.on('error', (error) => {
      this.logger.warn(
        `Kolektor syslog tidak bisa bind ${DEFAULT_BIND}:${DEFAULT_PORT} — ${error.message}. ` +
          'Berikan CAP_NET_BIND_SERVICE atau arahkan ulang 514 ke port tinggi.',
      );
      socket.close();
      this.socket = null;
    });

    socket.on('message', (message, remote) => {
      void this.handle(String(message), remote.address);
    });

    socket.bind(DEFAULT_PORT, DEFAULT_BIND, () => {
      this.socket = socket;
      this.logger.log(`Kolektor syslog aktif di ${DEFAULT_BIND}:${DEFAULT_PORT}`);
    });
  }

  onModuleDestroy(): void {
    this.socket?.close();
    this.socket = null;
  }

  private async refreshAllowlist(): Promise<void> {
    if (Date.now() - this.lastRefresh < this.refreshMs) return;
    const ips = await this.repository.listDeviceIpAddresses().catch(() => [] as string[]);
    this.allowedIps = new Set(ips.filter((ip) => IPV4.test(ip)));
    this.lastRefresh = Date.now();
  }

  /** Test apakah IP sumber boleh diterima. Dipisah agar bisa diuji. */
  async isAllowed(ip: string): Promise<boolean> {
    await this.refreshAllowlist();
    return this.allowedIps.has(ip);
  }

  private async handle(raw: string, sourceIp: string): Promise<void> {
    if (!(await this.isAllowed(sourceIp))) return;
    const parsed = parseSyslogEvent(raw);
    await this.persist(parsed, raw, sourceIp);
    await this.events.onEvent(parsed, sourceIp);
  }

  private async persist(parsed: ParsedSyslogEvent, raw: string, sourceIp: string): Promise<void> {
    try {
      const device = await this.repository.findDeviceByIp(sourceIp);
      await this.repository.insertSyslogEvent({
        olt_id: device ? device.id : null,
        olt_name: parsed.oltName ?? device?.name ?? null,
        source_ip: sourceIp,
        event_type: parsed.eventType,
        port_id: parsed.portId,
        onu_id: parsed.onuId,
        onu_mac: parsed.onuMac,
        onu_name: parsed.onuName,
        raw_log: raw.slice(0, 2000),
      });
    } catch (error) {
      this.logger.warn(
        `Syslog tidak tersimpan: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}