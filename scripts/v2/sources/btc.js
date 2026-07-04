// BTC 行情源：多源 fallback（CoinGecko 主 → Gate.io 备）。
// 迁移自 fetch-market.js 的 fetchBTC + fetchBTCFromCoinGecko + fetchBTCFromGate。

import { FallbackMarketSource, MarketSource } from '../core/source.js';
import { Quote } from '../core/item.js';

class CoinGeckoBtc extends MarketSource {
  constructor() { super({ name: 'CoinGecko' }); }
  async fetch() {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true',
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const btc = (await res.json()).bitcoin;
    if (!btc) throw new Error('无 bitcoin 数据');
    return { price: btc.usd, changePct: btc.usd_24h_change ?? 0 };
  }
  normalize(d) {
    return new Quote({ name: 'BTC', price: d.price, changePct: d.changePct, source: 'CoinGecko' });
  }
}

class GateIoBtc extends MarketSource {
  constructor() { super({ name: 'Gate.io' }); }
  async fetch() {
    const res = await fetch(
      'https://api.gateio.ws/api/v4/spot/tickers?currency_pair=BTC_USDT',
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const arr = await res.json();
    const t = arr?.[0];
    if (!t) throw new Error('无 ticker');
    return { price: parseFloat(t.last), changePct: parseFloat(t.change_percentage) || 0 };
  }
  normalize(d) {
    return new Quote({ name: 'BTC', price: d.price, changePct: d.changePct, source: 'Gate.io' });
  }
}

/** BTC 复合源：CoinGecko → Gate.io，第一个成功即用 */
export class BtcSource extends FallbackMarketSource {
  constructor() {
    super({ name: 'BTC' }, [new CoinGeckoBtc(), new GateIoBtc()]);
  }
}
