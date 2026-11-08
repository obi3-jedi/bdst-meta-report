// Accounts, tournaments and stream team invites (binding DB: a D1 database, schema in worker/schema.sql).
//
// Sign in with Discord:
//   GET  /auth/discord/start?return=<page url>   -> redirects to Discord
//   GET  /auth/discord/callback                   -> back to <page url>#login=<one-time code>
//   POST /auth/exchange { code }                  -> { token, user }   (the page keeps the token; send it as Authorization: Bearer)
//   POST /auth/logout
//   GET  /me                                      -> { user, tournaments: [{ ...tournament, role }] }
//
// Tournaments (each one links a melee.gg event):
//   POST   /t                     { melee, name?, date?, venue?, bestOf?, topCut? } -> tournament (you're its owner)
//   GET    /t/:id                 -> tournament (+ settings, team and overlay key for its team)
//   PATCH  /t/:id                 (owner) any of name, date, venue, bestOf, topCut, melee, settings (the stream team: settings only)
//   DELETE /t/:id                 (owner)
//   DELETE /t/:id/team/:userId    (owner removes someone, or anyone removes themselves)
//   POST   /t/:id/overlay-key     (owner) a new overlay key; old OBS links stop working
//   GET    /t/:id/invites         (owner) -> { invites }
//   POST   /t/:id/invites         (owner) -> invite (a link valid for 7 days)
//   DELETE /t/:id/invites/:code   (owner)
//   GET    /invite/:code          -> { tournament: { name, date, venue }, invitedBy, expires, valid }
//   POST   /invite/:code/accept   (signed in) -> joins the stream team
//   GET    /overlay/:key          -> { meleeId, name, settings } for an OBS overlay (the key is the secret)
//   PUT    /t/:id/logos/:slot     (team) raw PNG/JPG/WebP/GIF, slot creator|store; DELETE removes it
//   GET    /logo/:id/:slot        -> the image (public, cached; add ?v=<settings.logos[slot]>)

const DAY = 86400_000;
const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
const LOGO_MAX = 2 * 1024 * 1024;

// A tournament's logo image (public: the overlay shows it). Cached for a long time; the URL carries ?v=<version>.
export async function logo(env, id, slot) {
  if (!env.DATA) return new Response('Not set up', { status: 501 });
  const { value, metadata } = await env.DATA.getWithMetadata(`logo:${id}:${slot}`, 'arrayBuffer');
  if (!value) return new Response('No logo', { status: 404, headers: { 'Access-Control-Allow-Origin': '*' } });
  return new Response(value, { headers: {
    'Content-Type': LOGO_TYPES.includes(metadata?.type) ? metadata.type : 'application/octet-stream',
    'Cache-Control': 'public, max-age=604800, immutable', 'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'",
  } });
}
const SESSION_DAYS = 30;
const INVITE_DAYS = 7;
const INVITE_MAX_USES = 25;

export class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }

const rand = (bytes = 24) => {
  const b = crypto.getRandomValues(new Uint8Array(bytes));
  return [...b].map(x => x.toString(16).padStart(2, '0')).join('');
};
// Short, readable ids: no 0/o/1/l
const ALPHA = 'abcdefghijkmnpqrstuvwxyz23456789';
const shortId = (n = 10) => [...crypto.getRandomValues(new Uint8Array(n))].map(x => ALPHA[x % ALPHA.length]).join('');
async function sha256(s) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, '0')).join('');
}
const now = () => Date.now();
const iso = t => new Date(t).toISOString();

function need(env) { if (!env.DB) throw new HttpError(501, 'Accounts are not set up on this relay.'); }

