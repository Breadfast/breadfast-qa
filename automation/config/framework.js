'use strict';

/**
 * Breadfast Java QA Framework locator (Java + Appium + Selenium + TestNG + Maven).
 * Single machine-readable source for the framework path used by automation generation
 * (docs/ai/automation/automation-generation.md §2) and any parity/verification scripts.
 *
 * The path is CONFIGURABLE — never assume `D:\projects` exists on another engineer's
 * machine. Resolution order:
 *   1. QA_FRAMEWORK_PATH env var
 *   2. `frameworkPath` below (this machine's local default)
 *
 * `resolve()` returns the first candidate that actually contains the framework
 * (verified by its `pom.xml`), else null. On null the caller must ASK the operator
 * for the location (detect-prerequisites gate; ask-never-block) — generation must
 * never fail silently because the framework lives elsewhere.
 */
const fs = require('fs');
const path = require('path');

const frameworkPath = 'D:\\projects';

function resolve() {
  for (const candidate of [process.env.QA_FRAMEWORK_PATH, frameworkPath]) {
    if (candidate && fs.existsSync(path.join(candidate, 'pom.xml'))) return candidate;
  }
  return null;
}

/**
 * Absolute path to a file under the framework's `resources/environments/`, or null when the
 * framework cannot be located. Exists so callers that need a properties file (Google Chat OTP
 * credentials, card-service admin credentials, …) do not each hardcode a drive letter.
 *
 *   environmentsFile('config_testing.properties')
 *   environmentsFile('cardServiceConfigs_testing.properties')
 *
 * Returns null rather than throwing, so the caller can produce its own actionable message
 * (ask-never-block) instead of dying inside a require().
 */
function environmentsFile(name) {
  const root = resolve();
  if (!root) return null;
  const p = path.join(root, 'resources', 'environments', name);
  return fs.existsSync(p) ? p : null;
}

module.exports = { frameworkPath, resolve, environmentsFile };
