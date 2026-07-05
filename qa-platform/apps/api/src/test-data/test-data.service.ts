import { Injectable } from '@nestjs/common';
import { prisma } from '@qa/db';
import { TEST_DATA_TYPES, type TestDataType } from '@qa/shared';

@Injectable()
export class TestDataService {
  list(type?: string, status?: string) {
    return prisma.testDataItem.findMany({
      where: { type: type || undefined, status: status || undefined },
      orderBy: [{ type: 'asc' }, { createdAt: 'asc' }],
    });
  }

  /** Counts per type × status for the dashboard/manager header. */
  async stats() {
    const rows = await prisma.testDataItem.groupBy({
      by: ['type', 'status'],
      _count: { _all: true },
    });
    const out: Record<string, { available: number; reserved: number; consumed: number }> = {};
    for (const t of TEST_DATA_TYPES) out[t] = { available: 0, reserved: 0, consumed: 0 };
    for (const r of rows) {
      const bucket = out[r.type] ?? (out[r.type] = { available: 0, reserved: 0, consumed: 0 });
      if (r.status in bucket) (bucket as any)[r.status] = r._count._all;
    }
    return out;
  }

  upsert(input: { id?: string; type: TestDataType; label: string; value: any; status: string; notes?: string }) {
    if (input.id) {
      return prisma.testDataItem.update({
        where: { id: input.id },
        data: { type: input.type, label: input.label, value: input.value, status: input.status, notes: input.notes },
      });
    }
    return prisma.testDataItem.create({
      data: { type: input.type, label: input.label, value: input.value, status: input.status, notes: input.notes },
    });
  }

  remove(id: string) {
    return prisma.testDataItem.delete({ where: { id } });
  }

  /** Reserve the next available item of a type for a run (auto-allocation). */
  async allocate(type: string, runId: string) {
    const item = await prisma.testDataItem.findFirst({ where: { type, status: 'available' }, orderBy: { createdAt: 'asc' } });
    if (!item) return null;
    return prisma.testDataItem.update({
      where: { id: item.id },
      data: { status: 'reserved', reservedByRunId: runId },
    });
  }

  setStatus(id: string, status: string) {
    return prisma.testDataItem.update({ where: { id }, data: { status } });
  }
}
