// v2 配置加载：feeds.yml + jobs.yml + CLI 参数 + env → ctx（含 store）。
// 复用旧 config.js 的逻辑，但 SCRIPTS_DIR 指向 v2，jobs/feeds/prompts 在 scripts/ 根共享。

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';
import { Store } from './core/store.js';

const V2_DIR = resolve(dirname(fileURLToPath(import.meta.url)));
const SCRIPTS_DIR = resolve(V2_DIR, '..');  // scripts/（jobs.yml/feeds.yml/prompts 所在）
const REPO_ROOT = resolve(SCRIPTS_DIR, '..');

function loadYaml(rel) {
  const text = readFileSync(resolve(SCRIPTS_DIR, rel), 'utf8');
  return yaml.load(text);
}

export function parseArgs(argv) {
  const args = { job: 'daily', dryRun: false, stopAfter: null };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a.startsWith('--stop-after=')) args.stopAfter = a.slice('--stop-after='.length);
    else if (a.startsWith('--job=')) args.job = a.slice('--job='.length);
  }
  return args;
}

function loadEnvFile() {
  try {
    const text = readFileSync(resolve(SCRIPTS_DIR, '.env'), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* GA 或无 .env 时静默 */ }
}

export function buildContext(args) {
  loadEnvFile();

  const feeds = loadYaml('feeds.yml').filter((f) => f.enabled !== false);
  const { jobs } = loadYaml('jobs.yml');
  const job = jobs.find((j) => j.name === args.job);
  if (!job) throw new Error(`job "${args.job}" 未在 jobs.yml 中定义`);

  // 北京时间
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 3600_000);
  const pad = (n) => String(n).padStart(2, '0');
  const dateStr = `${beijing.getUTCFullYear()}-${pad(beijing.getUTCMonth() + 1)}-${pad(beijing.getUTCDate())}`;
  const dateIso = `${dateStr}T${pad(beijing.getUTCHours())}:${pad(beijing.getUTCMinutes())}:${pad(beijing.getUTCSeconds())}+08:00`;

  return {
    args,
    repoRoot: REPO_ROOT,
    scriptsDir: SCRIPTS_DIR,
    v2Dir: V2_DIR,
    job,
    feeds,
    date: { str: dateStr, iso: dateIso },
    store: new Store(REPO_ROOT),
    // 阶段间传递
    items: [],
    selected: {},
    summarized: {},
    tldr: [],
    _usage: {},
  };
}

export { SCRIPTS_DIR, REPO_ROOT };
