// Stage 0 · clean：纯脚本清洗，0 token。
// 抓取 → 时间窗过滤 → 三层去重 → 按 category 分组 → 截短摘要省下游 token。
import { fetchAll } from '../fetch.js';
import { dedupe } from '../dedupe.js';
import { loadState } from '../state.js';
import { windowToMs } from '../config.js';

/**
 * @param {object} ctx 工作流上下文
 * @returns ctx（items 字段填充为 { 国内:[], 国际:[], 科技:[] } 分组后的干净条目）
 */
export async function clean(ctx) {
  console.log('[1/4] clean · 脚本清洗');

  const windowMs = windowToMs(ctx.job.window);
  const seen = loadState(ctx.repoRoot);

  const raw = await fetchAll(ctx.feeds);
  const kept = dedupe(raw, windowMs, seen);

  // 按 job 配置的 categories 分组
  const grouped = {};
  for (const cat of ctx.job.categories) grouped[cat] = [];
  for (const it of kept) {
    if (grouped[it.category]) grouped[it.category].push(it);
  }

  // 给 LLM 阶段准备的精简版：只留必要字段，摘要再截一次（select 阶段只要短摘要）
  const items = {};
  for (const [cat, list] of Object.entries(grouped)) {
    items[cat] = list.map((it) => ({
      id: it.urlHash || it.titleHash,
      title: it.title,
      summary: it.summary.slice(0, 200), // select 阶段读短摘要即可
      fullSummary: it.summary, // summarize 阶段才用
      source: it.source,
      link: it.link,
      // hash 直接放顶层，供 state 记录（不依赖 _raw 间接访问）
      urlHash: it.urlHash,
      titleHash: it.titleHash,
    }));
    console.log(`    ${cat}: ${items[cat].length} 条`);
  }

  ctx.items = items;
  ctx._seen = seen; // 给后续 state 写入用
  return ctx;
}
