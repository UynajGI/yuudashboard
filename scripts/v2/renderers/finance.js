// Renderer: 市场概览（finance job）。
// 迁移自 src/render-finance.js，用 helpers 消除重复。

import {
  yamlStr, jsonSafe, fmtNum, fmtChange, changeClass,
  renderQuoteChange, renderNewsItem, renderBarChart, renderSparkline,
  findQuote, collectProcessed,
} from './helpers.js';

const ASSET_MATCHERS = [
  { key: 'gold', keywords: ['黄金', '金价', '金银', '贵金属', 'XAU', '金矿'] },
  { key: 'oil', keywords: ['原油', '石油', '油价', 'WTI', '布伦特', 'Brent', 'OPEC', '欧佩克', '产油'] },
  { key: 'bonds', keywords: ['美债', '10年期', '国债收益率', '债市', 'Treasury', 'yield'] },
  { key: 'usd', keywords: ['美元指数', '美元走', '汇率', 'DXY', 'USD', 'JPY', '外汇', '人民币', 'CNY', '在岸', '离岸', '非农', '日元'] },
  { key: 'btc', keywords: ['BTC', '比特币', 'crypto', '加密货币', '以太坊', 'ETH'] },
];

function classifyNews(item) {
  const text = (item.title + ' ' + (item.summary || '')).toLowerCase();
  for (const { key, keywords } of ASSET_MATCHERS) {
    if (keywords.some((kw) => text.includes(kw.toLowerCase()))) return key;
  }
  return null;
}

export function renderFinance(ctx) {
  const { job, date, marketData, summarized, tldr, marketHistory } = ctx;
  const path = job.output.replace('{date}', date.str);
  const md = marketData || { indices: [], assets: [], btc: null, usTreasury: null, kospi: null };

  // KOSPI 合入指数列表
  const indices = [...(md.indices || [])];
  if (md.kospi) indices.push(md.kospi);

  const tags = job.tags || ['金融'];
  const description = (job.description || '市场概览：{date}').replace('{date}', date.str);
  const title = `市场概览：${date.str}`;

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

  // 新闻分类
  const allNews = summarized['要闻'] || [];
  const assetNews = { gold: [], oil: [], bonds: [], usd: [], btc: [] };
  const generalNews = [];
  for (const item of allNews) {
    const tag = classifyNews(item);
    if (tag && assetNews[tag]) assetNews[tag].push(item);
    else generalNews.push(item);
  }

  // 资产数据索引
  const assetData = {};
  for (const a of md.assets || []) assetData[a.key] = a;
  if (md.btc) assetData.btc = md.btc;
  if (md.usTreasury) assetData.bonds = md.usTreasury;

  const body = [];

  // 1. 指数表 + Bar 图
  if (indices.length) {
    body.push('## 指数\n');
    const marketLine = tldr.find((t) => t.startsWith('市场：')) || tldr[0] || '';
    if (marketLine) body.push(`> ${marketLine.replace(/^市场：/, '')}\n`);
    body.push('| 指数 | 收盘 | 涨跌幅 |');
    body.push('|------|------|--------|');
    for (const ix of indices) {
      body.push(`| ${ix.name} | ${fmtNum(ix.price, 2)} | ${renderQuoteChange(ix)} |`);
    }
    body.push('');
    const barChart = renderBarChart(
      indices.map((i) => i.name),
      indices.map((i) => Number((i.changePct || 0).toFixed(2))),
      date.str, 'idx-bar', '当日涨跌幅 (%)',
    );
    if (barChart) { body.push(barChart); body.push(''); }
  }

  // 2. 核心资产
  const assetOrder = [
    { key: 'gold', label: '黄金' },
    { key: 'oil', label: 'WTI 原油' },
    { key: 'bonds', label: '美债 10Y' },
    { key: 'usd', label: '美元指数' },
    { key: 'btc', label: 'BTC' },
  ];
  for (const { key, label } of assetOrder) {
    const data = assetData[key];
    const news = assetNews[key] || [];
    if (!data && news.length === 0) continue;

    if (data) {
      const unit = key === 'gold' || key === 'oil' || key === 'btc' ? '$' : '';
      const suffix = key === 'gold' ? '/oz' : '';
      const priceStr = unit + fmtNum(data.price, key === 'btc' ? 0 : 2) + suffix;
      body.push(`## ${label}  ${priceStr}  ${renderQuoteChange(data)}`);
    } else {
      body.push(`## ${label}  —`);
    }
    body.push('');

    if (data) {
      const spark = renderSparkline(marketHistory, data.name, key, date.str);
      if (spark) { body.push(spark); body.push(''); }
    }
    for (const item of news.slice(0, 3)) body.push(renderNewsItem(item));
    if (news.length > 3) body.push(`- *…共 ${news.length} 条相关要闻*`);
    body.push('');
  }

  // 3. 独立金融要闻
  if (generalNews.length) {
    body.push('## 金融要闻\n');
    for (const item of generalNews) body.push(renderNewsItem(item));
    body.push('');
  }

  const content = fm.join('\n') + '\n\n' + body.join('\n').trimEnd() + '\n';
  return { path, content, processed: collectProcessed(summarized) };
}
