// 历史序列查询：从 market-history 取某品种近 N 天的 close 序列。
// 独立于 Store（纯读 history 对象，不碰磁盘）。

/**
 * 取某品种最近 N 天的 [close, ...] 序列（按日期升序）。
 * @param {object} history  { days: { YYYY-MM-DD: { 品种名: {close, changePct} } } }
 * @param {string} name     品种名
 * @param {number} days     取最近几天
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
      closes.push(null);
      changes.push(null);
    }
  }
  return { dates, closes, changes };
}
