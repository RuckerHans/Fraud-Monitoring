import {
  ArgumentsHost,
  BadGatewayException,
  Catch,
  ExceptionFilter,
  HttpException,
  RequestTimeoutException,
} from '@nestjs/common';
import type { Response } from 'express';
import { BranchUnreachableError, UpstreamUnavailableError } from './errors';

@Catch()
export class SafeExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    let mapped: HttpException;
    if (exception instanceof BranchUnreachableError) {
      mapped = new RequestTimeoutException('The selected branch is unreachable or timed out.');
    } else if (exception instanceof UpstreamUnavailableError) {
      mapped = new BadGatewayException('A required upstream service is unavailable.');
    } else if (exception instanceof HttpException) {
      mapped = exception;
    } else {
      mapped = new HttpException('An unexpected server error occurred.', 500);
    }
    response.status(mapped.getStatus()).json({
      statusCode: mapped.getStatus(),
      message: mapped.message,
      timestamp: new Date().toISOString(),
    });
  }
}
