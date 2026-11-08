// Accounts and tournaments: sign in with Discord, My tournaments, Create tournament, the tournament page
// (overlay link, stream team and invites, event details) and joining from an invite link.
// Pages are picked by the address: ?view=mine | ?view=new | ?event=<id> | ?invite=<code>
// (the #hash keeps the open tab, as before).

const acct = { token: store(true, 'bdst-session'), user: null, tournaments: [], loaded: false, current: null, invites: null, busy: false };

// Coming back from Discord: #login=<one-time code> or #login-error=<message>. Read it before the tabs use the hash.
const loginReturn = (() => {
  const h = location.hash.slice(1);
  const m = h.match(/^login=([a-f0-9]{32})$/), e = h.match(/^login-error=(.*)$/);
  if (!m && !e) return null;
  history.replaceState(null, '', location.pathname + location.search + (store(true, 'bdst-tab') ? '#' + store(true, 'bdst-tab') : ''));
  return m ? { code: m[1] } : { error: decodeURIComponent(e[1]) };
})();

async function api(path, { method = 'GET', body } = {}) {
  const headers = {};
  if (acct.token) headers.Authorization = 'Bearer ' + acct.token;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    return await relay(path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch (e) {
    if (e.status === 401 && acct.token && path !== '/auth/logout') signedOut();
    throw e;
  }
}

// ---------- who can do what ----------
const passcodeUnlocked = () => !!store(true, 'bdst-admin-ok') && !!adminKey();
function roleFor(meleeId) {
  if (!acct.user || !meleeId) return null;
  const roles = acct.tournaments.filter(t => String(t.meleeId) === String(meleeId)).map(t => t.role);
  return roles.includes('owner') ? 'owner' : roles.length ? 'stream' : null;
}
const canOrganise = () => passcodeUnlocked() || roleFor(state.liveId) === 'owner';
const canStream = () => passcodeUnlocked() || !!roleFor(state.liveId);
const authHeader = () => acct.token ? { Authorization: 'Bearer ' + acct.token } : {};
// The tournament open on this page, if it's the event being followed (for overlay links and Take 30 settings)
const openTournament = () => acct.current && String(acct.current.meleeId) === String(state.liveId) ? acct.current : null;

// ---------- sign in / out ----------
function signIn() {
  store(false, 'bdst-after-login', location.search);
  const back = location.origin + location.pathname;
  location.href = `${RELAY}/auth/discord/start?return=${encodeURIComponent(back)}`;
}
function signedOut() {
  acct.token = ''; acct.user = null; acct.tournaments = []; acct.current = null;
  store(false, 'bdst-session', '');
  afterAccountChange();
}
async function signOut() {
  try { await api('/auth/logout', { method: 'POST' }); } catch (e) {}
  signedOut();
  go({});
  toast('Signed out.');
}
async function loadMe() {
  if (!acct.token) { acct.loaded = true; return; }
  try { const me = await api('/me'); acct.user = me.user; acct.organiser = !!me.organiser; acct.tournaments = me.tournaments; }
  catch (e) { if (e.status !== 401) toast(e.message); }
  acct.loaded = true;
}
function afterAccountChange() {
  renderAccount();
  renderHub();
  renderOrganiser();
  if (state.view) { renderFeaturePicker(); renderPairings(); }
  if (state.liveId) renderStream();
}

// ---------- page address ----------
function route() {
  const p = new URLSearchParams(location.search);
  if (p.get('invite')) return { name: 'invite', code: p.get('invite') };
  if (p.get('event')) return { name: 'event', id: p.get('event') };
  if (p.get('view') === 'new') return { name: 'new' };
  if (p.get('view') === 'mine') return { name: 'mine' };
  return { name: 'home' };
}
function go(params) {
  const q = new URLSearchParams(params).toString();
  history.pushState(null, '', location.pathname + (q ? '?' + q : '') + location.hash);
  renderHub();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
window.addEventListener('popstate', () => renderHub());

// ---------- header: account ----------
function renderAccount() {
  const el = $('acct'); if (!el) return;
  if (!acct.loaded) { el.innerHTML = ''; return; }
  if (!acct.user) {
    el.innerHTML = `<button class="btn ghost acct-in" type="button" data-acct="signin">${DISCORD_ICON}Sign in</button>`;
    return;
  }
  const u = acct.user;
  el.innerHTML = `<div class="acct-menu"><button class="acct-me" type="button" aria-haspopup="menu" aria-expanded="false" data-acct="menu">
      ${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : `<span class="acct-av">${esc(u.name.slice(0, 1).toUpperCase())}</span>`}<span>${esc(u.name)}</span></button>
    <div class="acct-pop" role="menu" hidden>
      <button type="button" role="menuitem" data-acct="mine">My tournaments</button>
      ${acct.organiser ? '<button type="button" role="menuitem" data-acct="new">Create tournament</button>' : ''}
      <button type="button" role="menuitem" data-acct="signout">Sign out</button>
    </div></div>`;
}
const DISCORD_ICON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M20.3 4.4A19.6 19.6 0 0 0 15.4 3l-.6 1.3a18 18 0 0 0-5.6 0L8.6 3a19.5 19.5 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18a19.7 19.7 0 0 0 6 3l1.3-2a12.7 12.7 0 0 1-2-1l.5-.4a14 14 0 0 0 12.2 0l.5.4-2 1 1.3 2a19.6 19.6 0 0 0 6-3c.5-5.1-.8-9.6-3.6-13.6ZM8 15.3c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.5 8 10.5s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z"/></svg>';

// ---------- the hub (above Follow live) ----------
const fmtDate = d => {
  if (!d) return '';
  const t = new Date(d.length === 10 ? d + 'T00:00:00' : d);
  return isNaN(t) ? d : t.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};
const roleLabel = r => r === 'owner' ? 'Owner' : 'Stream team';

function renderHub() {
  const el = $('hub'); if (!el) return;
  const r = route();
  el.classList.toggle('hub-page', true);
  // The event view (tabs, live data, graphics) only shows inside a tournament the user is part of
  document.body.classList.toggle('on-hub-page', r.name !== 'event' || !acct.user || !(acct.current?.id === r.id && acct.current.role));
  if (!acct.loaded) { el.hidden = false; el.innerHTML = '<div class="hub-card"><p class="hint">Loading…</p></div>'; return; }
  el.hidden = false;
  if (r.name !== 'event') stopLive();
  if (r.name === 'invite') return inviteView(el, r.code);
  if (r.name === 'event') return eventView(el, r.id);
  if (!acct.user) return signInView(el, 'The BDST tournament assistant is for our stream team.');
  if (r.name === 'new') return acct.organiser ? createView(el) : noAccessView(el);
  if (!acct.organiser && !acct.tournaments.length) return noAccessView(el);
  return mineView(el, true);
}

function noAccessView(el) {
  el.innerHTML = `<div class="hub-card hub-login">
    <img src="bdst-logo.png" alt="BDST" class="hub-logo">
    <h2>You’re signed in</h2>
    <p>You’re not on a stream team yet. Ask a BDST organiser for an <b>invite link</b>, open it, and the tournament appears here.</p>
    <p class="hint">Signed in as ${esc(acct.user.name)}. <button class="linkbtn" type="button" data-acct="signout">Sign out</button></p></div>`;
}
function signInView(el, why) {
  el.innerHTML = `<div class="hub-card hub-login">
    <img src="bdst-logo.png" alt="BDST" class="hub-logo">
    <h2>Sign in</h2>
    <p>${esc(why)} We use your Discord account, so there’s no new password to remember.</p>
    <button class="btn" type="button" data-acct="signin">${DISCORD_ICON}Sign in with Discord</button>
    <p class="hint">We only see your Discord name and picture. Stream team members get access through an invite link from an organiser.</p></div>`;
}

// My tournaments: full page, or a compact strip on the main page
function mineView(el, full) {
  const list = acct.tournaments;
  const card = t => `<button class="t-card" type="button" data-go-event="${esc(t.id)}">
      <span class="t-role ${t.role}">${roleLabel(t.role)}</span>
      <b>${esc(t.name)}</b><span class="t-meta">${esc([fmtDate(t.date), t.venue].filter(Boolean).join(' · '))}</span></button>`;
  if (!full) {
    const soon = list.slice(0, 3);
    el.innerHTML = `<div class="hub-strip"><div><b>My tournaments</b>${soon.length ? '' : ' · none yet'}</div>
      <div class="hub-strip-list">${soon.map(t => `<button class="chip" type="button" data-go-event="${esc(t.id)}">${esc(t.name)}</button>`).join('')}
      ${list.length > 3 ? `<button class="linkbtn" type="button" data-go="view=mine">All ${list.length}</button>` : ''}</div>
      <button class="btn" type="button" data-go="view=new">+ Create tournament</button></div>`;
    return;
  }
  el.innerHTML = `<div class="hub-card">
    <div class="hub-title"><h2>My tournaments</h2>${acct.organiser ? '<button class="btn" type="button" data-go="view=new">+ Create tournament</button>' : ''}</div>
    ${list.length ? `<div class="t-grid">${list.map(card).join('')}</div>`
      : `<div class="hub-empty"><p><b>No tournaments yet.</b></p><p>${acct.organiser ? 'Create one from its melee.gg link. You get a permanent OBS overlay link and can invite your stream team.' : 'Open an invite link from an organiser to join a stream team.'}</p></div>`}
    </div>`;
}

// Event formats: choosing one sets up how decks are found and what the overlays show
const ALL_SLIDES = ['upnext', 'standings', 'decks', 'race', 'bracket', 'recap', 'aspects'];
const FORMATS = {
  premier: { label: 'Premier', desc: 'Constructed decks. Leaders and bases come from the standings CSV (decklists). The break screen shows deck stats too.',
    settings: { format: 'premier', breakSlides: ALL_SLIDES } },
  limited: { label: 'Limited', desc: 'Sealed or draft, no decklists. Pick each featured player’s leader and base from the set on the Stream tab. The break screen skips deck stats.',
    settings: { format: 'limited', breakSlides: ['upnext', 'standings', 'race', 'bracket', 'recap'] } },
};
const formatOf = s => s?.format === 'limited' ? 'limited' : 'premier';   // older events said "constructed"
const formatPicker = (id, cur) => `<div class="fmt-pick" role="radiogroup" aria-label="Event format" id="${id}">${Object.entries(FORMATS).map(([k, f]) =>
  `<button type="button" role="radio" data-v="${k}" aria-checked="${k === cur}"><b>${f.label}</b><small>${esc(f.desc)}</small></button>`).join('')}</div>`;
function pickFormat(group, b) { for (const x of group.children) x.setAttribute('aria-checked', String(x === b)); }

// Sets for Limited events, newest first (from cards.js)
const limitedSets = () => Object.entries(window.SWU_CARDS?.sets || {}).filter(([code]) => Object.values(SWU_CARDS.leaders).some(c => (c.s || []).includes(code)))
  .sort((a, b) => String(b[1].d).localeCompare(String(a[1].d)));
const setSelect = (id, cur) => `<select id="${id}">${limitedSets().map(([code, x]) => `<option value="${code}" ${code === cur ? 'selected' : ''}>${esc(x.n)}</option>`).join('')}</select>`;

// ---------- create ----------
function createView(el) {
  el.innerHTML = `<form class="hub-card hub-form" id="t-create" novalidate>
    <div class="hub-title"><h2>Create tournament</h2></div>
    <p class="hint">melee.gg runs the pairings and results. This saves the event and its stream settings so you and your team can open it in one click.</p>
    <div class="fld"><span>What kind of event?</span>${formatPicker('tc-fmt', 'premier')}</div>
    <label class="fld" id="tc-set-wrap" hidden><span>Set</span>${setSelect('tc-set', limitedSets()[0]?.[0])}</label>
    <label class="fld"><span>melee.gg link <em>required</em></span>
      <input id="tc-melee" type="url" inputmode="url" required placeholder="https://melee.gg/Tournament/View/457640" autocomplete="off">
      <small id="tc-found" aria-live="polite"></small></label>
    <div class="fld-row">
      <label class="fld"><span>Name</span><input id="tc-name" maxlength="80" placeholder="Filled in from melee.gg"></label>
      <label class="fld"><span>Date</span><input id="tc-date" type="date"></label>
    </div>
    <label class="fld"><span>Store or venue</span><input id="tc-venue" maxlength="80" placeholder="e.g. Good Games Brisbane"></label>
    <div class="fld-row">
      <div class="fld"><span>Matches are</span><div class="seg" role="group" aria-label="Best of" id="tc-bo">
        <button type="button" data-v="1" aria-pressed="false">Best of 1</button><button type="button" data-v="3" aria-pressed="true">Best of 3</button></div></div>
      <label class="fld"><span>Top cut</span><select id="tc-cut"><option value="0">No cut</option><option value="4">Top 4</option><option value="8" selected>Top 8</option><option value="16">Top 16</option><option value="32">Top 32</option></select></label>
    </div>
    <div class="hub-actions"><button class="btn" type="submit" id="tc-go">Create tournament</button>
      <button class="linkbtn" type="button" data-go="view=mine">Cancel</button><span class="hint err" id="tc-msg" aria-live="polite"></span></div>
  </form>`;
  let looked = null;
  const lookup = async () => {
    const tid = parseTournament($('tc-melee').value);
    const found = $('tc-found');
    if (!tid) { found.textContent = $('tc-melee').value.trim() ? 'That doesn’t look like a melee.gg tournament link.' : ''; return; }
    if (looked === tid) return;
    looked = tid; found.textContent = 'Looking it up…';
    try {
      const t = await relay('/tournament/' + tid);
      if (looked !== tid) return;
      found.textContent = `Found: ${t.name}${t.rounds?.length ? ` · ${t.rounds.length} rounds so far` : ''}`;
      if (!$('tc-name').value) $('tc-name').value = t.name || '';
      if (!$('tc-date').value && t.date) $('tc-date').value = String(t.date).slice(0, 10);
    } catch (e) { if (looked === tid) found.textContent = 'Couldn’t find that tournament on melee.gg. Check the link.'; }
  };
  $('tc-melee').addEventListener('change', lookup);
  $('tc-melee').addEventListener('paste', () => setTimeout(lookup, 0));
  $('tc-fmt').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; pickFormat($('tc-fmt'), b); $('tc-set-wrap').hidden = b.dataset.v !== 'limited'; });
  $('tc-bo').addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; for (const x of $('tc-bo').children) x.setAttribute('aria-pressed', String(x === b)); });
  $('t-create').addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('tc-msg');
    if (!parseTournament($('tc-melee').value)) { msg.textContent = 'Paste the melee.gg tournament link first.'; $('tc-melee').focus(); return; }
    $('tc-go').disabled = true; msg.textContent = 'Creating…';
    try {
      const t = await api('/t', { method: 'POST', body: {
        melee: $('tc-melee').value, name: $('tc-name').value, date: $('tc-date').value, venue: $('tc-venue').value,
        bestOf: Number($('tc-bo').querySelector('[aria-pressed="true"]').dataset.v), topCut: Number($('tc-cut').value),
        settings: (k => ({ ...FORMATS[k].settings, ...(k === 'limited' ? { cardSet: $('tc-set').value } : {}) }))($('tc-fmt').querySelector('[aria-checked="true"]').dataset.v),
      } });
      acct.tournaments.unshift(t);
      toast(`Created ${t.name}`);
      go({ event: t.id });
    } catch (err) { msg.textContent = err.message; $('tc-go').disabled = false; }
  });
  $('tc-melee').focus();
}

