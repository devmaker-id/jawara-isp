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
import { CreateCustomerDto, UpdateCustomerDto } from './dto/customer.dto';
import { CustomersService } from './customers.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

// ValidationPipe di-scope ke controller ini saja supaya modul lain
// (packages/invoices/admin) tidak berubah perilaku sebelum tahapnya.
const customerValidation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

// Resseler belum punya relasi kepemilikan pelanggan di skema, jadi tidak
// diberi akses ke data pelanggan sama sekali (bukan akses luas sebagai ganti).
@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(customerValidation)
export class CustomersController {
  constructor(private customersService: CustomersService) {}

  @Get()
  @Roles('admin', 'operator')
  findAll() {
    return this.customersService.findAll();
  }

  @Get(':id')
  @Roles('admin', 'operator')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.customersService.findOne(id);
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
