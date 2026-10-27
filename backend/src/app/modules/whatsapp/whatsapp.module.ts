import { Module } from '@nestjs/common';
import { SettingsModule } from '../settings/settings.module';
import { WhatsAppService } from './whatsapp.service';

@Module({
  imports: [SettingsModule],
  providers: [WhatsAppService],
  exports: [WhatsAppService],
})
export class WhatsAppModule {}
