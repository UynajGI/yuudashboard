// 渲染辅助函数：所有 renderer 共享，消除重复定义。
// 迁移并合并自 src/render.js / render-finance.js / render-sectors.js 等的重复代码。

import { readdirSync, statSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { getSeries } from '../core/series.js';

// ── 文件查找 ─────────────────────────────────────────────

/**
 * 找某 section 当天某 slug 的实际输出文件。
 * 命名规则可能含时间戳（{date}-{stamp}-{slug}.md），这里用 glob 兜底，
 * 支持新旧两种命名：{date}-{slug}.md（旧）和 {date}-*-{slug}.md（新，带 stamp）。
 * 多个匹配取修改时间最新的（同日重跑的最后一次）。
 * @param {string} repoRoot
 * @param {string} section  news / finance
 * @param {string} dateStr  YYYY-MM-DD
 * @param {string} slug     domestic / tech / ashare ...
 * @returns {string|null}  绝对路径，找不到返回 null
 */
export function findColumnFile(repoRoot, section, dateStr, slug) {
  const dir = resolve(repoRoot, 'content', section);
  let files = [];
  try {
    files = readdirSync(dir).filter((f) =>
      f.startsWith(`${dateStr}-`) && f.endsWith(`-${slug}.md`));
  } catch { return null; }
  if (!files.length) {
    // 兼容旧命名 {date}-{slug}.md（无 stamp）
    const legacy = resolve(dir, `${dateStr}-${slug}.md`);
    return existsSync(legacy) ? legacy : null;
  }
  if (files.length === 1) return resolve(dir, files[0]);
  // 多个：取 mtime 最新
  files.sort((a, b) => statSync(resolve(dir, b)).mtimeMs - statSync(resolve(dir, a)).mtimeMs);
  return resolve(dir, files[0]);
}

// ── 文本格式化 ──────────────────────────────────────────

/**
 * 把 job.output 模板替换成实际路径。
 * 占位符：{date}=YYYY-MM-DD，{stamp}=HHMMSS（同日重跑防撞），{slug}=job.slug，{target}=焦点品种。
 * @param {object} job
 * @param {{str:string, stamp?:string}} date
 * @param {string} [target]
 */
export function outputPath(job, date, target) {
  return job.output
    .replace('{date}', date.str)
    .replace('{stamp}', date.stamp || '')
    .replace('{slug}', job.slug || '')
    .replace('{target}', target || '');
}

/** YAML 安全字符串 */
export function yamlStr(s) {
  s = String(s);
  if (/[:#\[\]{}&!*|>'"%@`,"\n]/.test(s) || /^\s|\s$/.test(s)) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

/** JSON 安全转义（供 <script> 内联） */
export function jsonSafe(v) {
  return JSON.stringify(v).replace(/</g, '\\u003c');
}

// ── 数字/涨跌格式化 ──────────────────────────────────────

export function fmtNum(n, decimals = 2) {
  if (!isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export function fmtChange(n, decimals = 2) {
  if (!isFinite(n)) return '—';
  return (n > 0 ? '+' : '') + n.toFixed(decimals) + '%';
}

export function changeClass(n) {
  if (!isFinite(n)) return '';
  return n > 0 ? 'up' : n < 0 ? 'down' : '';
}

/** 给 Quote 生成 priceStr（带单位/后缀） */
export function quotePriceStr(q, { unit = '', decimals = 2, suffix = '' } = {}) {
  return (unit || '') + fmtNum(q.price, decimals) + (suffix || '');
}

/** 给 Quote 生成 changeStr */
export function quoteChangeStr(q) {
  return fmtChange(q.changePct, 2);
}

/** 涨跌 HTML（带 span class） */
export function renderChangeHtml(changeStr, changeCls) {
  if (!changeCls) return changeStr;
  return `<span class="${changeCls}">${changeStr}</span>`;
}

/** 从 Quote 渲染涨跌 HTML */
export function renderQuoteChange(q) {
  return renderChangeHtml(quoteChangeStr(q), changeClass(q.changePct));
}

// ── 新闻渲染 ────────────────────────────────────────────

export function renderNewsItem(it) {
  const sources = it.sources?.length ? `（${it.sources.join('、')}）` : '';
  const title = it.link ? `[**${it.title}**](${it.link})` : `**${it.title}**`;
  return `- ${title}：${it.summary}${sources}`;
}

// ── 数据查找 ────────────────────────────────────────────

/** 从 marketData 按品种名找 Quote */
export function findQuote(marketData, name) {
  const all = [
    ...(marketData?.indices || []),
    ...(marketData?.assets || []),
    ...(marketData?.btc ? [marketData.btc] : []),
    ...(marketData?.usTreasury ? [marketData.usTreasury] : []),
    ...(marketData?.kospi ? [marketData.kospi] : []),
  ];
  return all.find((x) => x.name === name);
}

/** 板块平均涨跌幅 */
export function sectorAvg(marketData, names) {
  const vals = names.map((n) => findQuote(marketData, n)).filter(Boolean).map((q) => q.changePct);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// ── state 收集 ──────────────────────────────────────────

/** 收集 summarized 里所有 _rawItems（供 store.saveSeen 写 hash） */
export function collectProcessed(summarized) {
  const out = [];
  for (const items of Object.values(summarized || {})) {
    for (const it of items) if (it._rawItems) out.push(...it._rawItems);
  }
  return out;
}

// ── chart.xkcd 图表 ──────────────────────────────────────

/** 指数/板块涨跌幅柱状图 */
export function renderBarChart(labels, data, dateStr, idPrefix, title, maxColors) {
  const valid = data.filter((d) => isFinite(d));
  if (valid.length < 2) return '';
  const id = `${idPrefix}-${dateStr}`;
  const cfg = {
    title,
    data: { labels, datasets: [{ data }] },
    options: {
      yTickCount: 5,
      dataColors: data.map((d) => (d >= 0 ? '#20bf6b' : '#eb3b5a')),
    },
  };
  return [
    `<svg class="xkcd-chart" id="${id}" style="width:100%;max-width:680px;display:block;margin:8px auto 4px"></svg>`,
    '<script>',
    `(function(){var c=document.getElementById("${id}");if(!c||!window.chartXkcd)return;`,
    `new chartXkcd.Bar(c,${jsonSafe(cfg)});})();`,
    '</script>',
  ].join('');
}

/** 资产走势 sparkline（依赖 market-history ≥3 天） */
export function renderSparkline(history, name, idKey, dateStr) {
  if (!history?.days) return '';
  const dates = Object.keys(history.days).sort();
  if (dates.length < 3) return '';
  const recent = dates.slice(-7);
  const points = [];
  for (const d of recent) {
    const item = history.days[d]?.[name];
    if (item && isFinite(item.close)) points.push(item.close);
  }
  if (points.length < 3) return '';
  const id = `spark-${idKey}-${dateStr}`;
  const cfg = {
    data: {
      labels: recent.map((d) => d.slice(5)),
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

/** 双品种归一化对比折线图（联动报告用） */
export function renderPairChart(history, a, b, dateStr, idx) {
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

// ── 板块定义（与 tools/market.js 共用）──────────────────

export const SECTORS = {
  A股: ['上证综指', '深证成指', '创业板指', '科创50'],
  港股: ['恒生指数', '恒生科技'],
  美股: ['道琼斯', '纳斯达克', '标普500'],
  亚太: ['日经 225', '韩国 KOSPI'],
  商品: ['黄金', 'WTI 原油', '美元指数'],
  加密: ['BTC'],
};
