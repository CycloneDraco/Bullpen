// Bullpen front end — vanilla JS single-page app with hash routing.
import { api as backend, store, signIn, signOut } from './backend.js';
import CONFIG from './config.js';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const state = { me: null, config: null, games: { mine: [], public: [] }, gameId: null, timers: [] };
const prefs = () => state.me?.prefs || {};

async function api(path, opts = {}) {
  try { return await backend(path, opts.method || 'GET', opts.body || {}); }
  catch (e) { if (e.status === 401 && path !== '/api/me') { state.me = null; route(); } throw e; }
}

// ---------- formatting ----------
function money(n, opts = {}) {
  if (n == null || isNaN(n)) return '—';
  if (prefs().compactNumbers && Math.abs(n) >= 1e4 && !opts.full) return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 2 }).format(n);
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
}
const signed = (n, f = money) => (n > 0 ? '+' : n < 0 ? '−' : '') + f(Math.abs(n));
const pct = n => n == null || isNaN(n) ? '—' : (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(2) + '%';
const cls = n => n > 0 ? 'up' : n < 0 ? 'down' : '';
const chip = (n, txt) => `<span class="chip ${n >= 0 ? 'pill-up' : 'pill-down'}">${txt}</span>`;
const when = t => new Date(t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

function toast(msg, err) {
  const t = document.createElement('div'); t.className = 'toast' + (err ? ' err' : ''); t.textContent = msg;
  $('#toasts').append(t); setTimeout(() => { t.style.transition = 'opacity .3s'; t.style.opacity = 0; setTimeout(() => t.remove(), 300); }, 3200);
}
function modal(html, onMount) {
  const s = document.createElement('div'); s.className = 'scrim'; s.innerHTML = `<div class="sheet" role="dialog" aria-modal="true">${html}</div>`;
  const close = () => { s.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = e => e.key === 'Escape' && close();
  s.addEventListener('pointerdown', e => e.target === s && close());
  document.addEventListener('keydown', onKey);
  document.body.append(s); onMount?.(s.firstChild, close);
  return close;
}

// ---------- theme & prefs ----------
function applyPrefs() {
  const p = prefs(), root = document.documentElement;
  p.theme && p.theme !== 'system' ? root.dataset.theme = p.theme : delete root.dataset.theme;
  p.accent && p.accent !== 'blue' ? root.dataset.accent = p.accent : delete root.dataset.accent;
  root.dataset.density = p.density || 'comfortable';
  p.colors && p.colors !== 'standard' ? root.dataset.colors = p.colors : delete root.dataset.colors;
}
async function savePrefs(patch) { const { user } = await api('/api/me/prefs', { method: 'PATCH', body: patch }); state.me = user; applyPrefs(); }

// ---------- chart (SVG, pointer-tracked crosshair) ----------
function lineChart(host, points, { tip, baseline, tall } = {}) {
  host.innerHTML = '';
  if (!points || points.length < 2) { host.innerHTML = '<div class="empty">Not enough data to chart yet.</div>'; return; }
  const W = host.clientWidth || 600, H = tall ? 320 : 240, P = { t: 12, r: 8, b: 22, l: 8 };
  const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
  const base = baseline ?? ys[0];
  let lo = Math.min(...ys, base), hi = Math.max(...ys, base); if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * .08; lo -= pad; hi += pad;
  const X = i => P.l + (i / (points.length - 1)) * (W - P.l - P.r);
  const Y = v => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const up = ys[ys.length - 1] >= base, color = up ? 'var(--up)' : 'var(--down)';
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p[1]).toFixed(1)}`).join('');
  const gid = 'g' + Math.random().toString(36).slice(2);
  const span = xs[xs.length - 1] - xs[0];
  const label = t => new Date(t).toLocaleString(undefined, span < 2 * 864e5 ? { hour: 'numeric', minute: '2-digit' } : span < 400 * 864e5 ? { month: 'short', day: 'numeric' } : { month: 'short', year: '2-digit' });
  const ticks = [...new Set((points.length < 5 ? [0, 1] : [0, .25, .5, .75, 1]).map(f => Math.round(f * (points.length - 1))))];
  host.innerHTML = `<svg class="chart${tall ? ' tall' : ''}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
    <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
    <line x1="${P.l}" x2="${W - P.r}" y1="${Y(base)}" y2="${Y(base)}" stroke="var(--ink-3)" stroke-dasharray="2 4" stroke-width="1"/>
    <path d="${d}L${X(points.length - 1)},${H - P.b}L${X(0)},${H - P.b}Z" fill="url(#${gid})"/>
    <path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" vector-effect="non-scaling-stroke"/>
    ${ticks.map((i, k) => `<text x="${X(i)}" y="${H - 6}" text-anchor="${k === 0 ? 'start' : k === ticks.length - 1 ? 'end' : 'middle'}">${label(xs[i])}</text>`).join('')}
    <g class="cross" opacity="0"><line y1="${P.t}" y2="${H - P.b}" stroke="var(--ink-3)" stroke-width="1"/><circle r="4.5" fill="${color}" stroke="var(--surface)" stroke-width="2"/></g>
  </svg>`;
  const svg = $('svg', host), cross = $('.cross', svg);
  const move = e => {
    const r = svg.getBoundingClientRect(), fx = (e.clientX - r.left) / r.width * W;
    const i = Math.max(0, Math.min(points.length - 1, Math.round((fx - P.l) / (W - P.l - P.r) * (points.length - 1))));
    cross.setAttribute('opacity', 1); cross.setAttribute('transform', `translate(${X(i)},0)`);
    $('circle', cross).setAttribute('cy', Y(ys[i]));
    if (tip) tip.innerHTML = `<b class="num">${money(ys[i], { full: true })}</b> <span class="${cls(ys[i] - base)}">${signed(ys[i] - base)} (${pct((ys[i] - base) / base * 100)})</span> · ${new Date(xs[i]).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: span < 30 * 864e5 ? 'short' : undefined })}`;
  };
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); if (tip) tip.innerHTML = ''; });
}

// ---------- symbol search ----------
function symbolSearch(input, onPick) {
  const box = document.createElement('div'); box.className = 'search-results'; box.hidden = true;
  input.parentElement.classList.add('search'); input.parentElement.append(box);
  let t, items = [], hl = -1;
  const render = () => { box.hidden = !items.length; box.innerHTML = items.map((x, i) => `<button type="button" data-i="${i}" class="${i === hl ? 'hl' : ''}"><span class="sym">${esc(x.symbol)}</span><span class="muted small">${esc(x.name)}</span><span class="spacer"></span><span class="badge">${esc(x.exchange || x.type || '')}</span></button>`).join(''); };
  input.addEventListener('input', () => {
    clearTimeout(t); const q = input.value.trim(); if (!q) { items = []; render(); return; }
    t = setTimeout(async () => { try { items = await api('/api/search?q=' + encodeURIComponent(q)); hl = -1; render(); } catch {} }, 180);
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { hl = Math.min(items.length - 1, hl + 1); render(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { hl = Math.max(0, hl - 1); render(); e.preventDefault(); }
    else if (e.key === 'Enter') { e.preventDefault(); const pick = items[hl] || items[0]; const sym = pick ? pick.symbol : input.value.trim().toUpperCase(); if (sym) { items = []; render(); onPick(sym); } }
    else if (e.key === 'Escape') { items = []; render(); }
  });
  box.addEventListener('pointerdown', e => { const b = e.target.closest('button'); if (b) { e.preventDefault(); const x = items[b.dataset.i]; items = []; render(); onPick(x.symbol); } });
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 120));
}

// ---------- shell ----------
function every(ms, fn) { const t = setInterval(fn, ms); state.timers.push(t); }
function setActiveTab() {
  const h = location.hash.split('?')[0].replace('#', '') || '/';
  $$('#tabs a').forEach(a => { const p = a.getAttribute('href').slice(1); a.classList.toggle('active', p === '/' ? h === '/' : h.startsWith(p)); });
}
async function loadGames() {
  state.games = await api('/api/games');
  const ids = state.games.mine.map(g => g.id);
  let saved; try { saved = localStorage.getItem('bp_game'); } catch {}
  state.gameId = [state.gameId, saved, prefs().defaultGame].find(x => ids.includes(x)) || ids[0];
  const sel = $('#gameSelect');
  sel.innerHTML = state.games.mine.map(g => `<option value="${g.id}" ${g.id === state.gameId ? 'selected' : ''}>${esc(g.settings.name)}</option>`).join('');
}
const activeGame = () => state.games.mine.find(g => g.id === state.gameId);
function renderShell() {
  $('#nav').hidden = false;
  const u = state.me, av = $('#avatarBtn');
  av.style.backgroundImage = u.picture ? `url("${u.picture}")` : ''; av.textContent = u.picture ? '' : (u.name || '?')[0].toUpperCase();
  av.setAttribute('aria-label', 'Account: ' + u.name);
  $('#menuHead').innerHTML = `<b>${esc(u.name)}</b><div class="muted">${esc(u.email || 'Offline account')}</div>`;
}
$('#avatarBtn').addEventListener('click', e => { e.stopPropagation(); $('#avatarMenu').hidden = !$('#avatarMenu').hidden; });
document.addEventListener('click', () => { $('#avatarMenu').hidden = true; });
$('#signOut').addEventListener('click', async () => { await signOut(); state.me = null; state.games = { mine: [], public: [] }; route(); });
$('#gameSelect').addEventListener('change', e => { state.gameId = e.target.value; try { localStorage.setItem('bp_game', state.gameId); } catch {} route(); });

// ---------- sign in ----------
function viewSignIn() {
  $('#nav').hidden = true;
  const google = store.mode === 'firebase';
  app.innerHTML = `<section class="hero view"><div class="hero-card">
    <img src="icon.svg" width="72" height="72" alt="">
    <h1>Trade the real market.<br>Risk nothing.</h1>
    <p>Practice investing with $100,000 in virtual cash, live market prices, and games against friends.</p>
    <div class="signin-box">
      ${google ? `<button class="btn block" id="gbtn" style="max-width:320px"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#fff" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/></svg>Continue with Google</button>`
      : `<p class="small muted" style="margin:0">Offline mode: your portfolios are saved in this browser only. Add Firebase to <code>config.js</code> for Google sign-in and games with friends.</p>
        <form id="demo" class="row" style="width:100%;max-width:340px"><input name="name" placeholder="Your name" aria-label="Your name" required style="flex:1"><button class="btn">Start</button></form>`}
      ${CONFIG.finnhubKey ? '' : '<p class="small down" style="margin:0">Live prices need a Finnhub key in <code>config.js</code>.</p>'}
    </div>
    <div class="features"><div><b>Live prices</b>Real quotes, every few seconds</div><div><b>Every order type</b>Market, limit, stop, trailing</div><div><b>Custom games</b>Your rules, your league</div></div>
  </div></section>`;
  const done = async () => { state.me = (await api('/api/me')).user; route(); };
  $('#gbtn')?.addEventListener('click', async () => {
    try { await signIn(); await done(); } catch (e) { if (e.code !== 'auth/popup-closed-by-user') toast(e.code === 'auth/unauthorized-domain' ? 'Add this site to Firebase → Authentication → Settings → Authorized domains.' : e.message, true); }
  });
  $('#demo')?.addEventListener('submit', async e => {
    e.preventDefault();
    try { await signIn(e.target.name.value); await done(); } catch (err) { toast(err.message, true); }
  });
}

// ---------- dashboard ----------
async function viewDashboard() {
  const g = activeGame();
  app.innerHTML = `<div class="view">
    <div class="page-head"><div><div class="muted small">${esc(g.settings.name)}</div><h1>Dashboard</h1></div><span id="mkt"></span></div>
    <div class="ticker" id="indices">${'<div class="card"><div class="skeleton"></div></div>'.repeat(5)}</div>
    <div class="grid g2">
      <div class="card"><div class="stat"><div class="label">Account value</div></div><div class="big" id="acct">—</div><div id="acctChg" style="margin:6px 0 14px"></div><div id="perf"></div><div class="chart-tip" id="perfTip"></div>
        <div class="grid g3" style="margin-top:14px" id="acctStats"></div></div>
      <div class="card"><div class="card-head"><h2>Watchlist</h2><a href="#/watchlist" class="small">Edit</a></div><div id="wl"></div></div>
    </div>
    <div class="grid g-half" style="margin-top:var(--gap)">
      <div class="card"><div class="card-head"><h2>Top holdings</h2><a href="#/portfolio" class="small">See all</a></div><div id="top"></div></div>
      <div class="card"><div class="card-head"><h2>Market movers</h2><span class="muted small">Large caps</span></div><div id="movers"></div></div>
    </div></div>`;
  const load = async () => {
    const [m, pf, wl] = await Promise.all([api('/api/market'), api(`/api/games/${g.id}/portfolio`), api('/api/watchlist')]);
    $('#mkt').innerHTML = `<span class="badge ${m.open ? 'live' : 'closed'}">${m.open ? 'Market open' : 'Market closed'}</span>`;
    const names = { SPY: 'S&P 500 · SPY', DIA: 'Dow Jones · DIA', QQQ: 'Nasdaq 100 · QQQ', IWM: 'Russell 2000 · IWM', GLD: 'Gold · GLD' };
    $('#indices').innerHTML = Object.entries(names).map(([s, n]) => { const q = m.indices[s]; return `<a class="card" href="#/research?symbol=${encodeURIComponent(s)}"><div class="muted small">${n}</div><div class="num" style="font-weight:650;font-size:1.1rem;color:var(--ink)">${q ? q.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</div><div class="small ${cls(q?.change)}">${q ? pct(q.changePct) : ''}</div></a>`; }).join('');
    $('#acct').textContent = money(pf.equity, { full: true });
    $('#acctChg').innerHTML = `${chip(pf.totalGain, `${signed(pf.totalGain)} (${pct(pf.totalGainPct)})`)} <span class="muted small">all time</span>${prefs().showDayChange !== false ? ` &nbsp;${chip(pf.dayChange, signed(pf.dayChange))} <span class="muted small">today</span>` : ''}`;
    $('#acctStats').innerHTML = [['Buying power', pf.buyingPower], ['Cash', pf.cash], ['Holdings', pf.longValue - pf.shortValue]].map(([l, v]) => `<div class="stat"><div class="label">${l}</div><div class="value">${money(v)}</div></div>`).join('');
    const snaps = Object.entries(pf.snapshots).sort().map(([d, v]) => [new Date(d + 'T16:00:00').getTime(), v]);
    snaps.unshift([new Date(g.created || Date.now()).getTime() - 864e5, g.settings.startingCash]);
    lineChart($('#perf'), snaps, { tip: $('#perfTip'), baseline: g.settings.startingCash });
    $('#wl').innerHTML = quoteList(wl.symbols.map(s => wl.quotes[s]).filter(Boolean));
    $('#movers').innerHTML = quoteList(Object.values(m.movers).sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 6));
    const top = [...pf.holdings].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 5);
    $('#top').innerHTML = top.length ? quoteList(top.map(h => ({ symbol: h.symbol, name: `${h.qty} shares · ${money(h.value)}`, price: h.price, changePct: h.gainPct }))) : `<div class="empty">No holdings yet.<br><a href="#/trade" class="btn sm" style="margin-top:12px">Make your first trade</a></div>`;
  };
  await load(); every(20000, () => load().catch(() => {}));
}
function quoteList(qs) {
  if (!qs.length) return '<div class="empty">Nothing here yet.</div>';
  return `<table><tbody>${qs.map(q => `<tr class="link" data-go="#/research?symbol=${encodeURIComponent(q.symbol)}"><td><div class="sym">${esc(q.symbol)}</div><div class="sym-name">${esc(q.name)}</div></td><td class="r num">${money(q.price, { full: true })}<div class="small ${cls(q.changePct)}">${pct(q.changePct)}</div></td></tr>`).join('')}</tbody></table>`;
}
app.addEventListener('click', e => { const r = e.target.closest('[data-go]'); if (r && !e.target.closest('button,a')) location.hash = r.dataset.go; });

// ---------- portfolio ----------
async function viewPortfolio(q) {
  const g = activeGame(), other = q.get('player'), tab = q.get('tab') || 'holdings';
  const pf = await api(`/api/games/${g.id}/portfolio${other ? '?player=' + other : ''}`);
  const own = !other;
  const tabUrl = t => `#/portfolio?tab=${t}${other ? '&player=' + other : ''}`;
  app.innerHTML = `<div class="view">
    <div class="page-head"><div><div class="muted small">${esc(pf.game.settings.name)}</div><h1>${own ? 'Portfolio' : esc(pf.owner) + '’s portfolio'}</h1></div>
      ${own ? `<div class="row">${pf.game.settings.allowReset ? '<button class="btn secondary sm" id="reset">Reset portfolio</button>' : ''}<a class="btn" href="#/trade">Trade</a></div>` : ''}</div>
    <div class="grid g4">${[['Account value', money(pf.equity)], ['Today', `<span class="${cls(pf.dayChange)}">${signed(pf.dayChange)}</span>`], ['Total return', `<span class="${cls(pf.totalGain)}">${signed(pf.totalGain)} <span class="small">${pct(pf.totalGainPct)}</span></span>`], ['Buying power', money(pf.buyingPower)], ['Cash', money(pf.cash)], ['Long value', money(pf.longValue)], ['Short value', money(pf.shortValue)], ['Positions', pf.holdings.length]].map(([l, v]) => `<div class="card stat"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('')}</div>
    <div class="card" style="margin-top:var(--gap)">
      <div class="card-head"><div class="seg">${['holdings', ...(own ? ['orders'] : []), 'history', 'performance'].map(t => `<button data-t="${t}" class="${t === tab ? 'on' : ''}">${{ holdings: 'Holdings', orders: `Open orders (${pf.orders.length})`, history: 'Trade history', performance: 'Performance' }[t]}</button>`).join('')}</div></div>
      <div id="pane"></div></div></div>`;
  $$('.seg button').forEach(b => b.addEventListener('click', () => location.hash = tabUrl(b.dataset.t)));
  $('#reset')?.addEventListener('click', () => modal(`<h2>Reset portfolio?</h2><p class="muted">All positions, orders and history in <b>${esc(g.settings.name)}</b> will be cleared and your cash restored to ${money(g.settings.startingCash)}.</p><div class="actions"><button class="btn secondary" data-x>Cancel</button><button class="btn danger" data-ok>Reset</button></div>`, (el, close) => {
    $('[data-x]', el).onclick = close;
    $('[data-ok]', el).onclick = async () => { try { await api(`/api/games/${g.id}/reset`, { method: 'POST' }); close(); toast('Portfolio reset.'); route(); } catch (e) { toast(e.message, true); } };
  }));
  const pane = $('#pane');
  if (tab === 'holdings') {
    const longs = pf.holdings.filter(h => h.qty > 0), shorts = pf.holdings.filter(h => h.qty < 0);
    const tbl = (rows, short) => `<div class="table-wrap"><table><thead><tr><th>Symbol</th><th class="r">Qty</th><th class="r">Price</th><th class="r">Day</th><th class="r">${short ? 'Short' : 'Avg'} price</th><th class="r">Value</th><th class="r">Gain / loss</th>${own ? '<th></th>' : ''}</tr></thead><tbody>
      ${rows.map(h => `<tr class="link" data-go="#/research?symbol=${encodeURIComponent(h.symbol)}"><td><div class="sym">${esc(h.symbol)}</div><div class="sym-name">${esc(h.name)}</div></td><td class="r">${Math.abs(h.qty)}</td><td class="r">${money(h.price, { full: true })}</td><td class="r ${cls(h.dayChangePct)}">${pct(h.dayChangePct)}</td><td class="r">${money(h.avg, { full: true })}</td><td class="r">${money(Math.abs(h.value))}</td><td class="r ${cls(h.gain)}">${signed(h.gain)}<div class="small">${pct(h.gainPct)}</div></td>${own ? `<td class="r"><a class="btn sm secondary" href="#/trade?symbol=${encodeURIComponent(h.symbol)}&action=${short ? 'cover' : 'sell'}&qty=${Math.abs(h.qty)}">${short ? 'Cover' : 'Sell'}</a></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
    pane.innerHTML = (longs.length ? `<h3 style="margin:6px 0">Stocks &amp; ETFs</h3>${tbl(longs)}` : '') + (shorts.length ? `<h3 style="margin:22px 0 6px">Short positions</h3>${tbl(shorts, true)}` : '') + (!pf.holdings.length ? '<div class="empty">No positions yet.</div>' : '');
  }
  if (tab === 'orders') {
    pane.innerHTML = pf.orders.length ? `${pf.marketOpen ? '' : '<p class="muted small">The market is closed. Market orders will fill at the next open.</p>'}<div class="table-wrap"><table><thead><tr><th>Placed</th><th>Symbol</th><th>Action</th><th class="r">Qty</th><th>Type</th><th>Duration</th><th></th></tr></thead><tbody>
      ${pf.orders.map(o => `<tr><td>${when(o.created)}</td><td class="sym">${esc(o.symbol)}</td><td>${o.action}</td><td class="r">${o.qty}</td><td>${orderDesc(o)}</td><td>${o.duration === 'gtc' ? 'Good ’til cancelled' : 'Day'}</td><td class="r"><button class="btn sm danger" data-cancel="${o.id}">Cancel</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No open orders.</div>';
    $$('[data-cancel]', pane).forEach(b => b.onclick = async () => { await api(`/api/games/${g.id}/orders/${b.dataset.cancel}`, { method: 'DELETE' }); toast('Order cancelled.'); route(); });
  }
  if (tab === 'history') {
    pane.innerHTML = pf.history.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Symbol</th><th>Action</th><th class="r">Qty</th><th>Type</th><th class="r">Price</th><th class="r">Fee</th><th>Status</th></tr></thead><tbody>
      ${pf.history.map(o => `<tr><td>${when(o.filledAt || o.created)}</td><td class="sym">${esc(o.symbol)}</td><td>${o.action}</td><td class="r">${o.qty}</td><td>${orderDesc(o)}</td><td class="r">${o.fillPrice ? money(o.fillPrice, { full: true }) : '—'}</td><td class="r">${o.fee ? money(o.fee) : '—'}</td><td><span class="badge ${o.status === 'filled' ? 'live' : ''}" title="${esc(o.reason || '')}">${o.status}</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No trades yet.</div>';
  }
  if (tab === 'performance') {
    pane.innerHTML = '<div id="pchart"></div><div class="chart-tip" id="ptip"></div>';
    const snaps = Object.entries(pf.snapshots).sort().map(([d, v]) => [new Date(d + 'T16:00:00').getTime(), v]);
    snaps.unshift([(g.created || Date.now()) - 864e5, g.settings.startingCash]);
    lineChart($('#pchart'), snaps, { tip: $('#ptip'), baseline: g.settings.startingCash, tall: true });
  }
}
const orderDesc = o => ({ market: 'Market', limit: `Limit ${money(o.limitPrice, { full: true })}`, stop: `Stop ${money(o.stopPrice, { full: true })}`, trailing: `Trailing ${o.trailUnit === '$' ? money(o.trail) : o.trail + '%'}` }[o.type]);

// ---------- trade ----------
async function viewTrade(q) {
  const g = activeGame(), s = g.settings;
  const f = { symbol: (q.get('symbol') || '').toUpperCase(), action: q.get('action') || 'buy', qty: q.get('qty') || '', type: 'market', duration: 'day', limitPrice: '', stopPrice: '', trail: '', trailUnit: '%' };
  const actions = ['buy', 'sell', ...(s.allowShort ? ['short', 'cover'] : [])];
  const types = ['market', ...(s.allowLimit ? ['limit'] : []), ...(s.allowStop ? ['stop'] : []), ...(s.allowTrailing ? ['trailing'] : [])];
  app.innerHTML = `<div class="view"><div class="page-head"><div><div class="muted small">${esc(s.name)}</div><h1>Trade</h1></div></div>
    <div class="grid g2"><form class="card stack" id="tf" autocomplete="off">
      <label class="field"><span>Symbol</span><div><input name="symbol" placeholder="Search a company or ticker" value="${esc(f.symbol)}"></div></label>
      <div id="quote"></div>
      <div class="field"><span class="muted small" style="font-weight:600">Action</span><div class="seg full" id="act">${actions.map(a => `<button type="button" data-v="${a}">${a[0].toUpperCase() + a.slice(1)}</button>`).join('')}</div></div>
      <div class="form-grid">
        <label class="field"><span>Quantity</span><input name="qty" type="number" min="1" step="1" inputmode="numeric" value="${esc(f.qty)}" placeholder="0"><div class="hint" id="maxq"></div></label>
        <label class="field"><span>Order type</span><select name="type">${types.map(t => `<option value="${t}">${{ market: 'Market', limit: 'Limit', stop: 'Stop', trailing: 'Trailing stop' }[t]}</option>`).join('')}</select></label>
        <label class="field" data-for="limit" hidden><span>Limit price</span><input name="limitPrice" type="number" step="0.01" min="0"></label>
        <label class="field" data-for="stop" hidden><span>Stop price</span><input name="stopPrice" type="number" step="0.01" min="0"></label>
        <label class="field" data-for="trailing" hidden><span>Trail by</span><div class="row" style="flex-wrap:nowrap"><input name="trail" type="number" step="0.01" min="0"><select name="trailUnit" style="width:80px"><option>%</option><option>$</option></select></div></label>
        <label class="field"><span>Duration</span><select name="duration"><option value="day">Day only</option><option value="gtc">Good ’til cancelled</option></select></label>
      </div>
      <div id="est" class="muted small"></div>
      <button class="btn block" id="go">Preview order</button>
    </form>
    <div class="stack"><div class="card" id="acct"></div><div class="card small muted" id="rules"></div></div></div></div>`;
  const form = $('#tf'); let quote = null, pf = null;
  const setAct = a => { f.action = a; $$('#act button').forEach(b => { b.classList.toggle('on', b.dataset.v === a); }); $('#go').className = 'btn block ' + (a === 'buy' || a === 'cover' ? '' : 'down'); estimate(); };
  $$('#act button').forEach(b => b.onclick = () => setAct(b.dataset.v));
  form.type.onchange = () => { $$('[data-for]').forEach(l => l.hidden = l.dataset.for !== form.type.value); estimate(); };
  form.addEventListener('input', estimate);
  function estimate() {
    if (!quote || !pf) return;
    const price = form.type.value === 'limit' && +form.limitPrice.value ? +form.limitPrice.value : quote.price;
    const qty = +form.qty.value || 0, amt = qty * price;
    const fee = s.commissionType === 'flat' ? (qty ? s.commission : 0) : amt * s.commission / 100;
    const held = pf.holdings.find(h => h.symbol === quote.symbol)?.qty || 0;
    const max = f.action === 'sell' ? Math.max(0, held) : f.action === 'cover' ? Math.max(0, -held) : Math.floor(Math.max(0, pf.buyingPower - (s.commissionType === 'flat' ? s.commission : 0)) / (price * (1 + (s.commissionType === 'percent' ? s.commission / 100 : 0))));
    $('#maxq').innerHTML = `Max: <a href="#" id="maxset">${max.toLocaleString()}</a>`;
    $('#maxset').onclick = e => { e.preventDefault(); form.qty.value = max; estimate(); };
    $('#est').innerHTML = qty ? `Estimated ${f.action === 'sell' || f.action === 'short' ? 'proceeds' : 'cost'}: <b class="num" style="color:var(--ink)">${money(amt, { full: true })}</b>${fee ? ` + ${money(fee)} commission` : ''}` : '';
  }
  async function loadQuote(sym) {
    f.symbol = sym; form.symbol.value = sym;
    try { const r = await api('/api/quote?symbols=' + encodeURIComponent(sym)); quote = r[sym]; } catch { quote = null; }
    $('#quote').innerHTML = quote ? `<div class="row"><div><div class="sym" style="font-size:1.1rem">${esc(quote.symbol)}</div><div class="muted small">${esc(quote.name)}</div></div><span class="spacer"></span><div style="text-align:right"><div class="num" style="font-size:1.4rem;font-weight:650">${money(quote.price, { full: true })}</div><div class="small ${cls(quote.change)}">${signed(quote.change)} (${pct(quote.changePct)})</div></div></div>` : sym ? `<div class="down small">Couldn't find “${esc(sym)}”.</div>` : '';
    estimate();
  }
  symbolSearch(form.symbol, loadQuote);
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (!quote) return toast('Choose a symbol first.', true);
    const o = { symbol: quote.symbol, action: f.action, qty: +form.qty.value, type: form.type.value, duration: form.duration.value, limitPrice: +form.limitPrice.value, stopPrice: +form.stopPrice.value, trail: +form.trail.value, trailUnit: form.trailUnit.value };
    if (!(o.qty > 0)) return toast('Enter a quantity.', true);
    const submit = async close => {
      try { const r = await api(`/api/games/${g.id}/orders`, { method: 'POST', body: o }); close?.();
        toast(r.filled ? `${o.action[0].toUpperCase() + o.action.slice(1)} ${o.qty} ${o.symbol} filled at ${money(r.order.fillPrice, { full: true })}` : r.marketOpen ? 'Order placed. It will fill when its price is reached.' : 'Order placed. It will fill when the market opens.');
        location.hash = r.filled ? '#/portfolio' : '#/portfolio?tab=orders';
      } catch (err) { toast(err.message, true); }
    };
    if (prefs().confirmTrades === false) return submit();
    const amt = o.qty * (o.type === 'limit' ? o.limitPrice : quote.price);
    modal(`<h2>Review order</h2><div class="rows">
      <div><span class="muted">Action</span><b>${o.action.toUpperCase()} ${o.qty} ${esc(o.symbol)}</b></div>
      <div><span class="muted">Order type</span><span>${orderDesc(o)}</span></div>
      <div><span class="muted">Duration</span><span>${o.duration === 'gtc' ? 'Good ’til cancelled' : 'Day only'}</span></div>
      <div><span class="muted">Current price</span><span>${money(quote.price, { full: true })}</span></div>
      <div><span class="muted">Estimated total</span><b>${money(amt, { full: true })}</b></div></div>
      ${pf && !pf.marketOpen ? '<p class="small muted">The market is closed, so this order will be queued.</p>' : ''}
      <div class="actions"><button class="btn secondary" data-x>Edit</button><button class="btn ${o.action === 'buy' || o.action === 'cover' ? '' : 'down'}" data-ok>Place order</button></div>`, (el, close) => {
      $('[data-x]', el).onclick = close; $('[data-ok]', el).onclick = () => submit(close);
    });
  });
  setAct(actions.includes(f.action) ? f.action : 'buy');
  pf = await api(`/api/games/${g.id}/portfolio`);
  $('#acct').innerHTML = `<h3>Your account</h3><div class="grid" style="grid-template-columns:1fr 1fr;margin-top:10px">${[['Account value', pf.equity], ['Buying power', pf.buyingPower], ['Cash', pf.cash], ['Positions', null]].map(([l, v]) => `<div class="stat"><div class="label">${l}</div><div class="value" style="font-size:1.1rem">${v == null ? pf.holdings.length : money(v)}</div></div>`).join('')}</div><div style="margin-top:10px"><span class="badge ${pf.marketOpen ? 'live' : 'closed'}">${pf.marketOpen ? 'Market open' : 'Market closed'}</span></div>`;
  $('#rules').innerHTML = `<h3 style="color:var(--ink);margin-bottom:6px">Game rules</h3>Commission: ${s.commission ? (s.commissionType === 'flat' ? money(s.commission) + ' per trade' : s.commission + '% of trade') : 'none'}<br>Short selling: ${s.allowShort ? `on (min ${money(s.minShortPrice)})` : 'off'}<br>Margin: ${s.allowMargin ? `on (${s.marginInterest}% interest)` : 'off'}<br>${s.minStockPrice ? `Min. stock price: ${money(s.minStockPrice)}<br>` : ''}${s.maxPositionPct < 100 ? `Max position: ${s.maxPositionPct}% of portfolio<br>` : ''}${s.dailyTradeLimit ? `Daily trade limit: ${s.dailyTradeLimit}<br>` : ''}ETFs: ${s.allowEtf ? 'allowed' : 'not allowed'}`;
  if (f.symbol) loadQuote(f.symbol); else form.symbol.focus();
}

