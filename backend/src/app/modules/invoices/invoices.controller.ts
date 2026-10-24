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
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CreateInvoiceDto, UpdateInvoiceDto, PayInvoiceDto } from './dto/invoice.dto';
import { InvoicesService } from './invoices.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

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
  constructor(private invoicesService: InvoicesService) {}

  @Get()
  @Roles('admin', 'operator')
  findAll() {
    return this.invoicesService.findAll();
  }

  @Get('summary')
  @Roles('admin', 'operator')
  getSummary() {
    return this.invoicesService.getSummary();
  }

  @Get(':id')
  @Roles('admin', 'operator')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.invoicesService.findOne(id);
  }

  @Post()
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createDto: CreateInvoiceDto) {
    return this.invoicesService.create(createDto);
  }

  @Post(':id/pay')
  @Roles('admin', 'operator')
  @HttpCode(HttpStatus.OK)
  pay(@Param('id', ParseIntPipe) id: number, @Body() payDto: PayInvoiceDto) {
    return this.invoicesService.pay(id, payDto);
  }

  @Patch(':id')
  @Roles('admin', 'operator')
  update(@Param('id', ParseIntPipe) id: number, @Body() updateDto: UpdateInvoiceDto) {
    return this.invoicesService.update(id, updateDto);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.invoicesService.remove(id);
  }
}
