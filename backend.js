// In-browser backend: the same /api routes the old Node server had, backed by
// store.js (Firebase or localStorage) and Finnhub for live prices.
import CONFIG from './config.js?v=20261026115004';
import { store } from './store.js?v=20261026115004';
export { store };

const FH = CONFIG.finnhubBase || 'https://finnhub.io/api/v1';
const rid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const httpError = (status, message) => Object.assign(new Error(message), { status });

// ---------- market data (Finnhub) ----------
const quoteCache = new Map(); // symbol -> {t, q}
let meta = {}; try { meta = JSON.parse(localStorage.getItem('bp_meta')) || {}; } catch {}
const saveMeta = () => { try { localStorage.setItem('bp_meta', JSON.stringify(meta)); } catch {} };

async function fh(path) {
  if (!CONFIG.finnhubKey) throw new Error('Add a Finnhub key to config.js to load prices.');
  const r = await fetch(`${FH}${path}${path.includes('?') ? '&' : '?'}token=${CONFIG.finnhubKey}`);
  if (r.status === 429) throw httpError(429, 'Price limit reached. Try again in a minute.');
  if (!r.ok) throw new Error('Price service error.');
  return r.json();
}
// Crypto trades around the clock, priced from Binance's USDT pairs.
export const CRYPTO = { BTC: 'Bitcoin', ETH: 'Ethereum', SOL: 'Solana', XRP: 'XRP', BNB: 'BNB', DOGE: 'Dogecoin', ADA: 'Cardano', AVAX: 'Avalanche', LINK: 'Chainlink', DOT: 'Polkadot', LTC: 'Litecoin', SHIB: 'Shiba Inu' };
export const isCrypto = s => /^[A-Z]+-USD$/.test(s || '') && !!CRYPTO[s.slice(0, -4)];
export const tvSymbol = s => isCrypto(s) ? `BINANCE:${s.slice(0, -4)}USDT` : s;
const openFor = s => isCrypto(s) || marketOpen();

async function getMeta(sym) {
  if (meta[sym]?.v === 2) return meta[sym];
  if (isCrypto(sym)) return meta[sym] = { v: 2, name: CRYPTO[sym.slice(0, -4)], exchange: 'Crypto', type: 'CRYPTO', industry: 'Crypto' };
  const p = await fh('/stock/profile2?symbol=' + encodeURIComponent(sym));
  // Finnhub only has company profiles for stocks; no profile means a fund.
  meta[sym] = p.name
    ? { v: 2, name: p.name, exchange: p.exchange, type: 'EQUITY', industry: p.finnhubIndustry || 'Other', marketCap: p.marketCapitalization || 0, logo: p.logo || '' }
    : { v: 2, name: meta[sym]?.name || sym, exchange: '', type: 'ETF', industry: 'Funds' };
  saveMeta(); return meta[sym];
}
async function getQuote(symbol) {
  symbol = symbol.toUpperCase();
  const c = quoteCache.get(symbol);
  if (c && Date.now() - c.t < 20000) return c.q;
  let q, m;
  try { [q, m] = await Promise.all([fh('/quote?symbol=' + encodeURIComponent(tvSymbol(symbol))), getMeta(symbol).catch(() => ({ name: symbol, type: 'EQUITY' }))]); }
  catch (e) { if (c) return c.q; throw e; }
  if (!q.c && !q.pc) throw new Error(`Unknown symbol ${symbol}`);
  const out = {
    symbol, name: m.name, price: q.c, prevClose: q.pc, change: q.d ?? 0, changePct: q.dp ?? 0,
    high: q.h, low: q.l, open: q.o, exchange: m.exchange, type: m.type, currency: 'USD', time: q.t * 1000,
    industry: m.industry || '', marketCap: m.marketCap || 0, logo: m.logo || '',
  };
  quoteCache.set(symbol, { t: Date.now(), q: out });
  return out;
}
async function getQuotes(symbols) {
  const out = {}, list = [...new Set(symbols)];
  // Small concurrency cap keeps us under Finnhub's 60 calls/minute.
  for (let i = 0; i < list.length; i += 6) await Promise.all(list.slice(i, i + 6).map(async s => { try { out[s] = await getQuote(s); } catch {} }));
  return out;
}
async function search(q) {
  const ql = q.trim().toLowerCase();
  const coins = Object.entries(CRYPTO).filter(([k, n]) => k.toLowerCase().startsWith(ql) || n.toLowerCase().startsWith(ql) || (ql.length > 2 && 'crypto'.startsWith(ql)))
    .map(([k, n]) => ({ symbol: `${k}-USD`, name: n, exchange: 'Crypto', type: 'Crypto' }));
  const j = await fh('/search?exchange=US&q=' + encodeURIComponent(q));
  return coins.slice(0, 4).concat(j.result || []).filter(x => !x.symbol.includes('.') && ['Common Stock', 'ETP', 'ADR', 'REIT'].includes(x.type)).slice(0, 8).map(x => {
    const type = x.type === 'ETP' ? 'ETF' : 'EQUITY';
    if (!meta[x.symbol]) { meta[x.symbol] = { name: x.description, exchange: '', type }; saveMeta(); }
    return x.exchange ? x : { symbol: x.symbol, name: x.description, exchange: '', type: type === 'ETF' ? 'ETF' : 'Stock' };
  }).slice(0, 8);
}
// News: a stock's last week of headlines, or general market news.
async function news(symbol) {
  const to = nyDate(), from = nyDate(new Date(Date.now() - 7 * 864e5));
  const list = symbol && !isCrypto(symbol) ? await fh(`/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}`) : await fh(`/news?category=${isCrypto(symbol) ? 'crypto' : 'general'}`);
  return (Array.isArray(list) ? list : []).filter(n => n.headline && n.url).slice(0, 24).map(n => ({ id: n.id, headline: n.headline, summary: n.summary, source: n.source, url: n.url, image: n.image, time: n.datetime * 1000 }));
}
async function nextEarnings(symbol) {
  if (isCrypto(symbol)) return null;
  const j = await fh(`/calendar/earnings?symbol=${encodeURIComponent(symbol)}&from=${nyDate()}&to=${nyDate(new Date(Date.now() + 120 * 864e5))}`);
  return (j.earningsCalendar || []).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
}
// Screener universe: liquid US large caps and popular ETFs across every sector.
export const UNIVERSE = ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'ORCL', 'AMD', 'CRM', 'ADBE', 'INTC', 'NFLX', 'JPM', 'BAC', 'GS', 'V', 'MA', 'PYPL', 'BRK.B', 'UNH', 'JNJ', 'LLY', 'PFE', 'MRK', 'ABBV', 'WMT', 'COST', 'HD', 'MCD', 'NKE', 'SBUX', 'KO', 'PEP', 'PG', 'DIS', 'XOM', 'CVX', 'BA', 'CAT', 'GE', 'UPS', 'T', 'VZ', 'SPY', 'QQQ', 'IWM', 'DIA', 'GLD', 'TLT', 'XLF', 'XLE', 'ARKK'];

// ---------- options (Black-Scholes on the live price + real 3-month volatility) ----------
// Finnhub's free plan has no option chains, so contracts are priced the way the model
// says they should trade: live underlying price, the stock's realised volatility, its dividend yield.
const RATE = 0.04;
let vols = {}; try { vols = JSON.parse(localStorage.getItem('bp_vol')) || {}; } catch {}
async function getVol(sym) {
  const c = vols[sym];
  if (c && c.day === nyDate()) return c;
  try {
    const m = (await fh('/stock/metric?metric=all&symbol=' + encodeURIComponent(sym))).metric || {};
    vols[sym] = { vol: Math.min(2, Math.max(0.08, (m['3MonthADReturnStd'] || 30) / 100)), div: (m.dividendYieldIndicatedAnnual || 0) / 100, day: nyDate() };
    try { localStorage.setItem('bp_vol', JSON.stringify(vols)); } catch {}
    return vols[sym];
  } catch { return c || { vol: 0.3, div: 0 }; }
}
const ncdf = x => {
  const t = 1 / (1 + 0.2316419 * Math.abs(x)), d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return x > 0 ? 1 - p : p;
};
function blackScholes(type, S, K, T, v, q) {
  if (T <= 0) return { price: Math.max(0, type === 'C' ? S - K : K - S), delta: type === 'C' ? +(S > K) : -(S < K) };
  const d1 = (Math.log(S / K) + (RATE - q + v * v / 2) * T) / (v * Math.sqrt(T)), d2 = d1 - v * Math.sqrt(T);
  return type === 'C'
    ? { price: S * Math.exp(-q * T) * ncdf(d1) - K * Math.exp(-RATE * T) * ncdf(d2), delta: Math.exp(-q * T) * ncdf(d1) }
    : { price: K * Math.exp(-RATE * T) * ncdf(-d2) - S * Math.exp(-q * T) * ncdf(-d1), delta: -Math.exp(-q * T) * ncdf(-d1) };
}
// Contract keys look like AAPL_2026-11-20_C_350.
export function parseKey(key) {
  const [symbol, exp, type, strike] = String(key).split('_');
  if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(exp) || !['C', 'P'].includes(type) || !(+strike > 0)) throw httpError(400, 'Unknown option contract.');
  return { symbol: symbol.toUpperCase(), exp, type, strike: +strike };
}
const optionKey = o => `${o.symbol}_${o.exp}_${o.type}_${o.strike}`;
export const optionLabel = o => `${o.symbol} ${new Date(o.exp + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit', timeZone: 'UTC' })} $${o.strike} ${o.type === 'C' ? 'Call' : 'Put'}`;
const expiryTime = exp => Date.parse(exp + 'T20:00:00Z'); // 4pm New York (EDT)
function expirations() {
  const today = nyDate(), base = new Date(today + 'T12:00:00Z'), out = new Set();
  for (let i = 1; i < 60 && out.size < 6; i++) { const d = new Date(base.getTime() + i * 864e5); if (d.getUTCDay() === 5) out.add(d.toISOString().slice(0, 10)); }
  for (let m = 0; m < 12; m++) {
    const first = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + m, 1, 12));
    const third = new Date(first.getTime() + (((5 - first.getUTCDay() + 7) % 7) + 14) * 864e5).toISOString().slice(0, 10);
    if (third > today) out.add(third);
  }
  return [...out].sort();
}
function strikeList(S) {
  const step = S < 5 ? 0.5 : S < 25 ? 1 : S < 100 ? 2.5 : S < 250 ? 5 : S < 1000 ? 10 : 25;
  const mid = Math.round(S / step) * step;
  return Array.from({ length: 25 }, (_, i) => +(mid + (i - 12) * step).toFixed(2)).filter(k => k > 0);
}
const r2 = n => Math.round(n * 100) / 100;
function priceOption(o, S, vol, div) {
  const T = Math.max(0, (expiryTime(o.exp) - Date.now()) / (365 * 864e5));
  const m = Math.log(o.strike / S), iv = vol * (1 + 1.5 * m * m); // gentle volatility smile
  const { price, delta } = blackScholes(o.type, S, o.strike, T, iv, div);
  const mid = Math.max(0.01, r2(price)), spread = Math.max(0.02, mid * 0.04);
  return {
    ...o, key: optionKey(o), desc: optionLabel(o), underlying: S, iv, delta, mid, expired: T <= 0,
    bid: T <= 0 ? mid : Math.max(0, r2(mid - spread / 2)), ask: T <= 0 ? mid : r2(mid + spread / 2),
    itm: o.type === 'C' ? S > o.strike : S < o.strike,
  };
}
// Live marks for everything a set of players holds or has orders on.
async function marks(players) {
  const syms = new Set(), keys = new Set();
  for (const p of players) {
    Object.keys(p.positions || {}).forEach(s => syms.add(s));
    Object.keys(p.options || {}).forEach(k => { keys.add(k); syms.add(parseKey(k).symbol); });
  }
  const quotes = await getQuotes([...syms]), optq = {};
  for (const k of keys) {
    const o = parseKey(k), u = quotes[o.symbol]; if (!u) continue;
    const { vol, div } = await getVol(o.symbol);
    optq[k] = priceOption(o, u.price, vol, div);
  }
  return { quotes, optq };
}

