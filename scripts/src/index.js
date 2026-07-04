// 主入口：CLI 解析 → 构建上下文 → 工作流 → 渲染 → 写文件 → 更新 state。
// 用法：
//   node src/index.js --job=daily              # 完整跑
//   node src/index.js --job=daily --dry-run    # 跑但不写文件、不更新 state
//   node src/index.js --job=daily --stop-after=clean   # 只看脚本清洗结果
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { buildContext, parseArgs } from './config.js';
import { createLLM } from './llm/index.js';
import { runWorkflow } from './workflow/index.js';
import { render } from './render.js';
import { renderFinance } from './render-finance.js';
import { renderWeekly } from './render-weekly.js';
import { renderSectors } from './render-sectors.js';
import { renderFocus } from './render-focus.js';
import { renderLinkage } from './render-linkage.js';
import { runAgent } from './agent.js';
import * as sectorsAgent from './agents/sectors-commentary.js';
import * as focusAgent from './agents/focus-analysis.js';
import * as linkageAgent from './agents/linkage-analysis.js';
import { saveState } from './state.js';

// Renderer 注册表：jobs.yml 的 renderer 字段选择，缺省按 section 兜底。
// 新增汇报模板：写一个 render-xxx.js + 在此注册 + jobs.yml 加 renderer: xxx 即可。
const RENDERERS = {
  news: render,
  finance: renderFinance,
  weekly: renderWeekly,
  sectors: renderSectors,
  focus: renderFocus,
  linkage: renderLinkage,
};

// Agent profile 注册表：jobs.yml 的 agent 字段选择。
// agent 在 workflow 后、render 前执行，结果挂到 ctx.agentResult 供 renderer 用。
// 新增 agent：写一个 agents/xxx.js + 在此注册 + jobs.yml 加 agent: xxx。
const AGENTS = {
  'sectors-commentary': sectorsAgent,
  'focus-analysis': focusAgent,
  'linkage-analysis': linkageAgent,
};

