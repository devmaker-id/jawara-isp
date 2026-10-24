import { Global, Module } from '@nestjs/common';
import { UsersRepository } from './users.repository';

// Global agar AuthModule dan AdminModule dapat berbagi SATU instance
// repository tanpa perlu saling meng-import modul satu sama lain.
// Belum ada yang meng-inject repository ini pada Tahap 4.2.
@Global()
@Module({
  providers: [UsersRepository],
  exports: [UsersRepository],
})
export class UsersModule {}
