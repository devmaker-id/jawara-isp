import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '../config/config.service';

export interface MikrotikIdentity {
  name: string;
  version: string;
  capabilities: string[];
}

export interface MikrotikConfig {
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface RouterOsRecord {
  [key: string]: string | undefined;
}

/**
 * RouterOS API over WebSocket (port 1998).
 * Format tiap pesan:
 *   !f<nomor_frame>\r\n<json_body>\r\n!done\r\n
 */

const isWebSocketAvailable = (): boolean =>
  typeof globalThis.WebSocket === 'function';

function buildMessage(jsonBody: string, frame = 0): string {
  return `!f${frame}\r\n${jsonBody}\r\n!done\r\n`;
}

/** Parsing respons JSON dari RouterOS API */
function parseRouterOsResponse(raw: string): RouterOsRecord[] {
  const records: RouterOsRecord[] = [];
  const lines = raw.split(/\r?\n/);
  let jsonBuffer: string[] = [];
  let expectingJson = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('!f')) {
      expectingJson = true;
      jsonBuffer = [];
      continue;
    }

    if (trimmed === '!done') {
      if (expectingJson && jsonBuffer.length > 0) {
        const json = jsonBuffer.join('\n').trim();
        try {
          const parsed = JSON.parse(json);
          if (Array.isArray(parsed)) {
            records.push(...parsed);
          } else {
            records.push(parsed as RouterOsRecord);
          }
        } catch (err) {
          // isi bukan JSON (mis. log), lanjut
        }
      }
      expectingJson = false;
      continue;
    }

    if (expectingJson) {
      jsonBuffer.push(line);
    }
  }

  return records;
}

@Injectable()
export class MikrotikService implements OnModuleInit {
  private readonly logger = new Logger(MikrotikService.name);
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private isConnecting = false;
  private isConnected = false;

  constructor(private configService: ConfigService) {
    const sync = this.configService.mikrotik;
    this.logger.log(
      `MikroTik configured (env fallback): host=${sync.host}:${sync.port}`,
    );
  }

