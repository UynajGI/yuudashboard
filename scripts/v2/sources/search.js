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

// SEO 垃圾 / 内容农场 / 仿冒站域名（搜索结果质量过滤）
const SPAM_DOMAINS = [
  'hmdown.com', 'sc5b.net', 'binancememe.com', 'f-binance.cn',
  'nbtianjie.com', 'clphlxq.nbtianjie', 'tdgy.net', 'jb51.net/blockchain',
  '120btc.com/zixun', 'btc.hmdown', 'btchangqing.cn',
];
// 垃圾标题关键词（下载/平台介绍/教程/行情站导航/科普，非新闻）
const SPAM_TITLE_KW = [
  '下载', '官方app', '交易平台推荐', '官网入口', '注册', '官网',
  '行情走势图', '价格行情_', '最新价格', '价格预测', '价格走势',
  '是什么', '怎么看', '怎么买', '教程', '攻略', '入门',
  '敬请收看', '敬请关注', '内测疑似', '了解比特币', '什么是',
  '排名的前', '更新版',
];

/** 判断搜索结果是否为 SEO 垃圾 */
function isSpam(title, href) {
  const url = (href || '').toLowerCase();
  const t = (title || '').toLowerCase();
  if (SPAM_DOMAINS.some((d) => url.includes(d))) return true;
  if (SPAM_TITLE_KW.some((k) => t.includes(k))) return true;
  return false;
}

/** 从文本中提取日期（返回 Date 或 null）。扫描 title+body+url 三处。
 *  覆盖：2024-01-15 / 2024/1/15 / 2024年1月15日 / Jan 15 2024 等 */
const MONTHS_EN = { jan:0,feb:1,mar:2,apr:3,may:4,jun:5,jul:6,aug:7,sep:8,oct:9,nov:10,dec:11 };
function extractDate(...texts) {
  const s = texts.filter(Boolean).join(' ');
  // 数字日期：YYYY-MM-DD / YYYY/MM/DD / YYYY.MM.DD
  let m = s.match(/20(\d{2})[\/\-.](\d{1,2})[\/\-.](\d{1,2})/);
  if (m) {
    const d = new Date(2000+ +m[1], +m[2]-1, +m[3]);
    if (!isNaN(d.getTime())) return d;
  }
  // 中文日期：2024年1月15日
  m = s.match(/20(\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})/);
  if (m) {
    const d = new Date(2000+ +m[1], +m[2]-1, +m[3]);
    if (!isNaN(d.getTime())) return d;
  }
  // 英文日期：Jan 15 2024 / January 15, 2024 / 15 Jan 2024
  m = s.match(/(\d{1,2})?\s*[-\s]*(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s*[-\s]*(\d{1,2})?,?\s*[-\s]*20(\d{2})/i);
  if (m) {
    const mon = MONTHS_EN[m[2].toLowerCase()];
    const day = parseInt(m[1] || m[3], 10);
    if (mon != null && day) {
      const d = new Date(2000 + +m[4], mon, day);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}

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

  /** raw [{title,href,body}] → NewsItem[]
   *  策略：搜索结果信任级别低于 RSS。
   *  - body/title/url 能提取到日期且 >48h → 明确旧文，丢弃
   *  - 提取不到日期 → 保留（标 null），让 ingest 的 urlDateStale 再拦 + select 阶段判断
   *    （ddgs text 的 snippet 常无日期，全丢弃会饿死）
   */
  normalize(raw) {
    if (!Array.isArray(raw)) return [];
    const now = Date.now();
    return raw
      .filter((r) => r.title && r.title.length >= 4)
      .filter((r) => !isSpam(r.title, r.href))
      .map((r) => {
        const d = extractDate(r.title, r.body, r.href);
        // 提取到且明确过旧 → 丢弃
        if (d && (now - d.getTime() > 48 * 3600_000)) return null;
        return new NewsItem({
          title: r.title,
          link: r.href || '',
          summary: (r.body || '').slice(0, 300),
          source: this.name,
          category: this.category,
          date: d || null,
        });
      })
      .filter(Boolean);
  }
}
