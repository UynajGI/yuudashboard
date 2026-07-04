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
    description: '查某品种最近 N 天的历史收盘价序列（用于判断趋势）。数据来自每日累积的本地快照。',
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

export function makeGetHistorySeries(ctx) {
  return ({ name, days = 5 }) => {
    const history = ctx.marketHistory || { days: {} };
    const series = getSeries(history, name, days);
    const validCloses = series.closes.filter((c) => c != null);
    if (validCloses.length < 2) {
      return { name, days, note: `历史不足（仅 ${validCloses.length} 天）`, dates: series.dates, closes: series.closes };
    }
    const first = validCloses[0];
    const last = validCloses[validCloses.length - 1];
    const periodReturn = ((last - first) / first) * 100;
    return { name, days, dates: series.dates, closes: validCloses.map((c) => Number(c.toFixed(2))), periodReturnPct: Number(periodReturn.toFixed(2)), trend: periodReturn > 1 ? '上行' : periodReturn < -1 ? '下行' : '震荡' };
  };
}
