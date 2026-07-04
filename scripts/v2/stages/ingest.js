// Stage: ingest —— 统一替代旧的 clean + fetch。
//   ItemSource → NewsItem[] → dedupe → ctx.items（供 select）
//   MarketSource → Quote[] → 内存快照 → ctx.marketData + ctx.marketHistory
// 行情数据在线拉取不存本地，本地库空间留给新闻去重。
//
// 纯脚本阶段（needsLLM=false）。

import { Stage } from '../core/pipeline.js';
import { buildSources } from '../sources/index.js';
import { titleSimilarity, windowToMs } from '../core/util.js';

/** 从 indices/assets/extra 构建当日行情快照 key=品种名 value={close,changePct}（仅内存，供 sparkline） */
function buildDaySnapshot(indices, assets, extra) {
  const snap = {};
  for (const q of [...indices, ...assets, ...Object.values(extra)]) {
    if (q && q.name != null && isFinite(q.price)) {
      snap[q.name] = { close: q.price, changePct: q.changePct ?? 0 };
    }
  }
  return snap;
}

export class IngestStage extends Stage {
  constructor() {
    super({ name: 'ingest', needsLLM: false });
  }

  async run(ctx, _llm) {
    console.log('\n── Stage · ingest ──');
    const store = ctx.store;
    const { itemSources, marketSources } = buildSources(ctx.job, ctx.feeds);

    // 1. 加载 seen（dedupe 用）
    const seen = store.loadSeen(ctx.job.section);

    // 2. 并行抓取所有 Item 源 → NewsItem[]
    console.log('  抓取新闻源...');
    const itemResults = await Promise.all(itemSources.map((s) => s.collect()));
    let allItems = itemResults.flat();
    const okItemSources = itemSources.length - itemResults.filter((r) => r.length === 0).length;
    console.log(`  新闻：${allItems.length} 条，${okItemSources}/${itemSources.length} 源成功`);

    // 3. dedupe（三层：URL hash + 标题 hash + 标题相似度）
    //    windowMs = max(job window, 各 source window)，避免 per-source window 被 job window 卡
    const jobWindowMs = windowToMs(ctx.job.window || '24h');
    const sourceWindowMs = itemSources.filter((s) => s.windowMs).map((s) => s.windowMs);
    const dedupeWindowMs = Math.max(jobWindowMs, ...sourceWindowMs);
    let kept = dedupe(allItems, dedupeWindowMs, seen, ctx.date.str);
    console.log(`  去重：${allItems.length} → ${kept.length}`);

    // 金融专栏：按 market 关键词过滤新闻（只保留本市场相关）
    if (ctx.job.news_filter && ctx.job.news_filter.length) {
      const before = kept.length;
      const kws = ctx.job.news_filter.map((k) => k.toLowerCase());
      kept = kept.filter((it) => {
        const text = (it.title + ' ' + (it.summary || '')).toLowerCase();
        return kws.some((kw) => text.includes(kw));
      });
      console.log(`  市场过滤(${ctx.job.market})：${before} → ${kept.length}`);
    }

    // 按 category 分组
    ctx.items = {};
    for (const cat of ctx.job.categories || []) ctx.items[cat] = [];
    for (const it of kept) {
      if (ctx.items[it.category]) ctx.items[it.category].push(it);
    }
    ctx._seen = seen; // 保留引用供后续 saveSeen

    // 4. 抓取所有 Market 源 → Quote[]
    if (marketSources.length) {
      console.log('  抓取行情源...');
      const marketResults = await Promise.all(marketSources.map((s) => s.collect()));
      const indices = [];
      const assets = [];
      const extra = {}; // btc / usTreasury / kospi

      // 处理各行情源的返回
      let tushareData = null;

      for (const r of marketResults) {
        if (!r) continue;
        // Tushare 返回 { swSectors, breadth, northFlow }
        if (r.swSectors) {
          tushareData = r;
          continue;
        }
        if (r.indices) indices.push(...r.indices);
        if (r.assets) assets.push(...r.assets);
        // 单个 Quote（BTC/KOSPI/美债）按 name 归类
        if (r instanceof Object && !Array.isArray(r) && !r.indices && !r.assets && r.name) {
          extra[r.name] = r;
        }
      }
      console.log(`  行情：指数 ${indices.length} · 资产 ${assets.length} · 额外 ${Object.keys(extra).length}` +
        (tushareData ? ` · 申万行业 ${tushareData.swSectors.length}` : ' · Tushare 不可用'));

      ctx.marketData = {
        indices, assets,
        btc: extra['BTC'] || null,
        usTreasury: extra['美债 10Y'] || null,
        kospi: extra['韩国 KOSPI'] || null,
        tushare: tushareData,
      };

      // 行情数据不持久化到本地库（在线拉取即可），
      // 仅在内存构建当次 marketHistory 供 sparkline/走势图用
      ctx.marketHistory = {
        days: {
          [ctx.date.str]: buildDaySnapshot(indices, assets, extra),
        },
      };
    }

    const newsCount = Object.values(ctx.items).reduce((a, b) => a + b.length, 0);
    console.log(`\n  ingest 完成：新闻 ${newsCount} 条${ctx.marketData ? ` · 指数 ${ctx.marketData.indices.length}` : ''}`);
    return ctx;
  }
}

