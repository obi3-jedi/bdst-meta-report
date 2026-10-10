# BDST Meta Report

A leader and base breakdown for Star Wars: Unlimited tournaments. Upload a melee.gg standings export (CSV or Excel) and the site shows:

- leader and base usage, win rates and top cut conversion, with card art
- a Decks view that treats each leader + base combination as one deck
- common bases named by colour (e.g. "Yoda Red", "Yoda Red Force", "Yoda Red Splash") since they're interchangeable, while rare bases like Data Vault keep their names
- aspect breakdown (Heroism vs Villainy, and each aspect's share of the field and top cut)
- the top cut
- round-by-round leader win rates (upload one standings export per round)
- every leader + base pairing
- BDST-branded images to share: a 1920×1080 standings graphic (framed table plus a ring of card art sized by share) for leaders, bases or decks, and a 1080×1350 summary for Instagram

Everything runs in the browser. Uploaded files never leave your computer.

## Files

- `index.html`: the whole app
- `cards.js`: leader and base names, aspects, art thumbnails and generic-base families from [swu-db.com](https://swu-db.com)
- `art/`: larger art crops, loaded only when an image is generated
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
