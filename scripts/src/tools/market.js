// Agent 工具：市场数据查询。
// 每个工具导出两部分：definition（OpenAI function schema，给 LLM）+ handler（实际执行，给 agent）。
// handler 是闭包工厂，接收 ctx，返回函数 —— 这样工具能访问 ctx.marketData / ctx.marketHistory。

import { getSeries } from '../market-history.js';

// ── 板块定义（与 render-sectors.js 共用）──────────────────
export const SECTORS = {
  A股: ['上证综指', '深证成指', '创业板指', '科创50'],
  港股: ['恒生指数', '恒生科技'],
  美股: ['道琼斯', '纳斯达克', '标普500'],
  亚太: ['日经 225', '韩国 KOSPI'],
  商品: ['黄金', 'WTI 原油', '美元指数'],
  加密: ['BTC'],
};

/**
 * 从 marketData（fetch 阶段产物）里按品种名找数据。
 * marketData = { indices:[], assets:[], btc, usTreasury, kospi }
 */
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

/** 板块平均涨跌幅 */
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
    description: '查询当日市场行情快照。三种用法：①板块名（A股/港股/美股/亚太/商品/加密）查整板块；②"all"查全部；③具体品种名（如"BTC""黄金""上证综指""道琼斯"）查单品种。',
    parameters: {
      type: 'object',
      properties: {
        sector: {
          type: 'string',
          description: '板块名（A股/港股/美股/亚太/商品/加密）、"all"、或具体品种名',
        },
      },
      required: ['sector'],
    },
  },
};

export function makeGetMarketSnapshot(ctx) {
  return ({ sector }) => {
    const md = ctx.marketData || {};
    // 按板块 / 全部 / 品种名 三种解析
    let targetNames;
    if (sector === 'all') {
      targetNames = Object.values(SECTORS).flat();
    } else if (SECTORS[sector]) {
      targetNames = SECTORS[sector];
    } else {
      // 当品种名查（sector 不是已知板块名时，尝试匹配品种）
      const x = findByName(md, sector);
      return {
        sector,
        queryType: 'single-asset',
        count: x ? 1 : 0,
        avgChangePct: x ? Number((x.changePct || 0).toFixed(2)) : null,
        items: x ? [{ name: x.name, price: x.priceStr, changePct: Number((x.changePct || 0).toFixed(2)), open: x.open, high: x.high, low: x.low }] : [],
      };
    }
    const items = targetNames
      .map((n) => {
        const x = findByName(md, n);
        return x ? { name: x.name, price: x.priceStr, changePct: Number((x.changePct || 0).toFixed(2)) } : null;
      })
      .filter(Boolean);
    const avg = targetNames.length ? sectorAvg(md, targetNames) : null;
    return {
      sector,
      queryType: SECTORS[sector] ? 'sector' : 'all',
      count: items.length,
      avgChangePct: avg != null ? Number(avg.toFixed(2)) : null,
      items,
    };
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
        name: { type: 'string', description: '品种名，如 "上证综指"、"恒生指数"、"BTC"、"黄金"' },
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
      return { name, days, note: `历史不足（仅 ${validCloses.length} 天），无法判断趋势`, dates: series.dates, closes: series.closes };
    }
    const first = validCloses[0];
    const last = validCloses[validCloses.length - 1];
    const periodReturn = ((last - first) / first) * 100;
    return {
      name,
      days,
      dates: series.dates,
      closes: validCloses.map((c) => Number(c.toFixed(2))),
      periodReturnPct: Number(periodReturn.toFixed(2)),
      trend: periodReturn > 1 ? '上行' : periodReturn < -1 ? '下行' : '震荡',
    };
  };
}
