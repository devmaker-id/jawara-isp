import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { DatabaseModule } from '../../database/database.module';
import { AuthModule } from '../auth/auth.module';
import { ToolsController } from './tools.controller';
import { ToolsService } from './tools.service';

@Module({
  imports: [DatabaseModule, AuthModule, JwtModule],
  controllers: [ToolsController],
  providers: [ToolsService],
})
export class ToolsModule {}
