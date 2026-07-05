// Stage: summarize —— LLM 为精选事件生成中文摘要。
// 迁移自 src/workflow/summarize.js，逻辑基本不变。
// 金融专栏额外注入当日行情快照，约束摘要里的价格与快照一致（防旧文/误导数字混入）。

import { Stage } from '../core/pipeline.js';
import { loadPrompt } from '../prompt.js';

function renderEvent(ev, idx) {
  const sources = ev.items
    .map((it) => `  · [${it.source}] 《${it.title}》\n    ${it.fullSummary || it.summary}\n    链接：${it.link}`)
    .join('\n');
  return `【事件 ${idx + 1}】${ev.mergedTitle ? `建议标题：${ev.mergedTitle}` : ''}\n${sources}`;
}

/** 把 marketData 渲染成紧凑的资产/指数价格快照（供 LLM 校验价格一致性） */
function renderSnapshot(marketData) {
  if (!marketData) return '';
  const lines = [];
  const indices = [...(marketData.indices || []), ...(marketData.kospi ? [marketData.kospi] : [])];
  if (indices.length) {
    lines.push('指数：' + indices.map((i) => `${i.name} ${i.price}（${(i.changePct ?? 0).toFixed(2)}%）`).join('；'));
  }
  const assets = marketData.assets || [];
  if (assets.length) {
    lines.push('资产：' + assets.map((a) => `${a.name} ${a.price}（${(a.changePct ?? 0).toFixed(2)}%）`).join('；'));
  }
  if (marketData.btc) lines.push(`BTC：${marketData.btc.price}（${(marketData.btc.changePct ?? 0).toFixed(2)}%）`);
  if (marketData.usTreasury) lines.push(`美债 10Y：${marketData.usTreasury.price}（${(marketData.usTreasury.changePct ?? 0).toFixed(2)}%）`);
  return lines.join('\n');
}

export class SummarizeStage extends Stage {
  constructor() {
    super({ name: 'summarize', needsLLM: true });
  }

  async run(ctx, llm) {
    console.log('\n── Stage · summarize ──');
    const prefix = ctx.job.prompt_prefix || 'daily';
    const tpl = loadPrompt(ctx.scriptsDir, prefix, 'summarize');

    // 金融专栏注入当日行情快照（供 LLM 校验价格一致性）
    const snapshot = prefix === 'finance' ? renderSnapshot(ctx.marketData) : '';

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
        .replace('{events}', events.map((ev, i) => renderEvent(ev, i)).join('\n\n'))
        .replace('{snapshot}', snapshot);

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
          // sources/link 强制用真实来源，不信 LLM（会编造假的 reuters/cnbc URL）
          sources: [...new Set(ev.items.map((it) => it.source))],
          link: ev.items[0]?.link || '',
          sub: ev.sub || '',  // LLM 分配的子分类
          _rawItems: ev.items,
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
