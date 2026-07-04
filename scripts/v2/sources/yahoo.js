// Yahoo 美债 10Y 源。
// 迁移自 fetch-market.js 的 fetchUSTreasury。

import { MarketSource } from '../core/source.js';
import { Quote } from '../core/item.js';

export class UsTreasurySource extends MarketSource {
  constructor() { super({ name: 'Yahoo 美债10Y' }); }

  async fetch() {
    const res = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=3d',
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error('无 ^TNX 数据');
    const meta = result.meta;
    const price = meta.regularMarketPrice;
    const prevClose = meta.previousClose
      ?? (result.indicators?.quote?.[0]?.close?.filter(Boolean).slice(-2)[0])
      ?? price;
    const change = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;
    return { price, change, changePct };
  }

  normalize(d) {
    // 美债 changeStr 特殊（bp），但 Quote 只存原始值，格式化交给 renderer
    return new Quote({ name: '美债 10Y', price: d.price, changePct: d.changePct, change: d.change, source: 'Yahoo' });
  }
}
