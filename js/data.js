// Live tournament data: fetching through the relay, replaying earlier rounds, and everything derived from
// standings + matches (bracket, top 8 race, matchups, round recap, team, match history).

async function relay(path, opts = {}) {
  let res;
  try { res = await fetch(RELAY + path, opts); } catch (e) { throw new Error('Could not reach the live feed. Check your connection and try again.'); }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error || `The live feed answered with an error (${res.status}).`), { status: res.status });
  return body;
}

function parseTournament(text) {
  const m = String(text).match(/Tournament\/View\/(\d+)/i) || String(text).trim().match(/^(\d{3,9})$/);
  return m ? m[1] : null;
}

const isSwissRound = r => /^round\s*\d+$/i.test(r.name);

// Fetch what's new. Finished rounds never change, so their standings and matches are kept;
// a full refresh (the Refresh button) clears that and fetches everything again.
async function loadLive(tid, { full = false } = {}) {
  let L = state.live;
  if (!L || L.id !== String(tid) || full) L = { id: String(tid), standings: new Map(), matches: new Map(), final: new Set() };
  const t = await relay('/tournament/' + tid);
  const before = new Set((L.rounds || []).filter(r => r.completed).map(r => r.id));
  L.name = t.name;
  L.date = t.date || null;
  L.rounds = t.rounds.map(r => ({ ...r, swiss: isSwissRound(r) }));
  const started = L.rounds.filter(r => r.started);
  const needMatches = started.filter(r => !L.final.has(r.id));
  const completed = L.rounds.filter(r => r.completed);
  const last = completed[completed.length - 1];
  const lastSwiss = [...completed].reverse().find(r => r.swiss);
  const prev = completed[completed.length - 2];
  const needStandings = [...new Set([last, lastSwiss, prev].filter(Boolean))].filter(r => !L.standings.has(r.id));
  const results = await Promise.all([
    ...needMatches.map(r => relay('/matches/' + r.id).then(m => ['m', r, m.matches])),
    ...needStandings.map(r => relay('/standings/' + r.id).then(s => ['s', r, s.players])),
  ]);
  for (const [kind, r, data] of results) {
    if (kind === 'm') { L.matches.set(r.id, data); if (r.completed) L.final.add(r.id); }
    else L.standings.set(r.id, data);
  }
  L.updated = new Date();
  L.newlyCompleted = completed.filter(r => !before.has(r.id) && before.size);
  if (state.liveId === String(tid)) state.live = L;   // ignore results for an event we've since switched away from
  return L;
}

// Standings for a finished round, fetched on demand (used when replaying).
async function ensureStandings(roundIds) {
  const L = state.live; if (!L) return;
  const need = roundIds.filter(id => id && !L.standings.has(id));
  const got = await Promise.all(need.map(id => relay('/standings/' + id).then(s => [id, s.players])));
  for (const [id, players] of got) L.standings.set(id, players);
}

// Standings rows from the live feed joined to decklists.
function withDecks(livePlayers) {
  const idx = deckIndex();
  return (livePlayers || []).map(lp => {
    const d = idx && (idx.byId.get(String(lp.playerId)) || idx.byName.get(String(lp.name).toLowerCase()) || idx.byName.get(String(lp.username || '').toLowerCase()));
    return {
      rank: lp.rank, id: String(lp.playerId), name: lp.name, record: lp.record, points: lp.points, status: lp.status,
      leader: d ? d.leader : 'Unknown', base: d ? d.base : 'Unknown', known: !!(d && d.known), matched: !!d, deckId: d?.deckId || '',
    };
  });
}

