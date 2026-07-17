// Live crypto prices for the Markets analytics slider. Multi-source for resilience
// (CoinGecko rate-limits): CoinGecko gives price + 24h change + a real 7d sparkline;
// if it fails we fall back to the same oracle the main markets use (Pyth/Switchboard/
// Jupiter, price only). Graphs are genuine, never faked.
import { getOraclePrice, type OraclePair } from '../oracle/prices';

// Top coins by 24h traded volume (incl. active memes), real-time, with 7d sparkline.
const CG = 'https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=volume_desc&per_page=30&page=1&sparkline=true&price_change_percentage=24h';
const STABLE_SYM = new Set(['usdt', 'usdc', 'dai', 'fdusd', 'usde', 'tusd', 'usds', 'busd', 'pyusd', 'usd1', 'usdg', 'xaut', 'paxg', 'eurc', 'weth', 'wbtc', 'steth', 'wsteth', 'wbeth']);
const CARD_LIMIT = 18;

export interface CryptoPrice {
  id: string;
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  spark: number[];
  image: string;
  supply: number;
}

// Real trading candles from Binance (free, no key, every interval). The chart
// uses these so it reads like a real chart (1m..1w) and updates live. Most top
// coins trade as <SYMBOL>USDT — default to that so the chart works for the whole
// top-volume card set, not just a hardcoded five. A few tickers differ (override),
// and a few aren't on Binance spot at all (null → graceful empty/CoinGecko path).
const BINANCE_OVERRIDE: Record<string, string> = { IOTA: 'IOTAUSDT', MIOTA: 'IOTAUSDT' };
const NO_BINANCE = new Set(['STETH', 'WBTC', 'WETH', 'WBETH', 'WSTETH', 'LEO', 'USDT', 'USDC', 'DAI']);
export interface Candle { t: number; c: number; }
export function binancePair(symbol: string): string | null {
  const s = (symbol || '').toUpperCase();
  if (!s || NO_BINANCE.has(s)) return null;
  return BINANCE_OVERRIDE[s] || `${s}USDT`;
}
async function binanceKlines(pair: string, interval: string, limit: number): Promise<Candle[]> {
  try {
    const r = await fetch(`https://api.binance.com/api/v3/klines?symbol=${pair}&interval=${interval}&limit=${limit}`);
    if (!r.ok) return []; // unknown pair → Binance 400; fall through to CoinGecko
    const d = await r.json();
    return Array.isArray(d) ? d.map((k: (string | number)[]) => ({ t: Number(k[0]), c: Number(k[4]) })).filter((x) => isFinite(x.c)) : [];
  } catch {
    return [];
  }
}

// Source 2 + 3: OKX and Bybit spot klines — additional reliable, no-key exchanges
// (CORS-clean) so we never lean on one provider. Both return newest-first → reverse.
const OKX_BAR: Record<string, string> = { '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m', '1h': '1H', '4h': '4H', '1d': '1D', '3d': '3D', '1w': '1W' };
const BYBIT_INT: Record<string, string> = { '1m': '1', '5m': '5', '15m': '15', '30m': '30', '1h': '60', '4h': '240', '1d': 'D', '3d': 'D', '1w': 'W' };
async function okxKlines(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const bar = OKX_BAR[interval]; if (!bar) return [];
  try {
    const r = await fetch(`https://www.okx.com/api/v5/market/candles?instId=${symbol.toUpperCase()}-USDT&bar=${bar}&limit=${Math.min(limit, 300)}`);
    if (!r.ok) return [];
    const d = await r.json();
    if (d?.code !== '0' || !Array.isArray(d.data)) return [];
    return d.data.map((k: string[]) => ({ t: Number(k[0]), c: Number(k[4]) })).filter((x: Candle) => isFinite(x.c)).reverse();
  } catch { return []; }
}
async function bybitKlines(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const iv = BYBIT_INT[interval]; if (!iv) return [];
  try {
    const r = await fetch(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol.toUpperCase()}USDT&interval=${iv}&limit=${Math.min(limit, 1000)}`);
    if (!r.ok) return [];
    const d = await r.json();
    const list = d?.result?.list;
    return Array.isArray(list) ? list.map((k: string[]) => ({ t: Number(k[0]), c: Number(k[4]) })).filter((x: Candle) => isFinite(x.c)).reverse() : [];
  } catch { return []; }
}

// Source 4 (last resort): CoinGecko market_chart by coin id — covers the long tail
// the exchanges lack. Kept last since its free tier can rate-limit.
const INTERVAL_DAYS: Record<string, number> = { '1m': 1, '5m': 1, '15m': 1, '30m': 1, '1h': 7, '4h': 30, '1d': 90, '3d': 365, '1w': 365 };
async function geckoCandles(id: string, days: number): Promise<Candle[]> {
  if (!id) return [];
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`);
    if (!r.ok) return [];
    const d = await r.json();
    return Array.isArray(d?.prices)
      ? d.prices.map((p: [number, number]) => ({ t: Number(p[0]), c: Number(p[1]) })).filter((x: Candle) => isFinite(x.c))
      : [];
  } catch {
    return [];
  }
}

