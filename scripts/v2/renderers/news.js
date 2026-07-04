// Renderer: 新闻简报（daily job）。
// 迁移自 src/render.js，用 helpers 消除重复。

import { yamlStr, renderNewsItem, collectProcessed, outputPath } from './helpers.js';

export function renderNews(ctx) {
  const { job, date, summarized, tldr } = ctx;
  const path = outputPath(job, date);
  const tags = job.tags || ['时事'];
  const description = (job.description || '每日晚报：{date}').replace('{date}', date.str);
  const title = (job.description || '每日晚报：{date}').replace('{date}', date.str).replace('：', '：').replace('每日晚报', '每日晚报');

  const fm = ['---',
    `title: ${yamlStr(title)}`,
    `date: ${date.iso}`,
    `description: ${yamlStr(description)}`,
    `tags: [${tags.map((t) => yamlStr(t)).join(', ')}]`,
  ];
  if (tldr.length) {
    fm.push('tldr:');
    for (const t of tldr) fm.push(`  - ${yamlStr(t)}`);
  } else {
    fm.push('tldr: []');
  }
  fm.push('---');

  const body = [];
  for (const cat of job.categories) {
    const items = summarized[cat] || [];
    if (!items.length) continue;

    // 按 sub 分组（sub 由 LLM 在 select 阶段分配）
    const bySub = {};
    const noSub = [];
    for (const item of items) {
      const sub = item.sub || '';
      if (sub) {
        if (!bySub[sub]) bySub[sub] = [];
        bySub[sub].push(item);
      } else {
        noSub.push(item);
      }
    }

    // 有子分类的先渲染，无子分类的放在最后
    for (const sub of Object.keys(bySub).sort()) {
      body.push(`### ${cat} · ${sub}\n`);
      for (const item of bySub[sub]) body.push(renderNewsItem(item));
      body.push('');
    }
    if (noSub.length) {
      if (Object.keys(bySub).length) body.push(`### ${cat} · 其他\n`);
      else body.push(`## ${cat}\n`);
      for (const item of noSub) body.push(renderNewsItem(item));
      body.push('');
    }
  }

  const content = fm.join('\n') + '\n\n' + body.join('\n').trimEnd() + '\n';
  return { path, content, processed: collectProcessed(summarized) };
}
