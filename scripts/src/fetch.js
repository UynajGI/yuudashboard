// RSS 抓取：并发拉所有源，单源失败不阻塞，HTML 清洗。
import { Agent, setGlobalDispatcher } from 'undici';
import { XMLParser } from 'fast-xml-parser';

// 关键：强制 IPv4。很多环境 DNS 返回 IPv6 优先（Cloudflare 双栈），
// 但本机/CI 的 IPv6 出口不通 → Node fetch 优先用 IPv6 → ETIMEDOUT。
// node:dns 的 setDefaultResultOrder 对 undici 内部解析无效，必须用 dispatcher。
// GA runner 也常无 IPv6，统一强制 IPv4 最稳。
setGlobalDispatcher(new Agent({ connect: { family: 4 } }));

const xml = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  allowBooleanAttributes: true,
  parseAttributeValue: false,
  trimValues: true,
  // 禁用 XML 实体处理。RSS 的 description/content 里含大量 HTML 转义实体
  // （&lt;p&gt; 等），累计会触发实体扩展上限（防 billion laughs）。
  // 禁用后保留原始 &xxx; 文本，由 stripHtml 统一解码标准 HTML 实体。
  processEntities: false,
});

const FETCH_TIMEOUT = 20_000;

/** 抓单个源 → 归一化的条目数组。失败返回 [] 并打日志。 */
async function fetchOne(feed) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT);
    const res = await fetch(feed.url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'yuudashboard-feeds/0.1 (Hugo site aggregator)' },
    });
    clearTimeout(t);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = stripHeavyContent(await res.text());
    const parsed = xml.parse(text);
    const items = extractItems(parsed);
    return items.map((it) => ({
      ...normalizeItem(it),
      source: feed.name,
      category: feed.category,
    }));
  } catch (e) {
    console.warn(`  ⚠ 源「${feed.name}」抓取失败：${e.message}`);
    return [];
  }
}

/**
 * 移除 content:encoded 块。
 * 这些字段含大量嵌套 HTML 转义实体（&lt; &gt; &amp; 多层编码），
 * 会触发 fast-xml-parser 的实体扩展上限保护（防 billion laughs 攻击，不应关闭）。
 * 而我们只用 description（纯文本摘要），content:encoded 的 HTML 全文本就要剥离，故直接删。
 */
function stripHeavyContent(xmlText) {
  return xmlText.replace(/<content:encoded>[\s\S]*?<\/content:encoded>/g, '');
}

/** RSS 2.0 和 Atom 都兼容：定位 channel/item 或 feed/entry */
function extractItems(parsed) {
  const rss = parsed?.rss?.channel?.item;
  if (rss) return Array.isArray(rss) ? rss : [rss];
  const atom = parsed?.feed?.entry;
  if (atom) return Array.isArray(atom) ? atom : [atom];
  return [];
}

/** 从 RSS item / Atom entry 里抽 title / link / date / summary，做 HTML 剥离 */
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
  const summary = stripHtml(String(summaryRaw)).trim().slice(0, 500); // 截断省 token
  const date = dateRaw ? new Date(dateRaw) : null;
  return { title, link: normalizeUrl(link), summary, date };
}

/**
 * 清洗 RSS 文本：先解码 HTML 实体（含数字字符引用），再剥离 HTML 标签。
 *
 * 顺序很重要：processEntities:false 时 parser 保留原始 &lt; &gt; 实体，
 * 必须先解码成真正的 < >，HTML 标签剥离才生效。
 * 解码要先于剥离，否则 <figure><img...> 这类标签会残留。
 */
function stripHtml(s = '') {
  return String(s)
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

/** 并发抓所有源，返回扁平条目数组 */
export async function fetchAll(feeds) {
  const results = await Promise.all(feeds.map(fetchOne));
  const items = results.flat();
  const okSources = feeds.length - results.filter((r) => r.length === 0).length;
  console.log(`  抓取：${items.length} 条，${okSources}/${feeds.length} 源成功`);
  return items;
}
