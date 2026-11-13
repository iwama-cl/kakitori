// 書き取り帳 自動判定（書き順データ版）
// KanjiVG の1画ずつのデータと、手書きの1画ずつを比べる。書き順は問わない。
//  1. 字全体の位置・大きさ・傾き（右上がり）をそろえる
//  2. 手書きの各画を、形と位置が一番近いお手本の画に割り当てる（続け書きした2画もOK）
//  3. 部品（偏・旁など）ごとに位置と大きさをそろえ直して、もう一度割り当てる
//  4. 割り当てのないお手本の画 = 抜け、割り当てのない手書きの画 = 余分
(function (global) {
  const N = 20;
  const P = {
    lam: 0.6,        // 位置ずれの重み（形のずれに対して）
    revPen: 0.015,   // 逆向きに書いた画への小さなペナルティ
    tMatch: 0.16,    // これより遠いものは対応なし
    tOk: 0.085,      // これ以下なら「きれいに合っている」
    mergeGap: 0.3,   // 続け書きとみなす画のすき間
    mergeSpan: 3,    // 書き順で何画先までの組み合わせを考えるか
    iters: 2,
    splitMinLen: 0.5,
    splitMaxAngle: 45, // 続け書きの各部分とお手本の画の向きの差（度）の上限 // 続け書きの各部分に必要な長さ（お手本の画に対する割合）
    tMerge: 0.14,    // 続け書きとして認める上限
    mergePen: 1.1,   // 続け書きの対応は少しだけ厳しめに
  };

  // ---------- 基本の点列処理 ----------
  function resample(pts, n = N) {
    if (pts.length === 1) return Array.from({ length: n }, () => pts[0].slice());
    const d = [0];
    for (let i = 1; i < pts.length; i++) d.push(d[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const L = d[d.length - 1] || 1e-6, out = [];
    let j = 0;
    for (let k = 0; k < n; k++) {
      const t = L * k / (n - 1);
      while (j < d.length - 2 && d[j + 1] < t) j++;
      const seg = (d[j + 1] - d[j]) || 1e-6, u = (t - d[j]) / seg;
      out.push([pts[j][0] + (pts[j + 1][0] - pts[j][0]) * u, pts[j][1] + (pts[j + 1][1] - pts[j][1]) * u]);
    }
    return out;
  }
  const centroid = s => { let x = 0, y = 0; for (const p of s) { x += p[0]; y += p[1]; } return [x / s.length, y / s.length]; };
  const length = s => { let L = 0; for (let i = 1; i < s.length; i++) L += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]); return L; };
  function bbox(strokes) {
    let a = 1e9, b = 1e9, c = -1e9, d = -1e9;
    for (const s of strokes) for (const [x, y] of s) { a = Math.min(a, x); b = Math.min(b, y); c = Math.max(c, x); d = Math.max(d, y); }
    return { x0: a, y0: b, x1: c, y1: d, w: Math.max(0.02, c - a), h: Math.max(0.02, d - b), cx: (a + c) / 2, cy: (b + d) / 2 };
  }

  // 2本の点列のずれ（形 + 位置）
  function cost(u, r) {
    const cu = centroid(u), cr = centroid(r);
    let f = 0, b = 0;
    for (let i = 0; i < N; i++) {
      f += Math.hypot((u[i][0] - cu[0]) - (r[i][0] - cr[0]), (u[i][1] - cu[1]) - (r[i][1] - cr[1]));
      const j = N - 1 - i;
      b += Math.hypot((u[j][0] - cu[0]) - (r[i][0] - cr[0]), (u[j][1] - cu[1]) - (r[i][1] - cr[1]));
    }
    f /= N; b = b / N + P.revPen;
    // 点（とても短い画）どうしは形より位置を見る
    const short = Math.max(length(u), length(r)) < 0.08;
    const shape = short ? Math.min(f, b) * 0.5 : Math.min(f, b);
    return shape + P.lam * Math.hypot(cu[0] - cr[0], cu[1] - cr[1]);
  }

  // ハンガリアン法（最小コストの割り当て）
  function hungarian(C) {
    const n = C.length, m = C[0].length, sz = Math.max(n, m), INF = 1e9;
    const a = Array.from({ length: sz }, (_, i) => Array.from({ length: sz }, (_, j) => (i < n && j < m ? C[i][j] : P.tMatch)));
    const u = new Array(sz + 1).fill(0), v = new Array(sz + 1).fill(0), p = new Array(sz + 1).fill(0), way = new Array(sz + 1).fill(0);
    for (let i = 1; i <= sz; i++) {
      p[0] = i; let j0 = 0; const minv = new Array(sz + 1).fill(INF), used = new Array(sz + 1).fill(false);
      do {
        used[j0] = true; const i0 = p[j0]; let delta = INF, j1 = 0;
        for (let j = 1; j <= sz; j++) if (!used[j]) {
          const cur = a[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (let j = 0; j <= sz; j++) { if (used[j]) { u[p[j]] += delta; v[j] -= delta; } else minv[j] -= delta; }
        j0 = j1;
      } while (p[j0] !== 0);
      do { const j1 = way[j0]; p[j0] = p[j1]; j0 = j1; } while (j0);
    }
    const res = new Array(n).fill(-1);
    for (let j = 1; j <= sz; j++) if (p[j] - 1 < n && j - 1 < m) res[p[j] - 1] = j - 1;
    return res;
  }

  // ---------- 割り当て ----------
  // units: お手本の「単画」と「続け書きした2画」
  // 続け書きは書き順どおりとは限らないので、終点と始点が近い画どうしなら組み合わせを作る
  function buildUnits(ref) {
    const units = ref.map((s, i) => ({ idx: [i], pts: s }));
    const gap = (a, b) => Math.hypot(ref[a][N - 1][0] - ref[b][0][0], ref[a][N - 1][1] - ref[b][0][1]);
    const near = (a, b) => Math.abs(a - b) <= P.mergeSpan;
    const unit = idx => { const all = idx.flatMap(k => ref[k]); return { idx, cen: centroid(all), L: idx.reduce((s, k) => s + length(ref[k]), 0) + idx.slice(1).reduce((s, k, n) => s + gap(idx[n], k), 0) }; };
    for (let i = 0; i < ref.length; i++) for (let j = 0; j < ref.length; j++) {
      if (i === j || !near(i, j) || gap(i, j) >= P.mergeGap) continue;
      units.push(unit([i, j]));
      for (let k = 0; k < ref.length; k++) { // 3画の続け書き（崩し字）
        if (k === i || k === j || !near(j, k) || gap(j, k) >= P.mergeGap) continue;
        units.push(unit([i, j, k]));
      }
    }
    return units;
  }
  function total(match, nRef) {
    const cov = new Set(); let t = 0;
    for (const m of match) { if (m) { t += m.c; m.idx.forEach(x => cov.add(x)); } else t += P.tMatch; }
    return t + (nRef - cov.size) * P.tMatch;
  }
  // 手書き1画をいくつかに区切って、それぞれをお手本の画と比べる（続け書き用）
  function splitCost(u, parts) {
    const U = resample(u, 40), M = 40;
    const seg = (a, b) => resample(U.slice(a, b + 1));
    // 区切った各部分が、対応するお手本の画に見合う長さを持っていること（抜けた画をごまかさない）
    const cum = [0]; for (let k = 1; k < M; k++) cum.push(cum[k - 1] + Math.hypot(U[k][0] - U[k - 1][0], U[k][1] - U[k - 1][1]));
    const pl = parts.map(r => length(r));
    const okLen = (k, a, b) => {
      if (pl[k] >= 0.04 && (cum[b] - cum[a]) < P.splitMinLen * pl[k]) return false;
      // 向きもおおよそ合っていること（縦画の一部を横画とみなさない）
      const r = parts[k], vx = U[b][0] - U[a][0], vy = U[b][1] - U[a][1], wx = r[N - 1][0] - r[0][0], wy = r[N - 1][1] - r[0][1];
      const lv = Math.hypot(vx, vy), lw = Math.hypot(wx, wy);
      if (lv < 0.06 || lw < 0.06) return true;
      return Math.abs(vx * wx + vy * wy) / (lv * lw) > Math.cos(P.splitMaxAngle * Math.PI / 180);
    };
    // 短い画（点など）も同じ重みで見る。どこか1つでも合わなければ続け書きとは認めない
    const comb = cs => 0.5 * cs.reduce((a, b) => a + b, 0) / cs.length + 0.5 * Math.max(...cs);
    let best = 1e9;
    if (parts.length === 2) {
      for (let t = 3; t < M - 3; t++) {
        if (!okLen(0, 0, t) || !okLen(1, t, M - 1)) continue;
        const c = comb([cost(seg(0, t), parts[0]), cost(seg(t, M - 1), parts[1])]);
        if (c < best) best = c;
      }
    } else {
      for (let t1 = 3; t1 < M - 6; t1 += 3) for (let t2 = t1 + 3; t2 < M - 3; t2 += 3) {
        if (!okLen(0, 0, t1) || !okLen(1, t1, t2) || !okLen(2, t2, M - 1)) continue;
        const c = comb([cost(seg(0, t1), parts[0]), cost(seg(t1, t2), parts[1]), cost(seg(t2, M - 1), parts[2])]);
        if (c < best) best = c;
      }
    }
    return best;
  }
  function assign(user, ref, units) {
    const C = user.map(u => ref.map(r => cost(u, r)));
    // 続け書きの組（手書き1画 → お手本2〜3画）を決めたうえで、残りを単画どうしで最適に割り当てる
    const solve = merges => {
      const usedU = new Set(), usedR = new Set();
      for (const [i, m] of merges) { usedU.add(i); m.idx.forEach(k => usedR.add(k)); }
      const ui = user.map((_, i) => i).filter(i => !usedU.has(i)), ri = ref.map((_, k) => k).filter(k => !usedR.has(k));
      const match = user.map(() => null);
      for (const [i, m] of merges) match[i] = m;
      if (ui.length && ri.length) {
        const a = hungarian(ui.map(i => ri.map(k => C[i][k])));
        ui.forEach((i, n) => { const k = a[n] >= 0 ? ri[a[n]] : -1; if (k >= 0 && C[i][k] < P.tMatch) match[i] = { idx: [k], c: C[i][k] }; });
      }
      return match;
    };
    let merges = new Map(), match = solve(merges), cur = total(match, ref.length);
    // 候補（手書き1画 × 続け書きの組）を前もって絞り込み、ずれを計算しておく
    const uInfo = user.map(u => ({ c: centroid(u), L: length(u) }));
    const cands = [];
    for (const un of units) {
      if (un.idx.length < 2) continue;
      for (let i = 0; i < user.length; i++) {
        const ui = uInfo[i];
        if (Math.hypot(ui.c[0] - un.cen[0], ui.c[1] - un.cen[1]) > 0.22) continue;
        const ratio = ui.L / un.L;
        if (ratio < 0.55 || ratio > 1.8) continue;
        const c2 = splitCost(user[i], un.idx.map(k => ref[k])) * P.mergePen;
        if (c2 < P.tMerge) cands.push({ i, idx: un.idx, c: c2 });
      }
    }
    // 一番よくなる続け書きの組を1つずつ採用していく
    for (let round = 0; round < 5 && cands.length; round++) {
      let best = null;
      for (const cd of cands) {
        const m2 = new Map([...merges].filter(([i, m]) => i !== cd.i && !m.idx.some(k => cd.idx.includes(k))));
        m2.set(cd.i, { idx: cd.idx, c: cd.c });
        const mt = solve(m2), t = total(mt, ref.length);
        if (t + 0.005 < (best ? best.t : cur)) best = { t, m2, mt };
      }
      if (!best) break;
      merges = best.m2; match = best.mt; cur = best.t;
    }
    return match;
  }

  // 対応点から「拡大縮小 + 平行移動 + 傾き」を最小二乗で求める（制限つき）
  function fitTransform(pairs, lim) {
    if (pairs.length < 3) return null;
    let mux = 0, muy = 0, mrx = 0, mry = 0;
    for (const [u, r] of pairs) { mux += u[0]; muy += u[1]; mrx += r[0]; mry += r[1]; }
    const n = pairs.length; mux /= n; muy /= n; mrx /= n; mry /= n;
    let sxx = 0, syy = 0, sxr = 0, syr = 0, sxyr = 0;
    for (const [u, r] of pairs) {
      const dx = u[0] - mux, dy = u[1] - muy, ex = r[0] - mrx, ey = r[1] - mry;
      sxx += dx * dx; syy += dy * dy; sxr += dx * ex; syr += dy * ey; sxyr += dx * ey;
    }
    const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
    const kx = clamp(sxx > 1e-6 ? sxr / sxx : 1, lim.smin, lim.smax);
    const ky = clamp(syy > 1e-6 ? (syr) / syy : 1, lim.smin, lim.smax);
    // y = ky*dy + h*dx（右上がりの傾きを打ち消す）
    let h = 0;
    if (lim.shear && sxx > 1e-6) { let num = 0; for (const [u, r] of pairs) { const dx = u[0] - mux, dy = u[1] - muy; num += dx * ((r[1] - mry) - ky * dy); } h = clamp(num / sxx, -lim.shear, lim.shear); }
    const tx = clamp(mrx - mux, -lim.t, lim.t), ty = clamp(mry - muy, -lim.t, lim.t);
    return p => [mux + tx + kx * (p[0] - mux), muy + ty + ky * (p[1] - muy) + h * (p[0] - mux)];
  }

  // ---------- 判定本体 ----------
  function judgeChar(ch, rawStrokes) {
    const data = global.KAKITORI_STROKES && global.KAKITORI_STROKES[ch];
    if (!data) return null; // データにない字 → 呼び出し側で旧方式へ
    const ref = data.s.map(f => { const o = []; for (let i = 0; i < f.length; i += 2) o.push([f[i], f[i + 1]]); return o; });
    const comp = data.c;
    const strokesIn = rawStrokes.filter(s => s.length);
    if (!strokesIn.length) return { grade: 0, empty: true, missingCell: [], extraCell: [], nMissing: ref.length, nExtra: 0, nOdd: 0, refCount: ref.length, userCount: 0 };

    // 1. 字全体を合わせる（大きさ・中心）
    const ub = bbox(strokesIn), rb = bbox(ref);
    const sc = Math.sqrt((rb.w * rb.h) / (ub.w * ub.h));
    const g0 = p => [rb.cx + (p[0] - ub.cx) * sc, rb.cy + (p[1] - ub.cy) * sc];
    const orig = strokesIn.map(s => resample(s));
    let user = orig.map(s => s.map(g0));
    const units = buildUnits(ref);

    let match = assign(user, ref, units);
    for (let it = 0; it < P.iters; it++) {
      // 2. 字全体の傾き・縦横比を合わせ直す
      const pairsAll = [];
      match.forEach((m, i) => { if (m && m.idx.length === 1) { const r = ref[m.idx[0]]; const u = user[i]; const rev = cost(u.slice().reverse(), r) < cost(u, r); for (let k = 0; k < N; k++) pairsAll.push([rev ? u[N - 1 - k] : u[k], r[k]]); } });
      const G = fitTransform(pairsAll, { smin: 0.8, smax: 1.25, t: 0.08, shear: 0.25 });
      if (G) user = user.map(s => s.map(G));
      // 3. 部品ごとに合わせ直す
      match = assign(user, ref, units);
      const byComp = {};
      match.forEach((m, i) => { if (!m) return; const c = comp[m.idx[0]]; if (c < 0) return; (byComp[c] = byComp[c] || []).push(i); });
      const compT = {};
      for (const c in byComp) {
        if (byComp[c].length < 2) continue;
        const pairs = [];
        for (const i of byComp[c]) { const m = match[i]; if (m.idx.length !== 1) continue; const r = ref[m.idx[0]], u = user[i]; const rev = cost(u.slice().reverse(), r) < cost(u, r); for (let k = 0; k < N; k += 2) pairs.push([rev ? u[N - 1 - k] : u[k], r[k]]); }
        const T = fitTransform(pairs, { smin: 0.7, smax: 1.45, t: 0.12, shear: 0 });
        if (T) compT[c] = T;
      }
      // どの部品にも入らなかった手書きの画は、一番近い部品の補正を使う
      const compCenters = {};
      for (const c in compT) { const ss = ref.filter((_, k) => comp[k] == c); compCenters[c] = centroid(ss.flat()); }
      user = user.map((s, i) => {
        let c = match[i] ? comp[match[i].idx[0]] : -1;
        if (!(c in compT)) { let bd = 1e9; const cu = centroid(s); for (const k in compCenters) { const d = Math.hypot(cu[0] - compCenters[k][0], cu[1] - compCenters[k][1]); if (d < bd && d < 0.25) { bd = d; c = k; } } }
        return c in compT ? s.map(compT[c]) : s;
      });
      match = assign(user, ref, units);
    }

    // 4. 結果をまとめる
    const covered = new Set(); match.forEach(m => m && m.idx.forEach(x => covered.add(x)));
    const missingIdx = ref.map((_, i) => i).filter(i => !covered.has(i));
    const extraIdx = match.map((m, i) => (m ? -1 : i)).filter(i => i >= 0);
    const oddIdx = match.map((m, i) => (m && m.c > P.tOk * (m.idx.length > 1 ? 1.3 : 1) ? i : -1)).filter(i => i >= 0);
    const nM = missingIdx.length, nE = extraIdx.length, nO = oddIdx.length;
    const oddMerged = oddIdx.some(i => match[i].idx.length > 1);
    let grade;
    if (nM === 0 && nE === 0 && nO <= 1 && !oddMerged) grade = 2;
    else if (nM + nE <= 2 && nO <= 3) grade = 1;
    else grade = 0;

    // 抜けた画は、手書きの座標に戻して表示（全体の合わせの逆変換）
    const inv = p => [ub.cx + (p[0] - rb.cx) / sc, ub.cy + (p[1] - rb.cy) / sc];
    const dense = s => { const o = []; for (let i = 0; i < s.length - 1; i++) for (let k = 0; k < 4; k++) o.push([s[i][0] + (s[i + 1][0] - s[i][0]) * k / 4, s[i][1] + (s[i + 1][1] - s[i][1]) * k / 4]); o.push(s[s.length - 1]); return o; };
    return {
      grade, nMissing: nM, nExtra: nE, nOdd: nO, refCount: ref.length, userCount: strokesIn.length,
      missingCell: missingIdx.flatMap(i => dense(ref[i]).map(inv)),
      extraCell: extraIdx.flatMap(i => dense(strokesIn[i])),
      oddCell: oddIdx.flatMap(i => dense(strokesIn[i])),
      cov: 1 - nM / ref.length, prec: 1 - nE / strokesIn.length,
      _m: match.map(m => (m ? m.idx.join('+') + ':' + m.c.toFixed(3) : '-')).join(' '), _miss: missingIdx.join(','),
    };
  }

  global.KakitoriStrokeJudge = { judgeChar, P };
})(window);
