# Yuunagi Dashboard

个人信息聚合看板——**多源数据采集 → LLM 流水线加工 → 多模板报告生成 → 自动部署**。每日产出时事简报与金融多视角报告（市场概览、板块扫描、资产聚焦、联动观察），全部由 GitHub Actions 定时驱动。

## 架构概览

项目分四个子系统，从上到下依次是：

```
┌─────────────────────────────────────────────────────────┐
│                    信息搜集层 (Sources)                   │
│  RSS (7源) │ 新浪行情 (10指数+3资产) │ 新浪财经新闻      │
│  BTC (CoinGecko→Gate.io) │ KOSPI │ 美债10Y │ Tushare    │
│  每个源封装为一个 Source 适配器，统一接口，插拔式注册       │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    编排层 (Pipeline + Agent)              │
│  ingest(抓取+去重) → select(精选合并) → summarize(摘要)   │
│  → tldr(总览) → [agent(自主推理)] → render(模板渲染)      │
│  每步独立 Stage，按 jobs.yml 灵活组合                     │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    模板构造层 (Renderers)                │
│  6 种报告模板：时事/市场概览/板块扫描/资产聚焦/联动观察    │
│  共享 helpers：yamlStr、chart.xkcd、sparkline、表格       │
│  每个模板独立文件，新增报告不改现有代码                     │
└──────────────────────────┬──────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────┐
│                    结果输出层 (CI/CD)                     │
│  Hugo markdown → GitHub Actions commit/push → Deploy     │
│  GitHub Pages 部署，定时 cron + 手动 workflow_dispatch     │
└─────────────────────────────────────────────────────────┘
```

## 一、信息搜集层

### 1.1 Source 抽象

所有数据源统一实现 `ItemSource`（产出新闻条目）或 `MarketSource`（产出行情报价）。

```js
// 新闻源：产出可去重的 NewsItem
class RssSource extends ItemSource {
  async fetch()  { /* HTTP → XML parse → stripContent */ }
  normalize(raw) { /* → NewsItem[]，含 splitAggregated 拆分 */ }
}

// 行情源：产出不上重的 Quote
class SinaQuoteSource extends MarketSource {
  async fetch()  { /* GBK 批量请求 Sina hq API */ }
  normalize(lines) { /* 多格式解析 → Quote[] */ }
}
```

**加新源只需写一个文件**，在 `sources/index.js` 注册即可。不改 pipeline、不改 stage。

### 1.2 RSS 多源聚合

`scripts/feeds.yml` 定义 7 个 RSS 源，按 category 分三类（国内/国际/科技），每源可配独立时间窗。

| 源 | 分类 | 特殊处理 |
|---|---|---|
| 橘鸦日报 | 科技 | `window: 48h`（日更聚合，当天含昨日内容）；**splitAggregated** 拆分（摘要里用 `↗ N` 标记分隔多条新闻，自动拆成独立条目） |
| MIT 科技评论、Solidot | 科技 | 通用 RSS（8 步 HTML 实体解码 + 多字段 fallback） |
| 联合早报、iDaily | 国际 | 通用 RSS |
| 新华社、人民日报 | 国内 | 通用 RSS |

**7 个源并发抓取**（`Promise.all`），单源失败不阻塞。`stripHeavyContent` 在 XML 解析前剥离 `<content:encoded>` 块（防实体扩展上限保护），8 步实体解码保证 `&lt; &gt; &amp;` 正确处理。

### 1.3 行情数据在线拉取

行情数据**不存本地**——本地库只做新闻去重（`seen.json` + `recent-events.json`）。行情在线拉取：

| 数据 | API | 格式 |
|---|---|---|
| A 股/港股/美股/亚太指数 + 商品 | 新浪 HQ API | 批量 `list=` 请求，GBK 解码，按前缀区分 33/4/HK 三种字段格式 |
| BTC | CoinGecko → Gate.io fallback | 多源容错，首成功即用 |
| 韩国 KOSPI | Eastmoney | 独立请求 |
| 美债 10Y | Yahoo Finance `^TNX` | 收益率为 bp 单位 |
| 申万行业指数 + 北向资金 | Tushare | `sw_daily` + `moneyflow_hsgt` |

**汇率 `DINIW` 已知问题**：字段布局与假定不符（`fields[2]` 等于 `fields[1]` 而非前收盘价），当前用 `fields[7]`(low) 兜底。待工作日有真实波动时精确定位前收盘价字段。

**历史数据回拉**：`get_history_series` 工具在本地历史不足时，自动在线拉取（BTC → CoinGecko market_chart / A 股 → Tushare daily），拉取结果合并到当次运行的 marketHistory 中供 sparkline 使用。

