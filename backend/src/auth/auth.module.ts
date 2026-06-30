import { HttpModule } from '@nestjs/axios';
import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthProvider } from './auth.types';
import { ExternalAuthProvider } from './external-auth.provider';

@Module({
  imports: [HttpModule],
  controllers: [AuthController],
  providers: [
    AuthGuard,
    ExternalAuthProvider,
    { provide: AuthProvider, useExisting: ExternalAuthProvider },
  ],
  exports: [AuthGuard, AuthProvider],
})
export class AuthModule {}
