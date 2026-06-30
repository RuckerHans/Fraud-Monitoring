import { HttpService } from '@nestjs/axios';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { UpstreamUnavailableError } from '../common/errors';
import { AuthenticatedUser, AuthLoginResult, AuthProvider } from './auth.types';

@Injectable()
export class ExternalAuthProvider implements AuthProvider {
  constructor(
    private readonly http: HttpService,
    private readonly config: ConfigService,
  ) {}

  async login(username: string, password: string): Promise<AuthLoginResult> {
    try {
      const baseUrl = this.config.getOrThrow<string>('AUTH_SERVICE_URL');
      const response = await firstValueFrom(
        this.http.post(`${baseUrl}/auth/login`, { username, password }, { timeout: 5_000 }),
      );
      return {
        body: response.data,
        setCookie: response.headers['set-cookie']?.map((cookie) =>
          cookie.replace(/;\s*Domain=[^;]+/i, ''),
        ),
      };
    } catch (error: any) {
      if (error?.response?.status === 401) throw new UnauthorizedException('Invalid credentials.');
      throw new UpstreamUnavailableError('Auth service unavailable');
    }
  }

  async validate(authorization?: string, cookie?: string): Promise<AuthenticatedUser> {
    if (!authorization && !cookie) throw new UnauthorizedException('Authentication required.');
    const validatePath = this.config.get<string>('AUTH_VALIDATE_PATH');

    // Temporary adapter until the upstream token/session response contract is confirmed.
    if (!validatePath) {
      return { username: 'external-user', roles: [], raw: undefined };
    }
    try {
      const baseUrl = this.config.getOrThrow<string>('AUTH_SERVICE_URL');
      const response = await firstValueFrom(
        this.http.get(`${baseUrl}${validatePath}`, {
          headers: { authorization, cookie },
          timeout: 5_000,
        }),
      );
      const data = response.data as Record<string, any>;
      return {
        id: data.id ? String(data.id) : undefined,
        username: String(data.username ?? data.user?.username ?? 'external-user'),
        roles: Array.isArray(data.roles) ? data.roles.map(String) : [],
        raw: data,
      };
    } catch (error: any) {
      if ([401, 403].includes(error?.response?.status)) {
        throw new UnauthorizedException('Session is invalid or expired.');
      }
      throw new UpstreamUnavailableError('Auth service unavailable');
    }
  }
}
