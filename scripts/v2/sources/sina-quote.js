// 新浪行情源：批量请求 Sina hq API → GBK 解码 → 多格式解析 → Quote[]。
// 迁移自 src/fetch-market.js 的主请求部分（不含 BTC/KOSPI/美债，那些独立成源）。

import iconv from 'iconv-lite';
import { MarketSource } from '../core/source.js';
import { Quote } from '../core/item.js';

// ── 品种定义 ──────────────────────────────────────────
// market: ashare/hk/us/commodity/crypto/all —— 用于按市场拆分金融报告
const SYMBOLS = {
  'sh000001': { name: '上证综指', cat: 'indices', market: 'ashare' },
  'sz399001': { name: '深证成指', cat: 'indices', market: 'ashare' },
  'sz399006': { name: '创业板指', cat: 'indices', market: 'ashare' },
  'sh000688': { name: '科创50', cat: 'indices', market: 'ashare' },
  'int_hangseng': { name: '恒生指数', cat: 'indices', market: 'hk' },
  'hkHSTECH': { name: '恒生科技', cat: 'indices', market: 'hk', fmt: 'hk' },
  'int_nikkei': { name: '日经 225', cat: 'indices', market: 'hk' },
  'int_dji': { name: '道琼斯', cat: 'indices', market: 'us' },
  'int_nasdaq': { name: '纳斯达克', cat: 'indices', market: 'us' },
  'int_sp500': { name: '标普500', cat: 'indices', market: 'us' },
  'hf_CL': { name: 'WTI 原油', cat: 'assets', market: 'commodity', unit: '$', decimals: 2 },
  'hf_GC': { name: '黄金', cat: 'assets', market: 'commodity', unit: '$', decimals: 2, suffix: '/oz' },
  'DINIW': { name: '美元指数', cat: 'assets', market: 'commodity', unit: '', decimals: 2 },
};

// 导出 market→symbols 映射，供 sources/index.js 按市场选源
export const MARKET_SYMBOLS = SYMBOLS;

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
 * 新浪行情批量源。market 参数控制只拉哪个市场的品种：
 *   ashare/hk/us/commodity/crypto/all（缺省 all）
 * BTC/KOSPI/美债 是独立源，不在此处。
 */
export class SinaQuoteSource extends MarketSource {
  constructor(market = 'all') {
    super({ name: market === 'all' ? '新浪行情' : `新浪行情(${market})` });
    this.market = market;
    // 按 market 筛选 symbols
    this.symbols = market === 'all'
      ? Object.keys(SYMBOLS)
      : Object.entries(SYMBOLS).filter(([, v]) => v.market === market).map(([k]) => k);
  }

  async fetch() {
    const url = 'https://hq.sinajs.cn/list=' + this.symbols.join(',');
    const buf = await fetch(url, {
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
