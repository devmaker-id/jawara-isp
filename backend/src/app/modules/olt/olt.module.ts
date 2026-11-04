import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConfigService } from '../../config/config.service';
import { WhatsAppGatewayModule } from '../whatsapp-gateway/wa-gateway.module';
import { OltController } from './olt.controller';
import { OltRepository } from './olt.repository';
import { OltService } from './olt.service';
import { SyslogCollectorService } from './syslog/syslog.collector';
import { SyslogRetentionService } from './syslog/syslog.retention';
import { SyslogEventHandlerService } from './syslog/syslog.events';

/**
 * Modul OLT.
 *
 * Pemilihan driver dilakukan di runtime (driver/registry.ts) berdasarkan kolom
 * `vendor`, jadi menambah vendor baru tidak mengubah modul ini. Impor modul
 * WhatsApp Gateway hanya untuk `WaWorkerClient` (kirim alert) — bukan fitur chat.
 */
@Module({
  imports: [AuthModule, WhatsAppGatewayModule],
  controllers: [OltController],
  providers: [
    OltService,
    OltRepository,
    ConfigService,
    SyslogCollectorService,
    SyslogRetentionService,
    SyslogEventHandlerService,
  ],
  exports: [OltService],
})
export class OltModule {}