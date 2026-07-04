// Stage: fetch（金融管线专用 —— 替代 clean）
// 同时抓取市场数据（新浪 API）和金融新闻（新浪新闻 API），
// 将市场数据写入 ctx.marketData，新闻写入 ctx.items。
// 纯脚本阶段，不需要 LLM。

import { fetchMarketData } from '../fetch-market.js';
import { fetchFinanceNews } from '../fetch-finance-news.js';
import { loadState } from '../state.js';
import { loadHistory, saveSnapshot } from '../market-history.js';
import { dedupe } from '../dedupe.js';
import { windowToMs } from '../config.js';

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

  // 4. 持久化当日快照 → market-history（供走势图用；dry-run 跳过写盘）
  if (ctx.args.dryRun) {
    ctx.marketHistory = loadHistory(ctx.repoRoot);
  } else {
    ctx.marketHistory = saveSnapshot(ctx.repoRoot, ctx.date.str, marketData);
  }

  // 5. 金融新闻 → 去重（跨天 + 本批次）→ ctx.items
  //    fetch-finance-news.js 的 hash 已与 dedupe.js 统一（base36），
  //    seen.json 里昨天及更早的记录会被过滤；今天的（同批次跨报告）保留。
  const windowMs = windowToMs(ctx.job.window || '24h');
  const kept = dedupe(newsItems, windowMs, ctx._seen, ctx.date.str);
  ctx.items = { 要闻: kept };

  const newsCount = kept.length;
  console.log(`\n  fetch 完成：指数 ${marketData.indices.length} · 资产 ${marketData.assets.length} · 新闻 ${newsCount} 条`);

  return ctx;
}

export default fetch;