// ---------- research ----------
async function viewResearch(q) {
  const sym = (q.get('symbol') || '').toUpperCase();
  app.innerHTML = `<div class="view"><div class="page-head"><h1>Research</h1><div style="width:min(420px,100%)"><div><input id="rs" placeholder="Search a company or ticker" value="${esc(sym)}" aria-label="Search symbols"></div></div></div><div id="body"></div></div>`;
  symbolSearch($('#rs'), s => location.hash = '#/research?symbol=' + encodeURIComponent(s));
  if (!sym) { $('#body').innerHTML = `<div class="card empty">Search for any stock, ETF or index to see live quotes and charts.<div class="row" style="justify-content:center;margin-top:14px">${['AAPL', 'NVDA', 'TSLA', 'SPY', 'QQQ', 'MSFT'].map(s => `<a class="btn secondary sm" href="#/research?symbol=${s}">${s}</a>`).join('')}</div></div>`; return; }
  const [quotes, wl] = await Promise.all([api('/api/quote?symbols=' + encodeURIComponent(sym)), api('/api/watchlist')]);
  const qt = quotes[sym];
  if (!qt) { $('#body').innerHTML = `<div class="card empty">No results for “${esc(sym)}”.</div>`; return; }
  const watching = wl.symbols.includes(sym);
  $('#body').innerHTML = `<div class="grid g2"><div class="card">
      <div class="row"><div><h2>${esc(qt.name)}</h2><div class="muted small">${esc(qt.symbol)} · ${esc(qt.exchange)} · ${esc(qt.currency)}</div></div><span class="spacer"></span>
        <button class="btn secondary sm" id="watch">${watching ? '★ Watching' : '☆ Watch'}</button></div>
      <div class="big" style="margin-top:14px" id="px">${money(qt.price, { full: true })}</div>
      <div id="pxc" class="${cls(qt.change)}" style="font-weight:600;margin-bottom:14px">${signed(qt.change)} (${pct(qt.changePct)}) today</div>
      <div id="chart" class="tv"></div></div>
    <div class="stack"><div class="card"><h3 style="margin-bottom:8px">Key stats</h3><table><tbody>
      ${[['Previous close', money(qt.prevClose, { full: true })], ['Open', money(qt.open, { full: true })], ['Day range', `${money(qt.low, { full: true })} – ${money(qt.high, { full: true })}`], ['Type', qt.type === 'ETF' ? 'Fund' : 'Stock'], ['Last update', when(qt.time)]].map(([k, v]) => `<tr><td class="muted">${k}</td><td class="r">${v}</td></tr>`).join('')}</tbody></table></div>
      <div class="card row"><a class="btn up" style="flex:1" href="#/trade?symbol=${encodeURIComponent(sym)}&action=buy">Buy</a><a class="btn down" style="flex:1" href="#/trade?symbol=${encodeURIComponent(sym)}&action=sell">Sell</a>${activeGame()?.settings.allowShort ? `<a class="btn secondary" style="flex:1" href="#/trade?symbol=${encodeURIComponent(sym)}&action=short">Short</a>` : ''}</div>
    </div></div>`;
  $('#watch').onclick = async () => {
    const list = watching ? wl.symbols.filter(s => s !== sym) : [...wl.symbols, sym];
    await api('/api/watchlist', { method: 'PUT', body: { symbols: list } }); toast(watching ? 'Removed from watchlist.' : 'Added to watchlist.'); route();
  };
  tradingViewChart($('#chart'), sym);
  every(15000, async () => { const r = await api('/api/quote?symbols=' + encodeURIComponent(sym)).catch(() => null); const n = r?.[sym]; if (!n || !$('#px')) return; $('#px').textContent = money(n.price, { full: true }); $('#pxc').className = cls(n.change); $('#pxc').textContent = `${signed(n.change)} (${pct(n.changePct)}) today`; });
}

