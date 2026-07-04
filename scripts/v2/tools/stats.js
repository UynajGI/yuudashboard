// Agent 工具：相关性计算（v2，用 core 的 getSeries/pearson）。

import { getSeries } from '../core/series.js';
import { pearson } from '../core/util.js';

export const computeCorrelationDef = {
  type: 'function',
  function: {
    name: 'compute_correlation',
    description: '计算两个品种近期收盘价的相关系数（-1 到 1）。正值同向、负值反向、接近 0 无关。需两个品种都有 ≥3 天历史。',
    parameters: {
      type: 'object',
      properties: {
        a: { type: 'string', description: '品种 A 名称' },
        b: { type: 'string', description: '品种 B 名称' },
        days: { type: 'integer', description: '取最近几天计算（默认 7）', default: 7 },
      },
      required: ['a', 'b'],
    },
  },
};

export function makeComputeCorrelation(ctx) {
  return ({ a, b, days = 7 }) => {
    const history = ctx.marketHistory || { days: {} };
    const sa = getSeries(history, a, days);
    const sb = getSeries(history, b, days);
    const pairs = [];
    for (let i = 0; i < sa.dates.length; i++) {
      if (sa.closes[i] != null && sb.closes[i] != null) pairs.push([sa.closes[i], sb.closes[i]]);
    }
    if (pairs.length < 3) return { a, b, days, note: `有效重叠点仅 ${pairs.length}，不足 3` };
    const r = pearson(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
    return { a, b, days, overlapPoints: pairs.length, correlation: Number(r.toFixed(3)), interpretation: r > 0.6 ? '强正相关' : r > 0.3 ? '弱正相关' : r > -0.3 ? '基本无关' : r > -0.6 ? '弱负相关' : '强负相关' };
  };
}

export const findCorrelationsDef = {
  type: 'function',
  function: {
    name: 'find_correlations',
    description: '批量计算所有品种对的近期相关系数，返回最强正/负相关的 top K 对。',
    parameters: {
      type: 'object',
      properties: {
        days: { type: 'integer', description: '取最近几天计算（默认 7）', default: 7 },
        topK: { type: 'integer', description: '正/负相关各返回前几对（默认 5）', default: 5 },
      },
    },
  },
};

export function makeFindCorrelations(ctx) {
  return ({ days = 7, topK = 5 }) => {
    const history = ctx.marketHistory || { days: {} };
    const dates = Object.keys(history.days).sort();
    const latest = dates[dates.length - 1];
    if (!latest) return { pairs: [], note: '无历史数据' };
    const names = Object.keys(history.days[latest]);
    const pairs = [];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const sa = getSeries(history, names[i], days);
        const sb = getSeries(history, names[j], days);
        const xs = [], ys = [];
        for (let k = 0; k < sa.dates.length; k++) {
          if (sa.closes[k] != null && sb.closes[k] != null) { xs.push(sa.closes[k]); ys.push(sb.closes[k]); }
        }
        if (xs.length < 3) continue;
        const r = pearson(xs, ys);
        if (isFinite(r)) pairs.push({ a: names[i], b: names[j], r: Number(r.toFixed(3)), overlap: xs.length });
      }
    }
    pairs.sort((x, y) => y.r - x.r);
    return { days, totalPairs: pairs.length, strongestPositive: pairs.slice(0, topK), strongestNegative: pairs.slice(-topK).reverse() };
  };
}
