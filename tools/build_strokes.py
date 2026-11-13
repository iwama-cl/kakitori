#!/usr/bin/env python3
"""index.html の出題語に出てくる漢字の書き順データを KanjiVG から取り出して strokes.js を作る。
使い方: python3 tools/build_strokes.py
データ出典: KanjiVG (https://kanjivg.tagaini.net) CC BY-SA 3.0, Ulrich Apel
"""
import gzip, re, json, math, os, xml.etree.ElementTree as ET
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "tools", "kanjivg-20260714.xml.gz")
N = 20  # 1画あたりの点の数
# 座標は 0〜1 を90段階にして、1文字の記号で表す（\ と | を除いた ASCII 35〜126）
ALPHA = "".join(chr(c) for c in range(35, 127) if chr(c) not in "\\|")
assert len(ALPHA) == 90
def enc(v): return ALPHA[max(0, min(89, round(v * 89)))]

def words_kanji():
    s = open(os.path.join(ROOT, "index.html"), encoding="utf-8").read()
    a = s.index("const W = ["); b = s.index("];", a)
    chars = {c for m in re.findall(r'"([^"]+)"\]', s[a:b]) for c in m if '\u3400' <= c <= '\u9fff'}
    kw = os.path.join(ROOT, "kanji_words.js")  # 常用漢字モードの出題字
    if os.path.exists(kw):
        t = open(kw, encoding="utf-8").read()
        chars |= {x[0] for x in json.loads(t[t.index("=") + 1:t.rindex(";")])}
    return sorted(chars)

def parse_path(d):
    toks = re.findall(r'[MmCcSsLlZzHhVv]|-?\d*\.?\d+(?:e-?\d+)?', d)
    pts, i, cmd = [], 0, None
    cur = (0.0, 0.0); start = cur; last_c2 = None
    def num():
        nonlocal i; v = float(toks[i]); i += 1; return v
    def bez(p0, p1, p2, p3, n=12):
        return [tuple((1-t)**3*p0[k] + 3*(1-t)**2*t*p1[k] + 3*(1-t)*t*t*p2[k] + t**3*p3[k] for k in (0, 1)) for t in [j/n for j in range(1, n+1)]]
    while i < len(toks):
        if re.match(r'[A-Za-z]', toks[i]): cmd = toks[i]; i += 1
        rel = cmd.islower(); c = cmd.upper()
        ox, oy = cur if rel else (0, 0)
        if c == 'M':
            cur = (num()+ox, num()+oy); start = cur; pts.append(cur); cmd = 'l' if rel else 'L'; last_c2 = None
        elif c == 'L':
            cur = (num()+ox, num()+oy); pts.append(cur); last_c2 = None
        elif c == 'H':
            cur = (num()+(cur[0] if rel else 0), cur[1]); pts.append(cur)
        elif c == 'V':
            cur = (cur[0], num()+(cur[1] if rel else 0)); pts.append(cur)
        elif c == 'C':
            p1 = (num()+ox, num()+oy); p2 = (num()+ox, num()+oy); p3 = (num()+ox, num()+oy)
            pts += bez(cur, p1, p2, p3); last_c2 = p2; cur = p3
        elif c == 'S':
            p1 = (2*cur[0]-last_c2[0], 2*cur[1]-last_c2[1]) if last_c2 else cur
            p2 = (num()+ox, num()+oy); p3 = (num()+ox, num()+oy)
            pts += bez(cur, p1, p2, p3); last_c2 = p2; cur = p3
        elif c == 'Z':
            cur = start; pts.append(cur)
    return pts

def resample(pts, n=N):
    if len(pts) < 2: return [pts[0]] * n
    d = [0.0]
    for a, b in zip(pts, pts[1:]): d.append(d[-1] + math.dist(a, b))
    L = d[-1] or 1e-6; out = []; j = 0
    for k in range(n):
        t = L * k / (n-1)
        while j < len(d)-2 and d[j+1] < t: j += 1
        seg = (d[j+1]-d[j]) or 1e-6; u = (t-d[j])/seg
        out.append((pts[j][0]+(pts[j+1][0]-pts[j][0])*u, pts[j][1]+(pts[j+1][1]-pts[j][1])*u))
    return out

def main():
    import sys
    want = set(words_kanji())
    out = os.path.join(ROOT, "strokes.js")
    if len(sys.argv) > 2: want |= set(sys.argv[1]); out = sys.argv[2]  # テスト用: 追加の字と出力先
    xml = gzip.open(SRC, "rt", encoding="utf-8").read()
    xml = re.sub(r'<!DOCTYPE.*?\]>', '', xml, flags=re.S)
    root = ET.fromstring(xml)
    K = '{http://kanjivg.tagaini.net}'
    data = {}
    for kj in root.iter('kanji'):
        cid = kj.get('id', '')
        if not re.match(r'kvg:kanji_[0-9a-f]{5,6}$', cid): continue
        ch = chr(int(cid.split('_')[1], 16))
        if ch not in want: continue
        top = kj.find('g')
        comps = [c for c in top if c.tag == 'g'] or [top]
        strokes = []
        def walk(node, comp):
            for c in node:
                if c.tag == 'path':
                    m = re.search(r'-s(\d+)$', c.get('id'))
                    strokes.append((int(m.group(1)), comp, resample(parse_path(c.get('d')))))
                elif c.tag == 'g': walk(c, comp)
        for ci, c in enumerate(comps):
            if c.tag == 'path':
                m = re.search(r'-s(\d+)$', c.get('id')); strokes.append((int(m.group(1)), -1, resample(parse_path(c.get('d')))))
            else: walk(c, ci)
        if top is not None and comps != [top]:
            for c in top:
                if c.tag == 'path':
                    m = re.search(r'-s(\d+)$', c.get('id')); strokes.append((int(m.group(1)), -1, resample(parse_path(c.get('d')))))
        strokes.sort(key=lambda s: s[0])
        seen = set(); uniq = []
        for s in strokes:
            if s[0] in seen: continue
            seen.add(s[0]); uniq.append(s)
        data[ch] = [[s[1] for s in uniq], "|".join("".join(enc(v / 109) for p in s[2] for v in p) for s in uniq)]
    missing = sorted(want - set(data))
    with open(out, "w", encoding="utf-8") as f:
        f.write("// 書き順データ: KanjiVG (https://kanjivg.tagaini.net) by Ulrich Apel, CC BY-SA 3.0\n")
        f.write("// tools/build_strokes.py で自動生成。直接編集しない\n")
        f.write("// 形式: {字: [[部品番号...], \"画|画|...\"]}  各画は20点、座標1つを1文字で表す\n")
        f.write("window.KAKITORI_STROKES=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";\n")
    print(len(data), "kanji;", "missing:", "".join(missing) or "none", ";", os.path.getsize(out), "bytes")

main()
