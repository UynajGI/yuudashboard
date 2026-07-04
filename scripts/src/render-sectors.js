// Renderer: 板块扫描（C）。
// 与 renderFinance（按品种平铺）互补，本模板按板块分组：
//   A股 / 港股 / 美股 / 亚太 / 商品 / 加密，每个板块一个 mini 面板。
// 顶部是 agent 生成的板块点评（ctx.agentResult），板块间是横向对比柱状图。
//
// 数据全部现成（ctx.marketData + ctx.summarized + ctx.agentResult）。

import { yamlStr, renderChangeHtml, jsonSafe } from './render-finance.js';
import { SECTORS } from './tools/market.js';

/** 从 marketData 按品种名找数据 */
function findByName(md, name) {
  const all = [
    ...(md?.indices || []),
    ...(md?.assets || []),
    ...(md?.btc ? [md.btc] : []),
    ...(md?.usTreasury ? [md.usTreasury] : []),
    ...(md?.kospi ? [md.kospi] : []),
  ];
  return all.find((x) => x.name === name);
}

/** 板块平均涨跌幅 */
function sectorAvg(md, names) {
  const vals = names.map((n) => findByName(md, n)).filter(Boolean).map((x) => x.changePct);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

/** 板块横向对比柱状图（各板块平均涨跌幅） */
function renderSectorBarChart(sectorAvgs, dateStr) {
  const valid = sectorAvgs.filter((s) => s.avg != null && isFinite(s.avg));
  if (valid.length < 2) return '';
  const id = `sector-bar-${dateStr}`;
  const cfg = {
    title: '板块平均涨跌幅 (%)',
    data: {
      labels: valid.map((s) => s.name),
      datasets: [{ data: valid.map((s) => Number(s.avg.toFixed(2))) }],
    },
    options: {
      yTickCount: 5,
      dataColors: valid.map((s) => (s.avg >= 0 ? '#20bf6b' : '#eb3b5a')),
    },
  };
  return [
    `<svg class="xkcd-chart" id="${id}" style="width:100%;max-width:560px;display:block;margin:8px auto"></svg>`,
    '<script>',
    `(function(){var c=document.getElementById("${id}");if(!c||!window.chartXkcd)return;`,
    `new chartXkcd.Bar(c,${jsonSafe(cfg)});})();`,
    '</script>',
  ].join('');
}

/**
 * @param {object} ctx
 * @returns {{ path: string, content: string, processed: Array }}
 */
export function renderSectors(ctx) {
  const { job, date, marketData, summarized, agentResult } = ctx;
  const path = job.output.replace('{date}', date.str);
  const md = marketData || { indices: [], assets: [] };

  const title = `板块扫描：${date.str}`;
  const description = (job.description || '板块扫描：{date}').replace('{date}', date.str);
  const tags = job.tags || ['金融', '板块'];

  // ── frontmatter ──
  const fm = ['---',
    `title: ${yamlStr(title)}`,
    `date: ${date.iso}`,
    `description: ${yamlStr(description)}`,
    `tags: [${tags.map((t) => yamlStr(t)).join(', ')}]`,
  ];

  // tldr：优先用 agent 生成的点评；没有就空
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

  // 1. agent 板块点评（完整版，tldr 只取前 4 行）
  if (commentary) {
    body.push('## 板块点评\n');
    body.push(commentary);
    body.push('');
  }

  // 2. 板块横向对比图
  const sectorAvgs = Object.entries(SECTORS).map(([name, members]) => ({
    name, members, avg: sectorAvg(md, members),
  }));
  const barChart = renderSectorBarChart(sectorAvgs, date.str);
  if (barChart) {
    body.push('## 板块对比\n');
    body.push(barChart);
    body.push('');
  }

  // 3. 各板块明细
  body.push('## 板块明细\n');
  for (const { name, members, avg } of sectorAvgs) {
    const items = members.map((n) => findByName(md, n)).filter(Boolean);
    if (!items.length) continue;
    const avgStr = avg != null ? `${avg > 0 ? '+' : ''}${avg.toFixed(2)}%` : '—';
    const avgCls = avg > 0 ? 'up' : avg < 0 ? 'down' : '';
    const avgHtml = avgCls ? `<span class="${avgCls}">${avgStr}</span>` : avgStr;
    body.push(`### ${name}  均 ${avgHtml}\n`);
    body.push('| 品种 | 收盘 | 涨跌幅 |');
    body.push('|------|------|--------|');
    for (const it of items) {
      const ch = renderChangeHtml(it);
      body.push(`| ${it.name} | ${it.priceStr} | ${ch} |`);
    }
    body.push('');
  }

  const content = fm.join('\n') + '\n\n' + body.join('\n').trimEnd() + '\n';
  // sectors 复用 finance 的新闻去重结果，processed 取自 summarize
  const processed = [];
  for (const items of Object.values(summarized || {})) {
    for (const it of items) if (it._rawItems) processed.push(...it._rawItems);
  }
  return { path, content, processed };
}
