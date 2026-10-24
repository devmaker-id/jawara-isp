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
import { CreatePackageDto, UpdatePackageDto } from './dto/package.dto';
import { PackagesService } from './packages.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

// Katalog paket boleh dibaca semua role terautentikasi (dibutuhkan untuk
// menawarkan layanan). Perubahan harga/paket adalah keputusan komersial →
// admin saja.
const packageValidation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

@Controller('packages')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(packageValidation)
export class PackagesController {
  constructor(private packagesService: PackagesService) {}

  @Get()
  findAll() {
    return this.packagesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.packagesService.findOne(id);
  }

  @Post()
  @Roles('admin')
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createDto: CreatePackageDto) {
    return this.packagesService.create(createDto);
  }

  @Patch(':id')
  @Roles('admin')
  update(@Param('id', ParseIntPipe) id: number, @Body() updateDto: UpdatePackageDto) {
    return this.packagesService.update(id, updateDto);
  }

  @Delete(':id')
  @Roles('admin')
  remove(@Param('id', ParseIntPipe) id: number) {
    return this.packagesService.remove(id);
  }
}
