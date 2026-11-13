#!/usr/bin/env python3
"""常用漢字の出題データ（kanji_words.js）を作る。
- KANJIDIC2: 常用漢字2136字と学年 → 漢検の級（1年=10級 … 6年=5級、中学以上=4〜2級）
- JMdict: 頻出語（news1/ichi1/spec1）から、その漢字を含む熟語と読みを選ぶ
出典: KANJIDIC2 / JMdict (EDRDG, CC BY-SA 4.0) https://www.edrdg.org/
"""
import gzip, os, re, json, collections, xml.etree.ElementTree as ET
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
T = os.path.join(ROOT, "tools")
LEVEL = {1: "10", 2: "9", 3: "8", 4: "7", 5: "6", 6: "5", 8: "4-2"}
MAXW = 4  # 1字あたりの熟語数

def is_kanji(c): return '㐀' <= c <= '鿿' or c == '々'
def kata2hira(s): return "".join(chr(ord(c) - 0x60) if 'ァ' <= c <= 'ヶ' else c for c in s)

kd = ET.parse(gzip.open(os.path.join(T, "kanjidic2.xml.gz"))).getroot()
joyo = {}
for c in kd.iter('character'):
    gr = c.findtext('misc/grade')
    if gr and int(gr) <= 8: joyo[c.findtext('literal')] = int(gr)
assert len(joyo) == 2136, len(joyo)

# JMdict を読む（内部DTDの実体参照は expat が展開する）
jm = ET.parse(gzip.open(os.path.join(T, "JMdict_e.gz"))).getroot()
BAD_K = {"&ateji;", "ateji", "iK", "ik", "oK", "rK", "sK", "word containing irregular kanji usage", "word containing out-dated kanji or kanji usage",
         "rarely used kanji form", "search-only kanji form", "irregular okurigana usage", "word containing irregular kana usage"}
words = []  # (keb, reb, score)
readings = collections.defaultdict(set)  # 表記 → 読み（例文の読みチェック用）
for e in jm.iter('entry'):
    rels = [(r.findtext('reb'), [p.text for p in r.findall('re_pri')], [x.text for x in r.findall('re_restr')], r.find('re_nokanji') is not None) for r in e.findall('r_ele')]
    # 古語・俗語などは除く
    misc = {m.text for s in e.findall('sense') for m in s.findall('misc')}
    gloss = " ".join(g.text or "" for g in e.iter('gloss')).lower()
    # 通勤中に出てきて気まずい語は除く
    if re.search(r"prostitut|obscen|lewd|sexual|semen|pornograph|brothel|indecen|lust", gloss): continue
    if any(x and ("archaic" in x or "vulgar" in x or "obsolete" in x or "rare term" in x or "derogatory" in x) for x in misc) and len(e.findall('sense')) == 1: continue
    for k in e.findall('k_ele'):
        keb = k.findtext('keb'); pri = [p.text for p in k.findall('ke_pri')]
        inf = {i.text for i in k.findall('ke_inf')}
        for rb, rp, restr, nok in rels:
            if not nok and (not restr or keb in restr): readings[keb].add(kata2hira(rb))
        if inf & BAD_K: continue
        if not all(is_kanji(c) or 'ぁ' <= c <= 'ゟ' for c in keb): continue  # 漢字とひらがなだけ
        if not any(c in joyo for c in keb): continue
        if any(is_kanji(c) and c != '々' and c not in joyo for c in keb): continue  # 表外字を含む語は使わない
        if len(keb) > 4: continue
        # 読み：この表記に使える最初の頻出読み
        reb = None
        for rb, rp, restr, nok in rels:
            if nok or (restr and keb not in restr): continue
            reb = rb; break
        if not reb: continue
        score = 0
        for p in pri:
            if p.startswith("nf"): score += 60 - int(p[2:])  # nf01 が最頻出
            elif p in ("news1", "ichi1", "spec1"): score += 30
            elif p in ("news2", "ichi2", "spec2"): score += 8
        words.append((keb, kata2hira(reb), score, bool(pri)))

