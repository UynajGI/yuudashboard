// Stage: digest —— 读当天已生成的 news 专栏，LLM 综合生成今日要闻。
// 只服务 news section，finance 有自己的汇总。

import { Stage } from '../core/pipeline.js';
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

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

    // 读各专栏文件
    const sections = [];
    for (const col of columns) {
      const path = resolve(ctx.repoRoot, col.file.replace('{date}', ctx.date.str));
      if (!existsSync(path)) {
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
      system: `你是新闻总编，要把四个专栏（国内/国际/科技/工程）综合成一份「今日要闻」。
要求：输出 8-12 条要点，覆盖四个专栏的重要内容，按重要性排序。每条 20-50 字，信息密集。
不要编号，每行一条。不同专栏的同一主题可以合并。只返回 JSON。`,
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
