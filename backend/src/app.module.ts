import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigService } from './app/config/config.service';
import { AuthModule } from './app/modules/auth/auth.module';
import { CustomersModule } from './app/modules/customers/customers.module';
import { PackagesModule } from './app/modules/packages/packages.module';
import { InvoicesModule } from './app/modules/invoices/invoices.module';
import { PaymentsModule } from './app/modules/payments/payments.module';
import { SettingsModule } from './app/modules/settings/settings.module';
import { ReportsModule } from './app/modules/reports/reports.module';
import { ExportsModule } from './app/modules/exports/exports.module';
import { AdminModule } from './app/modules/admin/admin.module';
import { ServicesModule } from './app/services/services.module';
import { DatabaseModule } from './app/database/database.module';
import { UsersModule } from './app/modules/users/users.module';
import { MikrotikModule } from './app/modules/mikrotik/mikrotik.module';
import { RadiusModule } from './app/modules/freeradius/radius.module';
import { ProfilesModule } from './app/modules/profiles/profiles.module';
import { DashboardModule } from './app/modules/dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    DatabaseModule,
    UsersModule,
    AuthModule,
    CustomersModule,
    PackagesModule,
    InvoicesModule,
    PaymentsModule,
    SettingsModule,
    ReportsModule,
    ExportsModule,
    AdminModule,
    ServicesModule,
    MikrotikModule,
    RadiusModule,
    ProfilesModule,
    DashboardModule,
  ],
  controllers: [AppController],
  providers: [AppService, ConfigService],
})
export class AppModule {}
