import { Injectable, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RowDataPacket } from 'mysql2';
import { createPool, type Pool } from 'mysql2/promise';

interface AuthUserRow extends RowDataPacket {
  id: number;
  username: string;
}

export interface AuthUserRecord {
  id: number;
  username: string;
}

@Injectable()
export class AuthDatabaseService implements OnApplicationShutdown {
  private readonly pool: Pool;

  constructor(config: ConfigService) {
    this.pool = createPool({
      host: config.getOrThrow<string>('AUTH_MYSQL_HOST'),
      port: Number(config.get<number>('AUTH_MYSQL_PORT', 3306)),
      user: config.getOrThrow<string>('AUTH_MYSQL_USER'),
      password: config.getOrThrow<string>('AUTH_MYSQL_PASSWORD'),
      database: config.getOrThrow<string>('AUTH_MYSQL_DATABASE'),
      waitForConnections: true,
      connectionLimit: 5,
      queueLimit: 20,
      enableKeepAlive: true,
    });
  }

  async findUser(username: string, password: string): Promise<AuthUserRecord | undefined> {
    const [rows] = await this.pool.execute<AuthUserRow[]>(
      `SELECT id, username
       FROM monitoring_auth
       WHERE username = ?
         AND password = ?
       LIMIT 1`,
      [username, password],
    );
    const user = rows[0];
    return user ? { id: user.id, username: user.username } : undefined;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