async function main() {
  const args = parseArgs(process.argv);
  console.log(`\n════════════════════════════════════════`);
  console.log(`  job: ${args.job}  ${args.dryRun ? '(dry-run)' : ''}  ${args.stopAfter ? `(stop-after: ${args.stopAfter})` : ''}`);
  console.log(`════════════════════════════════════════\n`);

  const ctx = buildContext(args);
  console.log(`日期（北京）：${ctx.date.str}`);

  // 判断是否需要 LLM（stop-after=clean 或 workflow 全是脚本时不需要）
  const needsLLM = !args.stopAfter || ctx.job.workflow?.some((s) => s !== 'clean' && ctx.job.workflow.indexOf(s) <= ctx.job.workflow.indexOf(args.stopAfter) && s !== 'clean');
  // 简化：只要 stopAfter 不是 clean 之前就建 LM
  const stages = ctx.job.workflow || ['clean', 'select', 'summarize', 'tldr'];
  const stopIdx = args.stopAfter ? stages.indexOf(args.stopAfter) : stages.length;
  const willCallLLM = stages.slice(0, stopIdx + 1).some((s) => ['select', 'summarize', 'tldr'].includes(s))
    || (!!ctx.job.agent && !args.stopAfter); // agent 阶段也需要 LLM

  const llm = willCallLLM ? createLLM() : null;

  await runWorkflow(ctx, llm, args.stopAfter);

  // Agent 阶段：job.agent 指定的 profile，在 workflow 后、render 前执行。
  // 结果挂到 ctx.agentResult，供 renderer（如 sectors）使用。
  if (ctx.job.agent && !args.stopAfter) {
    const profile = AGENTS[ctx.job.agent];
    if (!profile) throw new Error(`未知 agent: "${ctx.job.agent}"（AGENTS 仅识别 ${Object.keys(AGENTS).join('/')}）`);
    if (!llm) throw new Error(`agent "${ctx.job.agent}" 需要 LLM，但未配置 API key`);
    console.log(`\n── Agent · ${ctx.job.agent} ──`);
    const agentResult = await runAgent({
      llm,
      system: profile.system,
      user: profile.buildUser(ctx),
      tools: profile.tools,
      toolHandlers: profile.buildHandlers(ctx),
    });
    ctx.agentResult = agentResult;
    console.log(`  agent 完成：${agentResult.rounds} 轮工具调用，in=${agentResult.usage.inputTokens} out=${agentResult.usage.outputTokens}`);
  }

  // 若因 stop-after 提前结束，不渲染写盘
  if (args.stopAfter) {
    console.log('\n（提前结束，未渲染/写盘）');
    if (ctx.marketData) {
      console.log('\n--- 市场数据预览 ---');
      for (const it of ctx.marketData.indices) console.log(`  · ${it.name} ${it.priceStr} ${it.changeStr}`);
      for (const it of ctx.marketData.assets) console.log(`  · ${it.name} ${it.priceStr} ${it.changeStr}`);
      if (ctx.marketData.btc) console.log(`  · BTC ${ctx.marketData.btc.priceStr} ${ctx.marketData.btc.changeStr}`);
    }
    if (ctx.items && typeof ctx.items === 'object') {
      console.log('\n--- 新闻候选预览 ---');
      for (const [cat, list] of Object.entries(ctx.items)) {
        if (!Array.isArray(list)) continue;
        console.log(`\n[${cat}] ${list.length} 条`);
        list.slice(0, 3).forEach((it) => console.log(`  · ${it.title} (${it.source})`));
      }
    }
    return;
  }

  // 失败安全：全无内容则不写盘
  const isFinance = ctx.job.section === 'finance';
  const newsCount = Object.values(ctx.summarized).flat().length;
  const marketCount = isFinance
    ? ((ctx.marketData?.indices?.length || 0) + (ctx.marketData?.assets?.length || 0))
    : 0;
  if (newsCount === 0 && marketCount === 0) {
    console.warn('\n⚠ 全无内容（新闻和市场数据都空），不写盘');
    process.exit(1);
  }

  // Renderer 选择：jobs.yml 的 renderer 字段优先，缺省按 section 兜底
  const rendererKey = ctx.job.renderer ?? (isFinance ? 'finance' : 'news');
  const renderer = RENDERERS[rendererKey];
  if (!renderer) throw new Error(`未知 renderer: "${rendererKey}"（RENDERERS 仅识别 ${Object.keys(RENDERERS).join('/')}）`);
  const renderResult = renderer(ctx);
  // renderer 可返回单对象或数组（多报告输出）；统一成数组处理
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

  // 写文件（支持多报告）
  for (const r of results) {
    const absPath = resolve(ctx.repoRoot, r.path);
    mkdirSync(dirname(absPath), { recursive: true });
    writeFileSync(absPath, r.content, 'utf8');
    console.log(`✓ 已写入 ${r.path}`);
  }

  // 更新 seen state：processed 取所有 result 并集（去重）
  const allProcessed = results.flatMap((r) => r.processed || []);
  saveState(ctx.repoRoot, ctx._seen, allProcessed);

  // 成本统计（workflow 各 stage + agent）
  const stageUsage = ctx._usage ? Object.values(ctx._usage).reduce(
    (a, u) => ({ inputTokens: a.inputTokens + u.inputTokens, outputTokens: a.outputTokens + u.outputTokens }),
    { inputTokens: 0, outputTokens: 0 },
  ) : { inputTokens: 0, outputTokens: 0 };
  const agentUsage = ctx.agentResult?.usage || { inputTokens: 0, outputTokens: 0 };
  const total = {
    inputTokens: stageUsage.inputTokens + agentUsage.inputTokens,
    outputTokens: stageUsage.outputTokens + agentUsage.outputTokens,
  };
  if (total.inputTokens || total.outputTokens) {
    // DeepSeek 价格（参考）：输入 ¥1/M tokens，输出 ¥2/M tokens（deepseek-chat 缓存未命中）
    const cost = (total.inputTokens * 1 + total.outputTokens * 2) / 1_000_000;
    const agentNote = ctx.agentResult ? `（含 agent ${ctx.agentResult.rounds} 轮）` : '';
    console.log(`\n本次 token：in=${total.inputTokens} out=${total.outputTokens} ≈ ¥${cost.toFixed(4)} ${agentNote}`);
  }

  console.log('\n✓ 完成\n');
}

main().catch((e) => {
  console.error('\n✗ 失败：', e.message);
  if (process.env.DEBUG) console.error(e.stack);
  process.exit(1);
});
