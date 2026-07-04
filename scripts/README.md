# RSS → LLM → Hugo 简报管道

把 RSS 信息源 → 脚本清洗 → 多阶段 LLM 工作流 → Hugo markdown 简报，自动化产出每日新闻。

## 快速开始

```bash
cd scripts
cp .env.example .env        # 填入 DEEPSEEK_API_KEY
npm install

# 完整跑（抓取 → LLM → 写盘）
npm run daily

# 只看脚本清洗结果（0 token，调试用）
npm run clean-only

# 跑完整流程但不写盘（预览生成内容）
npm run dry
```

生成文件落在 `content/news/{date}-daily-brief.md`，会被 Hugo 正常渲染（TL;DR aside + 三类正文）。

## 架构

```
RSS 8 源
   │
   ▼  Stage 0 · clean（纯脚本，0 token）
   │  并发抓取 → HTML 剥离 → 时间窗过滤 → 三层去重 → 分组
   ▼
   │  Stage 1 · select（LLM，每类 1 次）
   │  识别同事件多源报道 → 合并 → 按重要度选 top N
   │  输出极小（只有事件 id 索引）
   ▼
   │  Stage 2 · summarize（LLM，每类 1 次，最贵）
   │  只对精选出的 N 条生成中文摘要
   │  ← 关键省 token：summarize 只读 5 条而非全部 20+ 条
   ▼
   │  Stage 3 · tldr（LLM，全局 1 次）
   │  基于摘要产出 3 条总览要点
   ▼
render.js → content/news/{date}-daily-brief.md
```

**为什么分阶段**：脚本做免费清洗（时间窗/去重/截断），LLM 越往后看到的数据越精越少。summarize 是最贵阶段，但它只处理 select 筛出的 5 条，不是全部候选。

## 配置文件（数据驱动，改配置不改代码）

### `feeds.yml` — 信息源

```yaml
- name: 源显示名
  url: RSS/Atom URL
  category: 国内 | 国际 | 科技
```

加源 = 加几行；删源 = 删几行；临时关源 = 加 `enabled: false`。

### `jobs.yml` — 简报任务

定义所有简报任务（daily / 早晚报 / 周报 等）。每个 job：

```yaml
- name: daily
  schedule: "0 0 * * *"           # 文档用，实际触发看 GA workflow cron
  section: news
  window: 24h                     # 时间窗：24h / 7d / 30d
  categories: [国内, 国际, 科技]
  top_n_per_category: 5           # 每类精选上限
  workflow: [clean, select, summarize, tldr]
  prompt_prefix: daily            # prompts/daily-{stage}.md
  output: content/news/{date}-daily-brief.md
  tags: [时事]
```

加新简报（如周报）：复制一份 job 配置改参数即可。

## 切换 LLM Provider

1. 在 `src/llm/` 新建实现文件，继承 `LLMProvider`，实现 `complete()`
2. 在 `src/llm/index.js` 的 `REGISTRY` 注册
3. 改 `.env` 的 `LLM_PROVIDER`

业务代码（workflow / render）完全不动。

## 幂等与安全

- **文件级**：`{date}-daily-brief.md` 同日重跑覆盖，无重复
- **内容级**：`data/seen.json` 记录已发布 hash，跨日不重推
- **失败隔离**：单源失败跳过；LLM 失败保留原标题；全失败不 commit
- **State 淘汰**：seen.json 超 5000 条自动淘汰最旧

## CLI 参数

```bash
node src/index.js --job=daily                    # 跑指定 job
node src/index.js --job=daily --dry-run          # 不写盘，预览
node src/index.js --job=daily --stop-after=clean # 只跑到 clean 阶段
```

## 目录结构

```
scripts/
├── feeds.yml                # 源列表（你维护）
├── jobs.yml                 # 任务配置（你维护）
├── package.json
├── .env.example             # key 模板，复制为 .env
├── src/
│   ├── index.js             # 入口
│   ├── config.js            # 加载配置 + CLI
│   ├── fetch.js             # RSS 抓取
│   ├── dedupe.js            # 三层去重
│   ├── state.js             # seen.json 读写
│   ├── prompt.js            # 提示词加载
│   ├── render.js            # md 渲染
│   ├── llm/
│   │   ├── provider.js      # 抽象接口
│   │   ├── deepseek.js      # DeepSeek 实现
│   │   └── index.js         # 工厂
│   └── workflow/
│       ├── clean.js         # Stage 0
│       ├── select.js        # Stage 1
│       ├── summarize.js     # Stage 2
│       ├── tldr.js          # Stage 3
│       └── index.js         # 编排
└── prompts/
    ├── daily-select.md
    ├── daily-summarize.md
    └── daily-tldr.md
```
