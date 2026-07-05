import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { FrameworkInput } from '@qa/shared';
import { AuthenticatedGuard } from '../common/authenticated.guard.js';
import { FrameworksService } from './frameworks.service.js';

@Controller('frameworks')
export class FrameworksController {
  constructor(private readonly svc: FrameworksService) {}

  /** Compact resolved map for the local worker (unguarded, like /settings/resolved). */
  @Get('resolved')
  resolved() {
    return this.svc.resolved();
  }

  @Get()
  @UseGuards(AuthenticatedGuard)
  list() {
    return this.svc.list();
  }

  @Post()
  @UseGuards(AuthenticatedGuard)
  create(@Body() body: unknown) {
    return this.svc.create(FrameworkInput.parse(body));
  }

  @Patch(':id')
  @UseGuards(AuthenticatedGuard)
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.svc.update(id, FrameworkInput.partial().parse(body));
  }

  @Delete(':id')
  @UseGuards(AuthenticatedGuard)
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }

  @Post(':id/scan')
  @UseGuards(AuthenticatedGuard)
  scan(@Param('id') id: string) {
    return this.svc.scan(id);
  }
}
