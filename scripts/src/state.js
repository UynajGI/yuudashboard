// seen.json 读写：跨日幂等，防止同一报道重复推送。
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

// 本地调试用 seen.local.json（gitignore 排除），CI 用 seen.json（提交进 repo）。
// 这样本地重跑不会污染 CI 的去重状态，反之亦然。
const isCI = !!process.env.CI || !!process.env.GITHUB_ACTIONS;
const STATE_PATH = isCI ? 'data/seen.json' : 'data/seen.local.json';
const MAX_ENTRIES = 5000; // 防止无限增长，超出按时间淘汰

function defaultState() {
  return { _meta: undefined, urls: {}, titles: {} };
}

/** 读取 seen state。损坏时返回空 state 而非崩溃（管道可继续跑）。 */
export function loadState(repoRoot) {
  const file = resolve(repoRoot, STATE_PATH);
  if (!existsSync(file)) return defaultState();
  try {
    const obj = JSON.parse(readFileSync(file, 'utf8'));
    return {
      urls: obj.urls || {},
      titles: obj.titles || {},
    };
  } catch (e) {
    console.warn(`  ⚠ seen.json 解析失败（${e.message}），使用空 state`);
    return defaultState();
  }
}

/** 把本次发布的条目 hash 写回，并淘汰过旧条目。 */
export function saveState(repoRoot, state, newItems) {
  const file = resolve(repoRoot, STATE_PATH);
  const today = new Date().toISOString().slice(0, 10);
  for (const it of newItems) {
    if (it.urlHash) state.urls[it.urlHash] = today;
    if (it.titleHash) state.titles[it.titleHash] = today;
  }
  // 淘汰：超出上限时丢掉最旧的（按 value 日期）
  prune(state.urls);
  prune(state.titles);
  writeFileSync(
    file,
    JSON.stringify(
      {
        _meta: {
          desc: '已发布条目的去重记录。key=hash，value=发布日期。',
          updated: today,
        },
        urls: state.urls,
        titles: state.titles,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`  state：写入 ${newItems.length} 条，总计 urls=${Object.keys(state.urls).length} titles=${Object.keys(state.titles).length}（${isCI ? 'CI' : '本地'} → ${STATE_PATH}）`);
}

function prune(map) {
  const keys = Object.keys(map);
  if (keys.length <= MAX_ENTRIES) return;
  // 按 value（日期）升序，淘汰最旧的一批
  keys
    .sort((a, b) => (map[a] < map[b] ? -1 : 1))
    .slice(0, keys.length - MAX_ENTRIES)
    .forEach((k) => delete map[k]);
}