### 1.4 三条去重线

**机械去重**（`ingest.js` 内联 dedupe）——纯脚本，处理 URL/标题重复：
- **第一层**：URL 精确 hash（FNV-1a base36，跨源转载同一 URL）
- **第二层**：标题精确 hash（归一化后计算）
- **第三层**：标题 bigram Jaccard 相似度 > 0.7（同事件不同措辞）
- **时间窗**：`dedupeWindowMs = max(job 窗口, 各 source 窗口)`，无日期的条目保守保留
- **同日跨报告**：`seen` 值等于今天的记录标记为同批次（保留），小于今天的才是跨天重复（过滤）

**语义去重**（select stage + `recent-events.json`）——LLM 判断延续报道：
- 每次 render 后将发布的事件标题存入 `data/recent-events.json`
- 下次 select 时将近期标题注入 prompt `{recent}` 占位符
- LLM 判断候选条是"延续报道"还是"全新事件"

**hash 统一**：`NewsItem` 构造时自动计算 `urlHash`/`titleHash`（`core/item.js` 唯一定义），全系统共享——不再散落在 dedupe/fetch-finance-news 中重复实现。

---

## 二、编排层

### 2.1 Pipeline 阶段注册

阶段定义为 `Stage` 子类，各有一个 `run(ctx, llm) => ctx` 签名：

| Stage | needsLLM | 职责 |
|---|---|---|
| `ingest` | ✗ | 调所有 Source 抓取 → 去重 → ctx.items + ctx.marketData |
| `select` | ✓ | LLM 精选合并同事件报道 + 跨天语义去重（注入 recent-events） |
| `summarize` | ✓ | LLM 为每个事件生成中文摘要（最贵阶段，但只处理 select 筛选后的 N 条） |
| `tldr` | ✓ | LLM 基于摘要生成 4-6 条总览要点 |
| agent（可选） | ✓ | LLM 自主调工具完成分析任务（function calling 多轮循环） |

`Pipeline.run()` 按 `jobs.yml` 的 `workflow` 字段顺序执行，并支持 `clean/fetch → ingest` 别名向后兼容。

### 2.2 Job 系统

5 个 Job 共享 `ingest` 基础数据，差异在 `stage → agent → renderer` 组合：

| Job | 数据 | Workflow | Agent | Renderer | 触发 |
|---|---|---|---|---|---|
| `daily-news` | 7 RSS → 3 分类 | ingest→select→summarize→tldr | — | news | cron 19:00 + 手动 |
| `daily-market` | 行情+新闻 | ingest→select→summarize→tldr | — | finance | cron 19:15 + 手动 |
| `sector-scan` | 行情+新闻+Tushare | ingest→select→summarize | sector-commentary | sectors | 手动 |
| `asset-focus` | 同上 | ingest→select→summarize | focus-analysis | focus | 手动 |
| `cross-linkage` | 同上 | ingest→select→summarize | linkage-analysis | linkage | 手动 |

只有 `daily-news` 和 `daily-market` 设了 cron；其余通过 GA `workflow_dispatch` 手动触发。

### 2.3 Agent 系统

原生 function-calling，零框架依赖（**未上 LlamaIndex**，DeepSeek API 直接支持）。`agents/agent.js` 提供通用 `runAgent` 循环——给 LLM 一组工具定义，让它自主决定调用顺序与次数，循环到产出最终文本。

**Agent 能力**：
```
runAgent({ llm, system, user, tools, toolHandlers })
  │
  ├─ 1. system + user → 首轮 chat（附带 tools 定义）
  ├─ 2. LLM 返回 tool_calls → 逐个执行 handler → 结果塞回 messages
  ├─ 3. 再次 chat → 可能继续调工具，或给出最终文本
  └─ 4. maxRounds 防失控（默认 6 轮），超限强制收尾
```

**三个 Agent Profile**（`agents/*.js`），每个定义自己的 `system` 提示词、`tools` 工具集、`buildHandlers` 闭包工厂：

| Profile | 工具 | 职责 |
|---|---|---|
| `sector-commentary` | snapshot + history + news | 全貌扫描 → 针对异常板块查历史/新闻 → 板块风格点评 |
| `focus-analysis` | snapshot + history + news | 查单品种行情 → 查近 7 天走势 → 查驱动新闻 → 深度分析 |
| `linkage-analysis` | find_correlations + history + news | 批量算所有品种对相关系数 → 对 top 配对查新闻解释因果 |

