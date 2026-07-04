// Renderer: 资产聚焦（focus job）。
// 迁移自 src/render-focus.js，用 helpers 消除重复。

import {
  yamlStr, fmtNum, renderQuoteChange, renderSparkline,
  renderNewsItem, findQuote, collectProcessed, outputPath,
} from './helpers.js';

function filterNewsByKeyword(items, keyword) {
  if (!keyword) return items;
  const kw = keyword.toLowerCase();
  return items.filter((it) => (it.title + ' ' + (it.summary || '')).toLowerCase().includes(kw));
}

export function renderFocus(ctx) {
  const { job, date, marketData, summarized, agentResult, marketHistory } = ctx;
  const target = job.focus_target || 'BTC';
  const path = outputPath(job, date, target);
  const md = marketData || {};
  const data = findQuote(md, target);
  const tags = job.tags || ['金融', '资产聚焦'];
  const description = (job.description || '资产聚焦：{target} {date}').replace('{date}', date.str).replace('{target}', target);
  const title = `资产聚焦：${target} ${date.str}`;

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
    // tldr 只取首行作为关键结论，正文用完整分析（避免 tldr 和正文重复）
    fm.push(`  - ${yamlStr(commentaryLines[0])}`);
  } else { fm.push('tldr: []'); }
  fm.push('---');

  const body = [];

  if (data) {
    body.push(`## ${target}  ${fmtNum(data.price, target === 'BTC' ? 0 : 2)}  ${renderQuoteChange(data)}\n`);
  } else {
    body.push(`## ${target}  —\n*今日无该品种数据*\n`);
  }

  // 日内 OHLC
  if (data?.hasOHLC()) {
    const amp = data.low ? ((data.high - data.low) / data.low * 100) : 0;
    body.push(`**日内**：开 ${data.open} · 高 ${data.high} · 低 ${data.low}· 振幅 ${amp.toFixed(2)}%\n`);
  }

  // sparkline
  if (data) {
    const spark = renderSparkline(marketHistory, target, 'focus-' + target, date.str);
    if (spark) { body.push(spark); body.push(''); }
  }

  // agent 深度分析
  if (commentary) {
    body.push('## 深度分析\n');
    body.push(commentary);
    body.push('');
  }

  // 相关要闻
  const related = filterNewsByKeyword(summarized['要闻'] || [], target);
  if (related.length) {
    body.push('## 相关要闻\n');
    for (const item of related.slice(0, 5)) body.push(renderNewsItem(item));
    body.push('');
  }

  const content = fm.join('\n') + '\n\n' + body.join('\n').trimEnd() + '\n';
  return { path, content, processed: collectProcessed(summarized) };
}
