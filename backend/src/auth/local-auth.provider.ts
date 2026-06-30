import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtPayload, sign, SignOptions, verify } from 'jsonwebtoken';
import { UpstreamUnavailableError } from '../common/errors';
import { AuthDatabaseService } from './auth-database.service';
import { AuthenticatedUser, AuthLoginResult, AuthProvider } from './auth.types';

@Injectable()
export class LocalAuthProvider implements AuthProvider {
  constructor(
    private readonly database: AuthDatabaseService,
    private readonly config: ConfigService,
  ) {}

  async login(username: string, password: string): Promise<AuthLoginResult> {
    try {
      const user = await this.database.findUser(username, password);
      if (!user) throw new UnauthorizedException('Invalid username or password.');
      const accessToken = sign(
        { sub: String(user.id), username: user.username, roles: [] },
        this.config.getOrThrow<string>('JWT_SECRET'),
        {
          algorithm: 'HS256',
          expiresIn: this.config.get<string>(
            'JWT_EXPIRES_IN',
            '3d',
          ) as SignOptions['expiresIn'],
        },
      );
      return {
        body: {
          message: 'Login successful.',
          user,
          accessToken,
        },
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UpstreamUnavailableError(this.databaseErrorMessage(error));
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
      const rolesValue = data.roles ?? data.role ?? data.authorities;
      return {
        id: this.optionalString(data.sub ?? data.id),
        username: this.optionalString(data.username ?? data.preferred_username ?? data.name)
          ?? 'local-user',
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

  private databaseErrorMessage(error: unknown): string {
    const code = error && typeof error === 'object' && 'code' in error
      ? String(error.code).toUpperCase()
      : '';
    if (code === 'ETIMEDOUT') return 'The authentication database connection timed out.';
    if (code === 'ECONNREFUSED') return 'The authentication database refused the connection.';
    if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
      return 'The authentication database hostname could not be resolved.';
    }
    if (code === 'ER_ACCESS_DENIED_ERROR') {
      return 'The authentication database rejected its configured login.';
    }
    if (code === 'ER_DBACCESS_DENIED_ERROR') {
      return 'The configured MySQL user cannot access the authentication database.';
    }
    if (code === 'ER_BAD_DB_ERROR') {
      return 'The configured authentication database does not exist.';
    }
    if (code === 'ER_NO_SUCH_TABLE') {
      return 'The monitoring_auth table was not found in the authentication database.';
    }
    return code
      ? `The authentication database returned error ${code}.`
      : 'The authentication database is unavailable.';
  }
}