// Interactive chart from TradingView's free embeddable widget (no key; draws its own data).
function tradingViewChart(host, sym) {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const range = { '1D': '1D', '5D': '5D', '1M': '1M', '6M': '6M', YTD: 'YTD', '1Y': '12M', '5Y': '60M' }[prefs().defaultRange] || '1D';
  host.innerHTML = '<div class="tradingview-widget-container" style="height:100%"><div class="tradingview-widget-container__widget" style="height:100%"></div></div>';
  const s = document.createElement('script');
  s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'; s.async = true;
  s.textContent = JSON.stringify({ symbol: sym, range, interval: range === '1D' ? '5' : 'D', theme: dark ? 'dark' : 'light', style: '3', locale: 'en', autosize: true, hide_side_toolbar: true, allow_symbol_change: false, save_image: false, backgroundColor: dark ? 'rgba(28,28,30,1)' : 'rgba(255,255,255,1)', gridColor: 'rgba(128,128,128,0.08)', support_host: 'https://www.tradingview.com' });
  $('.tradingview-widget-container', host).append(s);
}

// ---------- watchlist ----------
async function viewWatchlist() {
  const wl = await api('/api/watchlist');
  app.innerHTML = `<div class="view"><div class="page-head"><h1>Watchlist</h1><div style="width:min(360px,100%)"><div><input id="add" placeholder="Add a symbol" aria-label="Add a symbol"></div></div></div>
    <div class="card"><div class="table-wrap"><table><thead><tr><th>Symbol</th><th class="r">Price</th><th class="r">Change</th><th class="r">Day range</th><th class="r">Open</th><th></th></tr></thead><tbody id="rows"></tbody></table></div></div></div>`;
  const render = (w) => {
    $('#rows').innerHTML = w.symbols.length ? w.symbols.map(s => { const q = w.quotes[s] || {}; return `<tr class="link" data-go="#/research?symbol=${encodeURIComponent(s)}"><td><div class="sym">${esc(s)}</div><div class="sym-name">${esc(q.name)}</div></td><td class="r">${money(q.price, { full: true })}</td><td class="r ${cls(q.change)}">${signed(q.change ?? 0)}<div class="small">${pct(q.changePct)}</div></td><td class="r">${money(q.low, { full: true })} – ${money(q.high, { full: true })}</td><td class="r">${money(q.open, { full: true })}</td><td class="r"><a class="btn sm secondary" href="#/trade?symbol=${encodeURIComponent(s)}">Trade</a> <button class="btn sm ghost" data-rm="${esc(s)}" aria-label="Remove ${esc(s)}">Remove</button></td></tr>`; }).join('') : '<tr><td colspan="6" class="empty">Your watchlist is empty.</td></tr>';
    $$('[data-rm]').forEach(b => b.onclick = async () => { await api('/api/watchlist', { method: 'PUT', body: { symbols: w.symbols.filter(x => x !== b.dataset.rm) } }); render(await api('/api/watchlist')); });
  };
  render(wl);
  symbolSearch($('#add'), async s => { const cur = await api('/api/watchlist'); await api('/api/watchlist', { method: 'PUT', body: { symbols: [...cur.symbols, s] } }); $('#add').value = ''; render(await api('/api/watchlist')); toast(`${s} added.`); });
  every(20000, async () => { if ($('#rows')) render(await api('/api/watchlist')); });
}

