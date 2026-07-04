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
      if (sub && sub !== '其他') {
        if (!bySub[sub]) bySub[sub] = [];
        bySub[sub].push(item);
      } else {
        noSub.push(item);
      }
    }

    // 按 job.subs 定义的顺序渲染；未列在 subs 里的子类按字典序补在后面；"其他"始终最后
    const definedOrder = (job.subs || []).filter((s) => s !== '其他');
    const seen = new Set();
    const ordered = [];
    for (const sub of definedOrder) {
      if (bySub[sub]) { ordered.push(sub); seen.add(sub); }
    }
    for (const sub of Object.keys(bySub).sort()) {
      if (!seen.has(sub)) { ordered.push(sub); seen.add(sub); }
    }

    for (const sub of ordered) {
      body.push(`### ${cat} · ${sub}\n`);
      for (const item of bySub[sub]) body.push(renderNewsItem(item));
      body.push('');
    }
    if (noSub.length) {
      body.push(`### ${cat} · 其他\n`);
      for (const item of noSub) body.push(renderNewsItem(item));
      body.push('');
    }
  }

  const content = fm.join('\n') + '\n\n' + body.join('\n').trimEnd() + '\n';
  return { path, content, processed: collectProcessed(summarized) };
}
