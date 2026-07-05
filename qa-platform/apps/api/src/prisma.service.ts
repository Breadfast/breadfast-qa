import { Injectable, type OnModuleInit, Global } from '@nestjs/common';
import { prisma } from '@qa/db';

/**
 * Thin Nest provider over the shared Prisma client (packages/db).
 * Exposed globally so every module injects the same instance.
 */
@Global()
@Injectable()
export class PrismaService implements OnModuleInit {
  readonly client = prisma;

  async onModuleInit() {
    await this.client.$connect();
  }
}
