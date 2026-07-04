// pipeline 编排器：stage 注册 + ctx 传递。
// 与旧 workflow/index.js 对应，但 stage 用类（有 needsLLM 元信息）。

/**
 * Stage 基类。子类实现 run(ctx, llm) => ctx。
 * needsLLM 决定是否传入 llm 实例（false 时传 null）。
 */
export class Stage {
  constructor({ name, needsLLM = false }) {
    this.name = name;
    this.needsLLM = needsLLM;
  }
  async run(_ctx, _llm) {
    throw new Error(`Stage "${this.name}".run() 必须由子类实现`);
  }
}

/**
 * Pipeline：持有 stage 注册表，按顺序执行。
 */
export class Pipeline {
  constructor() {
    this.stages = new Map();
  }

  /** 注册 stage */
  register(stage) {
    if (!(stage instanceof Stage)) throw new Error('register 需要 Stage 实例');
    this.stages.set(stage.name, stage);
    return this;
  }

  /**
   * 按 ctx.job.workflow 顺序跑各 stage。
   * @param {object} ctx
   * @param {object|null} llm  LLM provider（无 LLM 阶段传 null）
   * @param {string|null} stopAfter  调试用：跑到某 stage 后停
   */
  async run(ctx, llm, stopAfter = null) {
    // v2 用 ingest 替代旧的 clean/fetch；兼容旧 jobs.yml 里的 clean/fetch → ingest
    const STAGE_ALIASES = { clean: 'ingest', fetch: 'ingest' };
    const rawFlow = ctx.job.workflow || ['ingest', 'select', 'summarize', 'tldr'];
    const flow = rawFlow.map((s) => STAGE_ALIASES[s] || s);
    const stopAfterResolved = stopAfter ? (STAGE_ALIASES[stopAfter] || stopAfter) : null;
    let stopped = false;

    for (const name of flow) {
      if (stopped) break;
      const stage = this.stages.get(name);
      if (!stage) throw new Error(`未知 stage: ${name}（已注册：${[...this.stages.keys()].join(', ')}）`);
      const llmForStage = stage.needsLLM ? llm : null;
      ctx = await stage.run(ctx, llmForStage);
      if (stopAfterResolved === name) {
        console.log(`\n⏹ --stop-after=${stopAfter}，pipeline 暂停`);
        stopped = true;
      }
    }
    return ctx;
  }
}
