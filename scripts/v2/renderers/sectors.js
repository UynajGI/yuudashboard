// Renderer: 板块扫描（sectors job）。
// 迁移自 src/render-sectors.js，用 helpers 消除重复。

import {
  yamlStr, fmtNum, renderQuoteChange, renderBarChart,
  renderNewsItem, sectorAvg, collectProcessed, SECTORS,
} from './helpers.js';

export function renderSectors(ctx) {
  const { job, date, marketData, summarized, agentResult } = ctx;
  const path = job.output.replace('{date}', date.str);
  const md = marketData || { indices: [], assets: [] };
  const tags = job.tags || ['金融', '板块'];
  const description = (job.description || '板块扫描：{date}').replace('{date}', date.str);
  const title = `板块扫描：${date.str}`;

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
    body.push('## 板块点评\n');
    body.push(commentary);
    body.push('');
  }

  // 板块横向对比柱状图
  const sectorAvgs = Object.entries(SECTORS).map(([name, members]) => ({
    name, members, avg: sectorAvg(md, members),
  }));
  const validAvgs = sectorAvgs.filter((s) => s.avg != null);
  if (validAvgs.length >= 2) {
    body.push('## 板块对比\n');
    body.push(renderBarChart(
      validAvgs.map((s) => s.name),
      validAvgs.map((s) => Number(s.avg.toFixed(2))),
      date.str, 'sector-bar', '板块平均涨跌幅 (%)',
    ));
    body.push('');
  }

  // 各板块明细
  body.push('## 板块明细\n');
  for (const { name, members, avg } of sectorAvgs) {
    const items = members.map((n) => md.indices?.find((i) => i.name === n) || md.assets?.find((a) => a.name === n) || (md.btc?.name === n ? md.btc : null) || (md.kospi?.name === n ? md.kospi : null)).filter(Boolean);
    if (!items.length) continue;
    const avgStr = avg != null ? `${avg > 0 ? '+' : ''}${avg.toFixed(2)}%` : '—';
    const avgCls = avg > 0 ? 'up' : avg < 0 ? 'down' : '';
    const avgHtml = avgCls ? `<span class="${avgCls}">${avgStr}</span>` : avgStr;
    body.push(`### ${name}  均 ${avgHtml}\n`);
    body.push('| 品种 | 收盘 | 涨跌幅 |');
    body.push('|------|------|--------|');
    for (const it of items) {
      body.push(`| ${it.name} | ${fmtNum(it.price, 2)} | ${renderQuoteChange(it)} |`);
    }
    body.push('');
  }

  const content = fm.join('\n') + '\n\n' + body.join('\n').trimEnd() + '\n';
  return { path, content, processed: collectProcessed(summarized) };
}
