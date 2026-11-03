import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthModule } from '../auth/auth.module';
import {
  CustomerReceivableController,
  ReceivableReportController,
} from './receivables.controller';
import { ReceivablesRepository } from './receivables.repository';
import { ReceivablesService } from './receivables.service';

@Module({
  imports: [AuthModule, JwtModule],
  controllers: [CustomerReceivableController, ReceivableReportController],
  providers: [ReceivablesService, ReceivablesRepository],
  exports: [ReceivablesService, ReceivablesRepository],
})
export class ReceivablesModule {}