**工具**（`tools/*.js`）也是普通函数，agent 通过名字分发：
- `get_market_snapshot`（按板块/品种名/全部查当日行情）
- `get_history_series`（查近 N 天收盘价序列，不足时回拉 API）
- `get_finance_news`（按关键词/全部查当日金融要闻）
- `compute_correlation`（单对 Pearson 相关系数）
- `find_correlations`（批量算所有配对，返回 top 强正/强负相关）

### 2.4 状态管理

`core/store.js` 统管三个 state 文件（`seen.json` / `recent-events.json` / 行情不再存），CI 用 `.json` 提交 repo，本地用 `.local.json` 隔离。`isCI` 只算一次。

**seen.json**：`{ urls: {hash: YYYY-MM-DD}, titles: {hash: YYYY-MM-DD} }`，5000 条目上限，超出按日期淘汰最早。

**recent-events.json**：`{ jobs: { jobName: { YYYY-MM-DD: [标题...] } } }`，每 job 保留最近 3 天，供 select 语义去重。

---

## 三、模板构造层

### 3.1 Renderer 系统

6 个 Renderer，每个产出 `{ path, content, processed }`。共享函数集中在 `renderers/helpers.js`：

- `yamlStr` / `jsonSafe`：YAML frontmatter 安全输出 / chart 内联 JSON 转义
- `renderChangeHtml` / `renderQuoteChange`：涨跌 `<span class="up/down">` 渲染
- `renderNewsItem`：新闻条目渲染
- `renderBarChart` / `renderSparkline` / `renderPairChart`：chart.xkcd 图表注入
- `collectProcessed` / `findQuote` / `sectorAvg`：数据提取

### 3.2 chart.xkcd 图表

cd 图表通过 raw HTML/JS 内联到 markdown（Hugo `unsafe=true`），`if(!window.chartXkcd)return` 守卫防止 CDN 不可用时页面崩溃。

**图表类型**：
- **柱状图（Bar）**：各指数/板块当日涨跌幅对比，正绿负红
- **sparkline（Line）**：资产近 7 天走势折线，历史不足 3 天自动跳过
- **双线对比（Line）**：两品种归一化折线，用于联动观察

### 3.3 各报告内容结构

| 报告 | 核心内容 |
|---|---|
| **daily-news** | frontmatter(tldr 4-6条信息密集要点) + `## 国内 / 国际 / 科技` 分类条目 |
| **daily-market** | 指数表 + Bar 图表 + 资产板块(sparkline+匹配新闻) + 金融要闻 |
| **sector-scan** | agent 板块点评 + 板块对比 Bar 图 + A股/港股/美股/亚太/商品/加密明细 + 申万行业(如 Tushare 可用) + 北向资金 |
| **asset-focus** | 品种价格+OHLC+sparkline + agent 深度分析 + 相关要闻 |
| **cross-linkage** | agent 联动点评 + 强相关品种对表格 + 双线对比图 |

### 3.4 前端展示

**首页**（`layouts/index.html`）：左侧悬浮导航 + 文章卡片瀑布流。每张卡片依次显示：分类标签 → 标题 → 时间 → **TL;DR 摘要**（`.Params.tldr` 渲染为列表，左边框强调） → 正文。

**文章页**（`layouts/single.html`）：大标题 hero + TL;DR 侧边栏 + 正文（含图表）。

**暗色模式**：`[data-theme="dark"]` 下的卡片阴影增强，边框弱化。

**外部库**：chart.xkcd（图表）、gridjs（表格，已加载未用）、KaTeX（数学公式）、Lenis（平滑滚动）、Turbo（瞬时页面切换）。

---

## 四、结果输出层

### 4.1 本地运行

```bash
cd scripts

# 生产一份时事简报
node v2/index.js --job=daily-news

# dry-run（不写文件、不调 LLM？—— 会调 LLM，但不写盘不更新 state）
node v2/index.js --job=daily-news --dry-run

# 只看抓取结果
node v2/index.js --job=daily-news --stop-after=ingest

# 金融报告
node v2/index.js --job=daily-market
node v2/index.js --job=sector-scan
node v2/index.js --job=asset-focus
node v2/index.js --job=cross-linkage
```

或通过 npm scripts：
```bash
npm run daily-news
npm run daily-market
npm run sector-scan
npm run asset-focus
npm run cross-linkage
```

### 4.2 GitHub Actions CI/CD

**三个 Workflow**（`.github/workflows/`）：

| Workflow | 触发 | 流程 |
|---|---|---|
| `deploy.yml` | push + 手动 | checkout(含 submodule) → Hugo build(`--gc --minify`) → `peaceiris/actions-gh-pages` 部署 |
| `fetch-news.yml` | cron `0 11 * * *`(北京 19:00) + 手动 | checkout → Node 22 → `npm ci` → `node v2/index.js --job=daily-news` → commit/push |
| `fetch-finance.yml` | cron `15 11 * * *`(北京 19:15) + 手动 | 同上，但 job 通过 `inputs.job` 选择（手动可选 daily-market/sector-scan/asset-focus/cross-linkage） |

