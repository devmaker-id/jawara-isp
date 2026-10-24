import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { ConfigService } from './app/config/config.service';
import { AuthModule } from './app/modules/auth/auth.module';
import { CustomersModule } from './app/modules/customers/customers.module';
import { PackagesModule } from './app/modules/packages/packages.module';
import { InvoicesModule } from './app/modules/invoices/invoices.module';
import { AdminModule } from './app/modules/admin/admin.module';
import { ServicesModule } from './app/services/services.module';
import { DatabaseModule } from './app/database/database.module';
import { UsersModule } from './app/modules/users/users.module';

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
    AdminModule,
    ServicesModule,
  ],
  controllers: [AppController],
  providers: [AppService, ConfigService],
})
export class AppModule {}
