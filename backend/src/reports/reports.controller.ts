import {
  Controller,
  Get,
  Header,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProduces, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthGuard } from '../auth/auth.guard';
import type { AuthenticatedUser } from '../auth/auth.types';
import { ExcelExportService } from './excel-export.service';
import { ExportQueryDto, ReportQueryDto } from './report-query.dto';
import { ReportsService } from './reports.service';

@ApiTags('reports')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly excel: ExcelExportService,
  ) {}

  @Get('transactions')
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Query explicitly selected branches with pagination' })
  transactions(
    @Query() query: ReportQueryDto,
    @Req() request: Request & { user?: AuthenticatedUser },
  ) {
    return this.reports.find(query, request.user?.username);
  }

  @Get('transactions/export')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Header('Cache-Control', 'no-store')
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  @ApiOperation({ summary: 'Export up to 50,000 filtered rows as XLSX' })
  async export(
    @Query() query: ExportQueryDto,
    @Req() request: Request & { user?: AuthenticatedUser },
    @Res() response: Response,
  ) {
    const rows = await this.reports.exportRows(query, request.user?.username);
    const workbook = await this.excel.build(rows);
    response
      .type('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .attachment(`fraud-monitoring-${query.from}-to-${query.to}.xlsx`)
      .send(workbook);
  }
}
