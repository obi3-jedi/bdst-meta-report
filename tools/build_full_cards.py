#!/usr/bin/env python3
"""Download full leader and base card images from swu-db.com (for the feature match overlay).

Run from the repo root on macOS after tools/build_cards.py (uses the built-in `sips`):
    python3 tools/build_full_cards.py
Files are named like cards.js keys:
  art/full/leaders/<key>.jpg, art/full/bases/<key>.jpg        the normal cards
  art/variant/leaders/<key>.jpg                               Showcase leaders
  art/variant/bases/<key>.jpg                                 Hyperspace bases
The overlay uses the variant when there is one and falls back to the normal card.
"""
import json, os, re, subprocess, tempfile, urllib.request
from concurrent.futures import ThreadPoolExecutor

API = "https://api.swu-db.com/cards/search?q=type:{}"
ROOT = os.path.join(os.path.dirname(__file__), "..")
# (folder, search suffix per kind)
SETS = [("full", {"leader": "", "base": ""}), ("variant", {"leader": "+variant:showcase", "base": "+variant:hyperspace"})]
norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())


def get_json(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)["data"]


def save(item, kind, tmp, out):
    key, url = item
    dest = os.path.join(out, kind + "s", key + ".jpg")
    if os.path.exists(dest):
        return key, "kept"
    raw = os.path.join(tmp, key + "." + kind + "." + os.path.basename(out))
    try:
        urllib.request.urlretrieve(url, raw)
        subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "74", "--resampleWidth", "520", raw, "--out", dest], check=True, capture_output=True)
        return key, "ok"
    except Exception as e:
        return key, f"failed: {e}"


with tempfile.TemporaryDirectory() as tmp:
    for folder, suffix in SETS:
        out = os.path.join(ROOT, "art", folder)
        for kind in ("leader", "base"):
            os.makedirs(os.path.join(out, kind + "s"), exist_ok=True)
            seen = {}
            for x in get_json(API.format(kind) + suffix[kind]):
                name = x["Name"] + (", " + x["Subtitle"] if kind == "leader" and x.get("Subtitle") else "")
                if norm(name) not in seen and x.get("FrontArt"):
                    seen[norm(name)] = x["FrontArt"]
            with ThreadPoolExecutor(8) as pool:
                res = list(pool.map(lambda it: save(it, kind, tmp, out), seen.items()))
            bad = [r for r in res if r[1].startswith("failed")]
            print(f"{folder} {kind}s: {len(res) - len(bad)} saved, {len(bad)} failed")
            for k, why in bad[:10]:
                print("  ", k, why)
