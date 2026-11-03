import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { WaGatewayController } from './wa-gateway.controller';
import { WaGatewayService } from './wa-gateway.service';
import { WaIngestService } from './wa-ingest.service';
import { WaRouterService } from './wa-router.service';
import { WaSecurityService } from './wa-security.service';
import { WaWorkerClient } from './wa-worker.client';

/**
 * WhatsApp Gateway milik Jawara-ISP.
 *
 * Worker WhatsApp (Baileys) berjalan sebagai proses sendiri; modul ini hanya
 * mengatur kebijakan, router perintah, dan riwayat pesan.
 */
@Module({
  imports: [AuthModule],
  controllers: [WaGatewayController],
  providers: [
    WaWorkerClient,
    WaSecurityService,
    WaRouterService,
    WaIngestService,
    WaGatewayService,
  ],
  exports: [WaWorkerClient, WaGatewayService, WaRouterService, WaSecurityService],
})
export class WhatsAppGatewayModule {}
