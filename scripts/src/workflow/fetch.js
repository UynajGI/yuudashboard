// Stage: fetch（金融管线专用 —— 替代 clean）
// 同时抓取市场数据（新浪 API）和金融新闻（新浪新闻 API），
// 将市场数据写入 ctx.marketData，新闻写入 ctx.items。
// 纯脚本阶段，不需要 LLM。

import { fetchMarketData } from '../fetch-market.js';
import { fetchFinanceNews } from '../fetch-finance-news.js';
import { loadState } from '../state.js';

/**
 * @param {object} ctx
 * @param {null}   _llm  未使用（纯脚本阶段）
 * @returns {Promise<object>} ctx
 */
export async function fetch(ctx, _llm) {
  console.log('\n── Stage 0 · fetch ──');

  // 1. 加载去重 state
  ctx._seen = loadState(ctx.repoRoot);

  // 2. 并行抓取市场数据 + 金融新闻
  const [marketData, newsItems] = await Promise.all([
    fetchMarketData(),
    fetchFinanceNews(),
  ]);

  // 3. 存储市场数据
  ctx.marketData = marketData;

  // 4. 金融新闻 → ctx.items（复刻 clean stage 的输出格式）
  //    所有新闻归入「要闻」category
  ctx.items = { 要闻: newsItems };

  const newsCount = newsItems.length;
  console.log(`\n  fetch 完成：指数 ${marketData.indices.length} · 资产 ${marketData.assets.length} · 新闻 ${newsCount} 条`);

  return ctx;
}

export default fetch;
