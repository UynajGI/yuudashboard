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

/** 把行情数据渲染成 LLM 可读的文本（金融综述用） */
function renderMarketDigest(marketData) {
  if (!marketData) return '';
  const lines = [];
  const indices = [...(marketData.indices || []), ...(marketData.kospi ? [marketData.kospi] : [])];
  if (indices.length) {
    lines.push('【指数表现】\n' + indices.map((i) => `  - ${i.name}：${i.price}（${(i.changePct ?? 0).toFixed(2)}%）`).join('\n'));
  }
  const assets = marketData.assets || [];
  if (assets.length) {
    lines.push('【资产价格】\n' + assets.map((a) => `  - ${a.name}：${a.price}（${(a.changePct ?? 0).toFixed(2)}%）`).join('\n'));
  }
  if (marketData.btc) lines.push(`【BTC】${marketData.btc.price}（${(marketData.btc.changePct ?? 0).toFixed(2)}%）`);
  if (marketData.tushare?.swSectors?.length) {
    const top = [...marketData.tushare.swSectors].sort((a, b) => (b.changePct || 0) - (a.changePct || 0)).slice(0, 5);
    const bottom = [...marketData.tushare.swSectors].sort((a, b) => (a.changePct || 0) - (b.changePct || 0)).slice(0, 5);
    lines.push('【申万行业领涨】\n' + top.map((s) => `  - ${s.name}：${(s.changePct ?? 0).toFixed(2)}%`).join('\n'));
    lines.push('【申万行业领跌】\n' + bottom.map((s) => `  - ${s.name}：${(s.changePct ?? 0).toFixed(2)}%`).join('\n'));
  }
  if (marketData.tushare?.northFlow) {
    const nf = marketData.tushare.northFlow;
    const net = (nf.northMoney || 0) + (nf.southMoney || 0);
    lines.push(`【北向资金】净${net >= 0 ? '流入' : '流出'} ${Math.abs(net / 10000).toFixed(2)} 亿元`);
  }
  return lines.join('\n\n');
}

export class TldrStage extends Stage {
  constructor() {
    super({ name: 'tldr', needsLLM: true });
  }

  async run(ctx, llm) {
    console.log('\n── Stage · tldr ──');
    const prefix = ctx.job.prompt_prefix || 'daily';
    const tpl = loadPrompt(ctx.scriptsDir, prefix, 'tldr');

    // 金融 job：把行情数据也喂给 LLM，让它结合行情写综述
    let digest = renderDigest(ctx.summarized);
    if (prefix === 'finance' && ctx.marketData) {
      const md = renderMarketDigest(ctx.marketData);
      if (md) digest = `## 当日行情数据\n${md}\n\n## 新闻摘要\n${digest}`;
    }

    const prompt = tpl.replace('{digest}', digest);

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
