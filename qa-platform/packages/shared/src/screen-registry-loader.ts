/**
 * Screen Registry loader (BACKLOG-002 VT0-S3) — fs-backed, Node-only.
 *
 * NOT re-exported through the package index (it imports node:fs). Consume via
 * the subpath export `@qa/shared/screen-registry-loader`, mirroring
 * `@qa/shared/paths`, so the browser bundle never pulls fs.
 *
 * Reads `docs/ai/screens/` (override `QA_SCREEN_REGISTRY_DIR`). Each `*.json`
 * file may be a single Screen, an array of Screens, or a `{ profiles?, screens? }`
 * chunk. Missing/empty dir → an empty (valid) registry.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { companionPath } from './paths.js';
import { ScreenRegistry, Screen, ValidationProfile } from './screen-registry.js';
import type { ScreenRegistry as ScreenRegistryT } from './screen-registry.js';

/** The registry directory: `QA_SCREEN_REGISTRY_DIR` or `<repo>/docs/ai/screens`. */
export function screenRegistryDir(): string {
  const env = process.env.QA_SCREEN_REGISTRY_DIR?.trim();
  return env || companionPath('docs', 'ai', 'screens');
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/**
 * Load + validate the registry. Throws a file-scoped error on invalid JSON or a
 * schema violation so problems surface (graceful reporting is VT4-S7's job).
 */
export function loadScreenRegistry(dir: string = screenRegistryDir()): ScreenRegistryT {
  const profiles: unknown[] = [];
  const screens: unknown[] = [];
  if (!existsSync(dir)) return ScreenRegistry.parse({ profiles, screens });

  for (const file of readdirSync(dir).sort()) {
    if (!/\.json$/i.test(file)) continue;
    if (file.startsWith('_')) continue; // convention: `_*.json` are notes/examples, skipped
    const full = path.join(dir, file);
    let json: unknown;
    try {
      json = JSON.parse(stripBom(readFileSync(full, 'utf8')));
    } catch (e) {
      throw new Error(`screen-registry: invalid JSON in ${file}: ${(e as Error).message}`);
    }
    try {
      if (Array.isArray(json)) {
        for (const s of json) screens.push(Screen.parse(s));
      } else if (json && typeof json === 'object' && ('screens' in json || 'profiles' in json)) {
        const chunk = json as { screens?: unknown[]; profiles?: unknown[] };
        for (const p of chunk.profiles ?? []) profiles.push(ValidationProfile.parse(p));
        for (const s of chunk.screens ?? []) screens.push(Screen.parse(s));
      } else {
        screens.push(Screen.parse(json));
      }
    } catch (e) {
      throw new Error(`screen-registry: schema error in ${file}: ${(e as Error).message}`);
    }
  }
  return ScreenRegistry.parse({ profiles, screens });
}
