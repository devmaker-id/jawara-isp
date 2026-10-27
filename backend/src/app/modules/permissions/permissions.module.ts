import { Global, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PermissionsController } from './permissions.controller';
import { PermissionsService } from './permissions.service';
import { ApprovalService } from './approval.service';
import { PermissionGuard } from './permission.guard';

/**
 * Global: setiap controller yang memakai `PermissionGuard` butuh service ini,
 * dan modulnya tersebar di seluruh aplikasi. Global menghindari import
 * berulang di ~10 modul.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [PermissionsController],
  providers: [PermissionsService, ApprovalService, PermissionGuard],
  exports: [PermissionsService, ApprovalService, PermissionGuard],
})
export class PermissionsModule {}
