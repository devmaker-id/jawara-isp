import { Controller, Get, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { UseGuards } from '@nestjs/common';
import { CustomersService } from './app/modules/customers/customers.service';
import { PackagesService } from './app/modules/packages/packages.service';
import { InvoicesService } from './app/modules/invoices/invoices.service';
import { JwtAuthGuard } from './app/modules/auth/auth.guard';

@Controller()
export class AppController {
  constructor(
    private readonly customersService: CustomersService,
    private readonly packagesService: PackagesService,
    private readonly invoicesService: InvoicesService,
  ) {}

  @Get()
  root(@Req() req: Request, @Res() res: Response) {
    res.json({
      service: 'jawara-billing',
      version: '0.1.0',
      path: req.path,
      method: req.method,
    });
  }

  @Get('dashboard')
  @UseGuards(JwtAuthGuard)
  getDashboard() {
    const customers = this.customersService.findAll();
    const packages = this.packagesService.findAll();
    const invoices = this.invoicesService.findAll();

    const totalCustomers = customers.length;
    const totalInvoices = invoices.length;
    const totalRevenue = invoices.reduce((sum, inv) => sum + (inv.amount || 0), 0);
    const activePackages = packages.filter((p) => p.is_active).length;

    return {
      total_customers: totalCustomers,
      total_invoices: totalInvoices,
      total_revenue: totalRevenue,
      active_packages: activePackages,
      new_customers_this_month: customers.filter((c) => {
        const now = new Date();
        const diff = (now.getTime() - c.created_at.getTime()) / (1000 * 60 * 60 * 24);
        return diff <= 30;
      }).length,
    };
  }

  @Get('health')
  health() {
    return {
      service: 'jawara-billing',
      status: 'ok',
      version: '0.1.0',
    };
  }
}
