import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';

const services = [];

@Module({
  imports: [],
  controllers: [],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ServicesModule {}
