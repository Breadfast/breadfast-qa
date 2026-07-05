import { Module } from '@nestjs/common';
import { FigmaAuthController } from './figma-auth.controller.js';
import { FigmaAuthService } from './figma-auth.service.js';

@Module({
  controllers: [FigmaAuthController],
  providers: [FigmaAuthService],
  exports: [FigmaAuthService],
})
export class FigmaAuthModule {}
