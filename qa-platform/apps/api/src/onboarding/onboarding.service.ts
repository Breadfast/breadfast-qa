import { Injectable } from '@nestjs/common';
import { prisma } from '@qa/db';
import { companionDir, workspaceDir } from '@qa/shared/paths';

const KEY = 'onboarding.completed';

@Injectable()
export class OnboardingService {
  async state(): Promise<{ completed: boolean }> {
    const row = await prisma.setting.findUnique({ where: { key: KEY } });
    return { completed: row?.value === 'true' };
  }

  async complete(): Promise<{ completed: boolean }> {
    await prisma.setting.upsert({
      where: { key: KEY },
      update: { value: 'true' },
      create: { key: KEY, value: 'true', group: 'ai', secret: false },
    });
    return { completed: true };
  }

  /** Resolved locations shown during onboarding (no secrets). */
  env(): { companionDir: string; workspaceDir: string } {
    return { companionDir: companionDir(), workspaceDir: workspaceDir() };
  }
}
