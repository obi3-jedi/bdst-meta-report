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
      const [a, b] = m.players, da = deckOf(a), db = deckOf(b);
      const sideHtml = (p, d, right) => `<div class="ov-side ${right ? 'right' : ''}">${art(d)}<div><b>${esc(p.name)}</b><span>${d ? esc(d.label) : ''}</span><span class="r2">${p.standing ? `#${p.standing.rank} · ${esc(p.standing.record)}` : ''}</span></div></div>`;
      root.innerHTML = `<div class="ov-card"><div class="ov-vs">${sideHtml(a, da, false)}<div class="ov-mid">${m.hasResult ? `${a.gameWins}–${b.gameWins}` : 'VS'}<small>${esc(pr.round.name)} · Table ${esc(m.table)}</small></div>${sideHtml(b, db, true)}</div></div>`;
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
