// BDST melee.gg relay.
//
// melee.gg doesn't let other websites read its data from the browser (no CORS), so the meta report
// asks this worker instead. Reads from melee.gg are limited to numeric IDs, so it can't be used as
// a general-purpose proxy:
//   GET /tournament/:id      -> { id, name, date, rounds: [{ id, name, started, completed }] }
//   GET /standings/:roundId  -> { roundId, players: [{ rank, playerId, name, username, record, points, status }] }
//   GET /matches/:roundId    -> { roundId, matches: [{ table, hasResult, result, players: [{ playerId, name, gameWins }] }] }
//
// It also keeps a little shared data in Workers KV (binding DATA), so an organiser can share decklists
// and archive finished events for everyone. Writes need the organiser passcode (secret ADMIN_KEY):
//   GET /decks/:tid          -> { tid, updated, rows: [[playerId, name, leader, base, known, decklistId]] }
//   PUT /decks/:tid          (organiser) same shape
//   GET /archive             -> { events: [{ id, name, date, players }] }
//   GET /archive/:tid        -> the saved event
//   PUT /archive/:tid        (organiser) { id, name, date, players: [...], top8: [...], champion }
//   DELETE /archive/:tid     (organiser)
//   GET /admin/check         (organiser) -> { ok: true } when the passcode is right
//   GET /hri/teams           -> { teams: [{ slug, name, abbreviation, members, rating, logo }] } from hri.gg (cached 1 h)
//   GET /hri/teams/:slug     -> { slug, name, abbreviation, logo, links, roster: [{ username, displayName, rating, tier, membership }] } (cached 15 min)
//   GET /feature/:tid        -> { tid, table, player, show, scene, updated } what's on stream
//   GET /feature/:tid/live   (WebSocket) the same value, pushed whenever it changes
//   PUT /feature/:tid        (organiser) { table } or { player }, optionally { round } to pin a past round;
//                            or { match, swap, wins } to swap sides / set game wins for the match on stream;
//                            or { scene: { mode: camera|feature|break|slide|hold, slide?, title?, until? } } for the program link;
//                            or { asOf: <roundId> | null } to show everything as it was after an earlier round
//                            (or {} to go back to the overlay link's table)
//
// The feature match choice lives in a Durable Object (binding FEATURE) so a change shows on stream within seconds;
// Workers KV can take up to a minute to update everywhere.

import { platform, roleForMelee, HttpError, logo } from './platform.js';

const MELEE = 'https://melee.gg';
const ALLOWED_ORIGINS = [
  'https://obi3-jedi.github.io',
  'https://bdst-meta-staging.pages.dev',
  'https://bdst-stream-dev.pages.dev',
  'http://localhost:8766',
];
// Cloudflare Pages preview deployments live on <hash>.bdst-meta-staging.pages.dev
const allowed = origin => ALLOWED_ORIGINS.includes(origin) || /^https:\/\/[a-z0-9-]+\.(bdst-meta-staging|bdst-stream-dev)\.pages\.dev$/.test(origin);
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  'Accept-Language': 'en-AU,en;q=0.9',
};
const MAX_BODY = 1_000_000;

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': allowed(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Key, Authorization',
    'Vary': 'Origin',
  };
}

function json(body, status, origin, maxAge = 30) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': maxAge ? `public, max-age=${maxAge}` : 'no-store', ...cors(origin) },
  });
}

const decode = s => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>');

async function tournament(id) {
  const res = await fetch(`${MELEE}/Tournament/View/${id}`, { headers: { ...BROWSER_HEADERS, Accept: 'text/html' } });
  if (!res.ok) throw new Error(`melee.gg returned ${res.status} for the tournament page`);
  const html = await res.text();
  const title = html.match(/<title>([^<]*)<\/title>/i);
  const name = title ? decode(title[1]).replace(/\s*\|\s*Melee\s*$/i, '').trim() : `Tournament ${id}`;

  // The page lists every round twice: once with data-is-started (pairings), once with data-is-completed (standings).
  const rounds = new Map();
  const re = /data-id="(\d+)"\s+data-name="([^"]+)"\s+data-is-(started|completed)="(True|False)"/g;
  for (const m of html.matchAll(re)) {
    const r = rounds.get(m[1]) || { id: Number(m[1]), name: decode(m[2]), started: false, completed: false };
    r[m[3]] = m[4] === 'True';
    rounds.set(m[1], r);
  }
  // The first datetime on the page is the event's start
  const start = html.match(/data-toggle="datetime"\s+data-value="(\d{4}-\d{2}-\d{2}T[^"]*)"/);
  return { id: Number(id), name, date: start ? start[1] : null, rounds: [...rounds.values()] };
}

