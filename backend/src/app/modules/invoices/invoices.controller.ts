import { Controller, Get, Post, Body, Patch, Param, Delete, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { CreateInvoiceDto, UpdateInvoiceDto, PayInvoiceDto } from './dto/invoice.dto';
import { InvoicesService } from './invoices.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private invoicesService: InvoicesService) {}

  @Get()
  findAll() {
    return this.invoicesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.invoicesService.findOne(parseInt(id, 10));
  }

  @Get('summary')
  getSummary() {
    return this.invoicesService.getSummary();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createDto: CreateInvoiceDto) {
    return this.invoicesService.create(createDto);
  }

  @Post(':id/pay')
  @HttpCode(HttpStatus.OK)
  pay(@Param('id') id: string, @Body() payDto: PayInvoiceDto) {
    return this.invoicesService.pay(parseInt(id, 10), payDto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateInvoiceDto) {
    return this.invoicesService.update(parseInt(id, 10), updateDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.invoicesService.remove(parseInt(id, 10));
  }
}
