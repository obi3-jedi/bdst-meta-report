# BDST Meta Report

A deck breakdown for Star Wars: Unlimited tournaments. Upload a melee.gg standings export (CSV or Excel) and the site shows every deck (leader + base) with how many players ran it and its share of the field, plus a BDST-branded 1920×1080 graphic to share.

Common bases are named by colour since they're interchangeable: "Yoda Red" is Yoda on any plain 30 HP Aggression base, "Yoda Red Force" on any Aggression Force base. Rare bases like Data Vault keep their names.

The fuller report (leader and base boards, aspects, top cut, round-by-round, pairings and win rates) is saved at the `full-report-v1` git tag, ready to bring back.

Everything runs in the browser. Uploaded files never leave your computer.

## Following a live tournament

Paste a melee.gg tournament link into **Follow live** and press **Follow**, then press **Refresh** after each round. Upload the tournament's standings CSV once: melee.gg hides decklists publicly during an event, so decks come from the CSV and are matched to live standings by player ID. The site remembers the decklists and the followed tournament in your browser. A link like `?t=457640` opens straight into a tournament.

Click a player's name in **Standings** to see their match history: each round's opponent, the opponent's deck and the result, with new rounds added as you refresh.

While following, a **Top 8** bracket shows on the page: projected from the current Swiss standings (1v8, 4v5, 2v7, 3v6), then filled in with real pairings, scores and the champion as the cut is played. **Make bracket image** turns it into a 1920×1080 graphic. The **Current top 8** image shows the eight highest-ranked players still in the event after the latest completed round, with record, points and deck, in 16:9 or 4:5.

melee.gg doesn't let other websites read its data from the browser, so live standings come through a small Cloudflare Worker in `worker/` (https://bdst-melee-relay.bdst.workers.dev). It only answers `/tournament/<id>`, `/standings/<roundId>` and `/matches/<roundId>`, and only for this site. To redeploy it after a change:

```bash
cd worker && npx wrangler@3.114.0 deploy
```

## Files

- `index.html`: the whole app
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
