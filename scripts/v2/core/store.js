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
    this.seenPath = resolve(repoRoot, `data/seen${suffix}.json`);
    this.historyPath = resolve(repoRoot, `data/market-history${suffix}.json`);
    this.recentPath = resolve(repoRoot, `data/recent-events${suffix}.json`);
    this._seenCache = null; // 单次运行内 seen 缓存（loadState → saveState 共享同一对象）
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

  // ── seen（去重 hash）────────────────────────────────────

  /**
   * 加载 seen state。单次运行内缓存（loadSeen 和 saveSeen 共享同一对象）。
   * @returns {{urls:{}, titles:{}}}
   */
  loadSeen() {
    if (this._seenCache) return this._seenCache;
    const obj = this._readJson(this.seenPath, { urls: {}, titles: {} });
    this._seenCache = { urls: obj.urls || {}, titles: obj.titles || {} };
    return this._seenCache;
  }

  /**
   * 把已发布的条目 hash 写回 seen。
   * @param {Array} items  含 urlHash/titleHash 的条目（NewsItem 或 _rawItems）
   * @param {string} dateStr  YYYY-MM-DD（北京时间）
   */
  saveSeen(items, dateStr) {
    const state = this.loadSeen(); // 用缓存的对象
    let count = 0;
    for (const it of items) {
      if (it.urlHash) { state.urls[it.urlHash] = dateStr; count++; }
      if (it.titleHash) { state.titles[it.titleHash] = dateStr; count++; }
    }
    this._prune(state.urls, SEEN_MAX);
    this._prune(state.titles, SEEN_MAX);
    this._writeJson(this.seenPath, {
      _meta: { desc: '已发布条目的去重记录。key=hash，value=发布日期。', updated: dateStr },
      urls: state.urls,
      titles: state.titles,
    });
    console.log(`  seen：写入 ${count} 条，urls=${Object.keys(state.urls).length} titles=${Object.keys(state.titles).length}（${this.tag}）`);
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

  // ── recent-events（近期事件标题，供 select 语义去重）────

  /**
   * 取某 job 最近 N 天（不含今天）已发布的事件标题。
   * @returns {string[]}
   */
  loadRecentTitles(jobName, days = 2) {
    const data = this._readJson(this.recentPath, { jobs: {} });
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
    const data = this._readJson(this.recentPath, { jobs: {} });
    if (!data.jobs) data.jobs = {};
    if (!data.jobs[jobName]) data.jobs[jobName] = {};
    data.jobs[jobName][dateStr] = titles;
    // 淘汰超期（每个 job 独立）
    for (const jn of Object.keys(data.jobs)) {
      const ds = Object.keys(data.jobs[jn]).sort().reverse();
      for (const d of ds.slice(RECENT_MAX_DAYS)) delete data.jobs[jn][d];
    }
    this._writeJson(this.recentPath, {
      _meta: { desc: '近期发布的事件标题（供 select 跨天语义去重）。', updated: dateStr },
      jobs: data.jobs,
    });
    console.log(`  recent：写入 ${jobName}/${dateStr}（${titles.length} 标题）（${this.tag}）`);
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
