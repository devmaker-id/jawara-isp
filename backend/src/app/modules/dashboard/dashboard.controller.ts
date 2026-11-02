import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RequestScope, Scope } from '../auth/request-scope';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { DashboardService } from './dashboard.service';

// Dashboard menampilkan agregat seluruh pelanggan, pendapatan, dan kondisi
// server — reseller tidak berhak melihat data gabungan itu.
@Controller('dashboard')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin', 'operator')
export class DashboardController {
  constructor(private readonly dashboard: DashboardService) {}

  @Get()
  summary(@Scope() scope: RequestScope) {
    return this.dashboard.summary(scope);
  }
}
