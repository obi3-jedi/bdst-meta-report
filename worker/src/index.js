// BDST melee.gg relay.
//
// melee.gg doesn't let other websites read its data from the browser (no CORS), so the meta report
// asks this worker instead. It answers only two questions, for numeric IDs, so it can't be used as
// a general-purpose proxy:
//   GET /tournament/:id  -> { id, name, rounds: [{ id, name, started, completed }] }
//   GET /standings/:roundId -> { roundId, players: [{ rank, playerId, name, username, record, points, status }] }
//   GET /matches/:roundId -> { roundId, matches: [{ table, hasResult, result, players: [{ playerId, name, gameWins }] }] }

const MELEE = 'https://melee.gg';
const ALLOWED_ORIGINS = [
  'https://obi3-jedi.github.io',
  'http://localhost:8766',
];
const BROWSER_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36',
  'Accept-Language': 'en-AU,en;q=0.9',
};

function cors(origin) {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
  };
}

function json(body, status, origin, maxAge = 30) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': `public, max-age=${maxAge}`, ...cors(origin) },
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
  return { id: Number(id), name, rounds: [...rounds.values()] };
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

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors(origin) });
    if (request.method !== 'GET') return json({ error: 'Only GET is supported.' }, 405, origin);

    const path = new URL(request.url).pathname;
    try {
      let m;
      if ((m = path.match(/^\/tournament\/(\d{1,9})$/))) return json(await tournament(m[1]), 200, origin);
      if ((m = path.match(/^\/standings\/(\d{1,9})$/))) return json(await standings(m[1]), 200, origin);
      if ((m = path.match(/^\/matches\/(\d{1,9})$/))) return json(await matches(m[1]), 200, origin);
      return json({ error: 'Not found. Use /tournament/<id>, /standings/<roundId> or /matches/<roundId>.' }, 404, origin, 3600);
    } catch (e) {
      return json({ error: e.message || 'Could not reach melee.gg.' }, 502, origin, 0);
    }
  },
};
