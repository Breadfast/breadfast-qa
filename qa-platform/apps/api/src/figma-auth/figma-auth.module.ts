import { Module } from '@nestjs/common';
import { FigmaAuthController } from './figma-auth.controller.js';
import { FigmaAuthService } from './figma-auth.service.js';
import { FrameworksModule } from '../frameworks/frameworks.module.js';

@Module({
  imports: [FrameworksModule],
  controllers: [FigmaAuthController],
  providers: [FigmaAuthService],
  exports: [FigmaAuthService],
})
export class FigmaAuthModule {}
