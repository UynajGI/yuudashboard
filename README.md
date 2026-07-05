# Yuunagi Dashboard

个人信息聚合看板 —— **多源数据采集 → LLM 流水线加工 → 多模板报告生成 → 自动部署**。

每日全自动产出 12 篇 AI 日报（4 时事专栏 + 1 时事汇总 + 6 金融专栏 + 1 金融汇总），覆盖 45 个 RSS 源和全球 6 大金融市场。

**[Demo →](https://uynajgi.github.io/yuudashboard/)** | **[源码 →](https://github.com/UynajGI/yuudashboard)**

## 项目简介

Yuunagi Dashboard 是一套全自动的多源信息聚合与 AI 日报生成系统。系统每日从 45 个 RSS 新闻源和 6 个金融行情 API（新浪财经、CoinGecko、Gate.io、东方财富、Yahoo Finance、Tushare）抓取数据，经 LLM 流水线（DeepSeek API）进行事件合并、中文摘要、要闻提炼，最终生成 12 篇结构化 Markdown 日报，通过 GitHub Actions 自动构建 Hugo 静态站点并部署到 GitHub Pages——全程无人值守。

一句话概括：**把互联网上分散的新闻和行情数据，变成每日一份结构化的 AI 日报。**

## 解决的问题

- **信息过载**：45 个 RSS 源日产 800+ 条标题，人工筛选不可行。系统通过 LLM 精选合并后压缩为 50-80 条带摘要的结构化条目，即可掌握当日全貌
- **同质化报道**：同一事件被数十家媒体重复报道。LLM 在 select 阶段自动识别同事件多源报道并合并，读者看到的是一条事件而非 N 条重复新闻
- **金融信息碎片化**：A 股/港股/美股/加密/商品的行情和新闻分散在不同平台，缺乏统一视图。系统每日产出 5 个单市场专栏 + 1 个跨市场汇总，包含指数表、涨跌图、板块轮动、北向资金
- **每日复盘耗时**：手动整理当日要闻需 1-2 小时。系统全流程自动化，每日 19:00 定时运行

## 核心功能

### 多源数据采集

所有数据源统一实现 `ItemSource`（新闻）或 `MarketSource`（行情）接口，插件式注册：

| 类别 | 来源 | 数量 |
|------|------|------|
| RSS 新闻 | 新华社、人民日报、联合早报、iDaily、MIT 科技评论、Solidot、橘鸦日报等 | 45 源 |
| A 股/港股/美股行情 | 新浪财经 HQ API | 10+ 指数 + 3 类资产 |
| 加密货币 | CoinGecko → Gate.io fallback | BTC |
| 韩国 KOSPI | 东方财富 API | 1 指数 |
| 美债 10Y | Yahoo Finance | 1 指标 |
| 申万行业 + 北向资金 | Tushare | 行业指数 + 资金流向 |

45 源并发抓取（`Promise.all`），单源失败不阻塞。行情数据在线拉取不存本地。

### 三层去重 + LLM 语义去重

- **第一层**：URL 精确 hash（FNV-1a），拦截跨源转载同一 URL
- **第二层**：标题精确 hash（归一化后），拦截同标题复制
- **第三层**：标题 bigram Jaccard 相似度 > 0.7，拦截同事件不同措辞
- **第四层**：LLM 跨天语义去重，判断新条目是"延续报道"还是"全新事件"

### LLM 流水线加工

每个 Job 按 `jobs.yml` 配置的 workflow 顺序执行：

| 阶段 | LLM | 职责 |
|------|:---:|------|
| ingest | - | 并发抓取所有数据源 → 三层去重 → 按类别分组 |
| select | ✓ | LLM 识别同事件多源报道并合并；分配子分类；跨天语义去重 |
| summarize | ✓ | LLM 为每个事件生成 1-2 句中文摘要（≤60 字，信息密集） |
| tldr | ✓ | LLM 基于摘要生成 4-6 条高层要闻（含具体数字和影响判断） |
| digest | ✓ | LLM 综合各专栏日报，生成 8-12 条跨领域要闻汇总 |
| agent | ✓ | LLM 自主调用工具（查行情/查历史/算相关性）完成分析任务 |

每个阶段输出严格 JSON，由下游 renderer 消费。提示词约 10,000 字，经多次迭代精炼。

### 12 篇日报

**时事线（5 篇）**：国内专栏 / 国际专栏 / 科技专栏 / 工程专栏 / 今日要闻汇总

**金融线（7 篇，含亚盘）**：A 股专栏 / 港股专栏 / 亚盘专栏 / 美股专栏 / 商品专栏 / 加密专栏 / 金融市场汇总

**Agent 深度分析（3 篇，附加产出）**：板块点评 / 资产聚焦 / 联动观察

每篇金融专栏含：指数表 + chart.xkcd 涨跌柱状图 + sparkline 走势图 + 分类新闻。A 股专栏额外含申万行业指数和北向资金。汇总报告含全市场指数对比、板块对比图、LLM 跨市场综合点评。

### chart.xkcd 图表

手绘风格金融图表，三种类型内联到 Markdown：
- **Bar**：各指数/板块当日涨跌幅对比（涨绿跌红）
- **Line sparkline**：资产近 7 天走势折线
- **Line 双线**：两品种归一化对比（联动分析用）

`if(!window.chartXkcd)return` 守卫，CDN 不可用时静默降级。

### 前端展示

Hugo 静态站 + PaperMod 主题。首页左侧悬浮导航 + 文章卡片瀑布流（含 TL;DR 摘要预览）。暗色模式自适应。KaTeX 公式渲染、Lenis 平滑滚动、Turbo 瞬时页面切换。

## AI 使用方式与技术方案

### 模型

**DeepSeek V4 Flash**（通过 DeepSeek API 调用，兼容 OpenAI SDK 格式）。选型理由：中文 NLP 性价比最高，摘要和分类任务表现与更大模型差距极小但成本约 1/5。

### AI 在作品中的核心作用

AI 是系统的**核心加工环节**，承担不可替代的认知任务：

1. **事件合并**：识别不同措辞但指向同一事件的标题，合并为一条。这需要语义理解（"央行降准 50bp" = "存款准备金率下调 0.5 个百分点"），纯规则不可能做到
2. **中文摘要**：从多个来源的长篇摘要中提炼 1-2 句核心事实，生成式摘要（abstractive summarization）是 NLP 经典难题
3. **要闻提炼**：在摘要基础上再提升抽象层次，点出"事件 + 关键数字/影响/趋势"，而非简单复述标题
4. **跨天语义去重**：判断当前条目是已有事件的"延续报道"还是"全新事件"，避免跨天重复
5. **跨专栏汇总**：阅读 4-6 篇专栏的 TL;DR 和标题，综合生成跨领域要闻
6. **Agent 自主分析**：LLM 通过 Function Calling 自主决定调用哪些工具、以什么顺序、调用几次，完成分析任务

系统提供 5 个 Agent 工具：`get_market_snapshot`（查当日行情）、`get_history_series`（查历史走势，不足时自动回拉 API）、`get_finance_news`（查金融新闻）、`compute_correlation`（两品种 Pearson 相关系数）、`find_correlations`（批量计算所有配对相关性）。

3 个 Agent Profile：板块点评 / 资产聚焦分析 / 联动观察分析。Agent 循环约 110 行，零框架依赖（不用 LangChain/LlamaIndex），直接基于 DeepSeek API 原生 function calling。

### AI 定位

**核心功能，非辅助**。去掉 LLM 流水线后，系统退化为纯 RSS 聚合器，丧失合并、摘要、去重、汇总等全部高价值能力。

### 技术架构

```
多源数据采集（纯脚本，并发抓取）
       ↓
LLM 流水线加工（DeepSeek API，6 阶段）
  ├── ingest：并发抓取 + 三层去重 + 分类
  ├── select：合并+分类
  ├── summarize：中文摘要
  ├── tldr：要闻提炼
  ├── digest：跨专栏汇总
  └── agent：自主工具调用
       ↓
模板渲染（纯脚本 + chart.xkcd 图表内联）
       ↓
Hugo 静态站生成 → GitHub Pages 部署
```

技术栈：Node.js 22 (ESM) · undici (HTTP) · fast-xml-parser (RSS) · iconv-lite (GBK) · js-yaml (配置) · DeepSeek API · Hugo 0.163.3 · chart.xkcd · KaTeX · Lenis · Turbo · GitHub Actions

## 数据来源与处理

### 数据来源

所有数据均为**公开可访问的 RSS Feed 或 API 接口**，不包含个人信息、敏感信息或非公开数据。

| 类型 | 来源 | 获取方式 |
|------|------|---------|
| 新闻 RSS | 45 个公开 RSS 源（新华社、人民日报、联合早报、MIT 科技评论等） | HTTP GET + XML 解析 |
| A 股/港股/美股行情 | 新浪财经 HQ API | HTTP GET，GBK 编码 |
| 加密货币 | CoinGecko API + Gate.io API（后备） | HTTP GET |
| 韩国 KOSPI | 东方财富 API | HTTP GET |
| 美债 10Y | Yahoo Finance | HTTP GET |
| 申万行业 + 北向资金 | Tushare | HTTP POST |

### 数据处理

- **RSS**：XML 解析 → 8 步 HTML 实体解码（`&lt;`/`&gt;`/`&amp;` 等，顺序严格）→ 标签剥离 → 聚合型 RSS 拆分（橘鸦日报）
- **行情**：GBK 解码 → 按字段数量自动区分 A 股（32 字段）/港股（6 字段）/美股（4 字段）三种格式 → 统一 Quote 模型
- **去重**：URL hash → 标题 hash → bigram Jaccard → LLM 语义去重
- **状态管理**：去重记录按 section 分文件（7 天 TTL），CI 写 `.json`（入库），本地写 `.local.json`（gitignore）
- **输出**：Hugo Markdown（YAML frontmatter + 正文含内联 HTML 图表）

### 数据合规性声明

所有数据来源均为公开渠道；不包含个人信息、内幕信息或非公开数据；RSS 摘要保留原始链接指向源站；参赛者确认对相关数据拥有合法使用权；行情数据仅供参考，不构成投资建议。

## 作品展示材料

### 公网 Demo

**Demo 链接**：https://uynajgi.github.io/yuudashboard/

### 测试账号

**无需登录**。站点为完全公开的静态网站，无账号体系，直接访问即可浏览所有内容。

### 核心功能体验路径

评审期间建议按以下路径体验核心功能：

**第一步：首页浏览**
1. 打开 https://uynajgi.github.io/yuudashboard/
2. 首页展示文章卡片瀑布流，最新日报排在最前面
3. 每张卡片依次显示：分类标签 → 标题 → 日期时间 → **TL;DR 今日要点**（蓝色左边框强调） → 正文预览
4. 左侧为悬浮分类导航栏，可快速跳转到时事/金融分类

**第二步：时事专栏体验**
1. 点击任意时事专栏卡片（如"国内"或"科技"），进入文章详情页
2. 页面顶部：大标题 + 发布日期
3. 右侧 TL;DR 侧边栏：该专栏的 4-6 条今日要闻（**这是 LLM summarize + tldr 两阶段加工的核心产出**）
4. 正文：按子类（时政/经济/社会/军事/外交/教育等）分组的新闻列表，每条含：
   - 加粗标题（可点击跳转到原文）
   - 1-2 句 LLM 生成的中文摘要
   - 括号标注的新闻来源

**第三步：金融市场专栏体验**
1. 点击"金融"分类标签或"A 股"专栏卡片
2. 页面包含：
   - **Markdown 指数表**：上证综指/深证成指/创业板指/科创50 的收盘价和涨跌幅（涨绿跌红）
   - **chart.xkcd 手绘柱状图**：各指数涨跌幅可视化（AI 产出层下面的图表层）
   - **申万行业指数表**：31 个行业按涨跌幅排序
   - **北向资金净流向**
   - **分类新闻**：按大盘/行业板块/资金流向/个股/政策分组

**第四步：汇总报告体验**
1. 点击"今日要闻汇总" → LLM 综合四专栏生成的 8-12 条最重要的跨领域新闻
2. 点击"金融市场汇总" → 包含：
   - LLM 综合点评（8-12 条跨市场要闻）
   - 全市场指数对比表（A 股/港股/美股/日经/KOSPI 一行对比）
   - chart.xkcd 全市场涨跌柱状图
   - 核心资产价格表（黄金/原油/美元/BTC/美债）
   - 申万行业涨幅前 10
   - 各专栏详细分析的跳转链接

**AI 能力体现的核心观察点**：
- **事件合并**：同一条摘要末尾会出现"（新华社、人民日报、央视新闻）"等多来源标注，说明 LLM 识别并合并了同一事件的多家报道
- **子类分配**：每条新闻归属到具体的子分类（时政/经济/AI/安全等），由 LLM 在 select 阶段自动判断
- **摘要质量**：摘要为 1-2 句信息密集的中文，而非 RSS 原文的简单截断
- **TL;DR 提炼**：TL;DR 要闻比正文标题高一层次，含具体数字和影响判断，不是标题复读

### 使用步骤

1. 浏览器访问 https://uynajgi.github.io/yuudashboard/
2. 无需登录、无需注册、无需安装任何软件
3. 建议使用桌面浏览器（移动端可浏览但体验稍差）
4. 首次加载约 500ms（含 chart.xkcd JS），后续页面切换为瞬时（Turbo）

### 注意事项

- **Demo 链接在评审期间保持可访问**：站点部署于 GitHub Pages 全球 CDN，HTTPS 加密，7×24 小时可用
- **站点内容每日更新**：系统在每日北京时间 19:00 自动运行，新日报通常在 19:05 左右上线
- **如遇无法访问**：可能是 GitHub Pages 区域性 DNS 问题（极少发生），可尝试刷新或通过 HTTPS 直接访问
- **图表可能不显示**：chart.xkcd 库从 CDN 加载，如遇 CDN 不可用，页面会自动降级为纯表格展示（不影响阅读）
- **历史日报**：首页可向下滚动浏览历史日报，或通过左侧导航栏按分类筛选

## 产品运行方式

### 本地运行

```bash
# 1. 克隆（含主题 submodule）
git clone --recurse-submodules git@github.com:UynajGI/yuudashboard.git
cd yuudashboard/scripts
npm ci

# 2. 配置 API Key
cp .env.example .env
# 编辑 .env：填入 DEEPSEEK_API_KEY（必须）和 TUSHARE_TOKEN（可选）

# 3. 运行
node v2/index.js --job=daily-news-domestic          # 国内专栏
node v2/index.js --job=daily-finance-ashare         # A股专栏
node v2/index.js --job=daily-news-domestic --dry-run  # 调试模式（不写盘）
node v2/index.js --job=daily-news-domestic --stop-after=ingest  # 只看抓取结果
```

### 部署到自己仓库

1. **Fork 仓库** → 修改 `hugo.toml` 中的 `baseURL` 为自己的 GitHub Pages 地址
2. **配置 Secrets**：Settings → Secrets → Actions，添加 `DEEPSEEK_API_KEY`（必须）+ `TUSHARE_TOKEN`（可选）
3. **启用 Actions**：Settings → Actions → General → Allow all actions + Read and write permissions
4. **启用 Pages**：Settings → Pages → Source 选 `gh-pages` 分支
5. **首次触发**：Actions → Generate Reports → Run workflow

系统按 `0 11 * * *`（UTC，即北京时间 19:00）每日自动运行，News 和 Finance 两个 Job 并行跑，publish Job 合并产物后一次 git push，deploy Job 完成 Hugo build + GitHub Pages 部署。以上四个 Job 均在 `generate.yml` 同一个 workflow 中定义。

## 项目创新点

1. **LLM 驱动的多阶段信息精炼流水线**：不是一次性端到端总结，而是按认知层级分阶段加工——合并（select）→ 提取（summarize）→ 提炼（tldr）→ 综合（digest），每个阶段独立优化，对应人类编辑处理新闻的完整流程
2. **三层机械去重 + LLM 语义去重**：99% 的重复在机械层拦截（零 token），仅 1% 的边界情况（跨天延续 vs 全新事件）交给 LLM，极致成本效率
3. **"先分后总"的报告体系**：各专栏独立生成（窄领域低噪音），汇总报告整合已提炼信息（高层次跨领域），专栏独立失败不互相影响
4. **原生 Function Calling Agent，零框架依赖**：110 行代码实现完整 Agent 循环，5 个可插拔工具，3 个 Agent Profile，不依赖 LangChain/LlamaIndex
5. **chart.xkcd 手绘风格金融图表**："数据严谨 + 视觉轻松"的反差，CDN fallback 静默降级
6. **全流程 CI/CD 无人值守**：cron 定时 → 并行管线 → artifact 合并 → 一次 push → 自动部署，零人工介入
7. **插件式架构**：加新数据源 = 写一个文件 + 注册一行；加新报告 = jobs.yml 加一行配置；加新工具 = 写一个文件 + 在 Agent Profile 里 import

## 当前完成度

**已完成**：45 RSS 源聚合 · 6 金融 API 适配 · 5 阶段 LLM 流水线 · 12 篇日报生成 · 7 种报告模板 · chart.xkcd 图表系统 · Agent 系统（5 工具 + 3 Profile） · Hugo 前端 · GitHub Actions CI/CD · GitHub Pages 部署持续运行

**待完善**：周报/月报模板 · 多 LLM 后端支持 · 新闻情感分析 · 全文分析 · 通知推送 · 移动端适配

## 风险提示与局限性

- **LLM API 依赖**：核心加工依赖 DeepSeek API，不可用时日报生成中断。已通过 GA 错误处理确保单次失败不阻塞次日重试
- **数据源稳定性**：RSS 源和 API 均为第三方服务，可能变更或限流。已实现单源容错（单源失败不影响整体）
- **LLM 输出质量波动**：摘要和要闻质量受模型能力影响。所有条目保留原文链接，读者可验证
- **仅支持中文**：prompt 和输出均为中文
- **仅支持 DeepSeek**：尚未适配其他 LLM 后端
- **单用户场景**：不支持多用户和个性化订阅

## 开发指南

### 加新数据源

1. 写 `scripts/v2/sources/xxx.js`，继承 `ItemSource` 或 `MarketSource`，实现 `fetch()` + `normalize()`
2. 在 `scripts/v2/sources/index.js` import 并注册到 `buildSources()`

### 加新报告模板

1. 写 `scripts/v2/renderers/xxx.js`（导入 `helpers.js`，实现 `render(ctx)`）
2. 在 `scripts/v2/index.js` 的 `RENDERERS` 字典注册
3. `scripts/jobs.yml` 加一行 job 配置（workflow / renderer / output）

### 加新 Agent 工具

1. 在 `scripts/v2/tools/` 下写工具文件（导出 `xxxDef` + `makeXxx(ctx)`）
2. 在需要的 Agent Profile 里 import 并注册到 tools / buildHandlers

### 项目结构

```
scripts/
├── v2/                        # 当前活跃管线
│   ├── core/                  # 核心抽象
│   │   ├── item.js            # NewsItem + Quote + hash
│   │   ├── source.js          # ItemSource / MarketSource / FallbackMarketSource
│   │   ├── store.js           # 统一 Store（seen + recent-events + market-history）
│   │   ├── pipeline.js        # Pipeline 编排器
│   │   ├── util.js            # windowToMs / titleSimilarity / pearson
│   │   └── series.js          # 历史序列查询
│   ├── sources/               # 数据源适配器（rss / sina-quote / sina-news / btc / eastmoney / yahoo / tushare）
│   ├── stages/                # Pipeline 阶段（ingest / select / summarize / tldr / digest / finance-digest）
│   ├── agents/                # Agent profiles + runAgent loop
│   ├── tools/                 # Agent 工具（market / news / stats）
│   ├── renderers/             # 报告模板 + helpers（news / finance-column / digest / finance-digest）
│   ├── index.js               # CLI 入口 + Renderer/Agent 注册表
│   ├── config.js              # 配置加载（jobs.yml / feeds.yml → ctx）
│   └── prompt.js              # Prompt 加载器（文件缓存）
├── prompts/                   # Prompt 模板（daily-* / finance-*，约 10,000 字）
├── feeds.yml                  # 45 个 RSS 源定义
├── jobs.yml                   # 15 个 Job 定义（12 主报告 + 3 Agent 分析）
└── package.json
```

## 开源与第三方材料说明

本项目基于以下开源/第三方组件构建，所有核心业务逻辑为原创：

| 组件 | 用途 | 本项目新增 |
|------|------|-----------|
| Hugo | 静态站点生成 | 自定义 layouts、多模板报告渲染、chart.xkcd 图表注入 |
| PaperMod | Hugo 主题 | 卡片瀑布流首页、TL;DR 摘要侧边栏、金融报告布局 |
| chart.xkcd | SVG 图表 | Bar/Line sparkline/Line 双线三种类型、CDN fallback、数据裁剪 |
| DeepSeek API | LLM 推理 | 5 阶段提示词体系（~10,000 字）、Agent function calling 工具集 |
| fast-xml-parser | RSS/XML 解析 | 8 步实体解码、content:encoded 剥离、聚合 RSS 拆分 |
| undici | HTTP 客户端 | 全局 IPv4 强制、超时控制 |
| iconv-lite | 字符编码 | GBK 新浪行情解码 |
| GitHub Actions | CI/CD | 双 Job 并行 + artifact 合并 + 自动部署 |

**核心原创**：源抽象层（ItemSource/MarketSource/FallbackMarketSource）、NewsItem/Quote 数据模型与 hash、三层去重+LLM 语义去重、Pipeline 编排器、6 个 Stage 全部实现、6 个 Prompt 模板（~10,000 字）、Agent 循环（110 行，零框架）、5 个 Agent 工具、3 个 Agent Profile、7 个 Renderer + chart.xkcd 图表系统、CI/CD Workflow（generate.yml 单文件四 Job）、Hugo 自定义 layouts。

**代码仓库**：https://github.com/UynajGI/yuudashboard
