import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { prisma } from '@qa/db';
import { SettingsBulkUpsert } from '@qa/shared';
import { AuthenticatedGuard } from '../common/authenticated.guard.js';

const MASK = '••••••••';

@Controller('settings')
export class SettingsController {
  /** Resolved key→value map for the local worker (unguarded; real values). */
  @Get('resolved')
  async resolved() {
    const rows = await prisma.setting.findMany();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  /** All settings grouped; secret values are masked (a sentinel marks "set"). */
  @Get()
  @UseGuards(AuthenticatedGuard)
  async list() {
    const rows = await prisma.setting.findMany({ orderBy: { key: 'asc' } });
    return rows.map((r) => ({
      key: r.key,
      group: r.group,
      secret: r.secret,
      value: r.secret && r.value ? MASK : r.value,
      isSet: Boolean(r.value),
    }));
  }

  /** Bulk upsert. A masked secret value is ignored (keeps the stored secret). */
  @Post()
  @UseGuards(AuthenticatedGuard)
  async save(@Body() body: unknown) {
    const { settings } = SettingsBulkUpsert.parse(body);
    for (const s of settings) {
      if (s.secret && s.value === MASK) continue; // unchanged secret
      await prisma.setting.upsert({
        where: { key: s.key },
        update: { value: s.value, group: s.group, secret: s.secret },
        create: { key: s.key, value: s.value, group: s.group, secret: s.secret },
      });
    }
    return { ok: true };
  }
}