export async function fetchKlines(symbol: string, interval: string, limit = 180, coinId?: string): Promise<Candle[]> {
  const pair = binancePair(symbol);
  if (pair) {
    const b = await binanceKlines(pair, interval, limit);
    if (b.length > 1) return b;
    const o = await okxKlines(symbol, interval, limit);
    if (o.length > 1) return o;
    const y = await bybitKlines(symbol, interval, limit);
    if (y.length > 1) return y;
  }
  return geckoCandles(coinId || '', INTERVAL_DAYS[interval] ?? 7);
}

// Live ticker tape (24h price + change) for the scrolling markets banner. Crypto
// COINS come straight from Binance (24/7 real-time, no key). `pre` is the price
// prefix ('$' for USD-quoted assets, '' for FX rates).
const TICKER_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT',
  'LINKUSDT', 'DOTUSDT', 'TRXUSDT', 'TONUSDT', 'NEARUSDT', 'APTUSDT', 'SUIUSDT', 'SEIUSDT',
  'INJUSDT', 'ARBUSDT', 'OPUSDT', 'ATOMUSDT', 'LTCUSDT', 'UNIUSDT', 'AAVEUSDT', 'FILUSDT',
  'JUPUSDT', 'BONKUSDT', 'WIFUSDT', 'PEPEUSDT', 'SHIBUSDT', 'RNDRUSDT',
];
export interface Ticker { symbol: string; price: number; changePct: number; pre?: string }

const VPS = process.env.EXPO_PUBLIC_VPS_API_URL || '';
export type TickerClass = 'solana' | 'cryptostocks' | 'stocks' | 'forex';

async function fetchWithTimeout(url: string, ms = 6000): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function binanceTicker24h(): Promise<Ticker[]> {
  const q = encodeURIComponent(JSON.stringify(TICKER_SYMBOLS));
  const r = await fetchWithTimeout(`https://api.binance.com/api/v3/ticker/24hr?symbols=${q}`);
  if (!r.ok) return [];
  const d = await r.json();
  if (!Array.isArray(d)) return [];
  return d.map((t: { symbol: string; lastPrice: string; priceChangePercent: string }) => ({
    symbol: t.symbol.replace('USDT', ''),
    price: Number(t.lastPrice),
    changePct: Number(t.priceChangePercent),
  })).filter((x) => isFinite(x.price));
}

// OKX bulk spot ticker, same 24h stats, different host, so it survives Binance
// being geo-blocked or unreachable. change% derived from last vs. open24h.
async function okxTicker24h(): Promise<Ticker[]> {
  const r = await fetchWithTimeout('https://www.okx.com/api/v5/market/tickers?instType=SPOT');
  if (!r.ok) return [];
  const d = await r.json();
  if (d?.code !== '0' || !Array.isArray(d.data)) return [];
  const want = new Set(TICKER_SYMBOLS.map((s) => s.replace('USDT', '')));
  return d.data
    .filter((t: { instId?: string }) => t.instId?.endsWith('-USDT') && want.has(t.instId.replace('-USDT', '')))
    .map((t: { instId: string; last: string; open24h: string }) => {
      const last = Number(t.last), open = Number(t.open24h);
      return { symbol: t.instId.replace('-USDT', ''), price: last, changePct: open ? ((last - open) / open) * 100 : 0 };
    })
    .filter((x: Ticker) => isFinite(x.price));
}

