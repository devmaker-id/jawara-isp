import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CreateInvoiceDto, ListInvoicesQueryDto, UpdateInvoiceDto, PayInvoiceDto, VoidInvoiceDto } from './dto/invoice.dto';
import { InvoicesService } from './invoices.service';
import { AuthenticatedRequest, JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RequestScope, Scope } from '../auth/request-scope';
import { PaymentsService } from '../payments/payments.service';
import { PaymentActor } from '../payments/payments.repository';
import { InvoiceActor } from './invoices.repository';

// Pelaku dari token (bukan body). Dipakai untuk audit finance_events: id/nama/
// email dari akun yang login, IP mengikuti pola PaymentsService.
function actorOf(req: AuthenticatedRequest): InvoiceActor {
  const account = req.account;
  if (!account) {
    throw new UnauthorizedException('Pelaku perubahan tagihan tidak teridentifikasi');
  }
  return {
    id: account.id,
    email: account.email,
    name: account.name,
    ip: req.ip ?? req.socket?.remoteAddress ?? 'tidak-diketahui',
  };
}

// Tagihan berisi data finansial seluruh pelanggan. Resseler belum punya
// relasi kepemilikan, jadi tidak diberi akses. Penghapusan tagihan
// (menghapus riwayat pembayaran) dibatasi ke admin.
const invoiceValidation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

@Controller('invoices')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(invoiceValidation)
export class InvoicesController {
  constructor(
    private invoicesService: InvoicesService,
    private paymentsService: PaymentsService,
  ) {}

  // Tanpa `page`: array (kompatibel). Dengan `page`: { rows, total, page, limit }.
  @Get()
  @Roles('admin', 'operator', 'resseler')
  findAll(@Query() query: ListInvoicesQueryDto, @Scope() scope: RequestScope) {
    return this.invoicesService.list(
      {
        search: query.search,
        status: query.status,
        page: query.page,
        limit: query.limit,
      },
      scope,
    );
  }

  @Get('summary')
  @Roles('admin', 'operator', 'resseler')
  getSummary(@Scope() scope: RequestScope) {
    return this.invoicesService.getSummary(scope);
  }

  @Get(':id')
  @Roles('admin', 'operator', 'resseler')
  findOne(@Param('id', ParseIntPipe) id: number, @Scope() scope: RequestScope) {
    return this.invoicesService.findOne(id, scope);
  }

  @Post()
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createDto: CreateInvoiceDto, @Req() req: AuthenticatedRequest) {
    return this.invoicesService.create(createDto, actorOf(req));
  }

  // Jalur lama dipertahankan demi kompatibilitas UI/klien, tetapi TIDAK lagi
  // menulis sendiri: semua uang lewat PaymentsService (ledger + status).
  @Post(':id/pay')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  async pay(
    @Param('id', ParseIntPipe) id: number,
    @Body() payDto: PayInvoiceDto,
    @Req() req: AuthenticatedRequest,
  ) {
    const account = req.account;
    if (!account) {
      throw new UnauthorizedException('Pelaku pembayaran tidak teridentifikasi');
    }
    const actor: PaymentActor = {
      id: account.id,
      email: account.email,
      name: account.name,
      ip: req.ip ?? req.socket?.remoteAddress ?? 'tidak-diketahui',
    };
    await this.paymentsService.create(id, { amount: payDto.amount, paid_at: payDto.paid_date }, actor);
    return this.invoicesService.findOne(id);
  }

  @Patch(':id')
  @Roles('admin', 'operator')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateInvoiceDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.invoicesService.update(id, updateDto, actorOf(req));
  }

  // Pembatalan resmi. Alasan wajib (validasi DTO) dan tercatat di finance_events.
  @Post(':id/void')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  void(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: VoidInvoiceDto,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.invoicesService.void(id, dto.reason, actorOf(req));
  }

  // Riwayat aktivitas keuangan tagihan (finance_events): waktu, aktor,
  // tindakan, nilai sebelum/sesudah, dan alasan.
  @Get(':id/events')
  @Roles('admin', 'operator', 'resseler')
  events(@Param('id', ParseIntPipe) id: number, @Scope() scope: RequestScope) {
    return this.invoicesService.events(id, scope);
  }

  // Hapus permanen tagihan + seluruh pembayarannya (admin). Jejak tetap ada di
  // audit_logs; gunakan POST :id/void untuk pembatalan yang menyisakan riwayat.
  @Delete(':id')
  @Roles('admin')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: AuthenticatedRequest) {
    return this.invoicesService.remove(id, actorOf(req));
  }
}