# 同じ読み・同じ形（対象字の位置を伏せた形）で別の常用漢字が入る語があれば、答えが割れるので使わない
pattern = collections.defaultdict(set)
for keb, reb, sc, hp in words:
    for i, c in enumerate(keb):
        if c in joyo: pattern[(keb[:i] + "＿" + keb[i + 1:], reb)].add(c)

by = collections.defaultdict(list)
seen = set()
for keb, reb, sc, hp in sorted(words, key=lambda w: -w[2]):
    for i, c in enumerate(keb):
        if c not in joyo or c == '々': continue
        masked = keb[:i] + "＿" + keb[i + 1:]
        if len(pattern[(masked, reb)]) > 1: continue
        if keb.count(c) > 1: continue
        if (c, keb) in seen: continue
        kana = sum(1 for x in keb if not is_kanji(x))
        # 2〜3字の熟語、または送り仮名つきの語を優先
        bonus = 10 if (kana == 0 and 2 <= len(keb) <= 3) else (4 if kana else 0)
        if len(keb) == 1: bonus = -15     # 1字だけの語は文脈が少ないので最後の手段
        if not hp: bonus -= 100          # 頻出語の印がない語は、ほかにないときだけ
        by[c].append((sc + bonus, masked, reb, keb))
        seen.add((c, keb))

# 例文（tools/sentences/*.txt: 漢字|熟語|読み|例文）を読み込み、答えが割れないか・読みが辞書と合うかを確かめる
import glob
sent, warn = {}, []
for f in sorted(glob.glob(os.path.join(T, "sentences", "s*.txt"))):
    for line in open(f, encoding="utf-8"):
        p = line.rstrip("\n").split("|")
        if len(p) != 4: continue
        k, w, r, t = p
        i = w.index(k); masked = w[:i] + "＿" + w[i + 1:]
        others = pattern.get((masked, r), set()) - {k}
        # 熟語だけでは割れても、例文の文脈で決まるので採用する（確認用に表示だけする）
        if others: warn.append(f"熟語だけだと割れる（例文で判別） {k}:{w}({r}) ほかに {''.join(sorted(others))}")
        if w in readings and r not in readings[w]: warn.append(f"読みが辞書と違う {k}:{w}({r}) 辞書:{'/'.join(sorted(readings[w]))}")
        sent[k] = [masked, r, t.replace(w, "{" + masked + "}", 1)]
for x in warn: print("!", x)

out, missing = [], []
for c, gr in joyo.items():
    allc = sorted(by.get(c, []), key=lambda x: -x[0])
    good = [x for x in allc if x[0] > -50]
    cand = (good or allc[:2])[:MAXW]
    vs = [[m, r] for _, m, r, _ in cand]
    if c in sent:  # 例文つきの熟語を先頭に（同じ熟語が候補にあれば置き換える）
        vs = [sent[c]] + [v for v in vs if v[0] != sent[c][0]]
    if not vs: missing.append(c); continue
    out.append([c, LEVEL[gr], vs[:MAXW]])
with open(os.path.join(ROOT, "kanji_words.js"), "w", encoding="utf-8") as f:
    f.write("// 常用漢字の出題データ。KANJIDIC2 / JMdict (EDRDG, CC BY-SA 4.0) から tools/build_kanji_words.py で自動生成\n")
    f.write("// [漢字, 漢検の級, [[熟語(対象字を＿), 読み, 例文({熟語}の位置)?], ...]]  例文は tools/sentences/ に手書き\n")
    f.write("window.KAKITORI_KANJI=" + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n")
print("kanji with words:", len(out), "with sentence:", sum(1 for x in out if len(x[2][0]) > 2), "missing:", len(missing), "".join(missing))
print("levels:", collections.Counter(x[1] for x in out))
print("size:", os.path.getsize(os.path.join(ROOT, "kanji_words.js")))
