import { Injectable, NotFoundException } from '@nestjs/common';
import { prisma } from '@qa/db';
import { CreateStoryInput, phasesToNodes } from '@qa/shared';
import { storyDir } from '@qa/shared/paths';

@Injectable()
export class StoriesService {
  /** Create a story + its on-disk workspace path (folder created lazily by the worker). */
  async create(input: CreateStoryInput, ownerId: string) {
    const data = CreateStoryInput.parse(input);

    const common = {
      platform: data.platform,
      environment: data.environment,
      locales: data.locales.join(','),
      notes: data.notes,
      appUrl: data.appUrl,
      adminUrl: data.adminUrl,
      bsAppIds: data.bsAppIds ?? undefined,
      bsFolderId: data.bsFolderId,
      devices: data.devices ?? undefined,
      executionType: data.executionType,
      credentials: data.credentials ?? undefined,
      packageNumbers: data.packageNumbers,
      testDataFile: data.testDataFile,
      executionInstructions: data.executionInstructions,
      additionalInputs: data.additionalInputs,
      // Expand selected phases → concrete node list (mandatory phases always in).
      // Omitted/empty selection = null = run the full lifecycle (backward compatible).
      enabledNodes: data.phases && data.phases.length ? phasesToNodes(data.phases) : undefined,
      executionModel: data.executionModel || undefined,
    };

    return prisma.story.upsert({
      where: { jiraKey: data.jiraKey },
      update: common,
      create: {
        ...common,
        jiraKey: data.jiraKey,
        title: data.jiraKey, // refined by the fetch_jira node
        workspacePath: storyDir(data.jiraKey),
        ownerId,
      },
    });
  }

  list() {
    return prisma.story.findMany({
      orderBy: { updatedAt: 'desc' },
      include: { runs: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
  }

  async get(id: string) {
    const story = await prisma.story.findUnique({
      where: { id },
      include: {
        runs: { include: { steps: { orderBy: { ordinal: 'asc' } } }, orderBy: { createdAt: 'desc' } },
        testCases: true,
        artifacts: true,
        defects: true,
      },
    });
    if (!story) throw new NotFoundException(`Story ${id} not found`);
    return story;
  }

  /**
   * Manual-review sign-off (M1b). Records the tester's per-dimension review in
   * the AuditLog (attributable, immutable trail) and marks the story signed off.
   */
  async signoff(
    id: string,
    dims: { requirements?: boolean; exploratory?: boolean; visual?: boolean; note?: string },
    actorId: string,
  ) {
    const story = await prisma.story.findUnique({ where: { id } });
    if (!story) throw new NotFoundException(`Story ${id} not found`);
    await prisma.auditLog.create({
      data: {
        actorId,
        action: 'story.signoff',
        entity: 'Story',
        entityId: id,
        diffJson: {
          requirements: !!dims.requirements,
          exploratory: !!dims.exploratory,
          visual: !!dims.visual,
          note: dims.note ?? '',
        },
      },
    });
    return prisma.story.update({ where: { id }, data: { status: 'signed_off' } });
  }
}
