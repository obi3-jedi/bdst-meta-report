// Screens, controls and wiring.

const $ = id => document.getElementById(id);
function setPressed(groupId, id) {
  document.querySelectorAll(`#${groupId} button`).forEach(b => b.setAttribute('aria-pressed', String(b.id === id)));
}
function setNotice(html, err) { const el = $('notice'); el.innerHTML = html; el.classList.toggle('err', !!err); }
function setLiveStatus(html, err) { const el = $('live-status'); el.innerHTML = html; el.classList.toggle('err', !!err); }

let toastTimer;
function toast(msg, action) {
  const el = $('toast');
  el.innerHTML = `<span>${esc(msg)}</span>${action ? `<button type="button">${esc(action.label)}</button>` : ''}`;
  if (action) el.querySelector('button').onclick = () => { el.hidden = true; action.run(); };
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, action ? 9000 : 4000);
}

const CHEV = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';
document.querySelectorAll('.chev').forEach(c => { c.innerHTML = CHEV; });

// ---------- collapsible sections (remembered per browser) ----------
{
  const saved = storeJSON('bdst-collapsed', null);
  const collapsed = new Set(saved ?? [...document.querySelectorAll('.sec[data-closed]')].map(s => s.dataset.sec));
  document.querySelectorAll('.sec-toggle').forEach(btn => {
    const sec = btn.closest('.sec'), key = sec.dataset.sec, body = sec.querySelector('.sec-body');
    if (!body) return;
    const set = open => { btn.setAttribute('aria-expanded', String(open)); body.hidden = !open; };
    set(!collapsed.has(key));
    btn.addEventListener('click', () => {
      const open = btn.getAttribute('aria-expanded') !== 'true';
      set(open);
      if (open) collapsed.delete(key); else collapsed.add(key);
      store(false, 'bdst-collapsed', JSON.stringify([...collapsed]));
    });
  });
}

