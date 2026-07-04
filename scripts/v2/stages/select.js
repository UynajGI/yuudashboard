// Stage: select —— LLM 识别同事件多源报道 → 合并；按重要度选 top N。
// 迁移自 src/workflow/select.js，改用 ctx.store 读 recent-events。

import { Stage } from '../core/pipeline.js';
import { loadPrompt } from '../prompt.js';

/** 按源均匀采样：候选太多时，每个源按比例取，保证多样性 */
function sampleBySource(items, cap) {
  if (items.length <= cap) return items;
  const bySrc = new Map();
  for (const it of items) {
    if (!bySrc.has(it.source)) bySrc.set(it.source, []);
    bySrc.get(it.source).push(it);
  }
  const sources = [...bySrc.values()];
  const out = [];
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

export class SelectStage extends Stage {
  constructor() {
    super({ name: 'select', needsLLM: true });
  }

  async run(ctx, llm) {
    console.log('\n── Stage · select ──');
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

      const capped = sampleBySource(items, 40);

      // 子分类列表（供 LLM 分配的选项）
      const subs = ctx.job.subs || [];
      const subsBlock = subs.length ? subs.map((s) => `- ${s}`).join('\n') : '（无）';

      const prompt = tpl
        .replace(/\{category\}/g, cat)
        .replace('{top_n}', ctx.job.top_n_per_category)
        .replace('{items}', capped.map((it) => it.toPromptText()).join('\n\n'))
        .replace('{subs}', subsBlock);

      const { content, usage } = await llm.complete({
        system: '你是新闻编辑，负责把候选条目合并成事件并分类。所有候选都是 24h 内真实新闻，不要丢弃。只输出 JSON。',
        user: prompt,
        responseFormat: 'json',
      });
      totalUsage.inputTokens += usage.inputTokens;
      totalUsage.outputTokens += usage.outputTokens;

      // LLM 返回的事件（用于合并 + 标注 sub）
      const byId = new Map(capped.map((it) => [it.id, it]));
      const llmEvents = (content?.events || [])
        .map((ev) => ({
          items: (ev.ids || []).map((id) => byId.get(id)).filter(Boolean),
          mergedTitle: ev.title || '',
          sub: ev.sub || '',
        }))
        .filter((ev) => ev.items.length > 0);

      // 不丢弃：LLM 没覆盖到的候选条目，各自独立成事件（保证 24h 内新闻全保留）
      const coveredIds = new Set(llmEvents.flatMap((e) => e.items.map((it) => it.id)));
      // 补入 LLM 未覆盖的条目（不丢弃），但搜索来源的不补——
      // 搜索结果含 SEO 垃圾，LLM 没选就当噪音丢弃；RSS 都是真实新闻，必须保留
      const leftover = capped.filter((it) => !coveredIds.has(it.id) && !(it.source || '').startsWith('搜索·'));
      const leftoverEvents = leftover.map((it) => ({ items: [it], mergedTitle: it.title, sub: '' }));

      const events = [...llmEvents, ...leftoverEvents].slice(0, ctx.job.top_n_per_category);

      selected[cat] = events;
      const srcCount = events.reduce((a, e) => a + e.items.length, 0);
      const merged = llmEvents.length;
      const added = leftoverEvents.length;
      console.log(`    ${cat}: ${items.length} 候选 → ${events.length} 事件（LLM 合并 ${merged}，补入 ${added}）`);
    }

    ctx.selected = selected;
    ctx._usage = ctx._usage || {};
    ctx._usage.select = totalUsage;
    console.log(`    token：in=${totalUsage.inputTokens} out=${totalUsage.outputTokens}`);
    return ctx;
  }
}
