import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthenticatedGuard } from '../common/authenticated.guard.js';
import { KnowledgeService } from './knowledge.service.js';

@Controller('knowledge')
@UseGuards(AuthenticatedGuard)
export class KnowledgeController {
  constructor(private readonly svc: KnowledgeService) {}

  @Get()
  list() {
    return this.svc.list();
  }

  @Get('doc')
  doc(@Query('path') path: string) {
    return this.svc.doc(path);
  }
}
