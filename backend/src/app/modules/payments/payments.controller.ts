import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthenticatedRequest } from '../auth/auth.guard';
import { JwtAuthGuard } from '../auth/auth.guard';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RequestScope, Scope } from '../auth/request-scope';
import {
  CreatePaymentBodyDto,
  CreatePaymentDto,
  ListPaymentsQueryDto,
  PayableInvoicesQueryDto,
  VoidPaymentDto,
} from './dto/payment.dto';
import { PaymentActor } from './payments.repository';
import { PaymentsService } from './payments.service';

const paymentValidation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

function actorOf(req: AuthenticatedRequest): PaymentActor {
  const account = req.account;
  if (!account) {
    // Guard selalu mengisi account; ini hanya jaring pengaman agar void tidak
    // pernah tercatat tanpa pelaku.
    throw new Error('Pelaku tidak teridentifikasi');
  }
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    ip: req.ip ?? req.socket?.remoteAddress ?? 'tidak-diketahui',
  };
}

// Riwayat pembayaran bersifat append-only: tidak ada endpoint DELETE.
// Koreksi dilakukan lewat void (khusus admin, alasan wajib).
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(paymentValidation)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get('payments')
  @Roles('admin', 'operator', 'resseler')
  list(@Query() query: ListPaymentsQueryDto, @Scope() scope: RequestScope) {
    return this.paymentsService.list(query, scope);
  }

  @Get('payments/summary')
  @Roles('admin', 'operator', 'resseler')
  summary(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Scope() scope: RequestScope,
  ) {
    return this.paymentsService.summary(from, to, scope);
  }

  // Pilihan invoice untuk form pembayaran: hanya yang masih bersisa.
  @Get('payments/payable-invoices')
  @Roles('admin', 'operator', 'resseler')
  payableInvoices(@Query() query: PayableInvoicesQueryDto, @Scope() scope: RequestScope) {
    return this.paymentsService.payableInvoices(query, scope);
  }

  @Get('invoices/:id/payments')
  @Roles('admin', 'operator', 'resseler')
  findByInvoice(@Param('id', ParseIntPipe) invoiceId: number, @Scope() scope: RequestScope) {
    return this.paymentsService.listByInvoice(invoiceId, scope);
  }

  // 201 untuk baris baru, 200 bila kunci idempoten yang sama dikirim ulang
  // (klik ganda tidak boleh menagih dua kali).
  @Post('invoices/:id/payments')
  @Roles('admin', 'operator')
  async create(
    @Param('id', ParseIntPipe) invoiceId: number,
    @Body() dto: CreatePaymentDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.paymentsService.create(invoiceId, dto, actorOf(req));
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }

  @Post('payments')
  @Roles('admin', 'operator')
  async createForInvoice(
    @Body() dto: CreatePaymentBodyDto,
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.paymentsService.createFromBody(dto, actorOf(req));
    res.status(result.created ? HttpStatus.CREATED : HttpStatus.OK);
    return result;
  }

  @Post('payments/:id/void')
  @Roles('admin')
  @HttpCode(HttpStatus.OK)
  void(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoidPaymentDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.paymentsService.void(id, dto, actorOf(req));
  }
}
