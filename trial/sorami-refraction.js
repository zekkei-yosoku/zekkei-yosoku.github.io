/*
 * Sorami — 光線追跡による大気差
 *
 * 気温の高さ分布から屈折率の場を作り、光の通り道を数値積分する。天体（大気の外まで抜ける光）と
 * 地上の目標（大気の中で終わる光）を**同じ大気**で解くための土台。気象の取得はここでは扱わない。
 *
 * なぜ式（Sæmundsson・係数 k）だけで済ませないか:
 *   式は気温が標準的に下がる大気を仮定していて、地平線近くで効く逆転層・海面との温度差を表せない。
 *   また重なりの判定では、観測点の近くの空気は天体と目標を同じだけ持ち上げるので打ち消し合い、
 *   効くのは目標から先（天体側）の空気になる。天体を式・目標を k で別々に解くと、この打ち消しが崩れる。
 *
 * 屈折度 N=(n−1)·10⁶ = N_s(λ)·(P/1013.25)·(273.15/T)、N_s は乾燥空気・λ=0.55µm（Barrell & Sears 型）。
 * 気圧は地上気圧から静水圧平衡で積分する。水蒸気の寄与（−11.27e/T）は地平線でも0.3′未満なので入れない。
 * 光線方程式 dt/ds = (∇n − (∇n·t)t)/n を、地球中心・観測者・視線を含む平面で RK4 積分する。
 * 視線方向に気象が変わるときは、視線上の複数地点の柱を距離で線形に補間する（水平方向の勾配は無視）。
 * 移植元: Python版 zekkei（okayu0321/AI-Workspace ブランチ claude/zekkei-refraction）。
 */
