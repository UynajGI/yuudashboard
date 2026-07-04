// Renderer: 联动观察（linkage job）。
// 迁移自 src/render-linkage.js，用 helpers 消除重复。

import {
  yamlStr, renderPairChart, collectProcessed, outputPath,
} from './helpers.js';
import { getSeries } from '../core/series.js';
import { pearson } from '../core/util.js';

/** 本地重算 top 配对（不依赖 agent trace） */
function computeTopPairs(history, days = 7, topK = 3) {
  const dates = Object.keys(history.days || {}).sort();
  const latest = dates[dates.length - 1];
  if (!latest) return { positive: [], negative: [] };
  const names = Object.keys(history.days[latest]);
  const pairs = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const sa = getSeries(history, names[i], days);
      const sb = getSeries(history, names[j], days);
      const xs = [], ys = [];
      for (let k = 0; k < sa.dates.length; k++) {
        if (sa.closes[k] != null && sb.closes[k] != null) { xs.push(sa.closes[k]); ys.push(sb.closes[k]); }
      }
      if (xs.length < 3) continue;
      const r = pearson(xs, ys);
      if (isFinite(r)) pairs.push({ a: names[i], b: names[j], r: Number(r.toFixed(3)) });
    }
  }
  pairs.sort((x, y) => y.r - x.r);
  return { positive: pairs.slice(0, topK), negative: pairs.slice(-topK).reverse().slice(0, topK) };
}

export function renderLinkage(ctx) {
  const { job, date, summarized, agentResult, marketHistory } = ctx;
  const path = outputPath(job, date);
  const tags = job.tags || ['金融', '联动'];
  const description = (job.description || '联动观察：{date}').replace('{date}', date.str);
  const title = `联动观察：${date.str}`;

  const commentary = agentResult?.content || '';
  const commentaryLines = commentary.split('\n').map((l) => l.trim()).filter(Boolean);

  const fm = ['---',
    `title: ${yamlStr(title)}`,
    `date: ${date.iso}`,
    `description: ${yamlStr(description)}`,
    `tags: [${tags.map((t) => yamlStr(t)).join(', ')}]`,
  ];
  if (commentaryLines.length) {
    fm.push('tldr:');
    fm.push(`  - ${yamlStr(commentaryLines[0])}`);
  } else { fm.push('tldr: []'); }
  fm.push('---');

  const body = [];

  if (commentary) {
    body.push('## 联动点评\n');
    body.push(commentary);
    body.push('');
  }

  const history = marketHistory || { days: {} };
  const dates = Object.keys(history.days).sort();
  if (dates.length >= 3) {
    const { positive, negative } = computeTopPairs(history, 7, 3);
    if (positive.length || negative.length) {
      body.push('## 强相关品种对\n');
      body.push('| 品种 A | 品种 B | 相关系数 | 解读 |');
      body.push('|-------|-------|---------|------|');
      for (const p of positive) body.push(`| ${p.a} | ${p.b} | ${p.r > 0 ? '+' : ''}${p.r} | ${p.r > 0.6 ? '强正相关' : '弱正相关'} |`);
      for (const p of negative) body.push(`| ${p.a} | ${p.b} | ${p.r} | ${p.r < -0.6 ? '强负相关' : '弱负相关'} |`);
      body.push('');
      let idx = 0;
      if (positive[0]) { const ch = renderPairChart(history, positive[0].a, positive[0].b, date.str, idx++); if (ch) { body.push(ch); body.push(''); } }
      if (negative[0]) { const ch = renderPairChart(history, negative[0].a, negative[0].b, date.str, idx++); if (ch) { body.push(ch); body.push(''); } }
    }
  } else {
    body.push('## 强相关品种对\n*历史不足 3 天，联动分析暂不可用。*\n');
  }

  const content = fm.join('\n') + '\n\n' + body.join('\n').trimEnd() + '\n';
  return { path, content, processed: collectProcessed(summarized) };
}