// ---------- the tournament page ----------
async function eventView(el, id) {
  if (!acct.current || acct.current.id !== id) {
    el.innerHTML = '<div class="hub-card"><p class="hint">Loading the tournament…</p></div>';
    try { acct.current = await api('/t/' + id); acct.invites = null; }
    catch (e) { el.innerHTML = `<div class="hub-card"><h2>Can’t open this tournament</h2><p>${esc(e.message)}</p><button class="btn ghost" type="button" data-go="${acct.user ? 'view=mine' : ''}">Back</button></div>`; return; }
    const t = acct.current;
    if (!t.role) {
      el.innerHTML = acct.user
        ? `<div class="hub-card"><h2>${esc(t.name)}</h2><p>You’re not on this tournament’s stream team. Ask its owner for an invite link.</p><button class="btn ghost" type="button" data-go="view=mine">My tournaments</button></div>`
        : ''; if (!acct.user) signInView(el, `Sign in to open ${t.name}.`);
      return;
    }
    // Load the melee.gg event below and bring in the team's shared Take 30 settings
    document.body.classList.remove('on-hub-page');
    applyTournamentSettings(t);
    if (String(state.liveId) !== String(t.meleeId)) follow(String(t.meleeId));
    else afterAccountChange();
    if (t.role === 'owner') loadInvites();
  }
  drawEvent(el);
}

