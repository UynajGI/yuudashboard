// 统一状态层：seen（去重）+ market-history（行情快照）+ recent-events（语义去重）。
// 合并旧 state.js / market-history.js / recent-events.js，isCI 只算一次。
// CI 提交 *.json 进 repo；本地用 *.local.json 互不污染。

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const SEEN_MAX = 5000;     // seen.json 条目上限
const HISTORY_MAX_DAYS = 60; // market-history 保留天数
const RECENT_MAX_DAYS = 3;   // recent-events 每个job保留天数

/**
 * 统一 Store。构造时确定 CI/本地，所有 state 文件路径一致。
 */
export class Store {
  constructor(repoRoot) {
    this.repoRoot = repoRoot;
    this.isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;
    const suffix = this.isCI ? '' : '.local';
    this.seenDir = resolve(repoRoot, 'data');
    this.recentDir = resolve(repoRoot, 'data');
    this.isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;
    this._seenCache = {};  // {section: state} 缓存
  }

  get tag() {
    return this.isCI ? 'CI' : '本地';
  }

  // ── 通用 JSON 读写 ──────────────────────────────────────

  _readJson(path, fallback) {
    if (!existsSync(path)) return structuredClone(fallback);
    try {
      return JSON.parse(readFileSync(path, 'utf8'));
    } catch (e) {
      console.warn(`  ⚠ ${path} 解析失败（${e.message}），使用空`);
      return structuredClone(fallback);
    }
  }

