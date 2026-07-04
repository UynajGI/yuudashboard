# yuudashboard feeds — 信息采集管线

多源 RSS/API → LLM 流水线 → Hugo markdown。每日自动产出 11 篇报告（4 时事专栏 + 1 时事汇总 + 5 金融专栏 + 1 金融汇总）。

## 快速开始

```bash
cd scripts
cp .env.example .env   # 填入 DEEPSEEK_API_KEY（TUSHARE_TOKEN 可选）
npm install

# 时事专栏（国内/国际/科技/工程）
npm run domestic
npm run world
npm run tech

# 金融专栏（A股/港股/美股/商品/加密）
npm run daily-market
npm run sector-scan

# dry-run（不写盘，预览生成内容）
node v2/index.js --job=daily-finance-ashare --dry-run
```

## 入口

所有命令走 `v2/index.js`：

```bash
node v2/index.js --job=<job-name>                # 跑指定 job
node v2/index.js --job=<job-name> --dry-run      # 预览不写盘
node v2/index.js --job=<job-name> --stop-after=ingest  # 只看抓取结果
```

## 架构

```
feeds.yml (62 RSS源) / API源 (新浪/Tushare/CoinGecko/Gate.io)
        ↓
  v2/sources/         每个源一个 Source 适配器（ItemSource/MarketSource）
        ↓
  v2/stages/ingest    抓取 → 去重 → 分组
        ↓
  v2/stages/select    LLM 精选合并 + 子分类 + 跨天语义去重
        ↓
  v2/stages/summarize LLM 摘要
        ↓
  v2/stages/tldr      LLM 总览要点
        ↓
  v2/stages/digest    读专栏文件 → LLM 综合汇总（news/finance 各一套）
        ↓
  v2/renderers/       渲染成 Hugo markdown
```

## Job 系统（jobs.yml）

| Job | Section | 源 | 产出 |
|-----|---------|-----|------|
| daily-news-domestic | news | 14 国内 RSS | 国内专栏 |
| daily-news-world | news | 12 国际 RSS | 国际专栏 |
| daily-news-tech | news | 11 科技 RSS | 科技专栏 |
| daily-news-engineering | news | 25 工程博客 | 工程专栏 |
| daily-news-digest | news | 读 4 专栏 | 今日要闻汇总 |
| daily-finance-ashare | finance | 新浪 A股 + Tushare | A股专栏（含申万行业+北向资金）|
| daily-finance-hk | finance | 新浪港股 + KOSPI | 港股专栏 |
| daily-finance-us | finance | 新浪美股 + 美债 | 美股专栏 |
| daily-finance-commodity | finance | 新浪商品 | 商品专栏 |
| daily-finance-crypto | finance | BTC (CoinGecko/Gate.io) | 加密专栏 |
| daily-finance-digest | finance | 读 5 专栏 + 全市场数据 | 金融市场汇总 |

加新报告：jobs.yml 加一行 + 写 renderer（+ agent profile 如需 LLM 分析）。

## 去重

三层去重，按 section 分组（news 共享、finance 共享），seen.json 保留 7 天自动清理。

## 目录结构

```
scripts/
├── v2/                    # 当前管线
│   ├── core/              # 核心抽象（item/store/source/pipeline/util/series）
│   ├── sources/           # 数据源适配器（每个源一个文件）
│   ├── stages/            # pipeline 阶段（ingest/select/summarize/tldr/digest/finance-digest）
│   ├── agents/            # agent profiles + runAgent loop
│   ├── tools/             # agent 工具
│   ├── renderers/         # 报告模板 + helpers
│   ├── index.js           # CLI 入口
│   ├── config.js          # 配置加载
│   └── prompt.js          # Prompt 加载器
├── src/                   # 旧管线（已停用）
├── jobs.yml               # Job 定义（11 个）
├── feeds.yml              # RSS 源清单（62 源）
├── feeds-tested.md        # 459 源可用性测试结果（备查）
├── prompts/               # Prompt 模板
└── package.json
```
