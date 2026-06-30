import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '../auth/auth.guard';
import { BranchesService } from './branches.service';

@ApiTags('branches')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('branches')
export class BranchesController {
  constructor(private readonly branches: BranchesService) {}

  @Get()
  @ApiOperation({ summary: 'List branches with online/offline status (no credentials)' })
  list() {
    return this.branches.list();
  }
}
