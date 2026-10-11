// Shareable images, drawn on a canvas. Each make*Image() returns a canvas.

// ---------- share image (16:9): framed table on the left, art ring on the right ----------
const C = { red: '#ff1418', white: '#f4f1f1', soft: '#d9b9ba',
  asp: { Vigilance: '#4f8fe0', Command: '#3fae5e', Aggression: '#e8603f', Cunning: '#e6b93a', Heroism: '#ece8da', Villainy: '#1b1b1f' } };
const imgCache = new Map();
function loadImg(src) {
  if (!src) return Promise.resolve(null);
  if (!imgCache.has(src)) imgCache.set(src, new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; }));
  return imgCache.get(src);
}
function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  while (text.length > 1 && ctx.measureText(text + '…').width > max) text = text.slice(0, -1);
  return text + '…';
}
function sectorPath(ctx, cx, cy, r0, r1, a0, a1) {
  ctx.beginPath(); ctx.arc(cx, cy, r1, a0, a1); ctx.arc(cx, cy, r0, a1, a0, true); ctx.closePath();
}
function drawCover(ctx, im, x, y, w, h, focusY = .5) {
  const s = Math.max(w / im.width, h / im.height), iw = im.width * s, ih = im.height * s;
  ctx.drawImage(im, x + (w - iw) / 2, y + (h - ih) * focusY, iw, ih);
}
function blurred(im, w, h) {
  // Cheap blur that works in every browser: draw tiny, then scale back up.
  const s = document.createElement('canvas'); s.width = Math.max(1, Math.round(w / 14)); s.height = Math.max(1, Math.round(h / 14));
  drawCover(s.getContext('2d'), im, 0, 0, s.width, s.height, .3);
  return s;
}
async function baseArt(name) {
  const c = card('bases', name);
  return (c?.h && await loadImg(c.h)) || (c?.i && await loadImg(c.i)) || null;
}
async function leaderArt(name) {
  const c = card('leaders', name);
  return (c?.h && await loadImg(c.h)) || (c?.i && await loadImg(c.i)) || null;
}

// ---------- treemap: one tile per deck, area = share, leader art with a base strip along the bottom ----------
function squarify(items, x, y, w, h) {
  const total = items.reduce((s, it) => s + it.value, 0) || 1, scale = w * h / total, out = [];
  let rest = items.map(it => ({ ...it, area: it.value * scale }));
  while (rest.length) {
    const side = Math.min(w, h);
    const worst = row => {
      const s = row.reduce((a, r) => a + r.area, 0), mx = Math.max(...row.map(r => r.area)), mn = Math.min(...row.map(r => r.area));
      return Math.max(side * side * mx / (s * s), (s * s) / (side * side * mn));
    };
    let row = [rest[0]], k = 1;
    while (k < rest.length && worst([...row, rest[k]]) <= worst(row)) row.push(rest[k++]);
    const s = row.reduce((a, r) => a + r.area, 0);
    if (w >= h) { const cw = s / h; let yy = y; for (const r of row) { const rh = r.area / cw; out.push({ ...r, x, y: yy, w: cw, h: rh }); yy += rh; } x += cw; w -= cw; }
    else { const rh = s / w; let xx = x; for (const r of row) { const rw = r.area / rh; out.push({ ...r, x: xx, y, w: rw, h: rh }); xx += rw; } y += rh; h -= rh; }
    rest = rest.slice(k);
  }
  return out;
}

async function drawTreemap(ctx, groups, n, { X, Y, W, H }) {
  const { D, B, M } = FONTS, GAP = 6;
  const tiles = squarify(groups.map(g => ({ g, value: g.count })), X, Y, W, H);
  for (const t of tiles) {
    const g = t.g, x = t.x + GAP / 2, y = t.y + GAP / 2, w = t.w - GAP, h = t.h - GAP;
    if (w < 4 || h < 4) continue;
    const strip = Math.max(12, Math.min(52, h * .2));
    ctx.save(); rr(ctx, x, y, w, h, 7); ctx.clip();
    // Leader art fills the tile above the base strip
    const im = await leaderArt(g.leader);
    if (im) drawCover(ctx, im, x, y, w, h - strip, .22); else { ctx.fillStyle = '#3a0d10'; ctx.fillRect(x, y, w, h - strip); }
    // Base strip: its art, or its aspect colour for a colour group
    const gi = genericInfo.get(g.base), by = y + h - strip;
    if (gi) { ctx.fillStyle = C.asp[gi.aspect]; ctx.fillRect(x, by, w, strip); }
    else {
      const bi = await baseArt(g.base);
      if (bi) { ctx.save(); ctx.beginPath(); ctx.rect(x, by, w, strip); ctx.clip(); drawCover(ctx, bi, x, by, w, Math.max(strip, w * .37), .5); ctx.restore(); ctx.fillStyle = 'rgba(0,0,0,.3)'; ctx.fillRect(x, by, w, strip); }
      else { ctx.fillStyle = '#2a0a0c'; ctx.fillRect(x, by, w, strip); }
    }
    ctx.fillStyle = '#0b0405'; ctx.fillRect(x, by - 2, w, 3);
    // Shade behind the leader name
    const big = w >= 150 && h >= 120;
    if (big) {
      const sh = ctx.createLinearGradient(0, by - Math.min(130, h * .55), 0, by);
      sh.addColorStop(0, 'rgba(10,3,4,0)'); sh.addColorStop(1, 'rgba(10,3,4,.88)');
      ctx.fillStyle = sh; ctx.fillRect(x, by - Math.min(130, h * .55), w, Math.min(130, h * .55));
    }
    ctx.restore();

    ctx.textBaseline = 'alphabetic';
    // Base name in the strip
    if (strip >= 18) {
      const dark = gi && (gi.aspect === 'Cunning' || gi.aspect === 'Heroism');
      let fs = Math.min(20, strip * .55); ctx.font = `700 ${fs}px ${D}`;
      const label = g.base.toUpperCase();
      if (ctx.measureText(label).width <= w - 16) {
        ctx.textAlign = 'left'; ctx.fillStyle = dark ? '#141414' : '#ffffff';
        if (!dark) { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.6)'; ctx.strokeText(label, x + 9, by + strip / 2 + fs * .36); }
        ctx.fillText(label, x + 9, by + strip / 2 + fs * .36);
      }
    }
    // Leader name above the strip
    if (big) {
      const lname = (g.label.startsWith(g.leader) ? g.leader : splitLeader(g.leader).name).toUpperCase();
      let fs = Math.max(20, Math.min(44, w / 8)); ctx.font = `italic 800 ${fs}px ${D}`;
      while (fs > 18 && ctx.measureText(lname).width > w - 22) { fs--; ctx.font = `italic 800 ${fs}px ${D}`; }
      ctx.textAlign = 'left'; ctx.fillStyle = C.white; ctx.fillText(fit(ctx, lname, w - 22), x + 11, by - 12);
    }
    // Share pill in the top-left corner
    const share = pct(g.count / n);
    const ps = big ? 22 : 16; ctx.font = `700 ${ps}px ${M}`;
    const pw = ctx.measureText(share).width + (big ? 20 : 14), ph = big ? 36 : 26;
    if (pw + 10 <= w && ph + strip + 8 <= h) {
      ctx.fillStyle = 'rgba(11,4,5,.88)'; rr(ctx, x + 7, y + 7, pw, ph, ph / 2); ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = C.red; ctx.stroke();
      ctx.fillStyle = C.white; ctx.textAlign = 'center'; ctx.fillText(share, x + 7 + pw / 2, y + 7 + ph / 2 + ps * .36);
    }
  }
  ctx.textAlign = 'center'; ctx.font = `600 17px ${B}`; ctx.fillStyle = C.soft;
  ctx.fillText('TILE SIZE = SHARE OF PLAYERS   ·   BOTTOM STRIP = BASE', X + W / 2, Y + H + 32);
  ctx.textAlign = 'left';
}
function rr(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2)); }

const FONTS = { D: '"Barlow Condensed", "Arial Narrow", sans-serif', B: 'Barlow, system-ui, sans-serif', M: '"JetBrains Mono", Menlo, monospace' };
const FOOTNOTE = '*Percentages are rounded so may not add to 100%  ·  Data: melee.gg  ·  Card art © Lucasfilm Ltd. & FFG via swu-db.com';

