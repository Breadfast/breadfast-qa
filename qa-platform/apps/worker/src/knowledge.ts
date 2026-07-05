/**
 * Verifies the QA Companion knowledge base (CLAUDE.md + docs/ai/**) is present
 * at the worker's COMPANION_DIR before a run starts. `claude -p` auto-loads
 * CLAUDE.md/docs/ai/** as project instructions purely from `cwd` — this module
 * adds a defense-in-depth check so a misconfigured COMPANION_DIR fails loudly
 * (via create_workspace throwing) instead of silently producing lower-quality
 * output with no signal to the tester.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

export interface KnowledgeManifest {
  claudeMdFound: boolean;
  claudeMdBytes: number;
  docsAiFiles: string[];
}

export function verifyKnowledgeBase(companionDir: string): KnowledgeManifest {
  const claudeMdPath = path.join(companionDir, 'CLAUDE.md');
  const claudeMdFound = existsSync(claudeMdPath);
  const claudeMdBytes = claudeMdFound ? statSync(claudeMdPath).size : 0;
  const docsAiFiles = claudeMdFound ? listMarkdown(path.join(companionDir, 'docs', 'ai')) : [];
  return { claudeMdFound, claudeMdBytes, docsAiFiles };
}

function listMarkdown(dir: string, prefix = ''): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...listMarkdown(path.join(dir, entry.name), rel));
    else if (entry.name.endsWith('.md')) out.push(rel);
  }
  return out;
}

/** Short reminder line appended to an AI node's context, naming the specific
 *  docs/ai/*.md files most relevant to that node — reinforces the (already
 *  auto-loaded) knowledge base rather than relying on it silently. */
export function knowledgeReminder(manifest: KnowledgeManifest, relevant: string[]): string {
  if (!manifest.claudeMdFound) return '';
  const present = relevant.filter((r) => manifest.docsAiFiles.some((f) => f === r || f.endsWith('/' + r)));
  if (!present.length) return '';
  return `=== PROJECT KNOWLEDGE (already loaded from CLAUDE.md/docs/ai — consult explicitly) ===\n` +
    present.map((p) => `- docs/ai/${p}`).join('\n');
}

/** Which docs/ai/*.md files matter most for a given lifecycle node. */
export const NODE_DOCS: Record<string, string[]> = {
  requirements_analysis: ['testing-process.md', 'business/'],
  figma_analysis: ['testing-process.md'],
  impact_analysis: ['regression-strategy.md'],
  generate_hls: ['testing-process.md'],
  generate_testcases: ['testing-process.md', 'browserstack-process.md'],
  exploratory_testing: ['exploratory-testing.md'],
  automation_generation: ['automation/coding-standards.md', 'automation/reusable-components.md'],
};
