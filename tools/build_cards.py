#!/usr/bin/env python3
"""Rebuild cards.js (leader/base names, aspects and art thumbnails) and art/ from swu-db.com.

Run from the repo root on macOS (uses the built-in `sips` to crop images):
    python3 tools/build_cards.py
"""
import base64, json, os, re, subprocess, tempfile, urllib.request
from concurrent.futures import ThreadPoolExecutor

API = "https://api.swu-db.com/cards/search?q=type:{}"
ROOT = os.path.join(os.path.dirname(__file__), "..")
OUT = os.path.join(ROOT, "cards.js")
ART = os.path.join(ROOT, "art")
norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())


def get_json(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)["data"]


def sips(*args):
    subprocess.run(["sips", *args], check=True, capture_output=True)


def crop_art(url, kind, tmp, key):
    """Download a card image and crop its art twice.

    Returns a small data-URI thumbnail (a square portrait for leaders, a wide strip for bases) for the
    page, and writes a larger crop to art/<kind>s/<key>.jpg for the shareable image.
    """
    raw = os.path.join(tmp, key + "." + kind + ".src")
    small = os.path.join(tmp, key + "." + kind + ".jpg")
    big = os.path.join(ART, kind + "s", key + ".jpg")
    urllib.request.urlretrieve(url, raw)
    sips("-s", "format", "jpeg", "--resampleWidth", "600", raw, "--out", small)
    sips("-s", "format", "jpeg", "--resampleWidth", "1200", raw, "--out", big)
    if kind == "leader":
        sips("-c", "215", "215", "--cropOffset", "45", "52", small)
        sips("-Z", "112", "-s", "formatOptions", "72", small)
        sips("-c", "600", "446", "--cropOffset", "84", "92", big)
        sips("--resampleWidth", "420", "-s", "formatOptions", "70", big)
    else:
        sips("-c", "190", "506", "--cropOffset", "78", "47", small)
        sips("-Z", "280", "-s", "formatOptions", "70", small)
        sips("-c", "376", "1008", "--cropOffset", "158", "96", big)
        sips("--resampleWidth", "760", "-s", "formatOptions", "70", big)
    with open(small, "rb") as f:
        return "data:image/jpeg;base64," + base64.b64encode(f.read()).decode()


def generic_family(x):
    """Common bases are interchangeable within a colour, so the site can group them.

    Returns the family name ("30 HP", "Force", "Splash") or None for named rare/special bases.
    """
    if x.get("Rarity") != "Common":
        return None
    text = x.get("FrontText") or ""
    if not text:
        return f"{x.get('HP')} HP"
    if "The Force is with you" in text:
        return "Force"
    if "ignoring 1 of its" in text:
        return "Splash"
    return None


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
            fam = generic_family(x)
            if fam:
                e["g"] = fam
        try:
            if x.get("FrontArt"):
                e["i"] = crop_art(x["FrontArt"], kind, tmp, key)
                e["h"] = f"art/{kind}s/{key}.jpg"
        except Exception as err:
            print(f"  no art for {name}: {err}")
        return key, e

    with ThreadPoolExecutor(12) as pool:
        return dict(pool.map(make, entries.items()))


for sub in ("leaders", "bases"):
    os.makedirs(os.path.join(ART, sub), exist_ok=True)

with tempfile.TemporaryDirectory() as tmp:
    data = {"leaders": build("leader", tmp), "bases": build("base", tmp)}

with open(OUT, "w") as f:
    f.write("// Leader and base data from swu-db.com (card art © Lucasfilm / Fantasy Flight Games)\n")
    f.write("window.SWU_CARDS=" + json.dumps(data, separators=(",", ":")) + ";\n")
print(f"{len(data['leaders'])} leaders, {len(data['bases'])} bases -> cards.js")
