import {aimAirAngle} from '../reverse-and-entry.js';
/// 山の稜線（図の左から右へ [方位, 見上げ角]）。目標の前後の帯を標高データで引き、方位ごとに一番上を取る
const aimRidgeCache = new Map(), aimRidgePending = new Map();
// 2026-10-20 塔・建物の手前の地形（ユーザー「これ絶対に見えないであろう距離」。精進峠からスカイツリー112kmは御坂山地に隠れるのに、図にも文にも何も出なかった）。
// 目標の方位の左右 AIM_FRONT_SPAN° の扇で、観測点から目標の手前までの地形の見かけの高さを列ごとに取る。
// 図の手前の山並みと、目標が地形に隠れるかの判定（真ん中の列＝目標の方位）に使う。取れなければ null
const AIM_FRONT_SPAN = 20, AIM_SKY_ZOOM = 10, aimFrontCache = new Map(), aimFrontPending = new Map();
async function aimTerrainFront(obs, eye, target, span = AIM_FRONT_SPAN) {
  const D = AstroNotesTerrain.distanceKm(obs.latitude, obs.longitude, target.latitude, target.longitude);
  const az0 = AstroNotesTerrain.bearing(obs.latitude, obs.longitude, target.latitude, target.longitude);
  // 2026-11-12 目の前の堤防・土手も塔の下を隠すので30m先から読む（前は300m先から）。行を増やして1km先の間隔を前と同じくらいに保つ
  const near = 0.03, far = D - 0.3, airK = AstroNotesAtmosphere.targetK();
  if (!(far > near + 0.5)) return { ridge: [], block: null };
  const key = [obs.latitude, obs.longitude, eye, target.latitude, target.longitude, span].map((v) => v.toFixed(5)).join(",") + "|" + airK;
  if (aimFrontCache.has(key)) return aimFrontCache.get(key);
  if (aimFrontPending.has(key)) return aimFrontPending.get(key);
  const task = (async () => {
    const cols = span > AIM_FRONT_SPAN ? 120 : 80, n = 120, pts = [];
    for (let i = 0; i <= cols; i++) {
      const az = az0 - span + (2 * span * i) / cols;
      // 近いほど細かく（見かけの高さは近い地形ほど大きく変わる）
      for (let j = 0; j <= n; j++) { const d = near * Math.pow(far / near, j / n); pts.push({ ...AstroNotesTerrain.destination(obs.latitude, obs.longitude, az, d), az, d }); }
    }
    let el;
    // 広い幅は山の外をつなぐだけなので粗いズームで読む（細かいままだと1回で約350枚）
    try { el = await (span > AIM_FRONT_SPAN ? AstroNotesTerrain.tileElevations(pts, AIM_SKY_ZOOM) : AstroNotesTerrain.elevations(pts, { zoom: D > 40 ? 11 : 12, from: obs })); } catch { return null; }
    if (airK !== AstroNotesAtmosphere.targetK()) return null;
    const ridge = []; let block = null;
    for (let i = 0; i <= cols; i++) {
      let best = -90, at = null, atM = null;
      for (let j = 0; j <= n; j++) {
        const k = i * (n + 1) + j; if (!Number.isFinite(el[k])) continue;
        const a = aimAirAngle(pts[k].d, eye, el[k]); if (a > best) { best = a; at = pts[k].d; atM = el[k]; }
      }
      if (best === -90) return null;
      ridge.push([pts[i * (n + 1)].az, best]);
      if (i === cols / 2) block = { angle: best, km: at, m: atM, azimuth: pts[i * (n + 1)].az };
    }
    const out = { ridge, block };
    aimFrontCache.set(key, out);
    return out;
  })();
  aimFrontPending.set(key, task);
  try { return await task; } finally { aimFrontPending.delete(key); }
}

// 2026-11-01 高い所から塔を見ると、足元より上に地平線がある（ユーザー「月のラインが水平線より上にくる」）。
// 目標より先の地形の見かけの高さを列ごとに取る。海の地平線より低い所は海の地平線まで見える（z9で実測0.07°以内。候補を外した1回あたり約50枚）
const AIM_BEYOND_MAX_KM = 300, AIM_BEYOND_ZOOM = 9, aimBeyondCache = new Map(), aimBeyondPending = new Map();
async function aimTerrainBeyond(obs, eye, target, span = AIM_FRONT_SPAN) {
  const D = AstroNotesTerrain.distanceKm(obs.latitude, obs.longitude, target.latitude, target.longitude);
  const az0 = AstroNotesTerrain.bearing(obs.latitude, obs.longitude, target.latitude, target.longitude);
  const airK = AstroNotesAtmosphere.targetK();
  const key = [obs.latitude, obs.longitude, eye, target.latitude, target.longitude, span].map((v) => v.toFixed(5)).join(",") + "|" + airK;
  if (aimBeyondCache.has(key)) return aimBeyondCache.get(key);
  if (aimBeyondPending.has(key)) return aimBeyondPending.get(key);
  const task = (async () => {
    const cols = span > AIM_FRONT_SPAN ? 240 : 160, n = 240, near = D + 0.3, far = Math.max(near + 1, AIM_BEYOND_MAX_KM), pts = [];
    for (let i = 0; i <= cols; i++) {
      const az = az0 - span + (2 * span * i) / cols;
      for (let j = 0; j <= n; j++) { const d = near * Math.pow(far / near, j / n); pts.push({ ...AstroNotesTerrain.destination(obs.latitude, obs.longitude, az, d), az, d }); }
    }
    const el = await AstroNotesTerrain.tileElevations(pts, AIM_BEYOND_ZOOM);
    if (airK !== AstroNotesAtmosphere.targetK()) return null;
    const ridge = [];
    for (let i = 0; i <= cols; i++) {
      let best = -90;
      for (let j = 0; j <= n; j++) {
        const k = i * (n + 1) + j; best = Math.max(best, aimAirAngle(pts[k].d, eye, el[k]));
      }
      ridge.push([pts[i * (n + 1)].az, best]);
    }
    aimBeyondCache.set(key, ridge);
    while (aimBeyondCache.size > 16) aimBeyondCache.delete(aimBeyondCache.keys().next().value);
    return ridge;
  })();
  aimBeyondPending.set(key, task);
  try { return await task; } finally { aimBeyondPending.delete(key); }
}

