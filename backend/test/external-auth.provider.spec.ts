import { HttpService } from '@nestjs/axios';
import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import { of } from 'rxjs';
import { ExternalAuthProvider } from '../src/auth/external-auth.provider';

describe('ExternalAuthProvider', () => {
  const secret = 'a-test-secret-with-more-than-thirty-two-characters';
  const post = jest.fn();
  const provider = new ExternalAuthProvider(
    { post } as unknown as HttpService,
    new ConfigService({
      AUTH_SERVICE_URL: 'http://auth.example',
      API_KEY: 'test-api-key',
      JWT_SECRET: secret,
    }),
  );

  beforeEach(() => post.mockReset());

  it('verifies an HS256 bearer token and maps identity claims', async () => {
    const token = sign(
      { username: 'auditor', roles: ['fraud-reviewer'] },
      secret,
      { algorithm: 'HS256', expiresIn: '5m', subject: '42' },
    );
    await expect(provider.validate(`Bearer ${token}`)).resolves.toEqual(
      expect.objectContaining({
        id: '42',
        username: 'auditor',
        roles: ['fraud-reviewer'],
        expiresAt: expect.any(Number),
      }),
    );
  });

  it('rejects a token signed with a different secret', async () => {
    const token = sign({ username: 'attacker' }, 'another-secret', {
      algorithm: 'HS256',
      expiresIn: '5m',
    });
    await expect(provider.validate(`Bearer ${token}`)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects non-expiring tokens', async () => {
    const token = sign({ username: 'auditor' }, secret, { algorithm: 'HS256' });
    await expect(provider.validate(`Bearer ${token}`)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('sends the server-side API key to the auth service', async () => {
    post.mockReturnValue(of({ data: { token: 'jwt' }, headers: {} }));
    await provider.login('auditor', 'password');
    expect(post).toHaveBeenCalledWith(
      'http://auth.example/auth/login',
      { username: 'auditor', password: 'password' },
      expect.objectContaining({ headers: { 'x-api-key': 'test-api-key' } }),
    );
  });
});
