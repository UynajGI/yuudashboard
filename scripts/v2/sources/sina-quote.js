// 新浪行情源：批量请求 Sina hq API → GBK 解码 → 多格式解析 → Quote[]。
// 迁移自 src/fetch-market.js 的主请求部分（不含 BTC/KOSPI/美债，那些独立成源）。

import iconv from 'iconv-lite';
import { MarketSource } from '../core/source.js';
import { Quote } from '../core/item.js';

// ── 品种定义 ──────────────────────────────────────────
const SYMBOLS = {
  // A 股指数（33 字段格式，含 OHLC）
  'sh000001': { name: '上证综指', cat: 'indices' },
  'sz399001': { name: '深证成指', cat: 'indices' },
  'sz399006': { name: '创业板指', cat: 'indices' },
  'sh000688': { name: '科创50', cat: 'indices' },
  // 亚太指数（int_* 4字段格式 或 hk* 格式）
  'int_hangseng': { name: '恒生指数', cat: 'indices' },
  'hkHSTECH': { name: '恒生科技', cat: 'indices', fmt: 'hk' },
  'int_nikkei': { name: '日经 225', cat: 'indices' },
  // 美股三大指数（int_* 4字段格式）
  'int_dji': { name: '道琼斯', cat: 'indices' },
  'int_nasdaq': { name: '纳斯达克', cat: 'indices' },
  'int_sp500': { name: '标普500', cat: 'indices' },
  // 核心资产（期货 hf_* / 外汇 DINIW）
  'hf_CL': { name: 'WTI 原油', cat: 'assets', unit: '$', decimals: 2 },
  'hf_GC': { name: '黄金', cat: 'assets', unit: '$', decimals: 2, suffix: '/oz' },
  'DINIW': { name: '美元指数', cat: 'assets', unit: '', decimals: 2 },
};

const SINA_URL = 'https://hq.sinajs.cn/list=' + Object.keys(SYMBOLS).join(',');

// ── 数字格式化（迁移自 fetch-market.js）──────────────────
function fmtNum(n, decimals = 2) {
  if (!isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}
function fmtChange(n, decimals = 2) {
  if (!isFinite(n)) return '—';
  return (n > 0 ? '+' : '') + n.toFixed(decimals) + '%';
}
function changeClass(n) {
  if (!isFinite(n)) return '';
  return n > 0 ? 'up' : n < 0 ? 'down' : '';
}

/**
 * 新浪行情批量源。一次 HTTP 请求获取所有 A股/港股/美股/亚太指数 + 商品。
 * BTC / KOSPI / 美债 是独立源（各自的 API），不在此处。
 */
export class SinaQuoteSource extends MarketSource {
  constructor() {
    super({ name: '新浪行情' });
  }

  async fetch() {
    const buf = await fetch(SINA_URL, {
      headers: { Referer: 'https://finance.sina.com.cn' },
      signal: AbortSignal.timeout(15000),
    }).then((r) => r.arrayBuffer());
    const text = iconv.decode(Buffer.from(buf), 'gbk');
    return text.split('\n').filter((l) => l.trim());
  }

  /** 解析所有行 → { indices: Quote[], assets: Quote[] } */
  normalize(lines) {
    const indices = [];
    const assets = [];

    for (const line of lines) {
      const m = line.match(/hq_str_(\w+)="(.+)"/);
      if (!m) continue;
      const [, symbol, raw] = m;
      const def = SYMBOLS[symbol];
      if (!def) continue;

      const fields = raw.split(',');

      if (def.cat === 'indices') {
        indices.push(this._parseIndex(symbol, def, fields));
      } else if (def.cat === 'assets') {
        assets.push(this._parseAsset(symbol, def, fields));
      }
    }
    return { indices, assets };
  }

  _parseIndex(symbol, def, fields) {
    let price, changePct, change, open, high, low;
    if (def.fmt === 'hk') {
      // 港股格式：fields[6]=price, fields[8]=changePct%
      price = parseFloat(fields[6]) || 0;
      changePct = parseFloat(fields[8]) || 0;
      change = 0;
    } else if (symbol.startsWith('int_')) {
      // 全球指数 4 字段：名称,价格,涨跌额,涨跌幅
      price = parseFloat(fields[1]);
      change = parseFloat(fields[2]) || 0;
      changePct = parseFloat(fields[3]) || 0;
    } else {
      // A 股 33 字段：fields[1]=close [2]=prevClose [3]=open [4]=high [5]=low
      price = parseFloat(fields[1]);
      const prevClose = parseFloat(fields[2]);
      open = parseFloat(fields[3]);
      high = parseFloat(fields[4]);
      low = parseFloat(fields[5]);
      change = price - prevClose;
      changePct = prevClose ? (change / prevClose) * 100 : 0;
    }
    return new Quote({
      name: def.name, price, changePct, change,
      ...(open != null && { open, high, low }),
    });
  }

  _parseAsset(symbol, def, fields) {
    const isFuture = symbol.startsWith('hf_');
    const price = parseFloat(isFuture ? fields[0] : fields[1]) || 0;
    // FIXME(DINIW): fields[2] 与 fields[1] 同值非昨收 → 涨跌幅恒 0。
    //   临时：期货用 fields[2]；DINIW 用 fields[7](low) 兜底。待工作日重测。
    const prevClose = isFuture
      ? (parseFloat(fields[2]) || price)
      : (parseFloat(fields[7]) || parseFloat(fields[2]) || price);
    const change = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;
    const key = symbol === 'hf_GC' ? 'gold' : symbol === 'hf_CL' ? 'oil' : 'usd';
    return new Quote({ name: def.name, price, changePct, change, key });
  }
}