function overlayUrl(type, t = openTournament()) {
  const base = location.origin + location.pathname;
  const extra = { standings: '&n=8', decks: '&n=8' }[type] || '';
  return `${base}?overlay=${type}&k=${t.overlayKey}${extra}`;
}

// ---------- Live control: one OBS link (?overlay=program), scenes switched from here ----------
const SCENES = [
  { group: 'Over the camera', items: [
    { key: 'camera', label: 'Camera only', scene: { mode: 'camera' } },
    { key: 'feature', label: 'Feature match', scene: { mode: 'feature' }, hint: 'banner, base counters and pips' },
  ] },
  { group: 'Full screen', items: [
    { key: 'break', label: 'Break screen', scene: { mode: 'break' }, hint: 'cycles through the slides' },
    { key: 'slide:upnext', label: 'Feature match card', scene: { mode: 'slide', slide: 'upnext' } },
    { key: 'slide:standings', label: 'Standings', scene: { mode: 'slide', slide: 'standings' } },
    { key: 'slide:decks', label: 'Most played decks', scene: { mode: 'slide', slide: 'decks' } },
    { key: 'slide:race', label: 'Top cut race', scene: { mode: 'slide', slide: 'race' } },
    { key: 'slide:bracket', label: 'Bracket', scene: { mode: 'slide', slide: 'bracket' } },
    { key: 'slide:recap', label: 'Round recap', scene: { mode: 'slide', slide: 'recap' } },
    { key: 'slide:aspects', label: 'Aspects', scene: { mode: 'slide', slide: 'aspects' } },
  ] },
  { group: 'Holding card', items: [
    { key: 'hold:Starting soon', label: 'Starting soon', scene: { mode: 'hold', title: 'Starting soon' } },
    { key: 'hold:Back soon', label: 'Back soon', scene: { mode: 'hold', title: 'Back soon' } },
  ] },
];
const sceneKey = sc => !sc?.mode ? 'feature' : sc.mode === 'slide' ? 'slide:' + sc.slide : sc.mode === 'hold' ? 'hold:' + (sc.title || 'Back soon') : sc.mode;
const sceneLabel = sc => SCENES.flatMap(g => g.items).find(i => i.key === sceneKey(sc))?.label || 'Feature match';

