#!/usr/bin/env python3
"""tools/sentences/*.txt（漢字|熟語|読み|例文）をチェックする"""
import glob, json, os, re, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
s = open(os.path.join(ROOT, "kanji_words.js"), encoding="utf-8").read()
d = json.loads(s[s.index("=") + 1:s.rindex(";")])
cand = {k: {v[0].replace("＿", k): v[1] for v in vs} for k, lv, vs in d}
seen = {}; bad = 0; custom = []
files = sys.argv[1:] or sorted(glob.glob(os.path.join(ROOT, "tools/sentences/s*.txt")))
for f in files:
    for n, line in enumerate(open(f, encoding="utf-8"), 1):
        line = line.rstrip("\n")
        if not line: continue
        p = line.split("|")
        if len(p) != 4: print(f, n, "列数", line); bad += 1; continue
        k, w, r, t = p
        err = []
        if k not in cand: err.append("出題外の字")
        if k not in w: err.append("熟語に字がない")
        if t.count(w) != 1: err.append("例文に熟語が1回でない")
        if not re.fullmatch(r"[ぁ-ゖー]+", r): err.append("読みがひらがなでない")
        if len(t) > 30: err.append("長い")
        if k in seen: err.append("重複")
        if err: print(os.path.basename(f), n, k, w, "→", "・".join(err)); bad += 1
        seen[k] = 1
        if k in cand and w not in cand[k]: custom.append(f"{k}:{w}({r})")
        elif k in cand and cand[k][w] != r: print(os.path.basename(f), n, k, w, "読みが辞書と違う", r, "≠", cand[k][w]); bad += 1
print("lines", len(seen), "errors", bad, "custom", len(custom)); print(" ".join(custom))
