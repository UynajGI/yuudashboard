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
      // 专栏范围定义（来自 jobs.yml 的 scope 字段，约束 LLM 只保留相关条目）
      const scope = ctx.job.scope || '（未定义，请按 category 名字广义理解）';

      const prompt = tpl
        .replace(/\{category\}/g, cat)
        .replace('{top_n}', ctx.job.top_n_per_category)
        .replace('{items}', capped.map((it) => it.toPromptText()).join('\n\n'))
        .replace('{subs}', subsBlock)
        .replace('{scope}', scope);

      const { content, usage } = await llm.complete({
        system: '你是新闻编辑，负责把候选条目合并成事件、分类，并丢弃明显不属于本专栏的条目。只输出 JSON。',
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

      // LLM 显式丢弃的条目（不属于本专栏）
      const dropped = Array.isArray(content?.dropped) ? content.dropped : [];
      const droppedIds = new Set(dropped.map((d) => d.id).filter(Boolean));
      // 丢弃理由日志（便于复盘误伤）
      if (dropped.length) {
        console.log(`    ${cat} · 丢弃 ${dropped.length} 条：`);
        for (const d of dropped.slice(0, 10)) {
          const it = byId.get(d.id);
          console.log(`      ✗ [${d.id}] ${(it?.title || '').slice(0, 40)} — ${d.reason || '无理由'}`);
        }
      }

      // 不丢弃：LLM 没覆盖到、也没显式丢弃的候选条目，各自独立成事件（保证相关新闻全保留）
      const coveredIds = new Set(llmEvents.flatMap((e) => e.items.map((it) => it.id)));
      // 补入 LLM 未覆盖的条目（不丢弃），但搜索来源的不补——
      // 搜索结果含 SEO 垃圾，LLM 没选就当噪音丢弃；RSS 都是真实新闻，必须保留
      // （已被 LLM 显式 dropped 的也不补）
      const leftover = capped.filter((it) => !coveredIds.has(it.id) && !droppedIds.has(it.id) && !(it.source || '').startsWith('搜索·'));
      const leftoverEvents = leftover.map((it) => ({ items: [it], mergedTitle: it.title, sub: '' }));

      const events = [...llmEvents, ...leftoverEvents].slice(0, ctx.job.top_n_per_category);

      selected[cat] = events;
      const srcCount = events.reduce((a, e) => a + e.items.length, 0);
      const merged = llmEvents.length;
      const added = leftoverEvents.length;
      console.log(`    ${cat}: ${items.length} 候选 → ${events.length} 事件（LLM 合并 ${merged}，补入 ${added}，丢弃 ${dropped.length}）`);
    }

    ctx.selected = selected;
    ctx._usage = ctx._usage || {};
    ctx._usage.select = totalUsage;
    console.log(`    token：in=${totalUsage.inputTokens} out=${totalUsage.outputTokens}`);
    return ctx;
  }
}
