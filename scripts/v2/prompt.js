// prompt 加载：读 scripts/prompts/{prefix}-{stage}.md（与旧代码共享 prompts 目录）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { SCRIPTS_DIR } from './config.js';

const cache = new Map();

/** 加载提示词文件原文。prefix 默认 'daily'，stage 如 'select'/'summarize'/'tldr'。 */
export function loadPrompt(_scriptsDir, prefix, stage) {
  // scriptsDir 参数忽略（v2 用 SCRIPTS_DIR），保持与旧签名兼容
  const key = `${prefix}:${stage}`;
  if (cache.has(key)) return cache.get(key);
  const file = resolve(SCRIPTS_DIR, 'prompts', `${prefix}-${stage}.md`);
  const text = readFileSync(file, 'utf8');
  cache.set(key, text);
  return text;
}
