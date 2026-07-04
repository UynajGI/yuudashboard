// 源注册表：集中导出所有源适配器。
// ingest stage 按 job 类型从这里取源。
//
// 加新源：写一个 sources/xxx.js（继承 ItemSource 或 MarketSource）+ 在这里 import。
// 不需要改 ingest 或其他 stage。

import { RssSource } from './rss.js';
import { SinaQuoteSource } from './sina-quote.js';
import { SinaNewsSource } from './sina-news.js';
import { BtcSource } from './btc.js';
import { KospiSource } from './eastmoney.js';
import { UsTreasurySource } from './yahoo.js';
import { TushareSource } from './tushare.js';

export { RssSource, SinaQuoteSource, SinaNewsSource, BtcSource, KospiSource, UsTreasurySource, TushareSource };

/**
 * 为一个 job 构建所需的源。
 * @param {object} job  jobs.yml 的 job 配置
 * @param {Array} feeds  feeds.yml 的源配置（RSS 用）
 * @returns {{ itemSources: ItemSource[], marketSources: MarketSource[] }}
 */
export function buildSources(job, feeds) {
  const isNews = job.section === 'news';
  const isFinance = job.section === 'finance';

  if (isNews) {
    // news 管线：RSS 源（每个 feed 一个 RssSource）
    return {
      itemSources: feeds.map((f) => new RssSource(f)),
      marketSources: [],
    };
  }

  if (isFinance) {
    // finance 管线：新浪新闻（Item 源）+ 新浪行情/BTC/KOSPI/美债/Tushare（Market 源）
    return {
      itemSources: [new SinaNewsSource()],
      marketSources: [
        new SinaQuoteSource(),
        new BtcSource(),
        new KospiSource(),
        new UsTreasurySource(),
        new TushareSource(),
      ],
    };
  }

  return { itemSources: [], marketSources: [] };
}
