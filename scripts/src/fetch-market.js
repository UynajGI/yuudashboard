// 市场数据抓取：新浪财经 API → 结构化指数/商品/BTC 数据。
// 一次 HTTP 请求批量获取所有品种，GBK 解码后解析。
// 纯脚本，0 token。

import iconv from 'iconv-lite';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

// 若设置了 HTTPS_PROXY / ALL_PROXY，自动走代理（本地调试用）
const proxyUrl = process.env.HTTPS_PROXY || process.env.ALL_PROXY || '';
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent({ uri: proxyUrl, connect: { family: 4 } }));
  console.log(`  代理：${proxyUrl}`);
}

// ── 品种定义 ──────────────────────────────────────────
const SYMBOLS = {
  // A 股指数（33 字段格式，含 OHLC：fields[1]=close [3]=open [4]=high [5]=low）
  'sh000001': { name: '上证综指', cat: 'indices' },
  'sz399001': { name: '深证成指', cat: 'indices' },
  'sz399006': { name: '创业板指', cat: 'indices' },
  'sh000688': { name: '科创50',   cat: 'indices' },
  // 亚太指数（4 字段格式 int_* 或 hk* 格式）
  'int_hangseng': { name: '恒生指数',  cat: 'indices' },
  'hkHSTECH':     { name: '恒生科技',  cat: 'indices', fmt: 'hk' },
  'int_nikkei':   { name: '日经 225',  cat: 'indices' },
  // 美股三大指数（4 字段 int_* 格式：名称,价格,涨跌额,涨跌幅）
  'int_dji':    { name: '道琼斯',   cat: 'indices' },
  'int_nasdaq': { name: '纳斯达克', cat: 'indices' },
  'int_sp500':  { name: '标普500',  cat: 'indices' },
  // 核心资产
  'hf_CL':  { name: 'WTI 原油', cat: 'assets', unit: '$', decimals: 2 },
  'hf_GC':  { name: '黄金',     cat: 'assets', unit: '$', decimals: 2, suffix: '/oz' },
  'DINIW':  { name: '美元指数', cat: 'assets', unit: '',  decimals: 2 },
};

const SINA_URL = 'https://hq.sinajs.cn/list=' + Object.keys(SYMBOLS).join(',');

// ── 解析器 ────────────────────────────────────────────

/**
 * 解析 A 股指数（33 字段 var hq_str_sh000001="名称,当前,昨收,开盘,最高,最低,..."）
 * 保留 OHLC 供日内振幅条 / 历史快照使用，零额外请求。
 */
function parseAIndex(fields) {
  // fields[0]=名称, [1]=当前价, [2]=昨收, [3]=开盘, [4]=最高, [5]=最低
  const price = parseFloat(fields[1]);
  const prevClose = parseFloat(fields[2]);
  const open = parseFloat(fields[3]);
  const high = parseFloat(fields[4]);
  const low = parseFloat(fields[5]);
  const change = price - prevClose;
  const changePct = prevClose ? (change / prevClose) * 100 : 0;
  return { price, prevClose, open, high, low, change, changePct };
}

/** 解析全球指数（4 字段：名称,价格,涨跌额,涨跌幅） */
function parseGlobalIndex(fields) {
  const price = parseFloat(fields[1]);
  const change = parseFloat(fields[2]) || 0;
  const changePct = parseFloat(fields[3]) || 0;
  return { price, change, changePct };
}

/** 解析商品期货（hf_* 格式：当前价,空,昨收,开盘,最高,最低,时间,...） */
function parseFuture(fields) {
  // fields[0]=当前价, [1]=空, [2]=昨收, [3]=开盘, [4]=最高, [5]=最低
  const price = parseFloat(fields[0]) || 0;
  const prevClose = parseFloat(fields[2]) || price;
  const change = price - prevClose;
  const changePct = prevClose ? (change / prevClose) * 100 : 0;
  return { price, prevClose, change, changePct };
}