// ---------- sessions ----------
export async function currentUser(request, env) {
  if (!env.DB) return null;
  const m = (request.headers.get('Authorization') || '').match(/^Bearer ([a-f0-9]{48})$/);
  if (!m) return null;
  const row = await env.DB.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires > ?`
  ).bind(await sha256(m[1]), now()).first();
  return row ? publicUser(row) : null;
}
async function requireUser(request, env) {
  const u = await currentUser(request, env);
  if (!u) throw new HttpError(401, 'Please sign in again.');
  return u;
}
const avatarUrl = u => u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.png?size=96` : null;
const publicUser = u => ({ id: u.id, username: u.username, name: u.name || u.username, avatar: avatarUrl(u) });

// The role a signed-in user has for a melee.gg event, through any tournament they're part of that links it:
// 'owner', 'stream' or null. Used to allow the feature match, decklist and archive endpoints.
export async function roleForMelee(request, env, meleeId) {
  const u = await currentUser(request, env);
  if (!u) return null;
  const rows = await env.DB.prepare(
    `SELECT m.role FROM members m JOIN tournaments t ON t.id = m.tournament_id WHERE m.user_id = ? AND t.melee_id = ?`
  ).bind(u.id, Number(meleeId)).all();
  const roles = rows.results.map(r => r.role);
  return roles.includes('owner') ? 'owner' : roles.length ? 'stream' : null;
}

// ---------- Discord ----------
function redirectUri(request) { return new URL('/auth/discord/callback', request.url).toString(); }

async function discordStart(request, env, allowed) {
  if (!env.DISCORD_CLIENT_ID) throw new HttpError(501, 'Discord sign-in is not set up on this relay.');
  const ret = new URL(request.url).searchParams.get('return') || '';
  let back;
  try { back = new URL(ret); } catch (e) { throw new HttpError(400, 'Missing the page to come back to.'); }
  if (!allowed(back.origin)) throw new HttpError(400, 'That page is not allowed to sign in here.');
  const state = rand(16);
  await env.DB.prepare(`INSERT INTO pending (key, kind, value, expires) VALUES (?, 'state', ?, ?)`)
    .bind(state, back.toString(), now() + 10 * 60_000).run();
  const q = new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, redirect_uri: redirectUri(request), response_type: 'code', scope: 'identify', state, prompt: 'none' });
  return Response.redirect('https://discord.com/oauth2/authorize?' + q, 302);
}

