# BDST Meta Report

A deck breakdown for Star Wars: Unlimited tournaments. Upload a melee.gg standings export (CSV or Excel) and the site shows every deck (leader + base) with how many players ran it and its share of the field, plus a BDST-branded 1920×1080 graphic to share.

Common bases are named by colour since they're interchangeable: "Yoda Red" is Yoda on any plain 30 HP Aggression base, "Yoda Red Force" on any Aggression Force base. Rare bases like Data Vault keep their names.

The fuller report (leader and base boards, aspects, top cut, round-by-round, pairings and win rates) is saved at the `full-report-v1` git tag, ready to bring back.

Everything runs in the browser. Uploaded files never leave your computer.

## Files

- `index.html`: the whole app
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
