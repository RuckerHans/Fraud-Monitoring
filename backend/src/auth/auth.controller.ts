import { Body, Controller, Get, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthGuard } from './auth.guard';
import { AuthProvider } from './auth.types';
import { LoginDto } from './login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthProvider) {}

  @Post('login')
  @ApiOperation({ summary: 'Delegate login to the existing auth service' })
  async login(
    @Body() input: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(input.username, input.password);
    if (result.setCookie?.length) response.setHeader('Set-Cookie', result.setCookie);
    return result.body;
  }

  @Get('me')
  @UseGuards(AuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Validate the current external session' })
  me(@Req() request: Request & { user?: unknown }) {
    return request.user;
  }
}
