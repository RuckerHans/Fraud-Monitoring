export interface AuthenticatedUser {
  id?: string;
  username: string;
  roles: string[];
  expiresAt: number;
  raw?: unknown;
}

export interface AuthLoginResult {
  body: unknown;
  setCookie?: string[];
}

export abstract class AuthProvider {
  abstract login(username: string, password: string): Promise<AuthLoginResult>;
  abstract validate(authorization?: string, cookie?: string): Promise<AuthenticatedUser>;
}