// Framed title box: logo on the left, event name and counts right-aligned.
function drawTitleBox(ctx, { X0, X1, Y, H, LW, big, small }, logo, title, sub) {
  const { D, B } = FONTS;
  ctx.strokeStyle = C.white; ctx.lineWidth = 3; ctx.strokeRect(X0, Y, X1 - X0, H);
  if (logo) ctx.drawImage(logo, X0 + 24, Y + (H - LW * logo.height / logo.width) / 2, LW, LW * logo.height / logo.width);
  const tmax = X1 - X0 - LW - 72;
  let fs = big; ctx.font = `italic 800 ${fs}px ${D}`;
  while (fs > big * .58 && ctx.measureText(title).width > tmax) { fs -= 2; ctx.font = `italic 800 ${fs}px ${D}`; }
  ctx.textAlign = 'right'; ctx.fillStyle = C.white; ctx.fillText(fit(ctx, title, tmax), X1 - 26, Y + H * .58);
  ctx.font = `600 ${small}px ${B}`; ctx.fillStyle = C.soft;
  ctx.fillText(fit(ctx, sub, tmax), X1 - 26, Y + H * .84);
  ctx.textAlign = 'left';
}

// Ring: one wedge per deck with 5%+ share (the rest share an "Other" wedge), leader art outside, base inside.
// Sizes are scaled from the 16:9 layout (r1 = 430) so the same drawing works at any size.
async function drawRing(ctx, groups, n, { cx, cy, r1, r0 }, logo, centreTitle, centreSub) {
  const { D, B, M } = FONTS, s = r1 / 430;
  // Compare the rounded share, so a deck shown as "5%" in the table (e.g. 2 of 44) makes the cut.
  const RING_MIN = 5, inRing = g => Math.round(g.count / n * 100) >= RING_MIN;
  const big = groups.filter(inRing), small = groups.filter(g => !inRing(g));
  const ring = small.length ? [...big, { other: true, count: small.reduce((t, g) => t + g.count, 0) }] : big;
  const sum = ring.reduce((t, g) => t + g.count, 0) || 1;
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 40 * s;
  ctx.beginPath(); ctx.arc(cx, cy, r1 + 14 * s, 0, Math.PI * 2); ctx.fillStyle = '#0b0405'; ctx.fill(); ctx.restore();
  const rb = r0 + 64 * s;
  const sectorBox = (ra, rz, a0, a1, min) => {
    const pts = [];
    for (let k = 0; k <= 24; k++) { const t = a0 + (a1 - a0) * k / 24; pts.push([cx + rz * Math.cos(t), cy + rz * Math.sin(t)], [cx + ra * Math.cos(t), cy + ra * Math.sin(t)]); }
    const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
    let x = Math.min(...xs), y = Math.min(...ys), w = Math.max(...xs) - x, h = Math.max(...ys) - y;
    if (w < min) { x -= (min - w) / 2; w = min; }
    if (h < min) { y -= (min - h) / 2; h = min; }
    return { x, y, w, h };
  };
  let a = -Math.PI / 2;
  const marks = [], bands = [];
  for (const g of ring) {
    const a1 = a + g.count / sum * Math.PI * 2;
    ctx.save(); sectorPath(ctx, cx, cy, rb, r1, a, a1); ctx.clip();
    const im = g.other ? null : await leaderArt(g.leader), lb = sectorBox(rb, r1, a, a1, 220 * s);
    if (im) drawCover(ctx, im, lb.x, lb.y, lb.w, lb.h, .25);
    else { ctx.fillStyle = '#3a0d10'; ctx.fillRect(lb.x, lb.y, lb.w, lb.h); }
    ctx.restore();
    ctx.save(); sectorPath(ctx, cx, cy, r0, rb, a, a1); ctx.clip();
    const gi = g.other ? null : genericInfo.get(g.base), bb = sectorBox(r0, rb, a, a1, 140 * s);
    const bi = g.other || gi ? null : await baseArt(g.base);
    if (gi) ctx.fillStyle = C.asp[gi.aspect];
    else if (bi) { drawCover(ctx, bi, bb.x, bb.y, bb.w, bb.h, .5); ctx.fillStyle = 'rgba(0,0,0,.28)'; }
    else ctx.fillStyle = '#2a0a0c';
    ctx.fillRect(bb.x, bb.y, bb.w, bb.h);
    ctx.restore();
    bands.push({ a, a1, label: g.other ? 'OTHER DECKS' : g.base.toUpperCase(), dark: gi && (gi.aspect === 'Cunning' || gi.aspect === 'Heroism') });
    if (g.count / sum >= .035) marks.push([(a + a1) / 2, pct(g.count / n)]);
    a = a1;
  }
  ctx.strokeStyle = '#0b0405'; ctx.lineWidth = 5 * s; ctx.beginPath();
  a = -Math.PI / 2;
  for (const g of ring) { ctx.moveTo(cx + r0 * Math.cos(a), cy + r0 * Math.sin(a)); ctx.lineTo(cx + r1 * Math.cos(a), cy + r1 * Math.sin(a)); a += g.count / sum * Math.PI * 2; }
  ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, rb, 0, Math.PI * 2); ctx.lineWidth = 4 * s; ctx.stroke();
  ctx.beginPath(); ctx.arc(cx, cy, r1 + 10 * s, 0, Math.PI * 2); ctx.strokeStyle = C.red; ctx.lineWidth = 6 * s; ctx.stroke();

  // Base names along the inner band, wherever the wedge is wide enough to fit them
  const rm = (r0 + rb) / 2;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const b of bands) {
    const m = (b.a + b.a1) / 2, room = rm * (b.a1 - b.a) - 12 * s;
    let fsz = 17 * s; ctx.font = `700 ${fsz}px ${D}`;
    while (fsz > 10 && ctx.measureText(b.label).width > room) { fsz--; ctx.font = `700 ${fsz}px ${D}`; }
    if (ctx.measureText(b.label).width > room) continue;
    ctx.save();
    ctx.translate(cx + rm * Math.cos(m), cy + rm * Math.sin(m));
    ctx.rotate(Math.sin(m) > 0 ? m - Math.PI / 2 : m + Math.PI / 2);
    if (!b.dark) { ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,.75)'; ctx.strokeText(b.label, 0, 1); }
    ctx.fillStyle = b.dark ? '#141414' : '#ffffff'; ctx.fillText(b.label, 0, 1);
    ctx.restore();
  }
  // Share badges on the leader band
  for (const [m, share] of marks) {
    const mx = cx + (r1 - 38 * s) * Math.cos(m), my = cy + (r1 - 38 * s) * Math.sin(m);
    ctx.beginPath(); ctx.arc(mx, my, 26 * s, 0, Math.PI * 2); ctx.fillStyle = 'rgba(11,4,5,.9)'; ctx.fill();
    ctx.lineWidth = 2.5; ctx.strokeStyle = C.red; ctx.stroke();
    ctx.fillStyle = C.white; ctx.font = `700 ${17 * s}px ${M}`; ctx.fillText(share, mx, my + 1);
  }
  ctx.textBaseline = 'alphabetic';
  ctx.font = `600 ${Math.max(14, 17 * s)}px ${B}`; ctx.fillStyle = C.soft;
  ctx.fillText('OUTER RING: LEADER   ·   INNER RING: BASE', cx, cy + r1 + 46 * s);

  // Centre
  const cg = ctx.createRadialGradient(cx, cy - 60 * s, 20 * s, cx, cy, r0);
  cg.addColorStop(0, '#3a0a0d'); cg.addColorStop(1, '#160506');
  ctx.beginPath(); ctx.arc(cx, cy, r0 - 4 * s, 0, Math.PI * 2); ctx.fillStyle = cg; ctx.fill();
  ctx.lineWidth = 3; ctx.strokeStyle = C.white; ctx.stroke();
  if (logo) { const w = 280 * s, h = w * logo.height / logo.width; ctx.drawImage(logo, cx - w / 2, cy - 168 * s, w, h); }
  ctx.textAlign = 'center'; ctx.fillStyle = C.white;
  let cfs = 60 * s; ctx.font = `italic 800 ${cfs}px ${D}`;
  while (cfs > 34 * s && ctx.measureText(centreTitle).width > 400 * s) { cfs -= 1; ctx.font = `italic 800 ${cfs}px ${D}`; }
  ctx.fillText(fit(ctx, centreTitle, 400 * s), cx, cy + 22 * s);
  ctx.font = `italic 800 ${40 * s}px ${D}`; ctx.fillStyle = C.red;
  ctx.fillText('DECK BREAKDOWN', cx, cy + 72 * s);
  ctx.font = `600 ${20 * s}px ${B}`; ctx.fillStyle = C.soft;
  ctx.fillText(centreSub, cx, cy + 114 * s);
  ctx.textAlign = 'left';
}