// US market hours (ignores exchange holidays)
export function marketOpen(d = new Date()) {
  const ny = new Date(d.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = ny.getDay(), mins = ny.getHours() * 60 + ny.getMinutes();
  return day > 0 && day < 6 && mins >= 570 && mins < 960;
}
const nyDate = (d = new Date()) => d.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

// ---------- games ----------
const DEFAULT_SETTINGS = {
  name: 'My Game', description: '', privacy: 'public',
  startDate: nyDate(), endDate: '', startingCash: 100000,
  commissionType: 'flat', commission: 0,
  allowLateEntry: true, allowReset: true, showPortfolios: true,
  allowShort: true, allowMargin: false, marginInterest: 8, cashInterest: 0,
  allowLimit: true, allowStop: true, allowTrailing: true,
  minStockPrice: 0, minShortPrice: 5, maxPositionPct: 100, dailyTradeLimit: 0,
  allowEtf: true, allowMutualFunds: false,
  allowOptions: true, allowOptionWriting: false, optionCommission: 0,
  allowCrypto: true, payDividends: true, maxPlayers: 0,
  executionDelay: 0, delayApplies: 'sells', settleT1: false,
};
function cleanSettings(input, base = DEFAULT_SETTINGS) {
  const s = { ...DEFAULT_SETTINGS, ...base };
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (!(k in input)) continue;
    const t = typeof DEFAULT_SETTINGS[k];
    s[k] = t === 'number' ? Math.max(0, Number(input[k]) || 0) : t === 'boolean' ? !!input[k] : String(input[k]).slice(0, 500);
  }
  if (!['public', 'private'].includes(s.privacy)) s.privacy = 'public';
  if (!['flat', 'percent'].includes(s.commissionType)) s.commissionType = 'flat';
  if (!['sells', 'all'].includes(s.delayApplies)) s.delayApplies = 'sells';
  s.executionDelay = Math.min(60, s.executionDelay);
  s.startingCash = Math.min(Math.max(s.startingCash, 1000), 100000000);
  return s;
}
const newPlayer = (g, user) => ({ userId: user.id, name: user.name, picture: user.picture || '', color: user.color || '', cash: g.settings.startingCash, positions: {}, options: {}, orders: [], history: [], snapshots: {}, joined: Date.now(), tradesByDay: {} });
function gameActive(g) {
  const today = nyDate();
  return today >= g.settings.startDate && (!g.settings.endDate || today <= g.settings.endDate);
}
async function ensureDefaultGame(user) {
  // Every user has a personal practice game.
  const gid = 'practice_' + user.id;
  if (await store.getGame(gid)) return;
  const g = { id: gid, owner: user.id, sandboxOf: user.id, created: Date.now(), members: [user.id], hasPassword: false, settings: cleanSettings({ name: 'Practice Portfolio', privacy: 'private', allowMargin: true, startDate: '2000-01-01' }) };
  await store.createGame(g, '', newPlayer(g, user));
}

// ---------- portfolio math & order engine ----------
function valuation(p, quotes, optq = {}) {
  let longValue = 0, shortValue = 0;
  const holdings = Object.entries(p.positions).map(([sym, pos]) => {
    const q = quotes[sym]; const price = q?.price ?? pos.avg;
    const value = pos.qty * price;
    if (pos.qty > 0) longValue += value; else shortValue += -value;
    const gain = pos.qty > 0 ? (price - pos.avg) * pos.qty : (pos.avg - price) * -pos.qty;
    return { symbol: sym, name: q?.name || sym, qty: pos.qty, avg: pos.avg, price, value, gain, gainPct: (gain / Math.abs(pos.avg * pos.qty)) * 100, dayChange: (q?.change || 0) * pos.qty, dayChangePct: q?.changePct || 0, type: q?.type || (isCrypto(sym) ? 'CRYPTO' : 'EQUITY'), industry: q?.industry || '', logo: q?.logo || '' };
  });
  let optCollateral = 0;
  const options = Object.entries(p.options || {}).map(([key, pos]) => {
    const o = parseKey(key), mark = optq[key]?.mid ?? pos.avg, value = pos.qty * 100 * mark;
    if (pos.qty > 0) longValue += value;
    else {
      shortValue += -value;
      // Written contracts tie up margin: 20% of the underlying, unless calls are covered by shares.
      const covered = o.type === 'C' ? Math.floor(Math.max(0, p.positions[o.symbol]?.qty || 0) / 100) : 0;
      optCollateral += Math.max(0, -pos.qty - covered) * 100 * (quotes[o.symbol]?.price ?? o.strike) * 0.2;
    }
    const gain = (mark - pos.avg) * pos.qty * 100;
    return { key, symbol: o.symbol, name: optionLabel(o), type: o.type, strike: o.strike, exp: o.exp, qty: pos.qty, avg: pos.avg, price: mark, value, gain, gainPct: pos.avg ? (gain / Math.abs(pos.avg * pos.qty * 100)) * 100 : 0, delta: optq[key]?.delta, underlying: quotes[o.symbol]?.price };
  });
  return { holdings, options, longValue, shortValue, optCollateral, equity: p.cash + longValue - shortValue };
}
// Next-day settlement: money from a sale can't be reused until the next trading day.
function nextTradingDay() {
  const d = new Date(nyDate() + 'T12:00:00Z');
  do d.setUTCDate(d.getUTCDate() + 1); while (d.getUTCDay() === 0 || d.getUTCDay() === 6);
  return d.toISOString().slice(0, 10);
}
const unsettledCash = p => (p.unsettled || []).filter(u => u.date > nyDate()).reduce((a, u) => a + u.amount, 0);
function settle(p, g, amount) { if (g.settings.settleT1 && amount > 0) (p.unsettled ||= []).push({ amount, date: nextTradingDay() }); }
// Execution delay: orders wait a few minutes, then fill at whatever the price is by then.
const SELL_SIDE = ['sell', 'stc', 'short', 'sto'];
const delayFor = (g, o) => g.settings.executionDelay && (g.settings.delayApplies === 'all' || SELL_SIDE.includes(o.action)) ? g.settings.executionDelay * 60000 : 0;
function buyingPower(p, g, v) {
  // Short proceeds sit in cash but are held as collateral; margin lends up to equity again.
  return Math.max(0, p.cash - v.shortValue - (v.optCollateral || 0) - unsettledCash(p) + (g.settings.allowMargin ? v.equity : 0));
}
const commissionFor = (g, amount) => g.settings.commissionType === 'flat' ? g.settings.commission : amount * g.settings.commission / 100;

