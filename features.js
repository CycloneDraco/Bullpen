// Bullpen feature views: alerts, news, screener, leaderboard, friends, game activity,
// badges, option strategies, portfolio analytics, tooltips and keyboard shortcuts.
import { $, $$, esc, api, money, signed, pct, cls, when, toast, modal, avatarHtml, state, prefs, activeGame, symbolSearch, enterGame, route, loadGames } from './app.js';
import { BADGES, CRYPTO, isCrypto, checkAlerts } from './backend.js';

const ago = t => { const s = (Date.now() - t) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : when(t); };
const qtyFmt = n => (+n).toLocaleString(undefined, { maximumFractionDigits: 6 });

// ---------- badges ----------
export async function checkBadges() {
  try { for (const b of await api('/api/badges/check', { method: 'POST' })) toast(`${b.icon} Badge earned: ${b.name}`); refreshBell(); } catch {}
}
export function badgesHtml(earned = {}, compact) {
  return `<div class="badges">${BADGES.map(([id, icon, name, desc]) => `<div class="badge-tile ${earned[id] ? 'on' : ''}" title="${esc(desc)}${earned[id] ? ' · earned ' + new Date(earned[id]).toLocaleDateString() : ''}"><span class="bi">${icon}</span>${compact ? '' : `<b>${esc(name)}</b><small>${esc(desc)}</small>`}</div>`).join('')}</div>`;
}

// ---------- notifications bell (alerts, badges, invites) ----------
let lastUnread = 0;
export async function refreshBell() {
  const bell = $('#bell'); if (!bell || !state.me) return;
  try {
    const { items, invites } = await api('/api/notifications');
    const unread = items.filter(n => !n.read).length + invites.length;
    $('#bellCount').textContent = unread > 9 ? '9+' : unread; $('#bellCount').hidden = !unread;
    bell.dataset.state = JSON.stringify({ items, invites });
    lastUnread = unread;
  } catch {}
}
export function mountBell() {
  const bell = $('#bell');
  bell.onclick = async e => {
    e.stopPropagation();
    const menu = $('#bellMenu');
    if (!menu.hidden) { menu.hidden = true; return; }
    $('#avatarMenu').hidden = true;
    await refreshBell();
    const { items = [], invites = [] } = JSON.parse(bell.dataset.state || '{}');
    menu.innerHTML = `<div class="menu-head"><b>Notifications</b></div>
      ${invites.map(i => `<div class="note invite">${avatarHtml({ name: i.fromName, picture: i.fromPicture, color: i.fromColor }, 32)}<div><b>${esc(i.fromName)}</b> ${i.kind === 'challenge' ? 'challenged you' : 'invited you'} to <b>${esc(i.gameName)}</b>
        <div class="row" style="margin-top:6px"><button class="btn sm" data-acc="${i.id}">Accept</button><button class="btn sm secondary" data-dec="${i.id}">Decline</button></div></div></div>`).join('')}
      ${items.map(n => `<a class="note ${n.read ? '' : 'unread'}" href="${esc(n.link || '#/')}"><span class="ni">${n.kind === 'alert' ? '🔔' : n.kind === 'badge' ? '🏅' : '•'}</span><div>${esc(n.text)}<div class="muted small">${ago(n.created)}</div></div></a>`).join('')}
      ${!items.length && !invites.length ? '<div class="empty small">You’re all caught up.</div>' : ''}
      <a class="note" href="#/alerts" style="justify-content:center;font-weight:600">Manage price alerts</a>`;
    menu.hidden = false;
    $$('[data-acc]', menu).forEach(b => b.onclick = async () => { try { const r = await api(`/api/invites/${b.dataset.acc}/accept`, { method: 'POST' }); menu.hidden = true; await enterGame(r.gameId); checkBadges(); } catch (err) { toast(err.message, true); } });
    $$('[data-dec]', menu).forEach(b => b.onclick = async () => { await api(`/api/invites/${b.dataset.dec}`, { method: 'DELETE' }); menu.hidden = true; refreshBell(); });
    if (items.some(n => !n.read)) api('/api/notifications/read', { method: 'POST' }).then(refreshBell);
  };
  document.addEventListener('click', e => { if (!e.target.closest('#bellMenu')) $('#bellMenu').hidden = true; });
  // Price alerts are checked while Bullpen is open (there is no server to watch for you).
  setInterval(async () => {
    if (!state.me) return;
    const hits = await checkAlerts().catch(() => []);
    for (const h of hits) {
      toast('🔔 ' + h.text);
      try { if (Notification.permission === 'granted') new Notification('Bullpen price alert', { body: h.text, icon: 'icon.svg' }); } catch {}
    }
    refreshBell();
  }, 60000);
  refreshBell();
}

