// 核心数据模型：NewsItem（新闻，可去重）+ Quote（行情，不去重）。
// hash 函数唯一定义在此，全系统共享 —— 不再散落在 dedupe.js / fetch-finance-news.js。

/**
 * FNV-1a 32-bit hash，base36 编码。
 * 唯一实现，所有需要 hash 的地方都从这里 import。
 */
export function hash(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** URL → hash（用于跨天精确去重） */
export const urlHash = (url) => hash('u:' + url);

/** 标题 → hash（标题归一化后计算） */
export const titleHash = (title) =>
  hash('t:' + String(title).toLowerCase().replace(/\s+/g, ''));

/**
 * 新闻条目。构造时自动计算 urlHash / titleHash / id。
 * 这是唯一会进入 dedupe / seen.json / select / summarize 的数据类型。
 */
export class NewsItem {
  constructor({ title, link = '', summary = '', fullSummary, source, category, sub, date = null }) {
    this.title = String(title || '');
    this.link = String(link || '');
    this.summary = String(summary || '');
    this.fullSummary = fullSummary ?? this.summary;
    this.source = source || '';
    this.category = category || '';
    this.sub = sub || '';  // 子分类（时政/经济/军事...），由 feeds.yml 人工分配
    this.date = date;

    // hash 唯一计算点
    this.urlHash = this.link ? urlHash(this.link) : '';
    this.titleHash = this.title ? titleHash(this.title) : '';
    this.id = this.urlHash || this.titleHash;
  }

  /** 用于 select stage 喂给 LLM 的紧凑文本格式 */
  toPromptText() {
    return `[${this.id}] 《${this.title}》(${this.source})\n    ${this.summary}`;
  }
}

/**
 * 行情报价。不计算 hash、不进 dedupe、不进 seen.json。
 * 按 name 存入 market-history，供 sparkline / 走势图用。
 * priceStr / changeStr 由 renderer 格式化（Quote 只存原始数值）。
 */
export class Quote {
  constructor({ name, price, changePct = 0, change = 0, open, high, low, key, source }) {
    this.name = name;
    this.price = price;
    this.changePct = changePct;
    this.change = change;
    // OHLC 可选（A 股有，全球指数无）
    if (open != null) this.open = open;
    if (high != null) this.high = high;
    if (low != null) this.low = low;
    // key 用于资产分类（gold/oil/usd），指数无 key
    if (key) this.key = key;
    // source 标记数据来自哪个 API（BTC 用：CoinGecko/Gate.io）
    if (source) this.source = source;
  }

  /** 是否有日内 OHLC（A 股有，用于振幅计算） */
  hasOHLC() {
    return this.open != null && this.high != null && this.low != null;
  }
}
