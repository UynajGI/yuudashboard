// Renderer: 金融汇总（finance-digest）。
// LLM 点评 + 全市场指数表 + 板块对比图 + 北向资金 + 申万行业。

import {
  yamlStr, fmtNum, renderQuoteChange, renderBarChart,
} from './helpers.js';

export function renderFinanceDigest(ctx) {
  const { job, date } = ctx;
  const path = job.output.replace('{date}', date.str);
  const digest = ctx.digestContent || [];
  const md = ctx.digestMarketData || { indices: [], assets: [] };

  const title = `金融市场汇总：${date.str}`;
  const description = (job.description || '金融市场汇总：{date}').replace('{date}', date.str);
  const tags = job.tags || ['金融', '汇总'];

  const fm = ['---',
    `title: ${yamlStr(title)}`,
    `date: ${date.iso}`,
    `description: ${yamlStr(description)}`,
    `tags: [${tags.map((t) => yamlStr(t)).join(', ')}]`,
  ];
  if (digest.length) {
    fm.push('tldr:');
    for (const item of digest) fm.push(`  - ${yamlStr(item)}`);
  } else { fm.push('tldr: []'); }
  fm.push('---');

  const body = [];

  // 1. LLM 综合点评
  if (digest.length) {
    body.push('## 今日金融汇总\n');
    for (const item of digest) body.push(`- ${item}`);
    body.push('');
  }

  // 2. 全市场指数表 + 对比图（数据平移）
  const allIndices = [...(md.indices || []), ...(md.kospi ? [md.kospi] : [])];
  if (allIndices.length) {
    body.push('## 全市场指数\n');
    body.push('| 指数 | 收盘 | 涨跌幅 |');
    body.push('|------|------|--------|');
    for (const ix of allIndices) {
      body.push(`| ${ix.name} | ${fmtNum(ix.price, 2)} | ${renderQuoteChange(ix)} |`);
    }
    body.push('');
    const bar = renderBarChart(
      allIndices.map((i) => i.name),
      allIndices.map((i) => Number((i.changePct || 0).toFixed(2))),
      date.str, 'digest-idx', '全市场涨跌幅 (%)',
    );
    if (bar) { body.push(bar); body.push(''); }
  }

  // 3. 核心资产
  const assets = md.assets || [];
  const extra = [assets.find((a) => a.key === 'gold'), assets.find((a) => a.key === 'oil'), assets.find((a) => a.key === 'usd'), md.btc, md.usT].filter(Boolean);
  if (extra.length) {
    body.push('## 核心资产\n');
    body.push('| 品种 | 价格 | 涨跌幅 |');
    body.push('|------|------|--------|');
    for (const q of extra) {
      body.push(`| ${q.name} | ${fmtNum(q.price, q.name === 'BTC' ? 0 : 2)} | ${renderQuoteChange(q)} |`);
    }
    body.push('');
  }

  // 4. 申万行业 + 北向资金
  if (md.tushare?.swSectors?.length) {
    body.push('## 申万行业（涨幅前 10）\n');
    body.push('| 行业 | 收盘 | 涨跌幅 |');
    body.push('|------|------|--------|');
    for (const q of [...md.tushare.swSectors].sort((a, b) => (b.changePct || 0) - (a.changePct || 0)).slice(0, 10)) {
      body.push(`| ${q.name} | ${fmtNum(q.price, 2)} | ${renderQuoteChange(q)} |`);
    }
    body.push('');
  }
  if (md.tushare?.northFlow) {
    const nf = md.tushare.northFlow;
    const net = (nf.northMoney || 0) + (nf.southMoney || 0);
    body.push(`**北向资金**：${net > 0 ? '+' : ''}${(net / 10000).toFixed(2)} 亿元\n`);
  }

  // 5. 跳转链接
  const cols = (job.columns || []).map((c) =>
    `[${c.name}](${c.file.replace('content/finance/', '').replace('{date}', date.str).replace('.md', '.html')})`
  );
  if (cols.length) {
    body.push(`> 详细分析见各专栏：${cols.join(' · ')}`);
  }

  const content = fm.join('\n') + '\n\n' + body.join('\n').trimEnd() + '\n';
  return { path, content, processed: [] };
}