// ── dedupe（迁移自 src/dedupe.js，用 v2 的 hash/NewsItem）──────────────

/**
 * 三层去重 + 时间窗过滤。
 * @param {NewsItem[]} items
 * @param {number} windowMs
 * @param {{urls:{},titles:{}}} seen  跨日已发布记录（value=YYYY-MM-DD）
 * @param {string} today  YYYY-MM-DD（同日跨报告不过滤，跨天才过滤）
 * @returns {NewsItem[]}
 */
function dedupe(items, windowMs, seen, today) {
  const cutoff = Date.now() - windowMs;
  const keep = [];
  const seenUrlKeys = new Set();
  const seenTitleKeys = new Set();

  const isStaleSeen = (dateStr) => {
    if (!dateStr) return false;
    return today ? dateStr < today : true;
  };

  // 硬拦截：从 URL 里提取日期（/2026/06/19/ 或 2026-06-19），
  // 防止 RSS 把"收录时间"当 pubDate 导致旧文混入（HN/聚合源常见）
  const urlDateStale = (url) => {
    if (!url) return false;
    const m = url.match(/20\d{2}[/-](0?[1-9]|1[0-2])[/-]([0-2]?[0-9]|3[01])/);
    if (!m) return false;
    const d = new Date(m[0].replace(/\//g, '-'));
    if (isNaN(d.getTime())) return false;
    return d.getTime() < cutoff;
  };

  // 按日期降序（最新在前，保证多源同事件保留最新）
  const sorted = [...items].sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));

  for (const it of sorted) {
    // 时间窗过滤：有日期过旧丢弃；URL 含旧日期也丢弃（防 RSS 日期造假）
    if (it.date && it.date.getTime() < cutoff) continue;
    if (urlDateStale(it.link)) continue;
    if (!it.title || it.title.length < 4) continue;

    const { urlHash: uh, titleHash: th } = it;

    // 第一层：URL 精确去重
    if (uh && isStaleSeen(seen.urls?.[uh])) continue;
    if (seenUrlKeys.has(uh)) continue;
    if (uh) seenUrlKeys.add(uh);

    // 第二层：标题精确 hash 去重
    if (isStaleSeen(seen.titles?.[th])) continue;
    if (seenTitleKeys.has(th)) continue;
    seenTitleKeys.add(th);

    // 第三层：标题相似度去重（同事件不同措辞，>0.7 视为重复）
    let dup = false;
    for (const k of keep) {
      if (titleSimilarity(it.title, k.title) > 0.7) {
        dup = true;
        // 保留摘要更长的
        if ((it.summary?.length || 0) > (k.summary?.length || 0)) {
          Object.assign(k, it);
        }
        break;
      }
    }
    if (!dup) keep.push(it);
  }
  return keep;
}
