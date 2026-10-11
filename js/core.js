// Core data: card lookup, parsing melee.gg exports, deck grouping and small helpers shared by every view.

const CARDS = window.SWU_CARDS || { leaders: {}, bases: {} };

const state = {
  rounds: new Map(),   // uploaded CSV, by round number
  tid: null,           // tournament ID of the uploaded CSV
  sample: false,
  gen: true,           // group common bases by colour
  liveId: null,        // tournament being followed
  live: null,          // raw data for it (rounds, standings, matches), see data.js
  view: null,          // what's on screen: latest or replayed round (computeView)
  asOf: null,          // round ID when replaying an earlier round
  decks: null,         // decklists for the followed event: { tid, source, byId, byName }
  tab: 'decks',
  chart: 'treemap', format: 'wide', kind: 'decks', feature: null,
  groupBy: 'deck', showWin: false, matchPlayoffs: false,
};

// melee.gg doesn't let other sites read its data from the browser, so live data comes through a small relay (see worker/).
const RELAY = location.hostname === 'localhost' ? 'http://localhost:8787'
  : /bdst-meta-staging\.pages\.dev$/.test(location.hostname) ? 'https://bdst-melee-relay-staging.bdst.workers.dev'
  : 'https://bdst-melee-relay.bdst.workers.dev';

function store(get, k, v) {
  try { if (get) return localStorage.getItem(k) || ''; localStorage.setItem(k, v); } catch (e) { return ''; }
}
const storeJSON = (k, fallback) => { try { return JSON.parse(store(true, k) || 'null') ?? fallback; } catch (e) { return fallback; } };

// ---------- card lookup ----------
const norm = s => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
function lev(a, b) {
  const d = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = d[0]; d[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const t = d[j];
      d[j] = Math.min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = t;
    }
  }
  return d[b.length];
}
const cardCache = new Map();
function card(kind, name) {
  const key = kind + '|' + name;
  if (cardCache.has(key)) return cardCache.get(key);
  const tbl = CARDS[kind] || {};
  let c = tbl[norm(name)] || null;
  if (!c && name !== 'Unknown') {
    // Fall back to the closest spelling, so typos in either data source still match.
    const target = norm(name);
    const head = kind === 'leaders' ? norm(name.split(', ')[0]) : null;
    let best = null, bestD = Infinity;
    for (const x of Object.values(tbl)) {
      if (head && norm(x.n.split(', ')[0]) !== head) continue;
      const dist = lev(norm(x.n), target);
      if (dist < bestD) { bestD = dist; best = x; }
    }
    if (best && bestD <= Math.max(3, target.length * 0.15)) c = best;
  }
  cardCache.set(key, c);
  return c;
}

// Common bases with the same ability are interchangeable within a colour.
// Plain commons are just their colour ("Red"); commons with a shared ability add it ("Red Force", "Red Splash").
const COLOR = { Vigilance: 'Blue', Command: 'Green', Aggression: 'Red', Cunning: 'Yellow' };
const ASPECTS = ['Vigilance', 'Command', 'Aggression', 'Cunning', 'Heroism', 'Villainy'];
const genericInfo = new Map();
function baseKey(p) {
  if (!state.gen) return p.base;
  const c = card('bases', p.base), asp = c?.a?.[0];
  if (!c?.g || !COLOR[asp]) return p.base;
  const key = /HP$/.test(c.g) ? COLOR[asp] : `${COLOR[asp]} ${c.g}`;
  if (!genericInfo.has(key)) genericInfo.set(key, { aspect: asp, fam: c.g, names: new Set() });
  genericInfo.get(key).names.add(p.base);
  return key;
}
// "Yoda Red Force" for colour groups, "Luke Skywalker · Data Vault" for named bases.
const deckName = (leader, bk) => genericInfo.has(bk) ? `${leader} ${bk}` : `${leader} · ${bk}`;
const deckAspects = p => [...new Set([...(card('leaders', p.leader)?.a || []), ...(card('bases', p.base)?.a || [])])];

// ---------- parsing ----------
function parseCSV(text) {
  const rows = []; let row = [], f = '', q = false;
  text = text.replace(/^﻿/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else f += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(f); f = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(f); rows.push(row); row = []; f = '';
    } else f += c;
  }
  if (f !== '' || row.length) { row.push(f); rows.push(row); }
  return rows.filter(r => r.some(v => String(v).trim() !== ''));
}

function tableToObjects(rows) {
  const head = rows[0].map(h => String(h).trim());
  return rows.slice(1).map(r => Object.fromEntries(head.map((h, i) => [h, r[i] == null ? '' : String(r[i]).trim()])));
}

