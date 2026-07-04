// 新浪财经新闻源：JSON API → NewsItem[]。
// 迁移自 src/fetch-finance-news.js。hash 现在由 NewsItem 构造时算（不再重复）。

import { ItemSource } from '../core/source.js';
import { NewsItem } from '../core/item.js';

const SINA_NEWS_URL =
  'https://feed.mix.sina.com.cn/api/roll/get?pageid=153&lid=2509&num=20&page=1';

export class SinaNewsSource extends ItemSource {
  constructor(config = {}) {
    super({ name: '新浪财经', category: '要闻', ...config });
  }

  async fetch() {
    const res = await fetch(SINA_NEWS_URL, {
      headers: { Referer: 'https://finance.sina.com.cn' },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const data = json?.result?.data;
    if (!Array.isArray(data)) return [];
    return data;
  }

  normalize(data) {
    const items = [];
    for (const entry of data) {
      const title = (entry.title || '').trim();
      if (title.length < 4) continue;
      const intro = stripHtml(entry.intro || '');
      const link = entry.url || entry.wapurl || '';
      const source = (entry.media_name || '新浪财经').trim();
      items.push(new NewsItem({
        title,
        link,
        summary: intro.slice(0, 200),
        fullSummary: intro,
        source,
        category: this.category,
      }));
    }
    return items;
  }
}

/** 简化 HTML 清洗（新浪 intro 实体少，不需 RSS 那套 8 步解码） */
function stripHtml(s) {
  return s.replace(/<[^>]+>/g, '').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
}
