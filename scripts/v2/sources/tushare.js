// Tushare 数据源：申万行业指数 + 市场宽度 + 北向资金。
// v2 MarketSource 子类，collect 返回 { sectors, breadth, northFlow }。
// TUSHARE_TOKEN 从环境变量读取。

import { MarketSource } from '../core/source.js';
import { Quote } from '../core/item.js';

const BASE = 'https://api.tushare.pro';
const TIMEOUT = 15000;

/** Tushare POST 请求封装 */
async function tushareCall(apiName, params = {}, fields = '') {
  const token = process.env.TUSHARE_TOKEN;
  if (!token) throw new Error('TUSHARE_TOKEN 未设置');

  const res = await fetch(BASE, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ api_name: apiName, token, params, fields }),
    signal: AbortSignal.timeout(TIMEOUT),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.code !== 0) throw new Error(`Tushare ${apiName}: ${json.msg || '未知错误'}`);
  return json.data; // { fields: [], items: [[], [], ...] }
}

/** 将 Tushare 行数组转成对象数组 */
function rowsToObjects(data) {
  if (!data || !data.fields) return [];
  return data.items.map((row) => {
    const obj = {};
    data.fields.forEach((k, i) => { obj[k] = row[i]; });
    return obj;
  });
}

/**
 * Tushare 复合行情源。
 * 一次 collect 并行拉取：申万行业指数 + 涨跌家数 + 北向资金。
 * 任一子数据失败不阻塞（静默降级）。
 */
export class TushareSource extends MarketSource {
  constructor() {
    super({ name: 'Tushare' });
  }

  async fetch() {
    // 北京时间日期转 YYYYMMDD
    const now = new Date();
    const bj = new Date(now.getTime() + 8 * 3600_000);
    const y = bj.getUTCFullYear();
    const m = String(bj.getUTCMonth() + 1).padStart(2, '0');
    const d = String(bj.getUTCDate()).padStart(2, '0');
    const tradeDate = `${y}${m}${d}`;

    const [swRes, flowRes] = await Promise.allSettled([
      // 申万行业指数日线
      tushareCall('sw_daily', { trade_date: tradeDate },
        'ts_code,trade_date,pre_close,close,pct_chg,sw_name'),
      // 沪深港通资金流向
      tushareCall('moneyflow_hsgt', { trade_date: tradeDate },
        'trade_date,north_money,south_money'),
    ]);

    const sw = swRes.status === 'fulfilled' ? rowsToObjects(swRes.value) : [];
    const flow = flowRes.status === 'fulfilled' ? rowsToObjects(flowRes.value) : [];

    // 北向资金
    const northFlow = flow.length ? {
      northMoney: parseFloat(flow[0].north_money) || 0,
      southMoney: parseFloat(flow[0].south_money) || 0,
    } : null;

    return { sw, northFlow };
  }

  normalize(raw) {
    const quotes = [];
    // 申万行业指数 → Quote[]
    for (const row of raw.sw) {
      if (!row.sw_name || !row.close) continue;
      quotes.push(new Quote({
        name: row.sw_name,
        price: parseFloat(row.close),
        changePct: parseFloat(row.pct_chg) || 0,
        key: 'sw_sector',
      }));
    }

    return {
      swSectors: quotes,                                   // 申万行业 Quote[]
      northFlow: raw.northFlow,                             // 北向资金 { northMoney, southMoney }
    };
  }
}