// ---------- games ----------
const SETTING_GROUPS = [
  ['Basics', [
    ['name', 'Game name', 'text'], ['description', 'Description', 'textarea'],
    ['privacy', 'Who can join', 'select', [['public', 'Anyone (public)'], ['private', 'Invite only (private)']]],
    ['password', 'Password', 'text', null, 'Optional. Players must enter it to join.'],
    ['startDate', 'Start date', 'date'], ['endDate', 'End date', 'date', null, 'Leave blank for no end date.'],
    ['startingCash', 'Starting cash ($)', 'number'],
  ]],
  ['Trading costs', [
    ['commissionType', 'Commission type', 'select', [['flat', 'Flat fee per trade'], ['percent', 'Percent of trade value']]],
    ['commission', 'Commission amount', 'number', null, 'Dollars, or percent if percentage is selected.'],
    ['cashInterest', 'Interest on cash (% / yr)', 'number'],
  ]],
  ['Margin & short selling', [
    ['allowMargin', 'Allow margin trading', 'bool', null, 'Buying power is doubled; negative cash accrues interest.'],
    ['marginInterest', 'Margin interest (% / yr)', 'number'],
    ['allowShort', 'Allow short selling', 'bool'],
    ['minShortPrice', 'Minimum price to short ($)', 'number'],
  ]],
  ['Trading rules', [
    ['allowLimit', 'Allow limit orders', 'bool'], ['allowStop', 'Allow stop orders', 'bool'], ['allowTrailing', 'Allow trailing stop orders', 'bool'],
    ['allowEtf', 'Allow ETFs', 'bool'], ['allowMutualFunds', 'Allow mutual funds', 'bool'],
    ['minStockPrice', 'Minimum price to buy ($)', 'number', null, 'Blocks penny stocks below this price.'],
    ['maxPositionPct', 'Max single position (% of portfolio)', 'number', null, '100 = no diversification rule.'],
    ['dailyTradeLimit', 'Daily trade limit', 'number', null, '0 = unlimited.'],
  ]],
  ['Players', [
    ['allowLateEntry', 'Allow late entry', 'bool', null, 'Players can join after the start date.'],
    ['allowReset', 'Allow portfolio resets', 'bool'],
    ['showPortfolios', 'Players can view each other’s portfolios', 'bool'],
  ]],
];
function settingsForm(s, sandbox) {
  return SETTING_GROUPS.map(([title, fields]) => `<div class="card"><h3 style="margin-bottom:12px">${title}</h3>
    ${fields.filter(([k]) => !(sandbox && ['privacy', 'password', 'allowLateEntry', 'showPortfolios', 'startDate', 'endDate'].includes(k))).map(([k, label, type, opts, hint]) => type === 'bool'
      ? `<label class="switch"><div><div class="t">${label}</div>${hint ? `<div class="d">${hint}</div>` : ''}</div><input type="checkbox" name="${k}" ${s[k] ? 'checked' : ''}></label>`
      : `<label class="field" style="margin-bottom:12px"><span>${label}</span>${type === 'select' ? `<select name="${k}">${opts.map(([v, t]) => `<option value="${v}" ${s[k] === v ? 'selected' : ''}>${t}</option>`).join('')}</select>` : type === 'textarea' ? `<textarea name="${k}" rows="2">${esc(s[k])}</textarea>` : `<input name="${k}" type="${type}" value="${esc(s[k])}" ${type === 'number' ? 'step="any" min="0"' : ''}>`}${hint ? `<div class="hint">${hint}</div>` : ''}</label>`).join('')}</div>`).join('');
}
const readForm = form => Object.fromEntries([...form.elements].filter(e => e.name).map(e => [e.name, e.type === 'checkbox' ? e.checked : e.type === 'number' ? +e.value : e.value]));
const DEFAULTS = { name: '', description: '', privacy: 'public', password: '', startDate: new Date().toLocaleDateString('en-CA'), endDate: '', startingCash: 100000, commissionType: 'flat', commission: 0, cashInterest: 0, allowMargin: false, marginInterest: 8, allowShort: true, minShortPrice: 5, allowLimit: true, allowStop: true, allowTrailing: true, allowEtf: true, allowMutualFunds: false, minStockPrice: 0, maxPositionPct: 100, dailyTradeLimit: 0, allowLateEntry: true, allowReset: true, showPortfolios: true };

