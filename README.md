# BDST Meta Report

A leader and base breakdown for Star Wars: Unlimited tournaments. Upload a melee.gg standings export (CSV or Excel) and the site shows:

- leader and base usage, win rates and top cut conversion, with card art
- aspect breakdown (Heroism vs Villainy, and each aspect's share of the field and top cut)
- the top cut
- round-by-round leader win rates (upload one standings export per round)
- every leader + base pairing
- a 1080×1350 image to share on Instagram or Discord

Everything runs in the browser. Uploaded files never leave your computer.

## Files

- `index.html`: the whole app
- `cards.js`: leader and base names, aspects and art thumbnails from [swu-db.com](https://swu-db.com)
- `tools/build_cards.py`: rebuilds `cards.js` when new sets release

## Updating card data

On a Mac:

```bash
python3 tools/build_cards.py
git commit -am "Update card data" && git push
```

GitHub Pages redeploys automatically after the push.

Card art © Lucasfilm Ltd. and Fantasy Flight Games. This is an unofficial fan tool.
