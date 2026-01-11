import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class AdminDebugGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();

    const token = (req.header('x-admin-token') || '').trim();
    const expected = (process.env.ADMIN_DEBUG_TOKEN || '').trim();

    if (!expected) {
      // Sécurité: si le token n’est pas configuré, on bloque tout.
      throw new UnauthorizedException('Admin debug token is not configured');
    }

    if (!token || token !== expected) {
      throw new UnauthorizedException('Invalid admin token');
    }

    return true;
  }
}
