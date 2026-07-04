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
    return {
      itemSources: feeds.map((f) => new RssSource(f)),
      marketSources: [],
    };
  }

  if (isFinance) {
    const market = job.market || 'all';
    return {
      itemSources: [new SinaNewsSource()],
      marketSources: buildFinanceSources(market),
    };
  }

  return { itemSources: [], marketSources: [] };
}

/**
 * 按市场构建金融行情源。
 * @param {string} market  ashare/hk/us/commodity/crypto/all
 */
function buildFinanceSources(market) {
  const sources = [new SinaQuoteSource(market)];

  if (market === 'ashare') {
    // A 股专栏额外加 Tushare（申万行业 + 北向资金）
    sources.push(new TushareSource());
  }
  if (market === 'us') {
    // 美股专栏加美债
    sources.push(new UsTreasurySource());
  }
  if (market === 'crypto') {
    // 加密专栏加 BTC
    sources.push(new BtcSource());
  }
  if (market === 'hk') {
    // 港股专栏加 KOSPI（亚太）
    sources.push(new KospiSource());
  }
  if (market === 'all') {
    // 汇总：全部源
    sources.push(new BtcSource(), new KospiSource(), new UsTreasurySource(), new TushareSource());
  }
  return sources;
}
