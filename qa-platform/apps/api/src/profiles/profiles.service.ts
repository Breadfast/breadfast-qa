import { Injectable } from '@nestjs/common';
import { companionPath } from '@qa/shared/paths';
import { existsSync, readFileSync } from 'node:fs';

/**
 * Project Profiles — non-secret per-project defaults committed to the repo at
 * project-defaults.json (root). Read-only here; selecting a profile in the
 * new-story wizard pre-fills its defaults. Secrets are never stored in profiles.
 */
@Injectable()
export class ProfilesService {
  list(): { profiles: unknown[] } {
    const file = companionPath('project-defaults.json');
    if (!existsSync(file)) return { profiles: [] };
    try {
      let raw = readFileSync(file, 'utf8');
      if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
      const data = JSON.parse(raw);
      return { profiles: Array.isArray(data?.profiles) ? data.profiles : [] };
    } catch {
      return { profiles: [] };
    }
  }
}
