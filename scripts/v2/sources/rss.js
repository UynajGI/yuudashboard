// RSS 源适配器：HTTP 抓取 → XML 解析 → 归一化为 NewsItem[]。
// 迁移自 src/fetch.js，重构为 ItemSource 子类。
// 含聚合 RSS 拆分（splitAggregated，橘鸦日报用）和 HTML 清洗。

import { Agent, setGlobalDispatcher } from 'undici';
import { XMLParser } from 'fast-xml-parser';
import { ItemSource } from '../core/source.js';
import { NewsItem } from '../core/item.js';
import { windowToMs } from '../core/util.js';

// 强制 IPv4：DNS 返回 IPv6 优先时本机/CI 的 IPv6 出口不通 → ETIMEDOUT。
// node:dns 的 setDefaultResultOrder 对 undici 内部解析无效，必须用 dispatcher。
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

const FETCH_TIMEOUT = 20_000;

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  trimValues: true,
  // 禁用 XML 实体处理（防 billion laughs），保留原始 &xxx; 由 stripHtml 统一解码
  processEntities: false,
});

/**
 * RSS / Atom 源。
 * config（来自 feeds.yml）：{ name, url, category, window?, enabled? }
 */
export class RssSource extends ItemSource {
  constructor(config) {
    super(config);
    this.url = config.url;
    this.windowMs = config.window ? windowToMs(config.window) : null;
  }

  /** 抓取并解析 XML，返回 parsed 对象 */
  async fetch() {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    try {
      const res = await fetch(this.url, {
        signal: ctrl.signal,
        headers: { 'User-Agent': 'yuudashboard-feeds/0.1 (Hugo site aggregator)' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      // content:encoded 含大量嵌套 HTML 转义实体，会触发 parser 的实体扩展上限，先剥离
      const text = stripHeavyContent(await res.text());
      return xml.parse(text);
    } finally {
      clearTimeout(t);
    }
  }

  /** parsed → NewsItem[]（含聚合拆分 + per-source 时间窗过滤 + hard cap） */
  normalize(parsed) {
    const rawItems = extractItems(parsed);
    let items = rawItems
      .map((raw) => {
        const { title, link, summary, date } = normalizeItem(raw);
        return new NewsItem({ title, link, summary, fullSummary: summary, source: this.name, category: this.category, sub: this.config.sub, date });
      })
      // per-source 时间窗过滤（无 window 或无 date 的保留）
      .filter((it) => {
        if (!this.windowMs || !it.date) return true;
        return it.date.getTime() >= Date.now() - this.windowMs;
      })
      // hard cap：每源最多保留最新 50 条，防止历史归档源（OpenAI Blog 1028 条）撑爆 ingest
      .sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0))
      .slice(0, 50);

    // 聚合 RSS 拆分（橘鸦日报等：标题是日期、摘要含多条新闻）
    items = items.flatMap((it) => splitAggregated(it));
    return items;
  }
}

// ── 辅助函数（迁移自 fetch.js，逻辑不变）──────────────────

/** 移除 content:encoded 块（防 billion laughs） */
function stripHeavyContent(xmlText) {
  return xmlText.replace(/<content:encoded>[\s\S]*?<\/content:encoded>/g, '');
}

/** RSS 2.0 和 Atom 都兼容 */
function extractItems(parsed) {
  const rss = parsed?.rss?.channel?.item;
  if (rss) return Array.isArray(rss) ? rss : [rss];
  const atom = parsed?.feed?.entry;
  if (atom) return Array.isArray(atom) ? atom : [atom];
  return [];
}

/** 从 RSS item / Atom entry 抽 title/link/date/summary，做 HTML 剥离 */
function normalizeItem(raw) {
  const title = stripHtml(raw.title || raw['@_title'] || '').trim();
  const link =
    raw.link?.['@_href'] || // Atom
    raw.link || // RSS 纯文本
    raw['@_link'] ||
    '';
  const dateRaw =
    raw.pubDate || raw.published || raw.updated || raw['dc:date'] || raw['@_updated'] || '';
  const summaryRaw = raw.description || raw.summary || raw.content || raw['content:encoded'] || '';
  const summary = stripHtml(String(summaryRaw)).trim().slice(0, 500);
  const date = dateRaw ? new Date(dateRaw) : null;
  return { title, link: normalizeUrl(link), summary, date };
}

/**
 * 清洗 RSS 文本：先解码 HTML 实体（含数字字符引用），再剥离 HTML 标签。
 * 顺序很重要：processEntities:false 时 parser 保留原始 &lt; &gt; 实体，
 * 必须先解码成真正的 < >，HTML 标签剥离才生效。
 */
function stripHtml(s) {
  return s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&') // &amp; 必须最后解码，避免二次展开
    .replace(/<[^>]+>/g, '') // 解码后再剥离 HTML 标签
    .replace(/\s+/g, ' ');
}

function normalizeUrl(u) {
  if (!u) return '';
  try {
    const url = new URL(String(u).trim());
    url.hash = '';
    return url.toString();
  } catch {
    return String(u).trim();
  }
}

/**
 * 拆分聚合型 RSS 条目（橘鸦日报：一条含多条新闻，用 ↗ N 标记分隔）。
 * 标题是纯日期时触发；拆不出多条的原样返回。
 */
function splitAggregated(item) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(item.title)) return [item];
  const text = item.summary || '';
  const parts = text.split(/↗\s*\d+|>>\s*\d+/).filter((s) => s.trim().length > 4);
  if (parts.length < 2) return [item];
  return parts.map((part, i) => {
    const clean = part.trim().replace(/\s+/g, ' ');
    const firstClause = clean.split(/[，。：；!？]/)[0];
    const title = firstClause.length > 4 && firstClause.length <= 40 ? firstClause : clean.slice(0, 30);
    // 拆出的条目用 原link#序号 区分 urlHash
	    return new NewsItem({
	      title: title || item.title,
	      link: item.link ? `${item.link}#${i + 1}` : '',
	      summary: clean.slice(0, 200),
	      fullSummary: clean,
	      source: item.source,
	      category: item.category,
	      sub: item.sub,
	      date: item.date,
    });
  });
}
