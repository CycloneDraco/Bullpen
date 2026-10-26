// Bullpen front end — vanilla JS single-page app with hash routing.
import { api as backend, store, signIn, signInEmail, signUpEmail, resetPassword, signOut, account } from './backend.js';
import CONFIG from './config.js';
import { tvSymbol, isCrypto } from './backend.js';
import * as F from './features.js';
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

// ---------- avatars ----------
const AVATAR_COLORS = ['#0a84ff', '#30d158', '#ff9f0a', '#ff375f', '#bf5af2', '#5ac8fa', '#a2845e', '#8e8e93'];
function avatarHtml(u, size = 32) {
  const st = `width:${size}px;height:${size}px;font-size:${Math.round(size * 0.42)}px`;
  return u?.picture
    ? `<img class="av" src="${esc(u.picture)}" alt="" style="${st}" referrerpolicy="no-referrer">`
    : `<span class="av" style="${st};background:${esc(u?.color || AVATAR_COLORS[0])}" aria-hidden="true">${esc((u?.name || '?').trim()[0]?.toUpperCase() || '?')}</span>`;
}
// Crop to a centred square and shrink, so a photo fits comfortably in a Firestore document.
function squareImage(file, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'), k = Math.min(img.width, img.height);
      c.width = c.height = size;
      c.getContext('2d').drawImage(img, (img.width - k) / 2, (img.height - k) / 2, k, k, 0, 0, size, size);
      URL.revokeObjectURL(img.src);
      let out = c.toDataURL('image/jpeg', 0.85);
      if (out.length > 140000) out = c.toDataURL('image/jpeg', 0.6);
      resolve(out);
    };
    img.onerror = () => reject(new Error('That file isn’t an image we can read.'));
    img.src = URL.createObjectURL(file);
  });
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
  $$('#side a').forEach(a => { const p = a.getAttribute('href').slice(1); a.classList.toggle('active', p === '/' ? h === '/' : h.startsWith(p)); });
}
async function loadGames() {
  state.games = await api('/api/games');
  const ids = state.games.mine.map(g => g.id);
  let saved; try { saved = localStorage.getItem('bp_game'); } catch {}
  // The choice is kept per device and on the account, so it sticks across reloads and devices.
  state.gameId = [state.gameId, saved, prefs().lastGame, prefs().defaultGame].find(x => ids.includes(x)) || ids[0];
  renderGamePicker();
}
const activeGame = () => state.games.mine.find(g => g.id === state.gameId);
const CHEVRON = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
function renderGamePicker() {
  const g = activeGame();
  $('#gamePickBtn').innerHTML = `<span class="gp-name">${esc(g?.settings.name || 'No game')}</span>${g?.sandbox ? '<span class="badge">Practice</span>' : ''}${CHEVRON}`;
  $('#gameMenu').innerHTML = state.games.mine.map(x => `<button type="button" role="option" aria-selected="${x.id === state.gameId}" data-g="${x.id}">
      <span class="gp-check" aria-hidden="true">${x.id === state.gameId ? '✓' : ''}</span><span class="gp-name">${esc(x.settings.name)}</span>${x.sandbox ? '<span class="badge">Practice</span>' : `<span class="muted small">${x.players} player${x.players === 1 ? '' : 's'}</span>`}</button>`).join('')
    + '<a href="#/games" class="gp-all">Browse all games</a>';
  $$('#gameMenu [data-g]').forEach(b => b.onclick = () => switchGame(b.dataset.g));
}
function switchGame(id) {
  if (!state.games.mine.some(g => g.id === id)) return;
  state.gameId = id;
  try { localStorage.setItem('bp_game', id); } catch {}
  savePrefs({ lastGame: id }).catch(() => {});
  $('#gameMenu').hidden = true; $('#gamePickBtn').setAttribute('aria-expanded', 'false');
  renderGamePicker(); toast(`Switched to ${activeGame().settings.name}.`); route();
}
$('#gamePickBtn').addEventListener('click', e => { e.stopPropagation(); const m = $('#gameMenu'); m.hidden = !m.hidden; $('#gamePickBtn').setAttribute('aria-expanded', String(!m.hidden)); });
document.addEventListener('click', e => { if (!e.target.closest('.game-pick')) { $('#gameMenu').hidden = true; $('#gamePickBtn').setAttribute('aria-expanded', 'false'); } });
// Sidebar: beside the page on wide screens (remembered), a drawer on narrow ones.
const wide = matchMedia('(min-width: 1000px)');
function setSide(open, remember) {
  document.body.classList.toggle('side-open', open);
  const t = $('#sideToggle'); t.setAttribute('aria-expanded', open); t.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  if (remember && wide.matches) try { localStorage.setItem('bp_side', open ? 'open' : 'closed'); } catch {}
  if (open && !wide.matches) $('#side a.active, #side a')?.focus({ preventScroll: true });
}
function initSide() { let saved; try { saved = localStorage.getItem('bp_side'); } catch {} setSide(wide.matches && saved !== 'closed'); }
$('#sideToggle').addEventListener('click', () => setSide(!document.body.classList.contains('side-open'), true));
$('#sideScrim').addEventListener('click', () => setSide(false));
$('#side').addEventListener('click', e => { if (e.target.closest('a') && !wide.matches) setSide(false); });
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !wide.matches && document.body.classList.contains('side-open')) { setSide(false); $('#sideToggle').focus(); }
  if (e.key === '[' && state.me && !e.target.closest('input, textarea, select') && !e.metaKey && !e.ctrlKey) setSide(!document.body.classList.contains('side-open'), true);
});
wide.addEventListener('change', initSide);
let shellMounted = false;
function renderShell() {
  $('#nav').hidden = false; $('#side').hidden = false;
  $('#adminLink').hidden = !state.me.admin;
  if (!shellMounted) initSide();
  if (!shellMounted) {
    shellMounted = true; F.mountBell(); F.mountShortcuts();
    // Global search: look up any symbol without leaving to trade.
    const gs = $('#gsearch');
    symbolSearch(gs, sym => { gs.value = ''; gs.blur(); location.hash = '#/research?symbol=' + encodeURIComponent(sym); }); $('#kbdHelp').onclick = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })); }
  const u = state.me, av = $('#avatarBtn');
  av.innerHTML = avatarHtml(u, 32);
  av.setAttribute('aria-label', 'Account: ' + u.name);
  $('#menuHead').innerHTML = `<div class="row" style="flex-wrap:nowrap">${avatarHtml(u, 36)}<div style="min-width:0"><b>${esc(u.name)}</b><div class="muted" style="overflow:hidden;text-overflow:ellipsis">${esc(u.email || 'Offline account')}</div></div></div>`;
}
$('#avatarBtn').addEventListener('click', e => { e.stopPropagation(); $('#avatarMenu').hidden = !$('#avatarMenu').hidden; });
document.addEventListener('click', () => { $('#avatarMenu').hidden = true; });
$('#signOut').addEventListener('click', async () => { await signOut(); state.me = null; state.games = { mine: [], public: [] }; route(); });

