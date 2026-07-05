import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import type { Request } from 'express';

/** Allows the request through only if a session user exists. */
@Injectable()
export class AuthenticatedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    // In dev without configured Google creds, allow a header-injected user.
    if (!req.isAuthenticated?.() && process.env.NODE_ENV !== 'production') {
      const devUser = req.headers['x-dev-user'];
      if (devUser) {
        (req as Request & { user?: unknown }).user = JSON.parse(String(devUser));
        return true;
      }
    }
    return req.isAuthenticated?.() ?? false;
  }
}