function liveControlHtml(t) {
  const prog = overlayUrl('program', t);
  const showPrev = store(true, 'bdst-lc-preview') !== 'off';
  return foldBox('lc', 'Live control', `
    <div class="lc-replay" id="lc-replay" hidden></div>
    <div class="lc-main ${showPrev ? '' : 'no-prev'}">
      ${showPrev ? `<div class="lc-prev"><div class="lc-slot" id="lc-slot"></div><span class="lc-cam" aria-hidden="true">camera</span></div>` : ''}
      <div class="lc-groups">${SCENES.map(g => `<div class="lc-group"><h4>${g.group}</h4><div class="lc-btns">${g.items.map(i =>
        `<button type="button" class="lc-btn" data-scene="${esc(i.key)}" aria-pressed="false">${esc(i.label)}${i.hint ? `<small>${esc(i.hint)}</small>` : ''}</button>`).join('')}
        ${g.group === 'Holding card' ? `<label class="lc-timer">Countdown <select id="lc-mins"><option value="0">No timer</option>${[2, 5, 10, 15, 20, 30].map(n => `<option value="${n}" ${n === 10 ? 'selected' : ''}>${n} min</option>`).join('')}</select></label>` : ''}</div></div>`).join('')}
        <div class="lc-group"><h4>Round clock <span class="lc-clock" id="lc-clock"></span></h4><div class="lc-btns">
          <label class="lc-timer">Round length <select id="lc-clock-mins" aria-label="Round length">${[30, 40, 45, 50, 55, 60, 75, 90].map(n => `<option value="${n}" ${n === (t.settings?.roundMins || 50) ? 'selected' : ''}>${n} min</option>`).join('')}</select></label>
          <button type="button" class="lc-btn sm" data-clock="start">Start</button>
          <button type="button" class="lc-btn sm" data-clock="-1" aria-label="One minute less">−1 min</button>
          <button type="button" class="lc-btn sm" data-clock="1" aria-label="One minute more">+1 min</button>
          <button type="button" class="lc-btn sm" data-clock="clear">Clear</button></div></div>
        <p class="hint lc-more">Pick the feature match, swap sides, set games won and run Take 30 in the <button class="linkbtn" type="button" data-acct="controls">Stream tab ↓</button></p></div>
    </div>
    <div class="copyline"><code>${esc(prog.replace(/k=[a-f0-9]+/, 'k=••••••'))}</code><button class="btn ghost sm" type="button" data-copy="${esc(prog)}">Copy OBS link</button></div>
    <p class="hint">The <b>only link OBS needs</b>: add it as a Browser Source (1920 × 1080) above your camera. Anyone on the stream team can switch scenes from any browser; the stream changes within a second. Keep it private.
      <button class="linkbtn" type="button" data-acct="toggle-preview">${showPrev ? 'Hide preview' : 'Show preview'}</button></p>
    <label class="switch"><input type="checkbox" id="lc-follow-replay" ${followReplayOn() ? 'checked' : ''}><span class="track-sw" aria-hidden="true"></span>When I pick “Show the event as it was after” an earlier round, show that on stream too</label>`,
    { cls: 'live-ctl', head: `<span class="lc-onair" id="lc-onair" aria-live="polite"></span><span class="lc-conn" id="lc-conn" title="Connection to the stream">Connecting…</span>` });
}
// A box with a minimise arrow; open or closed is remembered in this browser
const foldOpen = (key, closed) => { const v = store(true, 'bdst-fold-' + key); return v ? v === 'open' : !closed; };
function foldBox(key, title, body, { closed = false, cls = '', head = '', meta = '' } = {}) {
  const open = foldOpen(key, closed);
  return `<section class="ev-box fold ${cls} ${open ? '' : 'folded'}" data-fold="${key}">
    <div class="fold-top"><button class="fold-h" type="button" data-fold-toggle aria-expanded="${open}"><i class="fold-chev" aria-hidden="true"></i><h3>${title}</h3>${meta ? `<small>${esc(meta)}</small>` : ''}</button>${head}</div>
    <div class="fold-b">${body}</div></section>`;
}
document.addEventListener('click', e => {
  const b = e.target.closest('[data-fold-toggle]'); if (!b) return;
  const box = b.closest('[data-fold]'); const open = box.classList.toggle('folded') === false;
  b.setAttribute('aria-expanded', String(open));
  store(false, 'bdst-fold-' + box.dataset.fold, open ? 'open' : 'closed');
  if (open) fitPreview();
});
// Static boxes (the Stream tab): set them open or closed as remembered
function applyFolds(root = document) {
  root.querySelectorAll('[data-fold]').forEach(box => {
    const open = foldOpen(box.dataset.fold, box.dataset.foldClosed === '1');
    box.classList.toggle('folded', !open);
    box.querySelector('[data-fold-toggle]')?.setAttribute('aria-expanded', String(open));
  });
}
function fitPreview() {
  const slot = $('lc-slot'), f = $('lc-frame'); if (!slot || !f) return;
  f.style.transform = `scale(${slot.clientWidth / 1920})`;
}
addEventListener('resize', fitPreview);
// One live connection per open tournament page: keeps the ON AIR buttons right when a teammate switches scenes
function startLive(t) {
  if (acct.live?.tid === t.meleeId) return;
  stopLive();
  const live = { tid: t.meleeId, value: null, ok: false };
  live.stop = liveFeature(t.meleeId, v => {
    live.value = v; live.ok = true; markScene();
    // Keep the Stream tab's feature match controls in step with the rest of the team
    if (String(state.liveId) === String(t.meleeId)) { state.featureSel = v; if (state.view && !document.activeElement?.closest('#feature-picker')) renderFeaturePicker(); }
  }, t.overlayKey);
  // Connection status from the socket's own events isn't exposed; treat a recent message as connected
  acct.live = live;
}
function stopLive() { if (acct.live) { acct.live.stop(); acct.live = null; } }
// Replays on stream: the asof selector (Follow live) also sets what the stream shows, unless switched off
const followReplayOn = () => store(true, 'bdst-lc-follow-replay') !== 'off';
document.addEventListener('change', e => { if (e.target.id === 'lc-follow-replay') store(false, 'bdst-lc-follow-replay', e.target.checked ? '' : 'off'); });
async function streamFollowReplay(roundId) {
  const t = openTournament(); if (!t || !canStream() || !followReplayOn()) return;
  if ((acct.live?.value?.asOf || null) === (roundId || null)) return;
  try {
    const v = await saveStreamAsOf(t.meleeId, roundId);
    if (acct.live) acct.live.value = v;
    markScene();
    const r = roundId && state.live?.rounds.find(x => x.id === Number(roundId));
    toast(r ? `The stream now shows the event as it was after ${r.name}.` : 'The stream is back to live.');
  } catch (e) { toast(e.message); }
}
function markReplay() {
  const el = $('lc-replay'); if (!el) return;
  const id = acct.live?.value?.asOf || acct.live?.value?.round || null;
  const r = id && state.live?.rounds.find(x => x.id === Number(id));
  el.hidden = !id;
  el.innerHTML = id ? `<span><b>Replay on stream:</b> everything shows the event as it was after <b>${esc(r?.name || 'an earlier round')}</b>.</span>
    <button class="btn sm" type="button" data-acct="stream-live">Back to live</button>` : '';
}
// Round clock: shown on the feature match (side panels layout)
function markClock() {
  const el = $('lc-clock'); if (!el) return;
  const c = String(state.liveId) === String(acct.current?.meleeId) ? roundClock(acct.live?.value) : (acct.live?.value?.clock?.endsAt ? { ...acct.live.value.clock, source: 'manual' } : null);
  if (!c) { el.textContent = `not started · showing ${acct.current?.settings?.roundMins || 50}:00`; el.className = 'lc-clock'; return; }
  const left = Math.round((c.endsAt - Date.now()) / 1000);
  el.textContent = (left > 0 ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')} left` : 'Time') + (c.source === 'melee' ? ' · from melee.gg' : '');
  el.className = 'lc-clock on' + (left <= 0 ? ' over' : '');
}
setInterval(markClock, 1000);
document.addEventListener('change', e => { if (e.target.id === 'lc-clock-mins') { saveSettings({ roundMins: Number(e.target.value) }); markClock(); } });
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-clock]'); if (!b || !acct.current) return;
  const k = b.dataset.clock;
  const clock = k === 'clear' ? null : k === 'start' ? { mins: Number($('lc-clock-mins').value) } : { add: Number(k) };
  if (clock?.add && !acct.live?.value?.clock) { toast('Start the round clock first.'); return; }
  try { const v = await saveClock(acct.current.meleeId, clock); if (acct.live) acct.live.value = v; markClock(); }
  catch (err) { toast(err.message); }
});
function markScene() {
  markReplay();
  markClock();
  const sc = acct.live?.value?.scene || acct.pendingScene || null;
  const key = acct.pendingScene ? sceneKey(acct.pendingScene) : sceneKey(sc);
  document.querySelectorAll('[data-scene]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.scene === key)));
  const onair = $('lc-onair'); if (onair) onair.innerHTML = `<i></i>On air: <b>${esc(sceneLabel(acct.pendingScene || sc))}</b>`;
  const conn = $('lc-conn'); if (conn) { conn.textContent = acct.live?.ok ? 'Live' : 'Connecting…'; conn.classList.toggle('ok', !!acct.live?.ok); }
}
async function pickScene(key) {
  const t = acct.current; if (!t) return;
  const item = SCENES.flatMap(g => g.items).find(i => i.key === key); if (!item) return;
  const scene = { ...item.scene };
  if (scene.mode === 'hold') { const mins = Number($('lc-mins')?.value || 0); if (mins) scene.until = Date.now() + mins * 60000; }
  acct.pendingScene = scene; markScene();
  try { const v = await saveScene(t.meleeId, scene); if (acct.live) acct.live.value = v; }
  catch (e) { toast(e.message); }
  finally { acct.pendingScene = null; markScene(); }
}
document.addEventListener('click', e => { const b = e.target.closest('[data-scene]'); if (b) pickScene(b.dataset.scene); });

// ---------- logos ----------
const LOGO_SLOTS = [['store', 'Store logo', 'Left side of the feature match'], ['creator', 'Content creator logo', 'Right side of the feature match']];
const logoUrl = (t, slot) => t?.settings?.logos?.[slot] ? `${RELAY}/logo/${t.id}/${slot}?v=${t.settings.logos[slot]}` : null;
// Shrink big images in the browser first (logos never need more than 1200 × 600) and keep transparency
async function shrinkLogo(file, slot) {
  if (file.type === 'image/gif') return file;   // keep animations as they are
  const bmp = await createImageBitmap(file);
  if (slot === 'wallpaper') {
    // A full-screen background: 1920 wide is plenty, and a JPEG keeps it small (no transparency needed)
    const k = Math.min(1, 1920 / bmp.width, 1440 / bmp.height);
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    return new Promise(r => c.toBlob(r, 'image/jpeg', .86));
  }
  const k = Math.min(1, 1200 / bmp.width, 600 / bmp.height);
  if (k === 1 && file.size < 600 * 1024) return file;
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  let blob = await new Promise(r => c.toBlob(r, 'image/png'));
  if (blob.size > 1.8 * 1024 * 1024) blob = await new Promise(r => c.toBlob(r, 'image/webp', .9));
  return blob;
}
document.addEventListener('change', async e => {
  const input = e.target.closest('input[data-logo]'); if (!input || !input.files[0] || !acct.current) return;
  const slot = input.dataset.logo, file = input.files[0];
  if (!/^image\/(png|jpeg|webp|gif)$/.test(file.type)) { toast('Use a PNG, JPG, WebP or GIF image.'); return; }
  toast('Uploading logo…');
  try {
    const blob = await shrinkLogo(file, slot);
    acct.current = await relay(`/t/${acct.current.id}/logos/${slot}`, { method: 'PUT', headers: { ...authHeader(), 'Content-Type': blob.type || file.type }, body: blob });
    syncListed(acct.current); drawEvent(); toast(`${slot === 'wallpaper' ? 'Wallpaper' : 'Logo'} saved. It shows on stream within 30 seconds.`);
  } catch (err) { toast(err.message); }
});
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-logo-remove]'); if (!b || !acct.current) return;
  try { acct.current = await api(`/t/${acct.current.id}/logos/${b.dataset.logoRemove}`, { method: 'DELETE' }); syncListed(acct.current); drawEvent(); toast('Removed.'); }
  catch (err) { toast(err.message); }
});

