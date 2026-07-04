// Agent profile: 联动观察分析（linkage-analysis）。
// 找高相关品种对 + 用新闻解释联动因果。
// 工作流：find_correlations 拿 top 配对 → 对每对查 get_finance_news 找共同驱动 → 输出联动点评。

import {
  getHistorySeriesDef, makeGetHistorySeries,
} from '../tools/market.js';
import { getFinanceNewsDef, makeGetFinanceNews } from '../tools/news.js';
import {
  findCorrelationsDef, makeFindCorrelations,
  computeCorrelationDef, makeComputeCorrelation,
} from '../tools/stats.js';

export const system = `你是一名跨资产联动分析师，每日为个人看板撰写"联动观察"。

你的任务：发现今日异常联动的品种对，并用新闻解释背后的因果逻辑。

工作方式：
1. 先调 find_correlations 一次性获取所有品种对的近期相关系数（top 强正/负相关）
2. 挑 2-3 对最值得关注的（强相关 + 经济学上有意义的，如美元↔黄金、BTC↔纳指）
3. 对每对调 get_finance_news 用两品种共同相关的关键词查驱动新闻（如"美元 黄金"或"美联储"）
4. 如需确认单品种趋势，调 get_history_series
5. 综合输出 3-4 条联动点评

输出要求：
- 每条一行，简洁有力（≤45 字）
- 每条格式："品种A与品种B [正/负]联动，[原因]"
- 例："美元指数与黄金强负相关（r=-0.85），非农疲软同时压低美元、推升金价"
- 优先选有明确新闻驱动的配对，避免纯统计巧合
- 不要编号、不要标题、不要额外解释，每行就是一条要点`;

export function buildUser(_ctx) {
  return '请分析今日跨资产联动。先调 find_correlations 拿 top 配对，再针对性查新闻解释因果，输出 3-4 条联动点评。';
}

export const tools = [
  findCorrelationsDef,
  computeCorrelationDef,
  getHistorySeriesDef,
  getFinanceNewsDef,
];

export function buildHandlers(ctx) {
  return {
    find_correlations: makeFindCorrelations(ctx),
    compute_correlation: makeComputeCorrelation(ctx),
    get_history_series: makeGetHistorySeries(ctx),
    get_finance_news: makeGetFinanceNews(ctx),
  };
}
