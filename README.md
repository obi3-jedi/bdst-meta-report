# BDST Meta Report

A tournament assistant for Star Wars: Unlimited, built on melee.gg. Follow an event live (or upload a standings export) and get:

- **Decks**: deck, leader and base breakdowns with optional win rates, plus aspects
- **Pairings**: every round's pairings with both decks, feature tables and a feature-match image
- **Standings**: live standings; click any player for their match history
- **Top 8**: the top 8 race (locked / alive / out on points) and the live bracket
- **Matchups**: deck-vs-deck records for the event
- **Team**: follow your own players by name tag (e.g. BDST)
- **Season**: deck trends across events saved to the archive
- **Stream**: transparent overlays for OBS (standings, feature match, bracket, decks)
- **Images**: deck breakdown, top 8 standings, top 8 race, bracket, round recap, feature match and team, in 16:9 or 4:5

You can replay any finished event round by round, turn on auto-refresh, and install the site on your phone.

Everything runs in the browser. Uploaded files stay on your device unless an organiser chooses to share decklists.

## Following a live tournament

Paste a melee.gg tournament link into **Follow live** and press **Follow**, then press **Refresh** after each round. Upload the tournament's standings CSV once: melee.gg hides decklists publicly during an event, so decks come from the CSV and are matched to live standings by player ID. The site remembers the decklists and the followed tournament in your browser. A link like `?t=457640` opens straight into a tournament.

Click a player's name in **Standings** to see their match history: each round's opponent, the opponent's deck and the result, with new rounds added as you refresh.

While following, a **Top 8** bracket shows on the page: projected from the current Swiss standings (1v8, 4v5, 2v7, 3v6), then filled in with real pairings, scores and the champion as the cut is played. **Make bracket image** turns it into a 1920×1080 graphic. The **Current top 8** image shows the eight highest-ranked players still in the event after the latest completed round, with record, points and deck, in 16:9 or 4:5.

melee.gg doesn't let other websites read its data from the browser, so live standings come through a small Cloudflare Worker in `worker/` (https://bdst-melee-relay.bdst.workers.dev). It only answers `/tournament/<id>`, `/standings/<roundId>` and `/matches/<roundId>`, and only for this site. To redeploy it after a change:

```bash
cd worker && npx wrangler@3.114.0 deploy
```

## Organiser tools

Under **Follow live → Organiser tools**, the organiser passcode unlocks sharing decklists (so viewers don't need the CSV) and saving events to the season archive. Shared data lives in Cloudflare Workers KV behind the relay.

## Staging

New features are tested at https://bdst-meta-staging.pages.dev before going live. It uses its own relay (`bdst-melee-relay-staging`) and storage.

```bash
cd worker && npx wrangler@3.114.0 deploy --env staging
```

## Files

- `index.html`, `css/app.css`: page and styles
- `js/core.js`: cards, parsing and deck grouping
- `js/data.js`: live data, replay, race, matchups, recap, sharing and archive
- `js/ui.js`: tabs, screens and controls
- `js/images.js`: all shareable images
- `js/overlay.js`: stream overlays
- `sw.js`, `manifest.webmanifest`, `icons/`: installable app
- `worker/`: the Cloudflare Worker that relays live standings from melee.gg
- `cards.js`: leader and base names, aspects, art thumbnails and generic-base families from [swu-db.com](https://swu-db.com)
- `art/`: larger leader art, loaded only when an image is generated
- `bdst-logo.png`, `bdst-icon.png`: branding
- `tools/build_cards.py`: rebuilds `cards.js` and `art/` when new sets release

## Updating card data

On a Mac:

```bash
python3 tools/build_cards.py
git add -A && git commit -m "Update card data" && git push
```

GitHub Pages redeploys automatically after the push.

Card art © Lucasfilm Ltd. and Fantasy Flight Games. This is an unofficial fan tool.