const BREAK_SLIDE_INFO = [
  ['upnext', 'Feature match', 'the match on the feature table, while a round is on'],
  ['standings', 'Standings', 'top 8 with decks'],
  ['decks', 'Most played decks', 'top 8 decks with share'],
  ['race', 'Top cut race', 'during Swiss: who’s locked in, alive or out'],
  ['bracket', 'Bracket', 'once Swiss is finished'],
  ['recap', 'Round recap', 'undefeated players, upsets, deck of the round'],
  ['aspects', 'Aspects', 'colours in the room'],
];
const breakSlidesOf = s => s.breakSlides?.length ? s.breakSlides : BREAK_SLIDE_INFO.map(x => x[0]);

function drawEvent(el = $('hub')) {
  const t = acct.current; if (!t || !t.role) return;
  // Keep the live preview running across redraws (rebuilding it would reload the whole overlay)
  const keepFrame = el.querySelector('#lc-frame');
  if (keepFrame) keepFrame.remove();
  const owner = t.role === 'owner';
  const s = t.settings || {};
  const inviteBase = location.origin + location.pathname + '?invite=';
  const invites = acct.invites;
  el.innerHTML = `<div class="hub-card ev">
    <p class="hint"><button class="linkbtn" type="button" data-go="view=mine">← My tournaments</button></p>
    <div class="ev-head"><div><h2>${esc(t.name)}</h2>
      <p class="ev-meta">${esc([fmtDate(t.date), t.venue, formatOf(s) === 'limited' ? `Limited${s.cardSet ? ' · ' + (window.SWU_CARDS?.sets?.[s.cardSet]?.n || s.cardSet) : ''}` : 'Premier', `Best of ${t.bestOf}`, t.topCut ? `Top ${t.topCut}` : 'No cut'].filter(Boolean).join(' · '))} · <a href="https://melee.gg/Tournament/View/${t.meleeId}" target="_blank" rel="noopener">melee.gg ↗</a></p></div>
      <span class="t-role ${t.role}">${owner ? 'You own this' : 'Stream team'}</span></div>

    ${liveControlHtml(t)}

    <div class="ev-grid">
      ${foldBox('ovs', 'Overlay settings', `
        <h4 class="ev-sub">Feature match</h4>
        <div class="fld"><span>Layout</span><div class="seg" role="group" aria-label="Feature match layout" id="ev-layout">
          <button type="button" data-v="sides" aria-pressed="${s.layout !== 'banner'}">Side panels</button><button type="button" data-v="banner" aria-pressed="${s.layout === 'banner'}">Banner</button></div></div>
        <label class="switch"><input type="checkbox" id="ev-cams" ${s.cams ? 'checked' : ''}><span class="track-sw" aria-hidden="true"></span>Leave a window in each side panel for a player camera</label>
        <div class="fld-row">
          <label class="fld"><span>Mat size on screen (px)</span><input id="ev-mat" type="number" min="600" max="1500" step="10" value="${esc(s.mat || 1080)}"></label>
          <div class="fld"><span>Banner position (banner layout)</span><div class="seg" role="group" aria-label="Banner position" id="ev-pos">
            <button type="button" data-v="top" aria-pressed="${s.pos !== 'bottom'}">Top</button><button type="button" data-v="bottom" aria-pressed="${s.pos === 'bottom'}">Bottom</button></div></div>
        </div>
        <h4 class="ev-sub">Break screen slides</h4>
        <p class="hint">The break screen cycles through these, skipping any with nothing to show yet.</p>
        <div class="brk-pick" id="ev-slides">${BREAK_SLIDE_INFO.map(([id, label, hint]) => `<label class="switch"><input type="checkbox" value="${id}" ${breakSlidesOf(s).includes(id) ? 'checked' : ''}><span class="track-sw" aria-hidden="true"></span><span>${label}<small>${hint}</small></span></label>`).join('')}</div>
        <label class="fld sec-fld"><span>Seconds per slide</span><input id="ev-sec" type="number" min="5" max="120" step="1" value="${esc(s.breakSeconds || 15)}"></label>
        <p class="hint">Saved for the whole team; OBS picks changes up within 30 seconds.${owner ? ' <button class="linkbtn" type="button" data-acct="rekey">Make a new OBS link</button> if the current one has leaked (the old one stops working).' : ''}</p>`)}

      ${foldBox('logos', 'Logos & wallpaper', `
        <p class="hint">Logos show on the feature match (bottom of the right panel), the break screen and the starting/back soon cards. A PNG with a transparent background looks best. New tournaments start with your latest logos and wallpaper.</p>
        <div class="logo-slots">${LOGO_SLOTS.map(([slot, label, where]) => { const url = logoUrl(t, slot); return `<div class="logo-slot">
          <div class="logo-prev">${url ? `<img src="${esc(url)}" alt="${esc(label)}">` : `<span>No ${esc(label.toLowerCase())}</span>`}</div>
          <div class="logo-info"><b>${esc(label)}</b><small>${esc(where)}</small>
            <div class="logo-btns"><label class="btn ghost sm logo-up">${url ? 'Replace' : 'Upload'}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" data-logo="${slot}" hidden></label>
            ${url ? `<button class="linkbtn" type="button" data-logo-remove="${slot}">Remove</button>` : ''}</div></div></div>`; }).join('')}</div>
        <h4 class="ev-sub">Wallpaper</h4>
        <div class="logo-slot wall-slot"><div class="logo-prev wall-prev" style="--dim:${(s.wallDim ?? 55) / 100}">${logoUrl(t, 'wallpaper') ? `<img src="${esc(logoUrl(t, 'wallpaper'))}" alt="Wallpaper">` : '<span>No wallpaper (plain dark background)</span>'}<i class="wall-dim" aria-hidden="true"></i></div>
          <div class="logo-info"><b>Background</b><small>Behind the break screen, single slides and the starting/back soon cards. 1920 × 1080 works best.</small>
            <div class="logo-btns"><label class="btn ghost sm logo-up">${logoUrl(t, 'wallpaper') ? 'Replace' : 'Upload'}<input type="file" accept="image/png,image/jpeg,image/webp" data-logo="wallpaper" hidden></label>
            ${logoUrl(t, 'wallpaper') ? '<button class="linkbtn" type="button" data-logo-remove="wallpaper">Remove</button>' : ''}</div>
            ${logoUrl(t, 'wallpaper') ? `<label class="fld wall-dim-fld"><span>Darken so text stays readable: <output id="ev-dim-out">${s.wallDim ?? 55}%</output></span><input id="ev-dim" type="range" min="0" max="90" step="5" value="${s.wallDim ?? 55}"></label>` : ''}</div></div>`,
        { meta: `${Object.keys(s.logos || {}).filter(k => k !== 'wallpaper').length} of 2 logos${s.logos?.wallpaper ? ' · wallpaper' : ''}` })}

      ${foldBox('team', 'Stream team', `
        <ul class="team-list">${(t.team || []).map(u => `<li>${u.avatar ? `<img src="${esc(u.avatar)}" alt="">` : `<span class="acct-av">${esc(u.name.slice(0, 1).toUpperCase())}</span>`}
          <span class="who"><b>${esc(u.name)}</b><small>${u.role === 'owner' ? 'Owner' : 'Stream team'}${u.id === acct.user.id ? ' · you' : ''}</small></span>
          ${u.role !== 'owner' && (owner || u.id === acct.user.id) ? `<button class="linkbtn" type="button" data-remove="${esc(u.id)}" data-name="${esc(u.name)}">${u.id === acct.user.id ? 'Leave' : 'Remove'}</button>` : ''}</li>`).join('')}</ul>
        ${owner ? `<div class="invites">
          <button class="btn ghost sm" type="button" data-acct="invite">+ Invite link</button>
          <p class="hint">Anyone with the link can join for 7 days (up to 25 people). The stream team can run the stream, but can’t edit or delete the event or invite others.</p>
          ${invites === null ? '' : invites.length ? invites.map(i => `<div class="copyline inv"><code>${esc(inviteBase + i.code)}</code>
            <button class="btn ghost sm" type="button" data-copy="${esc(inviteBase + i.code)}">Copy</button>
            <button class="linkbtn" type="button" data-cancel-invite="${esc(i.code)}">Cancel</button>
            <small>${i.uses} joined · expires ${esc(new Date(i.expires).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }))}</small></div>`).join('') : ''}
        </div>` : ''}`, { meta: `${(t.team || []).length}` })}

      ${owner ? foldBox('details', 'Event details', `
        <form id="ev-edit" class="hub-form" novalidate>
          <label class="fld"><span>Name</span><input id="ee-name" maxlength="80" value="${esc(t.name)}"></label>
          <div class="fld-row"><label class="fld"><span>Date</span><input id="ee-date" type="date" value="${esc(t.date || '')}"></label>
            <label class="fld"><span>Store or venue</span><input id="ee-venue" maxlength="80" value="${esc(t.venue || '')}"></label></div>
          <div class="fld-row"><label class="fld"><span>Matches are</span><select id="ee-bo">${[1, 3].map(n => `<option value="${n}" ${t.bestOf === n ? 'selected' : ''}>Best of ${n}</option>`).join('')}</select></label>
            <label class="fld"><span>Top cut</span><select id="ee-cut">${[0, 4, 8, 16, 32].map(n => `<option value="${n}" ${t.topCut === n ? 'selected' : ''}>${n ? 'Top ' + n : 'No cut'}</option>`).join('')}</select></label></div>
          <div class="fld"><span>Format</span>${formatPicker('ee-fmt', formatOf(s))}</div>
          <label class="fld" id="ee-set-wrap" ${formatOf(s) === 'limited' ? '' : 'hidden'}><span>Set (Limited)</span>${setSelect('ee-set', s.cardSet || limitedSets()[0]?.[0])}</label>
          <label class="fld"><span>melee.gg link</span><input id="ee-melee" type="url" value="https://melee.gg/Tournament/View/${t.meleeId}"></label>
          <div class="hub-actions"><button class="btn ghost sm" type="submit">Save changes</button><span class="hint" id="ee-msg" aria-live="polite"></span></div>
        </form>
        <p class="hint">${formatOf(s) === 'limited'
          ? 'Decks: pick each player’s leader and base on the <b>Stream</b> tab → <b>Decks</b>. Uploading the standings CSV is optional (it has no decks in Limited).'
          : 'Decklists: upload the event’s standings CSV (top of the page), then <b>Share decklists</b> in Organiser tools so the overlay and your team see decks.'}</p>
        <p class="danger"><button class="linkbtn" type="button" data-acct="delete">Delete tournament</button></p>`, { closed: true }) : ''}
    </div></div>`;

  // Live control: put the preview back (or start it), and listen for scene changes from the rest of the team
  const slot = $('lc-slot');
  if (slot && store(true, 'bdst-lc-preview') !== 'off') {
    const src = overlayUrl('program', t) + '&preview=1';
    if (keepFrame && keepFrame.dataset.src === src) slot.appendChild(keepFrame);
    else slot.innerHTML = `<iframe id="lc-frame" data-src="${esc(src)}" src="${esc(src)}" title="Live preview" tabindex="-1"></iframe>`;
    fitPreview();
  }
  startLive(t);
  markScene();

  // Overlay look: saved for the team as soon as it changes
  $('ev-mat')?.addEventListener('change', e => saveSettings({ mat: Math.max(600, Math.min(1500, Number(e.target.value) || 1080)) }));
  $('ev-pos')?.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of $('ev-pos').children) x.setAttribute('aria-pressed', String(x === b));
    saveSettings({ pos: b.dataset.v });
  });
  $('ev-dim')?.addEventListener('input', e => { $('ev-dim-out').textContent = e.target.value + '%'; document.querySelector('.wall-prev')?.style.setProperty('--dim', e.target.value / 100); });
  $('ev-dim')?.addEventListener('change', e => saveSettings({ wallDim: Number(e.target.value) }));
  $('ev-layout')?.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of $('ev-layout').children) x.setAttribute('aria-pressed', String(x === b));
    saveSettings({ layout: b.dataset.v });
  });
  $('ev-cams')?.addEventListener('change', e => saveSettings({ cams: e.target.checked }));
  $('ev-slides')?.addEventListener('change', () => {
    const on = [...$('ev-slides').querySelectorAll('input:checked')].map(x => x.value);
    if (!on.length) { toast('Keep at least one slide on.'); drawEvent(); return; }
    saveSettings({ breakSlides: on });
  });
  $('ev-sec')?.addEventListener('change', e => saveSettings({ breakSeconds: Math.max(5, Math.min(120, Math.round(Number(e.target.value)) || 15)) }));
  $('ee-fmt')?.addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b || b.getAttribute('aria-checked') === 'true') return;
    pickFormat($('ee-fmt'), b);
    const k = b.dataset.v, lim = k === 'limited';
    $('ee-set-wrap').hidden = !lim;
    // Switching format sets up that format's structure (decks source, Stream tab, break screen slides)
    saveSettings({ ...FORMATS[k].settings, ...(lim ? { cardSet: $('ee-set').value } : {}) });
    toast(`Set up for ${FORMATS[k].label}: ${lim ? 'pick decks on the Stream tab → Decks; the break screen skips deck stats' : 'decks from the standings CSV; the break screen shows deck stats'}.`);
    state.fpTab = null; if (state.view) renderFeaturePicker();
    drawEvent();
  });
  $('ee-set')?.addEventListener('change', e => { saveSettings({ cardSet: e.target.value }); if (state.view) renderFeaturePicker(); });
  $('ev-edit')?.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('ee-msg'); msg.textContent = 'Saving…';
    const body = { name: $('ee-name').value, date: $('ee-date').value, venue: $('ee-venue').value, bestOf: Number($('ee-bo').value), topCut: Number($('ee-cut').value) };
    if (parseTournament($('ee-melee').value) !== String(t.meleeId)) body.melee = $('ee-melee').value;
    try {
      acct.current = await api('/t/' + t.id, { method: 'PATCH', body });
      syncListed(acct.current);
      if (body.melee) follow(String(acct.current.meleeId));
      drawEvent(); toast('Saved');
    } catch (err) { msg.textContent = err.message; }
  });
}

