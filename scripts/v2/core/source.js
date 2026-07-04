// 源抽象：所有数据源（RSS/API）的统一接口。
// 加新源 = 写一个文件继承 ItemSource 或 MarketSource + 在 sources/index.js 注册。
//
// 两类源：
//   ItemSource   → fetch+normalize 产出 NewsItem[]（进 dedupe/select/summarize）
//   MarketSource → fetch+normalize 产出 Quote[]（进 market-history/render）
// 两者本质不同（新闻可去重，行情不去重），不强行统一成一个基类。

/**
 * 新闻源基类：产出可去重的 NewsItem。
 * 子类必须实现 fetch() 和 normalize()。
 * config: { name, window?, category, ... } —— window 可选，per-source 时间窗覆盖。
 */
export class ItemSource {
  constructor(config) {
    this.name = config.name;
    this.window = config.window || null; // per-source 时间窗（如橘鸦 48h），缺省用 job window
    this.category = config.category || '';
    this.config = config;
  }

  /** 抓取原始数据。子类实现。返回 raw payload。 */
  async fetch() {
    throw new Error(`${this.constructor.name}.fetch() 必须由子类实现`);
  }

  /**
   * 把 raw 归一化为 NewsItem[]。
   * 一个 raw entry 可能产出多个 NewsItem（如聚合 RSS 拆分）。
   * 子类实现。
   */
  normalize(raw) {
    throw new Error(`${this.constructor.name}.normalize() 必须由子类实现`);
  }

  /**
   * fetch + normalize 的便捷组合。ingest stage 调这个。
   * 单源失败不阻塞，返回 [] + 打日志。
   * @returns {Promise<NewsItem[]>}
   */
  async collect() {
    try {
      const raw = await this.fetch();
      const items = this.normalize(raw);
      // 确保 category 正确（子类可能没填）
      for (const it of items) {
        if (!it.category) it.category = this.category;
        if (!it.source) it.source = this.name;
      }
      return items;
    } catch (e) {
      console.warn(`  ⚠ 源「${this.name}」抓取失败：${e.message}`);
      return [];
    }
  }
}

/**
 * 行情源基类：产出 Quote（不去重，按 name 存历史）。
 * 子类必须实现 fetch() 和 normalize()。
 */
export class MarketSource {
  constructor(config) {
    this.name = config.name;
    this.config = config;
  }

  async fetch() {
    throw new Error(`${this.constructor.name}.fetch() 必须由子类实现`);
  }

  /** @returns {Quote|Quote[]|null} */
  normalize(raw) {
    throw new Error(`${this.constructor.name}.normalize() 必须由子类实现`);
  }

  /**
   * fetch + normalize。失败返回 null + 打日志。
   * @returns {Promise<Quote|Quote[]|null>}
   */
  async collect() {
    try {
      const raw = await this.fetch();
      return this.normalize(raw);
    } catch (e) {
      console.warn(`  ⚠ 行情源「${this.name}」不可用：${e.message}`);
      return null;
    }
  }
}

/**
 * 复合行情源：多源 fallback（如 BTC：CoinGecko → Gate.io）。
 * 依次尝试子源，第一个成功即用。
 */
export class FallbackMarketSource extends MarketSource {
  constructor(config, children) {
    super(config);
    this.children = children; // MarketSource[]，按优先级排序
  }

  async collect() {
    for (const child of this.children) {
      const result = await child.collect();
      if (result) {
        // 标记实际数据源
        const tag = result instanceof Array ? result[0] : result;
        if (tag && !tag.source) tag.source = child.name;
        return result;
      }
    }
    console.warn(`  ⚠ 复合源「${this.name}」所有子源失败`);
    return null;
  }
}
