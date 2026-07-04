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

// 金融专用 RSS 财经源（不走 feeds.yml，直接注入金融管线）
const FINANCE_RSS_FEEDS = [
  { name: '华尔街见闻', url: 'https://plink.anyfeeder.com/weixin/wallstreetcn' },
  { name: '央视财经', url: 'https://plink.anyfeeder.com/weixin/cctvyscj' },
  { name: '棱镜-腾讯财经', url: 'https://plink.anyfeeder.com/weixin/lengjing_qqfinance' },
  { name: '界面新闻-财经', url: 'https://plink.anyfeeder.com/jiemian/finance' },
  { name: '第一财经周刊', url: 'https://plink.anyfeeder.com/weixin/CBNweekly2008' },
  { name: '21世纪经济报道', url: 'https://plink.anyfeeder.com/weixin/jjbd21' },
  { name: '财新网', url: 'https://plink.anyfeeder.com/weixin/caixinwang' },
  { name: '叶檀财经', url: 'https://plink.anyfeeder.com/weixin/tancaijing' },
  { name: '经济学人', url: 'https://plink.anyfeeder.com/weixin/theeconomist' },
  { name: '华尔街日报', url: 'https://plink.anyfeeder.com/wsj/cn' },
];

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
    // 金融新闻：新浪 API + 财经 RSS 源（category 设为 job 的 categories[0]）
    const cat = job.categories?.[0] || '要闻';
    const financeRss = FINANCE_RSS_FEEDS.map((f) => new RssSource({ ...f, category: cat }));
    return {
      itemSources: [new SinaNewsSource(), ...financeRss],
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
  if (market === 'asia') {
    // 亚盘专栏加 KOSPI
    sources.push(new KospiSource());
  }
  if (market === 'all') {
    // 汇总：全部源
    sources.push(new BtcSource(), new KospiSource(), new UsTreasurySource(), new TushareSource());
  }
  return sources;
}
