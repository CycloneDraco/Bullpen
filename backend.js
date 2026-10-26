// In-browser backend: the same /api routes the old Node server had, backed by
// store.js (Firebase or localStorage) and Finnhub for live prices.
import CONFIG from './config.js';
import { store } from './store.js';
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
async function getMeta(sym) {
  if (meta[sym]) return meta[sym];
  const p = await fh('/stock/profile2?symbol=' + encodeURIComponent(sym));
  // Finnhub only has company profiles for stocks; no profile means a fund.
  meta[sym] = p.name ? { name: p.name, exchange: p.exchange, type: 'EQUITY' } : { name: sym, exchange: '', type: 'ETF' };
  saveMeta(); return meta[sym];
}
async function getQuote(symbol) {
  symbol = symbol.toUpperCase();
  const c = quoteCache.get(symbol);
  if (c && Date.now() - c.t < 20000) return c.q;
  let q, m;
  try { [q, m] = await Promise.all([fh('/quote?symbol=' + encodeURIComponent(symbol)), getMeta(symbol).catch(() => ({ name: symbol, type: 'EQUITY' }))]); }
  catch (e) { if (c) return c.q; throw e; }
  if (!q.c && !q.pc) throw new Error(`Unknown symbol ${symbol}`);
  const out = {
    symbol, name: m.name, price: q.c, prevClose: q.pc, change: q.d ?? 0, changePct: q.dp ?? 0,
    high: q.h, low: q.l, open: q.o, exchange: m.exchange, type: m.type, currency: 'USD', time: q.t * 1000,
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
  const j = await fh('/search?exchange=US&q=' + encodeURIComponent(q));
  return (j.result || []).filter(x => !x.symbol.includes('.') && ['Common Stock', 'ETP', 'ADR', 'REIT'].includes(x.type)).slice(0, 8).map(x => {
    const type = x.type === 'ETP' ? 'ETF' : 'EQUITY';
    if (!meta[x.symbol]) { meta[x.symbol] = { name: x.description, exchange: '', type }; saveMeta(); }
    return { symbol: x.symbol, name: x.description, exchange: '', type: type === 'ETF' ? 'ETF' : 'Stock' };
  });
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
  s.startingCash = Math.min(Math.max(s.startingCash, 1000), 100000000);
  return s;
}
const newPlayer = (g, user) => ({ userId: user.id, name: user.name, picture: user.picture || '', cash: g.settings.startingCash, positions: {}, orders: [], history: [], snapshots: {}, joined: Date.now(), tradesByDay: {} });
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
function valuation(p, quotes) {
  let longValue = 0, shortValue = 0;
  const holdings = Object.entries(p.positions).map(([sym, pos]) => {
    const q = quotes[sym]; const price = q?.price ?? pos.avg;
    const value = pos.qty * price;
    if (pos.qty > 0) longValue += value; else shortValue += -value;
    const gain = pos.qty > 0 ? (price - pos.avg) * pos.qty : (pos.avg - price) * -pos.qty;
    return { symbol: sym, name: q?.name || sym, qty: pos.qty, avg: pos.avg, price, value, gain, gainPct: (gain / Math.abs(pos.avg * pos.qty)) * 100, dayChange: (q?.change || 0) * pos.qty, dayChangePct: q?.changePct || 0 };
  });
  return { holdings, longValue, shortValue, equity: p.cash + longValue - shortValue };
}
function buyingPower(p, g, v) {
  // Short proceeds sit in cash but are held as collateral; margin lends up to equity again.
  return Math.max(0, p.cash - v.shortValue + (g.settings.allowMargin ? v.equity : 0));
}
const commissionFor = (g, amount) => g.settings.commissionType === 'flat' ? g.settings.commission : amount * g.settings.commission / 100;

function validateOrder(p, g, o, q, v) {
  const s = g.settings;
  if (!gameActive(g)) return 'This game is not active.';
  if (!(o.qty > 0) || !Number.isInteger(o.qty)) return 'Quantity must be a whole number above zero.';
  if (q.type === 'ETF' && !s.allowEtf) return 'ETFs are not allowed in this game.';
  if (o.action === 'buy' && q.price < s.minStockPrice) return `Stocks under $${s.minStockPrice} cannot be bought in this game.`;
  if (o.action === 'short') {
    if (!s.allowShort) return 'Short selling is disabled for this game.';
    if (q.price < s.minShortPrice) return `Stocks under $${s.minShortPrice} cannot be shorted in this game.`;
  }
  if (o.type === 'limit' && !s.allowLimit) return 'Limit orders are disabled.';
  if (o.type === 'stop' && !s.allowStop) return 'Stop orders are disabled.';
  if (o.type === 'trailing' && !s.allowTrailing) return 'Trailing stop orders are disabled.';
  const pos = p.positions[o.symbol];
  if (o.action === 'sell' && (!pos || pos.qty < o.qty)) return `You only hold ${pos?.qty > 0 ? pos.qty : 0} shares.`;
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
  if (o.action === 'buy') { pos.avg = (pos.avg * pos.qty + amount) / (pos.qty + o.qty); pos.qty += o.qty; p.cash -= amount + fee; }
  if (o.action === 'sell') { pos.qty -= o.qty; p.cash += amount - fee; }
  if (o.action === 'short') { pos.avg = (pos.avg * -pos.qty + amount) / (-pos.qty + o.qty); pos.qty -= o.qty; p.cash += amount - fee; }
  if (o.action === 'cover') { pos.qty += o.qty; p.cash -= amount + fee; }
  if (pos.qty === 0) delete p.positions[o.symbol]; else p.positions[o.symbol] = pos;
  Object.assign(o, { status: 'filled', filledAt: Date.now(), fillPrice: price, fee });
  p.tradesByDay[nyDate()] = (p.tradesByDay[nyDate()] || 0) + 1;
  p.history.unshift({ ...o });
  p.orders = p.orders.filter(x => x.id !== o.id);
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
  if (!p.orders.length) return false;
  const open = marketOpen(), today = nyDate();
  const quotes = await getQuotes(p.orders.map(o => o.symbol));
  for (const o of [...p.orders]) {
    if (o.duration === 'day' && o.day !== today && o.type !== 'market') { closeOrder(p, o, 'expired'); continue; }
    if (o.duration === 'gtc' && Date.now() - o.created > 90 * 864e5) { closeOrder(p, o, 'expired'); continue; }
    const q = quotes[o.symbol]; if (!q || !open) continue;
    if (shouldFill(o, q.price)) {
      const err = validateOrder(p, g, { ...o }, q, valuation(p, quotes));
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

async function portfolioView(p, g, own) {
  if (own) { accrueInterest(p, g); await processOrders(p, g); }
  const quotes = await getQuotes(Object.keys(p.positions));
  const v = valuation(p, quotes);
  if (own) { p.snapshots[nyDate()] = Math.round(v.equity * 100) / 100; await store.savePlayer(g.id, p.userId, p); }
  const start = g.settings.startingCash;
  return {
    playerId: p.userId, gameId: g.id, cash: p.cash, ...v, buyingPower: buyingPower(p, g, v),
    totalGain: v.equity - start, totalGainPct: ((v.equity - start) / start) * 100,
    dayChange: v.holdings.reduce((a, h) => a + h.dayChange, 0),
    orders: own ? p.orders : [], history: p.history.slice(0, 200), snapshots: p.snapshots, marketOpen: marketOpen(),
  };
}

async function rankings(g) {
  const players = await store.listPlayers(g.id);
  const quotes = await getQuotes(players.flatMap(p => Object.keys(p.positions)));
  return players.map(p => {
    const v = valuation(p, quotes);
    return { playerId: p.userId, userId: p.userId, name: p.name || 'Player', picture: p.picture, equity: v.equity, gain: v.equity - g.settings.startingCash, gainPct: ((v.equity - g.settings.startingCash) / g.settings.startingCash) * 100 };
  }).sort((a, b) => b.equity - a.equity).map((r, i) => ({ ...r, rank: i + 1 }));
}

async function gamePublic(g, user) {
  const isOwner = g.owner === user.id;
  return {
    id: g.id, owner: g.owner, isOwner, sandbox: !!g.sandboxOf, created: g.created,
    settings: isOwner ? { ...g.settings, password: g.hasPassword ? await store.getSecret(g.id) : '' } : g.settings,
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
  me = { watchlist: ['AAPL', 'MSFT', 'NVDA', 'SPY'], ...saved, ...u, id: u.id, prefs: { ...DEFAULT_PREFS, ...saved?.prefs } };
  await store.saveUser(u.id, { name: me.name, email: me.email || '', picture: me.picture || '', prefs: me.prefs, watchlist: me.watchlist, lastLogin: Date.now() });
  await ensureDefaultGame(me);
  return me;
}
export async function signIn(name) { await store.signIn(name); me = null; return loadMe(); }
export async function signOut() { await store.signOut(); me = null; }

// ---------- routes ----------
const routes = [];
const route = (method, pattern, fn) => routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), fn });
const mustGame = async gid => { const g = await store.getGame(gid); if (!g) throw httpError(404, 'Game not found.'); return g; };

route('GET', '/api/me', ({ user }) => ({ user }));
route('PATCH', '/api/me/prefs', async ({ user, body }) => { user.prefs = { ...user.prefs, ...body }; await store.saveUser(user.id, { prefs: user.prefs }); return { user }; });

route('GET', '/api/quote', ({ url }) => getQuotes((url.searchParams.get('symbols') || '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 40)));
route('GET', '/api/search', ({ url }) => search(url.searchParams.get('q') || ''));
route('GET', '/api/market', async () => ({ open: marketOpen(), indices: await getQuotes(['SPY', 'DIA', 'QQQ', 'IWM', 'GLD']), movers: await getQuotes(['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'JPM']) }));

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
  return gamePublic(g, user);
});
route('GET', '/api/games/:gid', async ({ user, params }) => {
  const g = await mustGame(params.gid);
  if (g.sandboxOf && g.sandboxOf !== user.id) throw httpError(404, 'Game not found.');
  return { game: await gamePublic(g, user), rankings: await rankings(g) };
});
route('PATCH', '/api/games/:gid', async ({ user, params, body }) => {
  const g = await mustGame(params.gid);
  if (g.owner !== user.id) throw httpError(403, 'Only the game creator can change settings.');
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
  if (g.owner !== user.id || g.sandboxOf) throw httpError(403, 'Cannot delete this game.');
  await store.deleteGame(g.id); return { ok: true };
});
route('POST', '/api/games/:gid/join', async ({ user, params, body }) => {
  const g = await mustGame(params.gid);
  if (g.sandboxOf) throw httpError(404, 'Game not found.');
  if (g.members.includes(user.id)) return { ok: true };
  if (!g.settings.allowLateEntry && nyDate() > g.settings.startDate) throw httpError(403, 'This game does not allow late entry.');
  if (g.settings.endDate && nyDate() > g.settings.endDate) throw httpError(403, 'This game has ended.');
  await store.join(g.id, newPlayer(g, user), body.password); return { ok: true };
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
  await store.savePlayer(g.id, user.id, { ...p, cash: g.settings.startingCash, positions: {}, orders: [], history: [], snapshots: {}, tradesByDay: {} });
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
  const o = {
    id: rid(), symbol: String(body.symbol || '').toUpperCase(), action: body.action, qty: Number(body.qty),
    type: body.type || 'market', duration: body.duration === 'gtc' ? 'gtc' : 'day', created: Date.now(), day: nyDate(), status: 'open', trailUnit: body.trailUnit === '$' ? '$' : '%',
  };
  if (o.type === 'limit') o.limitPrice = Number(body.limitPrice);
  if (o.type === 'stop') o.stopPrice = Number(body.stopPrice);
  if (o.type === 'trailing') o.trail = Number(body.trail);
  if (!['buy', 'sell', 'short', 'cover'].includes(o.action)) throw httpError(400, 'Choose buy, sell, short or cover.');
  if (!['market', 'limit', 'stop', 'trailing'].includes(o.type)) throw httpError(400, 'Unknown order type.');
  if ((o.type === 'limit' && !(o.limitPrice > 0)) || (o.type === 'stop' && !(o.stopPrice > 0)) || (o.type === 'trailing' && !(o.trail > 0))) throw httpError(400, 'Enter a price for this order type.');
  let q; try { q = await getQuote(o.symbol); } catch { throw httpError(400, `Couldn't find ${o.symbol}.`); }
  const v = valuation(p, await getQuotes(Object.keys(p.positions)));
  const err = validateOrder(p, g, o, q, v); if (err) throw httpError(400, err);
  p.orders.push(o);
  if (marketOpen() && shouldFill(o, q.price)) fill(p, g, o, fillPrice(o, q.price));
  await store.savePlayer(g.id, user.id, p);
  return { order: o, filled: o.status === 'filled', marketOpen: marketOpen() };
});
route('DELETE', '/api/games/:gid/orders/:oid', async ({ user, params }) => {
  const p = await store.getPlayer(params.gid, user.id); const o = p?.orders.find(o => o.id === params.oid);
  if (!o) throw httpError(404, 'Order not found.');
  closeOrder(p, o, 'cancelled'); await store.savePlayer(params.gid, user.id, p);
  return { ok: true };
});

export async function api(path, method = 'GET', body = {}) {
  const url = new URL(path, location.href);
  for (const r of routes) {
    const m = method === r.method && url.pathname.match(r.re);
    if (!m) continue;
    const user = await loadMe();
    if (!user) throw httpError(401, 'Sign in required.');
    return r.fn({ url, body, user, params: m.groups || {} });
  }
  throw httpError(404, 'Not found');
}

// Fill pending orders in the background while the app is open.
setInterval(async () => {
  if (!me || !marketOpen()) return;
  for (const g of await store.myGames(me.id)) {
    const p = await store.getPlayer(g.id, me.id);
    if (p?.orders.length && await processOrders(p, g)) await store.savePlayer(g.id, me.id, p);
  }
}, 30000);