async function aimLookRidge(obs, eye, target, win) {
  const {km:D,azimuth:az0} = AstroNotesTerrain.inverse(obs.latitude, obs.longitude, target.latitude, target.longitude);
  // 山の地形範囲・解像度はレンズや構図から独立させる。広角でも山頂を粗くしない。
  const s = target.id === "fuji" ? 18 : Math.max(1.5, Math.min(12, D * 0.15));
  const spanAz = Math.atan2(s, Math.max(.15, D)) * 180 / Math.PI;
  const cols = 240, n = 120, airK=AstroNotesAtmosphere.targetK();
  const key = [obs.latitude, obs.longitude, eye, target.latitude, target.longitude, s,
    target.parts[0].m].map((v) => v.toFixed(5)).join(",") + JSON.stringify(target.rim || null);
  if (!win?.exactSearch && aimRidgeCache.has(key+airK)) { const cached=aimRidgeCache.get(key+airK);aimRidgeCache.delete(key+airK);aimRidgeCache.set(key+airK,cached);return cached; }
  const pendingKey = key + airK;
  if (!win?.exactSearch && aimRidgePending.has(pendingKey)) return aimRidgePending.get(pendingKey);
  const task = (async () => {
  const pts = [], distances = Array.from({length:n+1},(_,j)=>Math.max(0.15, D - s + (2 * s * j) / n));
  for (let i = 0; i <= cols; i++) {
    const az = az0 - spanAz + (2 * spanAz * i) / cols, destination = AstroNotesTerrain.prepareRidgeDestination(obs.latitude,obs.longitude,az);
    for (let j = 0; j <= n; j++) {
      const d = distances[j];
      const point = destination(d); point.az = az; point.d = d; pts.push(point);
    }
  }
  let el;
  try { el = await AstroNotesTerrain.elevations(pts, { zoom: D > 40 ? 12 : 13, from: obs }); } catch { return null; }
  if(airK!==AstroNotesAtmosphere.targetK())return null;
  const angles=distances.map(d=>AstroNotesTerrain.prepareRidgeElevation(d,eye,{k:airK}));
  const rim = AstroNotesAlign.rimOutline({ ...obs, elevation: eye }, target);
  const summit = aimAirAngle(D, eye, target.parts[0].m);
  const out = [];
  for (let i = 0; i <= cols; i++) {
    const az = pts[i * (n + 1)].az;
    let best = -90;
    for (let j = 0; j <= n; j++) {
      const k = i * (n + 1) + j;
      if (Number.isFinite(el[k])) best = Math.max(best, angles[j](el[k]));
    }
    const rel = ((az - az0 + 540) % 360) - 180;
    if (rim) { const a = rim.at(((az - rim.azimuth + 540) % 360) - 180); if (a !== null) best = Math.max(best, a); }
    // 目標の頂は格子の間に落ちることがあるので、真ん中の列には頂そのものも入れる
    if (Math.abs(rel) <= spanAz / cols) best = Math.max(best, summit);
    out.push([az, best]);
  }
  // 未取得の列を -90° の谷として結ばない。欠測時は輪郭全体を保留し再試行可能にする。
  if (out.some(([, a]) => a === -90)) return null;
  // 火口縁は粗い地形格子から独立して補う。DEMの補間値より低くしない。
  if (rim) {
    const coarse = out.slice();
    for (let i = 0; i <= 120; i++) {
      const rel = rim.min + (rim.max - rim.min) * i / 120;
      const h = rim.at(rel); if (h === null) continue;
      const az = rim.azimuth + rel;
      const x = ((((az - az0 + 540) % 360) - 180) + spanAz) / (2 * spanAz) * cols;
      if (x < 0 || x > cols) continue;
      const lo = Math.min(cols - 1, Math.floor(x)), f = x - lo;
      out.push([az, Math.max(h, coarse[lo][1] * (1-f) + coarse[lo+1][1] * f)]);
    }
    out.sort((a,b) => ((a[0]-az0+540)%360)-((b[0]-az0+540)%360));
  }
  if(!win?.exactSearch)aimRidgeCache.set(key+airK, out);
  while(aimRidgeCache.size>256)aimRidgeCache.delete(aimRidgeCache.keys().next().value);
  return out;
  })().finally(() => { if (aimRidgePending.get(pendingKey) === task) aimRidgePending.delete(pendingKey); });
  if(!win?.exactSearch)aimRidgePending.set(pendingKey, task);
  return task;
}

export {aimLookRidge,aimRidgeCache,aimTerrainBeyond,aimTerrainFront};