function syncListed(t) {
  const i = acct.tournaments.findIndex(x => x.id === t.id);
  if (i >= 0) acct.tournaments[i] = { ...acct.tournaments[i], ...t, role: acct.tournaments[i].role };
}

async function loadInvites() {
  try { acct.invites = (await api(`/t/${acct.current.id}/invites`)).invites; drawEvent(); } catch (e) {}
}

// Stream settings shared by the team (Take 30 link and switches, overlay mat size and banner position)
let settingsTimer = null, pendingSettings = {};
function saveSettings(patch) {
  const t = openTournament() || acct.current; if (!t?.role) return;
  t.settings = { ...t.settings, ...patch };
  Object.assign(pendingSettings, patch);
  clearTimeout(settingsTimer);
  settingsTimer = setTimeout(async () => {
    const body = { settings: pendingSettings }; pendingSettings = {};
    try { const saved = await api('/t/' + t.id, { method: 'PATCH', body }); t.settings = saved.settings; toast('Saved for your stream team'); }
    catch (e) { toast(e.message); }
  }, 400);
}
// Put the tournament's saved Take 30 settings into the Stream tab (it reads them from this browser's storage)
function applyTournamentSettings(t) {
  const s = t.settings || {};
  store(false, 'bdst-t30', s.take30 || '');
  store(false, 'bdst-t30swap', s.take30Swap ? '1' : '');
  store(false, 'bdst-t30colors', s.take30Colors === false ? 'off' : '');
  if ($('t30-link')) $('t30-link').value = s.take30 || '';
  if ($('t30-swap')) $('t30-swap').checked = !!s.take30Swap;
  if ($('t30-colors')) $('t30-colors').checked = s.take30Colors !== false;
}
// When the Stream tab's Take 30 controls change on a tournament, save them for the team too
function acctWire() {
  $('t30-link').addEventListener('change', e => { if (openTournament()) saveSettings({ take30: take30Url(e.target.value.trim()) || null }); });
  $('t30-test').addEventListener('click', () => { const v = take30Url($('t30-link').value.trim()); if (openTournament() && v && v !== openTournament().settings?.take30) saveSettings({ take30: v }); });
  $('t30-swap').addEventListener('change', e => { if (openTournament()) saveSettings({ take30Swap: e.target.checked }); });
  $('t30-colors').addEventListener('change', e => { if (openTournament()) saveSettings({ take30Colors: e.target.checked }); });
}