// Blurred art of the most played deck's leader, washed red.
async function drawBackground(ctx, W, H, groups, art) {
  ctx.fillStyle = '#100506'; ctx.fillRect(0, 0, W, H);
  const bgArt = groups[0] ? await leaderArt(groups[0].leader) : null;
  if (bgArt) { ctx.save(); ctx.globalAlpha = .9; ctx.drawImage(blurred(bgArt, art.w, art.h), art.x, art.y, art.w, art.h); ctx.restore(); }
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#b3070d'; ctx.fillRect(art.x, art.y, art.w, art.h); ctx.restore();
}

// ---------- current top 8 (after the latest completed round) ----------
// The eight highest-ranked players still in the event, each on a card with their deck.
function currentTop8() {
  // When following live, use the latest completed Swiss round, so playoff placings don't replace the Swiss standings.
  const sw = state.view?.swiss;
  const source = sw ? withDecks(sw.players) : currentPlayers();
  const ps = source.filter(p => p.rank && p.rank < 9999 && !/drop/i.test(p.status || '')).sort((a, b) => a.rank - b.rank).slice(0, 8);
  const round = sw?.round || state.view?.round || (() => { const k = Math.max(...state.rounds.keys()); return k > 0 ? `Round ${k}` : ''; })();
  return { ps, round };
}

async function drawPlayerCard(ctx, p, deck, x, y, w, h) {
  const { D, B, M } = FONTS;
  ctx.save(); rr(ctx, x, y, w, h, 12); ctx.clip();
  ctx.fillStyle = 'rgba(12,3,5,.94)'; ctx.fillRect(x, y, w, h);
  const wide = w / h > 1.45;
  // Art: leader on top (or left), base strip underneath
  const ax = x, ay = y, aw = wide ? h : w, ah = wide ? h : h - 128, strip = wide ? 12 : 16;
  const im = deck ? await leaderArt(deck.leader) : null;
  ctx.save(); ctx.beginPath(); ctx.rect(ax, ay, aw, ah - strip); ctx.clip();
  if (im) drawCover(ctx, im, ax, ay, aw, ah - strip, .22); else { ctx.fillStyle = '#3a0d10'; ctx.fillRect(ax, ay, aw, ah - strip); }
  ctx.restore();
  const gi = deck ? genericInfo.get(deck.base) : null;
  if (gi) { ctx.fillStyle = C.asp[gi.aspect]; ctx.fillRect(ax, ay + ah - strip, aw, strip); }
  else {
    const bi = deck ? await baseArt(deck.base) : null;
    ctx.save(); ctx.beginPath(); ctx.rect(ax, ay + ah - strip, aw, strip); ctx.clip();
    if (bi) drawCover(ctx, bi, ax, ay + ah - strip, aw, strip, .5); else { ctx.fillStyle = '#2a0a0c'; ctx.fillRect(ax, ay + ah - strip, aw, strip); }
    ctx.restore();
  }
  ctx.restore();
  ctx.strokeStyle = p.rank === 1 ? C.red : 'rgba(255,255,255,.22)'; ctx.lineWidth = p.rank === 1 ? 4 : 2; rr(ctx, x, y, w, h, 12); ctx.stroke();

  // Rank badge
  const rs = wide ? 24 : 28; ctx.font = `700 ${rs}px ${M}`;
  const label = String(p.rank), bw = Math.max(rs * 1.9, ctx.measureText(label).width + 26), bh = rs * 1.75;
  ctx.fillStyle = C.red; rr(ctx, x + 12, y + 12, bw, bh, bh / 2); ctx.fill();
  ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, x + 12 + bw / 2, y + 12 + bh / 2 + 1);
  ctx.textBaseline = 'alphabetic';

  // Text: name, record, deck
  const tx = wide ? x + aw + 22 : x + 18, tw = wide ? w - aw - 40 : w - 36;
  const top = wide ? y + h / 2 - 34 : y + ah + 38;
  const name = p.name.toUpperCase();
  let fs = wide ? 34 : 36; ctx.font = `italic 800 ${fs}px ${D}`;
  while (fs > 20 && ctx.measureText(name).width > tw) { fs--; ctx.font = `italic 800 ${fs}px ${D}`; }
  ctx.textAlign = 'left'; ctx.fillStyle = C.white; ctx.fillText(fit(ctx, name, tw), tx, top);
  ctx.font = `700 ${wide ? 20 : 22}px ${M}`; ctx.fillStyle = C.red;
  const rec = `${p.record || ''}${p.points != null ? `  ·  ${p.points} PTS` : ''}`;
  ctx.fillText(rec, tx, top + (wide ? 32 : 36));
  ctx.font = `600 ${wide ? 19 : 21}px ${B}`; ctx.fillStyle = C.soft;
  ctx.fillText(fit(ctx, deck ? deck.label : 'No decklist', tw), tx, top + (wide ? 62 : 70));
}

async function makeTop8Image() {
  const { ps, round } = currentTop8(); if (!ps.length) return null;
  const { D, B } = FONTS, tall = state.format === 'tall';
  const W = tall ? 1080 : 1920, H = tall ? 1350 : 1080;
  await Promise.all(['italic 800 80px "Barlow Condensed"', '700 40px "Barlow Condensed"', '600 22px Barlow', '700 22px "JetBrains Mono"'].map(f => document.fonts.load(f).catch(() => {})));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');

  // Decks, labelled like the deck breakdown
  const groups = deckGroups(ps.filter(p => p.known), 'deck');
  const deckOf = new Map();
  for (const g of groups) for (const p of g.players) deckOf.set(p.id, g);

  ctx.fillStyle = '#100506'; ctx.fillRect(0, 0, W, H);
  const lead = deckOf.get(ps[0].id);
  const bg = lead ? await leaderArt(lead.leader) : null;
  if (bg) { ctx.save(); ctx.globalAlpha = .9; ctx.drawImage(blurred(bg, W, H), 0, 0, W, H); ctx.restore(); }
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#b3070d'; ctx.fillRect(0, 0, W, H); ctx.restore();
  ctx.fillStyle = 'rgba(16,4,6,.78)'; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  const logo = await loadImg('bdst-logo.png');
  const ev = document.getElementById('evname').value.trim();
  drawTitleBox(ctx, tall ? { X0: 40, X1: W - 40, Y: 40, H: 136, LW: 190, big: 62, small: 19 } : { X0: 40, X1: W - 40, Y: 40, H: 140, LW: 220, big: 72, small: 21 },
    logo, (ev || 'Top 8').toUpperCase(), `STAR WARS: UNLIMITED  ·  TOP 8${round ? ' AFTER ' + round.toUpperCase() : ''}`);

  // Card grid: 4 × 2 wide, 2 × 4 tall
  const cols = tall ? 2 : 4, rows = Math.ceil(8 / cols), gap = 22;
  const gx0 = 40, gy0 = tall ? 200 : 206, gx1 = W - 40, gy1 = H - 96;
  const cw = (gx1 - gx0 - gap * (cols - 1)) / cols, ch = (gy1 - gy0 - gap * (rows - 1)) / rows;
  for (let i = 0; i < ps.length; i++) {
    // Tall layout reads down each column: 1-4 on the left, 5-8 on the right
    const c = tall ? Math.floor(i / rows) : i % cols, r = tall ? i % rows : Math.floor(i / cols);
    await drawPlayerCard(ctx, ps[i], deckOf.get(ps[i].id), gx0 + c * (cw + gap), gy0 + r * (ch + gap), cw, ch);
  }

  // Which decks make up the top 8
  const summary = groups.map(g => `${g.label.toUpperCase()}${g.count > 1 ? ` ×${g.count}` : ''}`).join('   ·   ');
  ctx.textAlign = 'left'; ctx.font = `italic 800 ${tall ? 20 : 22}px ${D}`; ctx.fillStyle = C.red;
  const lbl = 'DECKS IN THE TOP 8:  ';
  ctx.fillText(lbl, 40, H - 52);
  const lw = ctx.measureText(lbl).width;
  ctx.font = `700 ${tall ? 18 : 21}px ${D}`; ctx.fillStyle = C.white;
  ctx.fillText(fit(ctx, summary, W - 80 - lw), 40 + lw, H - 52);
  ctx.textAlign = 'right'; ctx.font = `500 14px ${B}`; ctx.fillStyle = C.soft;
  ctx.fillText('Data: melee.gg  ·  Card art © Lucasfilm Ltd. & FFG via swu-db.com', W - 40, H - 18);
  ctx.textAlign = 'left';
  return cv;
}

