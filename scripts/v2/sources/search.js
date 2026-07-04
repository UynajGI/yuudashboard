// SearchSource: 通过 ddgs（DuckDuckGo）搜索补 RSS 盲区。
// 本质和 RSS 一样——都是产出 NewsItem 进 pipeline，select/summarize 不区分来源。
// 用法：new SearchSource({ name, query, category, max })

import { execFile } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ItemSource } from '../core/source.js';
import { NewsItem } from '../core/item.js';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)));
const SCRIPT = resolve(HERE, '..', 'search.py');

/**
 * 调 Python ddgs 脚本，返回原始结果数组 [{title, href, body}]。
 * 失败返回 []，不阻塞 pipeline。
 */
function runSearch(query, max, timelimit = 'd') {
  return new Promise((resolve) => {
    execFile('python3', [SCRIPT, `--query=${query}`, `--max=${max}`, `--timelimit=${timelimit}`], {
      timeout: 30000,
      maxBuffer: 2 * 1024 * 1024,
    }, (err, stdout, stderr) => {
      if (err) {
        console.warn(`  ⚠ 搜索「${query}」失败：${err.message}`);
        resolve([]);
        return;
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        resolve([]);
      }
    });
  });
}

export class SearchSource extends ItemSource {
  constructor(config) {
    super(config);
    this.query = config.query;
    this.max = config.max || 10;
    this.timelimit = config.timelimit || 'd';
  }

  async fetch() {
    return runSearch(this.query, this.max, this.timelimit);
  }

  /** raw [{title,href,body}] → NewsItem[] */
  normalize(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r) => r.title && r.title.length >= 4)
      .map((r) => new NewsItem({
        title: r.title,
        link: r.href || '',
        summary: (r.body || '').slice(0, 300),
        source: this.name,
        category: this.category,
        // ddgs text 无精确日期，timelimit='d' 已保证 24h 内；date 留空走 window 保留策略
        date: null,
      }));
  }
}
