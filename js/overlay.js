// Stream overlays: ?overlay=standings|feature|bracket|decks&t=<tournament>
// A transparent page with just the overlay, for an OBS Browser Source. It refreshes itself every minute.
(function () {
  const params = new URLSearchParams(location.search);
  const type = params.get('overlay');
  if (!type) return;
  const tid = parseTournament(params.get('t') || '');
  const n = Math.max(1, Math.min(16, parseInt(params.get('n'), 10) || 8));
  const table = params.get('table') || '1';
  state.overlay = true;
  document.body.classList.add('overlay');
  const root = document.getElementById('overlay');
  root.hidden = false;

  const head = (title, meta) => `<div class="ov-title"><img src="bdst-logo.png" alt="BDST">${esc(title)}<small>${esc(meta || '')}</small></div>`;
  const art = d => d ? leaderImg(d.leader) : '<span class="thumb" aria-hidden="true"></span>';

  function draw() {
    computeView();
    const v = state.view, L = state.live;
    if (!v) { root.innerHTML = `<div class="ov-card"><div class="ov-empty">Waiting for melee.gg…</div></div>`; return; }
    if (type === 'standings') {
      const ps = currentPlayers().filter(p => !isDropped(p)).slice(0, n);
      root.innerHTML = `<div class="ov-card">${head('Standings', v.round ? 'after ' + v.round : '')}<div class="ov-list">${ps.map(p => {
        const d = deckOf(p);
        return `<div class="ov-row"><span class="rk">${p.rank}</span>${art(d)}<div><b>${esc(p.name)}</b><span>${d ? esc(d.label) : ''}</span></div><span class="rec">${esc(p.record)}</span></div>`;
      }).join('') || '<div class="ov-empty">Standings appear after round 1.</div>'}</div></div>`;
    } else if (type === 'decks') {
      const known = currentPlayers().filter(p => p.known), groups = deckGroups(known, 'deck').slice(0, n), total = known.length || 1;
      root.innerHTML = `<div class="ov-card">${head('Most played decks', `${known.length} players`)}<div class="ov-list">${groups.map((g, i) =>
        `<div class="ov-row"><span class="rk">${i + 1}</span>${leaderImg(g.leader)}<div><b>${esc(g.label)}</b><span>${g.count} ${g.count === 1 ? 'player' : 'players'}</span></div><span class="rec">${pct(g.count / total)}</span></div>`).join('') || '<div class="ov-empty">Needs decklists.</div>'}</div></div>`;
    } else if (type === 'feature') {
      const roundId = v.current?.id || v.at?.id;
      const pr = roundId ? pairingsFor(roundId) : null;
      const m = pr ? pickFeatureMatch(pr.rows, featureSel, table) : null;
      if (!m) {
        const who = featureSel?.player ? (currentPlayers().find(p => p.id === String(featureSel.player))?.name || 'that player') : null;
        root.classList.remove('fm-mode');
        root.innerHTML = `<div class="ov-card"><div class="ov-empty">${who ? `Waiting for ${esc(who)}’s next match.` : `No match at table ${esc(featureSel?.table ?? table)} yet.`}</div></div>`;
        return;
      }
      root.classList.add('fm-mode');
      root.innerHTML = featureBanner(pr.round, m, params.get('pos') === 'bottom' ? 'bottom' : 'top');
      applyTake30();
      lastMatch = { round: pr.round, m };
      syncTake30Colors(pr.round, m);
    } else if (type === 'bracket') {
      const br = v.bracket;
      if (!br) { root.innerHTML = `<div class="ov-card"><div class="ov-empty">The bracket appears after the first Swiss round.</div></div>`; return; }
      root.innerHTML = `<div class="ov-card">${head(`Top ${br.size}`, br.note)}<div class="board" style="background:none;border:0;padding:12px 0 0"><div class="bracket" id="ov-bracket"></div></div></div>`;
      // Reuse the page's bracket drawing
      const el = document.getElementById('bracket');
      renderBracket();
      const ov = document.getElementById('ov-bracket');
      ov.style.setProperty('--cols', br.rounds.length);
      ov.innerHTML = el.innerHTML;
    } else {
      root.innerHTML = `<div class="ov-card"><div class="ov-empty">Unknown overlay “${esc(type)}”. Use standings, feature, bracket or decks.</div></div>`;
    }
  }

  // Feature match banner for a 1920 × 1080 canvas: tall at the ends for the players, raking in to a thin
  // centre strip (base counters, round and table) so the middle of the board stays visible.
  const ASPECT_VAR = { Vigilance: 'var(--vig)', Command: 'var(--com)', Aggression: 'var(--agg)', Cunning: 'var(--cun)', Heroism: 'var(--her)', Villainy: '#000' };
  // The camera shows a square play mat. By default it fills the frame's height (1080 of 1920 × 1080), centred,
  // leaving 420 px each side. &mat=<px> sets the mat's on-screen size if the camera is framed differently.
  // The player panels and the rake stay in the side areas; only the thin centre strip crosses the mat.
  function geometry() {
    const mat = Math.max(600, Math.min(1500, parseInt(params.get('mat'), 10) || 1080));
    const L = (1920 - mat) / 2, R = L + mat, rake = Math.min(90, Math.max(40, L * .22));
    return { mat, L, R, rake, side: L - rake, H: 116, C: 40 };
  }
  const G = geometry();
  function featureBanner(round, m, pos) {
    const BEST_OF = 3, need = Math.ceil(BEST_OF / 2);
    const side = (p, right) => {
      const d = deckOf(p);
      const gi = d ? genericInfo.get(d.base) : null;
      const bc = d ? card('bases', d.rawBase) : null;
      const strip = gi ? `<i class="fm-strip" style="background:${ASPECT_VAR[gi.aspect]}"></i>` : bc?.i ? `<i class="fm-strip" style="background-image:url('${bc.i}')"></i>` : '<i class="fm-strip"></i>';
      const pipsHtml = Array.from({ length: need }, (_, i) => `<i class="${i < (p.gameWins || 0) ? 'on' : ''}"></i>`).join('');
      return `<div class="fm-side ${right ? 'right' : 'left'}" style="width:calc(${G.side} * var(--u))">
        <div class="fm-art">${d ? leaderImg(d.leader, 'fm-img') : '<span class="fm-img"></span>'}${strip}</div>
        <div class="fm-info"><b>${esc(p.name)}</b><span class="fm-deck">${d ? esc(d.label) : ''}</span>
          <span class="fm-line"><span class="fm-rec">${p.standing ? `#${p.standing.rank} · ${esc(p.standing.record)}` : ''}</span><span class="fm-pips" title="Games won">${pipsHtml}</span></span></div></div>`;
    };
    // Base counters: the base's printed health until a live counter (e.g. Take 30) is linked
    const hp = (p, right) => {
      const d = deckOf(p);
      const gi = d ? genericInfo.get(d.base) : null;
      const bc = d ? card('bases', d.rawBase) : null;
      const sw = gi ? `<span class="fm-bsw" style="background:${ASPECT_VAR[gi.aspect]}"></span>` : bc?.i ? `<span class="fm-bsw" style="background-image:url('${bc.i}')"></span>` : '<span class="fm-bsw"></span>';
      // Damage out of the base's health: starts at 0/33 and the first number counts up
      const total = bc?.hp ?? '';
      return `<div class="fm-hp ${right ? 'right' : 'left'}" data-side="${right ? 1 : 0}" data-printed="${total}">${right ? '' : sw}<span class="fm-dmg"><b>0</b><small>/${total || '–'}</small></span>${right ? sw : ''}</div>`;
    };
    const [a, b] = m.players;
    // The banner outline: full height at the ends, raking down to a thin strip in the middle
    const { L, R, rake, H, C } = G;
    const edge = `0,${H} ${L - rake},${H} ${L},${C} ${R},${C} ${R + rake},${H} 1920,${H}`;
    const shape = `<svg class="fm-shape" viewBox="0 0 1920 120" preserveAspectRatio="none" aria-hidden="true">
      <polygon points="0,0 1920,0 ${edge.split(' ').reverse().join(' ')}" fill="rgba(10,3,5,.9)"/>
      <polyline points="${edge}" fill="none" stroke="#ff1418" stroke-width="4" stroke-linejoin="round"/></svg>`;
    return `<div class="fm ${pos}">${shape}${side(a, false)}
      <div class="fm-mid" style="left:calc(${L + 16} * var(--u));width:calc(${R - L - 32} * var(--u))">${hp(a, false)}<div class="fm-flash" hidden>New game</div><div class="fm-round">${esc(round.name)}<small>Table ${esc(m.table ?? '')}<i class="fm-live" title="Take 30 base counters"></i></small></div>${hp(b, true)}</div>
      ${side(b, true)}</div>`;
  }

  // Live base counters from Take 30 (&t30=<link>, &t30swap=1 if its players are the other way round)
  const t30 = take30Url(params.get('t30'));
  const t30swap = params.get('t30swap') === '1';
  let t30tree = null, t30state = 'off';
  function applyTake30() {
    const live = document.querySelector('.fm-live');
    if (live) live.dataset.state = t30 ? t30state : 'off';
    const vals = t30tree ? take30Health(t30tree) : null;
    if (!vals) return;
    document.querySelectorAll('.fm-hp[data-side]').forEach(el => {
      const i = Number(el.dataset.side), v = vals[t30swap ? 1 - i : i];
      if (!v) return;
      // Show damage taken out of the base's real health (from the decklist). Take 30 counts damage up from 0;
      // its own starting health is only used when we don't know the player's base.
      const total = Number(el.dataset.printed) || v.start || null;
      let dmg = v.damage;
      if (dmg == null && v.health != null && total) dmg = total - v.health;
      if (dmg == null) return;
      dmg = Math.max(0, Math.round(dmg));
      const b = el.querySelector('b'), small = el.querySelector('small');
      if (small && total) small.textContent = '/' + total;
      if (b.textContent !== String(dmg)) { b.textContent = String(dmg); el.classList.remove('hit'); void el.offsetWidth; el.classList.add('hit'); }
      el.classList.toggle('low', !!total && total - dmg <= 5);
    });
  }
  // A reset (action: "reset" in Take 30, from the Stream tab or the app) flashes NEW GAME on screen and
  // re-sends the matchup's colours and starting health, in case the reset put the app back to its defaults.
  let lastAction = null, lastMatch = null;
  function onTake30Action(tree) {
    const action = tree?.action ?? null;
    if (action === 'reset' && lastAction !== 'reset') {
      const flash = document.querySelector('.fm-flash');
      if (flash) { flash.hidden = false; flash.classList.remove('show'); void flash.offsetWidth; flash.classList.add('show'); setTimeout(() => { flash.hidden = true; }, 4000); }
      colorsSentFor = null;
      if (lastMatch) setTimeout(() => syncTake30Colors(lastMatch.round, lastMatch.m, true), 2500);
    }
    lastAction = action;
  }
  if (t30) listenTake30(t30, tree => { t30tree = tree; onTake30Action(tree); applyTake30(); }, s => { t30state = s; applyTake30(); });

  // Send the matchup's base colours and starting health to Take 30 once per match (so anything changed by hand
  // in the app is left alone).
  // Turn off with &t30colors=0.
  const t30colors = params.get('t30colors') !== '0';
  let colorsSentFor = null;
  async function syncTake30Colors(round, m, force = false) {
    if (!t30 || !t30colors || m.players.length < 2) return;
    const key = `${round.id}|${m.table}|${m.players.map(p => p.id).join('|')}`;
    if (colorsSentFor === key) return;
    const fields = take30MatchFields(m, t30swap);
    if (!Object.keys(fields).length) return;
    // Wait for Take 30's current state so unchanged colours aren't rewritten
    if (!t30tree) { setTimeout(() => syncTake30Colors(round, m), 1500); return; }
    const changed = force ? fields : Object.fromEntries(Object.entries(fields).filter(([k, v]) => t30tree[k] !== v));
    colorsSentFor = key;
    if (!Object.keys(changed).length) return;
    try { await sendTake30(t30, changed); } catch (e) { colorsSentFor = null; console.warn(e.message); }
  }

  async function tick(full) {
    if (!tid) { root.innerHTML = '<div class="ov-card"><div class="ov-empty">Add &t=&lt;tournament id&gt; to the link.</div></div>'; return; }
    try {
      await loadLive(tid, { full });
      await ensureDecks(state.live.id);
      draw();
    } catch (e) { if (!state.view) root.innerHTML = `<div class="ov-card"><div class="ov-empty">${esc(e.message)}</div></div>`; }
  }
  // The feature match picked on the Stream tab or in Pairings (checked every few seconds)
  let featureSel = null;
  async function checkFeature() {
    if (type !== 'feature' || !tid) return;
    const sel = await loadFeature(tid);
    if (!sel) return;
    const next = JSON.stringify({ table: sel.table ?? null, player: sel.player ?? null });
    if (next !== JSON.stringify({ table: featureSel?.table ?? null, player: featureSel?.player ?? null })) { featureSel = sel; if (state.view) draw(); }
  }
  state.liveId = tid;
  checkFeature();
  setInterval(checkFeature, 4000);
  tick(true);
  setInterval(() => tick(false), 60000);
})();