// Top 8 bracket image (1920 × 1080): quarterfinals on the left, final and champion on the right.
async function makeBracketImage() {
  const br = state.view?.bracket; if (!br) return null;
  const { D, B, M } = FONTS, W = 1920, H = 1080;
  await Promise.all(['italic 800 80px "Barlow Condensed"', '700 40px "Barlow Condensed"', '600 22px Barlow', '700 22px "JetBrains Mono"'].map(f => document.fonts.load(f).catch(() => {})));
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  genericInfo.clear();
  const focus = br.champion || br.rounds[0].slots[0].players[0];
  const fd = entrantDeck(focus);
  ctx.fillStyle = '#100506'; ctx.fillRect(0, 0, W, H);
  const bg = fd ? await leaderArt(fd.leader) : null;
  if (bg) { ctx.save(); ctx.globalAlpha = .9; ctx.drawImage(blurred(bg, W, H), 0, 0, W, H); ctx.restore(); }
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#b3070d'; ctx.fillRect(0, 0, W, H); ctx.restore();
  ctx.fillStyle = 'rgba(16,4,6,.78)'; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  const logo = await loadImg('bdst-logo.png');
  const ev = document.getElementById('evname').value.trim();
  drawTitleBox(ctx, { X0: 40, X1: W - 40, Y: 40, H: 140, LW: 220, big: 72, small: 21 }, logo, (ev || 'Top 8').toUpperCase(),
    `STAR WARS: UNLIMITED  ·  TOP ${br.size}${br.note ? '  ·  ' + br.note.toUpperCase() : ''}`);

  const nR = br.rounds.length, CW = 500, CH = 150, Y0 = 262, Y1 = 1036;
  const colX = j => 40 + j * ((W - 80 - CW) / Math.max(1, nR - 1 + (br.champion ? .0 : 0)));
  const centers = br.rounds.map((r, j) => r.slots.map((_, i) => { const slot = (Y1 - Y0) / r.slots.length; return Y0 + slot * (i + .5); }));

  // Round labels
  ctx.font = `italic 800 28px ${D}`; ctx.fillStyle = C.red; ctx.textAlign = 'left';
  br.rounds.forEach((r, j) => ctx.fillText(r.name.toUpperCase(), colX(j), 236));

  // Connectors: white, with the winner's path in red
  for (let j = 1; j < nR; j++) {
    const x0 = colX(j - 1) + CW, x2 = colX(j), xm = (x0 + x2) / 2;
    br.rounds[j].slots.forEach((_, i) => {
      const ya = centers[j - 1][2 * i], yb = centers[j - 1][2 * i + 1], yc = centers[j][i];
      for (const [y, s] of [[ya, br.rounds[j - 1].slots[2 * i]], [yb, br.rounds[j - 1].slots[2 * i + 1]]]) {
        ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(xm, y); ctx.lineTo(xm, yc); ctx.lineTo(x2, yc);
        ctx.strokeStyle = s.winner ? C.red : 'rgba(255,255,255,.28)'; ctx.lineWidth = s.winner ? 4 : 3; ctx.stroke();
      }
    });
  }

  // Match cards
  const drawRow = async (e, m, x, y, h) => {
    const lose = m.winner && e && m.winner.id !== e.id, win = m.winner && e && m.winner.id === e.id;
    ctx.save(); if (lose) ctx.globalAlpha = .42;
    if (win) { ctx.fillStyle = C.red; ctx.fillRect(x, y, 6, h); }
    if (!e) {
      ctx.font = `italic 700 26px ${D}`; ctx.fillStyle = C.soft; ctx.textAlign = 'left'; ctx.fillText('TO BE DECIDED', x + 132, y + h / 2 + 9);
      ctx.restore(); return;
    }
    const d = entrantDeck(e);
    ctx.font = `700 22px ${M}`; ctx.fillStyle = C.red; ctx.textAlign = 'right'; ctx.fillText(e.seed ?? '', x + 48, y + h / 2 + 8);
    const ax = x + 60, ay = y + 7, as = h - 14;
    if (d) {
      const im = await leaderArt(d.leader);
      ctx.save(); rr(ctx, ax, ay, as, as, 8); ctx.clip();
      if (im) drawCover(ctx, im, ax, ay, as, as - 10, .2);
      const gi = genericInfo.get(d.base);
      if (gi) { ctx.fillStyle = C.asp[gi.aspect]; ctx.fillRect(ax, ay + as - 10, as, 10); }
      else { const bi = await baseArt(d.base); if (bi) drawCover(ctx, bi, ax, ay + as - 10, as, 10, .5); else { ctx.fillStyle = '#2a0a0c'; ctx.fillRect(ax, ay + as - 10, as, 10); } }
      ctx.restore();
    } else { ctx.fillStyle = 'rgba(255,255,255,.08)'; rr(ctx, ax, ay, as, as, 8); ctx.fill(); }
    const tx = ax + as + 16, tw = CW - (tx - x) - 64;
    ctx.textAlign = 'left'; ctx.fillStyle = C.white;
    let fs = 28; ctx.font = `italic 800 ${fs}px ${D}`;
    const nm = e.name.toUpperCase();
    while (fs > 18 && ctx.measureText(nm).width > tw) { fs--; ctx.font = `italic 800 ${fs}px ${D}`; }
    ctx.fillText(fit(ctx, nm, tw), tx, y + h / 2 - 2);
    ctx.font = `500 18px ${B}`; ctx.fillStyle = C.soft;
    ctx.fillText(fit(ctx, d ? d.label : 'No decklist', tw), tx, y + h / 2 + 24);
    if (e.gameWins != null) { ctx.font = `700 36px ${M}`; ctx.fillStyle = C.white; ctx.textAlign = 'right'; ctx.fillText(String(e.gameWins), x + CW - 22, y + h / 2 + 13); }
    ctx.restore();
  };
  for (let j = 0; j < nR; j++) {
    for (let i = 0; i < br.rounds[j].slots.length; i++) {
      const m = br.rounds[j].slots[i], x = colX(j), y = centers[j][i] - CH / 2, rh = (CH - 2) / 2;
      ctx.fillStyle = 'rgba(12,3,5,.92)'; rr(ctx, x, y, CW, CH, 10); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,.22)'; ctx.lineWidth = 2; ctx.stroke();
      ctx.save(); rr(ctx, x, y, CW, CH, 10); ctx.clip();
      await drawRow(m.players[0], m, x, y, rh);
      ctx.fillStyle = 'rgba(255,255,255,.14)'; ctx.fillRect(x, y + rh, CW, 2);
      await drawRow(m.players[1], m, x, y + rh + 2, rh);
      ctx.restore();
    }
  }

  // Champion, above the final
  if (br.champion) {
    const d = entrantDeck(br.champion), x = colX(nR - 1), top = 292;
    ctx.font = `italic 800 34px ${D}`; ctx.fillStyle = C.red; ctx.textAlign = 'left'; ctx.fillText('CHAMPION', x, top);
    const as = 170, ay = top + 18;
    if (d) {
      const im = await leaderArt(d.leader);
      ctx.save(); rr(ctx, x, ay, as, as, 12); ctx.clip(); if (im) drawCover(ctx, im, x, ay, as, as, .2); ctx.restore();
      ctx.strokeStyle = C.red; ctx.lineWidth = 4; rr(ctx, x, ay, as, as, 12); ctx.stroke();
    }
    const tx = x + (d ? as + 22 : 0), tw = CW - (tx - x);
    let fs = 54; ctx.font = `italic 800 ${fs}px ${D}`;
    const nm = br.champion.name.toUpperCase();
    while (fs > 30 && ctx.measureText(nm).width > tw) { fs -= 2; ctx.font = `italic 800 ${fs}px ${D}`; }
    ctx.fillStyle = C.white; ctx.fillText(fit(ctx, nm, tw), tx, ay + 76);
    ctx.font = `600 24px ${B}`; ctx.fillStyle = C.soft; ctx.fillText(fit(ctx, d ? d.label : '', tw), tx, ay + 116);
  }

  ctx.textAlign = 'right'; ctx.font = `500 15px ${B}`; ctx.fillStyle = C.soft;
  ctx.fillText('Data: melee.gg  ·  Card art © Lucasfilm Ltd. & FFG via swu-db.com', W - 40, H - 16);
  ctx.textAlign = 'left';
  return cv;
}

