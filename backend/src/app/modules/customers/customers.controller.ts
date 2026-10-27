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
  Query,
  Req,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  AssignOwnerDto,
  CreateCustomerDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
  UpdateCustomerStatusDto,
} from './dto/customer.dto';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RequestScope, Scope } from '../auth/request-scope';
import { PermissionGuard, RequirePermission } from '../permissions/permission.guard';

// ValidationPipe di-scope ke controller ini saja supaya modul lain
// (packages/invoices/admin) tidak berubah perilaku sebelum tahapnya.
const customerValidation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

// Akses reseller hanya pada endpoint BACA yang sudah difilter di SQL memakai
// identitas dari token (bukan reseller_id dari request). Mutasi (create/
// update/delete/owner) tetap admin/operator sesuai keputusan bisnis.
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@UsePipes(customerValidation)
export class CustomersController {
  constructor(private customersService: CustomersService) {}

  // Tanpa `page`: array (kompatibel). Dengan `page`: { rows, total, page, limit }.
  @Get()
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('customer.view')
  findAll(@Query() query: ListCustomersQueryDto, @Scope() scope: RequestScope) {
    return this.customersService.list(
      {
        search: query.search,
        status: query.status,
        state: query.state,
        profile: query.profile,
        page: query.page,
        limit: query.limit,
      },
      scope,
    );
  }

  // Status kemampuan fitur kepemilikan reseller. Diletakkan sebelum ':id'
  // agar tidak tertangkap sebagai ID.
  @Get('meta')
  @Roles('admin', 'operator', 'resseler')
  meta() {
    return this.customersService.ownerCapability();
  }

  // Penetapan/pemindahan pemilik pelanggan: admin saja. Identitas aktor
  // diambil dari token yang sudah diverifikasi, bukan dari body.
  @Patch(':id/owner')
  @Roles('admin')
  @RequirePermission('customer.assign_owner')
  assignOwner(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignOwnerDto,
    @Req() req: { user?: { sub?: number }; ip?: string },
  ) {
    return this.customersService.assignOwner(id, dto, {
      userId: Number(req.user?.sub ?? 0),
      ip: req.ip ?? 'tidak diketahui',
    });
  }

  // Akun RADIUS pelanggan: username, profil, status, dan online dari radacct.
  @Get(':id/accounts')
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('customer.view')
  accounts(@Param('id', ParseIntPipe) id: number, @Scope() scope: RequestScope) {
    return this.customersService.accounts(id, scope);
  }

  @Get(':id')
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('customer.view')
  findOne(@Param('id', ParseIntPipe) id: number, @Scope() scope: RequestScope) {
    return this.customersService.findOne(id, scope);
  }

  // `created_by` pada akun RADIUS diisi dari token, bukan dari body.
  // Operator dicegah membuat pelanggan lewat izin `customer.create` (0 untuk
  // operator), bukan lewat role — supaya bisa dibuka per akun bila perlu.
  @Post()
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('customer.create')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() createDto: CreateCustomerDto,
    @Req() req: { user?: { sub?: number; role?: string }; ip?: string },
  ) {
    return this.customersService.create(createDto, {
      userId: Number(req.user?.sub ?? 0),
      role: String(req.user?.role ?? ''),
      ip: req.ip ?? 'tidak diketahui',
    });
  }

  // Status pelanggan: active / expired / suspend / disable.
  @Patch(':id/status')
  @Roles('admin', 'operator')
  @RequirePermission('customer.update')
  updateStatus(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCustomerStatusDto) {
    return this.customersService.setStatus(id, dto.status);
  }

  @Patch(':id')
  @Roles('admin', 'operator', 'resseler')
  @RequirePermission('customer.update')
  update(@Param('id', ParseIntPipe) id: number, @Body() updateDto: UpdateCustomerDto) {
    return this.customersService.update(id, updateDto);
  }

  // Penghapusan pelanggan ikut menghapus tagihan & sesi layanan (FK cascade)
  // → admin saja.
  // Satu jalur untuk dua kemungkinan: pemanggil yang punya `customer.delete`
  // menghapus langsung; yang tidak (reseller) otomatis mengajukan permintaan
  // ke antrean persetujuan. Respons membedakan keduanya.
  @Delete(':id')
  @Roles('admin', 'operator', 'resseler')
  remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: { sub?: number; role?: string }; ip?: string },
  ) {
    return this.customersService.removeOrRequest(id, {
      userId: Number(req.user?.sub ?? 0),
      role: String(req.user?.role ?? ''),
      ip: req.ip ?? 'tidak diketahui',
    });
  }
}
