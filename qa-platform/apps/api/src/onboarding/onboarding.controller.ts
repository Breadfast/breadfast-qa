import { Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthenticatedGuard } from '../common/authenticated.guard.js';
import { OnboardingService } from './onboarding.service.js';

@Controller('onboarding')
@UseGuards(AuthenticatedGuard)
export class OnboardingController {
  constructor(private readonly svc: OnboardingService) {}

  @Get('state')
  state() {
    return this.svc.state();
  }

  @Get('env')
  env() {
    return this.svc.env();
  }

  @Post('complete')
  complete() {
    return this.svc.complete();
  }
}
