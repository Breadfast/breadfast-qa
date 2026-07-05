import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { TestDataService } from './test-data.service.js';
import { TestDataUpsert } from '@qa/shared';
import { AuthenticatedGuard } from '../common/authenticated.guard.js';

@Controller('test-data')
@UseGuards(AuthenticatedGuard)
export class TestDataController {
  constructor(private readonly svc: TestDataService) {}

  @Get()
  list(@Query('type') type?: string, @Query('status') status?: string) {
    return this.svc.list(type, status);
  }

  @Get('stats')
  stats() {
    return this.svc.stats();
  }

  @Post()
  upsert(@Body() body: unknown) {
    return this.svc.upsert(TestDataUpsert.parse(body));
  }

  @Post(':id/status')
  setStatus(@Param('id') id: string, @Body() body: { status: string }) {
    return this.svc.setStatus(id, body.status);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.svc.remove(id);
  }
}