// What's on screen: the latest standings, or an earlier round when replaying.
function computeView() {
  const L = state.live;
  if (!L?.rounds) { state.view = null; return null; }
  const completed = L.rounds.filter(r => r.completed);
  const latest = completed[completed.length - 1] || null;
  const at = (state.asOf && completed.find(r => r.id === state.asOf)) || latest;
  const replay = !!at && at !== latest;
  const idxOf = r => L.rounds.indexOf(r), atIdx = at ? idxOf(at) : -1;
  const current = replay ? null : (L.rounds.find(r => r.started && !r.completed) || null);
  const visible = L.rounds.filter((r, i) => r.started && (!replay || i <= atIdx));
  const history = visible.map(r => ({ id: r.id, name: r.name, swiss: r.swiss, completed: r.completed, matches: L.matches.get(r.id) || [] }));
  const swissRounds = L.rounds.filter(r => r.swiss);
  const swissDoneNow = swissRounds.filter(r => r.completed && idxOf(r) <= atIdx);
  const lastSwiss = swissDoneNow[swissDoneNow.length - 1] || null;
  const atList = completed.filter(r => idxOf(r) <= atIdx);
  const prev = atList[atList.length - 2] || null;
  const v = {
    at, round: at?.name || null, current, replay, history, prev,
    players: at ? (L.standings.get(at.id) || []) : [],
    swiss: lastSwiss && L.standings.get(lastSwiss.id) ? { round: lastSwiss.name, players: L.standings.get(lastSwiss.id) } : null,
    swissTotal: swissRounds.length, swissDone: swissDoneNow.length,
    swissFinished: swissRounds.length > 0 && swissDoneNow.length === swissRounds.length,
  };
  const playoff = L.rounds.filter(r => !r.swiss);
  v.bracket = v.swiss ? buildBracket(v.swiss.players, playoff.map(r => ({ name: r.name, matches: (history.find(h => h.id === r.id)?.matches) || [] })), v.swissFinished, v.swiss.round) : null;
  state.view = v;
  return v;
}

// The players everything is drawn from: live standings matched to decklists when following, otherwise the uploaded file.
function currentPlayers() {
  if (state.view?.players?.length) return withDecks(state.view.players);
  if (state.live) return [];
  return finalRound();
}

// ---------- top cut bracket ----------
// melee.gg seeds a top 8 as 1v8, 4v5, 2v7, 3v6 (tables 1-4); semifinal 1 is the winners of tables 1 and 2,
// semifinal 2 the winners of tables 3 and 4. Before the cut is paired, the bracket is projected from the standings.
const SEED_ORDER = { 8: [[1, 8], [4, 5], [2, 7], [3, 6]], 4: [[1, 4], [2, 3]], 2: [[1, 2]] };
const DEFAULT_ROUNDS = { 8: ['Quarterfinals', 'Semifinals', 'Finals'], 4: ['Semifinals', 'Finals'], 2: ['Finals'] };

function buildBracket(seedsList, prounds, swissDone, swissName) {
  const k = Math.max(1, Math.min(3, prounds.length || 3)), size = 2 ** k;
  const rounds = prounds.length ? prounds.slice(-k) : DEFAULT_ROUNDS[size].map(name => ({ name, matches: [] }));
  if (seedsList.length < size) return null;
  const seedOf = new Map(seedsList.map(p => [String(p.playerId), p.rank]));
  const bySeed = new Map(seedsList.map(p => [p.rank, p]));
  const entrant = (id, name, gameWins = null) => ({ id: String(id), name, seed: seedOf.get(String(id)) ?? null, gameWins });
  const fromMatch = m => {
    const players = m.players.map(p => entrant(p.playerId, p.name, p.gameWins)).sort((a, b) => (a.seed ?? 99) - (b.seed ?? 99));
    const [a, b] = players;
    const winner = m.hasResult && a && b && a.gameWins !== b.gameWins ? (a.gameWins > b.gameWins ? a : b) : null;
    return { players: [a || null, b || null], winner, played: true };
  };
  const out = [];
  const first = rounds[0];
  const slots = SEED_ORDER[size].map(pair => {
    const m = first.matches.find(m => m.players.some(p => pair.includes(seedOf.get(String(p.playerId)))));
    if (m) return fromMatch(m);
    return { players: pair.map(s => bySeed.get(s)).map(p => p ? entrant(p.playerId, p.name) : null), winner: null, played: false };
  });
  out.push({ name: first.name, slots });
  for (let j = 1; j < rounds.length; j++) {
    const prev = out[j - 1].slots, cur = [];
    for (let i = 0; i < prev.length / 2; i++) {
      const a = prev[2 * i], b = prev[2 * i + 1];
      const ids = [a, b].flatMap(s => s.players.filter(Boolean).map(p => p.id));
      const m = rounds[j].matches.find(m => m.players.some(p => ids.includes(String(p.playerId))));
      cur.push(m ? fromMatch(m) : { players: [a.winner, b.winner].map(w => w ? { ...w, gameWins: null } : null), winner: null, played: false });
    }
    out.push({ name: rounds[j].name, slots: cur });
  }
  const champion = out[out.length - 1].slots[0].winner;
  const projected = !first.matches.length;
  const note = projected ? (swissDone ? 'Seeded from the final Swiss standings' : `Projected from the standings after ${swissName}`) : '';
  return { size, rounds: out, champion, projected, note };
}

