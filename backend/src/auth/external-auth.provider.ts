import { HttpService } from '@nestjs/axios';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { firstValueFrom } from 'rxjs';
import { JwtPayload, verify } from 'jsonwebtoken';
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
        this.http.post(`${baseUrl}/auth/login`, { username, password }, {
          headers: { 'x-api-key': this.config.getOrThrow<string>('API_KEY') },
          timeout: 5_000,
        }),
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
    const token = this.extractToken(authorization, cookie);
    if (!token) throw new UnauthorizedException('Authentication required.');
    try {
      const issuer = this.config.get<string>('JWT_ISSUER') || undefined;
      const audience = this.config.get<string>('JWT_AUDIENCE') || undefined;
      const payload = verify(token, this.config.getOrThrow<string>('JWT_SECRET'), {
        algorithms: ['HS256'],
        issuer,
        audience,
      });
      if (typeof payload === 'string') {
        throw new UnauthorizedException('Invalid authentication token.');
      }
      const data = payload as JwtPayload & Record<string, unknown>;
      if (typeof data.exp !== 'number') {
        throw new UnauthorizedException('Authentication token must include an expiry.');
      }
      const user = this.asRecord(data.user);
      const rolesValue = data.roles ?? data.role ?? data.authorities ?? user?.roles;
      return {
        id: this.optionalString(data.sub ?? data.id ?? user?.id),
        username: this.optionalString(
          data.username ?? data.preferred_username ?? user?.username ?? data.name,
        ) ?? 'external-user',
        roles: Array.isArray(rolesValue)
          ? rolesValue.map(String)
          : rolesValue
            ? [String(rolesValue)]
            : [],
        expiresAt: data.exp,
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('Session is invalid or expired.');
    }
  }

  private extractToken(authorization?: string, cookie?: string): string | undefined {
    const bearer = authorization?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
    if (bearer) return bearer;
    if (!cookie) return undefined;
    const cookies = Object.fromEntries(
      cookie.split(';').map((part) => {
        const separator = part.indexOf('=');
        if (separator < 0) return [part.trim(), ''];
        return [
          part.slice(0, separator).trim(),
          this.decodeCookie(part.slice(separator + 1).trim()),
        ];
      }),
    );
    return cookies.access_token ?? cookies.accessToken ?? cookies.token;
  }

  private asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
  }

  private optionalString(value: unknown): string | undefined {
    return value === undefined || value === null || value === '' ? undefined : String(value);
  }

  private decodeCookie(value: string): string {
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
}
