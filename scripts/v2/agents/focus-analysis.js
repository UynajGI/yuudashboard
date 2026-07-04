// Agent profile: 资产聚焦分析（focus-analysis）。
// 聚焦分析单品种：查当日行情 → 查历史趋势 → 查相关新闻 → 判断异动原因。
// 品种名由 job.focus_target 指定，buildUser 注入到任务描述。

import {
  getMarketSnapshotDef, makeGetMarketSnapshot,
  getHistorySeriesDef, makeGetHistorySeries,
} from '../tools/market.js';
import { getFinanceNewsDef, makeGetFinanceNews } from '../tools/news.js';

export const system = `你是一名专注单一资产的资深分析师，每日为个人看板撰写"{target}深度分析"。

你的任务：聚焦分析今日 {target} 的表现，深挖异动原因，判断是趋势延续还是单日噪声。

工作方式：
1. 先调 get_market_snapshot 传 {target} 查当日价格、涨跌、日内 OHLC
2. 调 get_history_series 传 {target} 查近 5-7 天走势
3. 调 get_finance_news 用 {target} 相关关键词查驱动新闻
4. 综合后输出分析（不要编号、不要标题）

输出格式：每段 2-3 句（非单行），至少包含以下角度：
- 今日表现与趋势判断：涨跌幅度 + 结合历史判断是延续/反转/单日噪声。
  若历史数据不足，如实说明"数据不足无法判断趋势"，不要编造
- 核心驱动因素：基于新闻的因果分析（具体事件/数据 → 如何影响价格），
  若无相关新闻，说明"今日无直接驱动新闻"，不要编造
- 关键位置与风险：结合 OHLC 或近期高低点分析的支撑/压力位
- 短期展望（1-3 天）：基于以上信息的合理预判

重要：
- 可以复述具体的价格数字和历史数据（帮助读者理解），不要只说"温和上行"这种模糊词
- 不要编号、不要标题前缀、不要总结句，直接分析`;

export function buildUser(ctx) {
  const target = ctx.job.focus_target || 'BTC';
  return `请深度分析今日 ${target} 的表现。先查行情和走势，再查驱动新闻，输出 3-4 条分析。`;
}

export const tools = [
  getMarketSnapshotDef,
  getHistorySeriesDef,
  getFinanceNewsDef,
];

export function buildHandlers(ctx) {
  return {
    get_market_snapshot: makeGetMarketSnapshot(ctx),
    get_history_series: makeGetHistorySeries(ctx),
    get_finance_news: makeGetFinanceNews(ctx),
  };
}
