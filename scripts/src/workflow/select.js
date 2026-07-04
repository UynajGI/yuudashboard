// Stage 1 · select：LLM 识别同事件多源报道 → 合并；按重要度选 top N。
// 输入：每类的全部候选条目（只读短摘要，省 token）
// 输出：每类保留 N 个「事件」的 id 索引（输出极小）
import { loadPrompt } from '../prompt.js';

/**
 * 按源均匀采样：候选太多时，每个源按比例取，保证多样性。
 * 避免 slice(0,40) 把名额全给了排在前面的单一源。
 * 已按日期降序的条目，每个源取靠前的（更新的）。
 */
function sampleBySource(items, cap) {
  if (items.length <= cap) return items;
  const bySrc = new Map();
  for (const it of items) {
    if (!bySrc.has(it.source)) bySrc.set(it.source, []);
    bySrc.get(it.source).push(it);
  }
  const sources = [...bySrc.values()];
  const out = [];
  // 轮询每个源取一条，直到达到 cap
  let i = 0;
  while (out.length < cap && sources.some((s) => s.length > i)) {
    for (const s of sources) {
      if (s[i]) {
        out.push(s[i]);
        if (out.length >= cap) break;
      }
    }
    i++;
  }
  return out;
}

/** 把条目列表渲染成 LLM 输入文本（紧凑格式省 token） */
function renderItems(items) {
  return items
    .map(
      (it, i) =>
        `[${it.id}] 《${it.title}》(${it.source})\n    ${it.summary}`,
    )
    .join('\n\n');
}

export async function select(ctx, llm) {
  console.log('[2/4] select · LLM 精选合并');
  const prefix = ctx.job.prompt_prefix || 'daily';
  const tpl = loadPrompt(ctx.scriptsDir, prefix, 'select');

  const selected = {};
  let totalUsage = { inputTokens: 0, outputTokens: 0 };

  for (const cat of ctx.job.categories) {
    const items = ctx.items[cat] || [];
    if (items.length === 0) {
      selected[cat] = [];
      console.log(`    ${cat}: 无候选，跳过`);
      continue;
    }

    // 候选太多时按源均匀采样（避免全是同一个源，保证多样性）
    const capped = sampleBySource(items, 40);
    const prompt = tpl
      .replace(/\{category\}/g, cat)
      .replace('{top_n}', ctx.job.top_n_per_category)
      .replace('{items}', renderItems(capped));

    const { content, usage } = await llm.complete({
      system: '你是一名新闻编辑，擅长从大量条目中精选和合并同事件报道。只输出 JSON。',
      user: prompt,
      responseFormat: 'json',
    });
    totalUsage.inputTokens += usage.inputTokens;
    totalUsage.outputTokens += usage.outputTokens;

    // 保留事件的分组结构：每个 event 对应一个「事件」，含多源条目。
    // 不要 .flat()——那会丢失合并信息，让同事件的多源又被拆成单条。
    const byId = new Map(capped.map((it) => [it.id, it]));
    const events = (content?.events || [])
      .map((ev) => ({
        // 一个事件可能由多个条目（多源报道）合并而成
        items: (ev.ids || [])
          .map((id) => byId.get(id))
          .filter(Boolean),
        mergedTitle: ev.title || '',
      }))
      .filter((ev) => ev.items.length > 0)
      .slice(0, ctx.job.top_n_per_category);

    selected[cat] = events;
    const srcCount = events.reduce((a, e) => a + e.items.length, 0);
    console.log(`    ${cat}: ${items.length} 候选 → ${events.length} 事件（合并自 ${srcCount} 条）`);
  }

  ctx.selected = selected;
  ctx._usage = ctx._usage || {};
  ctx._usage.select = totalUsage;
  console.log(`    token：in=${totalUsage.inputTokens} out=${totalUsage.outputTokens}`);
  return ctx;
}