/** 数字格式化：保留指定小数 + 千分位 */
function fmtNum(n, decimals = 2) {
  if (!isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** 涨跌幅格式化：正数带 + */
function fmtChange(n, decimals = 2) {
  if (!isFinite(n)) return '—';
  const sign = n > 0 ? '+' : '';
  return sign + n.toFixed(decimals) + '%';
}

/** 涨跌 CSS class */
function changeClass(n) {
  if (!isFinite(n)) return '';
  return n > 0 ? 'up' : n < 0 ? 'down' : '';
}

// ── BTC 抓取（多源容错）──────────────────────────────
// 主源 CoinGecko（GA runner 可通，本地被墙）→ 备源 Gate.io（国内可达）
async function fetchBTCFromCoinGecko() {
  const res = await fetch(
    'https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true',
    { signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
  const btc = (await res.json()).bitcoin;
  if (!btc) return null;
  const price = btc.usd;
  const changePct = btc.usd_24h_change ?? 0;
  return { price, changePct };
}

async function fetchBTCFromGate() {
  const res = await fetch(
    'https://api.gateio.ws/api/v4/spot/tickers?currency_pair=BTC_USDT',
    { signal: AbortSignal.timeout(8000) },
  );
  if (!res.ok) return null;
  const arr = await res.json();
  const t = arr?.[0];
  if (!t) return null;
  const price = parseFloat(t.last);
  // change_percentage 是字符串如 "1.68"，表示百分比
  const changePct = parseFloat(t.change_percentage) || 0;
  return { price, changePct };
}

async function fetchBTC() {
  // 依次尝试，首个成功即用
  for (const [src, fn] of [['CoinGecko', fetchBTCFromCoinGecko], ['Gate.io', fetchBTCFromGate]]) {
    try {
      const r = await fn();
      if (r && isFinite(r.price) && r.price > 0) {
        const { price, changePct } = r;
        const change = price ? (price * changePct) / (100 + changePct) : 0;
        return { name: 'BTC', price, change, changePct, source: src,
          priceStr: '$' + fmtNum(price, 0),
          changeStr: fmtChange(changePct, 2),
          changeClass: changeClass(changePct),
        };
      }
    } catch { /* 该源失败，试下一个 */ }
  }
  return null;
}

// ── 韩国 KOSPI（东方财富 API，GA/本地均通）───
async function fetchKOSPI() {
  try {
    const res = await fetch(
      'https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&fields=f2,f3,f12,f14&secids=100.KS11',
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const json = await res.json();
    const item = json?.data?.diff?.[0];
    if (!item) return null;
    const price = item.f2;
    const changePct = item.f3;
    const change = price ? (price * changePct) / (100 + changePct) : 0;
    return { name: '韩国 KOSPI', price, change, changePct,
      priceStr: fmtNum(price, 2),
      changeStr: fmtChange(changePct, 2),
      changeClass: changeClass(changePct),
    };
  } catch {
    return null;
  }
}
async function fetchUSTreasury() {
  try {
    const res = await fetch(
      'https://query1.finance.yahoo.com/v8/finance/chart/%5ETNX?interval=1d&range=3d',
      { signal: AbortSignal.timeout(8000) },
    );
    if (!res.ok) return null;
    const json = await res.json();
    const result = json?.chart?.result?.[0];
    if (!result) return null;
    const meta = result.meta;
    const price = meta.regularMarketPrice;
    // previousClose 在 meta 里，或者从 K 线倒数第二条的 close 取
    const prevClose = meta.previousClose
      ?? (result.indicators?.quote?.[0]?.close?.filter(Boolean).slice(-2)[0])
      ?? price;
    const change = price - prevClose;
    const changePct = prevClose ? (change / prevClose) * 100 : 0;
    return { name: '美债 10Y', price, change, changePct,
      priceStr: fmtNum(price, 2) + '%',
      changeStr: change ? ((change > 0 ? '+' : '') + (change * 100).toFixed(1) + ' bp') : '0.0 bp',
      changeClass: changeClass(change),
    };
  } catch {
    return null;
  }
}

// ── 主入口 ────────────────────────────────────────────

/**
 * 抓取所有市场数据，返回结构化对象。
 * @returns {Promise<{ indices: Array, assets: Array, btc: object|null, usTreasury: object|null }>}
 */
export async function fetchMarketData() {
  console.log('  新浪 API → 市场数据 ...');

  // 批量请求新浪
  const buf = await fetch(SINA_URL, {
    headers: { Referer: 'https://finance.sina.com.cn' },
    signal: AbortSignal.timeout(15000),
  }).then((r) => r.arrayBuffer());

  const text = iconv.decode(Buffer.from(buf), 'gbk');
  const lines = text.split('\n').filter((l) => l.trim());

	const indices = [];
	const assets = [];

  for (const line of lines) {
    // 匹配 var hq_str_XXX="..."
    const m = line.match(/hq_str_(\w+)="(.+)"/);
    if (!m) continue;
    const [, symbol, raw] = m;
    const def = SYMBOLS[symbol];
    if (!def) continue;

    const fields = raw.split(',');

    if (def.cat === 'indices') {
      if (def.fmt === 'hk') {
        // 港股格式：fields[6]=price, fields[8]=changePct%
        const price = parseFloat(fields[6]) || 0;
        const changePct = parseFloat(fields[8]) || 0;
        indices.push({
          name: def.name,
          price, change: 0, changePct,
          priceStr: fmtNum(price, 2),
          changeStr: fmtChange(changePct, 2),
          changeClass: changeClass(changePct),
        });
      } else {
        const isGlobal = symbol.startsWith('int_');
        const parsed = isGlobal ? parseGlobalIndex(fields) : parseAIndex(fields);
        const item = {
          name: def.name,
          price: parsed.price,
          change: parsed.change,
          changePct: parsed.changePct,
          priceStr: fmtNum(parsed.price, 2),
          changeStr: fmtChange(parsed.changePct, 2),
          changeClass: changeClass(parsed.changePct),
        };
        // A 股带 OHLC（日内振幅 / 历史快照用），int_* 全球指数无此字段
        if (!isGlobal && parsed.open != null) {
          item.open = parsed.open;
          item.high = parsed.high;
          item.low = parsed.low;
        }
        indices.push(item);
      }
    } else if (def.cat === 'assets') {
      // 核心资产：期货 hf_* 用 fields[0]=价 fields[2]=昨收
      const isFuture = symbol.startsWith('hf_');
      const price = parseFloat(isFuture ? fields[0] : fields[1]) || 0;
      // FIXME(美元指数 DINIW): fields[2] 与 fields[1] 同值，并非昨收 → 涨跌幅恒为 0。
      //   探测 2026-07-04（周六+美独立日休市）样本字段：
      //     [0]time [1]current [2]current [3]bid [4]? [5]? [6]high [7]low [8]current [9]name [10]date
      //   待工作日（非节假日、行情有 ≥0.3% 波动）重测，对照官方 DXY 涨跌定位 prevClose 字段。
      //   临时方案：hf_* 仍用 fields[2]；DINIW 的 prevClose 用 fields[7](low) 兜底，至少有非零波动。
      const prevClose = isFuture
        ? (parseFloat(fields[2]) || price)
        : (parseFloat(fields[7]) || parseFloat(fields[2]) || price);
      const change = price - prevClose;
      const changePct = prevClose ? (change / prevClose) * 100 : 0;
      const priceStr = (def.unit || '') + fmtNum(price, def.decimals ?? 2) + (def.suffix || '');
      assets.push({
        key: symbol === 'hf_GC' ? 'gold' : symbol === 'hf_CL' ? 'oil' : 'usd',
        name: def.name,
        price, change, changePct,
        priceStr,
        changeStr: fmtChange(changePct, 2),
        changeClass: changeClass(changePct),
      });
    }
  }

  console.log(`    指数 ${indices.length} 项 · 资产 ${assets.length} 项`);

  // 海外数据：BTC（多源）/ 美债 / 韩国（GA runner 可通，本地被墙则静默跳过）
  const [btc, usTreasury, kospi] = await Promise.all([
    fetchBTC().catch(() => null),
    fetchUSTreasury().catch(() => null),
    fetchKOSPI().catch(() => null),
  ]);
  if (btc)   console.log(`    BTC ${btc.priceStr} (${btc.source})`);
  else       console.log('    BTC 不可用（CoinGecko + Gate.io 均失败）');
  if (usTreasury) console.log(`    美债 ${usTreasury.priceStr} (Yahoo)`);
  else            console.log('    美债 不可用');
  if (kospi)      console.log(`    KOSPI ${kospi.priceStr} (Eastmoney)`);
  else            console.log('    KOSPI 不可用');

  return { indices, assets, btc, usTreasury, kospi };
}