**push 冲突处理**：并发 push 时优雅跳过（`git push 2>/dev/null || echo "..."`），不阻塞 workflow，下次运行重试。

**环境变量**（GA Secrets）：
- `DEEPSEEK_API_KEY`：LLM API key（必须）
- `TUSHARE_TOKEN`：Tushare 数据（可选，无则跳过申万行业/北向资金）

### 4.3 Hugo 配置

- `baseURL`: `https://uynajgi.github.io/yuudashboard/`
- 主题：PaperMod（submodule，HTTPS 地址，`submodules: true`）
- `uglyurls: true`（URL 以 `.html` 结尾，非目录）
- `unsafe: true`（允许 markdown 中 raw HTML，chart 图表 / 内联 script 依赖此选项）
- `[minify] disableJS: true`（Hugo 的 JS minifier 不兼容 chart.xkcd 内联 script）
- KaTeX 数学公式（`$$…$$` / `$…$` 自动渲染）
- 日文支持（`defaultContentLanguage = zh`）

### 4.4 部署流程（完整链路）

```
定时 cron / 手动 workflow_dispatch
  ↓
GA: checkout → setup Node 22 → npm ci → run pipeline
  ↓
生成 content/{section}/{date}-*.md (Hugo markdown)
  ↓
git commit + push (冲突时优雅跳过)
  ↓
push 触发 deploy.yml
  ↓
Hugo build → gh-pages 部署
  ↓
https://uynajgi.github.io/yuudashboard/ 上线
```

---

## 五、开发指南

### 5.1 加新数据源

1. 写 `v2/sources/xxx.js`，继承 `ItemSource` 或 `MarketSource`，实现 `fetch()` + `normalize()`
2. 在 `v2/sources/index.js` import 并注册到 `buildSources()`
3. 如果是行情源，`ingest.js` 的 marketResults 循环会自动处理
4. 需要 per-source config 字段的，在 `feeds.yml` 加，构造时从 `config` 读

### 5.2 加新报告模板

1. 如需 agent 分析：写 `v2/agents/xxx.js`（定义 system / tools / buildHandlers）
2. 写 `v2/renderers/xxx.js`（导入 `helpers.js`，实现 `renderXxx(ctx)`）
3. 在 `v2/index.js` 注册 RENDERERS/AGENTS
4. `jobs.yml` 加一行 job 配置（workflow / renderer / agent / output）
5. 手动触发即用

### 5.3 加新 Agent 工具

1. 在 `v2/tools/` 下写工具文件（导出 `xxxDef` + `makeXxx(ctx)`）
2. 在需要的 agent profile 里 import 并注册到 tools / buildHandlers

### 5.4 项目结构

```
scripts/
├── v2/                        # 当前活跃管线
│   ├── core/                  # 核心抽象
│   │   ├── item.js            # NewsItem + Quote + hash
│   │   ├── source.js          # ItemSource + MarketSource + FallbackMarketSource
│   │   ├── store.js           # 统一 Store（seen + recent-events）
│   │   ├── pipeline.js        # Pipeline 编排器
│   │   ├── util.js            # 纯函数（windowToMs / similarity / pearson）
│   │   └── series.js          # 历史序列查询
│   ├── sources/               # 数据源适配器（每个源一个文件）
│   ├── stages/                # Pipeline 阶段（ingest / select / summarize / tldr）
│   ├── agents/                # Agent profiles + runAgent loop
│   ├── tools/                 # Agent 工具
│   ├── renderers/             # 报告模板 + helpers
│   ├── index.js               # CLI 入口
│   ├── config.js              # 配置加载（jobs.yml / feeds.yml → ctx）
│   └── prompt.js              # Prompt 加载器
├── src/                       # 旧管线（已停用，保留备查）
├── jobs.yml                   # Job 定义
├── feeds.yml                  # RSS 源清单
├── prompts/                   # Prompt 模板（daily- / finance-）
└── package.json
```

### 5.5 技术栈

| 层 | 技术 |
|---|---|
| 管线 | Node 22, ESM, undici(HTTP+IPv4), fast-xml-parser(RSS), iconv-lite(GBK), js-yaml |
| LLM | DeepSeek API (deepseek-v4-flash), function calling |
| 静态站 | Hugo 0.163 + PaperMod 主题 |
| 前端 | chart.xkcd, KaTeX, Lenis, Turbo |
| 部署 | GitHub Pages + GitHub Actions |