// ---------- price alerts ----------
export async function viewAlerts(q) {
  const { alerts, quotes } = await api('/api/alerts');
  const OPS = { above: 'Price rises above', below: 'Price falls below', up: 'Up today by at least', down: 'Down today by at least' };
  const canNotify = 'Notification' in window;
  app().innerHTML = `<div class="view"><div class="page-head"><div><a href="#/watchlist" class="small">‹ Watchlist</a><h1>Price alerts</h1></div></div>
    <div class="grid g2"><div class="card"><h2 style="margin-bottom:10px">Your alerts</h2>
      ${alerts.length ? `<div class="table-wrap"><table><thead><tr><th>Symbol</th><th>When</th><th class="r">Now</th><th>Status</th><th></th></tr></thead><tbody>
      ${alerts.map(a => { const qq = quotes[a.symbol]; return `<tr><td class="sym">${esc(a.symbol)}</td><td>${OPS[a.op]} ${a.op === 'up' || a.op === 'down' ? a.value + '%' : money(a.value, { full: true })}</td><td class="r">${qq ? money(qq.price, { full: true }) : '—'}</td><td>${a.triggered ? `<span class="badge live">Triggered ${ago(a.triggered)}</span>` : '<span class="badge">Watching</span>'}</td><td class="r"><button class="btn sm ghost" data-del="${a.id}">Delete</button></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">No alerts yet. Create one to get notified when a price moves.</div>'}</div>
    <form class="card stack" id="af" autocomplete="off"><h2>New alert</h2>
      <label class="field"><span>Symbol</span><div><input name="symbol" placeholder="e.g. NVDA or BTC-USD" value="${esc(q.get('symbol') || '')}" required></div></label>
      <label class="field"><span>Notify me when</span><select name="op">${Object.entries(OPS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>
      <label class="field"><span id="avLabel">Price ($)</span><input name="value" type="number" step="any" min="0" required></label>
      <button class="btn">Create alert</button>
      <p class="hint">Alerts are checked every minute while Bullpen is open in a tab. ${canNotify ? '<a href="#" id="notifyOn">Turn on browser notifications</a> to get a pop-up even when the tab is in the background.' : ''}</p></form></div></div>`;
  const f = $('#af');
  symbolSearch(f.symbol, s => { f.symbol.value = s; });
  f.op.onchange = () => { $('#avLabel').textContent = f.op.value === 'up' || f.op.value === 'down' ? 'Percent (%)' : 'Price ($)'; };
  f.onsubmit = async e => {
    e.preventDefault();
    try { await api('/api/alerts', { method: 'POST', body: { symbol: f.symbol.value.trim(), op: f.op.value, value: +f.value.value } }); toast('Alert created.'); checkBadges(); route(); } catch (err) { toast(err.message, true); }
  };
  $$('[data-del]').forEach(b => b.onclick = async () => { await api(`/api/alerts/${b.dataset.del}`, { method: 'DELETE' }); route(); });
  $('#notifyOn')?.addEventListener('click', async e => { e.preventDefault(); const r = await Notification.requestPermission(); toast(r === 'granted' ? 'Browser notifications are on.' : 'Notifications were not allowed.', r !== 'granted'); });
}

// ---------- news ----------
export async function renderNews(host, symbol, limit = 8) {
  host.innerHTML = '<div class="skeleton" style="height:120px"></div>';
  try {
    const items = (await api('/api/news' + (symbol ? '?symbol=' + encodeURIComponent(symbol) : ''))).slice(0, limit);
    host.innerHTML = items.length ? `<div class="news">${items.map(n => `<a class="news-item" href="${esc(n.url)}" target="_blank" rel="noopener noreferrer">
      ${n.image ? `<img src="${esc(n.image)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">` : ''}<div><b>${esc(n.headline)}</b><div class="muted small">${esc(n.source)} · ${ago(n.time)}</div></div></a>`).join('')}</div>` : '<div class="empty">No recent news.</div>';
  } catch (e) { host.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
}
export async function fillEarnings(el, symbol) {
  try { const e = await api('/api/earnings?symbol=' + encodeURIComponent(symbol)); el.textContent = e ? `${new Date(e.date + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} (${e.hour === 'bmo' ? 'before open' : e.hour === 'amc' ? 'after close' : 'time TBA'})` : 'None scheduled'; }
  catch { el.textContent = '—'; }
}

// ---------- screener ----------
const screenCache = {};
export async function viewScreener() {
  const universe = [...await api('/api/universe'), ...Object.keys(CRYPTO).map(k => k + '-USD')];
  app().innerHTML = `<div class="view"><div class="page-head"><div><h1>Screener</h1><div class="muted small">${universe.length} popular stocks, ETFs and coins, with live prices</div></div></div>
    <div class="card filters">
      <input id="sq" placeholder="Name or symbol" aria-label="Filter by name or symbol">
      <select id="stype" aria-label="Type"><option value="">All types</option><option value="EQUITY">Stocks</option><option value="ETF">ETFs</option><option value="CRYPTO">Crypto</option></select>
      <select id="ssector" aria-label="Sector"><option value="">All sectors</option></select>
      <select id="scap" aria-label="Market cap"><option value="">Any size</option><option value="mega">Mega cap (over $200B)</option><option value="large">Large ($10B–$200B)</option><option value="mid">Under $10B</option></select>
      <select id="schg" aria-label="Today’s move"><option value="">Any move today</option><option value="up">Up today</option><option value="down">Down today</option><option value="big">Moving 2%+ either way</option></select>
      <input id="smin" type="number" min="0" placeholder="Min price" aria-label="Minimum price"><input id="smax" type="number" min="0" placeholder="Max price" aria-label="Maximum price">
    </div>
    <div class="card" style="margin-top:var(--gap)"><div class="muted small" id="sprog"></div><div class="table-wrap"><table><thead><tr>
      ${[['symbol', 'Symbol'], ['industry', 'Sector'], ['price', 'Price', 'r'], ['changePct', 'Today', 'r'], ['marketCap', 'Market cap', 'r']].map(([k, t, c]) => `<th class="${c || ''} sortable" data-k="${k}">${t}</th>`).join('')}<th></th></tr></thead><tbody id="srows"></tbody></table></div></div></div>`;
  let sort = { k: 'marketCap', dir: -1 };
  const cap = m => !m ? '—' : m >= 1e6 ? `$${(m / 1e6).toFixed(2)}T` : m >= 1e3 ? `$${(m / 1e3).toFixed(0)}B` : `$${m.toFixed(0)}M`;
  const draw = () => {
    const rows = Object.values(screenCache), v = id => $('#' + id).value;
    const sectors = [...new Set(rows.map(r => r.industry).filter(Boolean))].sort();
    const cur = v('ssector'); $('#ssector').innerHTML = '<option value="">All sectors</option>' + sectors.map(s => `<option ${s === cur ? 'selected' : ''}>${esc(s)}</option>`).join('');
    const ql = v('sq').toLowerCase();
    const list = rows.filter(r => (!ql || r.symbol.toLowerCase().includes(ql) || r.name.toLowerCase().includes(ql))
      && (!v('stype') || r.type === v('stype')) && (!v('ssector') || r.industry === v('ssector'))
      && (!v('scap') || (v('scap') === 'mega' ? r.marketCap >= 2e5 : v('scap') === 'large' ? r.marketCap >= 1e4 && r.marketCap < 2e5 : r.marketCap > 0 && r.marketCap < 1e4))
      && (!v('schg') || (v('schg') === 'up' ? r.changePct > 0 : v('schg') === 'down' ? r.changePct < 0 : Math.abs(r.changePct) >= 2))
      && (!v('smin') || r.price >= +v('smin')) && (!v('smax') || r.price <= +v('smax')))
      .sort((a, b) => { const x = a[sort.k] ?? '', y = b[sort.k] ?? ''; return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sort.dir; });
    $$('th.sortable').forEach(th => th.dataset.dir = th.dataset.k === sort.k ? (sort.dir > 0 ? 'asc' : 'desc') : '');
    $('#srows').innerHTML = list.map(r => `<tr class="link" data-go="#/research?symbol=${encodeURIComponent(r.symbol)}"><td><div class="row" style="flex-wrap:nowrap;gap:10px">${r.logo ? `<img src="${esc(r.logo)}" alt="" class="logo" loading="lazy" onerror="this.remove()">` : ''}<div><div class="sym">${esc(r.symbol)}</div><div class="sym-name">${esc(r.name)}</div></div></div></td>
      <td>${esc(r.industry || (r.type === 'ETF' ? 'Funds' : '—'))}</td><td class="r">${money(r.price, { full: true })}</td><td class="r ${cls(r.changePct)}">${pct(r.changePct)}</td><td class="r">${cap(r.marketCap)}</td><td class="r"><a class="btn sm secondary" href="#/trade?symbol=${encodeURIComponent(r.symbol)}">Trade</a></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nothing matches these filters.</td></tr>';
  };
  $$('.filters input, .filters select').forEach(i => i.oninput = draw);
  $$('th.sortable').forEach(th => th.onclick = () => { sort = { k: th.dataset.k, dir: sort.k === th.dataset.k ? -sort.dir : (th.dataset.k === 'symbol' || th.dataset.k === 'industry' ? 1 : -1) }; draw(); });
  draw();
  // The free price feed allows ~60 requests a minute, so load in paced batches and
  // come back for anything that got rate-limited.
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const stale = () => universe.filter(s => !screenCache[s] || Date.now() - screenCache[s].loaded > 120000);
  for (let pass = 0; pass < 4; pass++) {
    const todo = stale(); if (!todo.length) break;
    if (pass) { if (!$('#srows')) return; $('#sprog').textContent = `Waiting for the free price feed… ${universe.length - todo.length} of ${universe.length} loaded`; await sleep(20000); }
    for (let i = 0; i < todo.length; i += 6) {
      if (!$('#srows')) return;
      $('#sprog').textContent = `Loading prices… ${universe.length - stale().length} of ${universe.length}`;
      const got = await api('/api/quote?symbols=' + encodeURIComponent(todo.slice(i, i + 6).join(','))).catch(() => ({}));
      for (const [s, qq] of Object.entries(got)) screenCache[s] = { ...qq, loaded: Date.now() };
      draw();
      if (i + 6 < todo.length) await sleep(4000);
    }
  }
  if ($('#sprog')) { const left = stale().length; $('#sprog').textContent = left ? `${universe.length - left} of ${universe.length} loaded. The free price feed is busy; refresh in a minute for the rest.` : `Showing live prices for all ${universe.length}`; }
}

// ---------- leaderboard ----------
export async function viewLeaderboard() {
  app().innerHTML = `<div class="view"><div class="page-head"><div><h1>Leaderboard</h1><div class="muted small">Best returns across Bullpen’s 25 newest public games · updates every 5 minutes</div></div></div><div class="card" id="lb"><div class="skeleton" style="height:240px"></div></div></div>`;
  const rows = await api('/api/leaderboard');
  $('#lb').innerHTML = rows.length ? `<div class="table-wrap"><table><thead><tr><th>Rank</th><th>Player</th><th>Game</th><th class="r">Return</th><th class="r">Account value</th><th class="r">Trades</th></tr></thead><tbody>
    ${rows.map(r => `<tr class="link" data-go="#/games/${r.gameId}"><td><span class="rank r${r.rank}">${r.rank}</span></td><td><a class="who" href="#/profile/${encodeURIComponent(r.userId)}">${avatarHtml(r, 28)}<b>${esc(r.name)}</b></a>${r.userId === state.me.id ? ' <span class="badge">You</span>' : ''}</td><td>${esc(r.game)}</td><td class="r ${cls(r.gainPct)}"><b>${pct(r.gainPct)}</b></td><td class="r">${money(r.equity)}</td><td class="r">${r.trades}</td></tr>`).join('')}</tbody></table></div>`
    : '<div class="empty">No one has traded in a public game yet. Join one from Games and be first.</div>';
}

// ---------- friends, invites, challenges ----------
export async function viewFriends() {
  const [friends, { invites }] = await Promise.all([api('/api/friends'), api('/api/notifications')]);
  const me = state.me;
  app().innerHTML = `<div class="view"><div class="page-head"><div><h1>Friends</h1><div class="muted small">${me.handle ? `Your username is <b>@${esc(me.handle)}</b>. Share it so friends can add you.` : '<a href="#/settings?edit=profile">Pick a username</a> so friends can find you.'}</div></div>
      <form id="addF" class="row" style="flex-wrap:nowrap"><input name="h" placeholder="@username" aria-label="Friend’s username" autocomplete="off" style="width:200px"><button class="btn">Add friend</button></form></div>
    ${invites.length ? `<div class="card" style="margin-bottom:var(--gap)"><h2 style="margin-bottom:8px">Invites</h2>${invites.map(i => `<div class="row" style="padding:8px 0">${avatarHtml({ name: i.fromName, picture: i.fromPicture, color: i.fromColor }, 36)}<div style="flex:1"><b>${esc(i.fromName)}</b> ${i.kind === 'challenge' ? 'challenged you' : 'invited you'} to <b>${esc(i.gameName)}</b></div><button class="btn sm" data-acc="${i.id}">Accept</button><button class="btn sm secondary" data-dec="${i.id}">Decline</button></div>`).join('')}</div>` : ''}
    <div class="friend-grid">${friends.map(f => `<div class="card friend">${avatarHtml(f, 64)}<b>${esc(f.name)}</b>${f.handle ? `<div class="muted small">@${esc(f.handle)}</div>` : ''}
      <div class="row" style="justify-content:center;margin-top:10px"><a class="btn sm secondary" href="#/profile/${encodeURIComponent(f.id)}">Profile</a><button class="btn sm" data-ch="${f.id}">Challenge</button><button class="btn sm secondary" data-inv="${f.id}">Invite</button></div>
      <button class="btn ghost sm" data-rm="${f.id}" style="margin-top:4px">Remove</button></div>`).join('') || '<div class="card empty" style="grid-column:1/-1">No friends yet. Add someone by their @username.</div>'}</div></div>`;
  $('#addF').onsubmit = async e => { e.preventDefault(); try { await api('/api/friends', { method: 'POST', body: { handle: e.target.h.value } }); toast('Friend added.'); checkBadges(); route(); } catch (err) { toast(err.message, true); } };
  $$('[data-rm]').forEach(b => b.onclick = async () => { await api(`/api/friends/${b.dataset.rm}`, { method: 'DELETE' }); route(); });
  $$('[data-ch]').forEach(b => b.onclick = () => challengeModal(friends.find(f => f.id === b.dataset.ch)));
  $$('[data-inv]').forEach(b => b.onclick = () => inviteModal({ to: friends.find(f => f.id === b.dataset.inv) }));
  $$('[data-acc]').forEach(b => b.onclick = async () => { try { const r = await api(`/api/invites/${b.dataset.acc}/accept`, { method: 'POST' }); await enterGame(r.gameId); checkBadges(); } catch (err) { toast(err.message, true); } });
  $$('[data-dec]').forEach(b => b.onclick = async () => { await api(`/api/invites/${b.dataset.dec}`, { method: 'DELETE' }); route(); });
}
export function challengeModal(friend) {
  modal(`<h2>Challenge ${esc(friend.name)}</h2><p class="muted small">A private head-to-head game. Same starting cash, best return wins.</p>
    <div class="stack"><div><div class="muted small" style="font-weight:600;margin-bottom:6px">Length</div><div class="seg full" id="chDays">${[1, 3, 7, 14, 30].map(d => `<button type="button" data-v="${d}" class="${d === 7 ? 'on' : ''}">${d}d</button>`).join('')}</div></div>
    <label class="field"><span>Starting cash</span><select id="chCash">${[10000, 50000, 100000, 1000000].map(c => `<option value="${c}" ${c === 100000 ? 'selected' : ''}>${money(c)}</option>`).join('')}</select></label>
    <label class="switch"><div class="t">Allow options</div><input type="checkbox" id="chOpt" checked></label>
    <label class="switch"><div class="t">Allow crypto</div><input type="checkbox" id="chCry" checked></label></div>
    <div class="actions"><button class="btn secondary" data-x>Cancel</button><button class="btn" data-ok>Send challenge</button></div>`, (el, close) => {
    let days = 7;
    $$('#chDays button', el).forEach(b => b.onclick = () => { days = +b.dataset.v; $$('#chDays button', el).forEach(x => x.classList.toggle('on', x === b)); });
    $('[data-x]', el).onclick = close;
    $('[data-ok]', el).onclick = async () => {
      try { const g = await api('/api/challenges', { method: 'POST', body: { to: friend.id, days, startingCash: +$('#chCash', el).value, allowOptions: $('#chOpt', el).checked, allowCrypto: $('#chCry', el).checked } });
        close(); toast(`Challenge sent to ${friend.name}.`); await enterGame(g.id, 'Challenge created. It starts when they accept.'); } catch (err) { toast(err.message, true); }
    };
  });
}
// Invite a friend to a game: pick the game (from a friend card) or the friend (from a game page).
export async function inviteModal({ to, game }) {
  const friends = to ? [to] : await api('/api/friends');
  const games = game ? [game] : state.games.mine.filter(g => !g.sandbox);
  if (!friends.length) return toast('Add friends first, on the Friends page.', true);
  if (!games.length) return toast('Create or join a game first.', true);
  modal(`<h2>Send an invite</h2><div class="stack">
    ${to ? `<div class="row">${avatarHtml(to, 36)}<b>${esc(to.name)}</b></div>` : `<label class="field"><span>Friend</span><select id="ivTo">${friends.map(f => `<option value="${f.id}">${esc(f.name)}${f.handle ? ' (@' + esc(f.handle) + ')' : ''}</option>`).join('')}</select></label>`}
    ${game ? `<div>Game: <b>${esc(game.settings.name)}</b></div>` : `<label class="field"><span>Game</span><select id="ivGame">${games.map(g => `<option value="${g.id}">${esc(g.settings.name)}</option>`).join('')}</select></label>`}</div>
    <div class="actions"><button class="btn secondary" data-x>Cancel</button><button class="btn" data-ok>Send invite</button></div>`, (el, close) => {
    $('[data-x]', el).onclick = close;
    $('[data-ok]', el).onclick = async () => {
      try { await api('/api/invites', { method: 'POST', body: { to: to ? to.id : $('#ivTo', el).value, gameId: game ? game.id : $('#ivGame', el).value } }); close(); toast('Invite sent.'); } catch (err) { toast(err.message, true); }
    };
  });
}

// ---------- game activity feed ----------
export async function mountActivity(host, game) {
  const draw = async () => {
    const items = await api(`/api/games/${game.id}/activity`).catch(() => []);
    const top = items.filter(i => !i.replyTo), replies = id => items.filter(i => i.replyTo === id).sort((a, b) => a.created - b.created);
    const row = (i, nested) => `<div class="act ${nested ? 'reply' : ''}">${avatarHtml(i, nested ? 26 : 34)}<div style="flex:1;min-width:0">
      <div><a href="#/profile/${encodeURIComponent(i.userId)}"><b>${esc(i.name)}</b></a> <span class="${i.type === 'comment' ? '' : 'muted'}">${esc(i.text)}</span></div>
      <div class="muted small">${ago(i.created)}${game.joined && !nested ? ` · <a href="#" data-reply="${i.id}">Reply</a>` : ''}${i.userId === state.me.id ? ` · <a href="#" data-del="${i.id}">Delete</a>` : ''}</div>
      ${nested ? '' : replies(i.id).map(r => row(r, true)).join('')}<div data-box="${i.id}"></div></div></div>`;
    host.innerHTML = `<div class="card-head"><h2>Activity</h2><span class="muted small">Trades, joins and chat</span></div>
      ${game.joined ? '<form id="post" class="row" style="flex-wrap:nowrap;margin-bottom:12px"><input name="t" placeholder="Say something to the group…" maxlength="500" aria-label="Write a comment" style="flex:1"><button class="btn sm">Post</button></form>' : ''}
      <div class="feed">${top.map(i => row(i)).join('') || '<div class="empty">Nothing here yet.</div>'}</div>`;
    const send = async (text, replyTo) => { try { await api(`/api/games/${game.id}/activity`, { method: 'POST', body: { text, replyTo } }); draw(); } catch (err) { toast(err.message, true); } };
    $('#post', host)?.addEventListener('submit', e => { e.preventDefault(); const t = e.target.t.value.trim(); if (t) send(t); });
    $$('[data-reply]', host).forEach(a => a.onclick = e => {
      e.preventDefault(); const box = $(`[data-box="${a.dataset.reply}"]`, host);
      box.innerHTML = '<form class="row" style="flex-wrap:nowrap;margin-top:6px"><input name="t" placeholder="Reply…" maxlength="500" style="flex:1" aria-label="Reply"><button class="btn sm">Reply</button></form>';
      $('input', box).focus();
      $('form', box).onsubmit = ev => { ev.preventDefault(); const t = ev.target.t.value.trim(); if (t) send(t, a.dataset.reply); };
    });
    $$('[data-del]', host).forEach(a => a.onclick = async e => { e.preventDefault(); await api(`/api/games/${game.id}/activity/${a.dataset.del}`, { method: 'DELETE' }); draw(); });
  };
  await draw();
}

// ---------- option strategy builder ----------
const TEMPLATES = {
  long_call: ['Long call', 'Bet on a rise with limited risk.', [['buy', 'C', 0]]],
  long_put: ['Long put', 'Bet on a fall with limited risk.', [['buy', 'P', 0]]],
  covered_call: ['Covered call', 'Own 100 shares and sell a call for income.', [['buy', 'S'], ['sell', 'C', 2]]],
  protective_put: ['Protective put', 'Own 100 shares and insure them with a put.', [['buy', 'S'], ['buy', 'P', -2]]],
  bull_call: ['Bull call spread', 'Cheaper upside bet, capped profit.', [['buy', 'C', 0], ['sell', 'C', 2]]],
  bear_put: ['Bear put spread', 'Cheaper downside bet, capped profit.', [['buy', 'P', 0], ['sell', 'P', -2]]],
  straddle: ['Long straddle', 'Profit from a big move either way.', [['buy', 'C', 0], ['buy', 'P', 0]]],
  strangle: ['Long strangle', 'Cheaper big-move bet with wider break-evens.', [['buy', 'C', 2], ['buy', 'P', -2]]],
  iron_condor: ['Iron condor', 'Earn a capped profit if the stock stays in a range.', [['buy', 'P', -4], ['sell', 'P', -2], ['sell', 'C', 2], ['buy', 'C', 4]]],
};
export async function viewStrategy(q, assetSwitch) {
  const g = activeGame(), s = g.settings;
  const head = `<div class="page-head"><div><div class="muted small">${esc(s.name)}</div><h1>Option strategies</h1></div>${assetSwitch}</div>`;
  if (!s.allowOptions) { app().innerHTML = `<div class="view">${head}<div class="card empty">Options trading is turned off in this game.</div></div>`; return; }
  const st = { sym: (q.get('symbol') || 'SPY').toUpperCase(), exp: '', tpl: q.get('t') || 'bull_call', chain: null, legs: [] };
  app().innerHTML = `<div class="view">${head}<div class="grid g2">
    <div class="card stack"><div class="row"><div style="flex:1;min-width:160px"><div><input id="ssym" value="${esc(st.sym)}" aria-label="Underlying symbol" autocomplete="off"></div></div><select id="sexp" style="width:auto" aria-label="Expiration"></select></div>
      <div class="tpl-grid">${Object.entries(TEMPLATES).map(([k, [n, d]]) => `<button type="button" class="tpl" data-t="${k}"><b>${n}</b><small>${d}</small></button>`).join('')}</div>
      <div id="legs"></div><div id="payoff"></div><div class="chart-tip" id="ptip"></div></div>
    <div class="stack"><div class="card" id="ssum"></div><div class="card small muted">Strategies fill all legs at once at the current bid/ask, during market hours. Prices are modelled with Black-Scholes from the live stock price and its real volatility. Profit and loss shown is at expiration. ${s.allowOptionWriting ? '' : 'This game doesn’t allow uncovered writing, so every sold option must be covered by a bought one (or by shares for calls).'}</div></div></div></div>`;
  const legPrice = l => {
    if (l.t === 'S') return st.chain.quote.price;
    const c = (l.t === 'C' ? st.chain.calls : st.chain.puts).find(x => x.strike === l.k);
    return c ? (l.side === 'buy' ? c.ask : c.bid) : 0;
  };
  const strikes = () => st.chain.calls.map(c => c.strike);
  const applyTpl = () => {
    const ks = strikes(), S = st.chain.quote.price, atm = ks.reduce((b, k, n) => Math.abs(k - S) < Math.abs(ks[b] - S) ? n : b, 0);
    st.legs = TEMPLATES[st.tpl][2].map(([side, t, off]) => t === 'S' ? { side, t, qty: 100 } : { side, t, k: ks[Math.max(0, Math.min(ks.length - 1, atm + off))], qty: 1 });
    $$('.tpl').forEach(b => b.classList.toggle('on', b.dataset.t === st.tpl));
  };
  const payoff = X => st.legs.reduce((a, l) => {
    const sign = l.side === 'buy' ? 1 : -1;
    if (l.t === 'S') return a + sign * l.qty * (X - st.chain.quote.price);
    const intrinsic = Math.max(0, l.t === 'C' ? X - l.k : l.k - X);
    return a + sign * l.qty * 100 * (intrinsic - legPrice(l));
  }, 0);
  const draw = () => {
    const ks = strikes();
    $('#legs').innerHTML = `<table><thead><tr><th>Side</th><th>Type</th><th>Strike</th><th class="r">Qty</th><th class="r">Price</th><th></th></tr></thead><tbody>${st.legs.map((l, n) => `<tr>
      <td><select data-f="side" data-n="${n}" aria-label="Side"><option value="buy" ${l.side === 'buy' ? 'selected' : ''}>Buy</option><option value="sell" ${l.side === 'sell' ? 'selected' : ''}>Sell</option></select></td>
      <td><select data-f="t" data-n="${n}" aria-label="Type"><option value="C" ${l.t === 'C' ? 'selected' : ''}>Call</option><option value="P" ${l.t === 'P' ? 'selected' : ''}>Put</option><option value="S" ${l.t === 'S' ? 'selected' : ''}>Shares</option></select></td>
      <td>${l.t === 'S' ? '—' : `<select data-f="k" data-n="${n}" aria-label="Strike">${ks.map(k => `<option value="${k}" ${k === l.k ? 'selected' : ''}>${money(k)}</option>`).join('')}</select>`}</td>
      <td class="r"><input data-f="qty" data-n="${n}" type="number" min="1" step="1" value="${l.qty}" style="width:76px" aria-label="Quantity"></td>
      <td class="r">${money(legPrice(l), { full: true })}</td><td><button class="btn ghost sm" data-rm="${n}" aria-label="Remove leg">✕</button></td></tr>`).join('')}</tbody></table>
      ${st.legs.length < 4 ? '<button class="btn ghost sm" id="addLeg">+ Add leg</button>' : ''}`;
    $$('#legs [data-f]').forEach(i => i.onchange = () => {
      const l = st.legs[i.dataset.n], f = i.dataset.f;
      l[f] = f === 'k' ? +i.value : f === 'qty' ? Math.max(1, Math.round(+i.value || 1)) : i.value;
      if (f === 't') { if (l.t === 'S') { l.qty = 100; delete l.k; } else { l.k ??= ks[Math.floor(ks.length / 2)]; if (l.qty >= 100) l.qty = 1; } }
      draw();
    });
    $$('#legs [data-rm]').forEach(b => b.onclick = () => { st.legs.splice(+b.dataset.rm, 1); draw(); });
    $('#addLeg')?.addEventListener('click', () => { st.legs.push({ side: 'buy', t: 'C', k: ks[Math.floor(ks.length / 2)], qty: 1 }); draw(); });
    drawPayoff(); drawSummary();
  };
  const drawPayoff = () => {
    const host = $('#payoff'), S = st.chain.quote.price;
    if (!st.legs.length) { host.innerHTML = '<div class="empty">Add a leg to see the payoff.</div>'; return; }
    const lo = S * 0.7, hi = S * 1.3, N = 160, xs = Array.from({ length: N + 1 }, (_, n) => lo + (hi - lo) * n / N), ys = xs.map(payoff);
    let yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys); const pad = (yMax - yMin) * 0.1 || 1; yMin -= pad; yMax += pad;
    const W = host.clientWidth || 560, H = 240, P = { l: 8, r: 8, t: 10, b: 22 };
    const X = x => P.l + (x - lo) / (hi - lo) * (W - P.l - P.r), Y = y => P.t + (1 - (y - yMin) / (yMax - yMin)) * (H - P.t - P.b);
    const line = xs.map((x, n) => `${n ? 'L' : 'M'}${X(x).toFixed(1)},${Y(ys[n]).toFixed(1)}`).join('');
    const area = `${line}L${X(hi)},${Y(0)}L${X(lo)},${Y(0)}Z`;
    host.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Profit or loss at expiration across stock prices">
      <defs><clipPath id="above"><rect x="0" y="0" width="${W}" height="${Y(0)}"/></clipPath><clipPath id="below"><rect x="0" y="${Y(0)}" width="${W}" height="${H}"/></clipPath></defs>
      <path d="${area}" fill="var(--up)" opacity=".16" clip-path="url(#above)"/><path d="${area}" fill="var(--down)" opacity=".16" clip-path="url(#below)"/>
      <line x1="${P.l}" x2="${W - P.r}" y1="${Y(0)}" y2="${Y(0)}" stroke="var(--ink-3)" stroke-width="1"/>
      <line x1="${X(S)}" x2="${X(S)}" y1="${P.t}" y2="${H - P.b}" stroke="var(--ink-3)" stroke-dasharray="3 4"/>
      <path d="${line}" fill="none" stroke="var(--ink)" stroke-width="2" vector-effect="non-scaling-stroke"/>
      ${[lo, S, hi].map((x, n) => `<text x="${X(x)}" y="${H - 6}" text-anchor="${n === 0 ? 'start' : n === 2 ? 'end' : 'middle'}">${n === 1 ? 'Now ' : ''}${money(x)}</text>`).join('')}
      <g class="cross" opacity="0"><line y1="${P.t}" y2="${H - P.b}" stroke="var(--ink-3)"/><circle r="4.5" fill="var(--ink)" stroke="var(--surface)" stroke-width="2"/></g></svg>`;
    const svg = $('svg', host), cross = $('.cross', svg);
    const move = e => {
      const r = svg.getBoundingClientRect(), n = Math.max(0, Math.min(N, Math.round(((e.clientX - r.left) / r.width * W - P.l) / (W - P.l - P.r) * N)));
      cross.setAttribute('opacity', 1); cross.setAttribute('transform', `translate(${X(xs[n])},0)`); $('circle', cross).setAttribute('cy', Y(ys[n]));
      $('#ptip').innerHTML = `If ${esc(st.chain.quote.symbol)} is <b>${money(xs[n], { full: true })}</b> at expiration: <b class="${cls(ys[n])}">${signed(ys[n])}</b>`;
    };
    svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
    svg.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); $('#ptip').textContent = 'Hover the chart to see profit or loss at any price.'; });
    $('#ptip').textContent = 'Hover the chart to see profit or loss at any price.';
  };
  const drawSummary = () => {
    const S = st.chain.quote.price, cost = st.legs.reduce((a, l) => a + (l.side === 'buy' ? 1 : -1) * l.qty * (l.t === 'S' ? 1 : 100) * legPrice(l), 0);
    const samples = Array.from({ length: 2001 }, (_, n) => S * 3 * n / 2000).map(x => [x, payoff(x)]);
    const vals = samples.map(p => p[1]), maxP = Math.max(...vals), minP = Math.min(...vals);
    const rising = payoff(S * 6) > payoff(S * 3) + 0.01, falling = payoff(S * 6) < payoff(S * 3) - 0.01;
    const be = []; for (let n = 1; n < samples.length; n++) if (Math.sign(samples[n][1]) !== Math.sign(samples[n - 1][1]) && samples[n - 1][1] !== 0) be.push(samples[n][0]);
    $('#ssum').innerHTML = `<h3>${esc(TEMPLATES[st.tpl]?.[0] || 'Custom strategy')} on ${esc(st.chain.quote.symbol)}</h3><div class="muted small">${esc(st.chain.quote.name)} · ${money(S, { full: true })} · expires ${st.exp}</div>
      <div class="rows" style="margin-top:12px">
        <div><span class="muted">${cost >= 0 ? 'Net cost (debit)' : 'Net credit'}</span><b>${money(Math.abs(cost), { full: true })}</b></div>
        <div><span class="muted">Max profit</span><b class="up">${rising ? 'Unlimited' : money(maxP, { full: true })}</b></div>
        <div><span class="muted">Max loss</span><b class="down">${falling ? 'Unlimited' : money(Math.abs(Math.min(0, minP)), { full: true })}</b></div>
        <div><span class="muted">Break-even</span><b>${be.length ? be.map(x => money(x, { full: true })).join(' / ') : '—'}</b></div></div>
      <button class="btn block" id="sgo" style="margin-top:14px" ${st.legs.length ? '' : 'disabled'}>Review strategy</button>`;
    $('#sgo').onclick = () => modal(`<h2>Place strategy</h2><div class="rows">${st.legs.map(l => `<div><span>${l.side === 'buy' ? 'Buy' : 'Sell'} ${l.qty} ${l.t === 'S' ? 'shares' : `${money(l.k)} ${l.t === 'C' ? 'call' : 'put'}${l.qty > 1 ? 's' : ''}`}</span><b>${money(legPrice(l), { full: true })}</b></div>`).join('')}
      <div><span class="muted">${cost >= 0 ? 'Total cost' : 'Total credit'}</span><b>${money(Math.abs(cost), { full: true })}</b></div></div>
      <div class="actions"><button class="btn secondary" data-x>Edit</button><button class="btn" data-ok>Place all legs</button></div>`, (el, close) => {
      $('[data-x]', el).onclick = close;
      $('[data-ok]', el).onclick = async () => {
        const legs = st.legs.map(l => l.t === 'S' ? { kind: 'stock', symbol: st.chain.quote.symbol, side: l.side, qty: l.qty } : { kind: 'option', key: `${st.chain.quote.symbol}_${st.exp}_${l.t}_${l.k}`, side: l.side, qty: l.qty });
        try { await api(`/api/games/${g.id}/strategy`, { method: 'POST', body: { legs, name: TEMPLATES[st.tpl]?.[0] || 'custom strategy' } }); close(); toast('Strategy placed.'); checkBadges(); location.hash = '#/portfolio'; }
        catch (err) { toast(err.message, true); }
      };
    });
  };
  const load = async keepLegs => {
    $('#legs').innerHTML = '<div class="skeleton" style="height:120px"></div>';
    try { st.chain = await api(`/api/options/${encodeURIComponent(st.sym)}?exp=${st.exp}`); } catch (e) { $('#legs').innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
    st.exp = st.chain.exp; $('#ssym').value = st.chain.quote.symbol;
    $('#sexp').innerHTML = st.chain.expirations.map(x => `<option value="${x}" ${x === st.exp ? 'selected' : ''}>${new Date(x + 'T12:00:00Z').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })}</option>`).join('');
    if (!keepLegs) applyTpl();
    else st.legs.forEach(l => { if (l.t !== 'S' && !strikes().includes(l.k)) l.k = strikes()[12]; });
    draw();
  };
  $$('.tpl').forEach(b => b.onclick = () => { st.tpl = b.dataset.t; applyTpl(); draw(); });
  $('#sexp').onchange = e => { st.exp = e.target.value; load(true); };
  symbolSearch($('#ssym'), sym => { if (isCrypto(sym)) return toast('Options aren’t available on crypto.', true); st.sym = sym; st.exp = ''; load(); });
  load();
}

// ---------- portfolio analytics ----------
const SERIES = ['var(--series-1)', 'var(--series-2)'];
export function renderAnalytics(pane, pf, g) {
  const classOf = h => h.type === 'CRYPTO' ? 'Crypto' : h.type === 'ETF' ? 'ETFs' : 'Stocks';
  const buckets = (keyFn) => {
    const m = {};
    for (const h of pf.holdings.filter(h => h.qty > 0)) m[keyFn(h)] = (m[keyFn(h)] || 0) + h.value;
    for (const o of pf.options.filter(o => o.qty > 0)) m.Options = (m.Options || 0) + o.value;
    if (pf.cash > 0) m.Cash = pf.cash;
    const total = Object.values(m).reduce((a, b) => a + b, 0) || 1;
    return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, v, v / total * 100]);
  };
  const bars = rows => `<div class="alloc">${rows.map(([k, v, p]) => `<div class="alloc-row" title="${esc(k)}: ${money(v)} (${p.toFixed(1)}%)"><span>${esc(k)}</span><div class="alloc-bar"><i style="width:${Math.max(1, p)}%"></i></div><b class="num">${p.toFixed(1)}%</b></div>`).join('')}</div>`;
  const closed = pf.history.filter(o => o.realized != null && o.status !== 'cancelled');
  const wins = closed.filter(o => o.realized > 0), realized = closed.reduce((a, o) => a + o.realized, 0);
  const fees = pf.history.reduce((a, o) => a + (o.status === 'filled' ? o.fee || 0 : 0), 0);
  const best = [...closed].sort((a, b) => b.realized - a.realized).slice(0, 5), worst = [...closed].sort((a, b) => a.realized - b.realized).filter(o => o.realized < 0).slice(0, 5);
  const tradeRow = o => `<tr><td>${esc(o.asset === 'option' ? o.desc : o.symbol)}</td><td class="muted">${when(o.filledAt)}</td><td class="r ${cls(o.realized)}"><b>${signed(o.realized)}</b></td></tr>`;
  pane.innerHTML = `<div class="grid g4" style="margin-bottom:var(--gap)">${[['Realized P/L', `<span class="${cls(realized)}">${signed(realized)}</span>`], ['Win rate', closed.length ? Math.round(wins.length / closed.length * 100) + '%' : '—'], ['Dividends', money(pf.divPaid || 0)], ['Fees paid', money(fees)]].map(([l, v]) => `<div class="stat"><div class="label">${l}</div><div class="value" style="font-size:1.2rem">${v}</div></div>`).join('')}</div>
    <h3>You vs. the S&P 500</h3><div class="legend"><span><i style="background:${SERIES[0]}"></i>Your portfolio</span><span><i style="background:${SERIES[1]}"></i>S&amp;P 500 (SPY)</span></div><div id="bench"></div><div class="chart-tip" id="btip"></div>
    <div class="grid g-half" style="margin-top:20px"><div><h3 style="margin-bottom:8px">By asset type</h3>${bars(buckets(classOf))}</div><div><h3 style="margin-bottom:8px">By sector</h3>${bars(buckets(h => h.type === 'CRYPTO' ? 'Crypto' : h.industry || (h.type === 'ETF' ? 'Funds' : 'Other')))}</div></div>
    <div class="grid g-half" style="margin-top:20px"><div><h3 style="margin-bottom:6px">Best closed trades</h3>${best.length ? `<table><tbody>${best.map(tradeRow).join('')}</tbody></table>` : '<div class="empty small">No closed trades yet.</div>'}</div>
      <div><h3 style="margin-bottom:6px">Worst closed trades</h3>${worst.length ? `<table><tbody>${worst.map(tradeRow).join('')}</tbody></table>` : '<div class="empty small">No losing trades. Nice.</div>'}</div></div>`;
  // Both lines indexed to % change from the first day we have a benchmark price, on one axis.
  const days = Object.keys(pf.bench).filter(d => pf.snapshots[d] != null).sort();
  const host = $('#bench', pane);
  if (days.length < 2) { host.innerHTML = '<div class="empty">Check back tomorrow. The comparison starts once there are two days of history.</div>'; return; }
  const a = days.map(d => (pf.snapshots[d] / pf.snapshots[days[0]] - 1) * 100), b = days.map(d => (pf.bench[d] / pf.bench[days[0]] - 1) * 100);
  const W = host.clientWidth || 600, H = 220, P = { l: 40, r: 10, t: 10, b: 22 };
  let lo = Math.min(0, ...a, ...b), hi = Math.max(0, ...a, ...b); const pad = (hi - lo) * 0.1 || 1; lo -= pad; hi += pad;
  const X = n => P.l + n / (days.length - 1) * (W - P.l - P.r), Y = v => P.t + (1 - (v - lo) / (hi - lo)) * (H - P.t - P.b);
  const path = arr => arr.map((v, n) => `${n ? 'L' : 'M'}${X(n).toFixed(1)},${Y(v).toFixed(1)}`).join('');
  host.innerHTML = `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Portfolio return compared with the S&P 500">
    ${[hi - pad, 0, lo + pad].map(v => `<line x1="${P.l}" x2="${W - P.r}" y1="${Y(v)}" y2="${Y(v)}" stroke="var(--line)"/><text x="${P.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(1)}%</text>`).join('')}
    <path d="${path(b)}" fill="none" stroke="${SERIES[1]}" stroke-width="2" vector-effect="non-scaling-stroke"/><path d="${path(a)}" fill="none" stroke="${SERIES[0]}" stroke-width="2" vector-effect="non-scaling-stroke"/>
    <text x="${P.l}" y="${H - 6}">${days[0]}</text><text x="${W - P.r}" y="${H - 6}" text-anchor="end">${days[days.length - 1]}</text>
    <g class="cross" opacity="0"><line y1="${P.t}" y2="${H - P.b}" stroke="var(--ink-3)"/><circle class="ca" r="4.5" fill="${SERIES[0]}" stroke="var(--surface)" stroke-width="2"/><circle class="cb" r="4.5" fill="${SERIES[1]}" stroke="var(--surface)" stroke-width="2"/></g></svg>`;
  const svg = $('svg', host), cross = $('.cross', svg);
  const move = e => {
    const r = svg.getBoundingClientRect(), n = Math.max(0, Math.min(days.length - 1, Math.round(((e.clientX - r.left) / r.width * W - P.l) / (W - P.l - P.r) * (days.length - 1))));
    cross.setAttribute('opacity', 1); cross.setAttribute('transform', `translate(${X(n)},0)`); $('.ca', cross).setAttribute('cy', Y(a[n])); $('.cb', cross).setAttribute('cy', Y(b[n]));
    $('#btip').innerHTML = `${days[n]} · You <b>${pct(a[n])}</b> · S&amp;P 500 <b>${pct(b[n])}</b>`;
  };
  svg.addEventListener('pointermove', move); svg.addEventListener('pointerdown', move);
  svg.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); $('#btip').innerHTML = `Since ${days[0]}: you <b class="${cls(a[a.length - 1])}">${pct(a[a.length - 1])}</b>, S&amp;P 500 <b class="${cls(b[b.length - 1])}">${pct(b[b.length - 1])}</b>`; });
  svg.dispatchEvent(new Event('pointerleave'));
}

// ---------- keyboard shortcuts ----------
const SHORTCUTS = [['/', 'Search symbols'], ['g then d', 'Dashboard'], ['g then p', 'Portfolio'], ['g then t', 'Trade'], ['g then r', 'Research'], ['g then s', 'Screener'], ['g then w', 'Watchlist'], ['g then g', 'Games'], ['g then b', 'Leaderboard'], ['g then f', 'Friends'], ['b / s', 'Buy / sell the symbol you’re viewing'], ['o', 'Options for the symbol you’re viewing'], ['a', 'Set a price alert'], ['n', 'Notifications'], ['[', 'Open or close the sidebar'], ['?', 'Show this list']];
const GO = { d: '#/', p: '#/portfolio', t: '#/trade', r: '#/research', s: '#/screener', w: '#/watchlist', g: '#/games', b: '#/leaderboard', f: '#/friends' };
export function mountShortcuts() {
  let pendingG = 0;
  document.addEventListener('keydown', e => {
    if (!state.me || e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable]') || $('.scrim')) return;
    const sym = new URLSearchParams(location.hash.split('?')[1] || '').get('symbol');
    if (Date.now() - pendingG < 1200 && GO[e.key]) { e.preventDefault(); pendingG = 0; location.hash = GO[e.key]; return; }
    pendingG = 0;
    if (e.key === 'g') { pendingG = Date.now(); return; }
    if (e.key === '/') {
      e.preventDefault();
      const box = $('#gsearch');
      box.focus(); box.select();
    } else if ((e.key === 'b' || e.key === 's') && sym) location.hash = `#/trade?symbol=${encodeURIComponent(sym)}&action=${e.key === 'b' ? 'buy' : 'sell'}`;
    else if (e.key === 'o' && sym && !isCrypto(sym)) location.hash = `#/trade?asset=option&symbol=${encodeURIComponent(sym)}`;
    else if (e.key === 'a') location.hash = '#/alerts' + (sym ? `?symbol=${encodeURIComponent(sym)}` : '');
    else if (e.key === 'n') $('#bell')?.click();
    else if (e.key === '?') modal(`<h2>Keyboard shortcuts</h2><div class="rows">${SHORTCUTS.map(([k, d]) => `<div><span>${esc(d)}</span><span>${k.split(' ').map(x => x === 'then' || x === '/' && k !== '/' ? `<span class="muted small"> ${x} </span>` : `<kbd>${esc(x)}</kbd>`).join('')}</span></div>`).join('')}</div><div class="actions"><button class="btn" data-x>Done</button></div>`, (el, close) => { $('[data-x]', el).onclick = close; });
  });
}

