// Renderer: 今日要闻汇总（news digest）。
// 把 news 四专栏的 LLM 汇总渲染成独立简报。

import { yamlStr, outputPath, findColumnFile } from './helpers.js';

export function renderDigest(ctx) {
  const { job, date, repoRoot } = ctx;
  const path = outputPath(job, date);
  const digest = ctx.digestContent || [];

  const title = `今日要闻：${date.str}`;
  const description = (job.description || '今日要闻汇总：{date}').replace('{date}', date.str);
  const tags = job.tags || ['时事', '今日要闻'];

  const fm = ['---',
    `title: ${yamlStr(title)}`,
    `date: ${date.iso}`,
    `description: ${yamlStr(description)}`,
    `tags: [${tags.map((t) => yamlStr(t)).join(', ')}]`,
  ];
  if (digest.length) {
    fm.push('tldr:');
    for (const item of digest) fm.push(`  - ${yamlStr(item)}`);
  } else {
    fm.push('tldr: []');
  }
  fm.push('---');

  const body = [];
  if (digest.length) {
    body.push('## 今日要闻\n');
    for (const item of digest) body.push(`- ${item}`);
    body.push('');
    // 子栏目链接：用 glob 找当天实际文件名（带 stamp），转成 .html 相对路径
    const cols = (job.columns || []).map((c) => {
      const file = findColumnFile(repoRoot, job.section, date.str, c.slug);
      if (!file) return null;
      const html = file.replace(/\.md$/, '.html').replace(/^.*\/content\//, '');
      return `[${c.name}](/${html})`;
    }).filter(Boolean);
    if (cols.length) body.push(`> 本文由 ${cols.join(' · ')} 综合生成。`);
  } else {
    body.push('*今日无专栏内容，无法生成汇总。*');
  }

  const content = fm.join('\n') + '\n\n' + body.join('\n').trimEnd() + '\n';
  return { path, content, processed: [] };
}
