#!/usr/bin/env python3
"""Add which set(s) each leader and base is printed in to cards.js, plus the names of the main sets.

Run from the repo root after tools/build_cards.py:
    python3 tools/add_card_sets.py
Each card gets "s": ["HMW", ...]; cards.js gets "sets": {"HMW": {"n": "Homeworlds", "d": "2026-..."}}.
Limited events use this to offer only that set's leaders and bases.
"""
import json, os, re, urllib.request
from datetime import datetime

ROOT = os.path.join(os.path.dirname(__file__), "..")
CARDS = os.path.join(ROOT, "cards.js")
norm = lambda s: re.sub(r"[^a-z0-9]", "", s.lower())


def get(url):
    with urllib.request.urlopen(url, timeout=60) as r:
        return json.load(r)


src = open(CARDS, encoding="utf-8").read()
head, _, rest = src.partition("window.SWU_CARDS=")
data = json.loads(rest.rstrip().rstrip(";"))

for kind in ("leader", "base"):
    sets = {}
    for x in get(f"https://api.swu-db.com/cards/search?q=type:{kind}")["data"]:
        name = x["Name"] + (", " + x["Subtitle"] if kind == "leader" and x.get("Subtitle") else "")
        sets.setdefault(norm(name), set()).add(x["Set"])
    for key, e in data[kind + "s"].items():
        e["s"] = sorted(sets.get(key, []))

used = {s for k in ("leaders", "bases") for e in data[k].values() for s in e.get("s", [])}
names = {}
for s in get("https://api.swu-db.com/sets"):
    if s.get("setId") in used and s.get("isBaseSet"):
        d = s.get("releaseDate") or ""
        try: d = datetime.strptime(d, "%m/%d/%y").strftime("%Y-%m-%d")
        except ValueError: pass
        names[s["setId"]] = {"n": s["fullName"], "d": d}
data["sets"] = names

with open(CARDS, "w", encoding="utf-8") as f:
    f.write(head + "window.SWU_CARDS=" + json.dumps(data, separators=(",", ":")) + ";\n")
print({k: v["n"] for k, v in sorted(names.items(), key=lambda kv: kv[1]["d"])})
print("cards without a set:", [e["n"] for k in ("leaders", "bases") for e in data[k].values() if not e.get("s")])
