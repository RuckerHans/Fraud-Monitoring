import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { AuthModule } from './auth/auth.module';
import { BranchesModule } from './branches/branches.module';
import { HealthController } from './health.controller';
import { ReportsModule } from './reports/reports.module';
import { validateEnvironment } from './config/environment';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      // npm workspace scripts run with backend/ as the working directory.
      // Prefer a backend-specific file when present, then use the repository
      // root file used by Docker Compose and documented local setup.
      envFilePath: ['.env', '../.env'],
      validate: validateEnvironment,
    }),
    LoggerModule.forRoot({
      pinoHttp: {
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'req.headers.api-key',
            'req.headers.x-api-key',
            'req.body.password',
            '*.branchserverpassword',
            '*.branchserverusername',
          ],
          censor: '[REDACTED]',
        },
      },
    }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    BranchesModule,
    AuthModule,
    ReportsModule,
  ],
  controllers: [HealthController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
