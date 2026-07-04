// Agent profile: 板块点评（sectors-commentary）。
// 给 agent 一组市场数据工具，让它自主决定查哪些板块、要不要看历史，然后生成今日板块风格点评。
//
// 一个 agent profile 导出 3 部分：
//   system    —— 系统提示（定义角色和任务）
//   buildUser —— (ctx) => 用户首条消息（任务描述 + 当日各板块概览）
//   tools     —— [工具定义]，与 toolHandlers 对应
//   buildHandlers —— (ctx) => { toolName: handler }，闭包绑定 ctx

import {
  getMarketSnapshotDef, makeGetMarketSnapshot,
  getHistorySeriesDef, makeGetHistorySeries,
} from '../tools/market.js';
import { getFinanceNewsDef, makeGetFinanceNews } from '../tools/news.js';

export const system = `你是一名敏锐的金融市场分析师，每日为个人看板撰写"板块风格点评"。

你的任务：基于今日各大板块（A股/港股/美股/亚太/商品/加密）的涨跌，写一段简练的板块点评。

工作方式：
1. 先调 get_market_snapshot 查 "all" 获取全貌
2. 发现今日异常强或异常弱的板块时，主动调 get_history_series 查该板块代表品种近 5 天走势，判断是趋势延续还是单日异动
3. 如果某板块波动有明确新闻驱动（如"美联储""非农"），可调 get_finance_news 查相关要闻
4. 综合后输出 3-4 条点评

输出要求：
- 每条一行，简洁有力（≤40 字）
- 第一条点出今日最强板块及原因
- 第二条点出最弱或最值得警惕的板块
- 第三条点出板块间的联动或风格切换信号（如"风险偏好回升""避险升温"）
- 如有趋势性判断（基于历史），可作为第四条
- 不要复述具体数字（表格里已有），只给判断和逻辑
- 不要编号、不要标题、不要额外解释，每行就是一条要点`;

export function buildUser(_ctx) {
  return '请分析今日板块表现，生成 3-4 条板块风格点评。先查全貌，再针对异常板块深入。';
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
