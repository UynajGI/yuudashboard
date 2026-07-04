# Yuunagi Dashboard

个人信息聚合看板——**多源数据采集 → LLM 流水线加工 → 多模板报告生成 → 自动部署**。每日产出 11 篇报告：4 个时事专栏 + 1 个时事汇总 + 5 个金融专栏 + 1 个金融汇总，全部由 GitHub Actions 定时驱动。

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

`scripts/feeds.yml` 定义 62 个 RSS 源，按 category 分四类（国内/国际/科技/工程），每源可配独立时间窗和 `jobs` 筛选（限制哪些专栏使用此源）。

| 源 | 分类 | 特殊处理 |
|---|---|---|
| 橘鸦日报 | 科技 | `window: 48h`（日更聚合，当天含昨日内容）；**splitAggregated** 拆分（摘要里用 `↗ N` 标记分隔多条新闻，自动拆成独立条目） |
| MIT 科技评论、Solidot | 科技 | 通用 RSS（8 步 HTML 实体解码 + 多字段 fallback） |
| 联合早报、iDaily | 国际 | 通用 RSS |
| 新华社、人民日报 | 国内 | 通用 RSS |

**62 个源并发抓取**（`Promise.all`），单源失败不阻塞。`stripHeavyContent` 在 XML 解析前剥离 `<content:encoded>` 块（防实体扩展上限保护），8 步实体解码保证 `&lt; &gt; &amp;` 正确处理。

### 1.3 行情数据在线拉取

行情数据**不存本地**——本地库只做新闻去重（按 section 分文件）。行情在线拉取：

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

**语义去重**（select stage + `recent-events-*.json`）——LLM 判断延续报道：
- 每次 render 后将发布的事件标题存入 `data/recent-events-{section}.json`
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

11 个 Job，按 section 分两大管线，各自"先分后总"：

**时事（news）—— 4 专栏 + 1 汇总**

| Job | 源 | 产出 |
|---|---|---|
| `daily-news-domestic` | 14 国内 RSS | 国内专栏（时政/经济/社会/军事/外交/教育）|
| `daily-news-world` | 12 国际 RSS | 国际专栏（地缘/经贸/社会/军事/科技）|
| `daily-news-tech` | 11 科技 RSS | 科技专栏（AI/半导体/互联网/工具/科研）|
| `daily-news-engineering` | 25 工程博客 | 工程专栏（平台/语言框架/架构/AI工程/安全/开源）|
| `daily-news-digest` | 读 4 专栏 | 今日要闻汇总（LLM 综合 8-12 条）|

**金融（finance）—— 5 专栏 + 1 汇总**

| Job | 源 | 产出 |
|---|---|---|
| `daily-finance-ashare` | 新浪 A 股 + Tushare（申万行业+北向资金）| A 股专栏 |
| `daily-finance-hk` | 新浪港股 + KOSPI | 港股专栏 |
| `daily-finance-us` | 新浪美股 + 美债 10Y | 美股专栏 |
| `daily-finance-commodity` | 新浪黄金/原油/美元 | 商品专栏 |
| `daily-finance-crypto` | BTC（CoinGecko→Gate.io fallback）| 加密专栏 |
| `daily-finance-digest` | 读 5 专栏 + 全市场数据 | 金融市场汇总（LLM + 指数表 + 板块图）|

每个专栏只拉自己市场的数据（`market` 字段）和新闻（`news_filter` 关键词过滤），汇总报告读专栏文件 + 数据平移（重新拉全市场行情）生成图表。

加新报告：jobs.yml 加一行 + 写 renderer（+ agent profile 如需 LLM 分析）。

### 2.3 Agent 系统

原生 function-calling，零框架依赖（**未上 LlamaIndex**，DeepSeek API 直接支持）。`agents/agent.js` 提供通用 `runAgent` 循环——给 LLM 一组工具定义，让它自主决定调用顺序与次数，循环到产出最终文本。

当前金融专栏暂不使用 agent（数据+新闻直接渲染），汇总阶段用独立 DigestStage/FinanceDigestStage 读专栏文件 + LLM 综合。Agent profile 保留可用（sectors-commentary / focus-analysis / linkage-analysis），需要时在 job 配置 `agent` 字段即可启用。

**工具**（`tools/*.js`）也是普通函数，agent 通过名字分发：
- `get_market_snapshot`（按板块/品种名/全部查当日行情）
- `get_history_series`（查近 N 天收盘价序列，不足时回拉 API）
- `get_finance_news`（按关键词/全部查当日金融要闻）
- `compute_correlation`（单对 Pearson 相关系数）
- `find_correlations`（批量算所有配对，返回 top 强正/强负相关）

### 2.4 状态管理

`core/store.js` 按 section 分独立文件，CI 用 `.json` 提交 repo，本地用 `.local.json` 隔离（`*.local` 被 gitignore）。

```
data/
├── seen-news.json              # news 去重（7 天 TTL）
├── seen-finance.json           # finance 去重
├── recent-events-news.json     # news 近期事件标题（供 LLM 跨天语义去重）
└── recent-events-finance.json  # finance 近期事件标题
```

每个 section 独立文件，news 和 finance 互不干扰。saveSeen 每次重新读磁盘再写（避免 stale）。

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

**时事专栏**（4 篇）：frontmatter(tldr 4-6 条) + 按 sub 分组的条目列表

**时事汇总**：LLM 综合 4 专栏 → 8-12 条今日要闻 + 跳转链接回各专栏

**金融专栏**（5 篇）：该市场指数表 + Bar 图 + 新闻（按 sub 分组）。A 股专栏额外含申万行业 + 北向资金

**金融汇总**：LLM 综合 5 专栏 + 全市场指数表 + 板块对比图 + 申万行业 + 北向资金 + 跳转链接

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

# 时事专栏
node v2/index.js --job=daily-news-domestic
node v2/index.js --job=daily-news-world
node v2/index.js --job=daily-news-tech
node v2/index.js --job=daily-news-engineering
node v2/index.js --job=daily-news-digest

# 金融专栏
node v2/index.js --job=daily-finance-ashare
node v2/index.js --job=daily-finance-hk
node v2/index.js --job=daily-finance-us
node v2/index.js --job=daily-finance-commodity
node v2/index.js --job=daily-finance-crypto
node v2/index.js --job=daily-finance-digest

# dry-run（调 LLM 但不写盘不更新 state）
node v2/index.js --job=daily-news-domestic --dry-run

# 只看抓取结果
node v2/index.js --job=daily-news-domestic --stop-after=ingest
```

### 4.2 GitHub Actions CI/CD

**两个 Workflow**（`.github/workflows/`）：

| Workflow | 触发 | 流程 |
|---|---|---|
| `generate.yml` | cron `0 11 * * *`(北京 19:00) + 手动 | news + finance 两个 Job 并行跑（不碰 git）→ publish Job 合并 artifact 一次 push |
| `deploy.yml` | push + 手动 | checkout(含 submodule) → Hugo build → gh-pages 部署 |

**artifact 模式**：news 和 finance 各自跑在独立 Job 里，产出 upload-artifact；publish Job 等两者完成后 download-artifact 合并，**一次 commit + push**。零冲突。

**环境变量**（GA Secrets）：
- `DEEPSEEK_API_KEY`：LLM API key（必须）
- `TUSHARE_TOKEN`：Tushare 数据（可选，无则跳过申万行业/北向资金）

**开发阶段工具**：
```bash
bash scripts/dev.sh reset     # 清空报告 + 重置去重
bash scripts/dev.sh ga        # 触发 GA 全量
bash scripts/dev.sh status    # 查看运行状态
```

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