  _writeJson(path, obj) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(obj, null, 2) + '\n');
  }

  // ── seen（去重 hash，按 section 独立文件，保留 7 天）────

  /** section → 文件路径 */
  _seenPath(section) {
    const suffix = this.isCI ? '' : '.local';
    return resolve(this.seenDir, `data/seen-${section}${suffix}.json`);
  }

  /**
   * 加载某 section 的 seen state（独立文件，互不干扰）。
   * @returns {{urls:{}, titles:{}}}
   */
  loadSeen(section) {
    if (this._seenCache[section]) return this._seenCache[section];
    const path = this._seenPath(section);
    const obj = this._readJson(path, { urls: {}, titles: {} });
    const state = { urls: obj.urls || {}, titles: obj.titles || {} };
    this._seenCache[section] = state;
    return state;
  }

  /**
   * 把已发布的条目 hash 写回 seen（只写本 section 的独立文件）。
   */
  saveSeen(section, items, dateStr) {
    const path = this._seenPath(section);
    // 每次保存前重新读磁盘（避免 stale）
    const obj = this._readJson(path, { urls: {}, titles: {} });
    if (!obj.urls) obj.urls = {};
    if (!obj.titles) obj.titles = {};

    let count = 0;
    for (const it of items) {
      if (it.urlHash) { obj.urls[it.urlHash] = dateStr; count++; }
      if (it.titleHash) { obj.titles[it.titleHash] = dateStr; count++; }
    }

    // 清理 >7 天
    const SEEN_TTL_DAYS = 7;
    const cutoff = this._shiftDate(dateStr, -SEEN_TTL_DAYS);
    this._pruneByDate(obj.urls, cutoff);
    this._pruneByDate(obj.titles, cutoff);

    obj._meta = { desc: `去重记录 [${section}]，保留 7 天`, updated: dateStr };
    this._writeJson(path, obj);

    this._seenCache[section] = { urls: obj.urls, titles: obj.titles };
    console.log(`  seen[${section}]：写入 ${count} 条，urls=${Object.keys(obj.urls).length} titles=${Object.keys(obj.titles).length}（${this.tag}）`);
  }

  /** 日期字符串加减天数 → YYYY-MM-DD */
  _shiftDate(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /** 删除 value < cutoff 的条目 */
  _pruneByDate(map, cutoff) {
    for (const k of Object.keys(map)) {
      if (map[k] < cutoff) delete map[k];
    }
  }

  // ── market-history（行情快照）──────────────────────────

  /**
   * @returns {{days: {YYYY-MM-DD: {品种名: {close, changePct}}}}}
   */
  loadHistory() {
    const obj = this._readJson(this.historyPath, { days: {} });
    return { days: obj.days || {} };
  }

  /**
   * 把当日 Quote 写入 history（同日覆盖）。返回合并后的完整 history。
   * @param {string} dateStr
   * @param {{indices:[], assets:[], extra:[]}} quotes  按 name 取 close/changePct
   * @returns {{days:{}}} 合并后 history（含今日，供 renderer 画 sparkline）
   */
  saveSnapshot(dateStr, quotes) {
    const history = this.loadHistory();
    const snap = {};
    const all = [...(quotes.indices || []), ...(quotes.assets || []), ...(quotes.extra || [])];
    for (const q of all) {
      if (q && q.name != null && isFinite(q.price)) {
        snap[q.name] = { close: q.price, changePct: q.changePct ?? 0 };
      }
    }
    history.days[dateStr] = snap;
    // 淘汰超期
    const dates = Object.keys(history.days).sort();
    for (const d of dates.slice(0, Math.max(0, dates.length - HISTORY_MAX_DAYS))) {
      delete history.days[d];
    }
    this._writeJson(this.historyPath, {
      _meta: { desc: '每日市场快照（指数/资产/BTC），用于走势图。', updated: dateStr },
      days: history.days,
    });
    console.log(`  history：写入 ${dateStr}（${Object.keys(snap).length} 品种），累计 ${dates.length} 天（${this.tag}）`);
    return history;
  }

  // ── recent-events（按 section 独立文件，供 select 语义去重）────

  /** section → 文件路径 */
  _recentPath(section) {
    const suffix = this.isCI ? '' : '.local';
    return resolve(this.seenDir, `data/recent-events-${section}${suffix}.json`);
  }

  /**
   * 取某 job 最近 N 天已发布的事件标题。
   * 文件按 section 分，jobName 在 section 内部区分。
   * @returns {string[]}
   */
  loadRecentTitles(jobName, days = 2) {
    // 从 jobName 推断 section（daily-news-* → news, daily-finance-* → finance）
    const section = jobName.startsWith('daily-news') ? 'news' : jobName.startsWith('daily-finance') ? 'finance' : 'default';
    const path = this._recentPath(section);
    const data = this._readJson(path, { jobs: {} });
    const jobEntries = data.jobs?.[jobName] || {};
    const dates = Object.keys(jobEntries).sort().reverse();
    const titles = [];
    for (const d of dates.slice(0, days)) titles.push(...(jobEntries[d] || []));
    return titles;
  }

  /**
   * 写入今日发布的事件标题（render 后调用）。
   */
  saveRecentTitles(jobName, dateStr, titles) {
    const section = jobName.startsWith('daily-news') ? 'news' : jobName.startsWith('daily-finance') ? 'finance' : 'default';
    const path = this._recentPath(section);
    // 重新读磁盘（避免 stale）
    const data = this._readJson(path, { jobs: {} });
    if (!data.jobs) data.jobs = {};
    if (!data.jobs[jobName]) data.jobs[jobName] = {};
    data.jobs[jobName][dateStr] = titles;
    // 淘汰超期（每个 job 独立）
    for (const jn of Object.keys(data.jobs)) {
      const ds = Object.keys(data.jobs[jn]).sort().reverse();
      for (const d of ds.slice(RECENT_MAX_DAYS)) delete data.jobs[jn][d];
    }
    data._meta = { desc: `近期事件标题 [${section}]，供 select 跨天语义去重`, updated: dateStr };
    this._writeJson(path, data);
    console.log(`  recent[${section}/${jobName}]：写入 ${titles.length} 标题（${this.tag}）`);
  }

  // ── 内部辅助 ────────────────────────────────────────────

  /** 按日期 value 升序淘汰最旧的 */
  _prune(map, max) {
    const keys = Object.keys(map);
    if (keys.length <= max) return;
    keys
      .sort((a, b) => (map[a] < map[b] ? -1 : 1))
      .slice(0, keys.length - max)
      .forEach((k) => delete map[k]);
  }
}