function validateOrder(p, g, o, q, v) {
  const s = g.settings;
  if (!gameActive(g)) return 'This game is not active.';
  const coin = isCrypto(o.symbol);
  if (!(o.qty > 0) || (!coin && !Number.isInteger(o.qty))) return 'Quantity must be a whole number above zero.';
  if (q.type === 'ETF' && !s.allowEtf) return 'ETFs are not allowed in this game.';
  if (coin) {
    if (!s.allowCrypto) return 'Crypto is not allowed in this game.';
    if (o.action === 'short' || o.action === 'cover') return 'Crypto can’t be shorted.';
  }
  if (o.action === 'buy' && q.price < s.minStockPrice) return `Stocks under $${s.minStockPrice} cannot be bought in this game.`;
  if (o.action === 'short') {
    if (!s.allowShort) return 'Short selling is disabled for this game.';
    if (q.price < s.minShortPrice) return `Stocks under $${s.minShortPrice} cannot be shorted in this game.`;
  }
  if (o.type === 'limit' && !s.allowLimit) return 'Limit orders are disabled.';
  if (o.type === 'stop' && !s.allowStop) return 'Stop orders are disabled.';
  if (o.type === 'trailing' && !s.allowTrailing) return 'Trailing stop orders are disabled.';
  const pos = p.positions[o.symbol];
  if (o.action === 'sell' && (!pos || pos.qty < o.qty - 1e-9)) return `You only hold ${pos?.qty > 0 ? +pos.qty.toFixed(6) : 0} ${coin ? 'coins' : 'shares'}.`;
  if (o.action === 'cover' && (!pos || -pos.qty < o.qty)) return `You are only short ${pos?.qty < 0 ? -pos.qty : 0} shares.`;
  if (o.action === 'buy' && pos?.qty < 0) return 'Cover your short position before buying.';
  if (o.action === 'short' && pos?.qty > 0) return 'Sell your long position before shorting.';
  if (s.dailyTradeLimit && (p.tradesByDay[nyDate()] || 0) >= s.dailyTradeLimit) return `Daily limit of ${s.dailyTradeLimit} trades reached.`;
  if (o.action === 'buy' || o.action === 'short') {
    const cost = o.qty * (o.limitPrice || q.price);
    if (cost + commissionFor(g, cost) > buyingPower(p, g, v)) return 'Not enough buying power for this order.';
    const after = (Math.abs(pos?.qty || 0) + o.qty) * q.price;
    if (s.maxPositionPct < 100 && after > v.equity * s.maxPositionPct / 100) return `A single position cannot exceed ${s.maxPositionPct}% of your portfolio.`;
  }
  return null;
}

function fill(p, g, o, price) {
  const amount = o.qty * price, fee = commissionFor(g, amount);
  const pos = p.positions[o.symbol] || { qty: 0, avg: 0 };
  if (o.action === 'sell') o.realized = (price - pos.avg) * o.qty - fee;
  if (o.action === 'cover') o.realized = (pos.avg - price) * o.qty - fee;
  if (o.action === 'buy') { pos.avg = (pos.avg * pos.qty + amount) / (pos.qty + o.qty); pos.qty += o.qty; p.cash -= amount + fee; }
  if (o.action === 'sell') { pos.qty -= o.qty; p.cash += amount - fee; settle(p, g, amount - fee); }
  if (o.action === 'short') { pos.avg = (pos.avg * -pos.qty + amount) / (-pos.qty + o.qty); pos.qty -= o.qty; p.cash += amount - fee; }
  if (o.action === 'cover') { pos.qty += o.qty; p.cash -= amount + fee; }
  if (Math.abs(pos.qty) < 1e-9) delete p.positions[o.symbol]; else p.positions[o.symbol] = pos;
  finishFill(p, o, price, fee, g);
}
function finishFill(p, o, price, fee, g) {
  Object.assign(o, { status: 'filled', filledAt: Date.now(), fillPrice: price, fee });
  p.tradesByDay[nyDate()] = (p.tradesByDay[nyDate()] || 0) + 1;
  p.history.unshift({ ...o });
  p.orders = p.orders.filter(x => x.id !== o.id);
  p.maxPositions = Math.max(p.maxPositions || 0, Object.keys(p.positions).length + Object.keys(p.options || {}).length);
  if (g) queueTradeEvent(g, p, o);
}

// ---------- game activity feed ----------
const pendingEvents = [];
const VERB = { buy: 'bought', sell: 'sold', short: 'shorted', cover: 'covered', bto: 'bought', stc: 'sold', sto: 'wrote', btc: 'bought back' };
const actor = p => ({ userId: p.userId, name: p.name, picture: p.picture || '', color: p.color || '' });
function queueTradeEvent(g, p, o) {
  if (g.sandboxOf) return;
  if (o.strategyId && pendingEvents.some(e => e.item.strategyId === o.strategyId)) return;
  const what = o.asset === 'option' ? `${o.qty} × ${o.desc}` : `${+(+o.qty).toFixed(6)} ${o.symbol}`;
  const text = !g.settings.showPortfolios ? 'made a trade'
    : o.strategyId ? `opened a ${o.strategy || 'strategy'} on ${o.symbol}`
    : `${VERB[o.action] || o.action} ${what} at ${o.fillPrice.toLocaleString('en-US', { style: 'currency', currency: 'USD' })}`;
  pendingEvents.push({ gid: g.id, item: { id: rid(), type: 'trade', ...actor(p), text, strategyId: o.strategyId || null, created: Date.now() } });
}
async function flushEvents() {
  const list = pendingEvents.splice(0);
  await Promise.all(list.map(e => store.addActivity(e.gid, e.item).catch(() => {})));
}
async function savePlayer(g, p) { await store.savePlayer(g.id, p.userId, p); await flushEvents(); }

// ---------- option orders ----------
const optionFee = (g, qty, amount) => commissionFor(g, amount) + qty * (g.settings.optionCommission || 0);
const optBuySide = o => o.action === 'bto' || o.action === 'btc';
function validateOptionOrder(p, g, o, oq, v) {
  const s = g.settings;
  if (!gameActive(g)) return 'This game is not active.';
  if (!s.allowOptions) return 'Options trading is disabled for this game.';
  if (oq.expired) return 'This contract has expired.';
  if (!(o.qty > 0) || !Number.isInteger(o.qty)) return 'Contracts must be a whole number above zero.';
  if (o.type === 'limit' && !s.allowLimit) return 'Limit orders are disabled.';
  const pos = (p.options || {})[o.key];
  if (o.action === 'stc' && (!pos || pos.qty < o.qty)) return `You only hold ${pos?.qty > 0 ? pos.qty : 0} contracts.`;
  if (o.action === 'btc' && (!pos || -pos.qty < o.qty)) return `You have only written ${pos?.qty < 0 ? -pos.qty : 0} contracts.`;
  if (o.action === 'bto' && pos?.qty < 0) return 'Buy to close your written contracts first.';
  if (o.action === 'sto') {
    if (!s.allowOptionWriting) return 'Writing options (sell to open) is disabled for this game.';
    if (pos?.qty > 0) return 'Sell to close your contracts first.';
  }
  if (s.dailyTradeLimit && (p.tradesByDay[nyDate()] || 0) >= s.dailyTradeLimit) return `Daily limit of ${s.dailyTradeLimit} trades reached.`;
  const bp = buyingPower(p, g, v);
  if (optBuySide(o)) {
    const cost = o.qty * 100 * (o.limitPrice || oq.ask);
    if (cost + optionFee(g, o.qty, cost) > bp) return 'Not enough buying power for this order.';
  }
  if (o.action === 'sto' && o.qty * 100 * oq.underlying * 0.2 > bp) return 'Not enough buying power to cover margin on these contracts.';
  return null;
}
const shouldFillOption = (o, oq) => o.type === 'market' || (optBuySide(o) ? oq.ask <= o.limitPrice : oq.bid >= o.limitPrice);
const optionFillPrice = (o, oq) => optBuySide(o) ? (o.type === 'limit' ? Math.min(oq.ask, o.limitPrice) : oq.ask) : (o.type === 'limit' ? Math.max(oq.bid, o.limitPrice) : oq.bid);
function fillOption(p, g, o, price) {
  p.options ||= {};
  const amount = o.qty * 100 * price, fee = optionFee(g, o.qty, amount);
  const pos = p.options[o.key] || { qty: 0, avg: 0 };
  if (o.action === 'bto') { pos.avg = (pos.avg * pos.qty + price * o.qty) / (pos.qty + o.qty); pos.qty += o.qty; p.cash -= amount + fee; }
  if (o.action === 'stc') { o.realized = (price - pos.avg) * o.qty * 100 - fee; pos.qty -= o.qty; p.cash += amount - fee; settle(p, g, amount - fee); }
  if (o.action === 'sto') { pos.avg = (pos.avg * -pos.qty + price * o.qty) / (-pos.qty + o.qty); pos.qty -= o.qty; p.cash += amount - fee; }
  if (o.action === 'btc') { o.realized = (pos.avg - price) * o.qty * 100 - fee; pos.qty += o.qty; p.cash -= amount + fee; }
  if (pos.qty === 0) delete p.options[o.key]; else p.options[o.key] = pos;
  finishFill(p, o, price, fee, g);
}
// Expired contracts settle in cash at intrinsic value.
function settleExpired(p, quotes) {
  for (const [key, pos] of Object.entries(p.options || {})) {
    const o = parseKey(key), S = quotes[o.symbol]?.price;
    if (Date.now() < expiryTime(o.exp) || S == null) continue;
    const intrinsic = r2(Math.max(0, o.type === 'C' ? S - o.strike : o.strike - S));
    p.cash += pos.qty * 100 * intrinsic;
    const status = intrinsic > 0 ? 'exercised' : 'expired';
    p.history.unshift({ id: rid(), asset: 'option', key, desc: optionLabel(o), symbol: o.symbol, action: pos.qty > 0 ? 'stc' : 'btc', qty: Math.abs(pos.qty), type: 'market', status, created: Date.now(), filledAt: Date.now(), fillPrice: intrinsic, fee: 0, realized: (intrinsic - pos.avg) * pos.qty * 100 });
    delete p.options[key];
  }
}
const fillPrice = (o, price) => o.type === 'limit' ? (o.action === 'buy' || o.action === 'cover' ? Math.min(price, o.limitPrice) : Math.max(price, o.limitPrice)) : price;

