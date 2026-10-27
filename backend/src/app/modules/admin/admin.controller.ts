import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Query,
  Req,
  Patch,
  Post,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { CreateUserDto, ListUsersQueryDto, UpdateUserDto } from './dto/user.dto';
import { AdminService } from './admin.service';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PermissionGuard, RequirePermission } from '../permissions/permission.guard';

// Manajemen akun adalah area administratif: hanya admin.
// Operator/resseler ditolak 403 oleh RolesGuard, bukan sekadar disembunyikan
// tombolnya di frontend.
// Validasi DTO kini aktif: role asing → 400, password terlalu pendek → 400.
// Aman diaktifkan karena `Role` di config.service.ts sudah diperbaiki menjadi
// objek enum yang sah.
const adminValidation = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
});

@Controller('admin/users')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@Roles('admin')
@UsePipes(adminValidation)
export class AdminController {
  constructor(private adminService: AdminService) {}

  // Tanpa `page`: array (kompatibel). Dengan `page`: { rows, total, page, limit }.
  @Get()
  findAll(@Query() query: ListUsersQueryDto) {
    return this.adminService.list({
      search: query.search,
      role: query.role,
      isActive: query.status === undefined ? undefined : query.status === 'active',
      page: query.page,
      limit: query.limit,
    });
  }

  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {
    return this.adminService.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createDto: CreateUserDto) {
    return this.adminService.create(createDto);
  }

  @Patch(':id')
  update(
    @Param('id', ParseIntPipe) id: number,
    @Body() updateDto: UpdateUserDto,
    @Req() req: { user?: { sub?: number } },
  ) {
    return this.adminService.update(id, updateDto, req.user?.sub);
  }

  @Delete(':id')
  remove(@Param('id', ParseIntPipe) id: number, @Req() req: { user?: { sub?: number } }) {
    return this.adminService.remove(id, req.user?.sub);
  }
}
