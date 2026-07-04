// Agent 工具：相关性计算（Pearson 相关系数）。
// 用于联动观察报告（D）：判断两品种近期走势是否相关。

import { getSeries } from '../market-history.js';

export const computeCorrelationDef = {
  type: 'function',
  function: {
    name: 'compute_correlation',
    description: '计算两个品种近期收盘价的相关系数（-1 到 1）。正值同向、负值反向、接近 0 无关。需两个品种都有 ≥3 天历史。',
    parameters: {
      type: 'object',
      properties: {
        a: { type: 'string', description: '品种 A 名称，如 "黄金"' },
        b: { type: 'string', description: '品种 B 名称，如 "美元指数"' },
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
    // 对齐两个序列（按日期交集，跳过 null）
    const pairs = [];
    for (let i = 0; i < sa.dates.length; i++) {
      if (sa.closes[i] != null && sb.closes[i] != null) {
        pairs.push([sa.closes[i], sb.closes[i]]);
      }
    }
    if (pairs.length < 3) {
      return { a, b, days, note: `有效重叠点仅 ${pairs.length}，不足 3，无法计算` };
    }
    const r = pearson(pairs.map((p) => p[0]), pairs.map((p) => p[1]));
    return {
      a, b, days,
      overlapPoints: pairs.length,
      correlation: Number(r.toFixed(3)),
      interpretation: r > 0.6 ? '强正相关' : r > 0.3 ? '弱正相关' : r > -0.3 ? '基本无关' : r > -0.6 ? '弱负相关' : '强负相关',
    };
  };
}

/** Pearson 相关系数 */
function pearson(x, y) {
  const n = x.length;
  const sx = x.reduce((a, b) => a + b, 0) / n;
  const sy = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) {
    num += (x[i] - sx) * (y[i] - sy);
    dx += (x[i] - sx) ** 2;
    dy += (y[i] - sy) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den === 0 ? 0 : num / den;
}

// ── 工具 3：find_correlations（批量算所有品种对）─────────

export const findCorrelationsDef = {
  type: 'function',
  function: {
    name: 'find_correlations',
    description: '批量计算所有品种对的近期相关系数，返回最强正/负相关的 top K 对。用于发现联动品种（如美元↔黄金通常强负相关）。',
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
    // 收集所有品种名（取最新一天快照的 key 集）
    const dates = Object.keys(history.days).sort();
    const latest = dates[dates.length - 1];
    if (!latest) return { pairs: [], note: '无历史数据' };
    const names = Object.keys(history.days[latest]);

    // 算所有配对
    const pairs = [];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const sa = getSeries(history, names[i], days);
        const sb = getSeries(history, names[j], days);
        // 对齐日期交集
        const xs = [], ys = [];
        for (let k = 0; k < sa.dates.length; k++) {
          if (sa.closes[k] != null && sb.closes[k] != null) {
            xs.push(sa.closes[k]);
            ys.push(sb.closes[k]);
          }
        }
        if (xs.length < 3) continue;
        const r = pearson(xs, ys);
        if (isFinite(r)) pairs.push({ a: names[i], b: names[j], r: Number(r.toFixed(3)), overlap: xs.length });
      }
    }

    pairs.sort((x, y) => y.r - x.r);
    const strongestPositive = pairs.slice(0, topK);
    const strongestNegative = pairs.slice(-topK).reverse();
    return {
      days,
      totalPairs: pairs.length,
      strongestPositive,
      strongestNegative,
    };
  };
}
