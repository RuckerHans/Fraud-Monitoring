import { Module } from '@nestjs/common';
import { AuthDatabaseService } from './auth-database.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthProvider } from './auth.types';
import { LocalAuthProvider } from './local-auth.provider';

@Module({
  controllers: [AuthController],
  providers: [
    AuthGuard,
    AuthDatabaseService,
    LocalAuthProvider,
    { provide: AuthProvider, useExisting: LocalAuthProvider },
  ],
  exports: [AuthGuard, AuthProvider],
})
export class AuthModule {}
