// 工作流编排：按 job.workflow 顺序跑各阶段，context 在阶段间传递。
// 加新阶段：① 写 workflow/{name}.js 导出默认 async (ctx, llm) => ctx
//          ② 在 STAGES 注册
//          ③ job.workflow 里加 'name'
import { clean } from './clean.js';
import { fetch } from './fetch.js';
import { select } from './select.js';
import { summarize } from './summarize.js';
import { tldr } from './tldr.js';

// 阶段注册表：name → handler(ctx, llm) => ctx
// clean / fetch 不需要 llm（纯脚本），其他阶段会收到 llm 实例
export const STAGES = {
  clean: { handler: clean, needsLLM: false },
  fetch: { handler: fetch, needsLLM: false }, // 金融管线：API 抓市场数据 + 新闻
  select: { handler: select, needsLLM: true },
  summarize: { handler: summarize, needsLLM: true },
  tldr: { handler: tldr, needsLLM: true },
};

/**
 * 跑工作流。
 * @param {object} ctx
 * @param {object} llm   LLM provider 实例（若 workflow 全是脚本阶段可为 null）
 * @param {string} stopAfter  调试用：跑到某阶段后停（不含后续）
 * @returns {object} ctx
 */
export async function runWorkflow(ctx, llm, stopAfter = null) {
  const stages = ctx.job.workflow || ['clean', 'select', 'summarize', 'tldr'];
  let stopped = false;

  for (const name of stages) {
    if (stopped) break;
    const stage = STAGES[name];
    if (!stage) throw new Error(`未知 workflow 阶段: ${name}（已注册：${Object.keys(STAGES).join(', ')}）`);
    ctx = await stage.handler(ctx, stage.needsLLM ? llm : null);
    if (stopAfter === name) {
      console.log(`\n⏹ --stop-after=${name}，工作流暂停`);
      stopped = true;
    }
  }
  return ctx;
}
