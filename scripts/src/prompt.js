// 提示词加载：读 scripts/prompts/{prefix}-{stage}.md
// 提示词文件顶部用 frontmatter 风格声明变量，正文是模板（无模板引擎，保持纯文本简单）。
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const cache = new Map();

/** 加载提示词文件原文。prefix 默认 'daily'，stage 如 'select'/'summarize'/'tldr'。 */
export function loadPrompt(scriptsDir, prefix, stage) {
  const key = `${prefix}:${stage}`;
  if (cache.has(key)) return cache.get(key);
  const file = resolve(scriptsDir, 'prompts', `${prefix}-${stage}.md`);
  const text = readFileSync(file, 'utf8');
  cache.set(key, text);
  return text;
}