// Bybit bulk spot ticker, third, independent fallback.
async function bybitTicker24h(): Promise<Ticker[]> {
  const r = await fetchWithTimeout('https://api.bybit.com/v5/market/tickers?category=spot');
  if (!r.ok) return [];
  const d = await r.json();
  const list = d?.result?.list;
  if (!Array.isArray(list)) return [];
  const want = new Set(TICKER_SYMBOLS);
  return list
    .filter((t: { symbol?: string }) => t.symbol && want.has(t.symbol))
    .map((t: { symbol: string; lastPrice: string; price24hPcnt: string }) => ({
      symbol: t.symbol.replace('USDT', ''),
      price: Number(t.lastPrice),
      changePct: Number(t.price24hPcnt) * 100,
    }))
    .filter((x: Ticker) => isFinite(x.price));
}

export async function fetchCryptoTicker(): Promise<Ticker[]> {
  for (const source of [binanceTicker24h, okxTicker24h, bybitTicker24h]) {
    try {
      const d = await source();
      if (d.length > 0) return d;
    } catch { /* try next source */ }
  }
  return [];
}

// Crypto-equities / stocks / forex via our own proxy (Yahoo has no CORS header).
export async function fetchClassTicker(cls: TickerClass): Promise<Ticker[]> {
  if (!VPS) return [];
  try {
    const r = await fetch(`${VPS}/api/markets/ticker?class=${cls}`);
    const d = await r.json();
    return Array.isArray(d?.items) ? (d.items as Ticker[]).filter((x) => isFinite(x.price)) : [];
  } catch {
    return [];
  }
}

/** Historical prices for the interactive chart. days: 1 | 7 | 30 | 90 | 365. */
export async function fetchCryptoChart(id: string, days: number): Promise<number[]> {
  try {
    const r = await fetch(`https://api.coingecko.com/api/v3/coins/${id}/market_chart?vs_currency=usd&days=${days}`);
    const d = await r.json();
    return Array.isArray(d?.prices) ? d.prices.map((p: [number, number]) => p[1]) : [];
  } catch {
    return [];
  }
}

async function fromOracle(): Promise<CryptoPrice[]> {
  const pairs: [OraclePair, string, string, string][] = [['SOL/USD', 'SOL', 'Solana', 'solana'], ['BTC/USD', 'BTC', 'Bitcoin', 'bitcoin'], ['ETH/USD', 'ETH', 'Ethereum', 'ethereum']];
  const out: CryptoPrice[] = [];
  for (const [pair, symbol, name, id] of pairs) {
    try { const o = await getOraclePrice(pair); if (o?.price) out.push({ id, symbol, name, price: o.price, change24h: 0, spark: [], image: '', supply: 0 }); } catch { /* */ }
  }
  return out;
}

export async function fetchCryptoPrices(): Promise<CryptoPrice[]> {
  try {
    const r = await fetch(CG);
    const d = await r.json();
    if (Array.isArray(d) && d.length) {
      return d
        .filter((c: { symbol?: string; image?: string; sparkline_in_7d?: { price?: number[] } }) =>
          c.symbol && !STABLE_SYM.has(c.symbol.toLowerCase()) && c.image && (c.sparkline_in_7d?.price?.length ?? 0) > 0)
        .slice(0, CARD_LIMIT)
        .map((c: { id?: string; symbol?: string; name?: string; current_price?: number; price_change_percentage_24h?: number; sparkline_in_7d?: { price?: number[] }; image?: string; circulating_supply?: number }) => ({
          id: c.id || '',
          symbol: (c.symbol || '').toUpperCase(),
          name: c.name || '',
          price: c.current_price ?? 0,
          change24h: c.price_change_percentage_24h ?? 0,
          spark: c.sparkline_in_7d?.price ?? [],
          image: c.image || '',
          supply: c.circulating_supply ?? 0,
        }));
    }
  } catch { /* fall through to the oracle */ }
  return fromOracle();
}