async function standings(roundId) {
  const body = new URLSearchParams({
    draw: '1', start: '0', length: '2000', roundId: String(roundId),
    'order[0][column]': '0', 'order[0][dir]': 'asc', 'columns[0][data]': 'Rank',
  });
  const res = await fetch(`${MELEE}/Standing/GetRoundStandings`, {
    method: 'POST',
    headers: { ...BROWSER_HEADERS, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`melee.gg returned ${res.status} for the standings`);
  const data = await res.json();
  const players = (data.data || []).map(s => {
    const p = s.Team?.Players?.[0] || {};
    return {
      rank: s.Rank,
      playerId: p.ID ?? null,
      name: p.DisplayName || p.Username || 'Player',
      username: p.Username || '',
      record: s.MatchRecord || '',
      points: s.Points ?? null,
      status: s.Team?.StatusDescription || '',
    };
  });
  return { roundId: Number(roundId), players };
}

async function matches(roundId) {
  const body = new URLSearchParams({
    draw: '1', start: '0', length: '500',
    'columns[0][data]': 'TableNumber', 'columns[0][name]': 'TableNumber', 'columns[0][searchable]': 'true',
    'columns[0][orderable]': 'true', 'columns[0][search][value]': '', 'columns[0][search][regex]': 'false',
    'order[0][column]': '0', 'order[0][dir]': 'asc', 'search[value]': '', 'search[regex]': 'false',
  });
  const res = await fetch(`${MELEE}/Match/GetRoundMatches/${roundId}`, {
    method: 'POST',
    headers: { ...BROWSER_HEADERS, Accept: 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`melee.gg returned ${res.status} for the matches`);
  const data = await res.json();
  if (!Array.isArray(data.data)) throw new Error(data.Message || 'melee.gg did not return any matches');
  return {
    roundId: Number(roundId),
    matches: data.data.map(m => ({
      table: m.TableNumber,
      hasResult: !!m.HasResult,
      result: m.ResultString || '',
      players: (m.Competitors || []).map(c => {
        const p = c.Team?.Players?.[0] || {};
        return { playerId: p.ID ?? null, name: p.DisplayName || p.Username || 'Player', gameWins: c.GameWins ?? 0 };
      }),
    })),
  };
}

// ---------- shared storage ----------
function isAdmin(request, env) {
  const given = request.headers.get('X-Admin-Key') || '';
  const want = env.ADMIN_KEY || '';
  if (!want || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

// Who may change an event's shared data: the organiser passcode, or a signed-in member of a tournament that
// links this melee.gg event ('stream' = its stream team; 'owner' = whoever created it).
async function allowedFor(request, env, meleeId, level) {
  if (isAdmin(request, env)) return true;
  const role = await roleForMelee(request, env, meleeId);
  return level === 'stream' ? !!role : role === 'owner';
}
const DENIED = 'You don’t have access to change this event. Sign in, or unlock Organiser tools with the passcode.';

async function readBody(request) {
  const text = await request.text();
  if (text.length > MAX_BODY) throw Object.assign(new Error('That is too much data to save.'), { status: 413 });
  try { return JSON.parse(text); } catch (e) { throw Object.assign(new Error('The data sent was not valid JSON.'), { status: 400 }); }
}

async function storage(request, env, path, origin) {
  if (!env.DATA) return json({ error: 'Shared storage is not set up on this relay.' }, 501, origin, 0);
  const method = request.method;
  let m;

  if (path === '/admin/check') {
    return isAdmin(request, env) ? json({ ok: true }, 200, origin, 0) : json({ error: 'That organiser passcode is not right.' }, 401, origin, 0);
  }

  if ((m = path.match(/^\/decks\/(\d{1,9})$/))) {
    const key = `decks:${m[1]}`;
    if (method === 'GET') {
      const v = await env.DATA.get(key, 'json');
      return v ? json(v, 200, origin, 15) : json({ error: 'No shared decklists for this event yet.' }, 404, origin, 15);
    }
    if (method === 'PUT') {
      if (!(await allowedFor(request, env, m[1], 'owner'))) return json({ error: DENIED }, 401, origin, 0);
      const body = await readBody(request);
      if (!Array.isArray(body.rows)) return json({ error: 'Expected a list of decklists.' }, 400, origin, 0);
      const value = { tid: Number(m[1]), updated: new Date().toISOString(), rows: body.rows.slice(0, 5000) };
      await env.DATA.put(key, JSON.stringify(value));
      return json(value, 200, origin, 0);
    }
  }

  if (path === '/archive' && method === 'GET') {
    const index = (await env.DATA.get('archive:index', 'json')) || [];
    return json({ events: index }, 200, origin, 15);
  }

  if ((m = path.match(/^\/archive\/(\d{1,9})$/))) {
    const key = `archive:${m[1]}`;
    if (method === 'GET') {
      const v = await env.DATA.get(key, 'json');
      return v ? json(v, 200, origin, 60) : json({ error: 'That event is not in the archive.' }, 404, origin, 15);
    }
    if (!(await allowedFor(request, env, m[1], 'owner'))) return json({ error: DENIED }, 401, origin, 0);
    let index = (await env.DATA.get('archive:index', 'json')) || [];
    index = index.filter(e => String(e.id) !== m[1]);
    if (method === 'PUT') {
      const body = await readBody(request);
      if (!Array.isArray(body.players)) return json({ error: 'Expected the event’s players.' }, 400, origin, 0);
      const value = { ...body, id: Number(m[1]), saved: new Date().toISOString() };
      await env.DATA.put(key, JSON.stringify(value));
      index.push({ id: value.id, name: String(value.name || `Tournament ${m[1]}`), date: value.date || value.saved, players: value.players.length });
      index.sort((a, b) => String(a.date).localeCompare(String(b.date)));
      await env.DATA.put('archive:index', JSON.stringify(index));
      return json({ ok: true, events: index }, 200, origin, 0);
    }
    if (method === 'DELETE') {
      await env.DATA.delete(key);
      await env.DATA.put('archive:index', JSON.stringify(index));
      return json({ ok: true, events: index }, 200, origin, 0);
    }
  }
  return null;
}

// ---------- hri.gg (Holocron Rating Index) teams ----------
// hri.gg's public API doesn't allow browser requests from other sites and allows 30 requests a minute,
// so the relay fetches it and caches the answers at the edge.
const HRI = 'https://hri.gg/api/v1';
async function hriCached(url, ttl) {
  const cache = caches.default, key = new Request(url);
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const res = await fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'BDST-Meta-Report (bdst-melee-relay)' } });
  if (res.status === 404) throw Object.assign(new Error('That team isn’t on hri.gg.'), { status: 404 });
  if (!res.ok) throw new Error(`hri.gg answered with an error (${res.status}).`);
  const body = await res.json();
  await cache.put(key, new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${ttl}` } }));
  return body;
}
async function hriTeams() {
  const teams = [];
  for (let page = 1; page <= 5; page++) {
    const body = await hriCached(`${HRI}/teams?per_page=100&page=${page}`, 3600);
    for (const t of body.data || []) {
      const a = t.attributes || {};
      teams.push({ slug: a.slug, name: a.name, abbreviation: a.abbreviation, members: a.member_count, rating: a.avg_overall_rating, logo: a.logo_url_thumbnail });
    }
    if (teams.length >= (body.meta?.total_count || 0)) break;
  }
  return { teams };
}
async function hriTeam(slug) {
  const body = await hriCached(`${HRI}/teams/${encodeURIComponent(slug)}`, 900);
  const a = body.data?.attributes || {};
  return {
    slug: a.slug, name: a.name, abbreviation: a.abbreviation, logo: a.logo_url_display || a.logo_url_thumbnail,
    links: (a.links || []).map(l => ({ kind: l.kind, label: l.label, url: l.url })),
    roster: (a.current_roster || []).map(m => ({ username: m.melee_id || m.slug, displayName: m.melee_username, slug: m.slug, rating: m.rating, tier: m.current_tier, membership: m.membership_tier })),
  };
}

// One tiny Durable Object per tournament holding what's on stream: the feature match choice, on-stream tweaks
// (swap sides, game wins) and the program scene. Overlays and control pages keep a WebSocket open to it
// (GET /feature/:tid/live) and get the whole value pushed the moment it changes.
export class FeatureMatch {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    if (request.headers.get('Upgrade') === 'websocket') {
      const [client, server] = Object.values(new WebSocketPair());
      this.ctx.acceptWebSocket(server);
      server.send(JSON.stringify((await this.ctx.storage.get('feature')) || {}));
      return new Response(null, { status: 101, webSocket: client });
    }
    if (request.method === 'PUT') {
      const value = await request.json();
      await this.ctx.storage.put('feature', value);
      const msg = JSON.stringify(value);
      for (const ws of this.ctx.getWebSockets()) { try { ws.send(msg); } catch (e) {} }
      return Response.json(value);
    }
    return Response.json((await this.ctx.storage.get('feature')) || {});
  }
  webSocketMessage(ws, msg) { if (msg === 'ping') ws.send('pong'); }
  webSocketClose(ws, code) { try { ws.close(code, 'bye'); } catch (e) {} }
  webSocketError(ws) { try { ws.close(1011, 'error'); } catch (e) {} }
}

// Program scenes for the single OBS link (?overlay=program): what the one Browser Source shows
const SCENE_MODES = ['camera', 'feature', 'break', 'slide', 'hold'];
const SCENE_SLIDES = ['upnext', 'standings', 'decks', 'race', 'bracket', 'recap', 'aspects'];
function cleanScene(sc) {
  if (!sc || typeof sc !== 'object' || !SCENE_MODES.includes(sc.mode)) throw Object.assign(new Error('That scene is not valid.'), { status: 400 });
  const out = { mode: sc.mode, at: new Date().toISOString() };
  if (sc.mode === 'slide') {
    if (!SCENE_SLIDES.includes(sc.slide)) throw Object.assign(new Error('That slide is not valid.'), { status: 400 });
    out.slide = sc.slide;
  }
  if (sc.mode === 'hold') {
    out.title = String(sc.title || 'Back soon').slice(0, 40);
    const until = Number(sc.until);
    if (until && until > Date.now() && until < Date.now() + 6 * 3600_000) out.until = until;
  }
  return out;
}

async function feature(request, env, tid, origin) {
  if (!env.FEATURE) return json({ error: 'The feature match picker is not set up on this relay.' }, 501, origin, 0);
  const stub = env.FEATURE.get(env.FEATURE.idFromName(String(tid)));
  if (request.method === 'GET') return json({ tid: Number(tid), ...(await (await stub.fetch('https://do/feature')).json()) }, 200, origin, 0);
  if (request.method === 'PUT') {
    if (!(await allowedFor(request, env, tid, 'stream'))) return json({ error: DENIED }, 401, origin, 0);
    const body = await readBody(request);
    const cur = await (await stub.fetch('https://do/feature')).json();
    const save = async value => json({ tid: Number(tid), ...(await (await stub.fetch('https://do/feature', { method: 'PUT', body: JSON.stringify({ ...value, updated: new Date().toISOString() }) })).json()) }, 200, origin, 0);
    // Replay: show the whole stream as it was after an earlier round ({ asOf: <roundId> }), or live again ({ asOf: null })
    if ('asOf' in body && body.table == null && body.player == null && body.match == null && !body.scene) {
      if (body.asOf !== null && !/^\d{1,12}$/.test(String(body.asOf))) return json({ error: 'That round is not valid.' }, 400, origin, 0);
      const { round, asOf, ...rest } = cur;
      return save(body.asOf === null ? rest : { ...rest, asOf: Number(body.asOf) });
    }
    // Round clock on the feature match: { clock: { mins } } starts it, { clock: { add: ±mins } } adjusts it, { clock: null } clears it
    if ('clock' in body && body.table == null && body.player == null && body.match == null && !body.scene) {
      const { clock, ...rest } = cur;
      if (body.clock === null) return save(rest);
      const mins = Number(body.clock?.mins), add = Number(body.clock?.add);
      let endsAt;
      if (mins > 0 && mins <= 240) endsAt = Date.now() + mins * 60000;
      else if (add && Math.abs(add) <= 60 && clock?.endsAt) endsAt = clock.endsAt + add * 60000;
      else return json({ error: 'That round clock is not valid.' }, 400, origin, 0);
      return save({ ...rest, clock: { endsAt: Math.min(endsAt, Date.now() + 240 * 60000) } });
    }
    // Switch the program scene: { scene: { mode, slide?, title?, until? } }
    if (body.scene && body.table == null && body.player == null && body.match == null) return save({ ...cur, scene: cleanScene(body.scene) });
    // On-stream tweaks for the match showing now: { match: "<roundId>|<table>", swap, wins: { <playerId>: n } }.
    // They're kept with the choice and only apply while that match is on screen.
    if (body.match != null && body.table == null && body.player == null) {
      if (!/^\d{1,12}\|\d{1,4}$/.test(String(body.match))) return json({ error: 'That match is not valid.' }, 400, origin, 0);
      const prev = cur.show?.match === String(body.match) ? cur.show : { match: String(body.match), swap: false, wins: {} };
      const show = { ...prev, wins: { ...prev.wins } };
      if (typeof body.swap === 'boolean') show.swap = body.swap;
      if (body.wins && typeof body.wins === 'object') {
        for (const [k, n] of Object.entries(body.wins).slice(0, 4)) {
          if (/^\d{1,12}$/.test(k) && Number.isInteger(n) && n >= 0 && n <= 3) show.wins[k] = n;
        }
      }
      return save({ ...cur, show });
    }
    // A new feature match choice (the scene carries over)
    const value = { ...(cur.scene ? { scene: cur.scene } : {}), ...(cur.asOf ? { asOf: cur.asOf } : {}), ...(cur.clock ? { clock: cur.clock } : {}) };
    if (body.table != null && /^\d{1,4}$/.test(String(body.table))) value.table = Number(body.table);
    else if (body.player != null && /^\d{1,12}$/.test(String(body.player))) value.player = String(body.player);
    // A choice made while replaying an earlier round pins the overlay to that round
    if ((value.table != null || value.player) && body.round != null && /^\d{1,12}$/.test(String(body.round))) value.round = Number(body.round);
    return save(value);
  }
  return json({ error: 'Use GET or PUT.' }, 405, origin, 0);
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    const path = new URL(request.url).pathname;
    try {
      const lg = path.match(/^\/logo\/([a-z2-9]{10})\/(creator|store)$/);
      if (lg && request.method === 'GET') return await logo(env, lg[1], lg[2]);
      const p = await platform(request, env, path, { readBody, allowed, meleeLookup: tournament });
      if (p instanceof Response) return p;
      if (p) return json(p.body, p.status || 200, origin, 0);
      if (path === '/hri/teams') return json(await hriTeams(), 200, origin, 600);
      const ht = path.match(/^\/hri\/teams\/([a-z0-9-]{1,40})$/i);
      if (ht) return json(await hriTeam(ht[1].toLowerCase()), 200, origin, 300);
      // Live updates for overlays and control pages (WebSocket)
      const lv = path.match(/^\/feature\/(\d{1,9})\/live$/);
      if (lv) {
        if (request.headers.get('Upgrade') !== 'websocket') return json({ error: 'Connect with a WebSocket.' }, 426, origin, 0);
        if (origin && !allowed(origin)) return new Response('Not allowed', { status: 403 });
        if (!env.FEATURE) return new Response('Not set up', { status: 501 });
        return env.FEATURE.get(env.FEATURE.idFromName(lv[1])).fetch(request);
      }
      const fm = path.match(/^\/feature\/(\d{1,9})$/);
      if (fm) return await feature(request, env, fm[1], origin);
      if (/^\/(decks|archive|admin)(\/|$)/.test(path)) {
        const res = await storage(request, env, path, origin);
        if (res) return res;
        return json({ error: 'Not found.' }, 404, origin, 0);
      }
      if (request.method !== 'GET') return json({ error: 'Only GET is supported here.' }, 405, origin, 0);
      let m;
      if ((m = path.match(/^\/tournament\/(\d{1,9})$/))) return json(await tournament(m[1]), 200, origin);
      if ((m = path.match(/^\/standings\/(\d{1,9})$/))) return json(await standings(m[1]), 200, origin);
      if ((m = path.match(/^\/matches\/(\d{1,9})$/))) return json(await matches(m[1]), 200, origin);
      return json({ error: 'Not found. Use /tournament/<id>, /standings/<roundId> or /matches/<roundId>.' }, 404, origin, 3600);
    } catch (e) {
      return json({ error: e.message || 'Could not reach melee.gg.' }, e.status || 502, origin, 0);
    }
  },
};