async function discordCallback(request, env) {
  const url = new URL(request.url);
  const state = url.searchParams.get('state') || '';
  const row = await env.DB.prepare(`SELECT value FROM pending WHERE key = ? AND kind = 'state' AND expires > ?`).bind(state, now()).first();
  if (!row) return new Response('This sign-in link has expired. Go back and press Sign in with Discord again.', { status: 400 });
  await env.DB.prepare(`DELETE FROM pending WHERE key = ?`).bind(state).run();
  const back = new URL(row.value);
  const fail = msg => { back.hash = 'login-error=' + encodeURIComponent(msg); return Response.redirect(back.toString(), 302); };
  const code = url.searchParams.get('code');
  if (!code) return fail(url.searchParams.get('error') === 'access_denied' ? 'Sign-in was cancelled.' : 'Discord didn’t sign you in.');
  if (!env.DISCORD_CLIENT_SECRET) return fail('Discord sign-in is not finished setting up (no client secret).');

  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.DISCORD_CLIENT_ID, client_secret: env.DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code, redirect_uri: redirectUri(request) }),
  });
  if (!tokenRes.ok) return fail('Discord didn’t accept the sign-in. Please try again.');
  const { access_token } = await tokenRes.json();
  const meRes = await fetch('https://discord.com/api/users/@me', { headers: { Authorization: `Bearer ${access_token}` } });
  if (!meRes.ok) return fail('Couldn’t read your Discord profile. Please try again.');
  const d = await meRes.json();

  await env.DB.prepare(
    `INSERT INTO users (id, username, name, avatar, created, seen) VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET username = excluded.username, name = excluded.name, avatar = excluded.avatar, seen = excluded.seen`
  ).bind(String(d.id), d.username, d.global_name || d.username, d.avatar || null, now(), now()).run();

  // The page swaps this one-time code for a session token, so the token never sits in a URL
  const token = rand(24), once = rand(16);
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO sessions (token_hash, user_id, created, expires) VALUES (?, ?, ?, ?)`).bind(await sha256(token), String(d.id), now(), now() + SESSION_DAYS * DAY),
    env.DB.prepare(`INSERT INTO pending (key, kind, value, expires) VALUES (?, 'login', ?, ?)`).bind(once, token, now() + 2 * 60_000),
    env.DB.prepare(`DELETE FROM pending WHERE expires < ?`).bind(now()),
    env.DB.prepare(`DELETE FROM sessions WHERE expires < ?`).bind(now()),
  ]);
  back.hash = 'login=' + once;
  return Response.redirect(back.toString(), 302);
}

async function exchange(body, env) {
  const code = String(body.code || '');
  const row = await env.DB.prepare(`SELECT value FROM pending WHERE key = ? AND kind = 'login' AND expires > ?`).bind(code, now()).first();
  if (!row) throw new HttpError(400, 'That sign-in has expired. Please sign in again.');
  await env.DB.prepare(`DELETE FROM pending WHERE key = ?`).bind(code).run();
  const user = await env.DB.prepare(`SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?`).bind(await sha256(row.value)).first();
  return { token: row.value, user: publicUser(user) };
}

// ---------- tournaments ----------
const SETTING_KEYS = { take30: 'string', take30Swap: 'boolean', take30Colors: 'boolean', mat: 'number', pos: 'string', breakSlides: 'object', breakSeconds: 'number', layout: 'string', cams: 'boolean', roundMins: 'number' };
const BREAK_SLIDES = ['upnext', 'standings', 'decks', 'race', 'bracket', 'recap', 'aspects'];
function cleanSettings(s, prev = {}) {
  const out = { ...prev };
  if (!s || typeof s !== 'object') return out;
  for (const [k, type] of Object.entries(SETTING_KEYS)) {
    if (!(k in s)) continue;
    const v = s[k];
    if (v === null || v === '') { delete out[k]; continue; }
    if (typeof v !== type) throw new HttpError(400, `The ${k} setting is not valid.`);
    if (k === 'take30' && (v.length > 400 || !/^https:\/\/[a-z0-9-]+(\.[a-z0-9-]+)*\.(firebaseio\.com|firebasedatabase\.app)\//i.test(v))) throw new HttpError(400, 'That doesn’t look like a Take 30 link.');
    if (k === 'mat' && !(v >= 600 && v <= 1500)) throw new HttpError(400, 'Mat size should be between 600 and 1500 pixels.');
    if (k === 'pos' && !['top', 'bottom'].includes(v)) throw new HttpError(400, 'Banner position should be top or bottom.');
    if (k === 'roundMins' && !(Number.isInteger(v) && v >= 10 && v <= 240)) throw new HttpError(400, 'Round length should be between 10 and 240 minutes.');
    if (k === 'layout' && !['sides', 'banner'].includes(v)) throw new HttpError(400, 'Layout should be sides or banner.');
    if (k === 'breakSlides' && !(Array.isArray(v) && v.length <= BREAK_SLIDES.length && v.every(x => BREAK_SLIDES.includes(x)) && new Set(v).size === v.length)) throw new HttpError(400, 'Those break screen slides are not valid.');
    if (k === 'breakSeconds' && !(Number.isInteger(v) && v >= 5 && v <= 120)) throw new HttpError(400, 'Seconds per slide should be between 5 and 120.');
    out[k] = v;
  }
  return out;
}
const text = (v, max, label) => {
  if (v == null) return null;
  const s = String(v).trim();
  if (s.length > max) throw new HttpError(400, `${label} is too long (${max} characters at most).`);
  return s || null;
};
const meleeIdOf = v => { const m = String(v ?? '').match(/(\d{3,9})/); return m ? Number(m[1]) : null; };

function shape(t, role, extra = {}) {
  const out = { id: t.id, meleeId: t.melee_id, name: t.name, date: t.date, venue: t.venue, bestOf: t.best_of, topCut: t.top_cut, owner: t.owner_id, created: iso(t.created), updated: iso(t.updated), role };
  if (role) { out.settings = JSON.parse(t.settings || '{}'); out.overlayKey = t.overlay_key; }
  return { ...out, ...extra };
}
async function getT(env, id) {
  const t = await env.DB.prepare(`SELECT * FROM tournaments WHERE id = ?`).bind(id).first();
  if (!t) throw new HttpError(404, 'That tournament doesn’t exist (it may have been deleted).');
  return t;
}
async function roleIn(env, tid, uid) {
  if (!uid) return null;
  const r = await env.DB.prepare(`SELECT role FROM members WHERE tournament_id = ? AND user_id = ?`).bind(tid, uid).first();
  return r?.role || null;
}
async function team(env, tid) {
  const rows = await env.DB.prepare(`SELECT u.*, m.role, m.added FROM members m JOIN users u ON u.id = m.user_id WHERE m.tournament_id = ? ORDER BY m.role = 'owner' DESC, m.added`).bind(tid).all();
  return rows.results.map(r => ({ ...publicUser(r), role: r.role, added: iso(r.added) }));
}

async function createT(body, user, env, meleeLookup) {
  const meleeId = meleeIdOf(body.melee);
  if (!meleeId) throw new HttpError(400, 'Paste the melee.gg tournament link, like https://melee.gg/Tournament/View/457640.');
  let info = null;
  try { info = await meleeLookup(meleeId); } catch (e) { throw new HttpError(400, 'Couldn’t find that tournament on melee.gg. Check the link.'); }
  const t = {
    id: shortId(), owner: user.id, meleeId,
    name: text(body.name, 80, 'The name') || info.name || `Tournament ${meleeId}`,
    date: text(body.date, 30, 'The date') || (info.date ? String(info.date).slice(0, 10) : null),
    venue: text(body.venue, 80, 'The venue'),
    bestOf: [1, 3, 5].includes(Number(body.bestOf)) ? Number(body.bestOf) : 3,
    topCut: [0, 4, 8, 16, 32].includes(Number(body.topCut)) ? Number(body.topCut) : 8,
    settings: JSON.stringify(cleanSettings(body.settings)),
  };
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO tournaments (id, owner_id, melee_id, name, date, venue, best_of, top_cut, settings, overlay_key, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(t.id, t.owner, t.meleeId, t.name, t.date, t.venue, t.bestOf, t.topCut, t.settings, rand(16), now(), now()),
    env.DB.prepare(`INSERT INTO members (tournament_id, user_id, role, added) VALUES (?, ?, 'owner', ?)`).bind(t.id, user.id, now()),
  ]);
  // Bring the owner's logos over from their most recent other tournament, so they don't upload them every time
  if (env.DATA) {
    const prev = await env.DB.prepare(`SELECT id, settings FROM tournaments WHERE owner_id = ? AND id != ? ORDER BY created DESC LIMIT 1`).bind(user.id, t.id).first();
    const logos = prev ? (JSON.parse(prev.settings || '{}').logos || {}) : {};
    const copied = {};
    for (const slot of Object.keys(logos)) {
      const { value, metadata } = await env.DATA.getWithMetadata(`logo:${prev.id}:${slot}`, 'arrayBuffer');
      if (value) { await env.DATA.put(`logo:${t.id}:${slot}`, value, { metadata }); copied[slot] = now(); }
    }
    if (Object.keys(copied).length) {
      await env.DB.prepare(`UPDATE tournaments SET settings = ? WHERE id = ?`).bind(JSON.stringify({ ...JSON.parse(t.settings), logos: copied }), t.id).run();
    }
  }
  return shape(await getT(env, t.id), 'owner', { team: await team(env, t.id) });
}

async function patchT(t, body, env, meleeLookup) {
  const sets = [], vals = [];
  const set = (col, v) => { sets.push(`${col} = ?`); vals.push(v); };
  if ('name' in body) set('name', text(body.name, 80, 'The name') || t.name);
  if ('date' in body) set('date', text(body.date, 30, 'The date'));
  if ('venue' in body) set('venue', text(body.venue, 80, 'The venue'));
  if ('bestOf' in body) { if (![1, 3, 5].includes(Number(body.bestOf))) throw new HttpError(400, 'Best of should be 1, 3 or 5.'); set('best_of', Number(body.bestOf)); }
  if ('topCut' in body) { if (![0, 4, 8, 16, 32].includes(Number(body.topCut))) throw new HttpError(400, 'Top cut should be 0, 4, 8, 16 or 32.'); set('top_cut', Number(body.topCut)); }
  if ('melee' in body) {
    const id = meleeIdOf(body.melee);
    if (!id) throw new HttpError(400, 'That doesn’t look like a melee.gg tournament link.');
    try { await meleeLookup(id); } catch (e) { throw new HttpError(400, 'Couldn’t find that tournament on melee.gg.'); }
    set('melee_id', id);
  }
  if ('settings' in body) set('settings', JSON.stringify(cleanSettings(body.settings, JSON.parse(t.settings || '{}'))));
  if (!sets.length) return;
  set('updated', now());
  await env.DB.prepare(`UPDATE tournaments SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, t.id).run();
}

