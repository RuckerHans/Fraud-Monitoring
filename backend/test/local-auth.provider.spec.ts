import { ConfigService } from '@nestjs/config';
import { UnauthorizedException } from '@nestjs/common';
import { sign } from 'jsonwebtoken';
import { AuthDatabaseService } from '../src/auth/auth-database.service';
import { LocalAuthProvider } from '../src/auth/local-auth.provider';

describe('LocalAuthProvider', () => {
  const secret = 'a-test-secret-with-more-than-thirty-two-characters';
  const findUser = jest.fn();
  const provider = new LocalAuthProvider(
    { findUser } as unknown as AuthDatabaseService,
    new ConfigService({
      JWT_SECRET: secret,
      JWT_EXPIRES_IN: '5m',
    }),
  );

  beforeEach(() => findUser.mockReset());

  it('authenticates against the existing user record and issues a verifiable JWT', async () => {
    findUser.mockResolvedValue({ id: 42, username: 'auditor' });
    const result = await provider.login('auditor', 'password');
    const body = result.body as { accessToken: string };
    await expect(provider.validate(`Bearer ${body.accessToken}`)).resolves.toEqual(
      expect.objectContaining({ id: '42', username: 'auditor', expiresAt: expect.any(Number) }),
    );
    expect(findUser).toHaveBeenCalledWith('auditor', 'password');
  });

  it('rejects invalid credentials', async () => {
    findUser.mockResolvedValue(undefined);
    await expect(provider.login('auditor', 'wrong')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('reports authentication database timeouts safely', async () => {
    findUser.mockRejectedValue(Object.assign(new Error('connect timed out'), {
      code: 'ETIMEDOUT',
    }));
    await expect(provider.login('auditor', 'password')).rejects.toMatchObject({
      message: 'The authentication database connection timed out.',
    });
  });

  it('rejects tokens signed with a different secret', async () => {
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
});