(function (global) {
  "use strict";

  const DEG = Math.PI / 180;
  const EARTH_R = 6371008.8;
  const HYDRO = 9.80665 * 0.0289644 / 8.314462618; // g·M/R [K/m]
  const NS = 287.6155 + 1.62887 / 0.55 ** 2 + 0.0136 / 0.55 ** 4;
  const TOP = 90000;

  // US 標準大気 1976（幾何高度で近似）。最上層の観測値より上をこの形で延ばす
  const US76 = [[0, 288.15, -0.0065], [11000, 216.65, 0], [20000, 216.65, 0.001], [32000, 228.65, 0.0028],
    [47000, 270.65, 0], [51000, 270.65, -0.0028], [71000, 214.65, -0.002]];
  function us76(z) {
    let b = US76[0];
    for (const x of US76) { if (z >= x[0]) b = x; else break; }
    return b[1] + b[2] * (z - b[0]);
  }

  /**
   * 1地点の気温の柱。points は [{z: 海抜m, t: ℃}]（地上2m・気圧面など）、pressureHPa は地面（groundM）の現地気圧。
   * surfaceT は地表面・海面の温度（あれば地面の高さに置く）。
   * - 地面から300m以内の区間は高さの対数で補間する（接地層は対数の形に近い）。それより上は高さに比例
   * - 一番下の点より下〜地面は一番下の点の気温のまま。地面より下（他の柱から見た仮想の空気）は標準の減率で延ばす
   * - 一番上の点より上は標準大気の形にずらし、ずれを高度20kmまでに0へ戻す
   */
  function column(src) {
    const g = src.groundM;
    const pts = src.points.filter((p) => Number.isFinite(p.z) && Number.isFinite(p.t) && p.z >= g - 0.5).sort((a, b) => a.z - b.z)
      .filter((p, i, a) => !i || p.z > a[i - 1].z + 0.01);
    if (Number.isFinite(src.surfaceT) && (!pts.length || pts[0].z > g + 0.01)) pts.unshift({ z: g, t: src.surfaceT });
    if (!pts.length || !Number.isFinite(g) || !(src.pressureHPa > 0)) throw new RangeError("気温の柱が作れません");
    const lowest = pts[0], top = pts[pts.length - 1], z0 = 0.1;
    const lg = (z) => Math.log(Math.max(z - g, 0) + z0);
    const dev = top.t + 273.15 - us76(top.z), fadeTop = Math.max(top.z + 1000, 20000);
    function temp(z) {
      if (z <= lowest.z) return lowest.t + 273.15 + (z < g ? 0.0065 * (g - z) : 0);
      if (z >= top.z) return us76(z) + dev * Math.max(0, 1 - (z - top.z) / (fadeTop - top.z));
      let i = 1;
      while (pts[i].z < z) i++;
      const a = pts[i - 1], b = pts[i];
      const f = b.z - g <= 300 ? (lg(z) - lg(a.z)) / (lg(b.z) - lg(a.z)) : (z - a.z) / (b.z - a.z);
      return a.t + (b.t - a.t) * f + 273.15;
    }
    // 格子: 地面の前後は細かく（接地層）、上空は粗く
    const segs = [], zs = [];
    const add = (from, to, step) => {
      if (to <= from) return;
      const n = Math.round((to - from) / step);
      segs.push({ z0: from, step: (to - from) / n, n, offset: zs.length ? zs.length - 1 : 0 });
      for (let i = zs.length ? 1 : 0; i <= n; i++) zs.push(from + (to - from) * i / n);
    };
    const bottom = Math.min(-500, g - 500);
    add(bottom, g - 20, 10); add(g - 20, g + 30, 0.25); add(g + 30, g + 600, 2);
    add(g + 600, Math.max(g + 1000, 15000), 10); add(Math.max(g + 1000, 15000), TOP + 1000, 100);
    const n = zs.length, T = new Float64Array(n), lnP = new Float64Array(n), N = new Float64Array(n), dN = new Float64Array(n);
    for (let i = 0; i < n; i++) T[i] = temp(zs[i]);
    let ig = 0;
    while (zs[ig] < g - 1e-6) ig++;
    lnP[ig] = Math.log(src.pressureHPa);
    for (let i = ig + 1; i < n; i++) lnP[i] = lnP[i - 1] - HYDRO * (zs[i] - zs[i - 1]) * 0.5 * (1 / T[i - 1] + 1 / T[i]);
    for (let i = ig - 1; i >= 0; i--) lnP[i] = lnP[i + 1] + HYDRO * (zs[i + 1] - zs[i]) * 0.5 * (1 / T[i + 1] + 1 / T[i]);
    for (let i = 0; i < n; i++) N[i] = NS * (Math.exp(lnP[i]) / 1013.25) * (273.15 / T[i]);
    for (let i = 0; i < n; i++) {
      const a = Math.max(i - 1, 0), b = Math.min(i + 1, n - 1);
      dN[i] = (N[b] - N[a]) / (zs[b] - zs[a]);
    }
    return { groundM: g, pressureHPa: src.pressureHPa, segs, zs, N, dN, T, temperature: temp,
      pressureAt: (z) => Math.exp(lnAt(z)), lowest: zs[0] };
    function lnAt(z) {
      const k = index(segs, z, n), f = k.f;
      return lnP[k.i] + (lnP[k.i + 1] - lnP[k.i]) * f;
    }
  }

  function index(segs, z, n) {
    let s = segs[0];
    for (let j = 1; j < segs.length; j++) if (z >= segs[j].z0) s = segs[j]; else break;
    let x = (z - s.z0) / s.step;
    if (x < 0) x = 0;
    let i = Math.floor(x);
    if (i >= s.n) i = s.n - 1;
    const gi = s.offset + i;
    return { i: Math.min(gi, n - 2), f: Math.min(1, x - i) };
  }

  /// 視線方向に並んだ柱（s: 観測点からの地表の距離 m）を、距離で線形に補間する屈折率の場
  function field(cols) {
    const list = cols.map((c) => ({ s: c.s, col: c.col || column(c) })).sort((a, b) => a.s - b.s);
    if (!list.length) throw new RangeError("柱がありません");
    const out = new Float64Array(2);
    function one(col, h, o) {
      if (h >= TOP) { o[0] = 0; o[1] = 0; return; }
      const zs = col.zs;
      if (h <= zs[0]) { o[0] = col.N[0]; o[1] = col.dN[0]; return; }
      const k = index(col.segs, h, zs.length), i = k.i, f = k.f;
      o[0] = col.N[i] + (col.N[i + 1] - col.N[i]) * f;
      o[1] = col.dN[i] + (col.dN[i + 1] - col.dN[i]) * f;
    }
    const tmp = new Float64Array(2);
    // 柱の地面より下は延ばした仮想の空気なので、隣の柱がその高さで本物の空気なら混ぜない
    // （山頂の柱の「地面より下」を、手前の平地の上空へ補間してしまうのを防ぐ）
    function at(h, s) {
      if (list.length === 1 || s <= list[0].s) { one(list[0].col, h, out); return out; }
      const last = list[list.length - 1];
      if (s >= last.s) { one(last.col, h, out); return out; }
      let j = 1;
      while (list[j].s < s) j++;
      const a = list[j - 1], b = list[j], f = (s - a.s) / (b.s - a.s);
      let wa = 1 - f, wb = f;
      const ua = h < a.col.groundM - 10, ub = h < b.col.groundM - 10;
      if (ua && !ub) wa = 0; else if (ub && !ua) wb = 0;
      else if (ua && ub) { if (a.col.groundM <= b.col.groundM) wb = 0; else wa = 0; }
      if (!wb) { one(a.col, h, out); return out; }
      if (!wa) { one(b.col, h, out); return out; }
      one(a.col, h, out); one(b.col, h, tmp);
      out[0] += (tmp[0] - out[0]) * wb; out[1] += (tmp[1] - out[1]) * wb;
      return out;
    }
    function ground(s) {
      if (list.length === 1 || s <= list[0].s) return list[0].col.groundM;
      const last = list[list.length - 1];
      if (s >= last.s) return last.col.groundM;
      let j = 1;
      while (list[j].s < s) j++;
      const a = list[j - 1], b = list[j];
      return a.col.groundM + (b.col.groundM - a.col.groundM) * (s - a.s) / (b.s - a.s);
    }
    return { at, ground, columns: list };
  }

  /**
   * 見かけの高度 appDeg で観測点（海抜 h0）から光を放って追う。
   * stopS（地表の距離 m）を与えるとそこでの {h, elevation} を返す（地上目標）。
   * 与えないと大気の外へ抜けた向き（＝天体の真高度）を返す。海面より下へ入ったら hit。
   */
  function trace(F, h0, appDeg, { stopS = null, stepScale = 1, seaLevel = 0 } = {}) {
    const R = EARTH_R, a = appDeg * DEG;
    let x = 0, y = R + h0, tx = Math.cos(a), ty = Math.sin(a), minH = h0;
    let px = x, py = y, ptx = tx, pty = ty;
    const k = new Float64Array(16);
    function deriv(X, Y, TX, TY, o) {
      const r = Math.sqrt(X * X + Y * Y), v = F.at(r - R, Math.atan2(X, Y) * R);
      const gr = v[1] * 1e-6 / (1 + v[0] * 1e-6) / r, gx = gr * X, gy = gr * Y, dot = gx * TX + gy * TY;
      k[o] = TX; k[o + 1] = TY; k[o + 2] = gx - dot * TX; k[o + 3] = gy - dot * TY;
    }
    for (let it = 0; it < 3e6; it++) {
      const r = Math.sqrt(x * x + y * y), h = r - R, s = Math.atan2(x, y) * R;
      if (h < minH) minH = h;
      if (stopS != null && s >= stopS) {
        const s0 = Math.atan2(px, py) * R, f = s === s0 ? 1 : (stopS - s0) / (s - s0);
        const r0 = Math.sqrt(px * px + py * py);
        const e0 = Math.asin(Math.max(-1, Math.min(1, (px * ptx + py * pty) / r0))), e1 = Math.asin(Math.max(-1, Math.min(1, (x * tx + y * ty) / r)));
        return { h: r0 - R + (h - (r0 - R)) * f, elevation: (e0 + (e1 - e0) * f) / DEG, minH };
      }
      if (h >= TOP) break;
      if (h < seaLevel) return stopS != null ? null : { hit: true, minH };
      const ds = stepScale * Math.min(2000, 2 + 0.04 * Math.max(0, h - Math.max(seaLevel, F.ground(s))));
      px = x; py = y; ptx = tx; pty = ty;
      deriv(x, y, tx, ty, 0);
      deriv(x + 0.5 * ds * k[0], y + 0.5 * ds * k[1], tx + 0.5 * ds * k[2], ty + 0.5 * ds * k[3], 4);
      deriv(x + 0.5 * ds * k[4], y + 0.5 * ds * k[5], tx + 0.5 * ds * k[6], ty + 0.5 * ds * k[7], 8);
      deriv(x + ds * k[8], y + ds * k[9], tx + ds * k[10], ty + ds * k[11], 12);
      x += ds / 6 * (k[0] + 2 * k[4] + 2 * k[8] + k[12]);
      y += ds / 6 * (k[1] + 2 * k[5] + 2 * k[9] + k[13]);
      tx += ds / 6 * (k[2] + 2 * k[6] + 2 * k[10] + k[14]);
      ty += ds / 6 * (k[3] + 2 * k[7] + 2 * k[11] + k[15]);
      const m = Math.hypot(tx, ty); tx /= m; ty /= m;
    }
    if (stopS != null) return null;
    return { hit: false, trueAltitude: Math.atan2(ty, tx) / DEG, refraction: appDeg - Math.atan2(ty, tx) / DEG, minH };
  }

  /// 大気が無いときの見上げ角（地心の式。小角近似ではない）
  function geometricElevation(distanceM, h0, h1) {
    const t = distanceM / EARTH_R, ro = EARTH_R + h0, rt = EARTH_R + h1;
    return Math.atan2(rt * Math.cos(t) - ro, rt * Math.sin(t)) / DEG;
  }

  /// 地表の距離 distanceM・海抜 targetM の点が見える見かけの見上げ角。途中で海面に当たるなら null
  function targetElevation(F, h0, distanceM, targetM, opts = {}) {
    const geo = geometricElevation(distanceM, h0, targetM);
    const at = (e) => { const r = trace(F, h0, e, { ...opts, stopS: distanceM }); return r ? r.h - targetM : -Infinity; };
    let a = geo - 0.5, b = geo + 1, fa = at(a), fb = at(b);
    for (let i = 0; fb < 0 && i < 6; i++) { b += 1; fb = at(b); }
    if (!(fb >= 0)) return null;
    for (let i = 0; fa >= 0 && i < 6; i++) { a -= 1; fa = at(a); }
    // Illinois 法。高さは見上げ角にほぼ比例するので数回で収束する
    let side = 0;
    for (let i = 0; i < 80 && b - a > 1e-9; i++) {
      let c = Number.isFinite(fa) ? (a * fb - b * fa) / (fb - fa) : (a + b) / 2;
      if (!(c > a && c < b)) c = (a + b) / 2;
      const fc = at(c);
      if (Math.abs(fc) < 1e-3) return c;
      if (fc >= 0) { b = c; fb = fc; if (side === 1 && Number.isFinite(fa)) fa /= 2; side = 1; }
      else { a = c; fa = fc; if (side === -1) fb /= 2; side = -1; }
    }
    return (a + b) / 2;
  }

  /// 海の地平線の伏角（度、水平より下が正）。冷たい海面のダクトでは負になりうる
  function dip(F, h0, opts = {}) {
    const hits = (a) => { const r = trace(F, h0, a, opts); return r.hit; };
    const geo = Math.acos(EARTH_R / (EARTH_R + Math.max(h0, 0))) / DEG;
    let lo = -geo - 0.3, hi = 0.2;
    for (let i = 0; hits(hi) && i < 50; i++) hi += 0.1;
    if (!hits(lo)) return -lo;
    while (hi - lo > 1e-4) { const m = (lo + hi) / 2; if (hits(m)) lo = m; else hi = m; }
    return -hi;
  }

  /**
   * 天体の大気差の表（見かけ ⇄ 真）。地平線の直上は蜃気楼で真高度が折り返すことがあるので細かく引く。
   * 表の点の間は「Sæmundsson に対する比」を補間する（比はなめらかなので、25本ほどの光で0.05′以内に収まる）。
   * maxDeg より上は maxDeg での比のまま延ばす（20°より上の大気差は観測点の気圧・気温でほぼ決まる）。
   */
  const SAE = (t) => 1.02 / Math.tan((t + 10.3 / (t + 5.11)) * DEG) / 60;
  const OFFSETS = [0, 0.01, 0.02, 0.04, 0.07, 0.1, 0.15, 0.2, 0.3, 0.4, 0.55, 0.7, 1, 1.4, 2, 2.6, 3.3, 4.2, 5.3, 6.6, 8.2, 10, 12.5, 15.5];
  function bodyTable(F, h0, { maxDeg = 20, saemundsson = SAE, stepScale = 1 } = {}) {
    const opts = { stepScale };
    const d = dip(F, h0, opts), start = -d + 2e-4;
    const grid = [...OFFSETS.map((x) => start + x).filter((a) => a < maxDeg - 0.2), maxDeg];
    const app = [], tru = [];
    for (const a of grid) {
      const r = trace(F, h0, a, opts);
      if (r.hit) continue;
      app.push(a); tru.push(r.trueAltitude);
    }
    if (app.length < 2) throw new RangeError("大気差の表が作れません");
    let mono = tru.length - 1;
    while (mono > 0 && tru[mono - 1] < tru[mono]) mono--;
    const monoFloor = Math.max(...tru.slice(0, mono + 1));
    const rho = tru.map((t, i) => (app[i] - t) / saemundsson(t));
    /// 真高度 → 見かけ（いちばん高い像）。表より下（地平線の下）は、表の下端の大気差をそのまま足して続ける
    function apparentFromTrue(t) {
      const n = tru.length;
      if (t >= tru[n - 1]) return t + saemundsson(t) * rho[n - 1];
      if (t > monoFloor) {
        let lo = mono, hi = n - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (tru[m] <= t) lo = m; else hi = m; }
        const f = (t - tru[lo]) / (tru[hi] - tru[lo]);
        return t + saemundsson(t) * (rho[lo] + (rho[hi] - rho[lo]) * f);
      }
      for (let i = mono; i > 0; i--) {
        const y0 = tru[i - 1], y1 = tru[i];
        if ((y0 <= t && t <= y1) || (y1 <= t && t <= y0)) return app[i - 1] + (app[i] - app[i - 1]) * (y1 === y0 ? 0 : (t - y0) / (y1 - y0));
      }
      const low = Math.min(...tru), i = tru.indexOf(low);
      return t + (app[i] - low);
    }
    return { dip: d, apparent: app, true: tru, lowestTrue: Math.min(...tru), apparentFromTrue,
      refractionAtTrue: (t) => apparentFromTrue(t) - t };
  }

  const api = { column, field, trace, targetElevation, geometricElevation, dip, bodyTable, us76, EARTH_R };
  global.SoramiRefraction = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof window !== "undefined" ? window : globalThis);