// Decide whether an open order triggers at the current price.
function shouldFill(o, price) {
  const buySide = o.action === 'buy' || o.action === 'cover';
  if (o.type === 'market') return true;
  if (o.type === 'limit') return buySide ? price <= o.limitPrice : price >= o.limitPrice;
  if (o.type === 'stop') return buySide ? price >= o.stopPrice : price <= o.stopPrice;
  if (o.type === 'trailing') {
    // Track the best price seen; trigger when price retraces by trail % (or $).
    o.peak = o.peak == null ? price : buySide ? Math.min(o.peak, price) : Math.max(o.peak, price);
    const off = o.trailUnit === '$' ? o.trail : o.peak * o.trail / 100;
    return buySide ? price >= o.peak + off : price <= o.peak - off;
  }
  return false;
}
function closeOrder(p, o, status, reason) {
  o.status = status; if (reason) o.reason = reason;
  p.history.unshift({ ...o }); p.orders = p.orders.filter(x => x.id !== o.id);
}

// Orders are checked whenever their owner has Bullpen open (there is no server).
async function processOrders(p, g) {
  const expiring = Object.keys(p.options || {}).some(k => Date.now() >= expiryTime(parseKey(k).exp));
  if (!p.orders.length && !expiring) return false;
  const open = marketOpen(), today = nyDate();
  const pending = { positions: Object.fromEntries(p.orders.map(o => [o.symbol, {}])), options: Object.fromEntries(p.orders.filter(o => o.asset === 'option').map(o => [o.key, {}])) };
  const mk = await marks([p, pending]);
  settleExpired(p, mk.quotes);
  for (const o of [...p.orders]) {
    if (o.duration === 'day' && o.day !== today && o.type !== 'market') { closeOrder(p, o, 'expired'); continue; }
    if (o.duration === 'gtc' && Date.now() - o.created > 90 * 864e5) { closeOrder(p, o, 'expired'); continue; }
    if (o.notBefore && Date.now() < o.notBefore) continue;
    if (o.asset === 'option') {
      const oq = mk.optq[o.key]; if (!oq) continue;
      if (oq.expired) { closeOrder(p, o, 'expired'); continue; }
      if (!open || !shouldFillOption(o, oq)) continue;
      const err = validateOptionOrder(p, g, { ...o }, oq, valuation(p, mk.quotes, mk.optq));
      if (err) closeOrder(p, o, 'cancelled', err); else fillOption(p, g, o, optionFillPrice(o, oq));
      continue;
    }
    const q = mk.quotes[o.symbol]; if (!q || !(open || isCrypto(o.symbol))) continue;
    if (shouldFill(o, q.price)) {
      const err = validateOrder(p, g, { ...o }, q, valuation(p, mk.quotes, mk.optq));
      if (err) closeOrder(p, o, 'cancelled', err); else fill(p, g, o, fillPrice(o, q.price));
    }
  }
  return true;
}

// Daily: margin interest on negative cash, interest on positive cash.
function accrueInterest(p, g) {
  const today = nyDate();
  if (p.lastAccrual === today) return;
  const days = p.lastAccrual ? Math.min(30, Math.round((new Date(today) - new Date(p.lastAccrual)) / 864e5)) : 0;
  if (days > 0) {
    if (p.cash < 0) p.cash *= Math.pow(1 + g.settings.marginInterest / 100 / 365, days);
    else if (g.settings.cashInterest) p.cash *= Math.pow(1 + g.settings.cashInterest / 100 / 365, days);
  }
  p.lastAccrual = today;
}

// Daily dividends from each stock's real indicated annual yield (shorts pay them).
async function accrueDividends(p, g, quotes) {
  const today = nyDate();
  if (!g.settings.payDividends) return;
  if (!p.lastDiv) { p.lastDiv = today; return; }
  const days = Math.min(30, Math.round((new Date(today) - new Date(p.lastDiv)) / 864e5));
  if (days <= 0) return;
  let total = 0;
  for (const [sym, pos] of Object.entries(p.positions)) {
    if (isCrypto(sym) || !quotes[sym]) continue;
    const { div } = await getVol(sym);
    total += pos.qty * quotes[sym].price * div / 365 * days;
  }
  p.lastDiv = today;
  if (Math.abs(total) < 0.01) return;
  p.cash += total; p.divPaid = (p.divPaid || 0) + total;
  p.history.unshift({ id: rid(), asset: 'dividend', symbol: 'Dividends', action: total > 0 ? 'received' : 'paid', qty: days, type: 'dividend', status: 'dividend', created: Date.now(), filledAt: Date.now(), fillPrice: total, fee: 0 });
}

async function portfolioView(p, g, own) {
  if (own) { accrueInterest(p, g); await processOrders(p, g); p.unsettled = (p.unsettled || []).filter(u => u.date > nyDate()); }
  const mk = await marks([p, own ? { positions: { SPY: {} } } : {}]);
  if (own) await accrueDividends(p, g, mk.quotes);
  const v = valuation(p, mk.quotes, mk.optq);
  if (own) {
    p.snapshots[nyDate()] = Math.round(v.equity * 100) / 100;
    if (mk.quotes.SPY) (p.bench ||= {})[nyDate()] = mk.quotes.SPY.price;
    await savePlayer(g, p);
  }
  const start = g.settings.startingCash;
  return {
    playerId: p.userId, gameId: g.id, cash: p.cash, ...v, buyingPower: buyingPower(p, g, v),
    totalGain: v.equity - start, totalGainPct: ((v.equity - start) / start) * 100,
    dayChange: v.holdings.reduce((a, h) => a + h.dayChange, 0),
    orders: own ? p.orders : [], history: p.history.slice(0, 300), snapshots: p.snapshots, bench: p.bench || {}, divPaid: p.divPaid || 0, unsettled: unsettledCash(p), marketOpen: marketOpen(),
  };
}

async function rankings(g) {
  const players = await store.listPlayers(g.id);
  const mk = await marks(players);
  return players.map(p => {
    const v = valuation(p, mk.quotes, mk.optq);
    return { playerId: p.userId, userId: p.userId, name: p.name || 'Player', picture: p.picture, color: p.color, equity: v.equity, gain: v.equity - g.settings.startingCash, gainPct: ((v.equity - g.settings.startingCash) / g.settings.startingCash) * 100 };
  }).sort((a, b) => b.equity - a.equity).map((r, i) => ({ ...r, rank: i + 1 }));
}

async function gamePublic(g, user) {
  const isOwner = g.owner === user.id;
  return {
    id: g.id, owner: g.owner, isOwner, sandbox: !!g.sandboxOf, created: g.created,
    settings: isOwner || user.admin ? { ...g.settings, password: g.hasPassword ? await store.getSecret(g.id) : '' } : g.settings,
    hasPassword: !!g.hasPassword, players: g.members.length, joined: g.members.includes(user.id), active: gameActive(g),
  };
}

// ---------- users ----------
const DEFAULT_PREFS = { theme: 'system', accent: 'blue', density: 'comfortable', defaultRange: '1D', showDayChange: true, confirmTrades: true, defaultGame: null, compactNumbers: false };
let me = null;
async function loadMe() {
  await store.ready;
  const u = store.currentUser();
  if (!u) { me = null; return null; }
  if (me?.id === u.id) return me;
  const saved = await store.getUser(u.id);
  // A profile the user has saved beats whatever their sign-in provider says.
  me = { watchlist: ['AAPL', 'MSFT', 'NVDA', 'SPY'], bio: '', color: '', joined: u.created || Date.now(), ...u, ...saved, id: u.id, email: u.email, provider: u.provider, emailVerified: u.emailVerified, prefs: { ...DEFAULT_PREFS, ...saved?.prefs } };
  await store.saveUser(u.id, { name: me.name, email: me.email || '', picture: me.picture || '', bio: me.bio, color: me.color, joined: me.joined, prefs: me.prefs, watchlist: me.watchlist, lastLogin: Date.now() });
  if (!saved) await store.saveProfile(u.id, publicProfile(me)).catch(() => {});
  await ensureDefaultGame(me);
  // Admin mode: unlocked in Settings on this device, and only real if Firebase lists the account in admins/.
  let unlocked; try { unlocked = localStorage.getItem('bp_admin') === u.id; } catch {}
  me.admin = !!unlocked && await store.isAdmin(u.id).catch(() => false);
  return me;
}
export async function signIn(name) { await store.signIn(name); me = null; return loadMe(); }
export async function signInEmail(email, password) { await store.signInEmail(email, password); me = null; return loadMe(); }
export async function signUpEmail(name, email, password) { await store.signUpEmail(name, email, password); me = null; return loadMe(); }
export const resetPassword = email => store.resetPassword(email);
export async function signOut() { await store.signOut(); me = null; }
const publicProfile = u => ({ name: u.name, picture: u.picture || '', bio: u.bio || '', color: u.color || '', joined: u.joined || Date.now(), handle: u.handle || '', badges: u.badges || {} });

// Account security actions go straight to the auth provider.
export const account = {
  changePassword: (current, next) => store.changePassword(current, next),
  changeEmail: (current, email) => store.changeEmail(current, email),
  sendVerification: () => store.sendVerification(),
  async refresh() { const u = await store.reloadUser(); if (me) me.emailVerified = u.emailVerified; return me; },
  // Removes owned games, leaves the rest, deletes the profile, then the sign-in itself.
  async deleteAccount(password) {
    await store.reauth(password);
    const user = await loadMe();
    for (const g of await store.myGames(user.id)) {
      if (g.owner === user.id) await store.deleteGame(g.id);
      else await store.leave(g.id, user.id).catch(() => {});
    }
    if (user.handle) await store.releaseHandle(user.handle);
    for (const inv of await store.listInvites(user.id).catch(() => [])) await store.deleteInvite(inv.id).catch(() => {});
    await store.deleteUserDocs(user.id);
    await store.deleteAuthUser();
    me = null;
  },
};

