import { Controller, Get, Post, Body, Patch, Param, Delete, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { Role, RoleValues } from '../../config/config.service';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/auth.guard';

@Controller('admin/users')
@UseGuards(JwtAuthGuard)
export class AdminController {
  constructor(private adminService: AdminService) {}

  @Get()
  findAll() {
    return this.adminService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.adminService.findOne(parseInt(id, 10));
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createDto: CreateUserDto) {
    return this.adminService.create(createDto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateDto: UpdateUserDto) {
    return this.adminService.update(parseInt(id, 10), updateDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.adminService.remove(parseInt(id, 10));
  }
}
