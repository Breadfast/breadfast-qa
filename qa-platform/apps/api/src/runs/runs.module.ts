import { Module } from '@nestjs/common';
import { RunsController } from './runs.controller.js';
import { RunsService } from './runs.service.js';
import { EventsBus } from './events.bus.js';

@Module({
  controllers: [RunsController],
  providers: [RunsService, EventsBus],
  exports: [RunsService, EventsBus],
})
export class RunsModule {}