async function viewGames() {
  await loadGames();
  const row = (g, mine) => `<tr class="link" data-go="#/games/${g.id}"><td><div class="sym">${esc(g.settings.name)} ${g.sandbox ? '<span class="badge">Practice</span>' : ''}</div><div class="sym-name">${esc(g.settings.description)}</div></td><td>${g.players}</td><td>${money(g.settings.startingCash)}</td><td>${g.sandbox ? '—' : `${g.settings.startDate} → ${g.settings.endDate || 'open'}`}</td><td><span class="badge ${g.active ? 'live' : ''}">${g.active ? 'Active' : 'Inactive'}</span></td><td class="r">${mine ? (g.id === state.gameId ? '<span class="badge">Current</span>' : `<button class="btn sm secondary" data-use="${g.id}">Switch to</button>`) : `<button class="btn sm" data-join="${g.id}" data-pw="${g.hasPassword ? 1 : ''}">Join</button>`}</td></tr>`;
  const head = '<thead><tr><th>Game</th><th>Players</th><th>Starting cash</th><th>Dates</th><th>Status</th><th></th></tr></thead>';
  app.innerHTML = `<div class="view"><div class="page-head"><h1>Games</h1><div class="row"><button class="btn secondary" id="joinCode">Join with ID</button><a class="btn" href="#/games/new">Create game</a></div></div>
    <div class="card"><h2 style="margin-bottom:8px">My games</h2><div class="table-wrap"><table>${head}<tbody>${state.games.mine.map(g => row(g, true)).join('')}</tbody></table></div></div>
    <div class="card" style="margin-top:var(--gap)"><div class="card-head"><h2>Public games</h2><input id="filter" placeholder="Filter" style="max-width:220px" aria-label="Filter public games"></div><div class="table-wrap"><table>${head}<tbody id="pub">${state.games.public.map(g => row(g)).join('') || '<tr><td colspan="6" class="empty">No public games to join right now. Create one!</td></tr>'}</tbody></table></div></div></div>`;
  $$('[data-use]').forEach(b => b.onclick = () => { $('#gameSelect').value = b.dataset.use; $('#gameSelect').dispatchEvent(new Event('change')); });
  $$('[data-join]').forEach(b => b.onclick = () => joinGame(b.dataset.join, !!b.dataset.pw));
  $('#filter').oninput = e => $$('#pub tr').forEach(tr => tr.hidden = !tr.textContent.toLowerCase().includes(e.target.value.toLowerCase()));
  $('#joinCode').onclick = () => modal(`<h2>Join a game</h2><label class="field"><span>Game ID or invite link</span><input id="gid" placeholder="Paste here"></label><label class="field" style="margin-top:12px"><span>Password (if any)</span><input id="gpw" type="password"></label><div class="actions"><button class="btn secondary" data-x>Cancel</button><button class="btn" data-ok>Join</button></div>`, (el, close) => {
    $('[data-x]', el).onclick = close;
    $('[data-ok]', el).onclick = async () => { const v = $('#gid', el).value.trim().split('/').pop(); try { await api(`/api/games/${v}/join`, { method: 'POST', body: { password: $('#gpw', el).value } }); close(); await enterGame(v); } catch (e) { toast(e.message, true); } };
  });
}
async function joinGame(gid, needsPw) {
  const go = async pw => { await api(`/api/games/${gid}/join`, { method: 'POST', body: { password: pw } }); await enterGame(gid); };
  if (!needsPw) return go().catch(e => toast(e.message, true));
  modal(`<h2>Game password</h2><input id="pw" type="password" aria-label="Password"><div class="actions"><button class="btn secondary" data-x>Cancel</button><button class="btn" data-ok>Join</button></div>`, (el, close) => {
    $('[data-x]', el).onclick = close; $('#pw', el).focus();
    $('[data-ok]', el).onclick = async () => { try { await go($('#pw', el).value); close(); } catch (e) { toast(e.message, true); } };
  });
}
async function enterGame(gid, msg = 'Joined! Good luck.') { state.gameId = gid; try { localStorage.setItem('bp_game', gid); } catch {} await loadGames(); toast(msg); location.hash = '#/games/' + gid; }

