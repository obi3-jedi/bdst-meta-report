// Stream overlays: ?overlay=standings|feature|bracket|decks&t=<tournament>
// A transparent page with just the overlay, for an OBS Browser Source. It refreshes itself every minute.
(async function () {
  const params = new URLSearchParams(location.search);
  const type = params.get('overlay');
  if (!type) return;
  // A tournament's overlay link (&k=<key>) loads its event and the team's saved stream settings,
  // and reloads itself when they change (e.g. someone pastes a new Take 30 link)
  const key = params.get('k');
  if (key) {
    const root0 = document.getElementById('overlay');
    root0.hidden = false; document.body.classList.add('overlay');
    let info;
    for (;;) {
      try { info = await relay('/overlay/' + encodeURIComponent(key)); break; }
      catch (e) {
        root0.innerHTML = `<div class="ov-card"><div class="ov-empty">${esc(e.message)}</div></div>`;
        if (e.status === 404) return;
        await new Promise(r => setTimeout(r, 15000));
      }
    }
    const st = info.settings || {};
    params.set('t', info.meleeId);
    params.set('name', info.name || '');
    if (st.breakSlides && !params.get('slides')) params.set('slides', st.breakSlides.join(','));
    if (st.breakSeconds && !params.get('sec')) params.set('sec', st.breakSeconds);
    if (st.take30) params.set('t30', st.take30);
    if (st.take30Swap) params.set('t30swap', '1');
    if (st.take30Colors === false) params.set('t30colors', '0');
    if (st.mat) params.set('mat', st.mat);
    if (st.pos === 'bottom') params.set('pos', 'bottom');
    const sig = JSON.stringify([info.meleeId, st]);
    setInterval(async () => {
      try { const now = await relay('/overlay/' + encodeURIComponent(key)); if (JSON.stringify([now.meleeId, now.settings || {}]) !== sig) location.reload(); }
      catch (e) { if (e.status === 404) location.reload(); }
    }, 30000);
  }
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
    if (type === 'break') { breakDraw(); return; }
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
      const show = showFor(featureSel, pr.round, m), shown = orderedMatch(m, show);
      root.innerHTML = featureBanner(pr.round, shown, params.get('pos') === 'bottom' ? 'bottom' : 'top', show);
      applyTake30();
      lastMatch = { round: pr.round, m: shown };
      syncTake30Colors(pr.round, shown);
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
      root.innerHTML = `<div class="ov-card"><div class="ov-empty">Unknown overlay “${esc(type)}”. Use standings, feature, bracket, decks or break.</div></div>`;
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
  function featureBanner(round, m, pos, show) {
    const BEST_OF = 3, need = Math.ceil(BEST_OF / 2);
    const side = (p, right) => {
      const d = deckOf(p);
      const gi = d ? genericInfo.get(d.base) : null;
      const bc = d ? card('bases', d.rawBase) : null;
      const strip = gi ? `<i class="fm-strip" style="background:${ASPECT_VAR[gi.aspect]}"></i>` : bc?.i ? `<i class="fm-strip" style="background-image:url('${bc.i}')"></i>` : '<i class="fm-strip"></i>';
      const pipsHtml = Array.from({ length: need }, (_, i) => `<i class="${i < gameWinsOf(p, show) ? 'on' : ''}"></i>`).join('');
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


  // ---------- Break screen (?overlay=break): a full 1920 × 1080 screen cycling through the event ----------
  // &slides=upnext,standings,decks,race,bracket,recap,aspects picks and orders the slides; &sec=15 the seconds per slide.
  // Slides with nothing to show yet (e.g. the bracket during Swiss) are skipped.
  const BREAK_ALL = ['upnext', 'standings', 'decks', 'race', 'bracket', 'recap', 'aspects'];
  const brkSlides = (params.get('slides') || '').split(',').filter(x => BREAK_ALL.includes(x));
  const brkWanted = brkSlides.length ? brkSlides : BREAK_ALL;
  const brkSec = Math.max(5, Math.min(120, parseInt(params.get('sec'), 10) || 15));
  let brkIdx = -1, brkTimer = null;

  function brkShell() {
    if (root.querySelector('.brk')) return;
    root.classList.add('brk-mode');
    root.innerHTML = `<div class="brk">
      <div class="brk-top"><img src="bdst-logo.png" alt="BDST"><div class="brk-ev"><b></b><small></small></div><div class="brk-back">We’ll be right back</div></div>
      <div class="brk-stage"><div class="brk-slide"></div></div>
      <div class="brk-foot"><div class="brk-dots"></div><div class="brk-bar"><i></i></div></div></div>`;
    const fit = () => root.querySelector('.brk').style.setProperty('--s', Math.min(innerWidth / 1920, innerHeight / 1080));
    addEventListener('resize', fit); fit();
  }
  function breakDraw() {
    brkShell();
    const v = state.view, L = state.live;
    root.querySelector('.brk-ev b').textContent = params.get('name') || L?.name || '';
    root.querySelector('.brk-ev small').textContent = !v ? 'Waiting for melee.gg…'
      : v.current ? `${v.current.name} in progress` : v.round ? `After ${v.round}` : 'Starting soon';
    if (brkIdx < 0) brkNext();
  }
  const brkAvailable = () => brkWanted.filter(id => { try { return !!BREAK[id](); } catch (e) { return false; } });
  function brkNext() {
    clearTimeout(brkTimer);
    const list = brkAvailable();
    const slide = root.querySelector('.brk-slide');
    if (!list.length) {
      brkIdx = 0;
      slide.innerHTML = `<div class="brk-empty"><b>We’ll be right back</b><span>${state.view ? 'Standings and decks appear here once the first round is in.' : 'Loading the event…'}</span></div>`;
      root.querySelector('.brk-dots').innerHTML = '';
      brkTimer = setTimeout(brkNext, 5000);
      return;
    }
    const cur = list[brkIdx] ? brkWanted.indexOf(list[brkIdx]) : -1;
    // Next slide in the chosen order after the one showing
    const nextId = list.find(id => brkWanted.indexOf(id) > cur) || list[0];
    brkIdx = list.indexOf(nextId);
    const s = BREAK[nextId]();
    slide.classList.remove('in');
    setTimeout(() => {
      slide.innerHTML = `<div class="brk-h"><h1>${s.title}</h1>${s.sub ? `<span>${esc(s.sub)}</span>` : ''}</div><div class="brk-body brk-${nextId}">${s.html}</div>`;
      if (s.after) s.after(slide);
      void slide.offsetWidth; slide.classList.add('in');
      root.querySelector('.brk-dots').innerHTML = list.map((id, i) => `<i class="${i === brkIdx ? 'on' : ''}"></i>`).join('');
      const bar = root.querySelector('.brk-bar i');
      bar.style.animation = 'none'; void bar.offsetWidth; bar.style.animation = `brk-bar ${brkSec}s linear forwards`;
    }, 450);
    brkTimer = setTimeout(brkNext, brkSec * 1000);
  }
  const bArt = (leader, cls = 'brk-art') => leader ? leaderImg(leader, cls) : `<span class="${cls}"></span>`;
  const BREAK = {
    upnext() {
      const v = state.view; if (!v?.current) return null;
      const pr = pairingsFor(v.current.id); if (!pr) return null;
      const m = pickFeatureMatch(pr.rows, featureSel, table); if (!m) return null;
      const shown = orderedMatch(m, showFor(featureSel, pr.round, m));
      const side = (p, right) => { const d = deckOf(p); return `<div class="brk-p ${right ? 'r' : ''}">${bArt(d?.leader, 'brk-big')}<div><b>${esc(p.name)}</b><span>${d ? esc(d.label) : ''}</span>
        <em>${p.standing ? `#${p.standing.rank} · ${esc(p.standing.record)}` : ''}</em></div></div>`; };
      return { title: 'Feature match', sub: `${pr.round.name} · Table ${m.table ?? ''}`, html: `${side(shown.players[0], false)}<div class="brk-vs">VS</div>${side(shown.players[1], true)}` };
    },
    standings() {
      const v = state.view; if (!v?.players?.length) return null;
      const ps = currentPlayers().filter(p => !isDropped(p)).slice(0, 8);
      return { title: 'Standings', sub: v.round ? `After ${v.round}` : '', html: `<div class="brk-list">${ps.map(p => { const d = deckOf(p);
        return `<div class="brk-row"><span class="rk">${p.rank}</span>${bArt(d?.leader)}<div class="nm"><b>${esc(p.name)}</b><span>${d ? esc(d.label) : ''}</span></div><span class="rec">${esc(p.record)}</span><span class="pts">${p.points ?? ''}<small>pts</small></span></div>`; }).join('')}</div>` };
    },
    decks() {
      const known = currentPlayers().filter(p => p.known); if (known.length < 2) return null;
      const groups = deckGroups(known, 'deck').slice(0, 8), top = groups[0].count;
      return { title: 'Most played decks', sub: `${known.length} decklists`, html: `<div class="brk-list">${groups.map((g, i) =>
        `<div class="brk-row deck"><span class="rk">${i + 1}</span>${bArt(g.leader)}<div class="nm"><b>${esc(g.label)}</b><span class="bar"><i style="width:${g.count / top * 100}%"></i></span></div><span class="rec">${pct(g.count / known.length)}</span><span class="pts">${g.count}<small>${g.count === 1 ? 'player' : 'players'}</small></span></div>`).join('')}</div>` };
    },
    race() {
      const r = computeRace(); if (!r || r.finished || !r.left) return null;
      const near = r.rows.filter(x => x.status !== 'out' || x.rank <= r.cut + 4).sort((a, b) => a.rank - b.rank).filter(x => x.rank >= Math.max(1, r.cut - 3) && x.rank <= r.cut + 4);
      const label = { locked: 'Locked in', alive: 'Alive', out: 'Out' };
      return { title: `Top ${r.cut} race`, sub: `${r.left} ${r.left === 1 ? 'round' : 'rounds'} to go${r.line != null ? ` · cut line ${r.line} pts` : ''}`, html: `
        <div class="brk-stats">${['locked', 'alive', 'out'].map(k => `<div class="${k}"><b>${r.counts[k]}</b><span>${label[k]}</span></div>`).join('')}</div>
        <div class="brk-list tight">${near.map(p => { const d = deckOf(p);
          return `<div class="brk-row ${p.rank === r.cut ? 'cut' : ''}"><span class="rk">${p.rank}</span>${bArt(d?.leader)}<div class="nm"><b>${esc(p.name)}</b><span>${d ? esc(d.label) : ''}</span></div><span class="rec">${esc(p.record)}</span><span class="st ${p.status}">${label[p.status]}</span></div>`; }).join('')}</div>` };
    },
    bracket() {
      const v = state.view, br = v?.bracket; if (!br || !v.swissFinished) return null;
      renderBracket();
      const html = document.getElementById('bracket').innerHTML;
      return { title: `Top ${br.size}`, sub: br.note || '', html: `<div class="brk-fit"><div class="bracket" style="--cols:${br.rounds.length}">${html}</div></div>`,
        after: el => { const box = el.querySelector('.brk-fit'), b = box.firstElementChild; const k = Math.min(box.clientWidth / b.scrollWidth, box.clientHeight / b.scrollHeight, 1.6); b.style.transform = `scale(${k})`; } };
    },
    recap() {
      const r = computeRecap(); if (!r) return null;
      const und = r.undefeated.slice(0, 6), ups = r.upsets.slice(0, 3), dor = r.deckOfRound;
      if (!und.length && !ups.length && !dor) return null;
      const col = (h, body) => `<div class="brk-col"><h3>${h}</h3>${body}</div>`;
      return { title: `${esc(r.round)} recap`, sub: '', html:
        (und.length ? col('Undefeated', und.map(p => { const d = deckOf(p); return `<div class="brk-mini">${bArt(d?.leader)}<div><b>${esc(p.name)}</b><span>${esc(p.record)}${d ? ' · ' + esc(d.label) : ''}</span></div></div>`; }).join('')) : '')
        + (ups.length ? col('Upsets', ups.map(u => `<div class="brk-mini up"><div><b>${esc(u.winner.name)}</b><span>#${u.wr} beat #${u.lr} ${esc(u.loser.name)} · ${esc(u.score)}</span></div></div>`).join('')) : '')
        + (dor ? col('Deck of the round', `<div class="brk-mini big">${bArt(dor.leader, 'brk-big')}<div><b>${esc(dor.label)}</b><span>${dor.w} wins, ${dor.l} ${dor.l === 1 ? 'loss' : 'losses'}</span></div></div>`) : '') };
    },
    aspects() {
      const known = currentPlayers().filter(p => p.known); if (known.length < 4) return null;
      const n = known.length, has = a => known.filter(p => deckAspects(p).includes(a)).length;
      return { title: 'Aspects in the room', sub: `${n} decks · a deck counts for every aspect on its leader and base`, html: `<div class="brk-asp">${ASPECTS.map(a => { const c = has(a);
        return `<div class="ba-${a.toLowerCase()}"><span class="bar"><i style="height:${c / n * 100}%"></i></span><b>${pct(c / n)}</b><span>${a}</span></div>`; }).join('')}</div>` };
    },
  };

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
      if (state.asOf) { const v = computeView(); await ensureStandings([v.at?.id, v.prev?.id]); }
      draw();
    } catch (e) { if (!state.view) root.innerHTML = `<div class="ov-card"><div class="ov-empty">${esc(e.message)}</div></div>`; }
  }
  // The feature match picked on the Stream tab or in Pairings (checked every few seconds)
  let featureSel = null;
  async function checkFeature() {
    if ((type !== 'feature' && type !== 'break') || !tid) return;
    const sel = await loadFeature(tid);
    if (!sel) return;
    const sig = x => JSON.stringify({ table: x?.table ?? null, player: x?.player ?? null, round: x?.round ?? null, show: x?.show ?? null });
    if (sig(sel) === sig(featureSel)) return;
    featureSel = sel;
    // A choice picked while replaying an earlier round shows that round, as it was then
    state.asOf = sel.round || null;
    if (state.live && state.asOf) { const v = computeView(); try { await ensureStandings([v.at?.id, v.prev?.id]); } catch (e) {} }
    if (state.view || state.live) draw();
  }
  state.liveId = tid;
  checkFeature();
  setInterval(checkFeature, 4000);
  tick(true);
  setInterval(() => tick(false), 60000);
})();