// ---------- match results ----------
// One result per player per match: { me, opp, res: W/L/D/P, score }
function matchResult(m, id) {
  const me = m.players.find(p => String(p.playerId) === id), opp = m.players.find(p => String(p.playerId) !== id) || null;
  if (!opp) return { bye: true };
  const res = !m.hasResult ? 'P' : me.gameWins > opp.gameWins ? 'W' : me.gameWins < opp.gameWins ? 'L' : 'D';
  return { me, opp: { id: String(opp.playerId), name: opp.name }, res, score: m.hasResult ? `${me.gameWins}-${opp.gameWins}` : '' };
}

function historyOf(id) {
  return (state.view?.history || []).map(r => {
    const m = r.matches.find(m => m.players.some(p => String(p.playerId) === id));
    if (!m) return { round: r.name, none: true };
    return { round: r.name, table: m.table, ...matchResult(m, id) };
  });
}

// ---------- top 8 race ----------
// Points-only bounds, so every status is certain: "Locked" means no combination of results can push them out
// on points (ties still go to tiebreakers), "Out" means they can't reach the cut line even by winning out.
function computeRace() {
  const v = state.view; if (!v?.swiss) return null;
  const cut = v.bracket?.size || 8;
  const left = v.swissTotal - v.swissDone;
  const ps = withDecks(v.swiss.players).filter(p => p.rank && p.points != null);
  const active = ps.filter(p => !isDropped(p));
  const max = p => isDropped(p) ? p.points : p.points + 3 * left;
  const rows = ps.map(p => {
    let status;
    if (isDropped(p)) status = 'out';
    else if (left === 0) status = p.rank <= cut ? 'locked' : 'out';
    else {
      const couldCatch = active.filter(o => o !== p && max(o) >= p.points).length;
      const ahead = active.filter(o => o !== p && o.points > max(p)).length;
      status = couldCatch <= cut - 1 ? 'locked' : ahead >= cut ? 'out' : 'alive';
    }
    return { ...p, status, best: max(p) };
  });
  const sorted = [...active].sort((a, b) => a.rank - b.rank);
  const line = sorted[cut - 1]?.points ?? null;
  const counts = { locked: rows.filter(r => r.status === 'locked').length, alive: rows.filter(r => r.status === 'alive').length, out: rows.filter(r => r.status === 'out').length };
  return { rows, cut, left, line, counts, round: v.swiss.round, finished: left === 0 };
}

