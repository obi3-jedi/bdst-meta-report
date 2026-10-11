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
      const m = pr?.rows.find(x => String(x.table) === String(table)) || pr?.rows.find(x => x.players.length === 2);
      if (!m || m.players.length < 2) { root.innerHTML = `<div class="ov-card"><div class="ov-empty">No match at table ${esc(table)} yet.</div></div>`; return; }
      root.classList.add('fm-mode');
      root.innerHTML = featureBanner(pr.round, m, params.get('pos') === 'bottom' ? 'bottom' : 'top');
      applyTake30();
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
  function featureBanner(round, m, pos) {
    const BEST_OF = 3, need = Math.ceil(BEST_OF / 2);
    const side = (p, right) => {
      const d = deckOf(p);
      const gi = d ? genericInfo.get(d.base) : null;
      const bc = d ? card('bases', d.rawBase) : null;
      const strip = gi ? `<i class="fm-strip" style="background:${ASPECT_VAR[gi.aspect]}"></i>` : bc?.i ? `<i class="fm-strip" style="background-image:url('${bc.i}')"></i>` : '<i class="fm-strip"></i>';
      const pipsHtml = Array.from({ length: need }, (_, i) => `<i class="${i < (p.gameWins || 0) ? 'on' : ''}"></i>`).join('');
      return `<div class="fm-side ${right ? 'right' : 'left'}">
        <div class="fm-art">${d ? leaderImg(d.leader, 'fm-img') : '<span class="fm-img"></span>'}${strip}</div>
        <div class="fm-info"><b>${esc(p.name)}</b><span class="fm-deck">${d ? esc(d.label) : ''}</span>
          <span class="fm-rec">${p.standing ? `#${p.standing.rank} · ${esc(p.standing.record)}` : ''}</span></div>
        <div class="fm-pips" title="Games won">${pipsHtml}</div></div>`;
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
    const shape = `<svg class="fm-shape" viewBox="0 0 1920 120" preserveAspectRatio="none" aria-hidden="true">
      <polygon points="0,0 1920,0 1920,116 1450,116 1230,46 690,46 470,116 0,116" fill="rgba(10,3,5,.9)"/>
      <polyline points="0,116 470,116 690,46 1230,46 1450,116 1920,116" fill="none" stroke="#ff1418" stroke-width="4" stroke-linejoin="round"/></svg>`;
    return `<div class="fm ${pos}">${shape}${side(a, false)}
      <div class="fm-mid">${hp(a, false)}<div class="fm-round">${esc(round.name)}<small>Table ${esc(m.table ?? '')}<i class="fm-live" title="Take 30 base counters"></i></small></div>${hp(b, true)}</div>
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
  if (t30) listenTake30(t30, tree => { t30tree = tree; applyTake30(); }, s => { t30state = s; applyTake30(); });

  async function tick(full) {
    if (!tid) { root.innerHTML = '<div class="ov-card"><div class="ov-empty">Add &t=&lt;tournament id&gt; to the link.</div></div>'; return; }
    try {
      await loadLive(tid, { full });
      await ensureDecks(state.live.id);
      draw();
    } catch (e) { if (!state.view) root.innerHTML = `<div class="ov-card"><div class="ov-empty">${esc(e.message)}</div></div>`; }
  }
  state.liveId = tid;
  tick(true);
  setInterval(() => tick(false), 60000);
})();
