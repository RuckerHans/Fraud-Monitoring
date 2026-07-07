import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { BranchesModule } from '../branches/branches.module';
import { BranchAuditTrailService } from './branch-audit-trail.service';
import { BranchConnectionFactory } from './branch-connection.factory';
import { ExcelExportService } from './excel-export.service';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [BranchesModule, AuthModule],
  controllers: [ReportsController],
  providers: [BranchConnectionFactory, BranchAuditTrailService, ReportsService, ExcelExportService],
})
export class ReportsModule {}
