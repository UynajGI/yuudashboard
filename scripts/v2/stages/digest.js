// Stage: digest —— 读当天已生成的 news 专栏，LLM 综合生成今日要闻。
// 只服务 news section，finance 有自己的汇总。

import { Stage } from '../core/pipeline.js';
import { readFileSync } from 'node:fs';
import { findColumnFile } from '../renderers/helpers.js';

export class DigestStage extends Stage {
  constructor() {
    super({ name: 'digest', needsLLM: true });
  }

  async run(ctx, llm) {
    console.log('\n── Stage · digest ──');

    const columns = ctx.job.columns || [];
    if (!columns.length) {
      console.log('  无 columns 配置，跳过');
      ctx.digestContent = [];
      return ctx;
    }

    // 读各专栏文件（用 glob 找当天实际文件，兼容带 stamp 的命名）
    const sections = [];
    for (const col of columns) {
      const path = findColumnFile(ctx.repoRoot, ctx.job.section, ctx.date.str, col.slug);
      if (!path) {
        console.log(`  ⚠ ${col.name}未生成，跳过`);
        continue;
      }
      const text = readFileSync(path, 'utf8');
      const tldrMatch = text.match(/^tldr:\s*\n((?:  - .+\n)*)/m);
      const tldr = tldrMatch ? tldrMatch[1].replace(/^  - /gm, '').trim() : '';
      const titles = [...text.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]).slice(0, 30);
      sections.push({ name: col.name, tldr, titles });
      console.log(`  ✓ ${col.name}：${titles.length} 条`);
    }

    if (!sections.length) {
      console.log('  无专栏内容');
      ctx.digestContent = [];
      return ctx;
    }

    const input = sections.map((s) =>
      `【${s.name}】\n${s.tldr ? `要点：${s.tldr}\n` : ''}条目：${s.titles.join('；')}`
    ).join('\n\n');

    const { content, usage } = await llm.complete({
      system: `你是新闻总编，要把各专栏综合成一份「今日要闻」。
要求：输出 8-12 条要点，覆盖各专栏的重要内容，按重要性排序。每条 25-60 字，信息密集，点出事件+关键数字/影响。
不同专栏的同一主题可以合并。每条不要以专栏名前缀开头。
严格返回 JSON：{"tldr": ["要点一", "要点二", ...]}`,
      user: `以下是今日各专栏内容摘要，请综合成今日要闻。\n\n${input}`,
      responseFormat: 'json',
    });

    ctx.digestContent = Array.isArray(content?.tldr) ? content.tldr : [];
    ctx._usage = ctx._usage || {};
    ctx._usage.digest = usage;
    console.log(`  生成 ${ctx.digestContent.length} 条今日要闻，token：in=${usage.inputTokens} out=${usage.outputTokens}`);
    return ctx;
  }
}