// ---------- invite ----------
async function inviteView(el, code) {
  el.innerHTML = '<div class="hub-card"><p class="hint">Opening the invite…</p></div>';
  let inv;
  try { inv = await api('/invite/' + encodeURIComponent(code)); }
  catch (e) { el.innerHTML = `<div class="hub-card hub-login"><h2>Invite link not found</h2><p>${esc(e.message)}</p></div>`; return; }
  const t = inv.tournament;
  const head = `<img src="bdst-logo.png" alt="BDST" class="hub-logo"><p class="eyebrow">Stream team invite</p><h2>${esc(t.name)}</h2>
    <p class="ev-meta">${esc([fmtDate(t.date), t.venue].filter(Boolean).join(' · '))}</p>`;
  if (inv.role) {
    el.innerHTML = `<div class="hub-card hub-login">${head}<p>You’re already on this tournament’s ${inv.role === 'owner' ? 'team (you own it)' : 'stream team'}.</p>
      <button class="btn" type="button" data-go-event="${esc(t.id)}">Open tournament</button></div>`;
    return;
  }
  if (!inv.valid) {
    el.innerHTML = `<div class="hub-card hub-login">${head}<p>This invite link has expired or was cancelled. Ask ${esc(inv.invitedBy)} for a new one.</p></div>`;
    return;
  }
  el.innerHTML = `<div class="hub-card hub-login">${head}
    <p><b>${esc(inv.invitedBy)}</b> invited you to the stream team. You’ll be able to pick the feature match, set games won, swap sides and run Take 30 during the event.</p>
    ${acct.user
      ? `<button class="btn" type="button" data-acct="join" data-code="${esc(code)}">Join as ${esc(acct.user.name)}</button>`
      : `<button class="btn" type="button" data-acct="signin">${DISCORD_ICON}Sign in with Discord to join</button>`}
    <p class="hint">Link expires ${esc(new Date(inv.expires).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' }))}.</p></div>`;
}

