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

      // 近期已报道事件标题（跨天语义去重）
      const recentTitles = ctx.store.loadRecentTitles(ctx.job.name, 2);
      const recentBlock = recentTitles.length
        ? recentTitles.map((t, i) => `${i + 1}. ${t}`).join('\n')
        : '（无）';

      // 子分类列表（供 LLM 分配的选项）
      const subs = ctx.job.subs || [];
      const subsBlock = subs.length ? subs.map((s) => `- ${s}`).join('\n') : '（无）';

      const prompt = tpl
        .replace(/\{category\}/g, cat)
        .replace('{top_n}', ctx.job.top_n_per_category)
        .replace('{items}', items.slice(0, 40).map((it) => it.toPromptText()).join('\n\n'))
        .replace('{recent}', recentBlock)
        .replace('{subs}', subsBlock);

      if (recentTitles.length) {
        console.log(`    ${cat}: 注入 ${recentTitles.length} 条近期已报道标题`);
      }

      const { content, usage } = await llm.complete({
        system: '你是一名新闻编辑，擅长从大量条目中精选和合并同事件报道。只输出 JSON。',
        user: prompt,
        responseFormat: 'json',
      });
      totalUsage.inputTokens += usage.inputTokens;
      totalUsage.outputTokens += usage.outputTokens;

      const byId = new Map(capped.map((it) => [it.id, it]));
      const events = (content?.events || [])
        .map((ev) => ({
          items: (ev.ids || []).map((id) => byId.get(id)).filter(Boolean),
          mergedTitle: ev.title || '',
          sub: ev.sub || '',  // LLM 分配的子分类
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
}
