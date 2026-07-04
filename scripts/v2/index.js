// v2 主入口：CLI → buildContext → Pipeline → agent → render → 写文件 → store 更新。
// 用法（与旧 src/index.js 兼容）：
//   node v2/index.js --job=daily
//   node v2/index.js --job=daily --dry-run
//   node v2/index.js --job=finance --stop-after=ingest
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildContext, parseArgs } from './config.js';
import { createLLM } from '../src/llm/index.js'; // 复用旧 LLM provider（无架构依赖）
import { Pipeline } from './core/pipeline.js';
import { IngestStage } from './stages/ingest.js';
import { SelectStage } from './stages/select.js';
import { SummarizeStage } from './stages/summarize.js';
import { TldrStage } from './stages/tldr.js';
import { DigestStage } from './stages/digest.js';
import { FinanceDigestStage } from './stages/finance-digest.js';
import { runAgent } from './agents/agent.js';
import { renderNews } from './renderers/news.js';
import { renderFinanceColumn } from './renderers/finance-column.js';
import { renderFinanceDigest } from './renderers/finance-digest.js';
import { renderDigest } from './renderers/digest.js';
import { collectProcessed } from './renderers/helpers.js';

// Renderer 注册表
const RENDERERS = {
  news: renderNews,
  'finance-column': renderFinanceColumn,
  'finance-digest': renderFinanceDigest,
  digest: renderDigest,
};

// Agent profile 注册表
import * as sectorsAgent from './agents/sectors-commentary.js';
import * as focusAgent from './agents/focus-analysis.js';
import * as linkageAgent from './agents/linkage-analysis.js';
const AGENTS = {
  'sectors-commentary': sectorsAgent,
  'focus-analysis': focusAgent,
  'linkage-analysis': linkageAgent,
};

// 构建并注册 pipeline
const pipeline = new Pipeline();
pipeline.register(new IngestStage())
  .register(new SelectStage())
  .register(new SummarizeStage())
  .register(new TldrStage())
  .register(new DigestStage())
  .register(new FinanceDigestStage());

