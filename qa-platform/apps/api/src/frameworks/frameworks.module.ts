import { Module } from '@nestjs/common';
import { FrameworksController } from './frameworks.controller.js';
import { FrameworksService } from './frameworks.service.js';

@Module({ controllers: [FrameworksController], providers: [FrameworksService] })
export class FrameworksModule {}
