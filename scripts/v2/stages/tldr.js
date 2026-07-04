// Stage: tldr —— LLM 基于已生成摘要产出 3-4 条总览要点。
// 迁移自 src/workflow/tldr.js，逻辑不变。

import { Stage } from '../core/pipeline.js';
import { loadPrompt } from '../prompt.js';

function renderDigest(summarized) {
  return Object.entries(summarized)
    .map(([cat, items]) => {
      if (!items.length) return `【${cat}】本日无重大新闻。`;
      const lines = items.map((s) => `  - ${s.title}：${s.summary}`).join('\n');
      return `【${cat}】\n${lines}`;
    })
    .join('\n\n');
}

export class TldrStage extends Stage {
  constructor() {
    super({ name: 'tldr', needsLLM: true });
  }

  async run(ctx, llm) {
    console.log('\n── Stage · tldr ──');
    const prefix = ctx.job.prompt_prefix || 'daily';
    const tpl = loadPrompt(ctx.scriptsDir, prefix, 'tldr');

    const prompt = tpl.replace('{digest}', renderDigest(ctx.summarized));

    const { content, usage } = await llm.complete({
      system: '你是新闻简报总编，擅长提炼每日要点。只输出 JSON。',
      user: prompt,
      responseFormat: 'json',
    });

    ctx.tldr = Array.isArray(content?.tldr) ? content.tldr : [];
    ctx._usage = ctx._usage || {};
    ctx._usage.tldr = usage;
    console.log(`    生成 ${ctx.tldr.length} 条 TL;DR`);
    console.log(`    token：in=${usage.inputTokens} out=${usage.outputTokens}`);
    return ctx;
  }
}