// ---------- sign in ----------
function viewSignIn() {
  $('#nav').hidden = true; $('#side').hidden = true; document.body.classList.remove('side-open');
  const google = store.mode === 'firebase';
  app.innerHTML = `<section class="hero view"><div class="hero-card">
    <img src="icon.svg" width="72" height="72" alt="">
    <h1>Trade the real market.<br>Risk nothing.</h1>
    <p>Practice investing with $100,000 in virtual cash, live market prices, and games against friends.</p>
    <div class="signin-box">
      ${google ? `<button class="btn block" id="gbtn" style="max-width:320px"><svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true"><path fill="#fff" d="M44.5 20H24v8.5h11.8C34.7 33.9 30.1 37 24 37c-7.2 0-13-5.8-13-13s5.8-13 13-13c3.1 0 5.9 1.1 8.1 2.9l6.4-6.4C34.6 4.1 29.6 2 24 2 11.8 2 2 11.8 2 24s9.8 22 22 22c11 0 21-8 21-22 0-1.3-.2-2.7-.5-4z"/></svg>Continue with Google</button>
        <div class="or">or use email</div>
        <form id="email" class="stack" style="width:100%;max-width:320px;text-align:left" novalidate>
          <div class="seg full" id="emode"><button type="button" data-v="in" class="on">Sign in</button><button type="button" data-v="up">Create account</button></div>
          <label class="field" data-up hidden><span>Name</span><input name="name" autocomplete="name" placeholder="Shown in game rankings"></label>
          <label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label>
          <label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" minlength="6" required><div class="hint" data-up hidden>At least 6 characters.</div></label>
          <button class="btn block" id="esubmit">Sign in</button>
          <button type="button" class="btn ghost" id="forgot" style="align-self:center">Forgot password?</button>
        </form>`
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
  const authError = e => ({
    'auth/invalid-credential': 'Wrong email or password.', 'auth/wrong-password': 'Wrong email or password.', 'auth/user-not-found': 'No account with that email. Create one instead.',
    'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.', 'auth/weak-password': 'Use a password with at least 6 characters.',
    'auth/invalid-email': 'That email address doesn’t look right.', 'auth/missing-password': 'Enter your password.', 'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.',
    'auth/operation-not-allowed': 'Email sign-in isn’t turned on yet. Enable Email/Password in Firebase → Authentication → Sign-in method.',
  }[e.code] || e.message);
  const ef = $('#email');
  if (ef) {
    let mode = 'in';
    $$('#emode button').forEach(b => b.onclick = () => {
      mode = b.dataset.v;
      $$('#emode button').forEach(x => x.classList.toggle('on', x === b));
      $$('[data-up]', ef).forEach(x => x.hidden = mode !== 'up');
      ef.password.autocomplete = mode === 'up' ? 'new-password' : 'current-password';
      $('#esubmit').textContent = mode === 'up' ? 'Create account' : 'Sign in';
      $('#forgot').hidden = mode === 'up';
    });
    ef.addEventListener('submit', async e => {
      e.preventDefault();
      const email = ef.email.value.trim(), pw = ef.password.value, name = ef.name.value.trim();
      if (mode === 'up' && !name) return toast('Enter your name.', true);
      const btn = $('#esubmit'); btn.disabled = true;
      try { mode === 'up' ? await signUpEmail(name, email, pw) : await signInEmail(email, pw); await done(); }
      catch (err) { toast(authError(err), true); btn.disabled = false; }
    });
    $('#forgot').onclick = async () => {
      const email = ef.email.value.trim();
      if (!email) return toast('Type your email above first.', true);
      try { await resetPassword(email); toast(`If ${email} has an account, a reset link is on its way.`); } catch (err) { toast(authError(err), true); }
    };
  }
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
      <div class="card"><div class="stat"><div class="label">Account value</div></div><div class="big" id="acct">—</div><div id="acctChg" style="margin:6px 0 14px"></div>${perfSeg('perfRange')}<div id="perf" style="margin-top:10px"></div><div class="chart-tip" id="perfTip"></div>
        <div class="grid g3" style="margin-top:14px" id="acctStats"></div></div>
      <div class="card"><div class="card-head"><h2>Watchlist</h2><a href="#/watchlist" class="small">Edit</a></div><div id="wl"></div></div>
    </div>
    <div class="grid g-half" style="margin-top:var(--gap)">
      <div class="card"><div class="card-head"><h2>Top holdings</h2><a href="#/portfolio" class="small">See all</a></div><div id="top"></div></div>
      <div class="card"><div class="card-head"><h2>Market movers</h2><span class="muted small">Large caps</span></div><div id="movers"></div></div>
    </div>
    <div class="card" style="margin-top:var(--gap)"><div class="card-head"><h2>Market news</h2><span class="muted small">Live headlines</span></div><div id="news"></div></div></div>`;
  F.renderNews($('#news'), '', 6);
  F.checkBadges();
  const load = async () => {
    const [m, pf, wl] = await Promise.all([api('/api/market'), api(`/api/games/${g.id}/portfolio`), api('/api/watchlist')]);
    $('#mkt').innerHTML = `<span class="badge ${m.open ? 'live' : 'closed'}">${m.open ? 'Market open' : 'Market closed'}</span>`;
    const names = { SPY: 'S&P 500 · SPY', DIA: 'Dow Jones · DIA', QQQ: 'Nasdaq 100 · QQQ', IWM: 'Russell 2000 · IWM', 'BTC-USD': 'Bitcoin · BTC' };
    $('#indices').innerHTML = Object.entries(names).map(([s, n]) => { const q = m.indices[s]; return `<a class="card" href="#/research?symbol=${encodeURIComponent(s)}"><div class="muted small">${n}</div><div class="num" style="font-weight:650;font-size:1.1rem;color:var(--ink)">${q ? q.price.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</div><div class="small ${cls(q?.change)}">${q ? pct(q.changePct) : ''}</div></a>`; }).join('');
    $('#acct').textContent = money(pf.equity, { full: true });
    $('#acctChg').innerHTML = `${chip(pf.totalGain, `${signed(pf.totalGain)} (${pct(pf.totalGainPct)})`)} <span class="muted small">all time</span>${prefs().showDayChange !== false ? ` &nbsp;${chip(pf.dayChange, signed(pf.dayChange))} <span class="muted small">today</span>` : ''}`;
    $('#acctStats').innerHTML = [['Buying power', pf.buyingPower], ['Cash', pf.cash], ['Holdings', pf.longValue - pf.shortValue]].map(([l, v]) => `<div class="stat"><div class="label">${l}</div><div class="value">${money(v)}</div></div>`).join('');
    const drawPerf = () => { const sn = perfSnaps(pf, g); lineChart($('#perf'), sn, { tip: $('#perfTip'), baseline: sn[0][1] }); };
    drawPerf(); bindPerf('perfRange', drawPerf);
    $('#wl').innerHTML = quoteList(wl.symbols.map(s => wl.quotes[s]).filter(Boolean));
    $('#movers').innerHTML = quoteList(Object.values(m.movers).sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct)).slice(0, 6));
    const top = [...pf.holdings].sort((a, b) => Math.abs(b.value) - Math.abs(a.value)).slice(0, 5);
    $('#top').innerHTML = top.length ? quoteList(top.map(h => ({ symbol: h.symbol, name: `${F.qtyFmt(h.qty)} ${h.type === 'CRYPTO' ? 'coins' : 'shares'} · ${money(h.value)}`, price: h.price, changePct: h.gainPct }))) : `<div class="empty">No holdings yet.<br><a href="#/trade" class="btn sm" style="margin-top:12px">Make your first trade</a></div>`;
  };
  await load(); every(20000, () => load().catch(() => {}));
}
// Account value over a chosen range (snapshots are daily).
const PERF_RANGES = [['1W', 7], ['1M', 30], ['3M', 91], ['YTD', 'ytd'], ['1Y', 365], ['All', 0]];
let perfRange = (() => { try { return localStorage.getItem('bp_perf') || 'All'; } catch { return 'All'; } })();
function perfSnaps(pf, g) {
  const snaps = Object.entries(pf.snapshots).sort().map(([d, v]) => [new Date(d + 'T16:00:00').getTime(), v]);
  snaps.unshift([(g.created || Date.now()) - 864e5, g.settings.startingCash]);
  const span = PERF_RANGES.find(x => x[0] === perfRange)?.[1];
  const from = span === 'ytd' ? new Date(new Date().getFullYear(), 0, 1).getTime() : span ? Date.now() - span * 864e5 : 0;
  const cut = snaps.filter(p => p[0] >= from);
  return cut.length >= 2 ? cut : snaps.slice(-2);
}
const perfSeg = id => `<div class="seg seg-sm" id="${id}" role="group" aria-label="Chart range">${PERF_RANGES.map(([k]) => `<button type="button" data-r="${k}" class="${k === perfRange ? 'on' : ''}">${k}</button>`).join('')}</div>`;
function bindPerf(id, draw) {
  $$(`#${id} button`).forEach(b => b.onclick = () => {
    perfRange = b.dataset.r; try { localStorage.setItem('bp_perf', perfRange); } catch {}
    $$(`#${id} button`).forEach(x => x.classList.toggle('on', x === b)); draw();
  });
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
    <div class="grid g4">${[['Account value', money(pf.equity)], ['Today', `<span class="${cls(pf.dayChange)}">${signed(pf.dayChange)}</span>`], ['Total return', `<span class="${cls(pf.totalGain)}">${signed(pf.totalGain)} <span class="small">${pct(pf.totalGainPct)}</span></span>`], ['Buying power', money(pf.buyingPower)], ['Cash', money(pf.cash)], ['Long value', money(pf.longValue)], ['Short value', money(pf.shortValue)], ['Positions', pf.holdings.length + (pf.options || []).length], ...(pf.unsettled > 0.005 ? [['Unsettled cash', `${money(pf.unsettled)} <span class="small muted">usable next trading day</span>`]] : [])].map(([l, v]) => `<div class="card stat"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('')}</div>
    <div class="card" style="margin-top:var(--gap)">
      <div class="card-head"><div class="seg">${['holdings', ...(own ? ['orders'] : []), 'history', 'performance', 'analytics'].map(t => `<button data-t="${t}" class="${t === tab ? 'on' : ''}">${{ holdings: 'Holdings', orders: `Open orders (${pf.orders.length})`, history: 'Trade history', performance: 'Performance', analytics: 'Analytics' }[t]}</button>`).join('')}</div></div>
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
      ${rows.map(h => `<tr class="link" data-go="#/research?symbol=${encodeURIComponent(h.symbol)}"><td><div class="sym">${esc(h.symbol)}</div><div class="sym-name">${esc(h.name)}</div></td><td class="r">${F.qtyFmt(Math.abs(h.qty))}</td><td class="r">${money(h.price, { full: true })}</td><td class="r ${cls(h.dayChangePct)}">${pct(h.dayChangePct)}</td><td class="r">${money(h.avg, { full: true })}</td><td class="r">${money(Math.abs(h.value))}</td><td class="r ${cls(h.gain)}">${signed(h.gain)}<div class="small">${pct(h.gainPct)}</div></td>${own ? `<td class="r"><a class="btn sm secondary" href="#/trade?symbol=${encodeURIComponent(h.symbol)}&action=${short ? 'cover' : 'sell'}&qty=${Math.abs(h.qty)}">${short ? 'Cover' : 'Sell'}</a></td>` : ''}</tr>`).join('')}</tbody></table></div>`;
    const opts = pf.options || [];
    const optTbl = opts.length ? `<h3 style="margin:22px 0 6px">Options</h3><div class="table-wrap"><table><thead><tr><th>Contract</th><th class="r">Contracts</th><th class="r">Underlying</th><th class="r">Mark</th><th class="r">Avg price</th><th class="r">Delta</th><th class="r">Value</th><th class="r">Gain / loss</th>${own ? '<th></th>' : ''}</tr></thead><tbody>
      ${opts.map(h => `<tr><td><div class="sym">${esc(h.name)}</div><div class="sym-name">${h.qty > 0 ? 'Long' : 'Written'} · expires ${h.exp}</div></td><td class="r">${h.qty}</td><td class="r">${money(h.underlying, { full: true })}</td><td class="r">${money(h.price, { full: true })}</td><td class="r">${money(h.avg, { full: true })}</td><td class="r">${h.delta == null ? '—' : (h.delta * Math.sign(h.qty)).toFixed(2)}</td><td class="r">${signed(h.value)}</td><td class="r ${cls(h.gain)}">${signed(h.gain)}<div class="small">${pct(h.gainPct)}</div></td>${own ? `<td class="r"><a class="btn sm secondary" href="#/trade?asset=option&key=${encodeURIComponent(h.key)}&action=${h.qty > 0 ? 'stc' : 'btc'}&qty=${Math.abs(h.qty)}">Close</a></td>` : ''}</tr>`).join('')}</tbody></table></div>` : '';
    pane.innerHTML = (longs.length ? `<h3 style="margin:6px 0">Stocks &amp; ETFs</h3>${tbl(longs)}` : '') + (shorts.length ? `<h3 style="margin:22px 0 6px">Short positions</h3>${tbl(shorts, true)}` : '') + optTbl + (!pf.holdings.length && !opts.length ? '<div class="empty">No positions yet.</div>' : '');
  }
  if (tab === 'orders') {
    pane.innerHTML = pf.orders.length ? `${pf.marketOpen ? '' : '<p class="muted small">The market is closed. Market orders will fill at the next open.</p>'}<div class="table-wrap"><table><thead><tr><th>Placed</th><th>Symbol</th><th>Action</th><th class="r">Qty</th><th>Type</th><th>Duration</th><th></th></tr></thead><tbody>
      ${pf.orders.map(o => `<tr><td>${when(o.created)}</td>${tradeCells(o)}<td class="r">${o.qty}</td><td>${orderDesc(o)}</td><td>${o.duration === 'gtc' ? 'Good ’til cancelled' : 'Day'}${o.notBefore > Date.now() ? `<div class="muted small">Executes after ${new Date(o.notBefore).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</div>` : ''}</td><td class="r"><button class="btn sm danger" data-cancel="${o.id}">Cancel</button></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No open orders.</div>';
    $$('[data-cancel]', pane).forEach(b => b.onclick = async () => { await api(`/api/games/${g.id}/orders/${b.dataset.cancel}`, { method: 'DELETE' }); toast('Order cancelled.'); route(); });
  }
  if (tab === 'history') {
    pane.innerHTML = pf.history.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Symbol</th><th>Action</th><th class="r">Qty</th><th>Type</th><th class="r">Price</th><th class="r">Fee</th><th>Status</th></tr></thead><tbody>
      ${pf.history.map(o => `<tr><td>${when(o.filledAt || o.created)}</td>${tradeCells(o)}<td class="r">${o.qty}</td><td>${orderDesc(o)}</td><td class="r">${o.fillPrice ? money(o.fillPrice, { full: true }) : '—'}</td><td class="r">${o.fee ? money(o.fee) : '—'}</td><td><span class="badge ${o.status === 'filled' ? 'live' : ''}" title="${esc(o.reason || '')}">${o.status}</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">No trades yet.</div>';
  }
  if (tab === 'analytics') F.renderAnalytics(pane, pf, g);
  if (tab === 'performance') {
    pane.innerHTML = `${perfSeg('pRange')}<div id="pchart" style="margin-top:10px"></div><div class="chart-tip" id="ptip"></div>`;
    const drawP = () => { const sn = perfSnaps(pf, g); lineChart($('#pchart'), sn, { tip: $('#ptip'), baseline: sn[0][1], tall: true }); };
    drawP(); bindPerf('pRange', drawP);
  }
}
const ACTION_LABEL = { buy: 'Buy', sell: 'Sell', short: 'Short', cover: 'Cover', bto: 'Buy to open', stc: 'Sell to close', sto: 'Sell to open', btc: 'Buy to close' };
const tradeCells = o => `<td class="sym">${esc(o.asset === 'option' ? o.desc : o.symbol)}</td><td>${ACTION_LABEL[o.action] || o.action}</td>`;
const orderDesc = o => o.type === 'dividend' ? `${o.qty} day${o.qty > 1 ? 's' : ''} of dividends` : ({ market: 'Market', limit: `Limit ${money(o.limitPrice, { full: true })}`, stop: `Stop ${money(o.stopPrice, { full: true })}`, trailing: `Trailing ${o.trailUnit === '$' ? money(o.trail) : o.trail + '%'}` }[o.type]);

// ---------- trade ----------
const assetSwitch = (asset, s) => s.allowOptions ? `<div class="seg">${[['stock', 'Stocks, ETFs &amp; crypto', '#/trade'], ['option', 'Options', '#/trade?asset=option'], ['strategy', 'Strategies', '#/trade?asset=strategy']].map(([k, t, h]) => `<button type="button" class="${asset === k ? 'on' : ''}" onclick="location.hash='${h}'">${t}</button>`).join('')}</div>` : '';
async function viewTrade(q) {
  if (q.get('asset') === 'option') return viewTradeOptions(q);
  if (q.get('asset') === 'strategy') return F.viewStrategy(q, assetSwitch('strategy', activeGame().settings));
  const g = activeGame(), s = g.settings;
  const f = { symbol: (q.get('symbol') || '').toUpperCase(), action: q.get('action') || 'buy', qty: q.get('qty') || '', type: 'market', duration: 'day', limitPrice: '', stopPrice: '', trail: '', trailUnit: '%' };
  const actions = ['buy', 'sell', ...(s.allowShort ? ['short', 'cover'] : [])];
  const types = ['market', ...(s.allowLimit ? ['limit'] : []), ...(s.allowStop ? ['stop'] : []), ...(s.allowTrailing ? ['trailing'] : [])];
  app.innerHTML = `<div class="view"><div class="page-head"><div><div class="muted small">${esc(s.name)}</div><h1>Trade</h1></div>${assetSwitch('stock', s)}</div>
    <div class="grid g2"><form class="card stack" id="tf" autocomplete="off">
      <label class="field"><span>Symbol</span><div><input name="symbol" placeholder="Search a company or ticker" value="${esc(f.symbol)}"></div></label>
      <div id="quote"></div>
      <div class="field"><span class="muted small" style="font-weight:600">Action</span><div class="seg full" id="act">${actions.map(a => `<button type="button" data-v="${a}">${a[0].toUpperCase() + a.slice(1)}</button>`).join('')}</div></div>
      <div class="form-grid">
        <label class="field"><span>Quantity</span><input name="qty" type="number" min="1" step="1" inputmode="decimal" value="${esc(f.qty)}" placeholder="0"><div class="hint" id="maxq"></div></label>
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
    const raw = Math.max(0, pf.buyingPower - (s.commissionType === 'flat' ? s.commission : 0)) / (price * (1 + (s.commissionType === 'percent' ? s.commission / 100 : 0)));
    const max = f.action === 'sell' ? Math.max(0, held) : f.action === 'cover' ? Math.max(0, -held) : isCrypto(quote.symbol) ? Math.floor(raw * 1e6) / 1e6 : Math.floor(raw);
    $('#maxq').innerHTML = `Max: <a href="#" id="maxset">${F.qtyFmt(max)}</a>${isCrypto(quote.symbol) ? ' · fractions allowed, 24/7' : ''}`;
    $('#maxset').onclick = e => { e.preventDefault(); form.qty.value = max; estimate(); };
    $('#est').innerHTML = qty ? `Estimated ${f.action === 'sell' || f.action === 'short' ? 'proceeds' : 'cost'}: <b class="num" style="color:var(--ink)">${money(amt, { full: true })}</b>${fee ? ` + ${money(fee)} commission` : ''}` : '';
  }
  async function loadQuote(sym) {
    f.symbol = sym; form.symbol.value = sym;
    form.qty.step = isCrypto(sym) ? 'any' : '1'; form.qty.min = isCrypto(sym) ? '0' : '1';
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
        F.checkBadges();
        toast(r.filled ? `${o.action[0].toUpperCase() + o.action.slice(1)} ${F.qtyFmt(o.qty)} ${o.symbol} filled at ${money(r.order.fillPrice, { full: true })}` : r.delayed ? `Order placed. It executes in about ${activeGame().settings.executionDelay} min at the market price then.` : r.marketOpen ? 'Order placed. It will fill when its price is reached.' : 'Order placed. It will fill when the market opens.');
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
  $('#acct').innerHTML = `<h3>Your account</h3><div class="grid" style="grid-template-columns:1fr 1fr;margin-top:10px">${[['Account value', pf.equity], ['Buying power', pf.buyingPower], ['Cash', pf.cash], ['Positions', null]].map(([l, v]) => `<div class="stat"><div class="label">${l} </div><div class="value" style="font-size:1.1rem">${v == null ? pf.holdings.length + (pf.options || []).length : money(v)}</div></div>`).join('')}</div><div style="margin-top:10px"><span class="badge ${pf.marketOpen ? 'live' : 'closed'}">${pf.marketOpen ? 'Market open' : 'Market closed'}</span></div>`;
  $('#rules').innerHTML = `<h3 style="color:var(--ink);margin-bottom:6px">Game rules</h3>Commission: ${s.commission ? (s.commissionType === 'flat' ? money(s.commission) + ' per trade' : s.commission + '% of trade') : 'none'}<br>Short selling: ${s.allowShort ? `on (min ${money(s.minShortPrice)})` : 'off'}<br>Margin: ${s.allowMargin ? `on (${s.marginInterest}% interest)` : 'off'}<br>${s.minStockPrice ? `Min. stock price: ${money(s.minStockPrice)}<br>` : ''}${s.maxPositionPct < 100 ? `Max position: ${s.maxPositionPct}% of portfolio<br>` : ''}${s.dailyTradeLimit ? `Daily trade limit: ${s.dailyTradeLimit}<br>` : ''}ETFs: ${s.allowEtf ? 'allowed' : 'not allowed'}<br>Options: ${s.allowOptions ? (s.allowOptionWriting ? 'buy and write' : 'buy only') : 'off'}${s.executionDelay ? `<br>Execution delay: ${s.executionDelay} min on ${s.delayApplies === 'all' ? 'every order' : 'sells'}` : ''}${s.settleT1 ? '<br>Sale proceeds settle next trading day' : ''}`;
  if (f.symbol) loadQuote(f.symbol); else form.symbol.focus();
}

// ---------- options trading ----------
async function viewTradeOptions(q) {
  const g = activeGame(), s = g.settings;
  const st = { sym: (q.get('symbol') || '').toUpperCase(), exp: q.get('exp') || '', side: 'C', key: q.get('key') || '', action: q.get('action') || 'bto', chain: null, contract: null };
  if (st.key) { const [sy, ex, ty] = st.key.split('_'); Object.assign(st, { sym: sy, exp: ex, side: ty }); }
  const head = `<div class="page-head"><div><div class="muted small">${esc(s.name)}</div><h1>Trade options</h1></div>${assetSwitch('option', s)}</div>`;
  if (!s.allowOptions) { app.innerHTML = `<div class="view">${head}<div class="card empty">Options trading is turned off in this game.</div></div>`; return; }
  const actions = [['bto', 'Buy to open'], ['stc', 'Sell to close'], ...(s.allowOptionWriting ? [['sto', 'Sell to open'], ['btc', 'Buy to close']] : [])];
  app.innerHTML = `<div class="view">${head}<div class="grid g2">
    <div class="card"><div class="row"><div style="flex:1;min-width:180px"><div><input id="osym" placeholder="Underlying, e.g. AAPL" value="${esc(st.sym)}" aria-label="Underlying symbol" autocomplete="off"></div></div>
      <select id="oexp" style="width:auto" aria-label="Expiration"></select>
      <div class="seg" id="oside"><button type="button" data-v="C">Calls</button><button type="button" data-v="P">Puts</button></div></div>
      <div id="uq" style="margin-top:12px"></div><div id="chain" style="margin-top:8px"><div class="empty">Choose a stock or ETF to see its option chain.</div></div>
      <p class="hint">Prices are modelled with Black-Scholes from the live stock price and its real 3-month volatility. One contract = 100 shares. Expired contracts settle in cash at intrinsic value.</p></div>
    <form class="card stack" id="of" autocomplete="off">
      <div id="sel" class="muted">Pick a contract from the chain.</div>
      <div class="seg full" id="oact">${actions.map(([v, t]) => `<button type="button" data-v="${v}">${t}</button>`).join('')}</div>
      <div class="form-grid">
        <label class="field"><span>Contracts</span><input name="qty" type="number" min="1" step="1" inputmode="numeric" value="${esc(q.get('qty') || '')}" placeholder="0"><div class="hint" id="omax"></div></label>
        <label class="field"><span>Order type</span><select name="type"><option value="market">Market</option>${s.allowLimit ? '<option value="limit">Limit</option>' : ''}</select></label>
        <label class="field" data-for="limit" hidden><span>Limit price (per share)</span><input name="limitPrice" type="number" step="0.01" min="0"></label>
        <label class="field"><span>Duration</span><select name="duration"><option value="day">Day only</option><option value="gtc">Good ’til cancelled</option></select></label>
      </div>
      <div id="oest" class="muted small"></div>
      <button class="btn block" id="ogo">Preview order</button>
    </form></div></div>`;
  const form = $('#of');
  let pf = null;
  const setAct = a => { st.action = actions.some(x => x[0] === a) ? a : 'bto'; $$('#oact button').forEach(b => b.classList.toggle('on', b.dataset.v === st.action)); estimate(); };
  $$('#oact button').forEach(b => b.onclick = () => setAct(b.dataset.v));
  form.type.onchange = () => { $('[data-for="limit"]').hidden = form.type.value !== 'limit'; estimate(); };
  form.addEventListener('input', estimate);
  function estimate() {
    const c = st.contract; if (!c || !pf) return;
    const buy = st.action === 'bto' || st.action === 'btc';
    const px = form.type.value === 'limit' && +form.limitPrice.value ? +form.limitPrice.value : buy ? c.ask : c.bid;
    const qty = +form.qty.value || 0, held = (pf.options || []).find(h => h.key === c.key)?.qty || 0;
    const max = st.action === 'stc' ? Math.max(0, held) : st.action === 'btc' ? Math.max(0, -held) : st.action === 'sto' ? Math.floor(pf.buyingPower / (c.underlying * 20)) : Math.floor(pf.buyingPower / (px * 100 || 1));
    $('#omax').innerHTML = `Max: <a href="#" id="omaxset">${max.toLocaleString()}</a>`;
    $('#omaxset').onclick = e => { e.preventDefault(); form.qty.value = max; estimate(); };
    $('#oest').innerHTML = qty ? `Estimated ${buy ? 'cost' : 'credit'}: <b class="num" style="color:var(--ink)">${money(qty * 100 * px, { full: true })}</b> (${qty} × 100 × ${money(px, { full: true })})${s.optionCommission ? ` + ${money(s.optionCommission * qty)} contract fees` : ''}` : '';
  }
  function select(c) {
    st.contract = c; st.key = c.key;
    $('#sel').innerHTML = `<div class="sym" style="font-size:1.1rem">${esc(c.desc)}</div><div class="small muted">Bid ${money(c.bid, { full: true })} · Ask ${money(c.ask, { full: true })} · Delta ${c.delta.toFixed(2)} · IV ${(c.iv * 100).toFixed(1)}%</div>`;
    $$('#chain tr[data-k]').forEach(r => r.classList.toggle('picked', r.dataset.k === c.key));
    estimate();
  }
  function drawChain() {
    const ch = st.chain; if (!ch) return;
    $$('#oside button').forEach(b => b.classList.toggle('on', b.dataset.v === st.side));
    const rows = st.side === 'C' ? ch.calls : ch.puts, S = ch.quote.price;
    let marked = false;
    $('#chain').innerHTML = `<div class="table-wrap"><table class="chain"><thead><tr><th>Strike</th><th class="r">Bid</th><th class="r">Ask</th><th class="r">Mid</th><th class="r">Delta</th><th class="r">IV</th></tr></thead><tbody>
      ${rows.map(c => { const line = !marked && c.strike >= S ? (marked = true, `<tr class="spot"><td colspan="6">${esc(ch.quote.symbol)} ${money(S, { full: true })}</td></tr>`) : '';
        return `${line}<tr class="link ${c.itm ? 'itm' : ''}" data-k="${esc(c.key)}"><td><b>${money(c.strike)}</b></td><td class="r">${money(c.bid, { full: true })}</td><td class="r">${money(c.ask, { full: true })}</td><td class="r">${money(c.mid, { full: true })}</td><td class="r">${c.delta.toFixed(2)}</td><td class="r">${(c.iv * 100).toFixed(1)}%</td></tr>`; }).join('')}</tbody></table></div>`;
    $$('#chain tr[data-k]').forEach(r => r.onclick = () => select(rows.find(c => c.key === r.dataset.k)));
    const pre = rows.find(c => c.key === st.key); if (pre) select(pre);
  }
  async function loadChain() {
    if (!st.sym) return;
    $('#chain').innerHTML = '<div class="skeleton" style="height:200px"></div>';
    try { st.chain = await api(`/api/options/${encodeURIComponent(st.sym)}?exp=${st.exp}`); }
    catch (e) { $('#chain').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    st.exp = st.chain.exp; $('#osym').value = st.chain.quote.symbol;
    $('#oexp').innerHTML = st.chain.expirations.map(x => `<option value="${x}" ${x === st.exp ? 'selected' : ''}>${new Date(x + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} (${Math.max(0, Math.round((Date.parse(x) - Date.now()) / 864e5))}d)</option>`).join('');
    const u = st.chain.quote;
    $('#uq').innerHTML = `<div class="row"><b>${esc(u.name)}</b><span class="spacer"></span><b class="num">${money(u.price, { full: true })}</b><span class="small ${cls(u.change)}">${pct(u.changePct)}</span><span class="badge">Volatility ${(st.chain.vol * 100).toFixed(1)}%</span></div>`;
    drawChain();
  }
  symbolSearch($('#osym'), sym => { st.sym = sym; st.exp = ''; st.key = ''; st.contract = null; loadChain(); });
  $('#oexp').onchange = e => { st.exp = e.target.value; loadChain(); };
  $$('#oside button').forEach(b => b.onclick = () => { st.side = b.dataset.v; drawChain(); });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const c = st.contract; if (!c) return toast('Pick a contract from the chain first.', true);
    const o = { asset: 'option', key: c.key, action: st.action, qty: +form.qty.value, type: form.type.value, limitPrice: +form.limitPrice.value, duration: form.duration.value };
    if (!(o.qty > 0)) return toast('Enter how many contracts.', true);
    const buy = o.action === 'bto' || o.action === 'btc', px = o.type === 'limit' ? o.limitPrice : buy ? c.ask : c.bid;
    const submit = async close => {
      try { const r = await api(`/api/games/${g.id}/orders`, { method: 'POST', body: o }); close?.();
        F.checkBadges();
        toast(r.filled ? `${ACTION_LABEL[o.action]} ${o.qty} × ${c.desc} filled at ${money(r.order.fillPrice, { full: true })}` : r.delayed ? `Order placed. It executes in about ${activeGame().settings.executionDelay} min at the market price then.` : r.marketOpen ? 'Order placed. It fills when its price is reached.' : 'Order placed. It fills when the market opens.');
        location.hash = r.filled ? '#/portfolio' : '#/portfolio?tab=orders';
      } catch (err) { toast(err.message, true); }
    };
    if (prefs().confirmTrades === false) return submit();
    modal(`<h2>Review order</h2><div class="rows">
      <div><span class="muted">Action</span><b>${ACTION_LABEL[o.action]}</b></div>
      <div><span class="muted">Contract</span><span>${esc(c.desc)}</span></div>
      <div><span class="muted">Contracts</span><span>${o.qty} (${o.qty * 100} shares)</span></div>
      <div><span class="muted">Order type</span><span>${o.type === 'limit' ? `Limit ${money(o.limitPrice, { full: true })}` : 'Market'}</span></div>
      <div><span class="muted">Estimated ${buy ? 'cost' : 'credit'}</span><b>${money(o.qty * 100 * px, { full: true })}</b></div></div>
      ${pf && !pf.marketOpen ? '<p class="small muted">The market is closed, so this order will be queued.</p>' : ''}
      <div class="actions"><button class="btn secondary" data-x>Edit</button><button class="btn ${buy ? '' : 'down'}" data-ok>Place order</button></div>`, (el, close) => {
      $('[data-x]', el).onclick = close; $('[data-ok]', el).onclick = () => submit(close);
    });
  });
  setAct(st.action);
  pf = await api(`/api/games/${g.id}/portfolio`);
  if (st.sym) loadChain(); else $('#osym').focus();
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
      <div class="chart-controls">
        <div class="seg seg-sm" id="rng" role="group" aria-label="Chart range">${TV_RANGES.map(([k]) => `<button type="button" data-r="${k}">${k}</button>`).join('')}</div>
        <label><span class="sr">Candle size</span><select id="ivl">${TV_INTERVALS.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
        <label><span class="sr">Chart type</span><select id="cstyle">${TV_STYLES.map(([v, t]) => `<option value="${v}">${t}</option>`).join('')}</select></label>
      </div>
      <div id="chart" class="tv"></div></div>
    <div class="stack"><div class="card"><h3 style="margin-bottom:8px">Key stats</h3><table><tbody>
      ${[['Previous close', money(qt.prevClose, { full: true })], ['Open', money(qt.open, { full: true })], ...(qt.industry && qt.type === 'EQUITY' ? [['Sector', esc(qt.industry)]] : []), ...(qt.marketCap ? [['Market cap', qt.marketCap >= 1e6 ? '$' + (qt.marketCap / 1e6).toFixed(2) + 'T' : '$' + (qt.marketCap / 1e3).toFixed(1) + 'B']] : []), ...(qt.type === 'EQUITY' ? [['Next earnings', '<span id="earn">…</span>']] : []), ['Day range', `${money(qt.low, { full: true })} – ${money(qt.high, { full: true })}`], ['Type', { ETF: 'Fund', CRYPTO: 'Crypto (trades 24/7)' }[qt.type] || 'Stock'], ['Last update', when(qt.time)]].map(([k, v]) => `<tr><td class="muted">${k}</td><td class="r">${v}</td></tr>`).join('')}</tbody></table></div>
      <div class="card row"><a class="btn up" style="flex:1" href="#/trade?symbol=${encodeURIComponent(sym)}&action=buy">Buy</a><a class="btn down" style="flex:1" href="#/trade?symbol=${encodeURIComponent(sym)}&action=sell">Sell</a>${activeGame()?.settings.allowShort && !isCrypto(sym) ? `<a class="btn secondary" style="flex:1" href="#/trade?symbol=${encodeURIComponent(sym)}&action=short">Short</a>` : ''}${activeGame()?.settings.allowOptions && !isCrypto(sym) ? `<a class="btn secondary" style="flex:1" href="#/trade?asset=option&symbol=${encodeURIComponent(sym)}">Options</a>` : ''}</div>
      <a class="btn secondary block" href="#/alerts?symbol=${encodeURIComponent(sym)}">🔔 Set a price alert</a>
    </div></div>
    <div class="card" style="margin-top:var(--gap)"><h2 style="margin-bottom:10px">${isCrypto(sym) ? 'Crypto news' : 'Latest news'}</h2><div id="news"></div></div>`;
  F.renderNews($('#news'), sym, 8);
  if ($('#earn')) F.fillEarnings($('#earn'), sym);
  $('#watch').onclick = async () => {
    const list = watching ? wl.symbols.filter(s => s !== sym) : [...wl.symbols, sym];
    await api('/api/watchlist', { method: 'PUT', body: { symbols: list } }); toast(watching ? 'Removed from watchlist.' : 'Added to watchlist.'); route();
  };
  // Chart range, candle size and type; the last choice is remembered.
  let cv; try { cv = JSON.parse(localStorage.getItem('bp_chart')) || {}; } catch { cv = {}; }
  cv = { range: TV_RANGES.some(r => r[0] === cv.range) ? cv.range : (TV_RANGES.some(r => r[0] === prefs().defaultRange) ? prefs().defaultRange : '1D'), interval: cv.interval || 'auto', style: cv.style || '3' };
  const drawChart = () => {
    $$('#rng button').forEach(b => b.classList.toggle('on', b.dataset.r === cv.range));
    $('#ivl').value = cv.interval; $('#cstyle').value = cv.style;
    try { localStorage.setItem('bp_chart', JSON.stringify(cv)); } catch {}
    tradingViewChart($('#chart'), sym, cv);
  };
  $$('#rng button').forEach(b => b.onclick = () => { cv.range = b.dataset.r; cv.interval = 'auto'; drawChart(); });
  $('#ivl').onchange = e => { cv.interval = e.target.value; drawChart(); };
  $('#cstyle').onchange = e => { cv.style = e.target.value; drawChart(); };
  drawChart();
  every(15000, async () => { const r = await api('/api/quote?symbols=' + encodeURIComponent(sym)).catch(() => null); const n = r?.[sym]; if (!n || !$('#px')) return; $('#px').textContent = money(n.price, { full: true }); $('#pxc').className = cls(n.change); $('#pxc').textContent = `${signed(n.change)} (${pct(n.changePct)}) today`; });
}

// Interactive chart from TradingView's free embeddable widget (no key; draws its own data).
const TV_RANGES = [['1D', '1D', '5'], ['5D', '5D', '30'], ['1M', '1M', '60'], ['3M', '3M', 'D'], ['6M', '6M', 'D'], ['YTD', 'YTD', 'D'], ['1Y', '12M', 'D'], ['5Y', '60M', 'W'], ['All', 'ALL', 'M']];
const TV_INTERVALS = [['auto', 'Auto candles'], ['1', '1 minute'], ['5', '5 minutes'], ['15', '15 minutes'], ['30', '30 minutes'], ['60', '1 hour'], ['240', '4 hours'], ['D', '1 day'], ['W', '1 week'], ['M', '1 month']];
const TV_STYLES = [['3', 'Area'], ['2', 'Line'], ['1', 'Candles'], ['0', 'Bars'], ['9', 'Hollow candles']];
function tradingViewChart(host, sym, { range = '1D', interval = 'auto', style = '3' } = {}) {
  const dark = document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
  const [, tvRange, autoInterval] = TV_RANGES.find(r => r[0] === range) || TV_RANGES[0];
  host.innerHTML = '<div class="tradingview-widget-container" style="height:100%"><div class="tradingview-widget-container__widget" style="height:100%"></div></div>';
  const s = document.createElement('script');
  s.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js'; s.async = true;
  s.textContent = JSON.stringify({ symbol: tvSymbol(sym), range: tvRange, interval: interval === 'auto' ? autoInterval : interval, theme: dark ? 'dark' : 'light', style, locale: 'en', autosize: true, hide_side_toolbar: true, allow_symbol_change: false, save_image: false, backgroundColor: dark ? 'rgba(28,28,30,1)' : 'rgba(255,255,255,1)', gridColor: 'rgba(128,128,128,0.08)', support_host: 'https://www.tradingview.com' });
  $('.tradingview-widget-container', host).append(s);
}

// ---------- watchlist ----------
async function viewWatchlist() {
  const wl = await api('/api/watchlist');
  app.innerHTML = `<div class="view"><div class="page-head"><div><h1>Watchlist</h1><a href="#/alerts" class="small">🔔 Price alerts</a></div><div style="width:min(360px,100%)"><div><input id="add" placeholder="Add a symbol" aria-label="Add a symbol"></div></div></div>
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
    ['executionDelay', 'Order execution delay', 'select', [['0', 'None: fill instantly'], ['1', '1 minute'], ['2', '2 minutes'], ['5', '5 minutes'], ['10', '10 minutes'], ['15', '15 minutes']], 'Orders wait this long, then fill at the market price at that moment. More realistic, and stops instant flips.'],
    ['delayApplies', 'Delay applies to', 'select', [['sells', 'Selling only (sell, short, sell options)'], ['all', 'Every order']]],
    ['settleT1', 'Next-day settlement (T+1)', 'bool', null, 'Money from a sale can’t be used to buy again until the next trading day, like a real cash account.'],
    ['allowCrypto', 'Allow crypto', 'bool', null, 'Bitcoin, Ethereum and more. Trades 24/7 in fractional amounts.'],
    ['payDividends', 'Pay dividends', 'bool', null, 'Credits each stock’s real dividend yield daily. Shorts pay it.'],
    ['dailyTradeLimit', 'Daily trade limit', 'number', null, '0 = unlimited.'],
  ]],
  ['Options', [
    ['allowOptions', 'Allow options trading', 'bool', null, 'Calls and puts on any US stock or ETF.'],
    ['allowOptionWriting', 'Allow writing options (sell to open)', 'bool', null, 'Uncovered contracts reserve 20% of the underlying as margin.'],
    ['optionCommission', 'Fee per contract ($)', 'number', null, 'Charged on top of the regular commission.'],
  ]],
  ['Players', [
    ['maxPlayers', 'Maximum players', 'number', null, '0 = unlimited.'],
    ['allowLateEntry', 'Allow late entry', 'bool', null, 'Players can join after the start date.'],
    ['allowReset', 'Allow portfolio resets', 'bool'],
    ['showPortfolios', 'Players can view each other’s portfolios', 'bool'],
  ]],
];
function settingsForm(s, sandbox) {
  return SETTING_GROUPS.map(([title, fields]) => `<div class="card"><h3 style="margin-bottom:12px">${title}</h3>
    ${fields.filter(([k]) => !(sandbox && ['privacy', 'password', 'allowLateEntry', 'showPortfolios', 'startDate', 'endDate'].includes(k))).map(([k, label, type, opts, hint]) => type === 'bool'
      ? `<label class="switch"><div><div class="t">${label}</div>${hint ? `<div class="d">${hint}</div>` : ''}</div><input type="checkbox" name="${k}" ${s[k] ? 'checked' : ''}></label>`
      : `<label class="field" style="margin-bottom:12px"><span>${label}</span>${type === 'select' ? `<select name="${k}">${opts.map(([v, t]) => `<option value="${v}" ${String(s[k]) === v ? 'selected' : ''}>${t}</option>`).join('')}</select>` : type === 'textarea' ? `<textarea name="${k}" rows="2">${esc(s[k])}</textarea>` : `<input name="${k}" type="${type}" value="${esc(s[k])}" ${type === 'number' ? 'step="any" min="0"' : ''}>`}${hint ? `<div class="hint">${hint}</div>` : ''}</label>`).join('')}</div>`).join('');
}
const readForm = form => Object.fromEntries([...form.elements].filter(e => e.name).map(e => [e.name, e.type === 'checkbox' ? e.checked : e.type === 'number' ? +e.value : e.value]));
const DEFAULTS = { name: '', description: '', privacy: 'public', password: '', startDate: new Date().toLocaleDateString('en-CA'), endDate: '', startingCash: 100000, commissionType: 'flat', commission: 0, cashInterest: 0, allowMargin: false, marginInterest: 8, allowShort: true, minShortPrice: 5, allowLimit: true, allowStop: true, allowTrailing: true, allowEtf: true, allowMutualFunds: false, minStockPrice: 0, maxPositionPct: 100, dailyTradeLimit: 0, allowLateEntry: true, allowReset: true, showPortfolios: true, allowOptions: true, allowOptionWriting: false, optionCommission: 0, allowCrypto: true, payDividends: true, maxPlayers: 0, executionDelay: 0, delayApplies: 'sells', settleT1: false };

async function viewGames() {
  await loadGames();
  const row = (g, mine) => `<tr class="link" data-go="#/games/${g.id}"><td><div class="sym">${esc(g.settings.name)} ${g.sandbox ? '<span class="badge">Practice</span>' : ''}</div><div class="sym-name">${esc(g.settings.description)}</div></td><td>${g.players}</td><td>${money(g.settings.startingCash)}</td><td>${g.sandbox ? '—' : `${g.settings.startDate} → ${g.settings.endDate || 'open'}`}</td><td><span class="badge ${g.active ? 'live' : ''}">${g.active ? 'Active' : 'Inactive'}</span></td><td class="r">${mine ? (g.id === state.gameId ? '<span class="badge">Current</span>' : `<button class="btn sm secondary" data-use="${g.id}">Switch to</button>`) : `<button class="btn sm" data-join="${g.id}" data-pw="${g.hasPassword ? 1 : ''}">Join</button>`}</td></tr>`;
  const head = '<thead><tr><th>Game</th><th>Players</th><th>Starting cash</th><th>Dates</th><th>Status</th><th></th></tr></thead>';
  app.innerHTML = `<div class="view"><div class="page-head"><h1>Games</h1><div class="row"><button class="btn secondary" id="joinCode">Join with ID</button><a class="btn" href="#/games/new">Create game</a></div></div>
    <div class="card"><h2 style="margin-bottom:8px">My games</h2><div class="table-wrap"><table>${head}<tbody>${state.games.mine.map(g => row(g, true)).join('')}</tbody></table></div></div>
    <div class="card" style="margin-top:var(--gap)"><div class="card-head"><h2>Public games</h2><input id="filter" placeholder="Filter" style="max-width:220px" aria-label="Filter public games"></div><div class="table-wrap"><table>${head}<tbody id="pub">${state.games.public.map(g => row(g)).join('') || '<tr><td colspan="6" class="empty">No public games to join right now. Create one!</td></tr>'}</tbody></table></div></div></div>`;
  $$('[data-use]').forEach(b => b.onclick = () => switchGame(b.dataset.use));
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
  const gameForInvite = { id: g.id, settings: s };
  app.innerHTML = `<div class="view"><div class="page-head"><div><a href="#/games" class="small">‹ Games</a><h1>${esc(s.name)}</h1><div class="muted">${esc(s.description)}</div></div>
    <div class="row">${g.joined ? (g.id !== state.gameId ? `<button class="btn" id="use">Make active</button>` : '<span class="badge live">Active game</span>') : `<button class="btn" id="join">Join game</button>`}
      ${g.joined && !g.isOwner && !g.sandbox ? '<button class="btn secondary" id="leave">Leave</button>' : ''}</div></div>
    <div class="grid g4" style="margin-bottom:var(--gap)">${[['Players', g.players], ['Starting cash', money(s.startingCash)], ['Starts', g.sandbox ? '—' : s.startDate], ['Ends', g.sandbox ? '—' : s.endDate || 'No end date']].map(([l, v]) => `<div class="card stat"><div class="label">${l}</div><div class="value" style="font-size:1.15rem">${v}</div></div>`).join('')}</div>
    <div class="grid g2"><div class="card"><div class="card-head"><h2>Rankings</h2><span class="muted small">Live</span></div><div class="table-wrap"><table><thead><tr><th>Rank</th><th>Player</th><th class="r">Account value</th><th class="r">Return</th></tr></thead><tbody>
      ${rankings.map(r => `<tr class="${s.showPortfolios || r.userId === state.me.id ? 'link' : ''}" ${s.showPortfolios || r.userId === state.me.id ? `data-go="#/portfolio${r.userId === state.me.id ? '' : '?player=' + r.playerId}"` : ''}><td><span class="rank r${r.rank}">${r.rank}</span></td><td><a href="#/profile/${encodeURIComponent(r.userId)}" class="who">${avatarHtml(r, 28)}<b>${esc(r.name)}</b></a>${r.userId === state.me.id ? ' <span class="badge">You</span>' : ''}</td><td class="r">${money(r.equity)}</td><td class="r ${cls(r.gain)}">${pct(r.gainPct)}</td></tr>`).join('')}</tbody></table></div></div>
      <div class="stack">${!g.sandbox && g.joined ? '<button class="btn" id="invF">Invite friends</button>' : ''}${!g.sandbox ? `<div class="card"><h3>Invite players</h3><p class="muted small">Share this link${g.hasPassword ? ' and the game password' : ''}.</p><div class="row" style="flex-wrap:nowrap"><input value="${esc(link)}" readonly id="lnk"><button class="btn secondary sm" id="copy">Copy</button></div><div class="hint">Game ID: ${g.id}</div></div>` : ''}
        <div class="card small"><h3 style="margin-bottom:6px">Rules</h3><div class="muted">Commission ${s.commission ? (s.commissionType === 'flat' ? money(s.commission) : s.commission + '%') : 'free'} · Short selling ${s.allowShort ? 'on' : 'off'} · Margin ${s.allowMargin ? 'on' : 'off'} · Late entry ${s.allowLateEntry ? 'on' : 'off'} · Resets ${s.allowReset ? 'on' : 'off'} · ${s.privacy === 'public' ? 'Public' : 'Private'}</div></div></div></div>
    ${g.sandbox && !state.me.admin ? '<p class="muted small" style="margin-top:24px">Practice portfolio rules are fixed and can’t be edited.</p>' : ''}${(g.isOwner && !g.sandbox) || state.me.admin ? `<h2 style="margin:32px 0 14px">Game settings${!g.isOwner ? ' <span class="badge closed">Admin</span>' : ''}</h2><form id="sf" class="grid g-half">${settingsForm(s, g.sandbox)}<div class="card" style="align-self:start"><button class="btn block">Save settings</button>${!g.sandbox ? '<button type="button" class="btn danger block" id="del" style="margin-top:10px">Delete game</button>' : ''}</div></form>` : ''}</div>`;
  $('#use')?.addEventListener('click', () => switchGame(g.id));
  $('#join')?.addEventListener('click', () => joinGame(g.id, g.hasPassword));
  $('#invF')?.addEventListener('click', () => F.inviteModal({ game: gameForInvite }));
  if (!g.sandbox) { const box = document.createElement('div'); box.className = 'card'; box.style.marginTop = 'var(--gap)'; $('.view .grid.g2').after(box); F.mountActivity(box, g); }
  $('#copy')?.addEventListener('click', () => { navigator.clipboard.writeText(link).then(() => toast('Link copied.')); });
  $('#leave')?.addEventListener('click', async () => { await api(`/api/games/${g.id}/leave`, { method: 'POST' }); state.gameId = null; await loadGames(); location.hash = '#/games'; });
  $('#sf')?.addEventListener('submit', async e => { e.preventDefault(); try { await api('/api/games/' + g.id, { method: 'PATCH', body: readForm(e.target) }); await loadGames(); toast('Settings saved.'); route(); } catch (err) { toast(err.message, true); } });
  $('#del')?.addEventListener('click', () => modal(`<h2>Delete “${esc(s.name)}”?</h2><p class="muted">Every player’s portfolio in this game is removed. This can’t be undone.</p><div class="actions"><button class="btn secondary" data-x>Cancel</button><button class="btn danger" data-ok>Delete</button></div>`, (el, close) => {
    $('[data-x]', el).onclick = close;
    $('[data-ok]', el).onclick = async () => { await api('/api/games/' + g.id, { method: 'DELETE' }); close(); state.gameId = null; await loadGames(); location.hash = '#/games'; };
  }));
}

// ---------- settings ----------
// Hidden admin unlock: tap "Settings" 10 times quickly, in the sidebar, the account menu or the page title.
let adminTaps = [], showAdminBox = false;
function revealAdminBox() {
  showAdminBox = true;
  const box = $('#adminBox'); if (!box) return;
  box.hidden = false; box.scrollIntoView({ block: 'center' }); $('input', box)?.focus({ preventScroll: true });
}
document.addEventListener('click', e => {
  if (!e.target.closest('#side a[href="#/settings"], #avatarMenu a[href="#/settings"], #setTitle')) return;
  adminTaps = [...adminTaps.filter(t => Date.now() - t < 5000), Date.now()];
  if (adminTaps.length < 10) return;
  adminTaps = [];
  if (location.hash.split('?')[0] === '#/settings' && $('#adminBox')) revealAdminBox();
  else { showAdminBox = true; location.hash = '#/settings'; }
});
function viewSettings() {
  const p = prefs();
  const seg = (k, opts) => `<div class="seg" data-k="${k}">${opts.map(([v, t]) => `<button type="button" data-v="${v}" class="${(p[k] ?? opts[0][0]) === v ? 'on' : ''}">${t}</button>`).join('')}</div>`;
  const sw = (k, t, d, def = true) => `<label class="switch"><div><div class="t">${t}</div><div class="d">${d}</div></div><input type="checkbox" data-k="${k}" ${(p[k] ?? def) ? 'checked' : ''}></label>`;
  app.innerHTML = `<div class="view"><div class="page-head"><h1 id="setTitle">Settings</h1></div><div class="grid g-half">
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
      <label class="field" style="margin-top:12px"><span>Default chart range</span><select data-k="defaultRange">${['1D', '5D', '1M', '3M', '6M', 'YTD', '1Y', '5Y', 'All'].map(r => `<option ${p.defaultRange === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
      <label class="field" style="margin-top:12px"><span>Default game</span><select data-k="defaultGame"><option value="">Last used</option>${state.games.mine.map(g => `<option value="${g.id}" ${p.defaultGame === g.id ? 'selected' : ''}>${esc(g.settings.name)}</option>`).join('')}</select></label>
    </div>
    <div class="card stack" id="profileCard"><div class="card-head" style="margin:0"><h2>Profile</h2><a href="#/profile" class="small">View profile</a></div>
      <div class="row" style="gap:16px"><div id="avPrev">${avatarHtml(state.me, 72)}</div>
        <div class="row"><label class="btn secondary sm" style="cursor:pointer">Upload photo<input type="file" accept="image/*" id="avFile" hidden></label>
          ${store.currentUser()?.provider === 'google' && store.currentUser()?.picture ? '<button class="btn ghost sm" id="avGoogle">Use Google photo</button>' : ''}
          <button class="btn ghost sm" id="avRemove">Remove photo</button></div></div>
      <div><div class="muted small" style="font-weight:600;margin-bottom:6px">Colour (used when there’s no photo)</div><div class="swatches">${AVATAR_COLORS.map(c => `<button type="button" data-c="${c}" style="background:${c}" aria-label="Colour ${c}"></button>`).join('')}</div></div>
      <label class="field"><span>Display name</span><input id="pfName" maxlength="40" value="${esc(state.me.name)}" autocomplete="nickname"></label>
      <label class="field"><span>Username</span><div class="row" style="flex-wrap:nowrap;gap:6px"><span class="muted">@</span><input id="pfHandle" maxlength="20" value="${esc(state.me.handle || '')}" placeholder="pick_a_username" autocomplete="username" spellcheck="false"></div><div class="hint">Friends add you by this. 3–20 letters, numbers or underscores.</div></label>
      <label class="field"><span>Bio</span><textarea id="pfBio" maxlength="160" rows="2" placeholder="Value investor. Options degen. Etc.">${esc(state.me.bio || '')}</textarea><div class="hint"><span id="bioCount">${(state.me.bio || '').length}</span>/160</div></label>
      <button class="btn" id="pfSave" style="align-self:flex-start">Save profile</button></div>
    <div class="card stack" id="securityCard"><h2>Sign-in &amp; security</h2></div>
    <div class="card stack"><h2>Your data</h2>
      <div class="row"><div style="flex:1;min-width:200px"><b>Download your data</b><div class="muted small">Every portfolio, order and setting, as a JSON file.</div></div><button class="btn secondary sm" id="exportBtn">Download</button></div>
      <div class="row"><div style="flex:1;min-width:200px"><b>Sign out</b><div class="muted small">Sign out of Bullpen on this device.</div></div><button class="btn secondary sm" id="signOut2">Sign out</button></div>
      <div class="row"><div style="flex:1;min-width:200px"><b class="down">Delete account</b><div class="muted small">Deletes your profile, your portfolios and every game you created.</div></div><button class="btn danger sm" id="deleteBtn">Delete…</button></div>
      <form id="adminBox" class="stack" hidden autocomplete="off">${state.me.admin
        ? '<div class="row"><div style="flex:1"><b>Admin mode is on</b><div class="muted small">You can manage every account and game.</div></div><a class="btn sm" href="#/admin">Open admin</a><button type="button" class="btn secondary sm" id="adminLock">Turn off</button></div>'
        : '<label class="field"><span>Password</span><input type="password" name="pw" autocomplete="off"></label><button class="btn sm" style="align-self:flex-start">Unlock</button>'}</form></div>
  </div></div>`;
  $$('.seg[data-k]').forEach(sg => $$('button', sg).forEach(b => b.onclick = async () => { $$('button', sg).forEach(x => x.classList.toggle('on', x === b)); await savePrefs({ [sg.dataset.k]: b.dataset.v }); }));
  $$('input[data-k]').forEach(i => i.onchange = () => savePrefs({ [i.dataset.k]: i.checked }).then(() => toast('Saved.')));
  $$('select[data-k]').forEach(i => i.onchange = () => savePrefs({ [i.dataset.k]: i.value || null }).then(() => toast('Saved.')));
  mountAccountSettings();
  if (state.me.admin || showAdminBox) revealAdminBox();
  $('#adminBox').onsubmit = async e => {
    e.preventDefault();
    try {
      const r = await api('/api/admin/unlock', { method: 'POST', body: { password: e.target.pw.value } });
      if (r.admin) { state.me.admin = true; renderShell(); toast('Admin mode on.'); location.hash = '#/admin'; return; }
      const steps = r.status === 'rules'
        ? `<p><b>Firebase’s security rules are out of date</b>, so it won’t even check whether you’re an admin.</p>
          <ol class="small" style="padding-left:18px;line-height:1.6"><li>Open <a href="https://github.com/CycloneDraco/Bullpen/blob/main/firestore.rules" target="_blank" rel="noopener">firestore.rules on GitHub</a> and copy everything.</li><li>Firebase console → <b>Firestore Database</b> → <b>Rules</b> tab → select all, paste, click <b>Publish</b>.</li><li>Wait about a minute, reload Bullpen, and unlock again.</li></ol>`
        : r.status === 'missing'
        ? `<p><b>Firebase has no admin entry for this account.</b> The document ID must be exactly the user ID below, not an auto-generated one.</p>
          <ol class="small" style="padding-left:18px;line-height:1.6"><li>Firebase console → <b>Firestore Database</b> → <b>Data</b>.</li><li>Click <b>+ Start collection</b> (or open <code>admins</code> if it exists). Collection ID: <code>admins</code> (lowercase).</li><li>Document ID: paste the user ID below. Don’t click Auto-ID.</li><li>Add a field: <code>role</code>, type string, value <code>admin</code>. Click <b>Save</b>.</li><li>Reload Bullpen and unlock again.</li></ol>`
        : `<p>Firebase returned an unexpected error: <code>${esc(r.status)}</code>. Send this to whoever set up Bullpen.</p>`;
      modal(`<h2>Almost there</h2><p class="small muted" style="margin-top:0">The password is right. Signed in as <b>${esc(r.email || 'this account')}</b>${r.provider ? ` (${r.provider === 'email' ? 'email login' : 'Google'})` : ''}. Admin is tied to this exact account.</p>${steps}
        <div class="field"><span class="muted small" style="font-weight:600">Your user ID</span><div class="row" style="flex-wrap:nowrap;margin-top:4px"><input readonly value="${esc(r.uid)}" id="uidBox"><button class="btn secondary sm" id="copyUid">Copy</button></div></div>
        <div class="actions"><button class="btn secondary" data-x>Close</button><button class="btn" id="retryAdmin">I’ve done it, check again</button></div>`, (el, close) => {
        $('[data-x]', el).onclick = close;
        $('#copyUid', el).onclick = () => navigator.clipboard.writeText(r.uid).then(() => toast('User ID copied.'));
        $('#retryAdmin', el).onclick = async () => {
          const again = await api('/api/admin/unlock', { method: 'POST', body: { password: e.target.pw.value } }).catch(err => ({ status: err.message }));
          if (again.admin) { close(); state.me.admin = true; renderShell(); toast('Admin mode on.'); location.hash = '#/admin'; }
          else toast(again.status === 'rules' ? 'Still blocked: the rules aren’t published yet.' : again.status === 'missing' ? 'Still no admins entry for this user ID.' : String(again.status), true);
        };
      });

    } catch (err) { toast(err.message, true); }
  };
  $('#adminLock')?.addEventListener('click', async () => { await api('/api/admin/lock', { method: 'POST' }); state.me.admin = false; renderShell(); toast('Admin mode off.'); route(); });
  if (location.hash.includes('edit=profile')) $('#profileCard').scrollIntoView({ block: 'start' });
}

function mountAccountSettings() {
  const me = state.me, draft = { picture: me.picture || '', color: me.color || AVATAR_COLORS[0] };
  const preview = () => { $('#avPrev').innerHTML = avatarHtml({ ...me, ...draft, name: $('#pfName').value || me.name }, 72); $$('.swatches button').forEach(b => b.classList.toggle('on', b.dataset.c === draft.color)); };
  preview();
  $('#avFile').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { draft.picture = await squareImage(f); preview(); toast('Photo ready. Save your profile to keep it.'); } catch (err) { toast(err.message, true); } e.target.value = ''; };
  $('#avRemove').onclick = () => { draft.picture = ''; preview(); };
  $('#avGoogle')?.addEventListener('click', () => { draft.picture = store.currentUser().picture; preview(); });
  $$('.swatches button').forEach(b => b.onclick = () => { draft.color = b.dataset.c; preview(); });
  $('#pfName').oninput = preview;
  $('#pfBio').oninput = e => { $('#bioCount').textContent = e.target.value.length; };
  $('#pfSave').onclick = async () => {
    const btn = $('#pfSave'); btn.disabled = true;
    try { state.me = (await api('/api/me/profile', { method: 'PATCH', body: { name: $('#pfName').value, handle: $('#pfHandle').value, bio: $('#pfBio').value, ...draft } })).user; renderShell(); toast('Profile saved.'); }
    catch (err) { toast(err.message, true); }
    btn.disabled = false;
  };

  // Sign-in & security
  const sec = $('#securityCard'), fb = store.mode === 'firebase', email = fb && me.provider === 'email';
  const authMsg = e => ({ 'auth/invalid-credential': 'Your current password is wrong.', 'auth/wrong-password': 'Your current password is wrong.', 'auth/weak-password': 'Use at least 6 characters.', 'auth/email-already-in-use': 'Another account already uses that email.', 'auth/invalid-email': 'That email address doesn’t look right.', 'auth/requires-recent-login': 'Sign out and back in, then try again.', 'auth/too-many-requests': 'Too many attempts. Wait a minute and try again.', 'auth/popup-closed-by-user': 'Sign-in was cancelled.' }[e.code] || e.message);
  sec.innerHTML = `<h2>Sign-in &amp; security</h2>
    ${!fb ? '<p class="muted small" style="margin:0">Offline mode: this account lives only in this browser. Connect Firebase for real sign-in.</p>' : `
    <div class="row"><div style="flex:1;min-width:200px"><b>${esc(me.email)}</b><div class="muted small">${email ? 'Email and password' : 'Google account'}</div></div>
      ${email ? (me.emailVerified ? '<span class="badge live">Verified</span>' : '<span class="badge closed">Not verified</span>') : '<span class="badge live">Google</span>'}</div>
    ${email && !me.emailVerified ? '<div class="row"><button class="btn secondary sm" id="verifyBtn">Send verification email</button><button class="btn ghost sm" id="verifiedBtn">I’ve verified it</button></div>' : ''}
    ${email ? `<details><summary class="link-like">Change password</summary><form id="pwForm" class="stack" style="margin-top:12px">
        <label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password" required></label>
        <label class="field"><span>New password</span><input type="password" name="next" autocomplete="new-password" minlength="6" required></label>
        <label class="field"><span>Confirm new password</span><input type="password" name="confirm" autocomplete="new-password" minlength="6" required></label>
        <button class="btn sm" style="align-self:flex-start">Update password</button></form></details>
      <details><summary class="link-like">Change email</summary><form id="emForm" class="stack" style="margin-top:12px">
        <label class="field"><span>New email</span><input type="email" name="email" autocomplete="email" required></label>
        <label class="field"><span>Current password</span><input type="password" name="current" autocomplete="current-password" required></label>
        <button class="btn sm" style="align-self:flex-start">Send confirmation link</button><div class="hint">We’ll email the new address. The change happens when you click the link.</div></form></details>`
      : '<p class="muted small" style="margin:0">Your password and email are managed by your Google account.</p>'}`}`;
  $('#verifyBtn')?.addEventListener('click', async () => { try { await account.sendVerification(); toast(`Verification email sent to ${me.email}.`); } catch (e) { toast(authMsg(e), true); } });
  $('#verifiedBtn')?.addEventListener('click', async () => { state.me = await account.refresh(); state.me.emailVerified ? (toast('Email verified.'), mountAccountSettings()) : toast('Not verified yet. Click the link in the email first.', true); });
  $('#pwForm')?.addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target;
    if (f.next.value !== f.confirm.value) return toast('The new passwords don’t match.', true);
    try { await account.changePassword(f.current.value, f.next.value); f.reset(); toast('Password updated.'); } catch (err) { toast(authMsg(err), true); }
  });
  $('#emForm')?.addEventListener('submit', async e => {
    e.preventDefault(); const f = e.target;
    try { await account.changeEmail(f.current.value, f.email.value.trim()); toast(`Confirmation link sent to ${f.email.value.trim()}.`); f.reset(); } catch (err) { toast(authMsg(err), true); }
  });

  // Data
  $('#exportBtn').onclick = async () => {
    const data = await api('/api/me/export');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    a.download = `bullpen-${new Date().toISOString().slice(0, 10)}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  $('#signOut2').onclick = () => $('#signOut').click();
  $('#deleteBtn').onclick = () => modal(`<h2>Delete your account?</h2>
    <p class="muted">This permanently deletes your profile, all your portfolios, and every game you created (including other players’ progress in them). You’ll leave games other people created. This can’t be undone.</p>
    ${email ? '<label class="field"><span>Password</span><input type="password" id="delPw" autocomplete="current-password"></label>' : fb ? '<p class="small muted">You’ll be asked to confirm with Google.</p>' : ''}
    <label class="field" style="margin-top:12px"><span>Type DELETE to confirm</span><input id="delTxt" autocomplete="off"></label>
    <div class="actions"><button class="btn secondary" data-x>Cancel</button><button class="btn danger" data-ok disabled>Delete account</button></div>`, (el, close) => {
    const ok = $('[data-ok]', el);
    $('#delTxt', el).oninput = e => { ok.disabled = e.target.value.trim() !== 'DELETE'; };
    $('[data-x]', el).onclick = close;
    ok.onclick = async () => {
      ok.disabled = true;
      try { await account.deleteAccount($('#delPw', el)?.value); close(); state.me = null; state.games = { mine: [], public: [] }; toast('Your account has been deleted.'); location.hash = '#/'; route(); }
      catch (err) { toast(authMsg(err), true); ok.disabled = false; }
    };
  });
}

// ---------- profile ----------
async function viewProfile(uid) {
  const p = await api('/api/profiles/' + encodeURIComponent(uid || state.me.id));
  const real = p.results.filter(r => !r.sandbox);
  const best = real.length ? Math.max(...real.map(r => r.gainPct)) : null;
  app.innerHTML = `<div class="view">
    <div class="card"><div class="row" style="gap:20px">${avatarHtml(p, 96)}
      <div style="flex:1;min-width:200px"><h1>${esc(p.name)}</h1>${p.handle ? `<div class="muted">@${esc(p.handle)}</div>` : ''}
        ${p.bio ? `<p style="margin:6px 0 0">${esc(p.bio)}</p>` : p.self ? '<p class="muted small" style="margin:6px 0 0">No bio yet.</p>' : ''}
        ${p.joined ? `<div class="muted small" style="margin-top:6px">Member since ${new Date(p.joined).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</div>` : ''}</div>
      ${p.self ? '<a class="btn secondary" href="#/settings?edit=profile">Edit profile</a>' : `<button class="btn" id="chal">Challenge</button>`}</div></div>
    <div class="grid g3" style="margin-top:var(--gap)">${[['Games', real.length], ['Best return', best == null ? '—' : `<span class="${cls(best)}">${pct(best)}</span>`], ['Trades', p.results.reduce((a, r) => a + r.trades, 0)]].map(([l, v]) => `<div class="card stat"><div class="label">${l}</div><div class="value">${v}</div></div>`).join('')}</div>
    <div class="card" style="margin-top:var(--gap)"><div class="card-head"><h2>Badges</h2><span class="muted small">${Object.keys(p.badges || {}).length} of ${F.BADGE_COUNT}</span></div>${F.badgesHtml(p.badges || {})}</div>
    <div class="card" style="margin-top:var(--gap)"><h2 style="margin-bottom:8px">Games</h2>
      ${p.results.length ? `<div class="table-wrap"><table><thead><tr><th>Game</th><th class="r">Account value</th><th class="r">Return</th><th class="r">Trades</th><th class="r">Positions</th></tr></thead><tbody>
      ${p.results.map(r => `<tr class="link" data-go="#/games/${r.gameId}"><td><b>${esc(r.game)}</b>${r.sandbox ? ' <span class="badge">Practice</span>' : ''}</td><td class="r">${money(r.equity)}</td><td class="r ${cls(r.gainPct)}">${pct(r.gainPct)}</td><td class="r">${r.trades}</td><td class="r">${r.positions}</td></tr>`).join('')}</tbody></table></div>` : '<div class="empty">Not in any games yet.</div>'}</div></div>`;
  $('#chal')?.addEventListener('click', () => F.challengeModal({ id: p.id, name: p.name }));
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
    else if (path === '/admin') await F.viewAdmin(q);
    else if (path === '/alerts') await F.viewAlerts(q);
    else if (path === '/screener') await F.viewScreener();
    else if (path === '/leaderboard') await F.viewLeaderboard();
    else if (path === '/friends') await F.viewFriends();
    else if (path === '/profile') await viewProfile();
    else if (path.startsWith('/profile/')) await viewProfile(decodeURIComponent(path.split('/')[2]));
    else location.hash = '#/';
  } catch (e) { app.innerHTML = `<div class="card empty view">${esc(e.message)}<br><a href="#/" class="btn sm" style="margin-top:12px">Go to dashboard</a></div>`; }
}
window.addEventListener('hashchange', route);
export { $, $$, esc, api, money, signed, pct, cls, when, toast, modal, avatarHtml, state, prefs, activeGame, symbolSearch, enterGame, route, loadGames, settingsForm, readForm };
route();
