import { Module } from '@nestjs/common';
import { WhatsAppGatewayModule } from '../whatsapp-gateway/wa-gateway.module';
import { WhatsAppService } from './whatsapp.service';

// Pengiriman memakai WhatsApp Gateway (worker Baileys), bukan lagi pengaturan
// provider di halaman Pengaturan.
@Module({
  imports: [WhatsAppGatewayModule],
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
