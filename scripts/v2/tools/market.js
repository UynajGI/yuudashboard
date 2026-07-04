// Agent 工具：市场数据查询（v2，适配 Quote 模型）。
// 工具返回紧凑 JSON 供 LLM 读；priceStr 等格式化由 renderer 做，工具给原始数值。

import { getSeries } from '../core/series.js';
import { SECTORS } from '../renderers/helpers.js';

/** 从 marketData 按品种名找 Quote */
function findByName(marketData, name) {
  const all = [
    ...(marketData?.indices || []),
    ...(marketData?.assets || []),
    ...(marketData?.btc ? [marketData.btc] : []),
    ...(marketData?.usTreasury ? [marketData.usTreasury] : []),
    ...(marketData?.kospi ? [marketData.kospi] : []),
  ];
  return all.find((x) => x.name === name);
}

function sectorAvg(marketData, names) {
  const vals = names.map((n) => findByName(marketData, n)).filter(Boolean).map((x) => x.changePct);
  if (!vals.length) return null;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}

// ── 工具 1：get_market_snapshot ──────────────────────────

export const getMarketSnapshotDef = {
  type: 'function',
  function: {
    name: 'get_market_snapshot',
    description: '查询当日市场行情快照。三种用法：①板块名（A股/港股/美股/亚太/商品/加密）查整板块；②"all"查全部；③具体品种名（如"BTC""黄金""上证综指"）查单品种。',
    parameters: {
      type: 'object',
      properties: {
        sector: { type: 'string', description: '板块名、"all"、或具体品种名' },
      },
      required: ['sector'],
    },
  },
};

export function makeGetMarketSnapshot(ctx) {
  return ({ sector }) => {
    const md = ctx.marketData || {};
    let targetNames;
    if (sector === 'all') {
      targetNames = Object.values(SECTORS).flat();
    } else if (SECTORS[sector]) {
      targetNames = SECTORS[sector];
    } else {
      const x = findByName(md, sector);
      return {
        sector, queryType: 'single-asset',
        count: x ? 1 : 0,
        avgChangePct: x ? Number((x.changePct || 0).toFixed(2)) : null,
        items: x ? [{ name: x.name, price: x.price, changePct: Number((x.changePct || 0).toFixed(2)), ...(x.hasOHLC?.() ? { open: x.open, high: x.high, low: x.low } : {}) }] : [],
      };
    }
    const items = targetNames
      .map((n) => { const x = findByName(md, n); return x ? { name: x.name, price: x.price, changePct: Number((x.changePct || 0).toFixed(2)) } : null; })
      .filter(Boolean);
    const avg = targetNames.length ? sectorAvg(md, targetNames) : null;
    return { sector, queryType: SECTORS[sector] ? 'sector' : 'all', count: items.length, avgChangePct: avg != null ? Number(avg.toFixed(2)) : null, items };
  };
}

// ── 工具 2：get_history_series ───────────────────────────

export const getHistorySeriesDef = {
  type: 'function',
  function: {
    name: 'get_history_series',
    description: '查某品种最近 N 天的历史收盘价序列（用于判断趋势）。优先读本地快照，不足时回拉 API（BTC: CoinGecko / A股: Tushare）。',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: '品种名' },
        days: { type: 'integer', description: '取最近几天（默认 5）', default: 5 },
      },
      required: ['name'],
    },
  },
};

// ── API 历史回拉（本地不足时用）─────────────────────────

/** CoinGecko BTC 近 N 天收盘价 */
async function fetchBtcHistory(days) {
  try {
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=${days}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const data = await res.json();
    if (!data.prices) return null;
    // prices: [[timestamp_ms, price], ...] → 取每日收盘（UTC 0 点附近）
    const map = {};
    for (const [ts, price] of data.prices) {
      const d = new Date(ts).toISOString().slice(0, 10);
      map[d] = price; // 最后一条覆盖
    }
    return map;
  } catch { return null; }
}

/** Tushare A 股指数日线（上证/深证/创业板/科创50） */
const TUSHARE_INDEX_CODES = {
  '上证综指': '000001.SH',
  '深证成指': '399001.SZ',
  '创业板指': '399006.SZ',
  '科创50': '000688.SH',
};

async function fetchTushareIndexHistory(name, days) {
  const tsCode = TUSHARE_INDEX_CODES[name];
  if (!tsCode) return null;
  const token = process.env.TUSHARE_TOKEN;
  if (!token) return null;
  try {
    const end = new Date();
    const start = new Date(end.getTime() - (days + 5) * 86400000);
    const res = await fetch('https://api.tushare.pro', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_name: 'daily',
        token,
        params: {
          ts_code: tsCode,
          start_date: start.toISOString().slice(0, 10).replace(/-/g, ''),
          end_date: end.toISOString().slice(0, 10).replace(/-/g, ''),
        },
        fields: 'trade_date,close',
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (json.code !== 0) return null;
    const items = json.data?.items || [];
    const map = {};
    for (const [date, close] of items) {
      const d = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
      map[d] = parseFloat(close);
    }
    return map;
  } catch { return null; }
}

export function makeGetHistorySeries(ctx) {
  return async ({ name, days = 5 }) => {
    const history = ctx.marketHistory || { days: {} };
    const series = getSeries(history, name, days);
    const validCloses = series.closes.filter((c) => c != null);

    // 本地数据不足 → 试 API 回拉
    if (validCloses.length < Math.min(3, days)) {
      let apiData = null;
      if (name === 'BTC') {
        apiData = await fetchBtcHistory(days);
      } else if (TUSHARE_INDEX_CODES[name]) {
        apiData = await fetchTushareIndexHistory(name, days);
      }

      if (apiData) {
        // 合并 API 数据到本地 history（补充 missing dates）
        for (const [d, price] of Object.entries(apiData)) {
          if (!history.days[d]) history.days[d] = {};
          if (!history.days[d][name]) history.days[d][name] = { close: price, changePct: 0 };
        }
        const merged = getSeries(history, name, days);
        const mergedValid = merged.closes.filter((c) => c != null);
        if (mergedValid.length > validCloses.length) {
          const first = mergedValid[0];
          const last = mergedValid[mergedValid.length - 1];
          const periodReturn = ((last - first) / first) * 100;
          return {
            name, days, source: 'api-merged',
            dates: merged.dates, closes: mergedValid.map((c) => Number(c.toFixed(2))),
            periodReturnPct: Number(periodReturn.toFixed(2)),
            trend: periodReturn > 2 ? '上行' : periodReturn < -2 ? '下行' : '震荡',
          };
        }
      }
    }

    if (validCloses.length < 2) {
      return { name, days, note: `历史不足（仅 ${validCloses.length} 天，API 也未获取到）`, dates: series.dates, closes: series.closes };
    }
    const first = validCloses[0];
    const last = validCloses[validCloses.length - 1];
    const periodReturn = ((last - first) / first) * 100;
    return { name, days, dates: series.dates, closes: validCloses.map((c) => Number(c.toFixed(2))), periodReturnPct: Number(periodReturn.toFixed(2)), trend: periodReturn > 1 ? '上行' : periodReturn < -1 ? '下行' : '震荡' };
  };
}
