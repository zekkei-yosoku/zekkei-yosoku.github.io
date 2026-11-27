import {bindToolMapLayout,$,S,esc} from '../../ui/presentation-helpers.js';
import {store,viewState} from '../../app/browser-state.js';
import {lightTimingText,moonGlyphAt} from '../forecast/view.js';
import {routeFromHash} from '../../app/navigation.js';
import {aimMapLabel} from '../framing/controller.js';
import {ISS_PRESETS,IssMap,iss,issFromPoint,issRenderSatCard,issSatName,issSetFrom} from './state.js';
import {coordText} from '../places/map-apps.js';
import {aimPlaces} from '../framing/candidates.js';
import {observingPlacesAlong,placeIndex} from '../places/search.js';
import {renderToolAccess,toolAllowed} from '../account/session-and-access.js';
import {showSheet} from '../../app/overlays.js';
/// 選んだ回で月・太陽を横切るところが見える場所。陸上の例があるときに表示。
const issStandPoint = () => issUi.site || issSelected()?.stand || null;
function issCoordUpdate() {
  const st = issStandPoint();
  document.querySelector('.coord-row[data-map="iss"]').hidden = !st;
  $("issCoord").textContent = st ? coordText(st) : "—";
}

/// satellite.js は必要になったときだけ読む（vendor から。CSP は 'self' のまま）
async function issLoadSat() {
  if (iss.sat) return iss.sat;
  const [io, pr, tr] = await Promise.all([
    import("./vendor/satellite/io.js"), import("./vendor/satellite/propagation.js"),
    import("./vendor/satellite/transforms.js")]);
  iss.sat = { twoline2satrec: io.twoline2satrec, propagate: pr.propagate, gstime: pr.gstime,
              eciToEcf: tr.eciToEcf, ecfToLookAngles: tr.ecfToLookAngles };
  return iss.sat;
}

/// 軌道要素。**2時間は使い回す**（CelesTrak は同じ要素を短い間隔で何度も取りに来るのを嫌う）。衛星ごとに持つ
const issTleCache = () => store.get("sorami.issTles", {}) || {};
/// CelesTrak へ。応答が来ないと「計算しています…」のまま止まるので、15秒で諦めて手元の控えへ（2026-10-21 に止まるのを確認）
async function issFetchText(url) {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 15000);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally { clearTimeout(timer); }
}
function issKeepTle(catnr, text) {
  const all = issTleCache();
  all[catnr] = { at: Date.now(), text };
  // 選択肢の3機と、いま選んでいる1機のぶんだけ残す
  const keep = new Set([...ISS_PRESETS.map(([n]) => String(n)), String(iss.catnr), String(catnr)]);
  for (const k of Object.keys(all)) if (!keep.has(k)) delete all[k];
  store.set("sorami.issTles", all);
}
async function issLoadTle(catnr = iss.catnr) {
  // 以前の ISS だけの控え（sorami.issTle）も、取れないときの予備に使う
  const cached = issTleCache()[catnr] || (catnr === 25544 ? store.get("sorami.issTle", null) : null);
  if (cached && Date.now() - cached.at < 2 * 3600000 && cached.text) return AstroNotesISS.parseTle(cached.text);
  try {
    const text = await issFetchText(`https://celestrak.org/NORAD/elements/gp.php?CATNR=${Number(catnr)}&FORMAT=TLE`);
    const tle = AstroNotesISS.parseTle(text);
    if (!tle) throw new Error("軌道要素を読めません");
    issKeepTle(catnr, text);
    return tle;
  } catch (e) {
    // 取れなければ、古くても手元のものを使う（古さは画面に出す）
    return cached && cached.text ? AstroNotesISS.parseTle(cached.text) : null;
  }
}

function issCenterSearch() {
  const point = issFromPoint();
  if (!point) return;
  const zoom = 8 - Math.round(Math.log2(iss.rangeKm / 150));
  IssMap.open(point, zoom);
}

function issToggleBody(body) {
  const wasOrbit = !iss.body;
  iss.body = iss.body === body ? null : body;
  if (wasOrbit && iss.body) issCenterSearch();
  if (!iss.body) issOpenWorld();
  issApply();
}

function issOpenWorld() {
  const canvas = $("issCanvas");
  const fit = Math.min(canvas.clientWidth || 390, (canvas.clientHeight || 600) * 2.2);
  IssMap.open({latitude:0,longitude:0}, Math.max(0,Math.log2(fit/256)-0.12));
}

function issBuildOrbit() {
  const tle = issUi.tle, at = issUi.at;
  const revPerDay = Number(tle?.line2.slice(52,63));
  if (!tle || !Number.isFinite(revPerDay) || revPerDay <= 0 || Math.abs(at-tle.epochMs)>7*issDayMs) {
    issUi.orbit = [];
    return;
  }
  const half = 43200000/revPerDay, key=tle.line1+tle.line2;
  if (issUi.orbit.length && issUi.orbitKey===key && Math.abs(at-issUi.orbitAt)<half/5) return;
  issUi.orbitAt=at; issUi.orbitKey=key;
  issUi.orbit = AstroNotesISS.groundTrack(iss.sat,tle,at-half,at+half,Math.max(1,half/120000));
}

async function issApply() {
  if (!toolAllowed("iss")) return;
  const P = issFromPoint();
  if (!P) return;
  const seq = iss.seq.next();
  const name = issSatName();
  issUi.timeline.stop();
  issUi.moving = false;
  issUi.beforeResults = issUi.at;
  issUi.from = Date.now();
  issUi.state = "loading";
  issUi.site = null;
  if (issUi.orbitCatnr!==iss.catnr) { issUi.tle=null; issUi.orbit=[]; issUi.orbitCatnr=iss.catnr; }
  iss.result = []; iss.pick = -1;
  $("issTle").hidden = true;
  $("issList").innerHTML = `<p class="tiny">計算しています…</p>`;
  issRenderSatCard();
  $("issSatName").textContent = name;
  $("issMoon").setAttribute("aria-pressed", String(iss.body === "moon"));
  $("issMoon").innerHTML = moonGlyphAt(Date.now(), issFromPoint());
  $("issSun").setAttribute("aria-pressed", String(iss.body === "sun"));
  $("issSunWarn").hidden = iss.body !== "sun";
  $("issSuggestionsOpen").hidden = !iss.body;
  $("issCanvas").setAttribute("aria-label", iss.body
    ? `地図。${name}の地上軌跡、現在選んだ時刻の衛星位置、${iss.body === "sun" ? "太陽" : "月"}を横切って見える帯です`
    : `地図。${name}の地上軌跡と日時バーの時刻の衛星の位置です`);
  issRefreshSelection();
  let sat, tle;
  try { [sat, tle] = await Promise.all([issLoadSat(), issLoadTle()]); } catch { sat = null; }
  if (!issCalculationCurrent(seq)) return;
  if (!sat || !tle) {
    issUi.state = "unavailable";
    $("issList").innerHTML = `<p class="tiny">${esc(name)}の軌道要素を取れませんでした。時間をおいて開き直してください。落下や運用終了で軌道要素が配られていない衛星もあります。</p>`;
    issRefreshSelection();
    return;
  }
  const ageH = (Date.now() - tle.epochMs) / 3600000;
  // 軌道要素の古さは、古いとき（1日より前）だけ一言（3日より先の回には「目安」が付く）
  $("issTle").textContent = ageH > 24 ? `軌道要素が${Math.round(ageH / 24)}日前のため目安` : "";
  $("issTle").hidden = !$("issTle").textContent;
  // まず計算中の表示を描き、その後も計算本体が短い区間ごとに処理を譲る。
  await new Promise((r) => setTimeout(r, 0));
  if (!issCalculationCurrent(seq)) return;
  issUi.tle = tle;
  issBuildOrbit();
  if (!iss.body) {
    issUi.state = "orbit";
    issRefreshSelection();
    return;
  }
  return issApplyTransits(seq, sat, tle, P);
}

