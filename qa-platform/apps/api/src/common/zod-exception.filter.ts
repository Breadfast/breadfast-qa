import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';

/**
 * Global exception filter. Duck-types ZodError (workspaces can have multiple
 * zod copies, so `instanceof` is unreliable) → 400 with field issues; passes
 * real HttpExceptions through with their status; everything else → 500.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(ex: any, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();

    if (ex?.name === 'ZodError' && Array.isArray(ex.issues)) {
      return res.status(400).json({
        statusCode: 400,
        error: 'ValidationError',
        issues: ex.issues.map((i: any) => ({ path: (i.path ?? []).join('.'), message: i.message })),
      });
    }
    if (ex instanceof HttpException) {
      return res.status(ex.getStatus()).json(ex.getResponse());
    }
    return res.status(500).json({ statusCode: 500, error: 'InternalServerError', message: ex?.message ?? 'Unknown error' });
  }
}
