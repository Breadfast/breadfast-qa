import { Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { AuthenticatedGuard } from '../common/authenticated.guard.js';
import { FigmaAuthService } from './figma-auth.service.js';

/**
 * Figma browser-session endpoints.
 *
 * POST  /figma/connect  — launch headed browser for manual Figma login
 * GET   /figma/status   — check saved session state (connected/connecting/disconnected/expired)
 * DELETE /figma/connect — remove saved session + kill in-progress browser
 */
@Controller('figma')
@UseGuards(AuthenticatedGuard)
export class FigmaAuthController {
  constructor(private readonly figmaAuth: FigmaAuthService) {}

  @Post('connect')
  connect() {
    return this.figmaAuth.connect();
  }

  @Get('status')
  status() {
    return this.figmaAuth.getStatus();
  }

  @Delete('connect')
  disconnect() {
    return this.figmaAuth.disconnect();
  }
}
