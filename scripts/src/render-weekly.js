// Renderer: 周度市场回顾。
// 与 renderFinance（单日快照 + 当日柱状图）互补，本模板侧重近 7 天走势对比：
//   - 每个指数/资产画一条 7 日 sparkline，横向对比谁涨谁跌
//   - 汇总本周（最新日 vs 7 天前）累计涨跌
//   - 不重复金融要闻（那是日报的职责）
//
// 数据来源：ctx.marketHistory（由 fetch stage 写入）。
// 冷启动期（历史 <3 天）会优雅降级为表格 + 提示。

import { getSeries } from './market-history.js';

/** YAML 安全字符串（复刻 render-finance.js 的实现） */
function yamlStr(s) {
  s = String(s);
  if (/[:#\[\]{}&!*|>'"%@@`,"\n]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

function jsonSafe(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c');
}

/**
 * 取某品种本周累计涨跌（最新日 changePct 是相对前日，不是周累计；
 * 这里用 最新close / 7天前close - 1 近似周收益）。
 */
function weeklyReturn(history, name, days = 7) {
  const { closes } = getSeries(history, name, days);
  const valid = closes.filter((c) => c != null && isFinite(c));
  if (valid.length < 2) return null;
  const first = valid[0];
  const last = valid[valid.length - 1];
  if (!first) return null;
  return ((last - first) / first) * 100;
}

/** 画多品种 7 日走势对比折线图 */
function renderTrendChart(history, names, dateStr) {
  const series = [];
  const labels = [];
  let labelSet = false;
  for (const name of names) {
    const { dates, closes } = getSeries(history, name, 7);
    if (closes.filter((c) => c != null).length < 3) continue; // 点太少跳过
    if (!labelSet) { labels.push(...dates.map((d) => d.slice(5))); labelSet = true; }
    // 归一化为相对首日的涨跌百分比，让不同量级的品种可对比
    const first = closes.find((c) => c != null);
    const norm = closes.map((c) => (c != null && first ? Number((((c - first) / first) * 100).toFixed(2)) : null));
    series.push({ label: name, data: norm });
  }
  if (series.length < 2) return ''; // 至少 2 条线才画对比
  const id = `weekly-trend-${dateStr}`;
  const cfg = {
    title: '近 7 日走势（归一化 %）',
    data: { labels, datasets: series },
    options: { yTickCount: 4, dotSize: 0.5, showLine: true,
      dataColors: ['#20bf6b', '#eb3b5a', '#4facfe', '#fed330', '#af52de', '#26de81', '#fc5c65'] },
  };
  return [
    `<svg class="xkcd-chart" id="${id}" style="width:100%;max-width:760px;display:block;margin:8px auto"></svg>`,
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
export function renderWeekly(ctx) {
  const { job, date, marketHistory } = ctx;
  const history = marketHistory || { days: {} };
  const path = job.output.replace('{date}', date.str);

  const dates = Object.keys(history.days || {}).sort();
  const hasEnoughHistory = dates.length >= 3;

  // 收集所有品种名（取最新一天的快照 key 集合）
  const latestDay = dates[dates.length - 1];
  const snapshot = latestDay ? history.days[latestDay] || {} : {};
  const allNames = Object.keys(snapshot);

  // 趋势图只挑主要品种（避免 14 条线糊成一片）：4 大指数 + BTC + 黄金
  const TREND_PICKS = ['上证综指', '标普500', '道琼斯', '日经 225', 'BTC', '黄金'];
  const trendNames = TREND_PICKS.filter((n) => allNames.includes(n));

  const title = `周度回顾：${date.str}`;
  const description = (job.description || '周度市场回顾：{date}').replace('{date}', date.str);
  const tags = job.tags || ['金融', '周报'];

  // ── frontmatter ──
  const fm = ['---',
    `title: ${yamlStr(title)}`,
    `date: ${date.iso}`,
    `description: ${yamlStr(description)}`,
    `tags: [${tags.map((t) => yamlStr(t)).join(', ')}]`,
    'tldr: []',
    '---',
  ];

  // ── 正文 ──
  const body = [];
  body.push(`## 周度市场回顾\n`);
  body.push(`> 数据区间：${dates[0] || '—'} ~ ${dates[dates.length - 1] || '—'}（共 ${dates.length} 个交易日快照）\n`);

  if (!hasEnoughHistory) {
    body.push('*历史快照不足 3 天，走势图暂不可用。随着每日运行自动累积，下周起将显示完整周度走势。*\n');
  }

  // 走势对比图（只画主要品种，避免过于密集）
  if (hasEnoughHistory) {
    const trend = renderTrendChart(history, trendNames, date.str);
    if (trend) { body.push(trend); body.push(''); }
  }

  // 本周累计涨跌榜
  if (hasEnoughHistory && allNames.length) {
    body.push('## 本周累计涨跌\n');
    body.push('| 品种 | 周收益 |');
    body.push('|------|--------|');
    const ranked = allNames
      .map((name) => ({ name, ret: weeklyReturn(history, name, 7) }))
      .filter((x) => x.ret != null)
      .sort((a, b) => b.ret - a.ret);
    for (const { name, ret } of ranked) {
      const cls = ret > 0 ? 'up' : ret < 0 ? 'down' : '';
      const sign = ret > 0 ? '+' : '';
      const cell = cls ? `<span class="${cls}">${sign}${ret.toFixed(2)}%</span>` : `${ret.toFixed(2)}%`;
      body.push(`| ${name} | ${cell} |`);
    }
    body.push('');
  }

  const content = fm.join('\n') + '\n\n' + body.join('\n').trimEnd() + '\n';
  // 周报不处理新闻条目，processed 为空（不触发新闻去重）
  return { path, content, processed: [] };
}
