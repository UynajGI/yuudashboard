// Renderer: 联动观察（D）。
// 跨资产联动视角：找高相关品种对 + 解释联动逻辑 + 双线对比图。
// agent 用 find_correlations 找 top 配对，再查新闻解释因果。
//
// 数据：agent 结果（联动点评）+ find_correlations 的 trace（top 配对）+ market-history（双线图）。

import { yamlStr, jsonSafe } from './render-finance.js';
import { getSeries } from './market-history.js';

/** Pearson 相关系数（与 stats.js 一致，用于本地重算 top 配对） */
function pearson(x, y) {
  const n = x.length;
  const sx = x.reduce((a, b) => a + b, 0) / n;
  const sy = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - sx) * (y[i] - sy);
    dx += (x[i] - sx) ** 2;
    dy += (y[i] - sy) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

/** 本地重算 top 配对（不依赖 agent trace，避免 preview 截断问题） */
function computeTopPairs(history, days = 7, topK = 4) {
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
        if (sa.closes[k] != null && sb.closes[k] != null) {
          xs.push(sa.closes[k]);
          ys.push(sb.closes[k]);
        }
      }
      if (xs.length < 3) continue;
      const r = pearson(xs, ys);
      if (isFinite(r)) pairs.push({ a: names[i], b: names[j], r: Number(r.toFixed(3)) });
    }
  }
  pairs.sort((x, y) => y.r - x.r);
  return { positive: pairs.slice(0, topK), negative: pairs.slice(-topK).reverse().slice(0, topK) };
}

/** 双品种归一化对比折线图（两品种相对首日涨跌%，便于跨量级对比） */
function renderPairChart(history, a, b, dateStr, idx) {
  const sa = getSeries(history, a, 7);
  const sb = getSeries(history, b, 7);
  const labels = [];
  const dataA = [];
  const dataB = [];
  for (let k = 0; k < sa.dates.length; k++) {
    if (sa.closes[k] != null && sb.closes[k] != null) {
      labels.push(sa.dates[k].slice(5));
      dataA.push(sa.closes[k]);
      dataB.push(sb.closes[k]);
    }
  }
  if (dataA.length < 3) return '';
  const firstA = dataA[0];
  const firstB = dataB[0];
  const id = `pair-${idx}-${dateStr}`;
  const cfg = {
    title: `${a} vs ${b}（归一化 %）`,
    data: {
      labels,
      datasets: [
        { label: a, data: dataA.map((c) => Number((((c - firstA) / firstA) * 100).toFixed(2))) },
        { label: b, data: dataB.map((c) => Number((((c - firstB) / firstB) * 100).toFixed(2))) },
      ],
    },
    options: { yTickCount: 4, dotSize: 0.5, showLine: true, dataColors: ['#4facfe', '#eb3b5a'] },
  };
  return [
    `<svg class="xkcd-chart" id="${id}" style="width:100%;max-width:560px;display:block;margin:8px auto"></svg>`,
    '<script>',
    `(function(){var c=document.getElementById("${id}");if(!c||!window.chartXkcd)return;`,
    `new chartXkcd.Line(c,${jsonSafe(cfg)});})();`,
    '</script>',
  ].join('');
}

/**
 * @param {object} ctx
 * @returns {{ path: string, content: string, processed: Array }}
 */
export function renderLinkage(ctx) {
  const { job, date, summarized, agentResult, marketHistory } = ctx;
  const path = job.output.replace('{date}', date.str);

  const title = `联动观察：${date.str}`;
  const description = (job.description || '联动观察：{date}').replace('{date}', date.str);
  const tags = job.tags || ['金融', '联动'];

  // ── frontmatter ──
  const fm = ['---',
    `title: ${yamlStr(title)}`,
    `date: ${date.iso}`,
    `description: ${yamlStr(description)}`,
    `tags: [${tags.map((t) => yamlStr(t)).join(', ')}]`,
  ];
  const commentary = agentResult?.content || '';
  const commentaryLines = commentary.split('\n').map((l) => l.trim()).filter(Boolean);
  if (commentaryLines.length) {
    fm.push('tldr:');
    for (const line of commentaryLines.slice(0, 4)) fm.push(`  - ${yamlStr(line)}`);
  } else {
    fm.push('tldr: []');
  }
  fm.push('---');

  // ── 正文 ──
  const body = [];

  // 1. agent 联动点评
  if (commentary) {
    body.push('## 联动点评\n');
    body.push(commentary);
    body.push('');
  }

  // 2. 强相关品种对（本地重算，不依赖 agent trace 避免截断）
  const history = marketHistory || { days: {} };
  const dates = Object.keys(history.days || {}).sort();
  if (dates.length >= 3) {
    const { positive, negative } = computeTopPairs(history, 7, 3);
    if (positive.length || negative.length) {
      body.push('## 强相关品种对\n');
      body.push('| 品种 A | 品种 B | 相关系数 | 解读 |');
      body.push('|-------|-------|---------|------|');
      for (const p of positive) {
        const interp = p.r > 0.6 ? '强正相关' : '弱正相关';
        body.push(`| ${p.a} | ${p.b} | ${p.r > 0 ? '+' : ''}${p.r} | ${interp} |`);
      }
      for (const p of negative) {
        const interp = p.r < -0.6 ? '强负相关' : '弱负相关';
        body.push(`| ${p.a} | ${p.b} | ${p.r} | ${interp} |`);
      }
      body.push('');

      // 对最强的 1 正 1 负配对画双线对比图
      const topPositive = positive[0];
      const topNegative = negative[0];
      let chartIdx = 0;
      if (topPositive) {
        const ch = renderPairChart(history, topPositive.a, topPositive.b, date.str, chartIdx++);
        if (ch) { body.push(ch); body.push(''); }
      }
      if (topNegative) {
        const ch = renderPairChart(history, topNegative.a, topNegative.b, date.str, chartIdx++);
        if (ch) { body.push(ch); body.push(''); }
      }
    }
  } else {
    body.push('## 强相关品种对\n');
    body.push('*历史不足 3 天，联动分析暂不可用。累积后自动出现。*\n');
  }

  const content = fm.join('\n') + '\n\n' + body.join('\n').trimEnd() + '\n';
  const processed = [];
  for (const items of Object.values(summarized || {})) {
    for (const it of items) if (it._rawItems) processed.push(...it._rawItems);
  }
  return { path, content, processed };
}