// ---------- admin ----------
export async function viewAdmin(q) {
  if (!state.me.admin) { app().innerHTML = '<div class="card empty view">Admin mode is off. Unlock it in Settings.</div>'; return; }
  const tab = q.get('tab') || 'players';
  app().innerHTML = `<div class="view"><div class="page-head"><div><h1>Admin</h1><div class="muted small">Manage every account and game.</div></div>
    <div class="seg"><button data-t="players" class="${tab === 'players' ? 'on' : ''}">Players</button><button data-t="games" class="${tab === 'games' ? 'on' : ''}">Games</button></div></div>
    <div class="card"><input id="afilter" placeholder="Filter" aria-label="Filter" style="max-width:280px;margin-bottom:12px"><div id="alist"><div class="skeleton" style="height:200px"></div></div></div></div>`;
  $$('.page-head .seg button').forEach(b => b.onclick = () => location.hash = '#/admin?tab=' + b.dataset.t);
  const filter = () => { const v = $('#afilter').value.toLowerCase(); $$('#alist tbody tr').forEach(tr => tr.hidden = !tr.textContent.toLowerCase().includes(v)); };
  $('#afilter').oninput = filter;
  if (tab === 'players') {
    const users = await api('/api/admin/users');
    $('#alist').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Player</th><th>Email</th><th>Joined</th><th></th></tr></thead><tbody>
      ${users.map(u => `<tr><td><a class="who" href="#/profile/${encodeURIComponent(u.id)}">${avatarHtml(u, 30)}<span><b>${esc(u.name || 'Unnamed')}</b>${u.handle ? `<div class="muted small">@${esc(u.handle)}</div>` : ''}</span></a></td>
        <td class="muted">${esc(u.email || '—')}</td><td class="muted">${u.joined ? new Date(u.joined).toLocaleDateString() : '—'}</td>
        <td class="r"><button class="btn sm secondary" data-edit="${u.id}">Edit</button> <button class="btn sm danger" data-del="${u.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>`;
    $$('[data-edit]').forEach(b => b.onclick = () => {
      const u = users.find(x => x.id === b.dataset.edit);
      modal(`<h2>Edit ${esc(u.name)}</h2><div class="stack">
        <label class="field"><span>Display name</span><input id="aeName" value="${esc(u.name || '')}" maxlength="40"></label>
        <label class="field"><span>Username</span><input id="aeHandle" value="${esc(u.handle || '')}" maxlength="20"></label>
        <label class="field"><span>Bio</span><textarea id="aeBio" rows="2" maxlength="160">${esc(u.bio || '')}</textarea></label>
        ${u.picture ? '<label class="switch"><div class="t">Remove profile picture</div><input type="checkbox" id="aePic"></label>' : ''}</div>
        <div class="actions"><button class="btn secondary" data-x>Cancel</button><button class="btn" data-ok>Save</button></div>`, (el, close) => {
        $('[data-x]', el).onclick = close;
        $('[data-ok]', el).onclick = async () => {
          try { await api(`/api/admin/users/${u.id}`, { method: 'PATCH', body: { name: $('#aeName', el).value, handle: $('#aeHandle', el).value, bio: $('#aeBio', el).value, removePicture: $('#aePic', el)?.checked } }); close(); toast('Player updated.'); route(); }
          catch (err) { toast(err.message, true); }
        };
      });
    });
    $$('[data-del]').forEach(b => b.onclick = () => {
      const u = users.find(x => x.id === b.dataset.del);
      modal(`<h2>Delete ${esc(u.name)}’s data?</h2><p class="muted">Removes their profile, their portfolios and every game they created. Their sign-in itself stays (Firebase only lets them delete that), but they’ll start fresh.</p>
        <div class="actions"><button class="btn secondary" data-x>Cancel</button><button class="btn danger" data-ok>Delete</button></div>`, (el, close) => {
        $('[data-x]', el).onclick = close;
        $('[data-ok]', el).onclick = async () => { try { await api(`/api/admin/users/${u.id}`, { method: 'DELETE' }); close(); toast('Player data deleted.'); route(); } catch (err) { toast(err.message, true); } };
      });
    });
  } else {
    const games = await api('/api/admin/games');
    $('#alist').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Game</th><th>Creator</th><th class="r">Players</th><th>Status</th><th></th></tr></thead><tbody>
      ${games.map(g => `<tr><td><a href="#/games/${g.id}"><b>${esc(g.name)}</b></a>${g.practice ? ' <span class="badge">Practice</span>' : g.privacy === 'private' ? ' <span class="badge">Private</span>' : ''}</td><td>${esc(g.ownerName)}</td><td class="r">${g.players}</td>
        <td><span class="badge ${g.active ? 'live' : ''}">${g.active ? 'Active' : 'Inactive'}</span></td>
        <td class="r"><button class="btn sm secondary" data-pl="${g.id}">Players</button> <a class="btn sm secondary" href="#/games/${g.id}">Settings</a> <button class="btn sm danger" data-gdel="${g.id}">Delete</button></td></tr>`).join('')}</tbody></table></div>`;
    $$('[data-pl]').forEach(b => b.onclick = () => adminPlayers(games.find(g => g.id === b.dataset.pl)));
    $$('[data-gdel]').forEach(b => b.onclick = () => {
      const g = games.find(x => x.id === b.dataset.gdel);
      modal(`<h2>Delete “${esc(g.name)}”?</h2><p class="muted">Every player’s portfolio in this game is removed. This can’t be undone.</p><div class="actions"><button class="btn secondary" data-x>Cancel</button><button class="btn danger" data-ok>Delete</button></div>`, (el, close) => {
        $('[data-x]', el).onclick = close;
        $('[data-ok]', el).onclick = async () => { try { await api('/api/games/' + g.id, { method: 'DELETE' }); close(); await loadGames(); toast('Game deleted.'); route(); } catch (err) { toast(err.message, true); } };
      });
    });
  }
}
async function adminPlayers(g) {
  const players = await api(`/api/admin/games/${g.id}/players`);
  modal(`<h2>${esc(g.name)}</h2><div class="admin-players">${players.map(p => `<div class="row" style="padding:10px 0;border-bottom:1px solid var(--line);flex-wrap:wrap">
      ${avatarHtml(p, 30)}<div style="flex:1;min-width:120px"><b>${esc(p.name)}</b><div class="muted small">Value ${money(p.equity)} · cash ${money(p.cash)} · ${p.trades} trades</div></div>
      <input type="number" step="any" value="${p.cash.toFixed(2)}" data-cash="${p.userId}" aria-label="Cash for ${esc(p.name)}" style="width:130px">
      <button class="btn sm secondary" data-set="${p.userId}">Set cash</button><button class="btn sm secondary" data-reset="${p.userId}">Reset</button>${p.userId !== g.owner ? `<button class="btn sm danger" data-kick="${p.userId}">Remove</button>` : ''}</div>`).join('') || '<div class="empty">No players.</div>'}</div>
    <div class="actions"><button class="btn" data-x>Done</button></div>`, (el, close) => {
    $('[data-x]', el).onclick = close;
    const act = async (uid, init, msg) => { try { await api(`/api/admin/games/${g.id}/players/${uid}`, init); toast(msg); close(); adminPlayers(g); } catch (err) { toast(err.message, true); } };
    $$('[data-set]', el).forEach(b => b.onclick = () => act(b.dataset.set, { method: 'PATCH', body: { cash: +$(`[data-cash="${b.dataset.set}"]`, el).value } }, 'Cash updated.'));
    $$('[data-reset]', el).forEach(b => b.onclick = () => act(b.dataset.reset, { method: 'PATCH', body: { reset: true } }, 'Portfolio reset.'));
    $$('[data-kick]', el).forEach(b => b.onclick = () => act(b.dataset.kick, { method: 'DELETE' }, 'Player removed.'));
  });
}

const app = () => $('#app');
export { qtyFmt };
export const BADGE_COUNT = BADGES.length;
