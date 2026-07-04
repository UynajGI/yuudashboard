// 核心工具函数（纯函数，无副作用，全系统共享）。

/** 把 window 字符串（"24h"/"7d"）转成毫秒 */
export function windowToMs(window) {
  const m = String(window).match(/^(\d+)([hd])$/);
  if (!m) throw new Error(`window 格式错误: ${window}（应为如 24h / 7d）`);
  const n = Number(m[1]);
  return m[2] === 'h' ? n * 3600_000 : n * 86_400_000;
}

/** Jaccard 相似度（基于字符 bigram），用于标题近似去重 */
export function titleSimilarity(a, b) {
  const bi = (s) => {
    const set = new Set();
    const t = s.toLowerCase().replace(/\s+/g, '');
    for (let i = 0; i < t.length - 1; i++) set.add(t.slice(i, i + 2));
    return set;
  };
  const A = bi(a), B = bi(b);
  if (A.size === 0 || B.size === 0) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Pearson 相关系数 */
export function pearson(x, y) {
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
