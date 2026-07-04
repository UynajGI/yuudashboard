// Renderer: 资产聚焦（B）。
// 单品种深看：当前价 + 涨跌 + 走势 sparkline + agent 深度分析 + 相关要闻 + 日内 OHLC。
// 与 renderFinance（全品种平铺）互补，本模板只钻一个品种。
//
// 品种名由 job.focus_target 指定（jobs.yml），agent 生成深度分析（ctx.agentResult）。

import { yamlStr, renderChangeHtml, jsonSafe, renderAssetSparkline } from './render-finance.js';

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

/** 渲染单条新闻 */
function renderNewsItem(it) {
  const sources = it.sources?.length ? `（${it.sources.join('、')}）` : '';
  const title = it.link ? `[**${it.title}**](${it.link})` : `**${it.title}**`;
  return `- ${title}：${it.summary}${sources}`;
}

/** 按 keyword 过滤新闻（复用 assets 分类逻辑的简化版） */
function filterNewsByKeyword(items, keyword) {
  if (!keyword) return items;
  const kw = keyword.toLowerCase();
  return items.filter((it) => (it.title + ' ' + (it.summary || '')).toLowerCase().includes(kw));
}

/**
 * @param {object} ctx
 * @returns {{ path: string, content: string, processed: Array }}
 */
export function renderFocus(ctx) {
  const { job, date, marketData, summarized, agentResult, marketHistory } = ctx;
  const target = job.focus_target || 'BTC';
  // output 含 {target} 占位符，在此替换
  const path = job.output
    .replace('{date}', date.str)
    .replace('{target}', target);
  const md = marketData || {};
  const data = findByName(md, target);

  const title = `资产聚焦：${target} ${date.str}`;
  const description = (job.description || '资产聚焦：{target} {date}')
    .replace('{date}', date.str)
    .replace('{target}', target);
  const tags = job.tags || ['金融', '资产聚焦'];

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

  // 1. 标题行：品种 + 当前价 + 涨跌
  if (data) {
    body.push(`## ${target}  ${data.priceStr}  ${renderChangeHtml(data)}\n`);
  } else {
    body.push(`## ${target}  —\n`);
    body.push('*今日无该品种数据*\n');
  }

  // 2. 日内 OHLC（如果有）
  if (data && data.open != null && data.high != null && data.low != null) {
    body.push(`**日内**：开 ${data.open} · 高 ${data.high} · 低 ${data.low}`);
    const amplitude = data.low ? ((data.high - data.low) / data.low * 100) : 0;
    if (amplitude) body.push(`· 振幅 ${amplitude.toFixed(2)}%`);
    body.push('\n');
  }

  // 3. 走势 sparkline（依赖 market-history ≥3 天）
  if (data) {
    const spark = renderAssetSparkline(marketHistory, target, 'focus-' + target, date.str);
    if (spark) {
      body.push(spark);
      body.push('');
    }
  }

  // 4. agent 深度分析
  if (commentary) {
    body.push('## 深度分析\n');
    body.push(commentary);
    body.push('');
  }

  // 5. 相关要闻（按品种名关键词过滤）
  const allNews = summarized['要闻'] || [];
  const related = filterNewsByKeyword(allNews, target);
  if (related.length) {
    body.push('## 相关要闻\n');
    for (const item of related.slice(0, 5)) body.push(renderNewsItem(item));
    body.push('');
  }

  const content = fm.join('\n') + '\n\n' + body.join('\n').trimEnd() + '\n';
  // processed 取自 summarize（与 sectors 一致）
  const processed = [];
  for (const items of Object.values(summarized || {})) {
    for (const it of items) if (it._rawItems) processed.push(...it._rawItems);
  }
  return { path, content, processed };
}