/// 月・太陽の前を横切る回（2026-09-30 からの計算をそのまま、選んだ衛星に）
const issCalculationCurrent = seq => iss.seq.current(seq) && viewState.iss && toolAllowed("iss");
async function issApplyTransits(seq, sat, tle, P) {
  const current = () => issCalculationCurrent(seq);
  if (!current()) return;
  let rows = [];
  try {
    rows = await AstroNotesISS.transitsAsync(sat, tle, { center: { latitude: P.latitude, longitude: P.longitude },
      radiusKm: iss.rangeKm, fromMs: issUi.from, hours: 168, body: iss.body }, { isCurrent: current });
  } catch (error) { if (error.name === 'AbortError' || !current()) return; rows = []; }
  if (!current()) return;
  // 昼の月も残す。高く昇った昼の月は見えていて、ISS の影は望遠で写る（月面通過の写真の多くは昼）。
  // 空の明るさは行に「昼・薄明・夜」で添える
  iss.result = rows; iss.overWater = 0; iss.standsDone = false;
  issUi.state = "ready";
  issRender();
  issSelectInitial();
  if (!rows.length) return;
  // 立つ場所（陸の上）。地名の表と水域のタイルを読むので、行を先に出してから足す
  for (const r of rows) {
    try {
      r.sites = await issStand(r, sat, tle, { isCurrent: current });
      r.stand = r.sites === null ? null : r.sites?.[0];
    } catch (error) {
      if (error.name === 'AbortError' || !current()) return;
    }
    if (!current()) return;
  }
  // 帯が水の上だけを通る回は、陸から見られないので並べない（何回外したかは書く）
  const picked = rows[iss.pick];
  iss.result = rows.filter((r) => r.stand !== null);
  iss.overWater = rows.length - iss.result.length;
  iss.standsDone = true;
  iss.pick = iss.result.indexOf(picked);
  issRender();
  if (picked && iss.pick < 0 && !issUi.moving) issSelectAt(issUi.at);
  else {
    if (!issUi.moving && picked?.stand && picked.at === issUi.at) issUi.at = picked.stand.at;
    issRefreshSelection();
  }

}

/**
 * ISS の帯の中で、**陸の上に**立てる場所を選ぶ（2026-10-01 ユーザー「観測地点は陸上に。ISS が海の上になっていた」）。
 * 以前は「いまの地点から中心線へいちばん近い点」をそのまま出しており、東京湾や相模湾の上になることがあった。
 *
 *   1. 帯の芯（中心線から半幅の6割以内。軌道要素の誤差でずれても外れにくい）にある、名前のある場所
 *      （ねらうの候補地＝展望地・公園・海岸・川岸など、地名索引＝山・峠・展望地・岬・滝）を、いまの地点から近い順に。
 *      山頂は登らないと立てないので、1.6倍遠いものとして並べる。水の上のもの（橋・桟橋を除く）は外す
 *   2. 無ければ、中心線をいまの地点から近い順にたどって、最初の陸の点（名前なし）
 *   3. それも無ければ（帯が水の上だけを通る）、立つ場所は出さない（null）
 */