// ---------- deck vs deck matchups ----------
function computeMatchups({ playoffs = state.matchPlayoffs } = {}) {
  const v = state.view; if (!v) return null;
  const known = currentPlayers().filter(p => p.known);
  const groups = deckGroups(known, 'deck');
  const keyOf = new Map();
  for (const g of groups) for (const p of g.players) keyOf.set(p.id, g.key);
  const cell = new Map(), total = new Map(), mirrors = new Map();
  const bump = (map, k, r) => { const c = map.get(k) || { w: 0, l: 0, d: 0 }; c[r]++; map.set(k, c); };
  let counted = 0;
  for (const r of v.history) {
    if (!r.completed || (!playoffs && !r.swiss)) continue;
    for (const m of r.matches) {
      if (m.players.length !== 2 || !m.hasResult) continue;
      const [a, b] = m.players, ka = keyOf.get(String(a.playerId)), kb = keyOf.get(String(b.playerId));
      if (!ka || !kb) continue;
      counted++;
      if (ka === kb) { mirrors.set(ka, (mirrors.get(ka) || 0) + 1); continue; }
      const ra = a.gameWins > b.gameWins ? 'w' : a.gameWins < b.gameWins ? 'l' : 'd';
      const rb = ra === 'w' ? 'l' : ra === 'l' ? 'w' : 'd';
      bump(cell, ka + '|' + kb, ra); bump(cell, kb + '|' + ka, rb);
      bump(total, ka, ra); bump(total, kb, rb);
    }
  }
  return { groups, cell, total, mirrors, counted };
}

const winRate = c => c && (c.w + c.l + c.d) ? c.w / (c.w + c.l + c.d) : null;

// ---------- round recap ----------
function computeRecap() {
  const v = state.view; if (!v?.at) return null;
  const L = state.live;
  const round = v.history.find(h => h.id === v.at.id);
  const nowPs = withDecks(v.players);
  const prevRank = new Map((v.prev ? (L.standings.get(v.prev.id) || []) : []).map(p => [String(p.playerId), p.rank]));
  const byId = new Map(nowPs.map(p => [p.id, p]));
  // Undefeated after this round
  const undefeated = v.at.swiss ? nowPs.filter(p => !isDropped(p) && rec(p.record).l === 0 && rec(p.record).w > 0) : [];
  // Upsets: a winner ranked well below the player they beat going into the round
  const upsets = [];
  const deckRound = new Map();
  for (const m of round?.matches || []) {
    if (m.players.length !== 2 || !m.hasResult) continue;
    const [a, b] = m.players;
    if (a.gameWins === b.gameWins) continue;
    const [w, l] = a.gameWins > b.gameWins ? [a, b] : [b, a];
    const wid = String(w.playerId), lid = String(l.playerId);
    const wr = prevRank.get(wid), lr = prevRank.get(lid);
    if (wr && lr && lr <= 16 && wr - lr >= 3) upsets.push({ winner: byId.get(wid) || { id: wid, name: w.name }, loser: byId.get(lid) || { id: lid, name: l.name }, wr, lr, gap: wr - lr, score: `${w.gameWins}-${l.gameWins}` });
    for (const [pid, res] of [[wid, 'w'], [lid, 'l']]) {
      const d = deckOf(byId.get(pid) || { id: pid, name: '' });
      if (!d) continue;
      const c = deckRound.get(d.label) || { label: d.label, leader: d.leader, base: d.base, w: 0, l: 0 };
      c[res]++; deckRound.set(d.label, c);
    }
  }
  upsets.sort((x, y) => y.gap - x.gap);
  const decks = [...deckRound.values()].filter(c => c.w + c.l >= 2).sort((x, y) => (y.w / (y.w + y.l)) - (x.w / (x.w + x.l)) || y.w - x.w);
  const tables = (round?.matches || []).filter(m => m.players.length === 2 && m.hasResult).sort((x, y) => (x.table ?? 999) - (y.table ?? 999));
  return { round: v.at.name, swiss: v.at.swiss, undefeated, upsets: upsets.slice(0, 4), deckOfRound: decks[0] || null, decks, tables };
}

