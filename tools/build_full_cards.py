#!/usr/bin/env python3
"""Download full leader and base card images from swu-db.com into art/full/ (for the feature match overlay).

Run from the repo root on macOS after tools/build_cards.py (uses the built-in `sips`):
    python3 tools/build_full_cards.py
Files are named like cards.js keys: art/full/leaders/<key>.jpg, art/full/bases/<key>.jpg.
"""
import json, os, re, subprocess, tempfile, urllib.request
from concurrent.futures import ThreadPoolExecutor

API = "https://api.swu-db.com/cards/search?q=type:{}"
ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "art", "full")
norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())


def get_json(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)["data"]


def save(item, kind, tmp):
    key, url = item
    dest = os.path.join(OUT, kind + "s", key + ".jpg")
    if os.path.exists(dest):
        return key, "kept"
    raw = os.path.join(tmp, key + "." + kind)
    try:
        urllib.request.urlretrieve(url, raw)
        subprocess.run(["sips", "-s", "format", "jpeg", "-s", "formatOptions", "74", "--resampleWidth", "520", raw, "--out", dest], check=True, capture_output=True)
        return key, "ok"
    except Exception as e:
        return key, f"failed: {e}"


with tempfile.TemporaryDirectory() as tmp:
    for kind in ("leader", "base"):
        os.makedirs(os.path.join(OUT, kind + "s"), exist_ok=True)
        seen = {}
        for x in get_json(API.format(kind)):
            name = x["Name"] + (", " + x["Subtitle"] if kind == "leader" and x.get("Subtitle") else "")
            if norm(name) not in seen and x.get("FrontArt"):
                seen[norm(name)] = x["FrontArt"]
        with ThreadPoolExecutor(8) as pool:
            res = list(pool.map(lambda it: save(it, kind, tmp), seen.items()))
        bad = [r for r in res if r[1].startswith("failed")]
        print(f"{kind}s: {len(res) - len(bad)} saved, {len(bad)} failed")
        for k, why in bad[:10]:
            print("  ", k, why)
