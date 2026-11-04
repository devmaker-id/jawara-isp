import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ConfigService } from '../../config/config.service';
import { OltController } from './olt.controller';
import { OltRepository } from './olt.repository';
import { OltService } from './olt.service';
import { SyslogCollectorService } from './syslog/syslog.collector';
import { SyslogRetentionService } from './syslog/syslog.retention';

/**
 * Modul OLT.
 *
 * Pemilihan driver dilakukan di runtime (driver/registry.ts) berdasarkan kolom
 * `vendor`, jadi menambah vendor baru tidak mengubah modul ini.
 */
@Module({
  imports: [AuthModule],
  controllers: [OltController],
  providers: [OltService, OltRepository, ConfigService, SyslogCollectorService, SyslogRetentionService],
  exports: [OltService],
})
export class OltModule {}