async function main() {
  const args = parseArgs(process.argv);
  console.log(`\n════════════════════════════════════════`);
  console.log(`  v2 · job: ${args.job}  ${args.dryRun ? '(dry-run)' : ''}  ${args.stopAfter ? `(stop-after: ${args.stopAfter})` : ''}`);
  console.log(`════════════════════════════════════════\n`);

  const ctx = buildContext(args);
  console.log(`日期（北京）：${ctx.date.str}`);

  // 判断是否需要 LLM
  const stages = ctx.job.workflow || ['ingest', 'select', 'summarize', 'tldr'];
  const stopIdx = args.stopAfter ? stages.indexOf(args.stopAfter) : stages.length;
  const willCallLLM = stages.slice(0, stopIdx + 1).some((s) => ['select', 'summarize', 'tldr', 'digest', 'finance-digest'].includes(s))
    || (!!ctx.job.agent && !args.stopAfter);
  const llm = willCallLLM ? createLLM() : null;

  // 1. 跑 pipeline
  await pipeline.run(ctx, llm, args.stopAfter);

  // stop-after 提前结束
  if (args.stopAfter) {
    console.log('\n（提前结束，未渲染/写盘）');
    if (ctx.marketData) {
      console.log('\n--- 市场数据预览 ---');
      for (const it of ctx.marketData.indices) console.log(`  · ${it.name} ${it.price} ${it.changePct?.toFixed(2)}%`);
      for (const it of ctx.marketData.assets) console.log(`  · ${it.name} ${it.price} ${it.changePct?.toFixed(2)}%`);
    }
    if (ctx.items && typeof ctx.items === 'object' && !Array.isArray(ctx.items)) {
      console.log('\n--- 新闻候选预览 ---');
      for (const [cat, list] of Object.entries(ctx.items)) {
        if (!Array.isArray(list)) continue;
        console.log(`\n[${cat}] ${list.length} 条`);
        list.slice(0, 3).forEach((it) => console.log(`  · ${it.title} (${it.source})`));
      }
    }
    return;
  }

  // 失败安全
  const isFinance = ctx.job.section === 'finance';
  const newsCount = Object.values(ctx.summarized).flat().length;
  const marketCount = isFinance ? ((ctx.marketData?.indices?.length || 0) + (ctx.marketData?.assets?.length || 0)) : 0;
  if (newsCount === 0 && marketCount === 0) {
    console.warn('\n⚠ 全无内容，不写盘');
    process.exit(1);
  }

  // 2. agent 阶段（可选）
  if (ctx.job.agent) {
    const profile = AGENTS[ctx.job.agent];
    if (!profile) throw new Error(`未知 agent: "${ctx.job.agent}"`);
    if (!llm) throw new Error(`agent 需要 LLM，但未配置 API key`);
    console.log(`\n── Agent · ${ctx.job.agent} ──`);
    const agentResult = await runAgent({
      llm,
      system: profile.system,
      user: profile.buildUser(ctx),
      tools: profile.tools,
      toolHandlers: profile.buildHandlers(ctx),
    });
    ctx.agentResult = agentResult;
    console.log(`  agent 完成：${agentResult.rounds} 轮，in=${agentResult.usage.inputTokens} out=${agentResult.usage.outputTokens}`);
  }

  // 3. 渲染
  const rendererKey = ctx.job.renderer ?? (isFinance ? 'finance' : 'news');
  const renderer = RENDERERS[rendererKey];
  if (!renderer) throw new Error(`未知 renderer: "${rendererKey}"（RENDERERS: ${Object.keys(RENDERERS).join('/')}）`);
  const renderResult = renderer(ctx);
  const results = Array.isArray(renderResult) ? renderResult : [renderResult];
  console.log(`\n渲染：${results.map((r) => r.path).join(', ')}（renderer: ${rendererKey}）`);

  if (args.dryRun) {
    for (const r of results) {
      console.log(`\n--- 生成内容预览：${r.path} ---\n`);
      console.log(r.content);
    }
    console.log('\n---（dry-run，未写盘、未更新 state）---');
    return;
  }

  // 4. 写文件
  for (const r of results) {
    const absPath = resolve(ctx.repoRoot, r.path);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, r.content, 'utf8');
    console.log(`✓ 已写入 ${r.path}`);
  }

  // 5. 更新 state
  const allProcessed = results.flatMap((r) => r.processed || []);
  ctx.store.saveSeen(ctx.job.section, allProcessed, ctx.date.str);

  const publishedTitles = Object.values(ctx.summarized).flat().map((it) => it.title).filter(Boolean);
  if (publishedTitles.length) {
    ctx.store.saveRecentTitles(ctx.job.name, ctx.date.str, publishedTitles);
  }

  // 6. 成本统计
  const stageUsage = Object.values(ctx._usage || {}).reduce(
    (a, u) => ({ inputTokens: a.inputTokens + u.inputTokens, outputTokens: a.outputTokens + u.outputTokens }),
    { inputTokens: 0, outputTokens: 0 },
  );
  const agentUsage = ctx.agentResult?.usage || { inputTokens: 0, outputTokens: 0 };
  const total = { inputTokens: stageUsage.inputTokens + agentUsage.inputTokens, outputTokens: stageUsage.outputTokens + agentUsage.outputTokens };
  if (total.inputTokens || total.outputTokens) {
    const cost = (total.inputTokens * 1 + total.outputTokens * 2) / 1_000_000;
    console.log(`\n本次 token：in=${total.inputTokens} out=${total.outputTokens} ≈ ¥${cost.toFixed(4)}${ctx.agentResult ? `（含 agent ${ctx.agentResult.rounds} 轮）` : ''}`);
  }

  console.log('\n✓ v2 完成\n');
}

main().catch((e) => {
  console.error('\n✗ 失败：', e.message);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
