import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service.js';
import { AuthModule } from './auth/auth.module.js';
import { StoriesModule } from './stories/stories.module.js';
import { RunsModule } from './runs/runs.module.js';
import { DashboardModule } from './dashboard/dashboard.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { TestDataModule } from './test-data/test-data.module.js';
import { FigmaAuthModule } from './figma-auth/figma-auth.module.js';

@Module({
  imports: [AuthModule, StoriesModule, RunsModule, DashboardModule, SettingsModule, TestDataModule, FigmaAuthModule],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}
