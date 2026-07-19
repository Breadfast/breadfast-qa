import { Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { StoriesService } from './stories.service.js';
import { AuthenticatedGuard } from '../common/authenticated.guard.js';
import type { SessionUser } from '../auth/session.serializer.js';
import type { CreateStoryInput } from '@qa/shared';

@Controller('stories')
@UseGuards(AuthenticatedGuard)
export class StoriesController {
  constructor(private readonly stories: StoriesService) {}

  @Post()
  create(@Body() body: CreateStoryInput, @Req() req: Request) {
    const user = req.user as SessionUser;
    return this.stories.create(body, user.id);
  }

  @Get()
  list() {
    return this.stories.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.stories.get(id);
  }

  @Post(':id/signoff')
  signoff(
    @Param('id') id: string,
    @Body() body: { requirements?: boolean; exploratory?: boolean; visual?: boolean; note?: string },
    @Req() req: Request,
  ) {
    const user = req.user as SessionUser;
    return this.stories.signoff(id, body, user.id);
  }
}
