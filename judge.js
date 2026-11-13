// 書き取り帳 自動判定
// 正解の字をフォントで描いて細線化（骨組み）し、手書きの線と距離で比べる。
// 1) 骨組みのうち手書きが届いていない部分 = 線の抜け
// 2) 手書きのうち骨組みから離れている部分 = 余計な線
// 書き順・画数・ハネトメは見ない。
(function (global) {
  const S = 96;            // 判定用の解像度
  let TOL = 4.5;            // 試験結果から決めた値（ゆがみに強く、点の抜けもある程度拾う）         // この距離（px@96）以内なら「重なっている」
  const SEG_MIN = 7;
  let ELASTIC_SIGMA = 12, ELASTIC_ITERS = 10, CAPV = 14;       // これ以上つながった抜け・はみ出しを問題として数える（点1つ分）
  const refCache = new Map();

  // 判定の基準字形は端末に必ずあるゴシック体（Android は Noto Sans CJK JP）。
  // 明朝のウロコが骨組みに余計な枝を作らないように、また初回オフラインでも同じ結果になるように。
  function fontFamily() {
    return global.KAKITORI_REF_FONT || '"Noto Sans CJK JP","Noto Sans JP","Hiragino Sans","Yu Gothic",sans-serif';
  }

  // --- 正解の骨組みを作る ---
  function refSkeleton(ch) {
    const key = ch + "|" + fontFamily();
    if (refCache.has(key)) return refCache.get(key);
    const c = document.createElement("canvas");
    c.width = c.height = S;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.fillStyle = "#000";
    x.textAlign = "center";
    x.textBaseline = "middle";
    x.font = `500 ${Math.round(S * 0.86)}px ${fontFamily()}`;
    x.fillText(ch, S / 2, S / 2 + S * 0.02);
    const d = x.getImageData(0, 0, S, S).data;
    const img = new Uint8Array(S * S);
    for (let i = 0; i < S * S; i++) img[i] = d[i * 4 + 3] > 110 ? 1 : 0;
    thin(img);
    prune(img, 4);
    const pts = [];
    for (let y = 0; y < S; y++) for (let xx = 0; xx < S; xx++) if (img[y * S + xx]) pts.push([xx, y]);
    const res = { pts, bbox: bboxOf(pts) };
    refCache.set(key, res);
    return res;
  }

  // Zhang-Suen 細線化
  function thin(img) {
    const P = (x, y) => (x < 0 || y < 0 || x >= S || y >= S ? 0 : img[y * S + x]);
    let changed = true;
    while (changed) {
      changed = false;
      for (let step = 0; step < 2; step++) {
        const del = [];
        for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
          if (!img[y * S + x]) continue;
          const p2 = P(x, y - 1), p3 = P(x + 1, y - 1), p4 = P(x + 1, y), p5 = P(x + 1, y + 1),
            p6 = P(x, y + 1), p7 = P(x - 1, y + 1), p8 = P(x - 1, y), p9 = P(x - 1, y - 1);
          const B = p2 + p3 + p4 + p5 + p6 + p7 + p8 + p9;
          if (B < 2 || B > 6) continue;
          const seq = [p2, p3, p4, p5, p6, p7, p8, p9, p2];
          let A = 0;
          for (let i = 0; i < 8; i++) if (!seq[i] && seq[i + 1]) A++;
          if (A !== 1) continue;
          if (step === 0) { if (p2 * p4 * p6 || p4 * p6 * p8) continue; }
          else { if (p2 * p4 * p8 || p2 * p6 * p8) continue; }
          del.push(y * S + x);
        }
        if (del.length) { changed = true; for (const i of del) img[i] = 0; }
      }
    }
  }

  // 骨組みの短いヒゲ（線の端の飾りからできる枝）を取る
  function prune(img, L) {
    const nb = (x, y) => { const o = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const X = x + dx, Y = y + dy; if (X >= 0 && Y >= 0 && X < S && Y < S && img[Y * S + X]) o.push([X, Y]); } return o; };
    const ends = [];
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) if (img[y * S + x] && nb(x, y).length === 1) ends.push([x, y]);
    for (const e of ends) {
      const path = [e]; let prev = null, cur = e, junction = false;
      while (path.length <= L) {
        const n = nb(cur[0], cur[1]).filter(p => !prev || p[0] !== prev[0] || p[1] !== prev[1]);
        if (n.length !== 1) { junction = n.length >= 2; break; }
        prev = cur; cur = n[0]; path.push(cur);
      }
      if (junction && path.length <= L) for (const [x, y] of path) img[y * S + x] = 0;
    }
  }

  function bboxOf(pts) {
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    for (const [x, y] of pts) { if (x < a) a = x; if (y < b) b = y; if (x > c) c = x; if (y > d) d = y; }
    return { x0: a, y0: b, x1: c, y1: d, w: Math.max(1, c - a), h: Math.max(1, d - b) };
  }

  // 距離マップ（チェビシェフ寄りの2パス近似）
  function distMap(pts) {
    const INF = 1e6, D = new Float32Array(S * S).fill(INF);
    for (const [x, y] of pts) {
      const xi = Math.round(x), yi = Math.round(y);
      if (xi >= 0 && yi >= 0 && xi < S && yi < S) D[yi * S + xi] = 0;
    }
    const a = 1, b = 1.4142;
    for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
      let v = D[y * S + x];
      if (x > 0) v = Math.min(v, D[y * S + x - 1] + a);
      if (y > 0) {
        v = Math.min(v, D[(y - 1) * S + x] + a);
        if (x > 0) v = Math.min(v, D[(y - 1) * S + x - 1] + b);
        if (x < S - 1) v = Math.min(v, D[(y - 1) * S + x + 1] + b);
      }
      D[y * S + x] = v;
    }
    for (let y = S - 1; y >= 0; y--) for (let x = S - 1; x >= 0; x--) {
      let v = D[y * S + x];
      if (x < S - 1) v = Math.min(v, D[y * S + x + 1] + a);
      if (y < S - 1) {
        v = Math.min(v, D[(y + 1) * S + x] + a);
        if (x < S - 1) v = Math.min(v, D[(y + 1) * S + x + 1] + b);
        if (x > 0) v = Math.min(v, D[(y + 1) * S + x - 1] + b);
      }
      D[y * S + x] = v;
    }
    return D;
  }
  const at = (D, x, y) => {
    const xi = Math.max(0, Math.min(S - 1, Math.round(x))), yi = Math.max(0, Math.min(S - 1, Math.round(y)));
    return D[yi * S + xi];
  };

  // 手書きの線を細かい点列に（座標はセル内 0..1）
  function densify(strokes) {
    const out = [];
    for (const s of strokes) {
      if (!s.length) continue;
      out.push(s[0]);
      for (let i = 1; i < s.length; i++) {
        const [x0, y0] = s[i - 1], [x1, y1] = s[i];
        const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * S / 1.5));
        for (let k = 1; k <= n; k++) out.push([x0 + (x1 - x0) * k / n, y0 + (y1 - y0) * k / n]);
      }
    }
    return out;
  }

  // 点の集まりを、つながり（近さ）でグループに分けて大きさを測る
  function clusters(pts, gap) {
    const n = pts.length, seen = new Uint8Array(n), out = [];
    for (let i = 0; i < n; i++) {
      if (seen[i]) continue;
      const q = [i]; seen[i] = 1; const g = [];
      while (q.length) {
        const k = q.pop(); g.push(pts[k]);
        for (let j = 0; j < n; j++) if (!seen[j] && Math.abs(pts[j][0] - pts[k][0]) <= gap && Math.abs(pts[j][1] - pts[k][1]) <= gap) { seen[j] = 1; q.push(j); }
      }
      out.push(g);
    }
    return out;
  }

  // 1文字を判定。strokes はセル内 0..1 座標の線の配列
  function judgeChar(ch, strokes) {
    const ref = refSkeleton(ch);
    const raw = densify(strokes).map(([x, y]) => [x * S, y * S]);
    if (raw.length < 3 || !ref.pts.length) {
      return { grade: 0, empty: raw.length < 3, missingCell: [], extraCell: [], nMissing: 0, nExtra: 0, cov: 0, prec: 0 };
    }
    const Dref = distMap(ref.pts);
    const ub = bboxOf(raw), rb = ref.bbox;

    // 位置・大きさの候補をいくつか試して一番重なるものを採用
    const cands = [];
    const fit = (sx, sy, ox, oy) => cands.push({ sx, sy, ox, oy });
    const k = Math.min(rb.w / ub.w, rb.h / ub.h), kx = rb.w / ub.w, ky = rb.h / ub.h;
    const ucx = (ub.x0 + ub.x1) / 2, ucy = (ub.y0 + ub.y1) / 2, rcx = (rb.x0 + rb.x1) / 2, rcy = (rb.y0 + rb.y1) / 2;
    for (const s of [0.92, 1, 1.08]) {
      const aspectOK = kx / ky > 0.82 && kx / ky < 1.22;
      for (const [sx, sy] of aspectOK ? [[k, k], [kx, ky]] : [[k, k]]) {
        for (const [dx, dy] of [[0, 0], [2.5, 0], [-2.5, 0], [0, 2.5], [0, -2.5]]) {
          const SX = sx * s, SY = sy * s;
          fit(SX, SY, ucx - (rcx + dx) / SX, ucy - (rcy + dy) / SY);
        }
      }
    }
    cands.push({ sx: 1, sy: 1, ox: 0, oy: 0 }); // マスに書いたまま

    let best = null;
    for (const c of cands) {
      const T = p => [(p[0] - c.ox) * c.sx, (p[1] - c.oy) * c.sy];
      const U = raw.map(T);
      let inP = 0; for (const p of U) if (at(Dref, p[0], p[1]) <= TOL) inP++;
      const Du = distMap(U);
      let inR = 0; for (const p of ref.pts) if (at(Du, p[0], p[1]) <= TOL) inR++;
      const prec = inP / U.length, cov = inR / ref.pts.length, score = prec + cov;
      if (!best || score > best.score) best = { c, U, Du, prec, cov, score };
    }

    // 局所的なゆがみ（手書きのクセ）を吸収する：近い正解の線へ少しずつ寄せる。
    // 寄せ方は周りとなめらかにそろえるので、ない線を作ったり形を大きく変えたりはしない。
    const step = Math.max(1, Math.floor(best.U.length / 360));
    const idx = []; for (let i = 0; i < best.U.length; i += step) idx.push(i);
    let U = idx.map(i => best.U[i].slice());
    const R = ref.pts, SIG2 = 2 * ELASTIC_SIGMA * ELASTIC_SIGMA, CAP = CAPV;
    for (let it = 0; it < ELASTIC_ITERS; it++) {
      const dx = new Float32Array(U.length), dy = new Float32Array(U.length), cnt = new Float32Array(U.length);
      for (let i = 0; i < U.length; i++) {          // 手書き → 一番近い正解
        let bd = 1e9, bj = 0;
        for (let j = 0; j < R.length; j++) { const d = (R[j][0] - U[i][0]) ** 2 + (R[j][1] - U[i][1]) ** 2; if (d < bd) { bd = d; bj = j; } }
        if (bd <= CAP * CAP) { dx[i] += R[bj][0] - U[i][0]; dy[i] += R[bj][1] - U[i][1]; cnt[i]++; }
      }
      for (let j = 0; j < R.length; j++) {          // 正解 → 一番近い手書き
        let bd = 1e9, bi = 0;
        for (let i = 0; i < U.length; i++) { const d = (R[j][0] - U[i][0]) ** 2 + (R[j][1] - U[i][1]) ** 2; if (d < bd) { bd = d; bi = i; } }
        if (bd <= CAP * CAP) { dx[bi] += R[j][0] - U[bi][0]; dy[bi] += R[j][1] - U[bi][1]; cnt[bi]++; }
      }
      const vx = new Float32Array(U.length), vy = new Float32Array(U.length);
      for (let i = 0; i < U.length; i++) {          // なめらかにならす
        let sx = 0, sy = 0, sw = 0;
        for (let k = 0; k < U.length; k++) {
          if (!cnt[k]) continue;
          const w = Math.exp(-((U[k][0] - U[i][0]) ** 2 + (U[k][1] - U[i][1]) ** 2) / SIG2);
          sx += w * dx[k]; sy += w * dy[k]; sw += w * cnt[k];
        }
        if (sw > 1e-6) { vx[i] = sx / sw; vy[i] = sy / sw; }
      }
      U = U.map((p, i) => [p[0] + 0.6 * vx[i], p[1] + 0.6 * vy[i]]);
    }
    const Du = distMap(U);
    let inP = 0; for (const p of U) if (at(Dref, p[0], p[1]) <= TOL) inP++;
    let inR = 0; for (const p of R) if (at(Du, p[0], p[1]) <= TOL) inR++;
    const prec = inP / U.length, cov = inR / R.length;

    const missPts = R.filter(p => at(Du, p[0], p[1]) > TOL);
    const extraFlag = U.map(p => at(Dref, p[0], p[1]) > TOL * 1.3);
    const missing = clusters(missPts, 1.5).filter(g => g.length >= SEG_MIN);
    const extraPts = []; extraFlag.forEach((f, i) => { if (f) extraPts.push(U[i].concat(i)); });
    const extraAll = clusters(extraPts, 2.5 * step).filter(g => g.length * step >= SEG_MIN * 1.3);

    const issues = missing.length + extraAll.length;
    let grade;
    if (issues === 0 && cov >= 0.9 && prec >= 0.88) grade = 2;
    else if (issues <= 1 && cov >= 0.8 && prec >= 0.75) grade = 1;
    else grade = 0;

    const c = best.c, rawCell = i => [raw[idx[i]][0] / S, raw[idx[i]][1] / S];
    return {
      grade, cov, prec, nMissing: missing.length, nExtra: extraAll.length,
      missingCell: missing.flat().map(p => [(p[0] / c.sx + c.ox) / S, (p[1] / c.sy + c.oy) / S]),
      extraCell: extraAll.flat().map(p => rawCell(p[2])),
    };
  }

  global.KakitoriJudge = { judgeChar, S, _thin: thin, _prune: prune, setTol: t => { TOL = t; }, setParams: (a, b, c) => { ELASTIC_SIGMA = a; ELASTIC_ITERS = b; CAPV = c; } };
})(window);