async function issStand(r, sat, tle, { isCurrent = () => true, clock = () => performance.now(),
  yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
  const check = () => { if (!isCurrent()) { const error = Error('calculation-cancelled'); error.name = 'AbortError'; throw error; } };
  check();
  let deadline = clock() + 8;
  const pause = async () => { await yieldTask(); check(); deadline = clock() + 8; };
  const P = issFromPoint();
  const F = (la, lo) => [(lo - r.center.longitude) * 111.32 * Math.cos(r.center.latitude * Math.PI / 180), (la - r.center.latitude) * 110.54];
  const track = r.track.map((q) => F(q.latitude, q.longitude));
  const nearest = (la, lo) => {
    const [px, py] = F(la, lo);
    let distance = Infinity, at = r.at;
    for (let k = 0; k + 1 < track.length; k++) {
      const [ax, ay] = track[k], [bx, by] = track[k + 1];
      const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
      const t = Math.max(0, Math.min(1, ((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / L2));
      const d = Math.hypot(px - ax - (bx - ax) * t, py - ay - (by - ay) * t);
      if (d < distance) { distance=d; at=r.track[k].at+(r.track[k+1].at-r.track[k].at)*t; }
    }
    return {distance,at};
  };
  const core = Math.max(0.15, r.halfWidthKm * 0.6);
  const lats = r.track.map((q) => q.latitude), lons = r.track.map((q) => q.longitude);
  const pad = core / 100 + 0.01;
  // The track is unchanged while every candidate place is filtered.
  const minLat = Math.min(...lats) - pad, maxLat = Math.max(...lats) + pad;
  const minLon = Math.min(...lons) - pad * 1.3, maxLon = Math.max(...lons) + pad * 1.3;
  const inBox = (la, lo) => la >= minLat && la <= maxLat && lo >= minLon && lo <= maxLon;
  const named = [];
  const add = (name, kind, la, lo) => {
    if (!name || !inBox(la, lo)) return;
    const {distance:off,at} = nearest(la, lo);
    if (off > core) return;
    const away = AstroNotesTerrain.distanceKm(P.latitude, P.longitude, la, lo);
    if (away > iss.rangeKm) return;
    named.push({ name, kind, latitude: la, longitude: lo, at, offsetKm: off, fromHereKm: away,
      score: away * (kind === "山頂" || kind === "山" ? 1.6 : 1) + off * 2 });
  };
  try {
    const places = await observingPlacesAlong([r.track], {isCurrent, pointMargin:core/90});
    check();
    for (const p of places) { if (clock() >= deadline) await pause(); add(p.name,p.kind,p.latitude,p.longitude); }
  } catch { check(); /* Fall back to registered outlooks and place index. */ }
  try {
    const places = await aimPlaces(); check();
    for (const p of places) { if (clock() >= deadline) await pause(); add(p.name, p.kind, p.latitude, p.longitude); }
  } catch { check(); /* 無くても索引で探す */ }
  try {
    const idx = await placeIndex(); check();
    for (const p of idx.places) { if (clock() >= deadline) await pause(); add(p[1], idx.kinds[p[0]] || "", p[3] / 1e5, p[4] / 1e5); }
  } catch { check(); /* 無くても中心線で探す */ }
  named.sort((a, b) => a.score - b.score);
  // 同じ所が2つの表に入っていることがある。近いもの（300m）は1つに
  const picks = [];
  for (const n of named) {
    if (picks.some((q) => AstroNotesTerrain.distanceKm(q.latitude, q.longitude, n.latitude, n.longitude) < 0.3)) continue;
    picks.push(n);
    if (picks.length >= 12) break;
  }
  // 橋・桟橋も外す（ねらうと違って、ISS は川や海の上から見る理由が無い。陸の公園や展望地を先に出す）
  const water = await AstroNotesTerrain.waterAt(picks);
  check();
  const sites = [];
  let unverified = false;
  for (const [i, point] of picks.entries()) {
    if (water[i] === null) unverified = true;
    if (water[i] === true) continue;
    const time = await AstroNotesISS.transitTimeAt(sat,tle,r.body,point,point.at,{isCurrent});
    if (time.durationS > 0) sites.push({...point,at:time.at,durationS:time.durationS});
    if (sites.length >= 8) break;
  }
  if (sites.length) return sites;
  // 名前のある場所が無い。中心線を、いまの地点から近い順にたどる
  const line = r.track
    .map((q) => ({ ...q,
      fromHereKm: AstroNotesTerrain.distanceKm(P.latitude, P.longitude, q.latitude, q.longitude) }))
    .filter((q) => q.fromHereKm <= iss.rangeKm)
    .sort((a, b) => a.fromHereKm - b.fromHereKm);
  for (let i = 0; i < line.length; i += 12) {
    const batch = line.slice(i, i + 12);
    const w = await AstroNotesTerrain.waterAt(batch);
    check();
    const k = w.findIndex((v) => v === false);
    if (k >= 0) {
      const time=await AstroNotesISS.transitTimeAt(sat,tle,r.body,batch[k],batch[k].at,{isCurrent});
      return [{...batch[k],name:"中心線上の陸地",kind:"",offsetKm:0,at:time.at,durationS:time.durationS}];
    }
    if (w.some(v=>v===null)) unverified=true;
  }
  return unverified ? undefined : null;
}

function issRender() {
  const rows = iss.result;
  const overWater = iss.overWater
    ? `<p class="tiny" style="color:var(--tertiary)">海や湖の上だけを通る回（${iss.overWater}回）は除外</p>` : "";
  if (!rows.length) {
    $("issList").innerHTML = `<p class="tiny">この7日、設定した範囲（${iss.rangeKm}km以内）で${iss.body === "moon" ? "月" : "太陽"}の前を通る回はありません。</p>${overWater}`;
    return;
  }
  $("issList").innerHTML = rows.map((r, i) => {
    const at=issEventAt(r), hms=issHms(at);
    // 立つ場所（陸の上）。探し終わるまでは「探しています」。水の上だけを通る回は並べないので、
    // 探し終わっても無いのは、確かめられなかったとき（通信の失敗など）
    const st = r.stand;
    const where = st ? `<span class="muted">${esc(st.name)} ${r.sites.length > 1 ? `ほか${r.sites.length-1}件` : ""}</span>`
      : `<span class="muted">${iss.standsDone ? "帯を地図で確認" : "観測候補を確認中…"}</span>`;
    const lit = r.illuminated !== null ? ` ・ ${moonGlyphAt(r.at, st || r.center)} 輝面${Math.round(r.illuminated * 100)}%` : "";
    const sky = r.sunAltitude < -6 ? "夜" : r.sunAltitude < 0 ? "薄明" : "昼";
    // 3日より先は軌道要素の誤差で数十秒・数kmずれうる。印だけ付ける
    const rough = r.at - Date.now() > 72 * 3600000 ? `<span class="tiny" style="color:var(--tertiary)">（目安）</span>` : "";
    return `<button class="al-row jump" data-iss="${i}" aria-current="${i === iss.pick}">
      <span class="al-w"><strong>${S.Cal.monthDay(at)}(${S.Cal.weekday(at)}) ${hms}</strong>${rough}
        ${where}
        <span class="tiny">帯の幅 約${(r.halfWidthKm * 2).toFixed(1)}km ・ ${(st?.durationS ?? r.durationS).toFixed(1)}秒</span>
        <span class="tiny">${iss.body === "moon" ? "月" : "太陽"}の方位${Math.round(r.azimuth)}°・高さ${Math.round(r.altitude)}°${lit} ・ ${sky} ・ 衛星まで${r.rangeKm}km</span>
        ${iss.body === "moon" ? `<span class="tiny">${esc(lightTimingText(r.at, st || r.center))}</span>` : ""}</span>
      <span class="tiny">地図で見る →</span></button>`;
  }).join("") + overWater;

}

const ISS_DIR16 = ["北", "北北東", "北東", "東北東", "東", "東南東", "南東", "南南東", "南", "南南西", "南西", "西南西", "西", "西北西", "北西", "北北西"];
const issDir16 = (az) => ISS_DIR16[Math.round(az / 22.5) % 16];
const issHms = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(11, 19);
const issHm = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(11, 16);
const issDayMs = 86400000;
const issUi = { at: Date.now(), from: Date.now(), state: "loading", mode: "time", timeline: null, layout: null, site: null, tle: null, orbit: [] };
const issEventAt = row => row.stand?.at ?? row.at;
const issSelected = () => iss.result[iss.pick];

function issSyncTime(moving = false) {
  ToolDateTimeBar.dateText($("issDate"), issUi.at);
  $("issDate").setAttribute("aria-label", ToolDateTimeBar.label(issUi.at));
  $("issTime").value = issHms(issUi.at);
  ToolDateTimeBar.modeButton($("issScrubMode"), issUi.mode);
  if (issUi.tle) issBuildOrbit();
  if (issUi.state==="orbit") $("issStatus").textContent=issUi.orbit.length
    ? `地上軌跡 ・ ${issSatName()}の位置 ${issHms(issUi.at)}`
    : "この日時の地上軌跡は表示できません";
  if (!moving) issUi.timeline.sync(issUi.at, issUi.mode);
}

function issRefreshSelection() {
  const row=issSelected(), site=issStandPoint();
  const body=iss.body==="moon"?"月":"太陽";
  issCoordUpdate();
  const status=$("issStatus");
  if (issUi.state==="loading") status.textContent="計算しています…";
  else if (issUi.state==="unavailable") status.textContent="軌道要素を取れませんでした";
  else if (issUi.state==="orbit") { /* The scrubber updates the readout for each instant. */ }
  else if (row) {
    status.textContent=`${body}を横切る ${issHms(site?.at ?? row.at)} ・ ${(site?.durationS ?? row.durationS).toFixed(1)}秒${site ? ` ・ ${site.name}` : "（帯の基準点）"}`;
  } else if (AstroNotesSkyMap.dayStart(issUi.at)+issDayMs<=issUi.from ||
             AstroNotesSkyMap.dayStart(issUi.at)>=issUi.from+7*issDayMs) status.textContent="予報の範囲外です";
  else status.textContent=`この日は${body}を横切る候補がありません`;
  for (const button of $("issList").querySelectorAll("[data-iss]")) {
    button.setAttribute("aria-current",String(Number(button.dataset.iss)===iss.pick));
  }
  $("issSites").hidden=!row?.sites?.length;
  $("issSiteList").innerHTML=(row?.sites||[]).map((point,i)=>`<button type="button" class="al-row jump" data-iss-site="${i}" aria-current="${point===site}">
    <span class="al-w"><strong>${esc(point.name)}</strong><span class="muted">${esc(point.kind)} ${issHms(point.at)} ・ ${point.durationS.toFixed(1)}秒</span></span><span class="tiny">地図で見る →</span>
  </button>`).join("");
  issSyncTime(issUi.moving);
  IssMap.redraw();
}

function issSelect(index,recenter) {
  if (index!==iss.pick) issUi.site=null;
  iss.pick=index;
  const row=issSelected();
  if (recenter && row) IssMap.open(row.stand||row.center,10);
  issRequestMapTrack(row);
  issRefreshSelection();
}

function issRequestMapTrack(row) {
  const tle=issUi.tle;
  if (!row || !tle || row.mapTrack || row.mapPending) return;
  const isCurrent=()=>viewState.iss&&toolAllowed("iss")&&issUi.tle===tle&&iss.result.includes(row);
  row.mapPending=true;
  AstroNotesISS.transitMapTrack(iss.sat,tle,row,{isCurrent}).then(track=>{
    if (!isCurrent() || track.length<2) return;
    row.mapTrack=track;
    if (issSelected()===row) IssMap.redraw();
  }).catch(error=>{
    if (error.name!=="AbortError") AstroNotesErrors.note("iss.band",error);
  }).finally(()=>{row.mapPending=false;});
}

function issChooseSite(point, recenter) {
  if (!point) return;
  issUi.site=point;
  issUi.timeline.stop();
  issUi.moving=false;
  issUi.at=point.at;
  if (recenter) IssMap.open(point,12);
  issRefreshSelection();
}

function issSelectAt(at) {
  issUi.moving = false;
  issUi.at = at;
  if (issUi.state !== "ready") { issRefreshSelection(); return; }
  let index = -1, distance = Infinity;
  const day = AstroNotesSkyMap.dayStart(at);
  for (const [i, row] of iss.result.entries()) {
    const t = issEventAt(row), dist = Math.abs(t - at);
    const sameDay = AstroNotesSkyMap.dayStart(t) === day;
    if (sameDay && dist < distance) { distance = dist; index = i; }
  }
  issSelect(index, index >= 0 && index !== iss.pick);
}

function issSelectInitial() {
  if (issUi.moving) { issRefreshSelection(); return; }
  if (issUi.at !== issUi.beforeResults) { issSelectAt(issUi.at); return; }
  const rows = iss.result;
  if (rows.length) {
    issUi.at = issEventAt(rows[0]);
    issSelect(0, true);
  } else issRefreshSelection();
}

function issChooseEvent(index) {
  const row = iss.result[index];
  if (!row) return;
  issUi.timeline.stop();
  issUi.moving = false;
  issUi.at = issEventAt(row);
  issSelect(index, true);
  $("issSuggestions").close();
}

function issAnnotations(mode) {
  const times=iss.result.map(issEventAt);
  if (!times.length) return null;
  return {key:JSON.stringify([iss.body,times]),paint(ctx,{start,end,height,pixelsPerMs}) {
    ctx.fillStyle=iss.body==="sun"?"#ffd282":"#a9dcff";
    for (const at of times) {
      if (at>=start&&at<end) ctx.fillRect((at-start)*pixelsPerMs,height-5,mode==="date"?2:3,5);
    }
  }};
}

function wireIssTime() {
  const footer = $("issTimeFooter"), date = $("issDate"), time = $("issTime");
  const stepTo = (at) => { issUi.timeline.stop(); issSelectAt(at); };
  ToolDateTimeBar.decorate({footer, row: $("issTimeRow"), date, time, prev: $("issPrev"),
    next: $("issNext"), more: $("issTimeMore"), track: $("issTrack"), now: stepTo});
  const calendar = ToolDateTimeBar.calendar({button: date, getAt: () => issUi.at,
    setDay: day => stepTo(day + issUi.at - AstroNotesSkyMap.dayStart(issUi.at))});
  ToolDateTimeBar.editor({button: date, time, dialog: calendar});
  ToolDateTimeBar.details({button: $("issTimeMore"), getText: () =>
    `${ToolDateTimeBar.label(issUi.at)} ${issHms(issUi.at)}（日本時間）\n${$("issStatus").textContent}${
      $("issTle").hidden ? "" : "\n" + $("issTle").textContent}`});
  ToolDateTimeBar.trackPointerFocus(footer, calendar);
  $("issPrev").onclick = () => stepTo(issUi.at - issDayMs);
  $("issNext").onclick = () => stepTo(issUi.at + issDayMs);
  time.onchange = () => {
    const [hour, minute, second=0] = time.value.split(":").map(Number);
    if (Number.isFinite(hour) && Number.isFinite(minute)) stepTo(AstroNotesSkyMap.dayStart(issUi.at) + (hour * 60 + minute) * 60000 + second * 1000);
  };
  const format = (at, mode) => mode === "date" ? S.Cal.monthDay(at) : issHm(at);
  issUi.timeline = AstroNotesScrollTimeline.mount({root: $("issTimeline"), getAt: () => issUi.at,
    getMode: () => issUi.mode, enabled: () => viewState.iss && toolAllowed("iss"),
    getObserver: issFromPoint, sun: (at, point) => AstroNotesAstro.sun(at, point),
    annotations: issAnnotations,
    feedbackEvents:(from,to)=>{
      if (!iss.body) return [];
      const point=issStandPoint()||issFromPoint();
      const observer={latitude:point.latitude,longitude:point.longitude,elevation:0};
      return AstroNotesScrollTimeline.feedbackEventsBetween(from,to,AstroNotesSkyMap.dayStart,day=>
        AstroNotesSkyMap.daily(iss.body,day,observer,(body,at,p)=>{
          const value=body==="moon"?AstroNotesAstro.moon(at,p):AstroNotesAstro.sun(at,p);
          return {altitude:value.geometricAltitude,azimuth:value.azimuth};
        }).events.map(event=>event.at));
    },
    format,
    describe: (at, mode) => mode === "date" ? ToolDateTimeBar.label(at) : issHm(at),
    onChange: at => {
      issUi.moving = true; issUi.at = at; issSyncTime(true);
      if (issUi.tle) IssMap.redraw();
    },
    onSettle: issSelectAt});
  $("issScrubMode").onclick = () => {
    issUi.timeline.stop();
    issUi.mode = ToolDateTimeBar.nextMode(issUi.mode);
    issSelectAt(issUi.at);
  };
  issUi.layout = bindToolMapLayout($("issView"), footer, () => IssMap.redraw());
}

// ---------------------------------------------------------------- 衛星を選ぶ（2026-10-21）
//
// ユーザー「なんで衛星の中で選択できないの？ジャンル分けして検索も出来るようにしたら探しやすくなる」「日本語名一覧とかないの？」。
// 上に名前・番号の検索、下に CelesTrak の GROUP ごとのジャンル。ジャンルは押したときだけ取る（2時間使い回す）。
// 日本語名は Wikidata（CC0）の衛星カタログ番号と日本語ラベルから作った表（build-satellite-names.mjs → data/satellite-names-ja.json）。
// 「今夜見える」はジャンルの中で解く。肉眼で見える衛星が多いのは宇宙ステーションと明るい衛星だけなので、その2つにだけ出す
const ISS_GROUPS = [
  ["stations", "宇宙ステーション", true], ["visual", "明るい衛星", true], ["weather", "気象", false],
  ["gnss", "測位（GPS・みちびき など）", false], ["science", "科学", false], ["amateur", "アマチュア無線", false]];
const issPick = { group: "all", list: [], remote: null, seq: AstroNotesLibrary.gate(), remoteSeq: AstroNotesLibrary.gate(), visSeq: AstroNotesLibrary.gate(), visible: null, timer: 0, limit: 200 };
/// お気に入りの衛星（この端末に保存。{ catnr, name }）
const issFavSats = () => { const v = store.get("sorami.issFavSats", []); return Array.isArray(v) ? v.filter((x) => x && Number.isInteger(x.catnr)) : []; };
function issToggleFav(catnr, name) {
  const favs = issFavSats(), at = favs.findIndex((x) => x.catnr === catnr);
  if (at >= 0) favs.splice(at, 1); else favs.unshift({ catnr, name: String(name || "").slice(0, 80) });
  store.set("sorami.issFavSats", favs);
  issPickRender();
}
let issNamesPromise = null;
/// 番号→{ ja, en, alias } の表。取れなくても英語名で動く（次に開いたときにまた読む）
function issLoadNames() {
  if (!issNamesPromise) {
    issNamesPromise = fetch("data/satellite-names-ja.json").then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((d) => { iss.names = new Map(d.names.map(([n, ja, en, alias]) => [n, { ja, en, alias: alias || [] }])); return iss.names; })
      .catch(() => { issNamesPromise = null; return iss.names || new Map(); });
  }
  return issNamesPromise;
}
/// 検索のために揃える: 全角半角・大文字小文字・ひらがな→カタカナ。空白と区切りの記号は外す
const issFold = (s) => String(s || "").normalize("NFKC").toLowerCase()
  .replace(/[ぁ-ゖ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60))
  .replace(/[\s\-_()（）・.,/]/g, "");
/// 一覧の1行の名前: 日本語名（よく見る3機の呼び名・Wikidata）を主に、CelesTrak の英語名と番号を添える
function issPickLabel(catnr, celestrakName) {
  const p = ISS_PRESETS.find(([n]) => n === catnr);
  const w = iss.names && iss.names.get(catnr);
  const main = p ? p[1] : w ? w.ja : celestrakName || `衛星 ${catnr}`;
  const en = celestrakName || (w && w.en) || "";
  return { main, sub: [p || w ? en : "", `衛星番号 ${catnr}`].filter(Boolean).join(" ・ ") };
}

/// 衛星を選ぶページへ。戻ってきたときに同じ位置へ戻すため、いまのスクロール位置を覚える
function issPickOpen() {
  $("issPickGroups").innerHTML = [["all", "すべて"], ["fav", "お気に入り"], ...ISS_GROUPS].map(([g, label]) =>
    `<button type="button" class="chip" data-group="${g}" aria-pressed="${issPick.group === g}">${esc(label)}</button>`).join("");
  for (const b of $("issPickGroups").querySelectorAll("[data-group]")) b.onclick = () => issPickGroup(b.dataset.group);
  $("issPickQuery").value = "";
  showSheet($("issPickSheet"));
  issPickGroup(issPick.group || "all");
  issLoadNames().then(() => { if ($("issPickSheet").open) issPickRender(); });
}
function issPickDone() { $("issPickSheet").close(); }

/// ジャンルの軌道要素（2時間使い回す）。取れなければ古い控え、それも無ければ null
async function issLoadGroup(g) {
  const key = `sorami.issGroup.${g}`, cached = store.get(key, null);
  if (cached && Date.now() - cached.at < 2 * 3600000 && cached.text) return AstroNotesISS.parseTleList(cached.text);
  try {
    const text = await issFetchText(`https://celestrak.org/NORAD/elements/gp.php?GROUP=${encodeURIComponent(g)}&FORMAT=TLE`);
    const list = AstroNotesISS.parseTleList(text);
    if (list.length) store.set(key, { at: Date.now(), text });   // 大きいジャンルは保存できないことがある（そのときは次も取りに行く）
    return list;
  } catch { return cached && cached.text ? AstroNotesISS.parseTleList(cached.text) : null; }
}

/// ジャンルを開く。all は6ジャンルを合わせた一覧、fav はお気に入り（取得しない）
async function issPickGroup(g) {
  const seq = issPick.seq.next();
  issPick.group = g; issPick.list = []; issPick.visible = null; issPick.visSeq.cancel(); issPick.limit = 200;
  for (const b of $("issPickGroups").querySelectorAll("[data-group]")) b.setAttribute("aria-pressed", String(b.dataset.group === g));
  $("issPickVisible").hidden = true;
  if (g === "fav") { issPick.loading = false; issPickRender(); return; }
  // 読み終わるのを待たずに描く（お気に入りと名前・番号の検索はすぐ使える。取れないときは15秒待つことになる）
  issPick.loading = true; issPickRender();
  const groups = g === "all" ? ISS_GROUPS.map(([k]) => k) : [g];
  const lists = await Promise.all(groups.map(issLoadGroup));
  if (!issPick.seq.current(seq)) return;
  issPick.loading = false;
  const seen = new Set(), list = [];
  for (const l of lists) for (const t of l || []) if (!seen.has(t.catnr)) { seen.add(t.catnr); list.push(t); }
  issPick.list = list;
  issPick.failed = lists.filter((l) => !l || !l.length).length;
  if (g !== "all") { $("issPickVisible").hidden = !list.length || !ISS_GROUPS.find(([k]) => k === g)[2]; $("issPickVisible").disabled = false; }
  issPickRender();
}

/// CelesTrak の名前（英語）で探す。日本語名の表に無い衛星もこれで見つかる
async function issPickRemote(q) {
  const seq = issPick.remoteSeq.next();
  issPick.remote = { q, list: undefined };
  issPickRender();
  let list = null;
  try { list = AstroNotesISS.parseTleList(await issFetchText(`https://celestrak.org/NORAD/elements/gp.php?NAME=${encodeURIComponent(q)}&FORMAT=TLE`)); }
  catch { list = null; }
  if (!issPick.remoteSeq.current(seq)) return;
  issPick.remote = { q, list };
  issPickRender();
}

function issPickRender() {
  const q = $("issPickQuery").value.trim(), f = issFold(q), favs = issFavSats(), favSet = new Set(favs.map((x) => x.catnr));
  const rows = [], seen = new Set();
  const add = (catnr, tle, name, head) => { if (!catnr || seen.has(catnr)) return; seen.add(catnr); rows.push({ catnr, tle, name, head }); };
  const tleOf = (n) => issPick.list.find((t) => t.catnr === n) || (issPick.remote && issPick.remote.list || []).find((t) => t.catnr === n);
  const wikiHit = (catnr) => { const w = iss.names && iss.names.get(catnr); return !!w && [w.ja, w.en, ...w.alias].some((s) => issFold(s).includes(f)); };
  const hit = (catnr, name) => issFold(name).includes(f) || wikiHit(catnr) || String(catnr) === q;
  const label = ISS_GROUPS.find(([k]) => k === issPick.group)?.[1];
  let info = "", visibleRows = null;
  if (!q && issPick.visible) visibleRows = issPick.visible;
  else if (issPick.group === "fav") {
    for (const x of favs) if (!q || hit(x.catnr, x.name)) add(x.catnr, tleOf(x.catnr), x.name);
    info = favs.length ? `お気に入り：${favs.length}機` : "お気に入りはまだありません。一覧の☆で追加できます。";
  } else {
    // すべて: お気に入りを先に、そのあと一覧（日本語名のあるものを五十音順、ほかは英語名の順）
    if (issPick.group === "all") for (const x of favs) if (!q || hit(x.catnr, x.name)) add(x.catnr, tleOf(x.catnr), x.name, "お気に入り");
    const ja = (t) => iss.names && iss.names.get(t.catnr)?.ja;
    const sorted = [...issPick.list].sort((a, b) => (ja(a) ? 0 : 1) - (ja(b) ? 0 : 1) || (ja(a) || a.name).localeCompare(ja(b) || b.name, "ja"));
    let first = true;
    for (const t of sorted) if (!q || hit(t.catnr, t.name)) { add(t.catnr, t, t.name, first && issPick.group === "all" && favs.length ? "すべて" : undefined); first = false; }
    if (q) {
      if (/^\d{1,6}$/.test(q)) add(Number(q), tleOf(Number(q)));
      // 一覧に無い衛星も日本語名の表から（すべてのとき）
      if (issPick.group === "all") for (const [n] of iss.names || []) if (wikiHit(n)) add(n, tleOf(n));
      if (issPick.remote && issPick.remote.q === q && issPick.remote.list) for (const t of issPick.remote.list) add(t.catnr, t);
    }
    const n = issPick.list.length;
    info = q ? (rows.length ? `${rows.length}件` : "見つかりません。") + (issPick.group !== "all" ? `（${label}の中）` : "")
      : issPick.group === "all" ? (n ? `すべて：${n}機` : "") : `${label}：${n}機`;
    if (issPick.loading) info = (q ? info + " " : "") + "一覧を読んでいます…";
    else if (!n && issPick.group !== "fav") info = (issPick.group === "all" ? "衛星の一覧" : "このジャンルの軌道要素") + "を取れませんでした。名前や番号で探すことはできます。" + (info && q ? ` ${info}` : "");
    else if (issPick.group === "all" && issPick.failed) info += `（${issPick.failed}ジャンルは取れませんでした）`;
    if (q && issPick.remote && issPick.remote.q === q && issPick.remote.list === undefined) info += " CelesTrak で探しています…";
    if (q && issPick.remote && issPick.remote.q === q && issPick.remote.list === null) info += " CelesTrak で探せませんでした。";
  }
  $("issPickInfo").textContent = visibleRows ? `これから24時間、${issFromPoint().name}で見える回（早い順）` : info;
  const canRemote = q && !visibleRows && /[a-z]/i.test(q) && !(issPick.remote && issPick.remote.q === q);
  const list = visibleRows
    ? visibleRows.map(({ tle, pass, with: others }) => {
      const v = pass.visible, { main } = issPickLabel(tle.catnr, tle.name);
      const names = others.map((t) => issPickLabel(t.catnr, t.name).main);
      const together = others.length ? ` ・ ほか${others.length}機が一緒に通る（${names.slice(0, 2).join("・")}${names.length > 2 ? " など" : ""}）` : "";
      return { catnr: tle.catnr, tle, main, sub: `${S.Cal.monthDay(v.start.at)}(${S.Cal.weekday(v.start.at)}) ${issHm(v.start.at)} ・ ${issDir16(v.start.azimuth)}→${issDir16(v.end.azimuth)} ・ 最大仰角${Math.round(v.max.elevation)}°${together}` };
    })
    // お気に入りに残した名前は日本語名のことがある。表にある衛星は表の英語名を添える（同じ名前を2回出さない）
    : rows.map(({ catnr, tle, name, head }) => ({ catnr, tle, head, ...issPickLabel(catnr, (tle && tle.name)
      || (ISS_PRESETS.some(([n]) => n === catnr) || iss.names?.has(catnr) ? "" : name)) }));
  if (visibleRows && !list.length) $("issPickInfo").textContent = `これから24時間、${issFromPoint().name}でこのジャンルの衛星が見える回はありません。`;
  // 多いときは200件ずつ（すべてで1000機ほど。一度に並べると重い）
  const shown = list.slice(0, issPick.limit);
  $("issPickList").innerHTML = shown.map((r, i) => `${r.head ? `<h3 class="iss-pick-head">${esc(r.head)}</h3>` : ""}<div class="iss-pick-row">
      <button class="al-row jump" data-pick="${i}"${r.catnr === iss.catnr ? ' aria-current="true"' : ""}>
        <span class="al-w"><strong>${esc(r.main)}</strong><span class="tiny">${esc(r.sub)}</span></span>
        <span class="tiny">${r.catnr === iss.catnr ? "選んでいます" : "選ぶ →"}</span></button>
      <button type="button" class="iss-star" data-star="${i}" aria-pressed="${favSet.has(r.catnr)}" aria-label="${esc(r.main)}を${favSet.has(r.catnr) ? "お気に入りから外す" : "お気に入りに追加"}">${favSet.has(r.catnr) ? "★" : "☆"}</button></div>`).join("")
    + (canRemote ? `<button type="button" class="fav-btn" id="issPickRemoteRun" style="margin-top:8px">CelesTrak で英語名「${esc(q)}」を探す</button>` : "");
  $("issPickMore").hidden = list.length <= issPick.limit;
  $("issPickMore").textContent = `さらに表示（あと${Math.max(0, list.length - issPick.limit)}機）`;
  for (const el of $("issPickList").querySelectorAll("[data-pick]")) el.onclick = () => { const r = shown[+el.dataset.pick]; issChoose(r.catnr, r.tle); };
  for (const el of $("issPickList").querySelectorAll("[data-star]")) el.onclick = () => { const r = shown[+el.dataset.star]; issToggleFav(r.catnr, r.main); };
  if (canRemote) $("issPickRemoteRun").onclick = () => issPickRemote(q);
}

/// 選ぶ。軌道要素が手元にあれば取り直さない
function issChoose(catnr, tle) {
  iss.catnr = catnr;
  if (!ISS_PRESETS.some(([n]) => n === catnr)) {
    iss.extra = { catnr, name: (tle && tle.name) || (iss.names && iss.names.get(catnr) && iss.names.get(catnr).en) || `衛星 ${catnr}` };
    store.set("sorami.issSatExtra", iss.extra);
  }
  store.set("sorami.issSat", catnr);
  if (tle) issKeepTle(catnr, `${tle.name}\n${tle.line1}\n${tle.line2}`);
  issPickDone();
  issApply();
}

/// 開いているジャンルで、これから24時間に見える回。全機を順に解くので押したときだけ
async function issPickFindVisible() {
  const seq = issPick.visSeq.next(), P = issFromPoint(), list = issPick.list;
  const current = () => issPick.visSeq.current(seq) && viewState.iss && $("issPickSheet").open && toolAllowed('iss');
  $("issPickVisible").disabled = true;   // 押した瞬間に止める（計算の部品を読む間に2回目が走らないように）
  let sat = null;
  try { sat = await issLoadSat(); } catch { sat = null; }
  if (!current() || !P || !list.length) { $("issPickVisible").disabled = false; return; }
  if (!sat) { $("issPickInfo").textContent = "計算の部品を読めませんでした。もう一度押してください。"; $("issPickVisible").disabled = false; return; }
  $("issPickQuery").value = "";
  const found = [], from = Date.now();
  const observer = { latitude: P.latitude, longitude: P.longitude, elevation: P.elevation || 0 };
  let deadline = performance.now() + 8;
  for (let i = 0; i < list.length; i++) {
    if (!current()) return;
    try {
      const passes = await AstroNotesISS.passesAsync(sat, list[i], { observer, fromMs: from, hours: 24, stepS: 60, minEl: 15 }, { isCurrent: current });
      if (!current()) return;
      for (const p of passes) {
        if (p.visible) found.push({ tle: list[i], pass: p });
      }
    } catch (error) { if (error.name === 'AbortError' || !current()) return; /* 解けない要素（落下直前など）は飛ばす */ }
    if (performance.now() >= deadline) {
      $("issPickInfo").textContent = `計算しています…（${i + 1}/${list.length}機）`;
      await new Promise((r) => setTimeout(r, 0));
      if (!current()) return;
      deadline = performance.now() + 8;
    }
  }
  if (!current()) return;
  // 並びは「見え始めの分」→ よく見る3機 → 日本語名のある衛星 → 衛星番号。
  // 2026-10-21 ユーザー「連打すると順番が変わる」: ISS にドッキング中の宇宙船など一緒に飛ぶ機体は見え始めが1秒も違わず、
  // 押した時刻で計算の刻みがずれるたびに前後が入れ替わっていた（0.3〜0.6秒差の2機で再現）。秒は画面に出していないので分でそろえる
  const rank = (t) => (ISS_PRESETS.some(([n]) => n === t.catnr) ? 0 : iss.names && iss.names.has(t.catnr) ? 1 : 2);
  found.sort((a, b) => Math.floor(a.pass.visible.start.at / 60000) - Math.floor(b.pass.visible.start.at / 60000)
    || rank(a.tle) - rank(b.tle) || a.tle.catnr - b.tle.catnr);
  // 同じ分に同じ方角を同じ高さで通る機体は、空では1つの光（ISS とドッキング中の宇宙船など）。1行にまとめ、並びの先頭（よく見る・日本語名あり）を代表に
  // （2026-10-21 ユーザー採用「全部出していいよ」）
  const merged = [];
  for (const f of found) {
    const v = f.pass.visible, minute = Math.floor(v.start.at / 60000);
    const g = merged.find((x) => x.minute === minute && issDir16(x.pass.visible.start.azimuth) === issDir16(v.start.azimuth)
      && issDir16(x.pass.visible.end.azimuth) === issDir16(v.end.azimuth) && Math.abs(x.pass.visible.max.elevation - v.max.elevation) <= 2);
    if (g) g.with.push(f.tle); else merged.push({ ...f, minute, with: [] });
  }
  issPick.visible = merged.slice(0, 40);
  $("issPickVisible").disabled = false;
  issPickRender();
}

function issDrawOrbit(ctx,project,width,height) {
  if (!issUi.tle || !issUi.orbit.length) return;
  ctx.save();
  ctx.beginPath();
  let prev=null;
  for (const q of issUi.orbit) {
    const [x,y]=project(q.latitude,q.longitude);
    if (prev && Math.abs(q.longitude-prev.longitude)<=180) ctx.lineTo(x,y); else ctx.moveTo(x,y);
    prev=q;
  }
  ctx.lineJoin="round";ctx.lineCap="round";
  if (iss.body) ctx.setLineDash([4,5]);
  ctx.strokeStyle=iss.body?"#f7fbff":"#17232c";ctx.lineWidth=iss.body?3:4;ctx.stroke();
  ctx.strokeStyle=iss.body?"#536779":"#76b7ff";ctx.lineWidth=iss.body?1.4:2;ctx.stroke();
  ctx.setLineDash([]);
  const at=issUi.at;
  const q=AstroNotesISS.groundTrack(iss.sat,issUi.tle,at,at)[0];
  if(q) {
    const [x,y]=project(q.latitude,q.longitude);
    if(x>=0&&x<=width&&y>=0&&y<=height){
      ctx.beginPath();ctx.arc(x,y,6,0,Math.PI*2);
      ctx.fillStyle="#76b7ff";ctx.fill();ctx.strokeStyle="#fff";ctx.lineWidth=2;ctx.stroke();
      aimMapLabel(ctx,x,y-16,`${issSatName()} ${issHms(at)}`,"#fff",width,height,"center");
    }
  }
  ctx.restore();
}

IssMap.setOverlay((ctx, {project,width,height})=>{
  issDrawOrbit(ctx,project,width,height);
  const row=issSelected();
  if (!row) return;
  const color=getComputedStyle(document.documentElement).getPropertyValue(iss.body==="moon"?"--ray-moon":"--ray-sun").trim()||"#2f7fd0";
  const track=row.mapTrack||row.track;
  const nodes=track.map(q=>{
    const [x,y]=project(q.latitude,q.longitude);
    const [,edge]=project(q.latitude+(q.halfWidthKm??row.halfWidthKm)/111.2,q.longitude);
    return {x,y,half:Math.max(1,Math.abs(edge-y)),t:q.at,lon:q.longitude};
  });
  const runs=[[]];
  for (const p of nodes) {
    const run=runs[runs.length-1];
    if (run.length && Math.abs(p.lon-run[run.length-1].lon)>180) runs.push([p]); else run.push(p);
  }
  ctx.save();
  ctx.lineJoin="round";ctx.lineCap="round";
  for (const run of runs) {
    if (run.length<2) continue;
    const sides=[[],[]];
    for (const [i,p] of run.entries()) {
      const a=run[Math.max(0,i-1)],b=run[Math.min(run.length-1,i+1)];
      const dx=b.x-a.x,dy=b.y-a.y,n=Math.hypot(dx,dy)||1;
      sides[0].push([p.x-dy*p.half/n,p.y+dx*p.half/n]);
      sides[1].push([p.x+dy*p.half/n,p.y-dx*p.half/n]);
    }
    ctx.beginPath();
    for (const [i,[x,y]] of [...sides[0],...sides[1].reverse()].entries()) i?ctx.lineTo(x,y):ctx.moveTo(x,y);
    ctx.closePath();ctx.fillStyle=color;ctx.globalAlpha=.28;ctx.fill();ctx.globalAlpha=1;
    ctx.beginPath();
    for (const [i,p] of run.entries()) i?ctx.lineTo(p.x,p.y):ctx.moveTo(p.x,p.y);
    ctx.strokeStyle="#17232c";ctx.lineWidth=4;ctx.stroke();
    ctx.strokeStyle=color;ctx.lineWidth=2;ctx.stroke();
  }
  const chosen=issStandPoint(), keep=[];
  for (const p of [chosen,...(row.sites||[])]) {
    if (!p) continue;
    const [x,y]=project(p.latitude,p.longitude);
    if (x<5||x>width-5||y<5||y>height-5||keep.some(q=>Math.hypot(q.x-x,q.y-y)<14)) continue;
    keep.push({x,y});
    ctx.beginPath();ctx.arc(x,y,p===chosen?6:4,0,Math.PI*2);
    ctx.fillStyle=color;ctx.fill();ctx.lineWidth=2;ctx.strokeStyle="#fff";ctx.stroke();
    if (p===chosen) aimMapLabel(ctx,x,y-17,`${p.name} ${issHms(p.at)}`,"#fff",width,height,"center");
  }
  const labels=[];
  for (const p of nodes) {
    if (p.x<39||p.x>width-78||p.y<97||p.y>height-88||
        keep.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<85)||
        labels.some(q=>Math.hypot(q.x-p.x,q.y-p.y)<112)) continue;
    aimMapLabel(ctx,p.x,p.y-12,issHms(p.t),"#fff",width,height,"center");
    labels.push(p);
    if (labels.length>=3) break;
  }
  ctx.restore();
});
IssMap.onPick((_point,pixel)=>{
  let nearest=null,distance=19;
  for (const site of issSelected()?.sites||[]) {
    const [x,y]=IssMap.project(site.latitude,site.longitude), d=Math.hypot(x-pixel.x,y-pixel.y);
    if (d<distance) { nearest=site; distance=d; }
  }
  issChooseSite(nearest,false);
});

function openIss() {
  if (!renderToolAccess("iss")) { iss.seq.cancel(); return; }
  // 以前の「衛星を選ぶ」の道（#/iss/pick）で開かれたら、人工衛星の画面にして衛星を選ぶページを重ねる
  const picking = !!routeFromHash()?.issPick;
  if (picking) history.replaceState(history.state, "", "#/iss");
  if (!iss.wired) {
    iss.wired = true;
    wireIssTime();
    $("issMoon").onclick = () => issToggleBody("moon");
    $("issSun").onclick = () => issToggleBody("sun");
    $("issRange").onchange = () => {
      iss.rangeKm = Number($("issRange").value) || 150;
      issCenterSearch();
      issApply();
    };
    $("issSearchHere").onclick = () => {
      $("issSuggestions").close();
      issSetFrom(IssMap.center());
    };
    $("issSatButton").onclick = () => issPickOpen();
    $("issPickClose").onclick = () => issPickDone();
    $("issPickMore").onclick = () => { issPick.limit += 200; issPickRender(); };
    $("issPickQuery").oninput = () => { clearTimeout(issPick.timer); issPick.timer = setTimeout(issPickRender, 150); };
    $("issPickVisible").onclick = () => issPickFindVisible();
    $("issSuggestionsOpen").onclick = () => showSheet($("issSuggestions"));
    $("issSuggestionsClose").onclick = () => $("issSuggestions").close();
    $("issSiteList").onclick = e => {
      const button=e.target.closest("[data-iss-site]");
      if (!button) return;
      issChooseSite(issSelected()?.sites?.[Number(button.dataset.issSite)],true);
      $("issSuggestions").close();
    };
    $("issList").onclick = e => {
      const button = e.target.closest("[data-iss]");
      if (button) issChooseEvent(Number(button.dataset.iss));
    };

  }
  // 日本語名の表は、読めたらカードと一覧の名前を差し替える（読めなくても英語名で動く）
  issLoadNames().then(() => { if (viewState.iss) { issRenderSatCard(); $("issSatName").textContent = issSatName(); } });
  requestAnimationFrame(() => {
    if (!viewState.iss || !toolAllowed("iss")) return;
    issUi.layout();
    if (issSelected()) return;
    if (iss.body) issCenterSearch(); else issOpenWorld();
    requestAnimationFrame(() => IssMap.redraw());
  });
  issApply();
  if (picking) issPickOpen();
}

export {issApply,issPick,issStandPoint,openIss};