function parseDeck(s) {
  s = (s || '').trim();
  if (!s || /^\[\[\[/.test(s) || s === '-') return { leader: 'Unknown', base: 'Unknown', known: false };
  const i = s.lastIndexOf(' - ');
  const leader = (i < 0 ? s : s.slice(0, i)).trim();
  const base = i < 0 ? 'Unknown' : s.slice(i + 3).trim();
  return { leader, base, known: true };
}

function splitLeader(full) {
  const i = full.indexOf(', ');
  return i < 0 ? { name: full, sub: '' } : { name: full.slice(0, i), sub: full.slice(i + 2) };
}

const pick = (o, ...keys) => { for (const k of keys) if (o[k] != null && o[k] !== '') return o[k]; return ''; };

function buildRound(objs) {
  if (!objs.length || !('Decklists1DecklistName' in objs[0]))
    throw new Error('This file does not look like a melee.gg standings export. It needs a Decklists1DecklistName column.');
  const all = objs.map(o => ({
    rank: parseInt(o.Rank, 10) || 9999,
    id: String(pick(o, 'TeamPlayers1ID', 'TeamId', 'TeamPlayers1DisplayName')),
    name: pick(o, 'TeamPlayers1DisplayName', 'TeamPlayers1Username', 'TeamName') || 'Player',
    record: o.MatchRecord || '', points: o.Points !== undefined && o.Points !== '' ? Number(o.Points) : null, status: o.TeamStatusDescription || '',
    deckId: o.Decklists1DecklistId || '',
    ...parseDeck(o.Decklists1DecklistName)
  })).sort((a, b) => a.rank - b.rank);
  // A player listed twice in one round is counted once.
  const seen = new Set();
  const ps = all.filter(p => !p.id || (!seen.has(p.id) && seen.add(p.id)));
  const nums = objs.map(o => parseInt(o.RoundNumber, 10)).filter(n => n > 0);
  ps.round = nums.length ? Math.max(...nums) : null;
  ps.tid = objs[0].TournamentId || null;
  return ps;
}

// "3-1-0" -> { w: 3, l: 1, d: 0 }
function rec(s) {
  const m = String(s || '').match(/(\d+)\s*-\s*(\d+)(?:\s*-\s*(\d+))?/);
  return m ? { w: +m[1], l: +m[2], d: +(m[3] || 0) } : { w: 0, l: 0, d: 0 };
}

// ---------- aggregation ----------
function group(ps, keyFn) {
  const map = new Map();
  for (const p of ps) {
    const k = keyFn(p);
    if (!map.has(k)) map.set(k, { key: k, players: [] });
    map.get(k).players.push(p);
  }
  return [...map.values()].map(g => ({ ...g, count: g.players.length }));
}

const finalRound = () => {
  const keys = [...state.rounds.keys()].sort((a, b) => a - b);
  return keys.length ? state.rounds.get(keys[keys.length - 1]) : [];
};

// Decklists for the followed event come from (in order) this browser's upload, the organiser's shared copy, or a saved copy.
function setDecks(tid, source, rows) {
  const byId = new Map(), byName = new Map();
  for (const r of rows) { byId.set(String(r.id), r); byName.set(String(r.name).toLowerCase(), r); }
  state.decks = { tid: String(tid), source, byId, byName, count: rows.length };
}
function deckIndex() {
  if (!state.live || !state.decks || state.decks.tid !== String(state.live.id)) return null;
  return state.decks;
}

// Decks sorted by player count, grouped by deck (leader + base), leader or base.
// Labels use the short leader name ("Han Solo") unless two rows would then read the same.
function deckGroups(known, by = state.groupBy) {
  genericInfo.clear();
  const keyOf = by === 'leader' ? (p => p.leader + '\u0000')
    : by === 'base' ? (p => '\u0000' + baseKey(p))
    : (p => p.leader + '\u0000' + baseKey(p));
  const groups = group(known, keyOf).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  const make = (g, full) => {
    if (by === 'leader') return full ? g.leader : splitLeader(g.leader).name;
    if (by === 'base') return g.base;
    return deckName(full ? g.leader : splitLeader(g.leader).name, g.base);
  };
  const seen = new Map();
  for (const g of groups) {
    [g.leader, g.base] = g.key.split('\u0000');
    if (by === 'base') g.leader = g.players[0].leader;   // for art only
    if (by === 'leader') g.base = baseKey(g.players[0]);
    g.label = make(g, false);
    seen.set(g.label, (seen.get(g.label) || 0) + 1);
  }
  for (const g of groups) if (seen.get(g.label) > 1) g.label = make(g, true);
  return groups;
}

// The deck a player is on, labelled like the deck breakdown ("Yoda Red Force"). Always by leader + base.
function deckOf(e) {
  if (!e) return null;
  let d = null;
  const idx = deckIndex();
  if (idx) d = idx.byId.get(String(e.id)) || idx.byName.get(String(e.name).toLowerCase());
  else if (!state.live) d = finalRound().find(p => p.id === String(e.id));
  if (!d || !d.known) return null;
  const base = baseKey(d);
  return { leader: d.leader, base, rawBase: d.base, label: deckName(splitLeader(d.leader).name, base), deckId: d.deckId || '' };
}
const entrantDeck = deckOf;

// ---------- rendering helpers ----------
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pct = x => Math.round(x * 100) + '%';
const pips = as => as.length ? `<span class="pips">${as.map(a => `<i class="pip a-${a.toLowerCase()}" title="${a}"></i>`).join('')}</span>` : '';
const initials = s => s.split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase();
function leaderImg(name, cls = 'thumb') {
  const c = card('leaders', name);
  return c && c.i ? `<img class="${cls}" src="${c.i}" alt="" loading="lazy">` : `<span class="${cls}" aria-hidden="true">${esc(initials(splitLeader(name || '?').name))}</span>`;
}
function baseImg(name) {
  const gi = genericInfo.get(name);
  if (gi) return `<span class="bthumb gen a-${gi.aspect.toLowerCase()}" title="${esc([...gi.names].join(', '))}">${esc(gi.fam)}</span>`;
  const c = card('bases', name);
  return c && c.i ? `<img class="bthumb" src="${c.i}" alt="" loading="lazy">` : `<span class="bthumb" aria-hidden="true"></span>`;
}
const deckArt = d => d ? `<span class="pair">${leaderImg(d.leader)}${baseImg(d.base)}</span>` : '<span class="pair"><span class="thumb" aria-hidden="true"></span></span>';
const isDropped = p => /drop/i.test(p?.status || '');
