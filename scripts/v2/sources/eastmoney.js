// 东方财富 KOSPI 源。
// 迁移自 fetch-market.js 的 fetchKOSPI。

import { MarketSource } from '../core/source.js';
import { Quote } from '../core/item.js';

export class KospiSource extends MarketSource {
  constructor() { super({ name: 'Eastmoney KOSPI' }); }

  async fetch() {
    const res = await fetch(
      'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f12,f14&secids=100.KS11',
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const item = json?.data?.diff?.[0];
    if (!item) throw new Error('无 KOSPI 数据');
    return { price: item.f2, changePct: item.f3 };
  }

  normalize(d) {
    return new Quote({ name: '韩国 KOSPI', price: d.price, changePct: d.changePct, source: 'Eastmoney' });
  }
}