// ---------- team ----------
const teamTag = () => store(true, 'bdst-team') || 'BDST';
function isTeam(name, tag = teamTag()) { return !!tag && String(name).toLowerCase().includes(tag.toLowerCase()); }
function teamPlayers() {
  const tag = teamTag();
  return currentPlayers().filter(p => isTeam(p.name, tag)).sort((a, b) => (a.rank || 9999) - (b.rank || 9999));
}

// ---------- pairings ----------
// Matches for a round, sorted by table, with both players' current standing and deck.
function pairingsFor(roundId) {
  const v = state.view; if (!v) return null;
  const r = v.history.find(h => h.id === roundId); if (!r) return null;
  const standing = new Map(currentPlayers().map(p => [p.id, p]));
  const rows = [...r.matches].sort((a, b) => (a.table ?? 999) - (b.table ?? 999)).map(m => ({
    table: m.table, hasResult: m.hasResult,
    players: m.players.map(p => ({ id: String(p.playerId), name: p.name, gameWins: p.gameWins, standing: standing.get(String(p.playerId)) || null })),
  }));
  // The first four tables are the top of the room in Swiss; every playoff match is a feature match.
  const tables = rows.filter(x => x.players.length === 2).map(x => x.table).filter(t => t != null).sort((a, b) => a - b);
  const featureTables = new Set(r.swiss ? tables.slice(0, 4) : tables);
  for (const x of rows) x.feature = featureTables.has(x.table);
  return { round: r, rows };
}

// ---------- shared decklists ----------
const adminKey = () => store(true, 'bdst-admin');
const adminHeaders = () => ({ 'Content-Type': 'application/json', 'X-Admin-Key': adminKey() });

async function loadSharedDecks(tid) {
  try {
    const d = await relay('/decks/' + tid);
    const rows = d.rows.map(([id, name, leader, base, known, deckId]) => ({ id: String(id), name, leader, base, known: !!known, deckId: deckId || '' }));
    return { rows, updated: d.updated };
  } catch (e) { return null; }
}

async function shareDecks(tid, rows) {
  return relay('/decks/' + tid, { method: 'PUT', headers: adminHeaders(), body: JSON.stringify({ rows: rows.map(r => [r.id, r.name, r.leader, r.base, r.known ? 1 : 0, r.deckId || '']) }) });
}

async function checkAdmin(key) {
  return relay('/admin/check', { headers: { 'X-Admin-Key': key } });
}

// ---------- season archive ----------
async function loadArchiveIndex() { return (await relay('/archive')).events || []; }
const archiveCache = new Map();
async function loadArchived(id) {
  if (!archiveCache.has(id)) archiveCache.set(id, relay('/archive/' + id));
  return archiveCache.get(id);
}

// Always saves the event as it stands now, even while an earlier round is being replayed.
function archiveSnapshot() {
  const L = state.live, asOf = state.asOf;
  state.asOf = null;
  const v = computeView();
  state.asOf = asOf; computeView();
  const ps = withDecks(v.players);
  const br = v.bracket;
  const top = br ? br.rounds[0].slots.flatMap(s => s.players).filter(Boolean).map(p => p.id) : ps.slice(0, 8).map(p => p.id);
  return {
    id: Number(L.id), name: L.name, date: (L.date || new Date().toISOString()).slice(0, 10),
    players: ps.map(p => ({ id: p.id, name: p.name, rank: p.rank, record: p.record, points: p.points, leader: p.leader, base: p.base, known: p.known })),
    top8: top, champion: br?.champion?.id || null,
  };
}

async function saveArchive() {
  const snap = archiveSnapshot();
  archiveCache.delete(snap.id);
  return relay('/archive/' + snap.id, { method: 'PUT', headers: adminHeaders(), body: JSON.stringify(snap) });
}

async function deleteArchived(id) {
  archiveCache.delete(id);
  return relay('/archive/' + id, { method: 'DELETE', headers: adminHeaders() });
}