async function makeImage() {
  if (state.kind === 'bracket') return makeBracketImage();
  if (state.kind === 'top8') return makeTop8Image();
  if (state.kind === 'race') return makeRaceImage();
  if (state.kind === 'recap') return makeRecapImage();
  if (state.kind === 'feature') return makeFeatureImage();
  if (state.kind === 'team') return makeTeamImage();
  const ps = currentPlayers(); if (!ps.length) return null;
  await Promise.all(['italic 800 80px "Barlow Condensed"', '700 40px "Barlow Condensed"', '600 22px Barlow', '700 22px "JetBrains Mono"'].map(f => document.fonts.load(f).catch(() => {})));
  const known = ps.filter(p => p.known), total = ps.length, n = known.length || 1;
  const groups = deckGroups(known, 'deck');
  const ev = document.getElementById('evname').value.trim();
  const logo = await loadImg('bdst-logo.png');
  const counts = `${total} PLAYERS  ·  ${groups.length} DECKS`;
  return state.format === 'tall'
    ? makeTall(groups, n, ev, logo, counts)
    : makeWide(groups, n, ev, logo, counts);
}

// 16:9 (1920 × 1080): title and table on the left, chart on the right.
async function makeWide(groups, n, ev, logo, counts) {
  const { D, B, M } = FONTS, W = 1920, H = 1080;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  await drawBackground(ctx, W, H, groups, { x: 860, y: 0, w: 1100, h: H });
  const shade = ctx.createLinearGradient(0, 0, 1260, 0);
  shade.addColorStop(0, 'rgba(22,5,7,.97)'); shade.addColorStop(.78, 'rgba(26,5,7,.93)'); shade.addColorStop(1, 'rgba(26,5,7,0)');
  ctx.fillStyle = shade; ctx.fillRect(0, 0, W, H);
  const vig = ctx.createRadialGradient(1450, 560, 300, 1450, 560, 900);
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.55)');
  ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  const X0 = 40, X1 = 980;
  drawTitleBox(ctx, { X0, X1, Y: 40, H: 156, LW: 230, big: 76, small: 22 }, logo, (ev || 'Deck Breakdown').toUpperCase(), `STAR WARS: UNLIMITED  ·  ${counts}`);

  // Main table
  const cols = { name: 680, d1: 700, d2: 840, c1: 770, c2: 910 };
  const T0 = 216, HEAD = 58;
  const room = Math.floor((850 - (T0 + HEAD) - 3 * 50) / 38) + 3;
  const overflow = groups.length > room;
  const shown = overflow ? groups.slice(0, room - 1) : groups;
  const rest = overflow ? groups.slice(room - 1) : [];
  const rowH = i => i < 3 ? 50 : 38;
  let y = T0 + HEAD;
  const rowsEnd = y + shown.reduce((s, _, i) => s + rowH(i), 0) + (rest.length ? 38 : 0) + 12;
  ctx.lineWidth = 3; ctx.strokeRect(X0, T0, X1 - X0, rowsEnd - T0);
  ctx.lineWidth = 2; ctx.beginPath();
  ctx.moveTo(X0, T0 + HEAD); ctx.lineTo(X1, T0 + HEAD);
  for (const x of [cols.d1, cols.d2]) { ctx.moveTo(x, T0); ctx.lineTo(x, rowsEnd); }
  ctx.stroke();
  ctx.font = `700 24px ${D}`; ctx.fillStyle = C.white;
  ctx.textAlign = 'right'; ctx.fillText('DECK', cols.name, T0 + 38);
  ctx.textAlign = 'center'; ctx.fillText('PLAYERS', cols.c1, T0 + 38); ctx.fillText('SHARE', cols.c2, T0 + 38);
  const row = (g, i, label, num) => {
    const h = rowH(i), big = i < 3, base = y + h * .76;
    ctx.font = `700 ${big ? 22 : 18}px ${M}`; ctx.textAlign = 'left'; ctx.fillStyle = C.red;
    if (num) ctx.fillText(String(num).padStart(2, '0'), X0 + 22, base - (big ? 4 : 2));
    const space = cols.name - X0 - 90, text = label.toUpperCase();
    let fsz = big ? 42 : 32; ctx.font = `700 ${fsz}px ${D}`;
    while (fsz > (big ? 28 : 22) && ctx.measureText(text).width > space) { fsz--; ctx.font = `700 ${fsz}px ${D}`; }
    ctx.fillStyle = C.white; ctx.textAlign = 'right';
    ctx.fillText(fit(ctx, text, space), cols.name, base);
    ctx.font = `700 ${big ? 42 : 32}px ${D}`; ctx.textAlign = 'center';
    ctx.fillText(String(g.count), cols.c1, base);
    ctx.fillText(pct(g.count / n), cols.c2, base);
    y += h;
  };
  shown.forEach((g, i) => row(g, i, g.label, i + 1));
  if (rest.length) row({ count: rest.reduce((s, g) => s + g.count, 0) }, 99, 'Other decks', null);

  // Compact table for the tail
  if (rest.length) {
    const S0 = rowsEnd + 16, rh = 21, maxPer = Math.floor((1040 - S0 - 20) / rh);
    const list = rest.length > maxPer * 2 ? [...rest.slice(0, maxPer * 2 - 1), { label: `+${rest.length - maxPer * 2 + 1} more`, more: true }] : rest;
    const per = Math.ceil(list.length / 2), ncol = list.length > 1 ? 2 : 1, S1 = S0 + 20 + per * rh;
    ctx.lineWidth = 3; ctx.strokeRect(X0, S0, X1 - X0, S1 - S0);
    list.forEach((g, i) => {
      const c = Math.floor(i / per), r = i % per, cx = X0 + c * 470, yy = S0 + 10 + r * rh + rh * .78;
      ctx.font = `600 18px ${D}`; ctx.fillStyle = C.white; ctx.textAlign = 'right';
      ctx.fillText(fit(ctx, g.label.toUpperCase(), 300), cx + 330, yy);
      if (!g.more) { ctx.textAlign = 'center'; ctx.fillText(String(g.count), cx + 368, yy); ctx.fillText(pct(g.count / n), cx + 425, yy); }
    });
    ctx.lineWidth = 1.5; ctx.beginPath();
    for (let c = 0; c < ncol; c++) for (const dx of [348, 390]) { ctx.moveTo(X0 + c * 470 + dx, S0 + 10); ctx.lineTo(X0 + c * 470 + dx, S1 - 10); }
    ctx.stroke();
  }

  if (state.chart === 'treemap') await drawTreemap(ctx, groups, n, { X: 1010, Y: 40, W: 870, H: 960 });
  else await drawRing(ctx, groups, n, { cx: 1450, cy: 556, r1: 430, r0: 238 }, logo, (ev || 'Meta Report').toUpperCase(), counts);

  ctx.textAlign = 'right'; ctx.font = `500 15px ${B}`; ctx.fillStyle = C.soft;
  ctx.fillText(FOOTNOTE, W - 40, H - 22);
  ctx.textAlign = 'left';
  return cv;
}

// 4:5 (1080 × 1350) for Facebook and Instagram feeds: title on top, chart in the middle, two-column table below.
async function makeTall(groups, n, ev, logo, counts) {
  const { D, B, M } = FONTS, W = 1080, H = 1350, X0 = 40, X1 = W - 40;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const ctx = cv.getContext('2d');
  await drawBackground(ctx, W, H, groups, { x: 0, y: 0, w: W, h: H });
  ctx.fillStyle = 'rgba(20,5,7,.72)'; ctx.fillRect(0, 0, W, H);
  const vig = ctx.createRadialGradient(W / 2, 520, 200, W / 2, 520, 900);
  vig.addColorStop(0, 'rgba(0,0,0,0)'); vig.addColorStop(1, 'rgba(0,0,0,.6)');
  ctx.fillStyle = vig; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';

  drawTitleBox(ctx, { X0, X1, Y: 40, H: 136, LW: 190, big: 64, small: 19 }, logo, (ev || 'Deck Breakdown').toUpperCase(), `STAR WARS: UNLIMITED  ·  ${counts}`);

  // Chart
  const CY0 = 196, CH = 624;
  if (state.chart === 'treemap') await drawTreemap(ctx, groups, n, { X: X0 - 3, Y: CY0, W: X1 - X0 + 6, H: CH });
  else await drawRing(ctx, groups, n, { cx: W / 2, cy: CY0 + 296, r1: 290, r0: 160 }, logo, (ev || 'Meta Report').toUpperCase(), counts);

  // Two-column deck table
  const T0 = CY0 + CH + 52, T1 = H - 50, HEAD = 40, rh = 26, colW = (X1 - X0) / 2;
  const per = Math.floor((T1 - T0 - HEAD - 12) / rh);
  const list = groups.length > per * 2 ? [...groups.slice(0, per * 2 - 1), { label: `+${groups.length - per * 2 + 1} more decks`, more: true }] : groups;
  const rows = Math.ceil(list.length / 2), ncol = list.length > rows ? 2 : 1;
  const tEnd = T0 + HEAD + rows * rh + 12;
  ctx.strokeStyle = C.white; ctx.lineWidth = 3; ctx.strokeRect(X0, T0, X1 - X0, tEnd - T0);
  ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(X0, T0 + HEAD); ctx.lineTo(X1, T0 + HEAD);
  if (ncol > 1) { ctx.moveTo(X0 + colW, T0); ctx.lineTo(X0 + colW, tEnd); }
  ctx.stroke();
  for (let c = 0; c < ncol; c++) {
    const cx = X0 + c * colW;
    ctx.font = `700 18px ${D}`; ctx.fillStyle = C.white;
    ctx.textAlign = 'left'; ctx.fillText('DECK', cx + 52, T0 + 27);
    ctx.textAlign = 'center'; ctx.fillText('PLAYERS', cx + colW - 108, T0 + 27); ctx.fillText('SHARE', cx + colW - 40, T0 + 27);
  }
  list.forEach((g, i) => {
    const c = Math.floor(i / rows), r = i % rows, cx = X0 + c * colW, yy = T0 + HEAD + 6 + r * rh + rh * .74;
    if (!g.more) { ctx.font = `700 14px ${M}`; ctx.fillStyle = C.red; ctx.textAlign = 'left'; ctx.fillText(String(i + 1).padStart(2, '0'), cx + 16, yy - 1); }
    ctx.font = `700 20px ${D}`; ctx.fillStyle = g.more ? C.soft : C.white; ctx.textAlign = 'left';
    ctx.fillText(fit(ctx, g.label.toUpperCase(), colW - 200), cx + 52, yy);
    if (!g.more) { ctx.textAlign = 'center'; ctx.fillText(String(g.count), cx + colW - 108, yy); ctx.fillText(pct(g.count / n), cx + colW - 40, yy); }
  });

  ctx.textAlign = 'center'; ctx.font = `500 13px ${B}`; ctx.fillStyle = C.soft;
  ctx.fillText(FOOTNOTE, W / 2, H - 20);
  ctx.textAlign = 'left';
  return cv;
}