  async onModuleInit() {
    try {
      const config = await this.configService.getMikrotikConfig();
      this.logger.log(
        `MikroTik configured from DB: host=${config.host}:${config.port}, user=${config.user}`,
      );
      await this.connect(config);
    } catch (error) {
      const msg =
        error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `MikroTik config from DB failed (${msg}). Retrying...`,
      );
      await this.connectFallback();
    }
  }

  /**
   * CS: goto fallback env kalau DB belum siap / tak reachable.
   */
  private async connectFallback() {
    const cfg = this.configService.mikrotik;
    if (!cfg.host) return;
    await this.connect(cfg);
  }

  private async connect(config: MikrotikConfig) {
    if (this.isConnecting) return;
    this.isConnecting = true;

    // Pastikan koneksi fresh
    if (this.ws) {
      this.ws.close();
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => resolve(), 500);
        this.ws?.addEventListener('close', () => clearTimeout(t));
      });
    }

    return new Promise<void>((resolve, reject) => {
      const ws = new globalThis.WebSocket(
        `ws://${config.host}:${config.port}`,
      );

      const onOpen = () => {
        this.logger.log(
          `MikroTik API connected: ${config.host}:${config.port}`,
        );
        this.ws = ws;
        this.isConnected = true;
        this.login(config)
          .then(() => {
            this.isConnecting = false;
            resolve();
          })
          .catch((err) => {
            this.isConnecting = false;
            this.logger.warn(
              `MikroTik login failed: ${err instanceof Error ? err.message : String(err)}`,
            );
            reject(err);
          });
      };

      const onMessage = (data: any) => {
        const text = typeof data.data === 'string'
          ? data.data
          : Buffer.from(data.data as Buffer).toString('utf8');
        this.handleMessage(text);
      };

      const onError = (error: any) => {
        this.isConnecting = false;
        this.logger.error(`MikroTik WebSocket error: ${error.message}`);
        reject(error);
      };

      const onClose = () => {
        this.isConnected = false;
        this.ws = null;
        // Auto-reconnect kalau belum sengaja (tidak dari login)
        if (!this.isConnecting) {
          this.reconnectTimer = setTimeout(() => {
            this.connectFallback().then(resolve).catch(reject);
          }, 3000);
        }
      };

      ws.addEventListener('open', onOpen);
      ws.addEventListener('message', onMessage);
      ws.addEventListener('error', onError);
      ws.addEventListener('close', onClose);

      // Cleanup handler bound ke `ws`
      const cleanup = () => {
        ws.removeEventListener('close', cleanup);
        this.isConnecting = false;
      };
      ws.addEventListener('close', cleanup);
    });
  }

  private async login(config: MikrotikConfig) {
    if (!config.user) {
      throw new Error('MikroTik user belum diisi');
    }
    if (config.password) {
      const loginResp = await this.sendCommand(
        JSON.stringify({
          command: '/login',
          params: { name: config.user, password: config.password },
        }),
      );
      const session = loginResp.find(
        (r: RouterOsRecord) => r['.ret'] != null,
      );
      if (session && session['.ret']) {
        this.sessionId = String(session['.ret']);
        return;
      }
    }
    throw new Error('Gagal mendapatkan session ID dari Mikrotik');
  }

  /**
   * Kirim perintah ke RouterOS.
   * @param command JSON body command (tanpa !f framing)
   */
  async sendCommand(command: string): Promise<RouterOsRecord[]> {
    if (!this.ws || this.ws.readyState !== 1 /* OPEN */) {
      throw new Error('MikroTik API tidak terhubung');
    }
    const ws = this.ws; // captured non-null after check
    return new Promise((resolve, reject) => {
      const id = Date.now();
      const payload = buildMessage(command, id);
      ws.send(payload);

      const timeout = setTimeout(() => {
        reject(
          new Error(
            `Timeout setelah ${5000}ms pada command: ${command.slice(0, 40)}`,
          ),
        );
      }, 5000);

      const onMessage = (data: any) => {
        const text = typeof data.data === 'string'
          ? data.data
          : Buffer.from(data.data as Buffer).toString('utf8');
        const records = parseRouterOsResponse(text);
        if (records.length > 0) {
          clearTimeout(timeout);
          ws.removeEventListener('message', onMessage);
          resolve(records);
        }
      };

      const onError = (error: any) => {
        clearTimeout(timeout);
        ws.removeEventListener('message', onMessage);
        reject(error);
      };

      ws.addEventListener('message', onMessage);
      ws.addEventListener('error', onError);
    });
  }

  private handleMessage(raw: string) {
    // Kalau ini login response, update sessionId
    const records = parseRouterOsResponse(raw);
    for (const rec of records) {
      if (rec['.ret'] != null && !this.sessionId) {
        this.sessionId = String(rec['.ret']);
      }
      // .ret di luar login biasanya adalah error
      if (rec['.ret'] !== undefined && rec['.ret'] !== '0') {
        this.logger.warn(
          `MikroTik response .ret != 0: ${JSON.stringify(rec)}`,
        );
      }
    }
  }

  // ===== API publik =====

  async getNeighbors(): Promise<RouterOsRecord[]> {
    try {
      if (!this.sessionId) return [];
      const result = await this.sendCommand(
        JSON.stringify({ command: '/routing/neighbor/print' }),
      );
      return result;
    } catch (error) {
      this.logger.warn(
        `getNeighbors gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  async getInterfaces(): Promise<RouterOsRecord[]> {
    try {
      if (!this.sessionId) return [];
      const result = await this.sendCommand(
        JSON.stringify({ command: '/interface/print' }),
      );
      return result;
    } catch (error) {
      this.logger.warn(
        `getInterfaces gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  async getRouteTable(): Promise<RouterOsRecord[]> {
    try {
      if (!this.sessionId) return [];
      const result = await this.sendCommand(
        JSON.stringify({ command: '/ip/route/print' }),
      );
      return result;
    } catch (error) {
      this.logger.warn(
        `getRouteTable gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  async getVlans(): Promise<RouterOsRecord[]> {
    try {
      if (!this.sessionId) return [];
      const result = await this.sendCommand(
        JSON.stringify({ command: '/vlan/print' }),
      );
      return result;
    } catch (error) {
      this.logger.warn(
        `getVlans gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  async getPools(): Promise<RouterOsRecord[]> {
    try {
      if (!this.sessionId) return [];
      const result = await this.sendCommand(
        JSON.stringify({ command: '/ip/pool/print' }),
      );
      return result;
    } catch (error) {
      this.logger.warn(
        `getPools gagal: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  }

  disconnect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }
}
