import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { PermissionGuard, RequirePermission } from './permission.guard';
import { PermissionsService, AppRole } from './permissions.service';
import { ApprovalService, ApprovalStatus } from './approval.service';
import { SetPermissionsDto } from './dto/permissions.dto';

// Semua endpoint di sini menyentuh hak akses akun, jadi admin-only. Guard
// PermissionGuard tetap dipasang supaya `user.permissions` bisa dicabut dari
// admin tertentu tanpa mengubah kode.
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard, PermissionGuard)
@Roles('admin')
export class PermissionsController {
  constructor(
    private readonly permissions: PermissionsService,
    private readonly approval: ApprovalService,
  ) {}

  @Get('permissions')
  async catalog() {
    return {
      permissions: await this.permissions.catalog(),
      role_defaults: {
        admin: [...(await this.permissions.roleDefaults('admin'))],
        operator: [...(await this.permissions.roleDefaults('operator'))],
        resseler: [...(await this.permissions.roleDefaults('resseler'))],
      },
    };
  }

  @Get('users/:id/permissions')
  async userPermissions(@Param('id', ParseIntPipe) id: number) {
    const user = await this.permissions.assignableOwners();
    const found = user.find((row) => row.id === id);
    const role = (found?.role ?? 'operator') as AppRole;
    return {
      user_id: id,
      role,
      permissions: await this.permissions.effectiveForUser(id, role),
      role_defaults: [...(await this.permissions.roleDefaults(role))],
    };
  }

  @Put('users/:id/permissions')
  @RequirePermission('user.permissions')
  async setUserPermissions(
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: SetPermissionsDto,
    @Req() req: { user?: { sub?: number; role?: string } },
  ) {
    const actorId = Number(req.user?.sub ?? 0);
    // Akun tidak boleh mengubah hak aksesnya sendiri: kalau salah centang,
    // ia bisa mengunci dirinya keluar dari halaman ini.
    if (id === actorId) {
      return {
        ok: false,
        message: 'Hak akses akun sendiri tidak bisa diubah dari akun itu. Minta admin lain.',
      };
    }
    const role = String(req.user?.role ?? '') as AppRole;
    void role;
    const targetRole = await this.permissions
      .assignableOwners()
      .then((rows) => rows.find((row) => row.id === id)?.role as AppRole | undefined);
    if (!targetRole) {
      return { ok: false, message: `Akun #${id} tidak ditemukan atau tidak aktif.` };
    }
    return this.permissions.setUserPermissions(id, targetRole, dto.codes, actorId);
  }

  @Post('users/:id/permissions/reset')
  @RequirePermission('user.permissions')
  async resetUserPermissions(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: { user?: { sub?: number } },
  ) {
    return this.permissions.resetUserPermissions(id, Number(req.user?.sub ?? 0));
  }

  // Daftar akun yang boleh menjadi PEMILIK data (dropdown admin).
  @Get('owners')
  owners() {
    return this.permissions.assignableOwners();
  }

  // ---- Antrean persetujuan hapus ------------------------------------------
  @Get('approvals')
  @Roles('admin', 'operator')
  @RequirePermission('customer.update')
  approvals(@Query('status') status?: string) {
    const value = (status ?? 'pending') as ApprovalStatus | 'all';
    return this.approval.list(value);
  }

  @Post('approvals/:id/approve')
  @Roles('admin', 'operator')
  @RequirePermission('customer.delete')
  async approve(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { note?: string },
    @Req() req: { user?: { sub?: number } },
  ) {
    return this.approval.approve(id, Number(req.user?.sub ?? 0), body?.note);
  }

  @Post('approvals/:id/reject')
  @Roles('admin', 'operator')
  @RequirePermission('customer.delete')
  async reject(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { note?: string },
    @Req() req: { user?: { sub?: number } },
  ) {
    await this.approval.reject(id, Number(req.user?.sub ?? 0), body?.note);
    return { ok: true };
  }

  @Delete('approvals/:id')
  @Roles('admin', 'operator')
  async cancel(@Param('id', ParseIntPipe) id: number) {
    await this.approval.reject(id, 0, 'dibatalkan pemohon');
    return { ok: true };
  }
}