// ---------- shared pieces for the newer images ----------
const loadFonts = () => Promise.all(['italic 800 80px "Barlow Condensed"', '700 40px "Barlow Condensed"', '600 22px Barlow', '700 22px "JetBrains Mono"'].map(f => document.fonts.load(f).catch(() => {})));
function canvasFor() {
  const tall = state.format === 'tall', W = tall ? 1080 : 1920, H = tall ? 1350 : 1080;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  return { cv, ctx: cv.getContext('2d'), W, H, tall };
}
async function paintBackdrop(ctx, W, H, leader) {
  ctx.fillStyle = '#100506'; ctx.fillRect(0, 0, W, H);
  const bg = leader ? await leaderArt(leader) : null;
  if (bg) { ctx.save(); ctx.globalAlpha = .9; ctx.drawImage(blurred(bg, W, H), 0, 0, W, H); ctx.restore(); }
  ctx.save(); ctx.globalCompositeOperation = 'multiply'; ctx.fillStyle = '#b3070d'; ctx.fillRect(0, 0, W, H); ctx.restore();
  ctx.fillStyle = 'rgba(16,4,6,.8)'; ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'alphabetic';
}
async function titled(ctx, W, tall, sub) {
  const logo = await loadImg('bdst-logo.png');
  const ev = document.getElementById('evname').value.trim();
  drawTitleBox(ctx, tall ? { X0: 40, X1: W - 40, Y: 40, H: 136, LW: 190, big: 62, small: 19 } : { X0: 40, X1: W - 40, Y: 40, H: 140, LW: 220, big: 72, small: 21 },
    logo, (ev || 'Meta Report').toUpperCase(), sub);
}
function footer(ctx, W, H) {
  ctx.textAlign = 'right'; ctx.font = `500 14px ${FONTS.B}`; ctx.fillStyle = C.soft;
  ctx.fillText('Data: melee.gg  ·  Card art © Lucasfilm Ltd. & FFG via swu-db.com', W - 40, H - 18);
  ctx.textAlign = 'left';
}
function panelLabel(ctx, text, x, y) {
  ctx.font = `italic 800 28px ${FONTS.D}`; ctx.fillStyle = C.red; ctx.textAlign = 'left'; ctx.fillText(text.toUpperCase(), x, y);
}
// Leader art with a base strip underneath (base art, or the aspect colour for a colour group)
async function deckThumb(ctx, d, x, y, s, r = 8) {
  ctx.save(); rr(ctx, x, y, s, s, r); ctx.clip();
  if (!d) { ctx.fillStyle = 'rgba(255,255,255,.08)'; ctx.fillRect(x, y, s, s); ctx.restore(); return; }
  const strip = Math.max(6, Math.round(s * .16));
  const im = await leaderArt(d.leader);
  if (im) drawCover(ctx, im, x, y, s, s - strip, .2); else { ctx.fillStyle = '#3a0d10'; ctx.fillRect(x, y, s, s - strip); }
  const gi = genericInfo.get(d.base);
  if (gi) { ctx.fillStyle = C.asp[gi.aspect]; ctx.fillRect(x, y + s - strip, s, strip); }
  else {
    const bi = await baseArt(d.rawBase || d.base);
    ctx.save(); ctx.beginPath(); ctx.rect(x, y + s - strip, s, strip); ctx.clip();
    if (bi) drawCover(ctx, bi, x, y + s - strip, s, strip, .5); else { ctx.fillStyle = '#2a0a0c'; ctx.fillRect(x, y + s - strip, s, strip); }
    ctx.restore();
  }
  ctx.restore();
}
function chip(ctx, text, x, y, kind) {
  ctx.font = `700 15px ${FONTS.B}`;
  const w = ctx.measureText(text).width + 18, h = 26;
  ctx.fillStyle = kind === 'locked' ? C.red : kind === 'alive' ? 'rgba(255,255,255,.18)' : 'rgba(255,255,255,0)';
  rr(ctx, x - w, y - h / 2, w, h, 6); ctx.fill();
  if (kind === 'out') { ctx.strokeStyle = 'rgba(255,255,255,.3)'; ctx.lineWidth = 1.5; ctx.stroke(); }
  ctx.fillStyle = kind === 'out' ? C.soft : '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, x - w / 2, y + 1); ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  return w;
}
// One player row: rank, deck art, name + deck, record on the right
async function playerRow(ctx, p, x, y, w, h, { right = '', status = null, faded = false } = {}) {
  const { D, B, M } = FONTS;
  const d = deckOf(p);
  ctx.save(); if (faded) ctx.globalAlpha = .45;
  ctx.fillStyle = 'rgba(12,3,5,.88)'; rr(ctx, x, y, w, h, 10); ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1.5; ctx.stroke();
  ctx.font = `700 ${Math.round(h * .32)}px ${M}`; ctx.fillStyle = C.red; ctx.textAlign = 'right';
  if (p.rank) ctx.fillText(String(p.rank), x + 48, y + h / 2 + h * .11);
  const s = h - 12;
  await deckThumb(ctx, d, x + 58, y + 6, s);
  const tx = x + 58 + s + 14;
  let rightW = 0;
  if (status) rightW = chip(ctx, status.text, x + w - 14, y + h / 2, status.kind) + 14;
  if (right) { ctx.font = `700 ${Math.round(h * .3)}px ${M}`; ctx.fillStyle = C.white; ctx.textAlign = 'right'; ctx.fillText(right, x + w - 14 - rightW, y + h / 2 + h * .1); rightW += ctx.measureText(right).width + 18; }
  const tw = w - (tx - x) - rightW - 14;
  ctx.textAlign = 'left'; ctx.fillStyle = C.white;
  let fs = Math.round(h * .38); ctx.font = `italic 800 ${fs}px ${D}`;
  const nm = p.name.toUpperCase();
  while (fs > 14 && ctx.measureText(nm).width > tw) { fs--; ctx.font = `italic 800 ${fs}px ${D}`; }
  ctx.fillText(fit(ctx, nm, tw), tx, y + h * .47);
  ctx.font = `500 ${Math.round(h * .25)}px ${B}`; ctx.fillStyle = C.soft;
  ctx.fillText(fit(ctx, d ? d.label : 'No decklist', tw), tx, y + h * .8);
  ctx.restore();
}

