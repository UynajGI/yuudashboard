// 渲染：金融管线产物 → Hugo markdown（资产中心结构）。
// 正文：## 指数（纯数据 + LLM 判断）→ ## 黄金（价格 + 匹配要闻）→ ... → ## 金融要闻（未匹配）
// 市场数据来自 ctx.marketData（fetch stage），新闻来自 ctx.summarized（summarize stage）。

/** YAML 安全字符串 */
export function yamlStr(s) {
  s = String(s);
  if (/[:#\[\]{}&!*|>'"%@`,"\n]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

/** 收集已处理条目（供 state 写 hash） */
function collectProcessed(ctx) {
  const out = [];
  for (const items of Object.values(ctx.summarized)) {
    for (const it of items) if (it._rawItems) out.push(...it._rawItems);
  }
  return out;
}

// ── 新闻分类（关键词匹配，纯 JS）──────────────────────

const ASSET_MATCHERS = [
  { key: 'gold',  keywords: ['黄金', '金价', '金银', '贵金属', 'XAU', '金矿'] },
  { key: 'oil',   keywords: ['原油', '石油', '油价', 'WTI', '布伦特', 'Brent', 'OPEC', '欧佩克', '产油'] },
  { key: 'bonds', keywords: ['美债', '10年期', '国债收益率', '债市', 'Treasury', 'yield'] },
  { key: 'usd',   keywords: ['美元指数', '美元走', '汇率', 'DXY', 'USD', 'JPY', '外汇', '人民币', 'CNY', '在岸', '离岸', '非农', '日元'] },
  { key: 'btc',   keywords: ['BTC', '比特币', 'crypto', '加密货币', '以太坊', 'ETH'] },
];

/** 给一条新闻打资产标签，未匹配返回 null */
function classifyNews(item) {
  const text = (item.title + ' ' + (item.summary || '')).toLowerCase();
  for (const { key, keywords } of ASSET_MATCHERS) {
    if (keywords.some((kw) => text.includes(kw.toLowerCase()))) return key;
  }
  return null; // unmatched → 独立要闻
}

// ── 渲染辅助 ──────────────────────────────────────────

export function renderChangeHtml(it) {
  if (!it.changeClass) return it.changeStr;
  return `<span class="${it.changeClass}">${it.changeStr}</span>`;
}

export function renderNewsItem(it) {
  const sources = it.sources?.length ? `（${it.sources.join('、')}）` : '';
  const title = it.link ? `[**${it.title}**](${it.link})` : `**${it.title}**`;
  return `- ${title}：${it.summary}${sources}`;
}

/** JSON 安全转义（供 <script> 内联）—— 供其他 renderer 复用 */
export function jsonSafe(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c');
}

// ── chart.xkcd 图表注入（raw HTML/JS 内联进 markdown，依赖 hugo unsafe=true）──

/**
 * 指数涨跌幅柱状图：所有指数一字排开，正负柱区分涨跌。
 * @param {Array} indices  [{ name, changePct }, ...]
 * @param {string} dateStr 用于生成唯一 svg id
 * @returns {string} markdown 行（svg + script，空数组返回 ''）
 */
function renderIndexBarChart(indices, dateStr) {
  const valid = indices.filter((ix) => isFinite(ix.changePct));
  if (valid.length < 2) return ''; // 太少不画
  const id = `idx-bar-${dateStr}`;
  const labels = valid.map((ix) => ix.name);
  const data = valid.map((ix) => Number((ix.changePct || 0).toFixed(2)));
  const cfg = {
    title: '当日涨跌幅 (%)',
    data: { labels, datasets: [{ data }] },
    options: { yTickCount: 5, dataColors: data.map((d) => (d >= 0 ? '#20bf6b' : '#eb3b5a')) },
  };
  return [
    `<svg class="xkcd-chart" id="${id}" style="width:100%;max-width:680px;display:block;margin:8px auto 4px"></svg>`,
    '<script>',
    `(function(){var c=document.getElementById("${id}");if(!c||!window.chartXkcd)return;`,
    `new chartXkcd.Bar(c,${jsonSafe(cfg)});})();`,
    '</script>',
  ].join('');
}

/**
 * 资产走势 sparkline：取该品种在 market-history 最近 N 天的 close 序列画折线。
 * @param {object} history   ctx.marketHistory（{ days: {...} }）
 * @param {string} name      品种名（与 history 里的 key 对齐，如 "黄金"）
 * @param {string} idKey     用于 svg id 的安全标识（如 "gold"，避免中文）
 * @param {string} dateStr   用于生成唯一 svg id
 * @returns {string} markdown 行（点 < 3 返回 ''）
 */
export function renderAssetSparkline(history, name, idKey, dateStr) {
  if (!history?.days) return '';
  const dates = Object.keys(history.days).sort();
  if (dates.length < 3) return ''; // 冷启动期不画
  const recent = dates.slice(-7);
  const points = [];
  for (const d of recent) {
    const item = history.days[d]?.[name];
    if (item && isFinite(item.close)) points.push(item.close);
  }
  if (points.length < 3) return ''; // 有效点不足
  const id = `spark-${idKey}-${dateStr}`;
  const cfg = {
    data: {
      labels: recent.map((d) => d.slice(5)), // MM-DD
      datasets: [{ label: name, data: points }],
    },
    options: { yTickCount: 3, dotSize: 0.6, showLine: true, dataColors: ['#4facfe'] },
  };
  return [
    `<svg class="xkcd-chart xkcd-spark" id="${id}" style="width:100%;max-width:480px;display:block;margin:4px auto"></svg>`,
    '<script>',
    `(function(){var c=document.getElementById("${id}");if(!c||!window.chartXkcd)return;`,
    `new chartXkcd.Line(c,${jsonSafe(cfg)});})();`,
    '</script>',
  ].join('');
}

/** 紧凑指数表格：一行多列 */
function renderIndexRow(ix) {
  const ch = renderChangeHtml(ix);
  return `| ${ix.name} | ${ix.priceStr} | ${ch} |`;
}

// ── 主渲染 ────────────────────────────────────────────

/**
 * @param {object} ctx
 * @returns {{ path: string, content: string, processed: Array }}
 */
export function renderFinance(ctx) {
  const { job, date, marketData, summarized, tldr, marketHistory } = ctx;
  const path = job.output.replace('{date}', date.str);
  const md = marketData || { indices: [], assets: [], btc: null, usTreasury: null, kospi: null };

  // 把 KOSPI 合入指数列表（统一进表格 + 柱状图）
  const indices = [...md.indices];
  if (md.kospi) indices.push(md.kospi);

  const title = `市场概览：${date.str}`;
  const description = (job.description || '市场概览：{date}').replace('{date}', date.str);
  const tags = job.tags || ['金融'];

  // ── frontmatter ──
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

  // ── 新闻分类 ──
  const allNews = summarized['要闻'] || [];
  const assetNews = { gold: [], oil: [], bonds: [], usd: [], btc: [] };
  const generalNews = [];
  for (const item of allNews) {
    const tag = classifyNews(item);
    if (tag && assetNews[tag]) {
      assetNews[tag].push(item);
    } else {
      generalNews.push(item);
    }
  }

  // ── 资产数据索引（按 key 快速查找）──
  const assetData = {};
  for (const a of md.assets) assetData[a.key] = a;
  if (md.btc) assetData.btc = md.btc;
  if (md.usTreasury) assetData.bonds = md.usTreasury;

  // ── 正文 ──
  const body = [];

  // 1. 指数（表格 + chart.xkcd 当日涨跌幅柱状图，不要新闻）
  if (indices.length) {
    body.push('## 指数\n');
    const marketLine = tldr.find((t) => t.startsWith('市场：')) || tldr[0] || '';
    if (marketLine) body.push(`> ${marketLine.replace(/^市场：/, '')}\n`);
    body.push('| 指数 | 收盘 | 涨跌幅 |');
    body.push('|------|------|--------|');
    for (const ix of indices) body.push(renderIndexRow(ix));
    body.push('');
    const barChart = renderIndexBarChart(indices, date.str);
    if (barChart) {
      body.push(barChart);
      body.push('');
    }
  }

  // 2. 核心资产：价格 + 匹配新闻
  const assetOrder = [
    { key: 'gold',  label: '黄金',       name: '黄金' },
    { key: 'oil',   label: 'WTI 原油',   name: 'WTI 原油' },
    { key: 'bonds', label: '美债 10Y',   name: '美债 10Y' },
    { key: 'usd',   label: '美元指数',   name: '美元指数' },
    { key: 'btc',   label: 'BTC',        name: 'BTC' },
  ];

  for (const { key, label, name } of assetOrder) {
    const data = assetData[key];
    const news = assetNews[key] || [];

    if (!data && news.length === 0) continue; // 都没数据就跳过

    if (data) {
      body.push(`## ${label}  ${data.priceStr}  ${renderChangeHtml(data)}`);
    } else {
      body.push(`## ${label}  —`);
    }
    body.push('');

    // 走势 sparkline（依赖 market-history 累积 ≥3 天）
    if (data) {
      const spark = renderAssetSparkline(marketHistory, name, key, date.str);
      if (spark) {
        body.push(spark);
        body.push('');
      }
    }

    for (const item of news.slice(0, 3)) body.push(renderNewsItem(item));
    if (news.length > 3) body.push(`- *…共 ${news.length} 条相关要闻*`);
    body.push('');
  }

  // 3. 独立金融要闻（未匹配任何资产的通用新闻）
  if (generalNews.length) {
    body.push('## 金融要闻\n');
    for (const item of generalNews) body.push(renderNewsItem(item));
    body.push('');
  }

  const content = fm.join('\n') + '\n\n' + body.join('\n').trimEnd() + '\n';
  return { path, content, processed: collectProcessed(ctx) };
}
