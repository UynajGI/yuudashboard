// 配置加载：feeds.yml + jobs.yml + CLI 参数 + env → 一个 ctx 对象
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import yaml from 'js-yaml';

const SCRIPTS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(SCRIPTS_DIR, '..');

function loadYaml(rel) {
  const text = readFileSync(resolve(SCRIPTS_DIR, rel), 'utf8');
  return yaml.load(text);
}

/** 解析 --job=xxx / --dry-run / --stop-after=stage 之类 CLI 参数 */
export function parseArgs(argv) {
  const args = { job: 'daily', dryRun: false, stopAfter: null, rebuildState: false };
  for (const a of argv.slice(2)) {
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--rebuild-state') args.rebuildState = true;
    else if (a.startsWith('--stop-after=')) args.stopAfter = a.slice('--stop-after='.length);
    else if (a.startsWith('--job=')) args.job = a.slice('--job='.length);
  }
  return args;
}

/** 加载 .env（本地调试用；GA 走 GitHub Secrets 直接注入 env，不读此文件） */
function loadEnvFile() {
  try {
    const text = readFileSync(resolve(SCRIPTS_DIR, '.env'), 'utf8');
    for (const line of text.split('\n')) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {
    // GA 或无 .env 时静默，key 由 secrets 直接注入
  }
}

/**
 * 构建 job 运行上下文。所有阶段共享这个 ctx，按需读写。
 * @param {{job?:string, dryRun?:boolean, stopAfter?:string|null}} args
 */
export function buildContext(args) {
  loadEnvFile();

  const feeds = loadYaml('feeds.yml').filter((f) => f.enabled !== false);
  const { jobs } = loadYaml('jobs.yml');
  const job = jobs.find((j) => j.name === args.job);
  if (!job) throw new Error(`job "${args.job}" 未在 jobs.yml 中定义`);

  // 北京时间（UTC+8）的 YYYY-MM-DD，用于文件名和 frontmatter date
  const now = new Date();
  const beijing = new Date(now.getTime() + 8 * 3600_000);
  const y = beijing.getUTCFullYear();
  const m = String(beijing.getUTCMonth() + 1).padStart(2, '0');
  const d = String(beijing.getUTCDate()).padStart(2, '0');
  const dateStr = `${y}-${m}-${d}`;

  // date 字段：带 +08:00 偏移的北京时间 ISO 字符串。
  // 晚报在北京 19:00 跑，当时真实时刻一定 ≤ now，Hugo 不会判为"未来"。
  const bjOffset = 8 * 3600_000;
  const bjNow = new Date(now.getTime() + bjOffset);
  const pad = (n) => String(n).padStart(2, '0');
  const dateIso =
    `${dateStr}T${pad(bjNow.getUTCHours())}:${pad(bjNow.getUTCMinutes())}:${pad(bjNow.getUTCSeconds())}+08:00`;

  return {
    args,
    repoRoot: REPO_ROOT,
    scriptsDir: SCRIPTS_DIR,
    job,
    feeds,
    date: { str: dateStr, iso: dateIso },
    // 阶段间传递的工作数据，clean 阶段填充
    items: [],
    selected: {},
    summarized: {},
    tldr: [],
  };
}

/** 把 window 字符串（"24h"/"7d"）转成毫秒 */
export function windowToMs(window) {
  const m = String(window).match(/^(\d+)([hd])$/);
  if (!m) throw new Error(`window 格式错误: ${window}（应为如 24h / 7d）`);
  const n = Number(m[1]);
  return m[2] === 'h' ? n * 3600_000 : n * 86_400_000;
}
