// Renderer: 金融单市场专栏（A股/港股/美股/商品/加密）。
// 每个市场专栏：该市场指数表 + Bar 图 + 新闻（LLM select 后的，带 sub 分组）。
// 对 A 股额外渲染申万行业 + 北向资金。

import {
  yamlStr, fmtNum, renderQuoteChange, renderBarChart,
  renderNewsItem, collectProcessed, outputPath,
} from './helpers.js';

export function renderFinanceColumn(ctx) {
  const { job, date, marketData, summarized, tldr } = ctx;
  const path = outputPath(job, date);
  const md = marketData || { indices: [], assets: [] };
  const tags = job.tags || ['金融'];
  const description = (job.description || '金融专栏 {date}').replace('{date}', date.str);
  const title = description;

  // frontmatter
  const fm = ['---',
    `title: ${yamlStr(title)}`,
    `date: ${date.iso}`,
    `description: ${yamlStr(description)}`,
    `tags: [${tags.map((t) => yamlStr(t)).join(', ')}]`,
  ];
  if (tldr.length) {
    fm.push('tldr:');
    for (const t of tldr) fm.push(`  - ${yamlStr(t)}`);
  } else { fm.push('tldr: []'); }
  fm.push('---');

  const body = [];

  // 1. 指数表
  const indices = [...(md.indices || []), ...(md.kospi ? [md.kospi] : [])];
  if (indices.length) {
    body.push('## 指数\n');
    body.push('| 指数 | 收盘 | 涨跌幅 |');
    body.push('|------|------|--------|');
    for (const ix of indices) {
      body.push(`| ${ix.name} | ${fmtNum(ix.price, 2)} | ${renderQuoteChange(ix)} |`);
    }
    body.push('');
    const bar = renderBarChart(
      indices.map((i) => i.name),
      indices.map((i) => Number((i.changePct || 0).toFixed(2))),
      date.str, `col-${job.slug}`, '当日涨跌幅 (%)',
    );
    if (bar) { body.push(bar); body.push(''); }
  }

  // 2. 资产（商品专栏用）
  const assets = md.assets || [];
  if (assets.length) {
    body.push('## 资产\n');
    body.push('| 品种 | 价格 | 涨跌幅 |');
    body.push('|------|------|--------|');
    for (const a of assets) {
      body.push(`| ${a.name} | ${fmtNum(a.price, 2)} | ${renderQuoteChange(a)} |`);
    }
    body.push('');
  }

  // 3. 额外品种（BTC/美债）
  const extra = [];
  if (md.btc) extra.push(md.btc);
  if (md.usTreasury) extra.push(md.usTreasury);
  if (extra.length) {
    body.push('## 其他品种\n');
    body.push('| 品种 | 价格 | 涨跌幅 |');
    body.push('|------|------|--------|');
    for (const q of extra) {
      body.push(`| ${q.name} | ${fmtNum(q.price, q.name === 'BTC' ? 0 : 2)} | ${renderQuoteChange(q)} |`);
    }
    body.push('');
  }

  // 4. A 股专栏：申万行业 + 北向资金
  if (md.tushare) {
    if (md.tushare.swSectors?.length) {
      body.push('## 申万行业\n');
      body.push('| 行业 | 收盘 | 涨跌幅 |');
      body.push('|------|------|--------|');
      for (const q of [...md.tushare.swSectors].sort((a, b) => (b.changePct || 0) - (a.changePct || 0))) {
        body.push(`| ${q.name} | ${fmtNum(q.price, 2)} | ${renderQuoteChange(q)} |`);
      }
      body.push('');
    }
    if (md.tushare.northFlow) {
      const nf = md.tushare.northFlow;
      const net = (nf.northMoney || 0) + (nf.southMoney || 0);
      body.push(`**北向资金**：${net > 0 ? '+' : ''}${(net / 10000).toFixed(2)} 亿元\n`);
    }
  }

  // 5. 新闻（按 sub 分组，同 news renderer 逻辑）
  const cat = ctx.job.categories?.[0] || '要闻';
  const items = summarized[cat] || [];
  if (items.length) {
    const bySub = {};
    const noSub = [];
    for (const item of items) {
      const sub = item.sub || '';
      if (sub) { if (!bySub[sub]) bySub[sub] = []; bySub[sub].push(item); }
      else noSub.push(item);
    }
    for (const sub of Object.keys(bySub).sort()) {
      body.push(`### ${sub}\n`);
      for (const item of bySub[sub]) body.push(renderNewsItem(item));
      body.push('');
    }
    if (noSub.length) {
      body.push(`### 其他\n`);
      for (const item of noSub) body.push(renderNewsItem(item));
      body.push('');
    }
  }

  const content = fm.join('\n') + '\n\n' + body.join('\n').trimEnd() + '\n';
  return { path, content, processed: collectProcessed(summarized) };
}