// ---------- clicks ----------
let deleteArmed = null;
document.addEventListener('click', async e => {
  const g = e.target.closest('[data-go]');
  if (g) { go(Object.fromEntries(new URLSearchParams(g.dataset.go))); return; }
  const ge = e.target.closest('[data-go-event]');
  if (ge) { go({ event: ge.dataset.goEvent }); return; }
  const rm = e.target.closest('[data-remove]');
  if (rm) {
    const self = rm.dataset.remove === acct.user?.id;
    if (!confirm(self ? `Leave the stream team for ${acct.current.name}?` : `Remove ${rm.dataset.name} from the stream team?`)) return;
    try {
      const r = await api(`/t/${acct.current.id}/team/${rm.dataset.remove}`, { method: 'DELETE' });
      if (self) { acct.tournaments = acct.tournaments.filter(x => x.id !== acct.current.id); acct.current = null; afterAccountChange(); go({ view: 'mine' }); toast('You left the stream team.'); }
      else { acct.current.team = r.team; drawEvent(); toast(`Removed ${rm.dataset.name}`); }
    } catch (err) { toast(err.message); }
    return;
  }
  const ci = e.target.closest('[data-cancel-invite]');
  if (ci) {
    try { await api(`/t/${acct.current.id}/invites/${ci.dataset.cancelInvite}`, { method: 'DELETE' }); acct.invites = acct.invites.filter(i => i.code !== ci.dataset.cancelInvite); drawEvent(); toast('Invite link cancelled. It no longer works.'); }
    catch (err) { toast(err.message); }
    return;
  }
  const a = e.target.closest('[data-acct]'); if (!a) {
    // Close the account menu when clicking elsewhere
    const pop = document.querySelector('.acct-pop'); if (pop && !pop.hidden && !e.target.closest('.acct-menu')) { pop.hidden = true; document.querySelector('.acct-me')?.setAttribute('aria-expanded', 'false'); }
    return;
  }
  const what = a.dataset.acct;
  if (what === 'signin') return signIn();
  if (what === 'signout') return signOut();
  if (what === 'menu') { const pop = document.querySelector('.acct-pop'); pop.hidden = !pop.hidden; a.setAttribute('aria-expanded', String(!pop.hidden)); return; }
  if (what === 'mine' || what === 'new') { document.querySelector('.acct-pop').hidden = true; go({ view: what }); return; }
  if (what === 'stream-live') {
    const t = acct.current; if (!t) return;
    try { const v = await saveStreamAsOf(t.meleeId, null); if (acct.live) acct.live.value = v; markScene(); toast('The stream is back to live.'); }
    catch (err) { toast(err.message); }
    if (state.asOf && String(state.liveId) === String(t.meleeId)) { $('asof').value = ''; setAsOf(null); }
    return;
  }
  if (what === 'toggle-preview') { store(false, 'bdst-lc-preview', store(true, 'bdst-lc-preview') === 'off' ? '' : 'off'); const f = $('lc-frame'); if (f) f.remove(); drawEvent(); return; }
  if (what === 'controls') { selectTab('stream'); $('tabs').scrollIntoView({ behavior: 'smooth' }); return; }
  if (what === 'invite') {
    try {
      const inv = await api(`/t/${acct.current.id}/invites`, { method: 'POST' });
      acct.invites = [inv, ...(acct.invites || [])];
      const link = location.origin + location.pathname + '?invite=' + inv.code;
      try { await navigator.clipboard.writeText(link); toast('Invite link copied. Send it to your stream team.'); } catch (err) { toast('Invite link ready. Copy it below.'); }
      drawEvent();
    } catch (err) { toast(err.message); }
    return;
  }
  if (what === 'rekey') {
    if (!confirm('Make a new overlay link? The current one stops working, so you’ll need to paste the new link into OBS.')) return;
    try { const r = await api(`/t/${acct.current.id}/overlay-key`, { method: 'POST' }); acct.current.overlayKey = r.overlayKey; drawEvent(); renderStream(); toast('New overlay link made. Update it in OBS.'); }
    catch (err) { toast(err.message); }
    return;
  }
  if (what === 'delete') {
    if (!deleteArmed) { a.textContent = 'Click again to delete for everyone'; deleteArmed = setTimeout(() => { a.textContent = 'Delete tournament'; deleteArmed = null; }, 4000); return; }
    clearTimeout(deleteArmed); deleteArmed = null;
    try {
      await api('/t/' + acct.current.id, { method: 'DELETE' });
      acct.tournaments = acct.tournaments.filter(x => x.id !== acct.current.id); acct.current = null;
      afterAccountChange(); go({ view: 'mine' }); toast('Tournament deleted.');
    } catch (err) { toast(err.message); }
    return;
  }
  if (what === 'join') {
    a.disabled = true;
    try {
      const r = await api(`/invite/${a.dataset.code}/accept`, { method: 'POST' });
      await loadMe();
      toast(r.already ? 'You’re already on the team.' : 'You’ve joined the stream team.');
      go({ event: r.tournament });
    } catch (err) { toast(err.message); a.disabled = false; }
  }
});

// ---------- start ----------
async function acctBoot() {
  acctWire();
  applyFolds($('p-stream'));
  if (loginReturn?.error) toast(loginReturn.error);
  if (loginReturn?.code) {
    try {
      const r = await relay('/auth/exchange', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: loginReturn.code }) });
      acct.token = r.token; store(false, 'bdst-session', r.token);
      toast(`Signed in as ${r.user.name}`);
    } catch (e) { toast(e.message); }
    // Back to the page you signed in from (an invite, a tournament, …)
    const after = store(true, 'bdst-after-login'); store(false, 'bdst-after-login', '');
    if (after && after !== location.search) history.replaceState(null, '', location.pathname + after + location.hash);
  }
  renderHub();
  await loadMe();
  renderAccount();
  renderHub();
  renderOrganiser();
  if (state.view) { renderFeaturePicker(); renderPairings(); }
}