// ---------- tabs ----------
const TABS = [...document.querySelectorAll('#tabs [role="tab"]')].map(b => b.dataset.tab);
function selectTab(name, { focus = false, push = true } = {}) {
  if (!TABS.includes(name)) name = 'decks';
  state.tab = name;
  for (const b of document.querySelectorAll('#tabs [role="tab"]')) {
    const on = b.dataset.tab === name;
    b.setAttribute('aria-selected', String(on));
    b.tabIndex = on ? 0 : -1;
    if (on && focus) b.focus();
    if (on) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  for (const p of document.querySelectorAll('.panel')) p.hidden = p.id !== 'p-' + name;
  store(false, 'bdst-tab', name);
  if (push && !state.overlay) history.replaceState(null, '', location.pathname + location.search + '#' + name);
  if (name === 'season') renderSeason();
}
$('tabs').addEventListener('click', e => { const b = e.target.closest('[role="tab"]'); if (b) selectTab(b.dataset.tab); });
$('tabs').addEventListener('keydown', e => {
  const i = TABS.indexOf(state.tab);
  if (e.key === 'ArrowRight') selectTab(TABS[(i + 1) % TABS.length], { focus: true });
  else if (e.key === 'ArrowLeft') selectTab(TABS[(i - 1 + TABS.length) % TABS.length], { focus: true });
  else return;
  e.preventDefault();
});

// "Follow a tournament" placeholders on tabs that need live data
document.querySelectorAll('.needs-live').forEach(el => {
  el.innerHTML = `<p>${esc(el.dataset.msg)}</p><button class="btn ghost" type="button">Follow a tournament</button>`;
  el.querySelector('button').onclick = () => { window.scrollTo({ top: 0, behavior: 'smooth' }); $('melee-url').focus(); };
});

// ---------- render everything ----------
function render() {
  computeView();
  const live = !!state.view;
  document.querySelectorAll('.needs-live').forEach(el => { el.hidden = live; });
  document.querySelectorAll('.live-only').forEach(el => { el.hidden = !live; });
  renderOverviewAndDecks();
  renderAspects();
  if (live) {
    renderPairings();
    renderStandings();
    renderRace();
    renderBracket();
    renderMatchups();
    renderStream();
  }
  renderTeam();
  renderReplay();
  renderLive();
}

// ---------- Decks tab ----------
function renderOverviewAndDecks() {
  const ps = currentPlayers(), total = ps.length;
  const known = ps.filter(p => p.known), n = known.length || 1;
  const decks = deckGroups(known);
  const deckCount = state.groupBy === 'deck' ? decks.length : deckGroups(known, 'deck').length;
  const groups = state.groupBy === 'deck' ? decks : deckGroups(known);
  const top = deckGroups(known, 'deck')[0];
  const leaders = new Set(known.map(p => p.leader)).size;
  $('overview-meta').textContent = state.view?.round ? `after ${state.view.round}` : '';
  $('stats').innerHTML = `
    <div class="stat"><span class="eyebrow">Players</span><span class="v">${total}</span><span class="s">${known.length} with a decklist</span></div>
    <div class="stat"><span class="eyebrow">Different decks</span><span class="v">${deckCount}</span><span class="s">Leader + base combinations</span></div>
    <div class="stat"><span class="eyebrow">Different leaders</span><span class="v">${leaders}</span><span class="s">Across all decks</span></div>
    <div class="stat"><span class="eyebrow">Most played deck</span><span class="v sm">${top ? esc(top.label) : '–'}</span><span class="s">${top ? `${top.count} players · ${pct(top.count / n)}` : ''}</span></div>`;

  const what = { deck: 'Decks', leader: 'Leaders', base: 'Bases' }[state.groupBy];
  $('decks-title').textContent = what;
  $('decks-meta').textContent = known.length ? `${groups.length} different · tap a row to see who played it` : '';
  const max = Math.max(...groups.map(g => g.count), 1);
  const win = state.showWin;
  const rows = groups.map((g, i) => {
    const sub = state.groupBy !== 'leader' && genericInfo.has(g.base) ? [...genericInfo.get(g.base).names].join(', ') : '';
    const r = g.players.reduce((a, p) => { const x = rec(p.record); a.w += x.w; a.l += x.l; a.d += x.d; return a; }, { w: 0, l: 0, d: 0 });
    const mp = r.w + r.l + r.d, wr = mp ? r.w / mp : null;
    const pilots = g.players.map(p => `<li>${state.live ? `<button class="plink" type="button" data-player="${esc(p.id)}">${esc(p.name)}</button>` : esc(p.name)}${state.groupBy !== 'deck' || p.base !== g.base ? ` <span class="muted">· ${esc(state.groupBy === 'leader' ? p.base : state.groupBy === 'base' ? splitLeader(p.leader).name : p.base)}</span>` : ''}${p.record ? ` <span class="muted">${esc(p.record)}</span>` : ''}</li>`).join('');
    const art = state.groupBy === 'leader' ? `<span class="pair">${leaderImg(g.leader)}</span>` : state.groupBy === 'base' ? `<span class="pair">${baseImg(g.base)}</span>` : deckArt(g);
    return `<details class="row"><summary>
      <span class="no">${String(i + 1).padStart(2, '0')}</span>
      <div class="who">${art}<div class="info">
        <div class="nm"><b>${esc(g.label)}</b>${pips(deckAspects(g.players[0]).filter(a => state.groupBy !== 'base' || (card('bases', g.players[0].base)?.a || []).includes(a)))}${sub ? `<em>${esc(sub)}</em>` : ''}</div>
        <div class="track"><div style="width:${g.count / max * 100}%"></div></div></div></div>
      <div class="num">${g.count}</div>
      <div class="num share">${pct(g.count / n)}</div>
      ${win ? `<div class="wr ${mp < 6 ? 'na' : wr >= .6 ? 'hi' : ''}" title="${r.w}-${r.l}-${r.d} in matches">${mp ? pct(wr) : '–'}</div>` : ''}
    </summary><ul class="pilots">${pilots}</ul></details>`;
  }).join('');
  $('decks').classList.toggle('has-win', win);
  $('decks').innerHTML = known.length
    ? `<div class="cols"><span>#</span><span>${what.slice(0, -1)}</span><span>Players</span><span>Share</span>${win ? '<span>Win %</span>' : ''}</div>${rows}`
    : `<p class="empty-note">${state.live ? 'No decklists yet. Upload this event’s standings CSV, or ask the organiser to share decklists.' : 'Upload a melee.gg standings export to see the deck breakdown.'}</p>`;
}

function renderAspects() {
  const known = currentPlayers().filter(p => p.known);
  const el = $('aspects-body');
  if (!known.length) { el.innerHTML = '<p class="empty-note">Needs decklists.</p>'; return; }
  const n = known.length;
  const has = a => known.filter(p => deckAspects(p).includes(a));
  const her = has('Heroism').length, vil = has('Villainy').length, oth = n - her - vil;
  el.innerHTML = `<div class="asp-split">
      ${her ? `<div class="her" style="width:${her / n * 100}%">Heroism ${pct(her / n)}</div>` : ''}
      ${oth > 0 ? `<div class="oth" style="width:${oth / n * 100}%">${oth}</div>` : ''}
      ${vil ? `<div class="vil" style="width:${vil / n * 100}%">Villainy ${pct(vil / n)}</div>` : ''}</div>
    <div class="asp-grid">${ASPECTS.map(a => {
      const f = has(a);
      return `<div class="asp"><div class="t"><i class="pip a-${a.toLowerCase()}"></i>${a}</div><div class="big">${pct(f.length / n)}</div><div class="s">${f.length} of ${n} decks</div></div>`;
    }).join('')}</div>`;
}

// ---------- Standings tab ----------
function renderStandings() {
  const v = state.view, ps = currentPlayers();
  $('standings-meta').textContent = v.round ? `after ${v.round}${v.replay ? ' (replay)' : ''}` : 'No completed rounds yet';
  const race = computeRace();
  const statusOf = new Map((race && !race.finished ? race.rows : []).map(r => [r.id, r.status]));
  const tag = teamTag();
  const rows = ps.map(p => {
    const d = deckOf(p);
    const dropped = isDropped(p);
    const deck = d ? `<div class="deck">${deckArt(d)}<b>${esc(d.label)}</b></div>` : `<span class="none">${p.matched ? 'No decklist' : deckIndex() ? 'Not in decklists' : '—'}</span>`;
    const st = statusOf.get(p.id);
    const find = `${p.name} ${d ? d.label : ''}`.toLowerCase();
    return `<tr class="${dropped ? 'dropped' : ''} ${isTeam(p.name, tag) ? 'team' : ''}" data-find="${esc(find)}">
      <td class="rk">${p.rank}</td>
      <td class="pl"><button class="plink" type="button" data-player="${esc(p.id)}">${esc(p.name)}</button>${dropped ? '<span class="tag">Dropped</span>' : ''}</td>
      <td class="rec">${esc(p.record)}</td>
      <td class="pts r">${p.points ?? ''}</td>
      ${statusOf.size ? `<td>${st ? `<span class="st-chip ${st}">${{ locked: 'Locked', alive: 'Alive', out: 'Out' }[st]}</span>` : ''}</td>` : ''}
      <td>${deck}</td></tr>`;
  }).join('');
  $('standings').innerHTML = ps.length
    ? `<thead><tr><th>#</th><th>Player</th><th>Record</th><th class="r">Pts</th>${statusOf.size ? '<th>Top 8</th>' : ''}<th>Deck</th></tr></thead><tbody>${rows}</tbody>`
    : '<tbody><tr><td class="none">Standings appear once the first round is complete.</td></tr></tbody>';
  filterRows('standings-filter', '#standings tbody tr');
}

function filterRows(inputId, selector) {
  const q = $(inputId).value.trim().toLowerCase();
  document.querySelectorAll(selector).forEach(tr => { tr.hidden = !!q && !(tr.dataset.find || '').includes(q); });
}

// ---------- Pairings tab ----------
function renderPairings() {
  const v = state.view, sel = $('pair-round');
  const rounds = v.history;
  if (!rounds.length) { sel.innerHTML = ''; $('pairings').innerHTML = '<p class="empty-note">No pairings yet. They appear when round 1 is paired.</p>'; $('pairings-meta').textContent = ''; return; }
  const wanted = state.pairRound && rounds.some(r => r.id === state.pairRound) ? state.pairRound : (v.current?.id || v.at?.id || rounds[rounds.length - 1].id);
  sel.innerHTML = rounds.map(r => `<option value="${r.id}" ${r.id === wanted ? 'selected' : ''}>${esc(r.name)}${r.completed ? '' : ' (playing now)'}</option>`).join('');
  const pr = pairingsFor(wanted);
  const tag = teamTag(), onlyFeature = $('pair-feature').checked;
  $('pairings-meta').textContent = `${pr.rows.length} ${pr.rows.length === 1 ? 'match' : 'matches'}${pr.round.completed ? '' : ' · playing now'}`;
  const side = (p, other, right, done) => {
    const d = deckOf(p);
    const lost = done && other && p.gameWins < other.gameWins;
    return `<div class="pside ${right ? 'right' : ''} ${lost ? 'lost' : ''}">${d ? leaderImg(d.leader) : '<span class="thumb" aria-hidden="true"></span>'}
      <div class="info"><button class="plink" type="button" data-player="${esc(p.id)}">${esc(p.name)}</button>
      <small>${p.standing ? `<span class="r2">${esc(p.standing.record)}</span> · ` : ''}${d ? esc(d.label) : 'No decklist'}</small></div></div>`;
  };
  const html = pr.rows.filter(x => !onlyFeature || x.feature).map(x => {
    const [a, b] = x.players;
    const team = x.players.some(p => isTeam(p.name, tag));
    const find = x.players.map(p => `${p.name} ${deckOf(p)?.label || ''}`).join(' ').toLowerCase();
    if (!b) return `<div class="pr ${team ? 'team' : ''}" data-find="${esc(find)}"><div class="tbl">Table<b>${x.table ?? '–'}</b></div>${side(a, null, false, false)}<div class="pscore live">Bye</div><span></span><span></span></div>`;
    const score = x.hasResult ? `<div class="pscore">${a.gameWins}–${b.gameWins}</div>` : '<div class="pscore live">Playing</div>';
    return `<div class="pr ${team ? 'team' : ''}" data-find="${esc(find)}">
      <div class="tbl">${x.feature ? '<span class="feat">Feature</span>' : ''}Table<b>${x.table ?? '–'}</b></div>
      ${side(a, b, false, x.hasResult)}${score}${side(b, a, true, x.hasResult)}
      <button class="btn ghost sm pimg" type="button" data-feature="${pr.round.id}|${x.table}" title="Make a feature match image">Image</button></div>`;
  }).join('');
  $('pairings').innerHTML = html || '<p class="empty-note">No matches to show.</p>';
  filterRows('pair-filter', '#pairings .pr');
}

// ---------- Top 8 tab ----------
function renderRace() {
  const race = computeRace(), el = $('race-body');
  if (!race) { el.innerHTML = '<p class="empty-note">The race starts once the first Swiss round is complete.</p>'; $('race-meta').textContent = ''; return; }
  $('race-meta').textContent = race.finished ? `Swiss is finished · final top ${race.cut}` : `after ${race.round} · ${race.left} Swiss ${race.left === 1 ? 'round' : 'rounds'} left`;
  const tag = teamTag();
  const show = race.rows.filter(r => r.status !== 'out' || r.rank <= race.cut + 8).sort((a, b) => a.rank - b.rank);
  const rows = show.map(r => {
    const d = deckOf(r);
    return `<tr class="${r.status === 'out' ? 'is-out' : ''} ${r.rank === race.cut ? 'cutline' : ''} ${isTeam(r.name, tag) ? 'team' : ''}">
      <td class="rk">${r.rank}</td>
      <td class="pl"><button class="plink" type="button" data-player="${esc(r.id)}">${esc(r.name)}</button>${isDropped(r) ? '<span class="tag">Dropped</span>' : ''}</td>
      <td class="rec">${esc(r.record)}</td><td class="pts r">${r.points}</td>
      ${race.finished ? '' : `<td class="pts r">${r.best}</td>`}
      <td><span class="st-chip ${r.status}">${{ locked: race.finished ? 'In top ' + race.cut : 'Locked', alive: 'Alive', out: 'Out' }[r.status]}</span></td>
      <td>${d ? `<div class="deck">${deckArt(d)}<b>${esc(d.label)}</b></div>` : '<span class="none">—</span>'}</td></tr>`;
  }).join('');
  el.innerHTML = `<div class="race-sum">
      <span class="race-chip"><b>${race.counts.locked}</b>${race.finished ? 'made the cut' : 'locked in'}</span>
      ${race.finished ? '' : `<span class="race-chip"><b>${race.counts.alive}</b>still alive</span>`}
      <span class="race-chip"><b>${race.line ?? '–'}</b>points at ${race.cut}th place</span>
      ${race.finished ? '' : `<span class="race-chip"><b>${race.left}</b>${race.left === 1 ? 'round' : 'rounds'} left</span>`}</div>
    <div class="board"><div class="tbl-wrap"><table class="st"><thead><tr><th>#</th><th>Player</th><th>Record</th><th class="r">Pts</th>${race.finished ? '' : '<th class="r" title="Points if they win every remaining round">Best</th>'}<th>Status</th><th>Deck</th></tr></thead><tbody>${rows}</tbody></table></div></div>
    ${race.finished ? '' : '<p class="hint">The red dashed line is the current cut. <b>Locked</b> players can’t be passed on points by enough others to miss the cut; <b>Out</b> players can’t reach it even by winning every remaining round. Players tied on points are separated by tiebreakers.</p>'}`;
}

function renderBracket() {
  const br = state.view?.bracket;
  $('bracket-title').textContent = br ? `Top ${br.size}` : 'Bracket';
  $('bracket-meta').textContent = br?.note || '';
  const el = $('bracket');
  if (!br) { el.style.removeProperty('--cols'); el.innerHTML = '<p class="empty-note">The bracket appears once the first Swiss round is complete.</p>'; return; }
  const row = (e, m) => {
    if (!e) return `<div class="mrow tbd"><span class="seed"></span><span class="thumb" aria-hidden="true"></span><div class="who2"><b>To be decided</b></div><span class="score"></span></div>`;
    const d = deckOf(e);
    const cls = m.winner ? (m.winner.id === e.id ? 'win' : 'lose') : '';
    return `<div class="mrow ${cls}"><span class="seed">${e.seed ?? ''}</span>${d ? leaderImg(d.leader) : '<span class="thumb" aria-hidden="true"></span>'}
      <div class="who2"><b><button class="plink" type="button" data-player="${esc(e.id)}">${esc(e.name)}</button></b><span>${d ? esc(d.label) : 'No decklist'}</span></div>
      <span class="score">${e.gameWins ?? ''}</span></div>`;
  };
  const champ = () => { const d = deckOf(br.champion); return `<div class="champ">${d ? leaderImg(d.leader) : '<span class="thumb"></span>'}<div><small>Champion</small><b>${esc(br.champion.name)}</b><span>${d ? esc(d.label) : ''}</span></div></div>`; };
  el.style.setProperty('--cols', br.rounds.length);
  el.innerHTML = br.rounds.map((r, j) => `<div class="bcol"><h4>${esc(r.name)}</h4><div class="bstack">${r.slots.map(m => `<div class="match">${row(m.players[0], m)}${row(m.players[1], m)}</div>`).join('')}
    ${j === br.rounds.length - 1 && br.champion ? champ() : ''}</div></div>`).join('');
}

// ---------- Matchups tab ----------
function renderMatchups() {
  const mu = computeMatchups();
  const el = $('matrix');
  if (!mu || !mu.groups.length) { el.innerHTML = '<p class="empty-note">Needs decklists to compare decks.</p>'; $('mu-lists').innerHTML = ''; $('matchups-meta').textContent = ''; return; }
  $('matchups-meta').textContent = `${mu.counted} matches with both decks known`;
  const decks = mu.groups.filter(g => g.count >= 2).slice(0, 12);
  if (!decks.length) { el.innerHTML = '<p class="empty-note">Not enough decks with two or more players yet.</p>'; $('mu-lists').innerHTML = ''; return; }
  const color = c => { const wr = winRate(c); if (wr == null) return ''; const t = wr - .5; return t >= 0 ? `background:rgba(255,20,24,${.12 + t * 1.3})` : `background:rgba(255,255,255,${.04 + -t * .1});color:var(--muted)`; };
  const head = `<tr><th class="rowh"></th>${decks.map(g => `<th class="colh" title="${esc(g.label)}"><span>${esc(g.label)}</span></th>`).join('')}<th class="colh"><span>Overall</span></th></tr>`;
  const body = decks.map(a => `<tr><th class="rowh"><div class="deck">${leaderImg(a.leader)}<b>${esc(a.label)}</b></div></th>${decks.map(b => {
    if (a.key === b.key) { const m = mu.mirrors.get(a.key) || 0; return `<td class="mirror" title="Mirror matches">${m ? `${m}<small>mirror</small>` : '–'}</td>`; }
    const c = mu.cell.get(a.key + '|' + b.key);
    if (!c) return '<td class="empty">·</td>';
    return `<td tabindex="0" data-mu="${esc(a.key)}|${esc(b.key)}" style="${color(c)}">${c.w}-${c.l}${c.d ? '-' + c.d : ''}<small>${pct(winRate(c))}</small></td>`;
  }).join('')}<td class="mx-total" style="${color(mu.total.get(a.key))}">${(() => { const t = mu.total.get(a.key); return t ? `${t.w}-${t.l}${t.d ? '-' + t.d : ''}<small>${pct(winRate(t))}</small>` : '–'; })()}</td></tr>`).join('');
  el.innerHTML = `<table class="mx">${head}${body}</table>`;
  el._mu = mu;

  // Best and most-played matchups (3+ matches)
  const pairs = [];
  for (const [k, c] of mu.cell) {
    const [a, b] = k.split('|');
    const n = c.w + c.l + c.d;
    if (n >= 3 && a < b) pairs.push({ a, b, c, n });
  }
  const label = k => mu.groups.find(g => g.key === k)?.label || k;
  const lopsided = [...pairs].map(p => { const wr = winRate(p.c); return wr >= .5 ? p : { a: p.b, b: p.a, c: { w: p.c.l, l: p.c.w, d: p.c.d }, n: p.n }; })
    .sort((x, y) => winRate(y.c) - winRate(x.c) || y.n - x.n).slice(0, 6);
  const common = [...pairs].sort((x, y) => y.n - x.n).slice(0, 6);
  const li = p => `<li><b>${esc(label(p.a))}</b> vs <b>${esc(label(p.b))}</b> <span class="num2">${p.c.w}-${p.c.l}${p.c.d ? '-' + p.c.d : ''} (${pct(winRate(p.c))})</span></li>`;
  $('mu-lists').innerHTML = pairs.length ? `
    <div class="mu-list"><h4>Most one-sided</h4><ol>${lopsided.map(li).join('')}</ol></div>
    <div class="mu-list"><h4>Most played</h4><ol>${common.map(li).join('')}</ol></div>` : '<p class="empty-note">Matchups with three or more matches will be listed here.</p>';
}

function showMatchupDetail(key) {
  const mu = $('matrix')._mu; if (!mu) return;
  const [ka, kb] = key.split('|');
  const ga = mu.groups.find(g => g.key === ka), gb = mu.groups.find(g => g.key === kb);
  const ids = new Set(ga.players.map(p => p.id)), idsB = new Set(gb.players.map(p => p.id));
  const games = [];
  for (const r of state.view.history) {
    if (!r.completed || (!state.matchPlayoffs && !r.swiss)) continue;
    for (const m of r.matches) {
      if (m.players.length !== 2 || !m.hasResult) continue;
      const a = m.players.find(p => ids.has(String(p.playerId))), b = m.players.find(p => idsB.has(String(p.playerId)));
      if (a && b) games.push({ round: r.name, a, b });
    }
  }
  const c = mu.cell.get(key);
  const el = $('mu-detail');
  el.hidden = false;
  el.innerHTML = `<h4>${esc(ga.label)} vs ${esc(gb.label)}: ${c.w}-${c.l}${c.d ? '-' + c.d : ''}</h4><ul>${games.map(g => `<li><span class="rnd">${esc(g.round)}</span>
    <button class="plink" type="button" data-player="${g.a.playerId}">${esc(g.a.name)}</button> <span class="num2">${g.a.gameWins}–${g.b.gameWins}</span>
    <button class="plink" type="button" data-player="${g.b.playerId}">${esc(g.b.name)}</button></li>`).join('')}</ul>`;
  document.querySelectorAll('#matrix td.sel').forEach(td => td.classList.remove('sel'));
  document.querySelector(`#matrix td[data-mu="${CSS.escape(key)}"]`)?.classList.add('sel');
  el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

// ---------- Team tab ----------
function renderTeam() {
  const tag = teamTag();
  if (document.activeElement !== $('team-tag')) $('team-tag').value = tag;
  const members = teamPlayers();
  const el = $('team-body');
  if (!currentPlayers().length) { el.innerHTML = '<p class="empty-note">Follow a tournament or upload standings to see your team.</p>'; $('team-meta').textContent = ''; return; }
  if (!members.length) { el.innerHTML = `<p class="empty-note">No players with “${esc(tag)}” in their name at this event.</p>`; $('team-meta').textContent = ''; return; }
  const sum = members.reduce((a, p) => { const r = rec(p.record); a.w += r.w; a.l += r.l; a.d += r.d; return a; }, { w: 0, l: 0, d: 0 });
  const race = computeRace();
  const st = new Map((race?.rows || []).map(r => [r.id, r.status]));
  const inCut = race ? members.filter(p => st.get(p.id) === 'locked').length : 0;
  const alive = members.filter(p => !isDropped(p)).length;
  const best = members[0];
  $('team-meta').textContent = `${members.length} ${members.length === 1 ? 'player' : 'players'} tagged “${tag}”`;
  const current = state.view?.current ? state.view.history.find(h => h.id === state.view.current.id) : null;
  const nowOf = p => {
    if (!current) return '';
    const m = current.matches.find(m => m.players.some(x => String(x.playerId) === p.id));
    if (!m) return '';
    const r = matchResult(m, p.id);
    if (r.bye) return `<div class="now"><span class="res W">Bye</span></div>`;
    const od = deckOf(r.opp);
    return `<div class="now"><span class="res ${r.res}">${{ W: 'Won', L: 'Lost', D: 'Drew', P: 'Playing' }[r.res]}${r.score ? ' ' + r.score : ''}</span> vs <button class="plink" type="button" data-player="${esc(r.opp.id)}">${esc(r.opp.name)}</button>${od ? `<span class="hint">${esc(od.label)}</span>` : ''}</div>`;
  };
  el.innerHTML = `<div class="team-sum">
      <div class="stat"><span class="eyebrow">Players</span><span class="v">${members.length}</span><span class="s">${alive} still in</span></div>
      <div class="stat"><span class="eyebrow">Combined record</span><span class="v">${sum.w}-${sum.l}${sum.d ? '-' + sum.d : ''}</span><span class="s">${pct(sum.w / Math.max(1, sum.w + sum.l + sum.d))} match wins</span></div>
      <div class="stat"><span class="eyebrow">Best placed</span><span class="v sm">${esc(best.name)}</span><span class="s">#${best.rank} · ${esc(best.record)}</span></div>
      <div class="stat"><span class="eyebrow">${race && !race.finished ? 'Locked for top ' + race.cut : 'In the top cut'}</span><span class="v">${race ? inCut : '–'}</span><span class="s">${race && !race.finished ? members.filter(p => st.get(p.id) === 'alive').length + ' still alive' : ''}</span></div></div>
    <div class="team-cards">${members.map(p => {
      const d = deckOf(p), s = st.get(p.id);
      return `<div class="tcard">${d ? leaderImg(d.leader) : '<span class="thumb" aria-hidden="true"></span>'}
        <div class="meta"><div class="top"><button class="plink" type="button" data-player="${esc(p.id)}">${esc(p.name)}</button><span class="rk">#${p.rank ?? '–'}</span></div>
        <span><span class="r2">${esc(p.record)}</span>${p.points != null ? ` · ${p.points} pts` : ''}${s ? ` · <span class="st-chip ${s}">${{ locked: race.finished ? 'In top ' + race.cut : 'Locked', alive: 'Alive', out: 'Out' }[s]}</span>` : ''}${isDropped(p) ? '<span class="tag">Dropped</span>' : ''}</span>
        <span>${d ? esc(d.label) : 'No decklist'}</span>${nowOf(p)}</div></div>`;
    }).join('')}</div>`;
}

// ---------- Season tab ----------
async function renderSeason() {
  const el = $('season-body');
  el.innerHTML = '<p class="empty-note">Loading the season archive…</p>';
  let index;
  try { index = await loadArchiveIndex(); } catch (e) { el.innerHTML = `<p class="empty-note">${esc(e.message)}</p>`; return; }
  $('season-meta').textContent = index.length ? `${index.length} ${index.length === 1 ? 'event' : 'events'} saved` : '';
  if (!index.length) { el.innerHTML = '<p class="empty-note">No events saved yet. Organisers can save a finished event from <b>Follow live → Organiser tools</b>, and it will appear here with season-long deck trends.</p>'; return; }
  const events = await Promise.all(index.map(e => loadArchived(e.id).catch(() => null)));
  const ok = events.filter(Boolean);
  const by = state.seasonBy || 'deck';
  // Group every player across events by deck (or leader)
  const rows = new Map();
  const isAdminNow = !!store(true, 'bdst-admin-ok');
  ok.forEach((ev, ei) => {
    genericInfo.clear();
    const known = ev.players.filter(p => p.known);
    const top = new Set((ev.top8 || []).map(String));
    for (const p of known) {
      const base = baseKey(p);
      const key = by === 'leader' ? p.leader : p.leader + '\u0000' + base;
      const label = by === 'leader' ? splitLeader(p.leader).name : deckName(splitLeader(p.leader).name, base);
      const r = rows.get(key) || { key, label, leader: p.leader, base, events: new Set(), players: 0, top8: 0, wins: 0, share: new Array(ok.length).fill(0) };
      r.events.add(ei); r.players++; r.share[ei] += 1 / known.length;
      if (top.has(String(p.id))) r.top8++;
      if (ev.champion && String(ev.champion) === String(p.id)) r.wins++;
      rows.set(key, r);
    }
  });
  const totalPlayers = ok.reduce((s, ev) => s + ev.players.filter(p => p.known).length, 0) || 1;
  const list = [...rows.values()].sort((a, b) => b.players - a.players).slice(0, 30);
  const spark = arr => {
    const w = 90, h = 26, mx = Math.max(...arr, .01);
    const pts = arr.map((v, i) => `${(arr.length === 1 ? w / 2 : i / (arr.length - 1) * w).toFixed(1)},${(h - 3 - v / mx * (h - 6)).toFixed(1)}`).join(' ');
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="#ff1418" stroke-width="2" stroke-linejoin="round"/>${arr.map((v, i) => `<circle cx="${arr.length === 1 ? w / 2 : i / (arr.length - 1) * w}" cy="${h - 3 - v / mx * (h - 6)}" r="2" fill="#f7f7f7"/>`).join('')}</svg>`;
  };
  genericInfo.clear();
  el.innerHTML = `<div class="season-events">${ok.map((ev, i) => {
      const champ = ev.players.find(p => String(p.id) === String(ev.champion));
      return `<div class="sev"><b>${esc(ev.name)}</b><span class="muted">${esc(ev.date || '')} · ${ev.players.length} players</span>${champ ? `<span class="muted">Won by ${esc(champ.name)} (${esc(splitLeader(champ.leader).name)})</span>` : ''}<span class="spacer"></span>${isAdminNow ? `<button class="linkbtn" type="button" data-unarchive="${ev.id}">Remove</button>` : ''}</div>`;
    }).join('')}</div>
    <div class="board"><div class="tbl-wrap"><table class="st"><thead><tr><th>#</th><th>${by === 'leader' ? 'Leader' : 'Deck'}</th><th class="r">Events</th><th class="r">Players</th><th class="r">Share</th><th class="r">Top 8s</th><th class="r">Wins</th><th>Share by event</th></tr></thead><tbody>
    ${list.map((r, i) => `<tr><td class="rk">${i + 1}</td><td><div class="deck">${leaderImg(r.leader)}<b>${esc(r.label)}</b></div></td>
      <td class="pts r">${r.events.size}</td><td class="pts r">${r.players}</td><td class="pts r">${pct(r.players / totalPlayers)}</td>
      <td class="pts r">${r.top8}</td><td class="pts r">${r.wins}</td><td>${spark(r.share)}</td></tr>`).join('')}
    </tbody></table></div></div>`;
}

// ---------- Stream tab ----------
function renderStream() {
  const tid = state.liveId; if (!tid) return;
  const base = location.origin + location.pathname;
  const items = [
    { type: 'standings', title: 'Standings', desc: 'Top 8 standings with decks. Suggested size 520 × 720.', extra: '&n=8' },
    { type: 'feature', title: 'Feature match', desc: 'A banner across the top of the screen for the match at table 1: players, decks, game-win pips and base counters, thin in the middle so the board stays clear. Change table=1 for another table, add &pos=bottom to put it at the bottom. Fits around a square play mat filling the camera’s height; if your mat is smaller on screen, add &mat= with its height in pixels (e.g. &mat=950). Browser Source size 1920 × 1080.', extra: '&table=1' },
    { type: 'bracket', title: 'Top 8 bracket', desc: 'The live bracket. Suggested size 1280 × 720.', extra: '' },
    { type: 'decks', title: 'Deck breakdown', desc: 'The most played decks with share. Suggested size 520 × 720.', extra: '&n=8' },
  ];
  const t30 = take30Url(store(true, 'bdst-t30'));
  const t30extra = t30 ? `&t30=${encodeURIComponent(t30)}${store(true, 'bdst-t30swap') ? '&t30swap=1' : ''}` : '';
  $('overlays').innerHTML = items.map(it => {
    const url = `${base}?overlay=${it.type}&t=${tid}${it.extra}${it.type === 'feature' ? t30extra : ''}`;
    return `<div class="ovl"><h4>${it.title}</h4><p>${it.desc}</p><code>${esc(url)}</code>
      <div class="row2"><button class="btn ghost sm" type="button" data-copy="${esc(url)}">Copy link</button><a href="${esc(url)}" target="_blank" rel="noopener">Preview ↗</a></div></div>`;
  }).join('');
}

// ---------- Take 30 link test ----------
let t30stop = null;
function testTake30() {
  const out = $('t30-result');
  const url = take30Url($('t30-link').value);
  t30stop?.(); t30stop = null;
  if (!url) { out.innerHTML = '<p class="err">That doesn’t look like a Take 30 link. It should start with https:// and end in firebaseio.com/… or firebasedatabase.app/…</p>'; return; }
  out.innerHTML = '<p>Connecting…</p>';
  let got = false;
  const timer = setTimeout(() => { if (!got) out.innerHTML = '<p class="err">No data yet. Check the app is broadcasting and the link is complete.</p>'; }, 8000);
  t30stop = listenTake30(url, tree => {
    got = true; clearTimeout(timer);
    const v = take30Health(tree), swap = $('t30-swap').checked;
    const show = x => x ? (x.damage != null ? `${x.damage} damage taken` : `${x.health} health`) : '–';
    const [l, r] = v ? (swap ? [v[1], v[0]] : v) : [null, null];
    out.innerHTML = (v
      ? `<p class="ok">Live. Left player: <b>${esc(show(l))}</b> · Right player: <b>${esc(show(r))}</b>. Change a base in the app and these should update straight away.</p><p class="hint">The overlay shows this damage out of each player’s real base health from their decklist, e.g. 5/33. Read from <code>${esc(v[0].key)}</code> and <code>${esc(v[1].key)}</code>.</p>`
      : '<p class="err">Connected, but I couldn’t find the base health in this data. Send a screenshot of the data below so the overlay can be matched to it.</p>')
      + `<details><summary>Data from Take 30</summary><pre>${esc(JSON.stringify(tree, null, 2).slice(0, 4000))}</pre></details>`;
  }, s => { if (s === 'stopped') out.insertAdjacentHTML('afterbegin', '<p class="err">Take 30 stopped broadcasting this link.</p>'); });
}

// ---------- replay banner + live status ----------
function renderReplay() {
  const v = state.view, el = $('replay');
  if (!v?.replay) { el.hidden = true; return; }
  el.hidden = false;
  el.innerHTML = `<span>Showing <b>${esc(state.live.name)}</b> as it was after <b>${esc(v.round)}</b>. Pairings, standings, the race and images all reflect that point.</span><button class="btn sm" type="button" id="replay-exit">Back to latest</button>`;
  $('replay-exit').onclick = () => setAsOf(null);
}

function renderLive() {
  const on = !!state.liveId;
  $('live').classList.toggle('on', on && !!state.live);
  $('refresh').hidden = !on;
  $('unfollow').hidden = !on;
  $('auto-wrap').hidden = !on;
  $('follow').hidden = on;
  renderRecent();
  renderOrganiser();
  const L = state.live, v = state.view;
  if (!L || !v) return;
  // Replay selector
  const completed = L.rounds.filter(r => r.completed);
  $('asof-wrap').hidden = completed.length < 2;
  const latest = completed[completed.length - 1];
  $('asof').innerHTML = completed.slice().reverse().map(r => `<option value="${r === latest ? '' : r.id}" ${(state.asOf || '') === (r === latest ? '' : r.id) || (!state.asOf && r === latest) ? 'selected' : ''}>${esc(r.name)}${r === latest ? ' (latest)' : ''}</option>`).join('');
  // Status line
  const ps = currentPlayers();
  const matched = ps.filter(p => p.matched).length;
  const src = state.decks && state.decks.tid === L.id ? { upload: 'your upload', saved: 'your earlier upload', shared: 'the organiser' }[state.decks.source] : null;
  setNotice(src ? `Decklists from ${src} (${state.decks.count} players)` : 'No decklists yet: upload this event’s standings CSV, or ask the organiser to share them.');
  const time = L.updated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const parts = [`<b>${esc(L.name)}</b>`];
  const latestRound = latest?.name;
  parts.push(latestRound ? `standings after ${esc(latestRound)}` : 'no completed rounds yet');
  const cur = L.rounds.find(r => r.started && !r.completed);
  if (cur) parts.push(`${esc(cur.name)} in progress`);
  if (ps.length) parts.push(src ? `${matched} of ${ps.length} players matched to a decklist` : '<b>no decklists yet</b>');
  parts.push(`updated ${time}`);
  setLiveStatus(parts.join(' · '));
  $('live-meta').textContent = cur ? `${cur.name} in progress` : latestRound ? `after ${latestRound}` : '';
  const badge = $('t-pairings');
  badge.innerHTML = cur ? 'Pairings<span class="badge">Live</span>' : 'Pairings';
}

// ---------- recent events ----------
function rememberEvent(id, name) {
  const list = storeJSON('bdst-recent', []).filter(e => e.id !== id);
  list.unshift({ id, name });
  store(false, 'bdst-recent', JSON.stringify(list.slice(0, 6)));
}
function renderRecent() {
  const list = storeJSON('bdst-recent', []).filter(e => e.id !== state.liveId);
  const el = $('recent');
  el.hidden = !list.length;
  el.innerHTML = list.length ? `<span>Recent:</span>${list.map(e => `<button type="button" data-follow="${esc(e.id)}">${esc(e.name)}</button>`).join('')}` : '';
}

// ---------- organiser tools ----------
function renderOrganiser() {
  const ok = !!store(true, 'bdst-admin-ok') && !!adminKey();
  $('admin-state').textContent = ok ? 'Unlocked on this device' : '';
  $('admin-state').classList.toggle('ok', ok);
  const hasUpload = state.live && state.decks && state.decks.tid === state.live.id && state.decks.source !== 'shared';
  $('share-decks').disabled = !(ok && hasUpload);
  $('share-decks').title = !ok ? 'Unlock with the organiser passcode first' : !hasUpload ? 'Upload this event’s standings CSV first' : '';
  $('save-archive').disabled = !(ok && state.live && state.view?.players?.length);
  $('save-archive').title = !ok ? 'Unlock with the organiser passcode first' : '';
}
function orgMsg(text, err) { $('org-msg').textContent = text; $('org-msg').classList.toggle('err', !!err); }

// ---------- player popup ----------
function openPlayer(id) {
  id = String(id);
  const p = currentPlayers().find(x => x.id === id) || withDecks((state.view?.swiss?.players || []).filter(x => String(x.playerId) === id))[0];
  const name = p?.name || (state.view?.history || []).flatMap(r => r.matches).flatMap(m => m.players).find(x => String(x.playerId) === id)?.name || 'Player';
  const d = deckOf({ id, name });
  const race = computeRace(), st = race?.rows.find(r => r.id === id)?.status;
  $('player-head').innerHTML = `${d ? leaderImg(d.leader) : '<span class="thumb" aria-hidden="true"></span>'}
    <div><b>${esc(name)}</b><span>${d ? esc(d.label) : 'No decklist'}</span>${d?.deckId ? ` · <a href="https://melee.gg/Decklist/View/${esc(d.deckId)}" target="_blank" rel="noopener" style="color:var(--ink)">Decklist on melee.gg ↗</a>` : ''}<br>
    <span class="rec">${p ? `#${p.rank}  ·  ${esc(p.record)}${p.points != null ? `  ·  ${p.points} pts` : ''}` : ''}</span>${st && race && !race.finished ? ` <span class="st-chip ${st}">${{ locked: 'Locked', alive: 'Alive', out: 'Out' }[st]}</span>` : ''}${p && isDropped(p) ? '<span class="tag">Dropped</span>' : ''}</div>`;
  const label = { W: 'Win', L: 'Loss', D: 'Draw', P: 'Playing now' };
  const rows = historyOf(id).map(h => {
    if (h.none) return `<li><span class="rnd">${esc(h.round)}</span><span class="none">No match</span><span></span></li>`;
    if (h.bye) return `<li><span class="rnd">${esc(h.round)}</span><span class="none">Bye</span><span class="res W">Bye</span></li>`;
    const od = deckOf(h.opp);
    return `<li><span class="rnd">${esc(h.round)}</span>
      <div class="opp">${deckArt(od)}<div><button class="plink" type="button" data-player="${esc(h.opp.id)}">${esc(h.opp.name)}</button><small>${od ? esc(od.label) : 'No decklist'}</small></div></div>
      <span class="res ${h.res}">${label[h.res]}${h.score ? ' ' + h.score : ''}</span></li>`;
  }).join('');
  $('player-hist').innerHTML = rows || '<li><span></span><span class="none">No rounds played yet.</span><span></span></li>';
  $('player-modal').hidden = false;
  $('player-close').focus();
}

// ---------- images ----------
const KINDS = [
  { id: 'decks', label: 'Deck breakdown', ok: () => currentPlayers().some(p => p.known) },
  { id: 'top8', label: 'Top 8 standings', ok: () => currentPlayers().some(p => p.rank && p.rank < 9999) },
  { id: 'race', label: 'Top 8 race', ok: () => !!computeRace() },
  { id: 'bracket', label: 'Bracket', ok: () => !!state.view?.bracket },
  { id: 'recap', label: 'Round recap', ok: () => !!state.view?.at },
  { id: 'feature', label: 'Feature match', ok: () => !!featureMatch() },
  { id: 'team', label: 'Team', ok: () => teamPlayers().length > 0 },
];
let lastBlob = null, downloads = null;
// Inside the claude.ai viewer, files are saved through the downloads capability; opened directly, a plain link works.
window.claude?.use?.('downloads').then(d => { downloads = d; }).catch(() => {});

// The match a feature image shows: one picked from Pairings, otherwise table 1 of the current (or latest) round.
function featureMatch() {
  const v = state.view; if (!v) return null;
  const pick = state.feature;
  const roundId = pick?.roundId || v.current?.id || v.at?.id;
  const pr = roundId ? pairingsFor(roundId) : null; if (!pr) return null;
  const rows = pr.rows.filter(x => x.players.length === 2);
  const m = (pick && rows.find(x => String(x.table) === String(pick.table))) || rows[0];
  return m ? { round: pr.round, match: m } : null;
}

function renderKinds() {
  $('kindseg').innerHTML = KINDS.filter(k => k.ok()).map(k => `<button type="button" data-kind="${k.id}" aria-pressed="${state.kind === k.id}">${k.label}</button>`).join('');
}
function shareHint() {
  const k = state.kind;
  $('fmtseg').hidden = k === 'bracket';
  $('chartseg').hidden = k !== 'decks';
  const size = k === 'bracket' || state.format !== 'tall' ? '1920 × 1080 (16:9), sized for Discord and YouTube.' : '1080 × 1350 (4:5), sized for Facebook and Instagram feeds.';
  $('share-msg').textContent = size + ' Right-click the image (or press and hold on a phone) to save it.';
}
let drawing = 0;
async function refreshShot() {
  const my = ++drawing;
  $('shot-loading').hidden = false;
  try {
    const cv = await makeImage();
    if (my !== drawing) return false;
    if (!cv) { $('share-msg').textContent = 'There isn’t enough data for this image yet.'; return false; }
    lastBlob = await new Promise(r => cv.toBlob(r, 'image/png'));
    $('shot').src = cv.toDataURL('image/png');
    return true;
  } finally { if (my === drawing) $('shot-loading').hidden = true; }
}
async function openShare(kind) {
  if (kind) state.kind = kind;
  if (!KINDS.find(k => k.id === state.kind)?.ok()) state.kind = KINDS.find(k => k.ok())?.id || 'decks';
  renderKinds();
  setPressed('fmtseg', 'fmt-' + state.format);
  setPressed('chartseg', 'chart-' + state.chart);
  shareHint();
  let topLevel = false; try { topLevel = window.top === window.self; } catch (e) {}
  $('dl').hidden = !(topLevel || downloads);
  $('modal').hidden = false;
  $('modal-close').focus();
  await refreshShot();
}

// ---------- loading data ----------
async function readFile(file) {
  if (/\.xlsx?$/i.test(file.name)) {
    if (!window.XLSX) throw new Error('The Excel reader did not load. Export as CSV from melee.gg and try again.');
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
  }
  return parseCSV(await file.text());
}

function addFile(rows, isSample) {
  // One export can hold several rounds (one row per player per round), so split it by round first.
  const byRound = new Map();
  for (const o of tableToObjects(rows)) {
    const k = parseInt(o.RoundNumber, 10) || 0;
    if (!byRound.has(k)) byRound.set(k, []);
    byRound.get(k).push(o);
  }
  for (const [, part] of [...byRound].sort((a, b) => a[0] - b[0])) {
    const ps = buildRound(part);
    if (state.sample !== !!isSample || (ps.tid && state.tid && ps.tid !== state.tid)) state.rounds.clear();
    state.sample = !!isSample;
    state.tid = ps.tid || state.tid;
    state.rounds.set(ps.round ?? (Math.max(0, ...state.rounds.keys()) + 1), ps);
  }
}

const deckRowsFromCSV = () => finalRound().map(p => ({ id: String(p.id), name: p.name, leader: p.leader, base: p.base, known: p.known, deckId: p.deckId || '' }));

async function handleFiles(list) {
  const files = [...(list || [])];
  if (!files.length) return;
  try {
    for (const f of files) addFile(await readFile(f), false);
    const tid = String(finalRound().tid || '');
    if (tid) store(false, 'bdst-decks-' + tid, JSON.stringify(deckRowsFromCSV()));
    if (state.live && tid === state.live.id) {
      setDecks(tid, 'upload', deckRowsFromCSV());
      toast(store(true, 'bdst-admin-ok') ? 'Decklists added. Share them from Organiser tools so everyone sees decks.' : 'Decklists added for this event.');
    } else if (!state.live) {
      $('evname').value = store(true, 'swu-ev-' + tid) || '';
      setNotice(`<b>${finalRound().length} players</b> from ${esc(files.length === 1 ? files[0].name : files.length + ' files')}`);
    } else {
      toast('That file is for a different tournament than the one you’re following.');
    }
    render();
  } catch (e) { setNotice(esc(e.message || 'Could not read that file.'), true); }
}

// Decklists for a followed event: this browser's upload first, then the organiser's shared copy.
async function ensureDecks(tid) {
  if (state.decks?.tid === tid && state.decks.source === 'upload') return;
  if (String(finalRound().tid) === tid && !state.sample) { setDecks(tid, 'upload', deckRowsFromCSV()); return; }
  const saved = storeJSON('bdst-decks-' + tid, null);
  if (saved?.length) {
    const rows = Array.isArray(saved[0]) ? saved.map(([id, name, leader, base, known]) => ({ id: String(id), name, leader, base, known })) : saved;
    setDecks(tid, 'saved', rows);
    return;
  }
  const shared = await loadSharedDecks(tid);
  if (shared) setDecks(tid, 'shared', shared.rows);
}

// One refresh at a time; a request that arrives mid-refresh (e.g. following another event) runs straight after.
let refreshing = null, queued = null;
async function refreshLive(opts = {}) {
  if (refreshing) { queued = opts; return refreshing; }
  refreshing = doRefresh(opts).finally(() => {
    refreshing = null;
    if (queued) { const next = queued; queued = null; return refreshLive(next); }
  });
  return refreshing;
}
async function doRefresh({ full = true, quiet = false } = {}) {
  const tid = state.liveId; if (!tid) return;
  const btn = $('refresh');
  btn.disabled = true;
  if (!quiet) setLiveStatus('Checking melee.gg…');
  try {
    const L = await loadLive(tid, { full });
    if (state.liveId !== tid) return;
    await ensureDecks(L.id);
    if (state.asOf) { const v = computeView(); await ensureStandings([v.at?.id, v.prev?.id]); }
    $('evname').value = store(true, 'swu-ev-' + tid) || L.name;
    rememberEvent(L.id, L.name);
    render();
    for (const r of L.newlyCompleted || []) toast(`${r.name} results are in`, { label: 'Standings', run: () => selectTab('standings') });
  } catch (e) {
    if (state.liveId === tid) setLiveStatus(esc(e.message), true);
  } finally {
    btn.disabled = false;
  }
}

async function setAsOf(roundId) {
  state.asOf = roundId ? Number(roundId) : null;
  state.pairRound = null;
  if (state.asOf) {
    const v = computeView();
    setLiveStatus('Loading that round…');
    try { await ensureStandings([v.at?.id, v.prev?.id, ...(state.live.rounds.filter(r => r.swiss && r.completed).map(r => r.id))].filter(Boolean)); }
    catch (e) { setLiveStatus(esc(e.message), true); }
  }
  render();
}

function follow(tid) {
  tid = String(tid);
  if (state.liveId !== tid) { state.live = null; state.view = null; state.asOf = null; state.decks = null; state.pairRound = null; state.feature = null; }
  state.liveId = tid;
  store(false, 'bdst-live', tid);
  $('melee-url').value = `https://melee.gg/Tournament/View/${tid}`;
  renderLive();
  return refreshLive();
}

function unfollow() {
  state.liveId = null; state.live = null; state.view = null; state.asOf = null; state.decks = null;
  store(false, 'bdst-live', '');
  $('melee-url').value = '';
  $('auto').checked = false; setAuto(false);
  setLiveStatus('Paste a melee.gg tournament link and press Follow.');
  $('asof-wrap').hidden = true;
  if (!state.rounds.size) addFile(parseCSV(SAMPLE_CSV), true);
  $('evname').value = state.sample ? 'Sample event' : store(true, 'swu-ev-' + state.tid);
  setNotice(state.sample ? `Showing a <b>sample event</b> (${finalRound().length} players). Upload your own export or follow a live tournament.` : '');
  render();
}

// ---------- auto refresh ----------
let autoTimer = null;
function setAuto(on) {
  clearInterval(autoTimer); autoTimer = null;
  store(false, 'bdst-auto', on ? '1' : '');
  if (on) autoTimer = setInterval(() => { if (!document.hidden && !state.asOf) refreshLive({ full: false, quiet: true }); }, 120000);
}
document.addEventListener('visibilitychange', () => { if (!document.hidden && autoTimer && !state.asOf) refreshLive({ full: false, quiet: true }); });

// ---------- wiring ----------
const drop = $('drop'), input = $('file');
input.addEventListener('change', () => { handleFiles(input.files); input.value = ''; });
['dragenter', 'dragover'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(t => drop.addEventListener(t, e => { e.preventDefault(); drop.classList.remove('over'); }));
document.addEventListener('dragover', e => e.preventDefault());
document.addEventListener('drop', e => { e.preventDefault(); handleFiles(e.dataTransfer.files); });

for (const [id, v] of [['gen-on', true], ['gen-off', false]])
  $(id).addEventListener('click', () => { state.gen = v; setPressed('genseg', id); render(); });
for (const [id, v] of [['by-deck', 'deck'], ['by-leader', 'leader'], ['by-base', 'base']])
  $(id).addEventListener('click', () => { state.groupBy = v; setPressed('byseg', id); renderOverviewAndDecks(); });
$('showwin').addEventListener('change', e => { state.showWin = e.target.checked; store(false, 'bdst-showwin', state.showWin ? '1' : ''); renderOverviewAndDecks(); });
for (const [id, v] of [['sby-deck', 'deck'], ['sby-leader', 'leader']])
  $(id).addEventListener('click', () => { state.seasonBy = v; setPressed('sbyseg', id); renderSeason(); });
$('mu-playoffs').addEventListener('change', e => { state.matchPlayoffs = e.target.checked; $('mu-detail').hidden = true; renderMatchups(); });
$('matrix').addEventListener('click', e => { const td = e.target.closest('td[data-mu]'); if (td) showMatchupDetail(td.dataset.mu); });
$('matrix').addEventListener('keydown', e => { const td = e.target.closest('td[data-mu]'); if (td && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); showMatchupDetail(td.dataset.mu); } });
$('pair-round').addEventListener('change', e => { state.pairRound = Number(e.target.value); renderPairings(); });
$('pair-filter').addEventListener('input', () => filterRows('pair-filter', '#pairings .pr'));
$('pair-feature').addEventListener('change', renderPairings);
$('standings-filter').addEventListener('input', () => filterRows('standings-filter', '#standings tbody tr'));
$('team-tag').addEventListener('input', e => { store(false, 'bdst-team', e.target.value.trim()); render(); });
$('t30-link').value = store(true, 'bdst-t30');
$('t30-swap').checked = !!store(true, 'bdst-t30swap');
$('t30-link').addEventListener('change', e => { store(false, 'bdst-t30', e.target.value.trim()); renderStream(); });
$('t30-swap').addEventListener('change', e => { store(false, 'bdst-t30swap', e.target.checked ? '1' : ''); renderStream(); if (t30stop) testTake30(); });
$('t30-test').addEventListener('click', () => { store(false, 'bdst-t30', $('t30-link').value.trim()); renderStream(); testTake30(); });
$('asof').addEventListener('change', e => setAsOf(e.target.value || null));
$('evname').addEventListener('input', e => { const k = state.liveId || state.tid; if (!state.sample && k) store(false, 'swu-ev-' + k, e.target.value); });

$('follow').addEventListener('click', () => {
  const tid = parseTournament($('melee-url').value);
  if (!tid) { setLiveStatus('That doesn’t look like a melee.gg tournament link. It should look like https://melee.gg/Tournament/View/457640.', true); return; }
  follow(tid);
});
$('melee-url').addEventListener('keydown', e => { if (e.key === 'Enter') $('follow').click(); });
$('refresh').addEventListener('click', () => refreshLive({ full: true }));
$('unfollow').addEventListener('click', unfollow);
$('auto').addEventListener('change', e => { setAuto(e.target.checked); if (e.target.checked) toast('Auto-refresh is on. The page checks melee.gg every 2 minutes while it’s open.'); });

$('admin-save').addEventListener('click', async () => {
  const key = $('admin-key').value.trim();
  if (!key) { orgMsg('Enter the organiser passcode.', true); return; }
  orgMsg('Checking…');
  try { await checkAdmin(key); store(false, 'bdst-admin', key); store(false, 'bdst-admin-ok', '1'); $('admin-key').value = ''; orgMsg('Unlocked. This device stays unlocked until you clear its browser data.'); }
  catch (e) { store(false, 'bdst-admin-ok', ''); orgMsg(e.message, true); }
  renderOrganiser();
  if (state.tab === 'season') renderSeason();
});
$('share-decks').addEventListener('click', async () => {
  orgMsg('Sharing decklists…');
  try { const rows = [...state.decks.byId.values()]; await shareDecks(state.live.id, rows); orgMsg(`Shared ${rows.length} decklists. Anyone following ${state.live.name} now sees decks.`); }
  catch (e) { orgMsg(e.message, true); }
});
$('save-archive').addEventListener('click', async () => {
  const done = state.live.rounds.every(r => !r.started || r.completed) && state.live.rounds.some(r => r.completed);
  orgMsg('Saving to the season archive…');
  try { await saveArchive(); orgMsg(`Saved ${state.live.name} to the season archive${done ? '' : ' (it isn’t finished yet; save again at the end to update it)'}.`); }
  catch (e) { orgMsg(e.message, true); }
});

// Delegated clicks: players, recent events, image buttons, copy links, archive removal
document.addEventListener('click', async e => {
  const t = e.target;
  const pl = t.closest('.plink[data-player]'); if (pl) { openPlayer(pl.dataset.player); return; }
  const rf = t.closest('[data-follow]'); if (rf) { follow(rf.dataset.follow); return; }
  const im = t.closest('[data-image]'); if (im) { openShare(im.dataset.image); return; }
  const ft = t.closest('[data-feature]'); if (ft) { const [roundId, table] = ft.dataset.feature.split('|'); state.feature = { roundId: Number(roundId), table }; openShare('feature'); return; }
  const kd = t.closest('#kindseg [data-kind]'); if (kd) { state.kind = kd.dataset.kind; renderKinds(); shareHint(); refreshShot(); return; }
  const cp = t.closest('[data-copy]');
  if (cp) { try { await navigator.clipboard.writeText(cp.dataset.copy); toast('Link copied'); } catch (err) { toast('Copy didn’t work here; select the link and copy it.'); } return; }
  const un = t.closest('[data-unarchive]');
  if (un) { if (!un.dataset.sure) { un.dataset.sure = '1'; un.textContent = 'Click again to remove'; return; } try { await deleteArchived(un.dataset.unarchive); toast('Removed from the archive'); renderSeason(); } catch (err) { toast(err.message); } }
});

$('share').addEventListener('click', () => openShare());
for (const [id, v] of [['chart-treemap', 'treemap'], ['chart-ring', 'ring']])
  $(id).addEventListener('click', () => { state.chart = v; setPressed('chartseg', id); refreshShot(); });
for (const [id, v] of [['fmt-wide', 'wide'], ['fmt-tall', 'tall']])
  $(id).addEventListener('click', () => { state.format = v; setPressed('fmtseg', id); shareHint(); refreshShot(); });
const closeModals = () => { $('modal').hidden = true; $('player-modal').hidden = true; };
$('modal-close').addEventListener('click', () => { $('modal').hidden = true; });
$('modal').addEventListener('click', e => { if (e.target.id === 'modal') e.target.hidden = true; });
$('player-close').addEventListener('click', () => { $('player-modal').hidden = true; });
$('player-modal').addEventListener('click', e => { if (e.target.id === 'player-modal') e.target.hidden = true; });
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModals(); });
$('copy').addEventListener('click', async () => {
  const msg = $('share-msg');
  try { await navigator.clipboard.write([new ClipboardItem({ 'image/png': lastBlob })]); msg.textContent = 'Copied. Paste it into Discord, Instagram or anywhere else.'; }
  catch (e) { msg.textContent = 'Copying images is blocked here. Right-click the image (or press and hold on a phone) and choose Save or Copy.'; }
});
$('dl').addEventListener('click', async () => {
  const name = (($('evname').value.trim() || 'bdst') + '-' + state.kind).replace(/[^\w-]+/g, '-').toLowerCase() + '.png';
  const msg = $('share-msg');
  if (downloads) {
    try { await downloads.save({ filename: name, data: lastBlob }); msg.textContent = 'Saved ' + name + '.'; }
    catch (e) { if (e?.code !== 'declined') msg.textContent = 'Saving is not available here. Right-click the image (or press and hold on a phone) to save it.'; }
    return;
  }
  const a = document.createElement('a'); a.href = $('shot').src; a.download = name; a.click();
});

// ---------- start ----------
function boot() {
  state.showWin = !!store(true, 'bdst-showwin'); $('showwin').checked = state.showWin;
  addFile(parseCSV(SAMPLE_CSV), true);
  $('evname').value = 'Sample event';
  setNotice(`Showing a <b>sample event</b> (${finalRound().length} players). Upload your own export or follow a live tournament.`);
  selectTab((location.hash || '').slice(1) || store(true, 'bdst-tab') || 'decks', { push: false });
  render();
  const params = new URLSearchParams(location.search);
  if (params.get('overlay')) return;            // overlay.js takes over
  const saved = parseTournament(params.get('t') || '') || store(true, 'bdst-live');
  if (store(true, 'bdst-auto')) { $('auto').checked = true; setAuto(true); }
  if (saved) follow(saved);
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
boot();
