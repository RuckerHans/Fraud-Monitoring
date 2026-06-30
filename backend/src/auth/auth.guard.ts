import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthProvider } from './auth.types';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly auth: AuthProvider) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: unknown }>();
    request.user = await this.auth.validate(
      request.header('authorization'),
      request.header('cookie'),
    );
    return true;
  }
}