// ---------- routes ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });
const mustGame = async gid => { const g = await store.getGame(gid); if (!g) throw httpError(404, 'Game not found.'); return g; };

route('GET', '/api/me', ({ user }) => ({ user }));
// Profile edits for yourself, or (admin) anyone. Name, bio and picture save first; the
// @username saves last because it needs its own collection and rule.
async function applyProfile(target, body) {
  const name = String(body.name ?? target.name).trim().slice(0, 40);
  if (!name) throw httpError(400, 'The display name can’t be empty.');
  const picture = body.picture === undefined ? target.picture || '' : String(body.picture || '');
  if (picture && !/^(data:image\/(jpeg|png|webp);base64,|https:\/\/)/.test(picture)) throw httpError(400, 'That picture format isn’t supported.');
  if (picture.length > 150000) throw httpError(400, 'That picture is too large.');
  const handle = body.handle === undefined ? target.handle || '' : String(body.handle).trim().toLowerCase().replace(/^@/, '');
  if (handle && !/^[a-z0-9_]{3,20}$/.test(handle)) throw httpError(400, 'Usernames are 3–20 letters, numbers or underscores.');
  Object.assign(target, { name, picture, bio: String(body.bio ?? target.bio ?? '').slice(0, 160), color: /^#[0-9a-f]{6}$/i.test(body.color) ? body.color : target.color || '' });
  await store.saveUser(target.id, { name: target.name, picture: target.picture, bio: target.bio, color: target.color });
  await store.saveProfile(target.id, publicProfile(target));
  // Rankings read names and pictures from each game's player record.
  await Promise.all((await store.myGames(target.id)).map(async g => {
    const p = await store.getPlayer(g.id, target.id);
    if (p) await store.savePlayer(g.id, target.id, { ...p, name: target.name, picture: target.picture, color: target.color });
  }));
  if (handle !== (target.handle || '')) {
    if (handle) await store.claimHandle(target.id, handle, target.handle);
    else if (target.handle) await store.releaseHandle(target.handle);
    target.handle = handle;
    await store.saveUser(target.id, { handle }); await store.saveProfile(target.id, { handle });
  }
  return target;
}
route('PATCH', '/api/me/profile', async ({ user, body }) => {
  await applyProfile(user, body);
  if (body.name !== undefined) await store.setAuthName(user.name).catch(() => {});
  return { user };
});
route('GET', '/api/profiles/:uid', async ({ user, params }) => {
  const uid = params.uid, self = uid === user.id;
  const games = (await store.myGames(uid)).filter(g => self || !g.sandboxOf);
  const pairs = (await Promise.all(games.map(async g => [g, await store.getPlayer(g.id, uid)]))).filter(([, p]) => p);
  const first = pairs[0]?.[1];
  const profile = self ? publicProfile(user) : await store.getProfile(uid).catch(() => null) || (first && { name: first.name, picture: first.picture, color: first.color });
  if (!profile) throw httpError(404, 'Player not found.');
  const mk = await marks(pairs.map(([, p]) => p));
  const results = pairs.map(([g, p]) => {
    const v = valuation(p, mk.quotes, mk.optq), start = g.settings.startingCash;
    return { gameId: g.id, game: g.settings.name, sandbox: !!g.sandboxOf, equity: v.equity, gainPct: (v.equity - start) / start * 100, trades: p.history.filter(o => o.status === 'filled').length, positions: Object.keys(p.positions).length + Object.keys(p.options || {}).length, canView: self || g.settings.showPortfolios };
  });
  return { id: uid, self, ...profile, results };
});
route('GET', '/api/me/export', async ({ user }) => {
  const games = await store.myGames(user.id);
  return { exported: new Date().toISOString(), user, games: await Promise.all(games.map(async g => ({ game: g.settings, portfolio: await store.getPlayer(g.id, user.id) }))) };
});
route('PATCH', '/api/me/prefs', async ({ user, body }) => { user.prefs = { ...user.prefs, ...body }; await store.saveUser(user.id, { prefs: user.prefs }); return { user }; });

route('GET', '/api/quote', ({ url }) => getQuotes((url.searchParams.get('symbols') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 40)));
route('GET', '/api/search', ({ url }) => search(url.searchParams.get('q') || ''));
route('GET', '/api/market', async () => ({ open: marketOpen(), indices: await getQuotes(['SPY', 'DIA', 'QQQ', 'IWM', 'BTC-USD']), movers: await getQuotes(['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'JPM']) }));

route('GET', '/api/options/:sym', async ({ url, params }) => {
  const sym = params.sym.toUpperCase(), u = await getQuote(sym), { vol, div } = await getVol(sym);
  const exps = expirations(), want = url.searchParams.get('exp');
  const exp = exps.includes(want) ? want : exps[0];
  const strikes = strikeList(u.price);
  const chain = type => strikes.map(strike => priceOption({ symbol: sym, exp, type, strike }, u.price, vol, div));
  return { quote: u, vol, expirations: exps, exp, calls: chain('C'), puts: chain('P') };
});
route('GET', '/api/option', async ({ url }) => {
  const o = parseKey(url.searchParams.get('key')), u = await getQuote(o.symbol), { vol, div } = await getVol(o.symbol);
  return priceOption(o, u.price, vol, div);
});
route('GET', '/api/watchlist', async ({ user }) => ({ symbols: user.watchlist, quotes: await getQuotes(user.watchlist) }));
route('PUT', '/api/watchlist', async ({ user, body }) => { user.watchlist = [...new Set((body.symbols || []).map(s => String(s).toUpperCase()))].slice(0, 50); await store.saveUser(user.id, { watchlist: user.watchlist }); return { symbols: user.watchlist }; });

route('GET', '/api/games', async ({ user }) => {
  const [mine, pub] = await Promise.all([store.myGames(user.id), store.publicGames()]);
  mine.sort((a, b) => !!b.sandboxOf - !!a.sandboxOf || a.created - b.created);
  return {
    mine: await Promise.all(mine.map(g => gamePublic(g, user))),
    public: await Promise.all(pub.filter(g => !g.members.includes(user.id)).map(g => gamePublic(g, user))),
  };
});
route('POST', '/api/games', async ({ user, body }) => {
  const g = { id: rid(), owner: user.id, created: Date.now(), members: [user.id], hasPassword: !!body.password, settings: cleanSettings(body) };
  await store.createGame(g, body.password || '', newPlayer(g, user));
  await store.addActivity(g.id, { id: rid(), type: 'join', ...actor({ ...user, userId: user.id }), text: 'created the game', created: Date.now() }).catch(() => {});
  return gamePublic(g, user);
});
route('GET', '/api/games/:gid', async ({ user, params }) => {
  const g = await mustGame(params.gid);
  if (g.sandboxOf && g.sandboxOf !== user.id) throw httpError(404, 'Game not found.');
  const ranks = await rankings(g);
  // A finished game with 2+ players crowns its leader.
  if (g.settings.endDate && nyDate() > g.settings.endDate && ranks.length >= 2 && ranks[0].userId === user.id && !(user.wonGames || []).includes(g.id)) {
    user.wonGames = [...(user.wonGames || []), g.id]; await store.saveUser(user.id, { wonGames: user.wonGames });
  }
  return { game: await gamePublic(g, user), rankings: ranks, challenge: !!g.challenge };
});
route('PATCH', '/api/games/:gid', async ({ user, params, body }) => {
  const g = await mustGame(params.gid);
  if (g.owner !== user.id && !user.admin) throw httpError(403, 'Only the game creator can change settings.');
  if (g.sandboxOf && !user.admin) throw httpError(403, 'Practice portfolio rules are fixed.');
  const oldCash = g.settings.startingCash, settings = cleanSettings(body, g.settings);
  if (g.sandboxOf) settings.privacy = 'private';
  // Starting cash can only change before anyone has traded.
  if (settings.startingCash !== oldCash) {
    const players = await store.listPlayers(g.id);
    if (players.some(p => p.history.length)) settings.startingCash = oldCash;
    else await Promise.all(players.filter(p => p.userId === user.id).map(p => store.savePlayer(g.id, p.userId, { ...p, cash: settings.startingCash })));
  }
  const password = g.sandboxOf ? undefined : String(body.password || '');
  await store.updateGame(g.id, { settings, hasPassword: !!password }, password);
  return gamePublic({ ...g, settings, hasPassword: !!password }, user);
});
route('DELETE', '/api/games/:gid', async ({ user, params }) => {
  const g = await mustGame(params.gid);
  if ((g.owner !== user.id || g.sandboxOf) && !user.admin) throw httpError(403, 'Cannot delete this game.');
  await store.deleteGame(g.id); return { ok: true };
});
route('POST', '/api/games/:gid/join', async ({ user, params, body }) => {
  const g = await mustGame(params.gid);
  if (g.sandboxOf) throw httpError(404, 'Game not found.');
  if (g.members.includes(user.id)) return { ok: true };
  if (!g.settings.allowLateEntry && nyDate() > g.settings.startDate) throw httpError(403, 'This game does not allow late entry.');
  if (g.settings.endDate && nyDate() > g.settings.endDate) throw httpError(403, 'This game has ended.');
  if (g.settings.maxPlayers && g.members.length >= g.settings.maxPlayers) throw httpError(403, 'This game is full.');
  await store.join(g.id, newPlayer(g, user), body.password);
  await store.addActivity(g.id, { id: rid(), type: 'join', ...actor(user.id ? { ...user, userId: user.id } : user), text: 'joined the game', created: Date.now() }).catch(() => {});
  return { ok: true };
});
route('POST', '/api/games/:gid/leave', async ({ user, params }) => {
  const g = await mustGame(params.gid);
  if (g.sandboxOf || g.owner === user.id || !g.members.includes(user.id)) throw httpError(400, 'You cannot leave this game.');
  await store.leave(g.id, user.id); return { ok: true };
});
route('POST', '/api/games/:gid/reset', async ({ user, params }) => {
  const g = await mustGame(params.gid), p = await store.getPlayer(g.id, user.id);
  if (!p) throw httpError(404, 'Not in game.');
  if (!g.settings.allowReset) throw httpError(403, 'Portfolio resets are disabled for this game.');
  await store.savePlayer(g.id, user.id, { ...p, cash: g.settings.startingCash, positions: {}, options: {}, unsettled: [], orders: [], history: [], snapshots: {}, tradesByDay: {} });
  return { ok: true };
});

route('GET', '/api/games/:gid/portfolio', async ({ user, params, url }) => {
  const g = await mustGame(params.gid);
  const uid = url.searchParams.get('player') || user.id;
  const p = await store.getPlayer(g.id, uid);
  if (!p) throw httpError(404, 'Portfolio not found.');
  const own = uid === user.id;
  if (!own && !g.settings.showPortfolios) throw httpError(403, 'Portfolios are private in this game.');
  return { ...(await portfolioView(p, g, own)), owner: p.name, game: await gamePublic(g, user) };
});
route('POST', '/api/games/:gid/orders', async ({ user, params, body }) => {
  const g = await mustGame(params.gid), p = await store.getPlayer(params.gid, user.id);
  if (!p) throw httpError(404, 'Join this game first.');
  if (body.asset === 'option') return placeOptionOrder(g, p, user, body);
  const o = {
    id: rid(), symbol: String(body.symbol || '').toUpperCase(), action: body.action, qty: Math.round(Number(body.qty) * 1e6) / 1e6,
    type: body.type || 'market', duration: body.duration === 'gtc' ? 'gtc' : 'day', created: Date.now(), day: nyDate(), status: 'open', trailUnit: body.trailUnit === '$' ? '$' : '%',
  };
  if (o.type === 'limit') o.limitPrice = Number(body.limitPrice);
  if (o.type === 'stop') o.stopPrice = Number(body.stopPrice);
  if (o.type === 'trailing') o.trail = Number(body.trail);
  if (!['buy', 'sell', 'short', 'cover'].includes(o.action)) throw httpError(400, 'Choose buy, sell, short or cover.');
  if (!['market', 'limit', 'stop', 'trailing'].includes(o.type)) throw httpError(400, 'Unknown order type.');
  if ((o.type === 'limit' && !(o.limitPrice > 0)) || (o.type === 'stop' && !(o.stopPrice > 0)) || (o.type === 'trailing' && !(o.trail > 0))) throw httpError(400, 'Enter a price for this order type.');
  let q; try { q = await getQuote(o.symbol); } catch { throw httpError(400, `Couldn't find ${o.symbol}.`); }
  const mk = await marks([p]);
  const err = validateOrder(p, g, o, q, valuation(p, mk.quotes, mk.optq)); if (err) throw httpError(400, err);
  const delay = delayFor(g, o);
  if (delay) o.notBefore = Date.now() + delay;
  p.orders.push(o);
  if (!delay && openFor(o.symbol) && shouldFill(o, q.price)) fill(p, g, o, fillPrice(o, q.price));
  await savePlayer(g, p);
  return { order: o, filled: o.status === 'filled', delayed: !!delay, marketOpen: openFor(o.symbol) };
});
async function placeOptionOrder(g, p, user, body) {
  const c = parseKey(body.key);
  const o = {
    id: rid(), asset: 'option', key: optionKey(c), symbol: c.symbol, desc: optionLabel(c), action: body.action, qty: Number(body.qty),
    type: body.type === 'limit' ? 'limit' : 'market', duration: body.duration === 'gtc' ? 'gtc' : 'day', created: Date.now(), day: nyDate(), status: 'open',
  };
  if (o.type === 'limit') { o.limitPrice = Number(body.limitPrice); if (!(o.limitPrice > 0)) throw httpError(400, 'Enter a limit price.'); }
  if (!['bto', 'sto', 'btc', 'stc'].includes(o.action)) throw httpError(400, 'Choose an option action.');
  const mk = await marks([p, { options: { [o.key]: {} } }]), oq = mk.optq[o.key];
  if (!oq) throw httpError(400, `Couldn't price ${o.desc}.`);
  const err = validateOptionOrder(p, g, o, oq, valuation(p, mk.quotes, mk.optq)); if (err) throw httpError(400, err);
  const delay = delayFor(g, o);
  if (delay) o.notBefore = Date.now() + delay;
  p.orders.push(o);
  if (!delay && marketOpen() && shouldFillOption(o, oq)) fillOption(p, g, o, optionFillPrice(o, oq));
  await savePlayer(g, p);
  return { order: o, filled: o.status === 'filled', delayed: !!delay, marketOpen: marketOpen() };
}
route('DELETE', '/api/games/:gid/orders/:oid', async ({ user, params }) => {
  const p = await store.getPlayer(params.gid, user.id); const o = p?.orders.find(o => o.id === params.oid);
  if (!o) throw httpError(404, 'Order not found.');
  closeOrder(p, o, 'cancelled'); await store.savePlayer(params.gid, user.id, p);
  return { ok: true };
});

// ---------- news, earnings ----------
route('GET', '/api/news', ({ url }) => news((url.searchParams.get('symbol') || '').toUpperCase()));
route('GET', '/api/earnings', ({ url }) => nextEarnings((url.searchParams.get('symbol') || '').toUpperCase()));
route('GET', '/api/universe', () => UNIVERSE);

// ---------- notifications & price alerts ----------
function notify(user, items) {
  user.notifications = [...items.map(n => ({ id: rid(), read: false, created: Date.now(), ...n })), ...(user.notifications || [])].slice(0, 50);
  return store.saveUser(user.id, { notifications: user.notifications });
}
route('GET', '/api/notifications', async ({ user }) => ({ items: user.notifications || [], invites: await store.listInvites(user.id).catch(() => []) }));
route('POST', '/api/notifications/read', async ({ user }) => { (user.notifications || []).forEach(n => n.read = true); await store.saveUser(user.id, { notifications: user.notifications || [] }); return { ok: true }; });
route('GET', '/api/alerts', async ({ user }) => { const alerts = user.alerts || []; return { alerts, quotes: await getQuotes(alerts.map(a => a.symbol)) }; });
route('POST', '/api/alerts', async ({ user, body }) => {
  const a = { id: rid(), symbol: String(body.symbol || '').toUpperCase(), op: body.op, value: Number(body.value), created: Date.now(), triggered: null };
  if (!['above', 'below', 'up', 'down'].includes(a.op)) throw httpError(400, 'Choose when the alert should fire.');
  if (!(a.value > 0)) throw httpError(400, 'Enter a price or percentage above zero.');
  try { a.startPrice = (await getQuote(a.symbol)).price; } catch { throw httpError(400, `Couldn't find ${a.symbol}.`); }
  user.alerts = [a, ...(user.alerts || [])].slice(0, 50);
  await store.saveUser(user.id, { alerts: user.alerts });
  return a;
});
route('DELETE', '/api/alerts/:id', async ({ user, params }) => { user.alerts = (user.alerts || []).filter(a => a.id !== params.id); await store.saveUser(user.id, { alerts: user.alerts }); return { ok: true }; });
const ALERT_TEXT = { above: 'rose above', below: 'fell below', up: 'is up', down: 'is down' };
export async function checkAlerts() {
  const user = me; if (!user) return [];
  const live = (user.alerts || []).filter(a => !a.triggered); if (!live.length) return [];
  const quotes = await getQuotes(live.map(a => a.symbol)), hits = [];
  for (const a of live) {
    const q = quotes[a.symbol]; if (!q) continue;
    const hit = a.op === 'above' ? q.price >= a.value : a.op === 'below' ? q.price <= a.value : a.op === 'up' ? q.changePct >= a.value : q.changePct <= -a.value;
    if (!hit) continue;
    Object.assign(a, { triggered: Date.now(), hitPrice: q.price });
    hits.push({ kind: 'alert', text: `${a.symbol} ${ALERT_TEXT[a.op]} ${a.op === 'up' || a.op === 'down' ? a.value + '% today' : '$' + a.value} (now $${q.price.toFixed(2)})`, link: `#/research?symbol=${encodeURIComponent(a.symbol)}` });
  }
  if (hits.length) { await store.saveUser(user.id, { alerts: user.alerts }); await notify(user, hits); }
  return hits;
}

// ---------- game activity & comments ----------
route('GET', '/api/games/:gid/activity', async ({ params }) => store.listActivity(params.gid));
route('POST', '/api/games/:gid/activity', async ({ user, params, body }) => {
  const g = await mustGame(params.gid);
  if (!g.members.includes(user.id)) throw httpError(403, 'Join the game to comment.');
  const text = String(body.text || '').trim().slice(0, 500);
  if (!text) throw httpError(400, 'Write something first.');
  const item = { id: rid(), type: 'comment', ...actor({ ...user, userId: user.id }), text, replyTo: body.replyTo || null, created: Date.now() };
  await store.addActivity(g.id, item); return item;
});
route('DELETE', '/api/games/:gid/activity/:id', async ({ params }) => { await store.deleteActivity(params.gid, params.id); return { ok: true }; });

// ---------- friends, invites, challenges ----------
route('GET', '/api/friends', async ({ user }) => {
  const list = await Promise.all((user.friends || []).map(async uid => ({ id: uid, ...(await store.getProfile(uid).catch(() => null) || { name: 'Unknown player' }) })));
  return list;
});
route('POST', '/api/friends', async ({ user, body }) => {
  const handle = String(body.handle || '').trim().toLowerCase().replace(/^@/, '');
  const uid = handle && await store.lookupHandle(handle);
  if (!uid) throw httpError(404, `No one has the username @${handle || '…'}.`);
  if (uid === user.id) throw httpError(400, 'That’s you!');
  user.friends = [...new Set([...(user.friends || []), uid])];
  await store.saveUser(user.id, { friends: user.friends });
  return { id: uid };
});
route('DELETE', '/api/friends/:uid', async ({ user, params }) => { user.friends = (user.friends || []).filter(f => f !== params.uid); await store.saveUser(user.id, { friends: user.friends }); return { ok: true }; });
async function invite(user, to, g, kind) {
  const inv = { id: rid(), to, from: user.id, fromName: user.name, fromPicture: user.picture || '', fromColor: user.color || '', gameId: g.id, gameName: g.settings.name, kind, created: Date.now(), password: g.owner === user.id && g.hasPassword ? await store.getSecret(g.id) : '' };
  await store.sendInvite(inv); return inv;
}
route('POST', '/api/invites', async ({ user, body }) => {
  const g = await mustGame(body.gameId);
  if (!g.members.includes(user.id) || g.sandboxOf) throw httpError(403, 'You can only invite people to games you’re in.');
  if (g.members.includes(body.to)) throw httpError(400, 'They’re already in this game.');
  await invite(user, body.to, g, 'game'); return { ok: true };
});
route('POST', '/api/invites/:id/accept', async ({ user, params }) => {
  const inv = await store.getInvite(params.id);
  if (!inv || inv.to !== user.id) throw httpError(404, 'Invite not found.');
  const g = await mustGame(inv.gameId);
  if (!g.members.includes(user.id)) {
    if (g.settings.maxPlayers && g.members.length >= g.settings.maxPlayers) throw httpError(403, 'This game is full.');
    await store.join(g.id, newPlayer(g, user), inv.password);
    await store.addActivity(g.id, { id: rid(), type: 'join', ...actor({ ...user, userId: user.id }), text: inv.kind === 'challenge' ? 'accepted the challenge' : 'joined the game', created: Date.now() }).catch(() => {});
  }
  await store.deleteInvite(inv.id);
  return { gameId: g.id };
});
route('DELETE', '/api/invites/:id', async ({ params }) => { await store.deleteInvite(params.id); return { ok: true }; });
route('POST', '/api/challenges', async ({ user, body }) => {
  const friend = await store.getProfile(body.to).catch(() => null);
  if (!friend) throw httpError(404, 'Player not found.');
  const days = Math.min(90, Math.max(1, Number(body.days) || 7));
  const end = nyDate(new Date(Date.now() + days * 864e5));
  const password = rid().slice(0, 10);
  const g = { id: rid(), owner: user.id, created: Date.now(), members: [user.id], hasPassword: true, challenge: true,
    settings: cleanSettings({ name: `${user.name.split(' ')[0]} vs ${friend.name.split(' ')[0]}`, description: `${days}-day head-to-head challenge`, privacy: 'private', startDate: nyDate(), endDate: end, startingCash: Number(body.startingCash) || 100000, maxPlayers: 2, allowOptions: body.allowOptions !== false, allowCrypto: body.allowCrypto !== false, allowLateEntry: true }) };
  await store.createGame(g, password, newPlayer(g, user));
  await store.addActivity(g.id, { id: rid(), type: 'join', ...actor({ ...user, userId: user.id }), text: `challenged ${friend.name} to ${days} days of trading`, created: Date.now() }).catch(() => {});
  await invite(user, body.to, g, 'challenge');
  return gamePublic(g, user);
});

// ---------- global leaderboard ----------
let board = null;
route('GET', '/api/leaderboard', async () => {
  if (board && Date.now() - board.t < 300000) return board.rows;
  const games = (await store.publicGames()).sort((a, b) => b.created - a.created).slice(0, 25);
  const pairs = (await Promise.all(games.map(async g => (await store.listPlayers(g.id)).map(p => [g, p])))).flat();
  const mk = await marks(pairs.map(([, p]) => p));
  const rows = pairs.map(([g, p]) => {
    const v = valuation(p, mk.quotes, mk.optq), start = g.settings.startingCash;
    return { ...actor(p), gameId: g.id, game: g.settings.name, equity: v.equity, gainPct: (v.equity - start) / start * 100, trades: p.history.filter(o => o.status === 'filled').length };
  }).filter(r => r.trades > 0).sort((a, b) => b.gainPct - a.gainPct).slice(0, 50).map((r, i) => ({ ...r, rank: i + 1 }));
  board = { t: Date.now(), rows };
  return rows;
});

// ---------- achievements ----------
export const BADGES = [
  ['first_trade', '🎯', 'First trade', 'Made your first trade', c => c.trades >= 1],
  ['ten_trades', '⚡', 'Active trader', 'Made 10 trades', c => c.trades >= 10],
  ['hundred_trades', '🏛️', 'Market maker', 'Made 100 trades', c => c.trades >= 100],
  ['limit_order', '⏳', 'Patience pays', 'Filled a limit order', c => c.limitFills >= 1],
  ['short_seller', '🐻', 'Short seller', 'Shorted a stock', c => c.shorts >= 1],
  ['options_rookie', '🎟️', 'Options rookie', 'Traded your first option', c => c.options >= 1],
  ['premium', '💵', 'Premium collector', 'Wrote (sold to open) an option', c => c.written >= 1],
  ['strategist', '♟️', 'Strategist', 'Placed a multi-leg strategy', c => c.strategies >= 1],
  ['crypto', '🪙', 'Crypto curious', 'Bought crypto', c => c.crypto >= 1],
  ['diversified', '🧺', 'Diversified', 'Held 10 positions at once', c => c.maxPositions >= 10],
  ['income', '💧', 'Income investor', 'Earned dividends', c => c.dividends > 0],
  ['up5', '📈', 'In the green', 'Up 5% in a game', c => c.bestGain >= 5],
  ['up10', '🚀', 'Double digits', 'Up 10% in a game', c => c.bestGain >= 10],
  ['up25', '🏆', 'Market beater', 'Up 25% in a game', c => c.bestGain >= 25],
  ['comeback', '🔥', 'Comeback kid', 'Recovered from a 20% drawdown', c => c.comeback],
  ['commissioner', '📋', 'Commissioner', 'Created a game', c => c.created >= 1],
  ['team_player', '🤝', 'Team player', 'Joined someone else’s game', c => c.joined >= 1],
  ['champion', '👑', 'Champion', 'Finished first in a game with 2+ players', c => c.wins >= 1],
  ['watchful', '🔔', 'Watchful', 'Set a price alert', c => c.alerts >= 1],
  ['social', '👋', 'Social', 'Added a friend', c => c.friends >= 1],
];
async function badgeContext(user) {
  const games = await store.myGames(user.id);
  const pairs = (await Promise.all(games.map(async g => [g, await store.getPlayer(g.id, user.id)]))).filter(([, p]) => p);
  const c = { trades: 0, limitFills: 0, shorts: 0, options: 0, written: 0, strategies: 0, crypto: 0, maxPositions: 0, dividends: 0, bestGain: -Infinity, comeback: false, created: 0, joined: 0,
    wins: (user.wonGames || []).length, alerts: (user.alerts || []).length, friends: (user.friends || []).length };
  for (const [g, p] of pairs) {
    const fills = p.history.filter(o => o.status === 'filled');
    c.trades += fills.length;
    c.limitFills += fills.filter(o => o.type === 'limit').length;
    c.shorts += fills.filter(o => o.action === 'short').length;
    c.options += fills.filter(o => o.asset === 'option').length;
    c.written += fills.filter(o => o.action === 'sto').length;
    c.strategies += new Set(fills.filter(o => o.strategyId).map(o => o.strategyId)).size;
    c.crypto += fills.filter(o => isCrypto(o.symbol) && o.action === 'buy').length;
    c.maxPositions = Math.max(c.maxPositions, p.maxPositions || 0);
    c.dividends += Math.max(0, p.divPaid || 0);
    const start = g.settings.startingCash, vals = Object.entries(p.snapshots).sort().map(([, v]) => v);
    if (vals.length) c.bestGain = Math.max(c.bestGain, (vals[vals.length - 1] - start) / start * 100);
    let peak = start, dd = false;
    for (const v of vals) { if (dd && v >= peak) c.comeback = true; if (v > peak) peak = v; if (v <= peak * 0.8) dd = true; }
    if (g.owner === user.id && !g.sandboxOf) c.created++;
    if (g.owner !== user.id) c.joined++;
  }
  return c;
}
route('POST', '/api/badges/check', async ({ user }) => {
  const c = await badgeContext(user), earned = user.badges ||= {}, fresh = [];
  for (const [id, icon, name, desc, test] of BADGES) if (!earned[id] && test(c)) { earned[id] = Date.now(); fresh.push({ id, icon, name, desc }); }
  if (fresh.length) {
    await store.saveUser(user.id, { badges: earned });
    await store.saveProfile(user.id, publicProfile(user)).catch(() => {});
    await notify(user, fresh.map(b => ({ kind: 'badge', text: `Badge earned: ${b.icon} ${b.name}`, link: '#/profile' })));
  }
  return fresh;
});

// ---------- multi-leg strategies ----------
route('POST', '/api/games/:gid/strategy', async ({ user, params, body }) => {
  const g = await mustGame(params.gid), p = await store.getPlayer(params.gid, user.id), s = g.settings;
  if (!p) throw httpError(404, 'Join this game first.');
  if (!gameActive(g)) throw httpError(400, 'This game is not active.');
  if (!s.allowOptions) throw httpError(403, 'Options trading is disabled for this game.');
  if (!marketOpen()) throw httpError(400, 'Multi-leg strategies can only be placed while the market is open.');
  const legs = (body.legs || []).slice(0, 4).map(l => ({ ...l, qty: Number(l.qty) }));
  if (!legs.length) throw httpError(400, 'Add at least one leg.');
  if (legs.some(l => !(l.qty > 0) || !Number.isInteger(l.qty) || !['buy', 'sell'].includes(l.side))) throw httpError(400, 'Every leg needs a whole-number quantity and a side.');
  const stockLegs = legs.filter(l => l.kind === 'stock'), optLegs = legs.filter(l => l.kind === 'option');
  optLegs.forEach(l => { l.key = optionKey(parseKey(l.key)); });
  const mk = await marks([p, { positions: Object.fromEntries(stockLegs.map(l => [String(l.symbol).toUpperCase(), {}])), options: Object.fromEntries(optLegs.map(l => [l.key, {}])) }]);
  // Written legs must be covered by bought legs of the same type and expiry (or by shares for calls).
  const book = {};
  for (const l of optLegs) { const o = parseKey(l.key), k = o.type + o.exp; book[k] ||= { long: 0, short: 0, type: o.type, symbol: o.symbol }; book[k][l.side === 'buy' ? 'long' : 'short'] += l.qty; }
  let uncovered = 0;
  for (const b of Object.values(book)) {
    const shares = b.type === 'C' ? Math.max(0, p.positions[b.symbol]?.qty || 0) + stockLegs.filter(l => l.side === 'buy' && String(l.symbol).toUpperCase() === b.symbol).reduce((a, l) => a + l.qty, 0) : 0;
    uncovered += Math.max(0, b.short - b.long - Math.floor(shares / 100));
  }
  if (uncovered > 0 && !s.allowOptionWriting) throw httpError(403, 'This strategy writes uncovered options, which this game doesn’t allow.');
  const sid = rid(), name = String(body.name || 'strategy').slice(0, 40);
  let net = 0, fees = 0;
  const plan = legs.map(l => {
    const base = { id: rid(), qty: l.qty, type: 'market', duration: 'day', created: Date.now(), day: nyDate(), status: 'open', strategyId: sid, strategy: name };
    if (l.kind === 'option') {
      const oq = mk.optq[l.key]; if (!oq || oq.expired) throw httpError(400, 'One of the contracts can’t be priced right now.');
      const held = p.options?.[l.key]?.qty || 0;
      const action = l.side === 'buy' ? (held < 0 ? 'btc' : 'bto') : (held > 0 ? 'stc' : 'sto');
      if ((action === 'btc' && -held < l.qty) || (action === 'stc' && held < l.qty)) throw httpError(400, `Leg ${oq.desc} would partly close and partly open a position. Adjust its quantity.`);
      const price = l.side === 'buy' ? oq.ask : oq.bid;
      net += (l.side === 'buy' ? 1 : -1) * l.qty * 100 * price; fees += optionFee(g, l.qty, l.qty * 100 * price);
      return { kind: 'option', price, o: { ...base, asset: 'option', key: l.key, symbol: oq.symbol, desc: oq.desc, action } };
    }
    const sym = String(l.symbol).toUpperCase(), q = mk.quotes[sym]; if (!q) throw httpError(400, `Couldn't price ${sym}.`);
    const held = p.positions[sym]?.qty || 0;
    const action = l.side === 'buy' ? (held < 0 ? 'cover' : 'buy') : (held > 0 ? 'sell' : 'short');
    if (action === 'short' && !s.allowShort) throw httpError(403, 'Short selling is disabled for this game.');
    if (action === 'sell' && held < l.qty) throw httpError(400, `You only hold ${held} ${sym}.`);
    net += (l.side === 'buy' ? 1 : -1) * l.qty * q.price; fees += commissionFor(g, l.qty * q.price);
    return { kind: 'stock', price: q.price, o: { ...base, symbol: sym, action } };
  });
  const v = valuation(p, mk.quotes, mk.optq);
  if (net + fees > buyingPower(p, g, v)) throw httpError(400, 'Not enough buying power for this strategy.');
  for (const leg of plan) { p.orders.push(leg.o); leg.kind === 'option' ? fillOption(p, g, leg.o, leg.price) : fill(p, g, leg.o, leg.price); }
  await savePlayer(g, p);
  return { filled: true, net, fees, legs: plan.map(l => l.o) };
});

// ---------- admin ----------
const ADMIN_HASH = '059a50ce956b7ec61527c7ecc0c55b5a009dc54ab4acddce8852b46baa2aba30';
const sha256 = async t => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map(b => b.toString(16).padStart(2, '0')).join('');
const mustAdmin = user => { if (!user.admin) throw httpError(403, 'Admin mode is off.'); };
route('POST', '/api/admin/unlock', async ({ user, body }) => {
  if (await sha256(String(body.password || '')) !== ADMIN_HASH) throw httpError(403, 'Wrong password.');
  try { localStorage.setItem('bp_admin', user.id); } catch {}
  const status = await store.adminStatus(user.id);
  user.admin = status === 'yes';
  return { admin: user.admin, status, uid: user.id, email: user.email || '', provider: user.provider || '', mode: store.mode };
});
route('POST', '/api/admin/lock', ({ user }) => { try { localStorage.removeItem('bp_admin'); } catch {} user.admin = false; return { ok: true }; });
route('GET', '/api/admin/users', async ({ user }) => {
  mustAdmin(user);
  const list = await store.listProfiles();
  return Promise.all(list.map(async pr => ({ ...pr, email: (await store.getUser(pr.id).catch(() => null))?.email || '' })));
});
route('PATCH', '/api/admin/users/:uid', async ({ user, params, body }) => {
  mustAdmin(user);
  const target = { id: params.uid, ...(await store.getUser(params.uid).catch(() => null)), ...(await store.getProfile(params.uid).catch(() => null)), id: params.uid };
  if (body.removePicture) body.picture = '';
  await applyProfile(target, body);
  return { ok: true };
});
route('DELETE', '/api/admin/users/:uid', async ({ user, params }) => {
  mustAdmin(user);
  const uid = params.uid;
  if (uid === user.id) throw httpError(400, 'Use Delete account for your own account.');
  for (const g of await store.myGames(uid)) {
    if (g.owner === uid) await store.deleteGame(g.id);
    else await store.leave(g.id, uid).catch(() => {});
  }
  const pr = await store.getProfile(uid).catch(() => null);
  if (pr?.handle) await store.releaseHandle(pr.handle);
  await store.deleteUserDocs(uid);
  return { ok: true };
});
route('GET', '/api/admin/games', async ({ user }) => {
  mustAdmin(user);
  const [games, profiles] = await Promise.all([store.listAllGames(), store.listProfiles()]);
  const nameOf = id => profiles.find(p => p.id === id)?.name || 'Unknown';
  return games.sort((a, b) => b.created - a.created).map(g => ({ id: g.id, name: g.settings.name, owner: g.owner, ownerName: nameOf(g.owner), players: g.members.length, practice: !!g.sandboxOf, privacy: g.settings.privacy, active: gameActive(g), created: g.created }));
});
route('GET', '/api/admin/games/:gid/players', async ({ user, params }) => {
  mustAdmin(user);
  const g = await mustGame(params.gid), players = await store.listPlayers(g.id), mk = await marks(players);
  return players.map(p => ({ ...actor(p), cash: p.cash, equity: valuation(p, mk.quotes, mk.optq).equity, trades: p.history.filter(o => o.status === 'filled').length, positions: Object.keys(p.positions).length + Object.keys(p.options || {}).length }));
});
route('PATCH', '/api/admin/games/:gid/players/:uid', async ({ user, params, body }) => {
  mustAdmin(user);
  const g = await mustGame(params.gid), p = await store.getPlayer(g.id, params.uid);
  if (!p) throw httpError(404, 'Player not found.');
  if (body.reset) Object.assign(p, { cash: g.settings.startingCash, positions: {}, options: {}, unsettled: [], orders: [], history: [], snapshots: {}, tradesByDay: {} });
  if (body.cash !== undefined) { const c = Number(body.cash); if (!isFinite(c)) throw httpError(400, 'Enter an amount.'); p.cash = c; }
  await store.savePlayer(g.id, params.uid, p);
  return { ok: true };
});
route('DELETE', '/api/admin/games/:gid/players/:uid', async ({ user, params }) => {
  mustAdmin(user);
  const g = await mustGame(params.gid);
  if (g.owner === params.uid) throw httpError(400, 'Delete the game instead of removing its creator.');
  await store.leave(g.id, params.uid); return { ok: true };
});

const PERMISSION_HELP = 'Firebase blocked this change. In the Firebase console, open Firestore Database → Rules, paste in the latest firestore.rules from the Bullpen GitHub repo, and click Publish.';
export async function api(path, method = 'GET', body = {}) {
  const url = new URL(path, location.href);
  for (const r of routes) {
    const m = method === r.method && url.pathname.match(r.re);
    if (!m) continue;
    const user = await loadMe();
    if (!user) throw httpError(401, 'Sign in required.');
    try { return await r.fn({ url, body, user, params: m.groups || {} }); }
    catch (e) { if (e.code === 'permission-denied' || /insufficient permissions/i.test(e.message)) throw httpError(403, PERMISSION_HELP); throw e; }
  }
  throw httpError(404, 'Not found');
}

// Fill pending orders in the background while the app is open.
setInterval(async () => {
  if (!me) return;
  for (const g of await store.myGames(me.id)) {
    const p = await store.getPlayer(g.id, me.id);
    if ((p?.orders.length || Object.keys(p?.options || {}).length) && await processOrders(p, g)) await savePlayer(g, p);
  }
}, 30000);