// ---------- Top 8 race ----------
async function makeRaceImage() {
  const race = computeRace(); if (!race) return null;
  await loadFonts();
  const { cv, ctx, W, H, tall } = canvasFor();
  const rows = race.rows.slice().sort((a, b) => a.rank - b.rank).slice(0, 16);
  await paintBackdrop(ctx, W, H, deckOf(rows[0])?.leader);
  const sub = race.finished
    ? `STAR WARS: UNLIMITED  ·  FINAL TOP ${race.cut} AFTER ${race.round.toUpperCase()}`
    : `STAR WARS: UNLIMITED  ·  TOP ${race.cut} RACE AFTER ${race.round.toUpperCase()}  ·  ${race.left} ${race.left === 1 ? 'ROUND' : 'ROUNDS'} LEFT`;
  await titled(ctx, W, tall, sub);
  const label = r => ({ locked: race.finished ? 'TOP ' + race.cut : 'LOCKED', alive: 'ALIVE', out: 'OUT' }[r.status]);
  const draw = async (list, x, y, w, rh, gap) => {
    for (let i = 0; i < list.length; i++) {
      const r = list[i];
      await playerRow(ctx, r, x, y + i * (rh + gap), w, rh, { right: `${r.record}  ${r.points}P`, status: { text: label(r), kind: r.status }, faded: r.status === 'out' });
      if (r.rank === race.cut && !tall) {}
    }
  };
  if (tall) {
    const y0 = 206, rh = 58, gap = 6;
    await draw(rows, 40, y0, W - 80, rh, gap);
    const cutY = y0 + race.cut * (rh + gap) - gap / 2;
    ctx.setLineDash([12, 8]); ctx.strokeStyle = C.red; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(40, cutY); ctx.lineTo(W - 40, cutY); ctx.stroke(); ctx.setLineDash([]);
  } else {
    const y0 = 254, rh = 84, gap = 10, cw = (W - 80 - 30) / 2;
    panelLabel(ctx, `In the top ${race.cut} now`, 40, 236);
    panelLabel(ctx, 'Chasing the cut', 40 + cw + 30, 236);
    await draw(rows.slice(0, race.cut), 40, y0, cw, rh, gap);
    await draw(rows.slice(race.cut, race.cut * 2), 40 + cw + 30, y0, cw, rh, gap);
  }
  const sum = race.finished ? `${race.counts.locked} MADE THE CUT` : `${race.counts.locked} LOCKED  ·  ${race.counts.alive} ALIVE  ·  ${race.cut}TH PLACE ON ${race.line ?? '–'} POINTS`;
  ctx.font = `italic 800 22px ${FONTS.D}`; ctx.fillStyle = C.white; ctx.textAlign = 'left'; ctx.fillText(sum, 40, H - 22);
  footer(ctx, W, H);
  return cv;
}

// ---------- Round recap ----------
async function makeRecapImage() {
  const rc = computeRecap(); if (!rc) return null;
  await loadFonts();
  const { cv, ctx, W, H, tall } = canvasFor();
  const { D, B, M } = FONTS;
  const star = rc.deckOfRound;
  await paintBackdrop(ctx, W, H, star?.leader || deckOf(rc.undefeated[0])?.leader);
  await titled(ctx, W, tall, `STAR WARS: UNLIMITED  ·  ${rc.round.toUpperCase()} RECAP`);

  // Panels: undefeated (or results in the top cut), upsets, deck of the round
  const results = !rc.swiss ? (state.view.history.find(h => h.name === rc.round)?.matches || []).filter(m => m.players.length === 2 && m.hasResult) : [];
  const leftTitle = rc.swiss ? `Undefeated (${rc.undefeated.length})` : 'Results';
  const drawLeft = async (x, y, w, h) => {
    panelLabel(ctx, leftTitle, x, y);
    const rh = 70, gap = 8, max = Math.floor((h - 20) / (rh + gap));
    if (rc.swiss) {
      const list = rc.undefeated.sort((a, b) => a.rank - b.rank);
      if (!list.length) { ctx.font = `500 22px ${B}`; ctx.fillStyle = C.soft; ctx.fillText('Nobody is undefeated.', x, y + 50); }
      const shown = Math.min(list.length, max);
      for (let i = 0; i < shown; i++) await playerRow(ctx, list[i], x, y + 18 + i * (rh + gap), w, rh, { right: list[i].record });
      let yy = y + 18 + shown * (rh + gap);
      if (list.length > max) { ctx.font = `600 20px ${B}`; ctx.fillStyle = C.soft; ctx.fillText(`+${list.length - max} more`, x, yy + 20); yy += 34; }
      // Fill the rest with the top tables' results
      const th = 40, room = Math.floor((y + h - yy - 50) / (th + 6));
      if (room >= 2 && rc.tables.length) {
        panelLabel(ctx, 'Top tables', x, yy + 40);
        rc.tables.slice(0, room).forEach((m, i) => {
          const [p, q] = m.players, ty = yy + 56 + i * (th + 6);
          ctx.fillStyle = 'rgba(12,3,5,.88)'; rr(ctx, x, ty, w, th, 8); ctx.fill();
          ctx.font = `700 16px ${M}`; ctx.fillStyle = C.red; ctx.textAlign = 'left'; ctx.fillText(`T${m.table}`, x + 12, ty + 26);
          const mid = x + w / 2 + 14, nameW = w / 2 - 80;
          ctx.font = `700 19px ${D}`;
          ctx.fillStyle = p.gameWins >= q.gameWins ? C.white : C.soft; ctx.textAlign = 'right'; ctx.fillText(fit(ctx, p.name.toUpperCase(), nameW), mid - 34, ty + 26);
          ctx.fillStyle = q.gameWins >= p.gameWins ? C.white : C.soft; ctx.textAlign = 'left'; ctx.fillText(fit(ctx, q.name.toUpperCase(), nameW), mid + 34, ty + 26);
          ctx.font = `700 18px ${M}`; ctx.fillStyle = C.white; ctx.textAlign = 'center'; ctx.fillText(`${p.gameWins}-${q.gameWins}`, mid, ty + 26);
          ctx.textAlign = 'left';
        });
      }
    } else {
      for (let i = 0; i < Math.min(results.length, max); i++) {
        const m = results[i], [a, b] = m.players, [wn, ls] = a.gameWins > b.gameWins ? [a, b] : [b, a];
        await playerRow(ctx, { id: String(wn.playerId), name: wn.name, rank: null }, x, y + 18 + i * (rh + gap), w, rh, { right: `${wn.gameWins}-${ls.gameWins}` });
      }
    }
  };
  const drawUpsets = async (x, y, w, h) => {
    panelLabel(ctx, 'Upsets', x, y);
    if (!rc.upsets.length) { ctx.font = `500 22px ${B}`; ctx.fillStyle = C.soft; ctx.textAlign = 'left'; ctx.fillText(rc.swiss && state.view.prev ? 'No big upsets this round.' : 'Upsets show from round 2 on.', x, y + 50); return; }
    const ch = Math.min(150, (h - 20) / rc.upsets.length - 10);
    for (let i = 0; i < rc.upsets.length; i++) {
      const u = rc.upsets[i], cy = y + 18 + i * (ch + 10);
      ctx.fillStyle = 'rgba(12,3,5,.88)'; rr(ctx, x, cy, w, ch, 10); ctx.fill(); ctx.strokeStyle = 'rgba(255,255,255,.14)'; ctx.lineWidth = 1.5; ctx.stroke();
      const s = ch - 24, dw = deckOf(u.winner), dl = deckOf(u.loser);
      await deckThumb(ctx, dw, x + 12, cy + 12, s);
      ctx.save(); ctx.globalAlpha = .5; await deckThumb(ctx, dl, x + w - 12 - s, cy + 12, s); ctx.restore();
      const tx = x + 24 + s, tw = w - 2 * (s + 36);
      ctx.textAlign = 'center';
      ctx.font = `italic 800 ${Math.round(ch * .2)}px ${D}`; ctx.fillStyle = C.white; ctx.fillText(fit(ctx, u.winner.name.toUpperCase(), tw), tx + tw / 2, cy + ch * .34);
      ctx.font = `700 ${Math.round(ch * .15)}px ${M}`; ctx.fillStyle = C.red; ctx.fillText(`#${u.wr} beat #${u.lr}  ${u.score}`, tx + tw / 2, cy + ch * .58);
      ctx.font = `500 ${Math.round(ch * .13)}px ${B}`; ctx.fillStyle = C.soft; ctx.fillText(fit(ctx, `over ${u.loser.name}`, tw), tx + tw / 2, cy + ch * .82);
      ctx.textAlign = 'left';
    }
  };
  const drawStar = async (x, y, w, h) => {
    panelLabel(ctx, 'Deck of the round', x, y);
    if (!star) { ctx.font = `500 22px ${B}`; ctx.fillStyle = C.soft; ctx.fillText('Needs decklists.', x, y + 50); return; }
    const s = Math.min(w, h * .58);
    const im = await leaderArt(star.leader);
    ctx.save(); rr(ctx, x, y + 18, w, s, 12); ctx.clip(); if (im) drawCover(ctx, im, x, y + 18, w, s, .2); ctx.restore();
    ctx.strokeStyle = C.red; ctx.lineWidth = 4; rr(ctx, x, y + 18, w, s, 12); ctx.stroke();
    let fs = 44; ctx.font = `italic 800 ${fs}px ${D}`; const lb = star.label.toUpperCase();
    while (fs > 22 && ctx.measureText(lb).width > w) { fs -= 2; ctx.font = `italic 800 ${fs}px ${D}`; }
    ctx.fillStyle = C.white; ctx.textAlign = 'left'; ctx.fillText(fit(ctx, lb, w), x, y + 18 + s + 50);
    ctx.font = `700 26px ${M}`; ctx.fillStyle = C.red; ctx.fillText(`${star.w}-${star.l} THIS ROUND`, x, y + 18 + s + 88);
    const more = rc.decks.slice(1, 4);
    ctx.font = `500 19px ${B}`; ctx.fillStyle = C.soft;
    more.forEach((dk, i) => ctx.fillText(fit(ctx, `${dk.label}  ${dk.w}-${dk.l}`, w), x, y + 18 + s + 124 + i * 28));
  };
  if (tall) {
    await drawLeft(40, 236, W - 80, 430);
    await drawUpsets(40, 700, (W - 110) / 2, 560);
    await drawStar(40 + (W - 110) / 2 + 30, 700, (W - 110) / 2, 560);
  } else {
    const cw = (W - 80 - 60) / 3;
    await drawLeft(40, 240, cw, 780);
    await drawUpsets(40 + cw + 30, 240, cw, 780);
    await drawStar(40 + 2 * (cw + 30), 240, cw, 780);
  }
  footer(ctx, W, H);
  return cv;
}

