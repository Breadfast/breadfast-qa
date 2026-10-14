'use strict';

/**
 * Breadfast Java QA Framework locator (Java + Appium + Selenium + TestNG + Maven).
 * Single machine-readable source for the framework path used by automation generation
 * (docs/ai/automation/automation-generation.md §2) and any parity/verification scripts.
 *
 * The path is CONFIGURABLE and CROSS-PLATFORM — never assume `D:\projects` exists on
 * another engineer's machine (it does not exist at all on macOS). Resolution order:
 *   1. QA_FRAMEWORK_PATH        env var (explicit, wins everywhere)
 *   2. BF_JAVA_FRAMEWORK_DIR    env var (set by the platform worker / Framework Registry)
 *   3. BF_JAVA_DIR              env var (legacy alias)
 *   4. conventional sibling checkouts, relative to this repo and the OS home dir
 *   5. the historical Windows default (D:\projects) — last, and only if it exists
 *
 * `resolve()` returns the first candidate that actually contains the framework
 * (verified by its `pom.xml`), else null. On null the caller must ASK the operator
 * for the location (detect-prerequisites gate; ask-never-block) — generation must
 * never fail silently, or hard-fail, because the framework lives elsewhere.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

/** This repo's root (…/automation/config → …). */
const repoRoot = path.resolve(__dirname, '..', '..');

/**
 * Conventional locations, in priority order, for a checkout of the Java framework.
 * Covers the common layouts on both platforms: a sibling of this repo, and
 * ~/projects / ~/dev/projects / ~/Projects on macOS & Linux.
 */
function conventionalCandidates() {
  const home = os.homedir();
  return [
    path.join(path.dirname(repoRoot), 'projects'),
    path.join(home, 'projects'),
    path.join(home, 'Projects'),
    path.join(home, 'dev', 'projects'),
    path.join(home, 'breadfast', 'projects'),
    // Historical Windows default — kept last so it never shadows a real checkout.
    path.join('D:', path.sep, 'projects'),
  ];
}

/** True if `dir` looks like the Maven framework root (has a pom.xml). */
function isFrameworkRoot(dir) {
  try {
    return !!dir && fs.existsSync(path.join(dir, 'pom.xml'));
  } catch (_) {
    return false;
  }
}

/** Every candidate considered, in order — useful for error messages and diagnostics. */
function candidates() {
  return [
    process.env.QA_FRAMEWORK_PATH,
    process.env.BF_JAVA_FRAMEWORK_DIR,
    process.env.BF_JAVA_DIR,
    ...conventionalCandidates(),
  ].filter(Boolean);
}

/** The resolved framework root, or null if no candidate contains a pom.xml. */
function resolve() {
  for (const candidate of candidates()) {
    if (isFrameworkRoot(candidate)) return candidate;
  }
  return null;
}

/**
 * `resolve()` or a descriptive throw — for scripts that genuinely cannot proceed.
 * Interactive callers should prefer `resolve()` and ASK instead of throwing.
 */
function requireResolve() {
  const found = resolve();
  if (found) return found;
  throw new Error(
    'Java QA framework not found. Set QA_FRAMEWORK_PATH to your checkout of the ' +
    'Breadfast Java framework (the folder containing pom.xml).\n  Tried:\n    ' +
    candidates().join('\n    ')
  );
}

/** `<framework>/resources/environments`, or null when the framework is unresolved. */
function environmentsDir() {
  const root = resolve();
  return root ? path.join(root, 'resources', 'environments') : null;
}

/**
 * Absolute path to a file under the framework's `resources/environments/`, or null when the
 * framework cannot be located OR the file is absent (it is gitignored — each engineer copies it
 * in). Exists so callers that need a properties file (Google Chat OTP credentials, card-service
 * admin credentials, …) do not each hardcode a drive letter.
 *
 *   environmentsFile('config_testing.properties')
 *   environmentsFile('cardServiceConfigs_testing.properties')
 *
 * Returns null rather than throwing, so the caller can produce its own actionable message
 * (ask-never-block) instead of dying inside a require().
 */
function environmentsFile(filename) {
  const dir = environmentsDir();
  if (!dir) return null;
  const p = path.join(dir, filename);
  return fs.existsSync(p) ? p : null;
}

module.exports = {
  repoRoot,
  candidates,
  isFrameworkRoot,
  resolve,
  requireResolve,
  environmentsDir,
  environmentsFile,
  /** @deprecated Windows-only literal; use resolve(). Retained for back-compat. */
  frameworkPath: path.join('D:', path.sep, 'projects'),
};
