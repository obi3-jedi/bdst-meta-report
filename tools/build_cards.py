#!/usr/bin/env python3
"""Rebuild cards.js (leader/base names, aspects and art thumbnails) from swu-db.com.

Run from the repo root on macOS (uses the built-in `sips` to crop images):
    python3 tools/build_cards.py
"""
import base64, json, os, re, subprocess, tempfile, urllib.request
from concurrent.futures import ThreadPoolExecutor

API = "https://api.swu-db.com/cards/search?q=type:{}"
OUT = os.path.join(os.path.dirname(__file__), "..", "cards.js")
norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())


def get_json(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)["data"]


def sips(*args):
    subprocess.run(["sips", *args], check=True, capture_output=True)


def thumb(url, kind, tmp):
    """Download a card image and crop the art: a square portrait for leaders, a wide strip for bases."""
    raw = os.path.join(tmp, norm(url) + ".src")
    out = os.path.join(tmp, norm(url) + ".jpg")
    urllib.request.urlretrieve(url, raw)
    sips("-s", "format", "jpeg", "--resampleWidth", "600", raw, "--out", out)
    if kind == "leader":
        sips("-c", "215", "215", "--cropOffset", "45", "52", out)
        sips("-Z", "112", "-s", "formatOptions", "72", out)
    else:
        sips("-c", "190", "506", "--cropOffset", "78", "47", out)
        sips("-Z", "280", "-s", "formatOptions", "70", out)
    with open(out, "rb") as f:
        return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()


def build(kind, tmp):
    entries = {}
    for x in get_json(API.format(kind)):
        name = x["Name"] + (", " + x["Subtitle"] if kind == "leader" and x.get("Subtitle") else "")
        if norm(name) not in entries:
            entries[norm(name)] = (name, x)

    def make(item):
        key, (name, x) = item
        e = {"n": name, "a": x.get("Aspects") or [], "i": ""}
        if kind == "base":
            e["hp"] = x.get("HP")
        try:
            if x.get("FrontArt"):
                e["i"] = thumb(x["FrontArt"], kind, tmp)
        except Exception as err:
            print(f"  no art for {name}: {err}")
        return key, e

    with ThreadPoolExecutor(12) as pool:
        return dict(pool.map(make, entries.items()))


with tempfile.TemporaryDirectory() as tmp:
    data = {"leaders": build("leader", tmp), "bases": build("base", tmp)}

with open(OUT, "w") as f:
    f.write("// Leader and base data from swu-db.com (card art © Lucasfilm / Fantasy Flight Games)\n")
    f.write("window.SWU_CARDS=" + json.dumps(data, separators=(",", ":")) + ";\n")
print(f"{len(data['leaders'])} leaders, {len(data['bases'])} bases -> cards.js")