function viewCreateGame() {
  app.innerHTML = `<div class="view"><div class="page-head"><div><a href="#/games" class="small">‹ Games</a><h1>Create a game</h1></div></div>
    <form id="cf" class="grid g-half">${settingsForm({ ...DEFAULTS, name: state.me.name.split(' ')[0] + '’s Game' })}<div class="card" style="align-self:start"><p class="muted small" style="margin-top:0">You can change most settings later. Starting cash locks after the first trade.</p><button class="btn block">Create game</button></div></form></div>`;
  $('#cf').onsubmit = async e => { e.preventDefault(); try { const g = await api('/api/games', { method: 'POST', body: readForm(e.target) }); await enterGame(g.id, 'Game created. Share the invite link to add players.'); } catch (err) { toast(err.message, true); } };
}

async function viewGame(gid) {
  const { game: g, rankings } = await api('/api/games/' + gid);
  const s = g.settings, link = `${location.origin}${location.pathname}#/games/${g.id}`;
  app.innerHTML = `<div class="view"><div class="page-head"><div><a href="#/games" class="small">‹ Games</a><h1>${esc(s.name)}</h1><div class="muted">${esc(s.description)}</div></div>
    <div class="row">${g.joined ? (g.id !== state.gameId ? `<button class="btn" id="use">Make active</button>` : '<span class="badge live">Active game</span>') : `<button class="btn" id="join">Join game</button>`}
      ${g.joined && !g.isOwner && !g.sandbox ? '<button class="btn secondary" id="leave">Leave</button>' : ''}</div></div>
    <div class="grid g4" style="margin-bottom:var(--gap)">${[['Players', g.players], ['Starting cash', money(s.startingCash)], ['Starts', g.sandbox ? '—' : s.startDate], ['Ends', g.sandbox ? '—' : s.endDate || 'No end date']].map(([l, v]) => `<div class="card stat"><div class="label">${l}</div><div class="value" style="font-size:1.15rem">${v}</div></div>`).join('')}</div>
    <div class="grid g2"><div class="card"><div class="card-head"><h2>Rankings</h2><span class="muted small">Live</span></div><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Player</th><th class="r">Account value</th><th class="r">Return</th></tr></thead><tbody>
      ${rankings.map(r => `<tr class="${s.showPortfolios || r.userId === state.me.id ? 'link' : ''}" ${s.showPortfolios || r.userId === state.me.id ? `data-go="#/portfolio${r.userId === state.me.id ? '' : '?player=' + r.playerId}"` : ''}><td><span class="rank r${r.rank}">${r.rank}</span></td><td><b>${esc(r.name)}</b>${r.userId === state.me.id ? ' <span class="badge">You</span>' : ''}</td><td class="r">${money(r.equity)}</td><td class="r ${cls(r.gain)}">${pct(r.gainPct)}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="stack">${!g.sandbox ? `<div class="card"><h3>Invite players</h3><p class="muted small">Share this link${g.hasPassword ? ' and the game password' : ''}.</p><div class="row" style="flex-wrap:nowrap"><input value="${esc(link)}" readonly id="lnk"><button class="btn secondary sm" id="copy">Copy</button></div><div class="hint">Game ID: ${g.id}</div></div>` : ''}
        <div class="card small"><h3 style="margin-bottom:6px">Rules</h3><div class="muted">Commission ${s.commission ? (s.commissionType === 'flat' ? money(s.commission) : s.commission + '%') : 'free'} · Short selling ${s.allowShort ? 'on' : 'off'} · Margin ${s.allowMargin ? 'on' : 'off'} · Late entry ${s.allowLateEntry ? 'on' : 'off'} · Resets ${s.allowReset ? 'on' : 'off'} · ${s.privacy === 'public' ? 'Public' : 'Private'}</div></div></div></div>
    ${g.isOwner ? `<h2 style="margin:32px 0 14px">Game settings</h2><form id="sf" class="grid g-half">${settingsForm(s, g.sandbox)}<div class="card" style="align-self:start"><button class="btn block">Save settings</button>${!g.sandbox ? '<button type="button" class="btn danger block" id="del" style="margin-top:10px">Delete game</button>' : ''}</div></form>` : ''}</div>`;
  $('#use')?.addEventListener('click', () => { $('#gameSelect').value = g.id; $('#gameSelect').dispatchEvent(new Event('change')); });
  $('#join')?.addEventListener('click', () => joinGame(g.id, g.hasPassword));
  $('#copy')?.addEventListener('click', () => { navigator.clipboard.writeText(link).then(() => toast('Link copied.')); });
  $('#leave')?.addEventListener('click', async () => { await api(`/api/games/${g.id}/leave`, { method: 'POST' }); state.gameId = null; await loadGames(); location.hash = '#/games'; });
  $('#sf')?.addEventListener('submit', async e => { e.preventDefault(); try { await api('/api/games/' + g.id, { method: 'PATCH', body: readForm(e.target) }); await loadGames(); toast('Settings saved.'); route(); } catch (err) { toast(err.message, true); } });
  $('#del')?.addEventListener('click', () => modal(`<h2>Delete “${esc(s.name)}”?</h2><p class="muted">Every player’s portfolio in this game is removed. This can’t be undone.</p><div class="actions"><button class="btn secondary" data-x>Cancel</button><button class="btn danger" data-ok>Delete</button></div>`, (el, close) => {
    $('[data-x]', el).onclick = close;
    $('[data-ok]', el).onclick = async () => { await api('/api/games/' + g.id, { method: 'DELETE' }); close(); state.gameId = null; await loadGames(); location.hash = '#/games'; };
  }));
}

// ---------- settings ----------
function viewSettings() {
  const p = prefs();
  const seg = (k, opts) => `<div class="seg" data-k="${k}">${opts.map(([v, t]) => `<button type="button" data-v="${v}" class="${(p[k] ?? opts[0][0]) === v ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  const sw = (k, t, d, def = true) => `<label class="switch"><div><div class="t">${t}</div><div class="d">${d}</div></div><input type="checkbox" data-k="${k}" ${(p[k] ?? def) ? 'checked' : ''}></label>`;
  app.innerHTML = `<div class="view"><div class="page-head"><h1>Settings</h1></div><div class="grid g-half">
    <div class="card stack"><h2>Appearance</h2>
      <div><div class="muted small" style="font-weight:600;margin-bottom:6px">Theme</div>${seg('theme', [['system', 'Automatic'], ['light', 'Light'], ['dark', 'Dark']])}</div>
      <div><div class="muted small" style="font-weight:600;margin-bottom:6px">Accent color</div>${seg('accent', [['blue', 'Blue'], ['green', 'Green'], ['purple', 'Purple'], ['orange', 'Orange'], ['pink', 'Pink'], ['graphite', 'Graphite']])}</div>
      <div><div class="muted small" style="font-weight:600;margin-bottom:6px">Gain / loss colors</div>${seg('colors', [['standard', 'Green up'], ['classic', 'High contrast'], ['inverted', 'Red up']])}</div>
      <div><div class="muted small" style="font-weight:600;margin-bottom:6px">Density</div>${seg('density', [['comfortable', 'Comfortable'], ['compact', 'Compact']])}</div>
    </div>
    <div class="card"><h2 style="margin-bottom:6px">Trading &amp; data</h2>
      ${sw('confirmTrades', 'Confirm before placing orders', 'Show a review sheet before each trade.')}
      ${sw('showDayChange', 'Show today’s change', 'Display daily gain/loss on the dashboard.')}
      ${sw('compactNumbers', 'Compact numbers', 'Show $1.2M instead of $1,200,000.00.', false)}
      <label class="field" style="margin-top:12px"><span>Default chart range</span><select data-k="defaultRange">${['1D', '5D', '1M', '6M', 'YTD', '1Y', '5Y'].map(r => `<option ${p.defaultRange === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label class="field" style="margin-top:12px"><span>Default game</span><select data-k="defaultGame"><option value="">Last used</option>${state.games.mine.map(g => `<option value="${g.id}" ${p.defaultGame === g.id ? 'selected' : ''}>${esc(g.settings.name)}</option>`).join('')}</select></label>
    </div>
    <div class="card"><h2 style="margin-bottom:10px">Account</h2><div class="row"><div class="avatar" style="width:48px;height:48px;font-size:1.2rem;display:grid;place-items:center;background-image:${state.me.picture ? `url('${esc(state.me.picture)}')` : 'none'}">${state.me.picture ? '' : esc(state.me.name[0])}</div><div><b>${esc(state.me.name)}</b><div class="muted small">${esc(state.me.email || 'Offline account')}</div><div class="muted small">${store.mode === 'firebase' ? 'Signed in with Google' : 'Offline mode (this browser only)'}</div></div></div></div>
  </div></div>`;
  $$('.seg[data-k]').forEach(sg => $$('button', sg).forEach(b => b.onclick = async () => { $$('button', sg).forEach(x => x.classList.toggle('on', x === b)); await savePrefs({ [sg.dataset.k]: b.dataset.v }); }));
  $$('input[data-k]').forEach(i => i.onchange = () => savePrefs({ [i.dataset.k]: i.checked }).then(() => toast('Saved.')));
  $$('select[data-k]').forEach(i => i.onchange = () => savePrefs({ [i.dataset.k]: i.value || null }).then(() => toast('Saved.')));
}

// ---------- router ----------
async function route() {
  state.timers.forEach(clearInterval); state.timers = [];
  if (!state.me) { try { state.me = (await api('/api/me')).user; } catch {} }
  if (!state.me) return viewSignIn();
  applyPrefs(); renderShell();
  if (!state.games.mine.length) await loadGames();
  setActiveTab(); window.scrollTo({ top: 0 });
  const [path, qs] = location.hash.slice(1).split('?');
  const q = new URLSearchParams(qs || '');
  try {
    if (!path || path === '/') await viewDashboard();
    else if (path === '/portfolio') await viewPortfolio(q);
    else if (path === '/trade') await viewTrade(q);
    else if (path === '/research') await viewResearch(q);
    else if (path === '/watchlist') await viewWatchlist();
    else if (path === '/games') await viewGames();
    else if (path === '/games/new') viewCreateGame();
    else if (path.startsWith('/games/')) await viewGame(path.split('/')[2]);
    else if (path === '/settings') viewSettings();
    else location.hash = '#/';
  } catch (e) { app.innerHTML = `<div class="card empty view">${esc(e.message)}<br><a href="#/" class="btn sm" style="margin-top:12px">Go to dashboard</a></div>`; }
}
window.addEventListener('hashchange', route);
route();
