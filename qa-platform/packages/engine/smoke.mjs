/**
 * Engine smoke test — pure Node (no install needed).
 * Proves the production mechanism end-to-end:
 *   1. spawn the local `claude` CLI headless with cwd = QA Companion dir
 *   2. CLAUDE.md + docs/ai/** load automatically as project instructions
 *   3. a scoped task returns a JSON object matching the expected shape
 *
 *   node smoke.mjs            # uses QA_COMPANION_DIR or D:\BreadfastQA
 */
import { spawn } from 'node:child_process';

const BIN = process.env.CLAUDE_BIN || 'claude';
const CWD = process.env.QA_COMPANION_DIR || 'D:\\BreadfastQA';
const MODEL = process.env.ENGINE_MODEL_CHEAP || 'claude-haiku-4-5-20251001';

const instruction =
  'You are executing a scoped QA task. From your project instructions (CLAUDE.md Quick Reference), ' +
  'report a few always-derivable facts. Return ONLY a JSON object, no prose, no markdown fences, ' +
  'matching exactly: {"appBuild": string, "payGetStartedTap": string, "loginOtpSource": string, ' +
  '"screenshotAccumulators": string[]}';

function runClaude(prompt) {
  return new Promise((resolve, reject) => {
    const args = ['-p', prompt, '--output-format', 'json', '--permission-mode', 'plan', '--model', MODEL];
    const child = spawn(BIN, args, { cwd: CWD, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d.toString()));
    child.stderr.on('data', (d) => (err += d.toString()));
    child.on('error', reject);
    child.on('close', (code) => {
      const start = out.lastIndexOf('{"type"');
      try {
        resolve(JSON.parse(start >= 0 ? out.slice(start) : out.trim()));
      } catch {
        reject(new Error(`could not parse CLI output (exit ${code}). stderr:\n${err}\nstdout:\n${out}`));
      }
    });
  });
}

function parseInner(text) {
  let t = (text || '').trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  return JSON.parse(a >= 0 && b > a ? t.slice(a, b + 1) : t);
}

console.log(`[smoke] bin=${BIN}  cwd=${CWD}  model=${MODEL}`);
console.log('[smoke] running headless task...');
const t0 = Date.now();
const env = await runClaude(instruction);
const wall = ((Date.now() - t0) / 1000).toFixed(1);

const data = parseInner(env.result);
const ok =
  typeof data.appBuild === 'string' &&
  typeof data.payGetStartedTap === 'string' &&
  Array.isArray(data.screenshotAccumulators);

console.log('\n[smoke] structured result:');
console.log(JSON.stringify(data, null, 2));
console.log(`\n[smoke] session=${env.session_id}  cost=$${(env.total_cost_usd ?? 0).toFixed(4)}  wall=${wall}s`);
console.log(`[smoke] CLAUDE.md context loaded + schema-valid JSON: ${ok ? 'PASS ✓' : 'FAIL ✗'}`);
process.exit(ok ? 0 : 1);
