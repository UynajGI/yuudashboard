// market-history.json 读写：每日市场快照持久化，供走势图（sparkline）使用。
// 设计与 state.js 对称：本地用 market-history.local.json（gitignore 排除），CI 用 market-history.json（提交进 repo）。
// 这样本地重跑不污染 CI 历史，反之亦然。
//
// 数据形状：
// {
//   "_meta": { "desc": "...", "updated": "2026-07-04" },
//   "days": {
//     "2026-07-04": { "上证综指": { "close": 4031.34, "changePct": 0.06 }, ... },
//     ...
//   }
// }

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;
const HISTORY_PATH = isCI ? 'data/market-history.json' : 'data/market-history.local.json';
const MAX_DAYS = 60; // 超出按日期淘汰最旧

/** 读取历史快照。损坏 / 不存在时返回空结构（管道可继续跑）。 */
export function loadHistory(repoRoot) {
  const file = resolve(repoRoot, HISTORY_PATH);
  if (!existsSync(file)) return { days: {} };
  try {
    const obj = JSON.parse(readFileSync(file, 'utf8'));
    return { days: obj.days || {} };
  } catch (e) {
    console.warn(`  ⚠ market-history.json 解析失败（${e.message}），使用空历史`);
    return { days: {} };
  }
}

/**
 * 把当日市场快照合并进历史，返回更新后的 history（同时写盘）。
 * 同一日期重复跑 → 覆盖当日（取最新值），不重复累积。
 * @param {string} repoRoot
 * @param {string} dateStr   YYYY-MM-DD（北京时间）
 * @param {object} marketData fetchMarketData() 的返回值
 * @returns {object} 更新后的 history（{ days: {...} }）
 */
export function saveSnapshot(repoRoot, dateStr, marketData) {
  const history = loadHistory(repoRoot);
  const snap = {};

  for (const ix of marketData.indices || []) {
    if (isFinite(ix.price)) snap[ix.name] = { close: ix.price, changePct: ix.changePct ?? 0 };
  }
  for (const a of marketData.assets || []) {
    if (isFinite(a.price)) snap[a.name] = { close: a.price, changePct: a.changePct ?? 0 };
  }
  for (const extra of [marketData.btc, marketData.usTreasury, marketData.kospi]) {
    if (extra && isFinite(extra.price)) snap[extra.name] = { close: extra.price, changePct: extra.changePct ?? 0 };
  }

  history.days[dateStr] = snap;

  // 淘汰超期旧数据（按 key=日期升序）
  const dates = Object.keys(history.days).sort();
  if (dates.length > MAX_DAYS) {
    for (const d of dates.slice(0, dates.length - MAX_DAYS)) delete history.days[d];
  }

  const file = resolve(repoRoot, HISTORY_PATH);
  writeFileSync(
    file,
    JSON.stringify(
      {
        _meta: {
          desc: '每日市场快照（指数/资产/BTC），用于走势图。key=日期，value={品种名:{close,changePct}}。',
          updated: dateStr,
        },
        days: history.days,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`  market-history：写入 ${dateStr}（${Object.keys(snap).length} 品种），累计 ${dates.length} 天（${isCI ? 'CI' : '本地'} → ${HISTORY_PATH}）`);
  return history;
}

/**
 * 取某品种最近 N 天的 [close, ...] 序列（按日期升序）。
 * @param {object} history   loadHistory / saveSnapshot 的返回值
 * @param {string} name      品种名（如 "上证综指"、"BTC"、"黄金"）
 * @param {number} days      取最近几天
 * @returns {{ dates: string[], closes: number[], changes: number[] }}
 */
export function getSeries(history, name, days = 7) {
  const dates = Object.keys(history.days || {}).sort().slice(-days);
  const closes = [];
  const changes = [];
  for (const d of dates) {
    const item = history.days[d]?.[name];
    if (item && isFinite(item.close)) {
      closes.push(item.close);
      changes.push(item.changePct ?? 0);
    } else {
      // 该日缺数据 → 用 null 占位，渲染时跳过
      closes.push(null);
      changes.push(null);
    }
  }
  return { dates, closes, changes };
}
