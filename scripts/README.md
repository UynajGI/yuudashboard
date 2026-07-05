# yuudashboard feeds — 信息采集管线

多源 RSS/API/搜索 → LLM 流水线 → Hugo markdown。每日自动产出 12 篇报告（4 时事专栏 + 1 时事汇总 + 6 金融专栏 + 1 金融汇总）。

## 快速开始

```bash
cd scripts
cp .env.example .env   # 填入 DEEPSEEK_API_KEY（TUSHARE_TOKEN 可选）
npm ci

# 时事专栏
node v2/index.js --job=daily-news-domestic
node v2/index.js --job=daily-news-world
node v2/index.js --job=daily-news-tech
node v2/index.js --job=daily-news-engineering
node v2/index.js --job=daily-news-digest   # 依赖上面四个先跑完

# 金融专栏
node v2/index.js --job=daily-finance-ashare
node v2/index.js --job=daily-finance-hk
node v2/index.js --job=daily-finance-asia
node v2/index.js --job=daily-finance-us
node v2/index.js --job=daily-finance-commodity
node v2/index.js --job=daily-finance-crypto
node v2/index.js --job=daily-finance-digest  # 依赖上面六个先跑完

# dry-run（不写盘，预览生成内容）
node v2/index.js --job=daily-finance-ashare --dry-run
node v2/index.js --job=daily-news-domestic --stop-after=ingest  # 只看抓取结果
```

## 架构

```
feeds.yml (45 RSS源) + API源 (新浪/Tushare/CoinGecko/Gate.io/Yahoo/东方财富)
  + ddgs 搜索源 (18 个搜索词补 RSS 盲区，每金融专栏 3 个)
  + 财经 RSS 源 (10 个硬编码在 sources/index.js)
        ↓
  v2/sources/         每个源一个 Source 适配器（ItemSource/MarketSource/SearchSource）
        ↓
  v2/stages/ingest    抓取 → 去重 → 分组
        ↓
  v2/stages/select    LLM 精选合并 + 子分类 + RAG 跨天语义去重（recent-events 注入）
        ↓
  v2/stages/summarize LLM 摘要
        ↓
  v2/stages/tldr      LLM 总览要点
        ↓
  v2/stages/digest    读专栏文件 → LLM 综合汇总（news/finance 各一套）
        ↓
  v2/renderers/       渲染成 Hugo markdown + chart.xkcd 图表
```

## Job 系统（jobs.yml）

| Job | Section | 源 | 产出 |
|-----|---------|-----|------|
| daily-news-domestic | news | 14 国内 RSS | 国内专栏 |
| daily-news-world | news | 12 国际 RSS | 国际专栏 |
| daily-news-tech | news | 11 科技 RSS | 科技专栏 |
| daily-news-engineering | news | 科技源（工程类博客已并入科技类别） | 工程专栏 |
| daily-news-digest | news | 读 4 专栏 | 今日要闻汇总 |
| daily-finance-ashare | finance | 新浪 A股 + Tushare + ddgs×3 | A股专栏（含申万行业+北向资金） |
| daily-finance-hk | finance | 新浪港股 + KOSPI + ddgs×3 | 港股专栏 |
| daily-finance-asia | finance | 新浪亚盘 + KOSPI + ddgs×3 | 亚盘专栏 |
| daily-finance-us | finance | 新浪美股 + 美债 + ddgs×3 | 美股专栏 |
| daily-finance-commodity | finance | 新浪商品 + ddgs×3 | 商品专栏 |
| daily-finance-crypto | finance | BTC (CoinGecko/Gate.io) + ddgs×3 | 加密专栏 |
| daily-finance-digest | finance | 读 6 专栏 + 全市场数据 | 金融市场汇总 |

加新报告：jobs.yml 加一行 + 写 renderer（+ agent profile 如需 LLM 分析）。

## 去重

四层去重：URL hash → 标题 hash → bigram Jaccard 相似度 → LLM 语义去重（RAG：recent-events 标题注入 prompt 判断延续报道）。按 section 分独立文件（seen-news.json / seen-finance.json），7 天 TTL 自动清理。

## 目录结构

```
scripts/
├── v2/                    # 当前管线
│   ├── core/              # 核心抽象（item/store/source/pipeline/util/series）
│   ├── sources/           # 数据源适配器（rss/sina-quote/sina-news/btc/eastmoney/yahoo/tushare/search）
│   ├── stages/            # pipeline 阶段（ingest/select/summarize/tldr/digest/finance-digest）
│   ├── agents/            # agent profiles + runAgent loop（sectors/focus/linkage）
│   ├── tools/             # agent 工具（market/news/stats）
│   ├── renderers/         # 报告模板 + helpers（news/finance-column/digest/finance-digest）
│   ├── index.js           # CLI 入口 + Renderer/Agent 注册
│   ├── config.js          # 配置加载（jobs.yml/feeds.yml → ctx）
│   └── prompt.js          # Prompt 加载器（文件缓存）
├── src/                   # 旧管线（已停用，保留备查）
├── jobs.yml               # Job 定义（15 个：12 主报告 + 3 Agent 分析）
├── feeds.yml              # RSS 源清单（45 源）
├── feeds-tested.md        # 459 源可用性测试结果（备查）
├── prompts/               # Prompt 模板（daily-*/finance-*）
└── package.json
```