const inviteShape = i => ({ code: i.code, created: iso(i.created), expires: iso(i.expires), uses: i.uses, maxUses: i.max_uses, active: !i.revoked && i.expires > now() && i.uses < i.max_uses });

// ---------- routes ----------
// Returns a Response-shaped { status, body } or a Response (redirects), or null when the path isn't ours.
export async function platform(request, env, path, { readBody, allowed, meleeLookup }) {
  const method = request.method;
  let m;
  if (path === '/auth/discord/start' && method === 'GET') { need(env); return discordStart(request, env, allowed); }
  if (path === '/auth/discord/callback' && method === 'GET') { need(env); return discordCallback(request, env); }
  if (path === '/auth/exchange' && method === 'POST') { need(env); return { body: await exchange(await readBody(request), env) }; }
  if (path === '/auth/logout' && method === 'POST') {
    need(env);
    const t = (request.headers.get('Authorization') || '').replace(/^Bearer /, '');
    if (t) await env.DB.prepare(`DELETE FROM sessions WHERE token_hash = ?`).bind(await sha256(t)).run();
    return { body: { ok: true } };
  }
  if (path === '/me' && method === 'GET') {
    need(env);
    const user = await requireUser(request, env);
    const rows = await env.DB.prepare(`SELECT t.*, m.role FROM members m JOIN tournaments t ON t.id = m.tournament_id WHERE m.user_id = ? ORDER BY COALESCE(t.date, '') DESC, t.created DESC`).bind(user.id).all();
    return { body: { user, tournaments: rows.results.map(r => shape(r, r.role)) } };
  }

  if (path === '/t' && method === 'POST') {
    need(env);
    const user = await requireUser(request, env);
    const count = await env.DB.prepare(`SELECT COUNT(*) AS n FROM tournaments WHERE owner_id = ?`).bind(user.id).first();
    if (count.n >= 200) throw new HttpError(400, 'You have a lot of tournaments. Delete some old ones first.');
    return { status: 201, body: await createT(await readBody(request), user, env, meleeLookup) };
  }

  if ((m = path.match(/^\/t\/([a-z2-9]{10})(\/.*)?$/))) {
    need(env);
    const [, id, rest = ''] = m;
    const user = await currentUser(request, env);
    const t = await getT(env, id);
    const role = await roleIn(env, id, user?.id);
    const owner = () => { if (!user) throw new HttpError(401, 'Please sign in again.'); if (role !== 'owner') throw new HttpError(403, 'Only the tournament’s owner can do that.'); };

    if (rest === '') {
      if (method === 'GET') return { body: shape(t, role, role ? { team: await team(env, id) } : {}) };
      if (method === 'PATCH') {
        const body = await readBody(request);
        // The stream team can change stream settings (Take 30, overlay look); everything else is the owner's
        if (!(role === 'stream' && Object.keys(body).every(k => k === 'settings'))) owner();
        await patchT(t, body, env, meleeLookup);
        return { body: shape(await getT(env, id), role, { team: await team(env, id) }) };
      }
      if (method === 'DELETE') {
        owner();
        if (env.DATA) await Promise.all(['creator', 'store'].map(sl => env.DATA.delete(`logo:${id}:${sl}`)));
        await env.DB.batch(['invites', 'members'].map(tb => env.DB.prepare(`DELETE FROM ${tb} WHERE tournament_id = ?`).bind(id)).concat(env.DB.prepare(`DELETE FROM tournaments WHERE id = ?`).bind(id)));
        return { body: { ok: true } };
      }
    }
    if ((m = rest.match(/^\/team\/(\d{1,25})$/)) && method === 'DELETE') {
      if (!user) throw new HttpError(401, 'Please sign in again.');
      if (m[1] !== user.id) owner();
      if (m[1] === t.owner_id) throw new HttpError(400, 'The owner can’t be removed. Delete the tournament instead.');
      await env.DB.prepare(`DELETE FROM members WHERE tournament_id = ? AND user_id = ?`).bind(id, m[1]).run();
      return { body: { ok: true, team: await team(env, id) } };
    }
    // Logos shown on the overlays: creator (content creator) and store. Owner or stream team; raw image bytes.
    if ((m = rest.match(/^\/logos\/(creator|store)$/)) && (method === 'PUT' || method === 'DELETE')) {
      if (!user) throw new HttpError(401, 'Please sign in again.');
      if (!role) throw new HttpError(403, 'Only the tournament’s team can change its logos.');
      if (!env.DATA) throw new HttpError(501, 'Logo storage is not set up on this relay.');
      const slot = m[1], key = `logo:${id}:${slot}`;
      const settings = JSON.parse(t.settings || '{}');
      const logos = { ...(settings.logos || {}) };
      if (method === 'PUT') {
        const type = (request.headers.get('Content-Type') || '').split(';')[0].trim();
        if (!LOGO_TYPES.includes(type)) throw new HttpError(400, 'Use a PNG, JPG, WebP or GIF image.');
        const buf = await request.arrayBuffer();
        if (!buf.byteLength) throw new HttpError(400, 'That image is empty.');
        if (buf.byteLength > LOGO_MAX) throw new HttpError(413, 'That image is too big (2 MB at most).');
        await env.DATA.put(key, buf, { metadata: { type } });
        logos[slot] = now();
      } else {
        await env.DATA.delete(key);
        delete logos[slot];
      }
      await env.DB.prepare(`UPDATE tournaments SET settings = ?, updated = ? WHERE id = ?`).bind(JSON.stringify({ ...settings, logos }), now(), id).run();
      return { body: shape(await getT(env, id), role, { team: await team(env, id) }) };
    }
    if (rest === '/overlay-key' && method === 'POST') {
      owner();
      const key = rand(16);
      await env.DB.prepare(`UPDATE tournaments SET overlay_key = ?, updated = ? WHERE id = ?`).bind(key, now(), id).run();
      return { body: { overlayKey: key } };
    }
    if (rest === '/invites') {
      owner();
      if (method === 'GET') {
        const rows = await env.DB.prepare(`SELECT * FROM invites WHERE tournament_id = ? AND revoked = 0 AND expires > ? ORDER BY created DESC`).bind(id, now()).all();
        return { body: { invites: rows.results.map(inviteShape) } };
      }
      if (method === 'POST') {
        const active = await env.DB.prepare(`SELECT COUNT(*) AS n FROM invites WHERE tournament_id = ? AND revoked = 0 AND expires > ?`).bind(id, now()).first();
        if (active.n >= 10) throw new HttpError(400, 'This tournament already has 10 open invite links. Cancel one first.');
        const code = shortId(12);
        await env.DB.prepare(`INSERT INTO invites (code, tournament_id, created_by, created, expires, uses, max_uses, revoked) VALUES (?, ?, ?, ?, ?, 0, ?, 0)`)
          .bind(code, id, user.id, now(), now() + INVITE_DAYS * DAY, INVITE_MAX_USES).run();
        return { status: 201, body: inviteShape(await env.DB.prepare(`SELECT * FROM invites WHERE code = ?`).bind(code).first()) };
      }
    }
    if ((m = rest.match(/^\/invites\/([a-z2-9]{12})$/)) && method === 'DELETE') {
      owner();
      await env.DB.prepare(`UPDATE invites SET revoked = 1 WHERE code = ? AND tournament_id = ?`).bind(m[1], id).run();
      return { body: { ok: true } };
    }
    throw new HttpError(404, 'Not found.');
  }

  if ((m = path.match(/^\/invite\/([a-z2-9]{12})(\/accept)?$/))) {
    need(env);
    const inv = await env.DB.prepare(`SELECT i.*, t.name, t.date, t.venue, u.name AS by_name, u.username AS by_username FROM invites i JOIN tournaments t ON t.id = i.tournament_id JOIN users u ON u.id = i.created_by WHERE i.code = ?`).bind(m[1]).first();
    if (!inv) throw new HttpError(404, 'That invite link doesn’t exist. Ask for a new one.');
    const valid = !inv.revoked && inv.expires > now() && inv.uses < inv.max_uses;
    if (!m[2] && method === 'GET') {
      const user = await currentUser(request, env);
      return { body: { tournament: { id: inv.tournament_id, name: inv.name, date: inv.date, venue: inv.venue }, invitedBy: inv.by_name || inv.by_username, expires: iso(inv.expires), valid, role: await roleIn(env, inv.tournament_id, user?.id) } };
    }
    if (m[2] && method === 'POST') {
      const user = await requireUser(request, env);
      const role = await roleIn(env, inv.tournament_id, user.id);
      if (role) return { body: { tournament: inv.tournament_id, role, already: true } };
      if (!valid) throw new HttpError(410, inv.revoked ? 'That invite link was cancelled. Ask for a new one.' : 'That invite link has expired. Ask for a new one.');
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO members (tournament_id, user_id, role, added) VALUES (?, ?, 'stream', ?)`).bind(inv.tournament_id, user.id, now()),
        env.DB.prepare(`UPDATE invites SET uses = uses + 1 WHERE code = ?`).bind(m[1]),
      ]);
      return { body: { tournament: inv.tournament_id, role: 'stream' } };
    }
  }

  if ((m = path.match(/^\/overlay\/([a-f0-9]{32})$/)) && method === 'GET') {
    need(env);
    const t = await env.DB.prepare(`SELECT * FROM tournaments WHERE overlay_key = ?`).bind(m[1]).first();
    if (!t) throw new HttpError(404, 'This overlay link is no longer valid. Copy a new one from the tournament page.');
    return { body: { id: t.id, meleeId: t.melee_id, name: t.name, bestOf: t.best_of, settings: JSON.parse(t.settings || '{}') } };
  }
  return null;
}
