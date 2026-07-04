// Stage: finance-digest —— 读 5 篇金融专栏 + 全市场数据，生成金融汇总。
// 汇总含：LLM 综合点评 + 全市场指数表 + 板块对比图（数据平移，不只是文字）。

import { Stage } from '../core/pipeline.js';
import { readFileSync } from 'node:fs';
import { findColumnFile } from '../renderers/helpers.js';

export class FinanceDigestStage extends Stage {
  constructor() {
    super({ name: 'finance-digest', needsLLM: true });
  }

  async run(ctx, llm) {
    console.log('\n── Stage · finance-digest ──');

    const columns = ctx.job.columns || [];
    const sections = [];

    // 1. 读各专栏文件（glob 找当天实际文件，兼容带 stamp 命名）
    for (const col of columns) {
      const path = findColumnFile(ctx.repoRoot, ctx.job.section, ctx.date.str, col.slug);
      if (!path) {
        console.log(`  ⚠ ${col.name}未生成，跳过`);
        continue;
      }
      const text = readFileSync(path, 'utf8');
      const tldrMatch = text.match(/^tldr:\s*\n((?:  - .+\n)*)/m);
      const tldr = tldrMatch ? tldrMatch[1].replace(/^  - /gm, '').trim() : '';
      const titles = [...text.matchAll(/\*\*(.+?)\*\*/g)].map((m) => m[1]).slice(0, 20);
      sections.push({ name: col.name, tldr, titles });
      console.log(`  ✓ ${col.name}：${titles.length} 条`);
    }

    // 2. 拉全市场数据（数据平移：汇总报告自己拉一次全部行情）
    console.log('  拉全市场行情...');
    const { SinaQuoteSource, BtcSource, KospiSource, UsTreasurySource, TushareSource } = await import('../sources/index.js');
    const [sinaAll, btc, kospi, usT, tushare] = await Promise.all([
      new SinaQuoteSource('all').collect(),
      new BtcSource().collect().catch(() => null),
      new KospiSource().collect().catch(() => null),
      new UsTreasurySource().collect().catch(() => null),
      new TushareSource().collect().catch(() => null),
    ]);

    ctx.digestMarketData = {
      indices: sinaAll?.indices || [],
      assets: sinaAll?.assets || [],
      btc, kospi, usT, tushare,
    };
    console.log(`  行情：指数 ${ctx.digestMarketData.indices.length} · 资产 ${ctx.digestMarketData.assets.length}`);

    // 3. LLM 综合各专栏
    if (!sections.length) {
      console.log('  无专栏内容，只用行情数据');
      ctx.digestContent = [];
      return ctx;
    }

    const input = sections.map((s) =>
      `【${s.name}】\n${s.tldr ? `要点：${s.tldr}\n` : ''}条目：${s.titles.join('；')}`
    ).join('\n\n');

    const { content, usage } = await llm.complete({
      system: `你是金融市场总编，要把各市场专栏综合成一份「今日金融市场汇总」。
要求：输出 8-12 条要点，覆盖各市场重要动态，按重要性排序。每条 25-60 字，含具体数据或事件。
跨市场联动可以合并。每条不要以市场名前缀开头。
严格返回 JSON：{"tldr": ["要点一", "要点二", ...]}`,
      user: `以下是今日各金融专栏内容摘要，请综合成汇总。\n\n${input}`,
      responseFormat: 'json',
    });

    ctx.digestContent = Array.isArray(content?.tldr) ? content.tldr : [];
    ctx._usage = ctx._usage || {};
    ctx._usage.digest = usage;
    console.log(`  生成 ${ctx.digestContent.length} 条汇总，token：in=${usage.inputTokens} out=${usage.outputTokens}`);
    return ctx;
  }
}
