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

/** 从文本中提取可能的日期（返回 Date 或 null） */
function extractDate(text) {
  // 匹配 2024-01-15 / 2024/01/15 / 2024年1月15日 等格式
  const m = text.match(/20(\d{2})[-/年](\d{1,2})[-/月](\d{1,2})/);
  if (!m) return null;
  const y = 2000 + parseInt(m[1], 10);
  const mo = parseInt(m[2], 10) - 1;
  const d = parseInt(m[3], 10);
  const dt = new Date(y, mo, d);
  return isNaN(dt.getTime()) ? null : dt;
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

  /** raw [{title,href,body}] → NewsItem[] */
  normalize(raw) {
    if (!Array.isArray(raw)) return [];
    return raw
      .filter((r) => r.title && r.title.length >= 4)
      .filter((r) => !isSpam(r.title, r.href))
      .map((r) => {
        const extracted = extractDate(r.body || '');
        const now = Date.now();
        // 只信任从 body 中明确提取到的日期；取不到就 null（ingest 保守保留）
        // 如果提取到的日期距今超过 48h，视为明显过时丢弃
        const valid = !extracted || (now - extracted.getTime() <= 48 * 3600_000);
        if (!valid) return null;
        return new NewsItem({
          title: r.title,
          link: r.href || '',
          summary: (r.body || '').slice(0, 300),
          source: this.name,
          category: this.category,
          // 有明确日期的用提取值，没有的留 null——绝不造假为 new Date()
          date: extracted || null,
        });
      })
      .filter(Boolean);
  }
}
