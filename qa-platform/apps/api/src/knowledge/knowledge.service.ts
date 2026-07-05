import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { companionDir } from '@qa/shared/paths';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export interface KnowledgeDocRef {
  path: string; // relative to repo root, forward-slashed
  title: string;
  group: string;
}

/**
 * Read-only browser over the canonical knowledge base the AI engine loads:
 * CLAUDE.md + docs/ai/** (source of truth) and the Phase-0 design specs.
 * (The full Knowledge Center — proposal review/editing — is a later phase.)
 */
@Injectable()
export class KnowledgeService {
  list(): { docs: KnowledgeDocRef[] } {
    const root = companionDir();
    const docs: KnowledgeDocRef[] = [];
    const claudeMd = path.join(root, 'CLAUDE.md');
    if (existsSync(claudeMd)) docs.push({ path: 'CLAUDE.md', title: title(claudeMd) || 'CLAUDE.md', group: 'Orchestration' });
    collect(path.join(root, 'docs', 'ai'), root, 'Knowledge base', docs);
    collect(path.join(root, 'qa-platform', 'docs', 'design'), root, 'Design specs', docs);
    return { docs };
  }

  doc(rel: string): { path: string; content: string } {
    if (!rel || !rel.endsWith('.md')) throw new BadRequestException('expected a .md path');
    const root = companionDir();
    const abs = path.resolve(root, rel);
    // Traversal guard: must resolve inside the repo root and be an allowed area.
    const allowed = [path.join(root, 'CLAUDE.md'), path.join(root, 'docs'), path.join(root, 'qa-platform', 'docs', 'design')];
    if (!allowed.some((a) => abs === a || abs.startsWith(a + path.sep))) {
      throw new BadRequestException('path not permitted');
    }
    if (!existsSync(abs)) throw new NotFoundException('doc not found');
    return { path: rel, content: readFileSync(abs, 'utf8') };
  }
}

function title(file: string): string | null {
  try {
    for (const line of readFileSync(file, 'utf8').split('\n').slice(0, 15)) {
      const m = line.match(/^#\s+(.+)/);
      if (m) return m[1].trim();
    }
  } catch { /* ignore */ }
  return null;
}

function collect(dir: string, root: string, group: string, out: KnowledgeDocRef[]) {
  if (!existsSync(dir)) return;
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = path.join(dir, e.name);
    if (e.isDirectory()) collect(abs, root, group, out);
    else if (e.name.endsWith('.md')) {
      const rel = path.relative(root, abs).replace(/\\/g, '/');
      out.push({ path: rel, title: title(abs) || e.name, group });
    }
  }
}
