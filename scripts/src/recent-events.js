// recent-events.json 读写：存每个 job 最近 N 天发布的事件标题。
// 供 select stage 注入 prompt，让 LLM 判断"这条是昨天的延续报道吗"。
//
// 与 seen.json 区别：seen 只存 hash（机械去重），recent-events 存标题文本（语义去重）。
//
// 数据形状：
// {
//   "_meta": { "desc": "...", "updated": "2026-07-04" },
//   "jobs": {
//     "daily": {
//       "2026-07-04": ["标题1", "标题2", ...],
//       "2026-07-03": [...]
//     }
//   }
// }

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;
const PATH = isCI ? 'data/recent-events.json' : 'data/recent-events.local.json';
const MAX_DAYS = 3; // 只存最近 3 天，更旧的自动淘汰

/** 读取近期事件。损坏/不存在返回空结构。 */
export function loadRecentEvents(repoRoot) {
  const file = resolve(repoRoot, PATH);
  if (!existsSync(file)) return { jobs: {} };
  try {
    const obj = JSON.parse(readFileSync(file, 'utf8'));
    return { jobs: obj.jobs || {} };
  } catch (e) {
    console.warn(`  ⚠ recent-events.json 解析失败（${e.message}），使用空`);
    return { jobs: {} };
  }
}

/**
 * 取某 job 最近 N 天（不含今天）已发布的事件标题，供 select 注入 prompt。
 * @returns {string[]} 按日期倒序的标题列表
 */
export function getRecentTitles(repoRoot, jobName, days = 2) {
  const { jobs } = loadRecentEvents(repoRoot);
  const jobEntries = jobs[jobName] || {};
  const dates = Object.keys(jobEntries).sort().reverse(); // 最新在前
  const titles = [];
  for (const d of dates.slice(0, days)) {
    titles.push(...(jobEntries[d] || []));
  }
  return titles;
}

/**
 * 把今日发布的事件标题写入 recent-events。
 * @param {string} repoRoot
 * @param {string} jobName  job 名（如 daily）
 * @param {string} dateStr  YYYY-MM-DD
 * @param {string[]} titles  本次发布的事件标题列表
 */
export function saveRecentEvents(repoRoot, jobName, dateStr, titles) {
  const data = loadRecentEvents(repoRoot);
  if (!data.jobs[jobName]) data.jobs[jobName] = {};
  data.jobs[jobName][dateStr] = titles;

  // 淘汰超期（按日期，每 job 只保留 MAX_DAYS 天）
  for (const jn of Object.keys(data.jobs)) {
    const dates = Object.keys(data.jobs[jn]).sort().reverse();
    if (dates.length > MAX_DAYS) {
      for (const d of dates.slice(MAX_DAYS)) delete data.jobs[jn][d];
    }
  }

  const file = resolve(repoRoot, PATH);
  writeFileSync(
    file,
    JSON.stringify(
      {
        _meta: {
          desc: '近期发布的事件标题（供 select 跨天语义去重）。key=job名，value={日期:[标题]}。',
          updated: dateStr,
        },
        jobs: data.jobs,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`  recent-events：写入 ${jobName}/${dateStr}（${titles.length} 标题），${isCI ? 'CI' : '本地'} → ${PATH}`);
}
