// Stage: summarize —— LLM 为精选事件生成中文摘要。
// 迁移自 src/workflow/summarize.js，逻辑基本不变。

import { Stage } from '../core/pipeline.js';
import { loadPrompt } from '../prompt.js';

function renderEvent(ev, idx) {
  const sources = ev.items
    .map((it) => `  · [${it.source}] 《${it.title}》\n    ${it.fullSummary || it.summary}\n    链接：${it.link}`)
    .join('\n');
  return `【事件 ${idx + 1}】${ev.mergedTitle ? `建议标题：${ev.mergedTitle}` : ''}\n${sources}`;
}

export class SummarizeStage extends Stage {
  constructor() {
    super({ name: 'summarize', needsLLM: true });
  }

  async run(ctx, llm) {
    console.log('\n── Stage · summarize ──');
    const prefix = ctx.job.prompt_prefix || 'daily';
    const tpl = loadPrompt(ctx.scriptsDir, prefix, 'summarize');

    const summarized = {};
    let totalUsage = { inputTokens: 0, outputTokens: 0 };

    for (const cat of ctx.job.categories) {
      const events = ctx.selected[cat] || [];
      if (events.length === 0) {
        summarized[cat] = [];
        console.log(`    ${cat}: 无精选，跳过`);
        continue;
      }

      const prompt = tpl
        .replace(/\{category\}/g, cat)
        .replace('{events}', events.map((ev, i) => renderEvent(ev, i)).join('\n\n'));

      const { content, usage } = await llm.complete({
        system: '你是一名中文新闻编辑，擅长把多源报道整合成一条简短摘要。只输出 JSON。',
        user: prompt,
        responseFormat: 'json',
      });
      totalUsage.inputTokens += usage.inputTokens;
      totalUsage.outputTokens += usage.outputTokens;

      const sums = content?.summaries || [];
      summarized[cat] = events.map((ev, i) => {
        const s = sums[i] || {};
        return {
          title: s.title || ev.mergedTitle || ev.items[0]?.title || '',
          summary: s.summary || '',
          sources: Array.isArray(s.sources) && s.sources.length
            ? s.sources
            : [...new Set(ev.items.map((it) => it.source))],
          link: s.link || ev.items[0]?.link || '',
          _rawItems: ev.items, // 保留所有源条目，供 state 写 hash
        };
      });

      console.log(`    ${cat}: ${summarized[cat].length} 条摘要`);
    }

    ctx.summarized = summarized;
    ctx._usage = ctx._usage || {};
    ctx._usage.summarize = totalUsage;
    console.log(`    token：in=${totalUsage.inputTokens} out=${totalUsage.outputTokens}`);
    return ctx;
  }
}