// ---------- Feature match ----------
async function makeFeatureImage() {
  const fm = featureMatch(); if (!fm) return null;
  await loadFonts();
  const { cv, ctx, W, H, tall } = canvasFor();
  const { D, B, M } = FONTS;
  const standing = new Map(currentPlayers().map(p => [p.id, p]));
  const [a, b] = fm.match.players.map(p => ({ ...p, st: standing.get(p.id) }));
  const da = deckOf(a), db = deckOf(b);
  await paintBackdrop(ctx, W, H, da?.leader);
  await titled(ctx, W, tall, `STAR WARS: UNLIMITED  ·  ${fm.round.name.toUpperCase()}  ·  TABLE ${fm.match.table ?? ''}  ·  FEATURE MATCH`);
  const done = fm.match.hasResult;
  const side = async (p, d, x, y, w, h, alignRight) => {
    const lost = done && p.gameWins < (p === a ? b : a).gameWins;
    ctx.save(); if (lost) ctx.globalAlpha = .5;
    const artH = h - 150;
    ctx.save(); rr(ctx, x, y, w, artH, 14); ctx.clip();
    const im = d ? await leaderArt(d.leader) : null;
    if (im) drawCover(ctx, im, x, y, w, artH, .2); else { ctx.fillStyle = '#3a0d10'; ctx.fillRect(x, y, w, artH); }
    const g = ctx.createLinearGradient(0, y + artH * .55, 0, y + artH); g.addColorStop(0, 'rgba(10,3,4,0)'); g.addColorStop(1, 'rgba(10,3,4,.9)');
    ctx.fillStyle = g; ctx.fillRect(x, y, w, artH);
    ctx.restore();
    // Base strip
    const sy = y + artH + 8, sh = 22;
    ctx.save(); rr(ctx, x, sy, w, sh, 6); ctx.clip();
    const gi = d ? genericInfo.get(d.base) : null;
    if (gi) { ctx.fillStyle = C.asp[gi.aspect]; ctx.fillRect(x, sy, w, sh); }
    else { const bi = d ? await baseArt(d.rawBase || d.base) : null; if (bi) drawCover(ctx, bi, x, sy, w, sh, .5); else { ctx.fillStyle = '#2a0a0c'; ctx.fillRect(x, sy, w, sh); } }
    ctx.restore();
    ctx.strokeStyle = !lost && done ? C.red : 'rgba(255,255,255,.2)'; ctx.lineWidth = !lost && done ? 4 : 2; rr(ctx, x, y, w, artH, 14); ctx.stroke();
    ctx.textAlign = alignRight ? 'right' : 'left';
    const tx = alignRight ? x + w : x;
    let fs = tall ? 52 : 60; ctx.font = `italic 800 ${fs}px ${D}`;
    const nm = p.name.toUpperCase();
    while (fs > 26 && ctx.measureText(nm).width > w) { fs -= 2; ctx.font = `italic 800 ${fs}px ${D}`; }
    ctx.fillStyle = C.white; ctx.fillText(fit(ctx, nm, w), tx, y + artH - 22);
    ctx.font = `700 26px ${M}`; ctx.fillStyle = C.red;
    ctx.fillText(p.st ? `#${p.st.rank}  ·  ${p.st.record}` : '', tx, sy + sh + 40);
    ctx.font = `600 26px ${B}`; ctx.fillStyle = C.soft;
    ctx.fillText(fit(ctx, d ? d.label : 'No decklist', w), tx, sy + sh + 80);
    ctx.restore();
  };
  if (tall) {
    const h = (H - 236 - 70 - 60) / 2;
    await side(a, da, 40, 210, W - 80, h, false);
    await side(b, db, 40, 210 + h + 70, W - 80, h, true);
    const cy = 210 + h + 35;
    ctx.font = `italic 800 64px ${D}`; ctx.fillStyle = C.red; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(done ? `${a.gameWins} – ${b.gameWins}` : 'VS', W / 2, cy); ctx.textBaseline = 'alphabetic';
  } else {
    const w = (W - 80 - 220) / 2, h = 1080 - 210 - 60;
    await side(a, da, 40, 210, w, h, false);
    await side(b, db, W - 40 - w, 210, w, h, true);
    ctx.beginPath(); ctx.arc(W / 2, 210 + (h - 150) / 2, 92, 0, Math.PI * 2); ctx.fillStyle = 'rgba(10,3,5,.92)'; ctx.fill(); ctx.strokeStyle = C.red; ctx.lineWidth = 5; ctx.stroke();
    ctx.font = `italic 800 ${done ? 64 : 80}px ${D}`; ctx.fillStyle = C.white; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(done ? `${a.gameWins}–${b.gameWins}` : 'VS', W / 2, 210 + (h - 150) / 2 + 4); ctx.textBaseline = 'alphabetic';
  }
  footer(ctx, W, H);
  return cv;
}

// ---------- Team ----------
async function makeTeamImage() {
  const members = teamPlayers(); if (!members.length) return null;
  await loadFonts();
  const { cv, ctx, W, H, tall } = canvasFor();
  const tag = teamTag().toUpperCase();
  const sum = members.reduce((a, p) => { const r = rec(p.record); a.w += r.w; a.l += r.l; a.d += r.d; return a; }, { w: 0, l: 0, d: 0 });
  await paintBackdrop(ctx, W, H, deckOf(members[0])?.leader);
  const round = state.view?.round || '';
  await titled(ctx, W, tall, `TEAM ${tag}  ·  ${members.length} ${members.length === 1 ? 'PLAYER' : 'PLAYERS'}  ·  COMBINED ${sum.w}-${sum.l}${sum.d ? '-' + sum.d : ''}${round ? '  ·  AFTER ' + round.toUpperCase() : ''}`);
  const n = Math.min(members.length, 12);
  const cols = tall ? (n <= 4 ? 2 : n <= 8 ? 2 : 3) : (n <= 4 ? n : n <= 8 ? 4 : 6);
  const rows = Math.ceil(n / cols), gap = 20;
  const gx0 = 40, gy0 = tall ? 200 : 206, gx1 = W - 40, gy1 = H - 70;
  const cw = (gx1 - gx0 - gap * (cols - 1)) / cols, ch = (gy1 - gy0 - gap * (rows - 1)) / rows;
  for (let i = 0; i < n; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    const p = members[i];
    await drawPlayerCard(ctx, { ...p, rank: p.rank ?? '–' }, deckOf(p), gx0 + c * (cw + gap), gy0 + r * (ch + gap), cw, ch);
  }
  if (members.length > n) { ctx.font = `600 20px ${FONTS.B}`; ctx.fillStyle = C.soft; ctx.fillText(`+${members.length - n} more`, 40, H - 24); }
  footer(ctx, W, H);
  return cv;
}
