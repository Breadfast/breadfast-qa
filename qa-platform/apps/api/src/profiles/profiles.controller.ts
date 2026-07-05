import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthenticatedGuard } from '../common/authenticated.guard.js';
import { ProfilesService } from './profiles.service.js';

@Controller('profiles')
export class ProfilesController {
  constructor(private readonly svc: ProfilesService) {}

  @Get()
  @UseGuards(AuthenticatedGuard)
  list() {
    return this.svc.list();
  }
}
