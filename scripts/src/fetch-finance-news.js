// 金融新闻抓取：新浪财经新闻 JSON API。
// 返回 items[]，格式与 fetch.js 输出对齐，可直接喂给 select stage。
// 纯脚本，0 token。

const SINA_NEWS_URL =
  'https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2509&num=20&page=1';

/** FNV-1a hash，base36 编码（与 dedupe.js 的 urlHash/titleHash 一致，用于跨模块去重匹配） */
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

function stripHtml(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * 抓取金融新闻，返回 items 数组。
 * @returns {Promise<Array<{ id, title, summary, fullSummary, source, link, urlHash, titleHash }>>}
 */
export async function fetchFinanceNews() {
  console.log('  新浪新闻 API → 金融要闻 ...');

  const res = await fetch(SINA_NEWS_URL, {
    headers: { Referer: 'https://finance.sina.com.cn' },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) {
    console.warn(`    新浪新闻 API 返回 ${res.status}，跳过`);
    return [];
  }

  const json = await res.json();
  const data = json?.result?.data;
  if (!Array.isArray(data)) {
    console.warn('    新浪新闻 API 无数据');
    return [];
  }

  const items = [];
  for (const entry of data) {
    const title = (entry.title || '').trim();
    if (title.length < 4) continue;

    const intro = stripHtml(entry.intro || '');
    const link = entry.url || entry.wapurl || '';
    const source = (entry.media_name || '新浪财经').trim();

    const urlHash = fnv1a('u:' + link);
    const titleHash = fnv1a('t:' + title.toLowerCase().replace(/\s+/g, ''));

    items.push({
      id: urlHash || titleHash,           // select stage 用 id 选
      title,
      summary: intro.slice(0, 200),       // 短摘要给 select stage
      fullSummary: intro,                 // 完整摘要给 summarize stage
      source,
      link,
      urlHash,
      titleHash,
    });
  }

  console.log(`    获取 ${items.length} 条金融新闻`);
  return items;
}
