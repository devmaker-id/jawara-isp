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
import { AssignOwnerDto, CreateCustomerDto, ListCustomersQueryDto, UpdateCustomerDto } from './dto/customer.dto';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { RequestScope, Scope } from '../auth/request-scope';

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
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(customerValidation)
export class CustomersController {
  constructor(private customersService: CustomersService) {}

  // Tanpa `page`: array (kompatibel). Dengan `page`: { rows, total, page, limit }.
  @Get()
  @Roles('admin', 'operator', 'resseler')
  findAll(@Query() query: ListCustomersQueryDto, @Scope() scope: RequestScope) {
    return this.customersService.list(
      {
        search: query.search,
        status: query.status,
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

  @Get(':id')
  @Roles('admin', 'operator', 'resseler')
  findOne(@Param('id', ParseIntPipe) id: number, @Scope() scope: RequestScope) {
    return this.customersService.findOne(id, scope);
  }

  @Post()
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createDto: CreateCustomerDto) {
    return this.customersService.create(createDto);
  }

  @Patch(':id')
  @Roles('admin', 'operator')
  update(@Param('id', ParseIntPipe) id: number, @Body() updateDto: UpdateCustomerDto) {
    return this.customersService.update(id, updateDto);
  }

  // Penghapusan pelanggan ikut menghapus tagihan & sesi layanan (FK cascade)
  // → admin saja.
  @Delete(':id')
  @Roles('admin')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.customersService.remove(id);
  }
}
