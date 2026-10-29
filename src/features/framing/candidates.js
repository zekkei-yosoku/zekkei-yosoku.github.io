// ---------------------------------------------------------------- その日の候補地（2026-09-30）
//
// 線だけでは「その日、どこへ行けばよいか」が分からない
// （ユーザー指摘「月丼みたいに、その日の観測に適した場所を出して」）。
// 立てる場所（data/aim-places.json：展望地・山頂・峠・橋・公園・海岸・桟橋・展望台。OSM から作って同梱）
// の中から、その日の線に掛かるものを拾い、**そこに立って本当に重なるかを解き直す**（AstroNotesAlign.candidates）。
// 地形で目標が隠れる場所は外す（建物は見ていない）。
let aimPlacesPromise = null;
function aimPlaces() {
  if (!aimPlacesPromise) {
    aimPlacesPromise = fetch("data/aim-viewpoints.json")
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(j => {
        if (j.version !== 1 || !Array.isArray(j.places)) throw new Error("候補地データを確認できません");
        return j.places.filter(p => p && typeof p.id === "string" && typeof p.name === "string"
          && Number.isFinite(p.latitude) && Math.abs(p.latitude) <= 90
          && Number.isFinite(p.longitude) && Math.abs(p.longitude) <= 180
          && p.shape === "point" && p.heightKnown === true && Number.isFinite(p.deckM)
          && p.deckM >= 0 && p.deckM <= 700 && Array.isArray(p.targetIds)
          && p.sightline?.status === "verified" && /^https:\/\//.test(p.sightline.source || ""));
      }).catch(e => { aimPlacesPromise = null; throw e; });
  }
  return aimPlacesPromise;
}
const aimCandidateEye = p => AstroNotesAlign.placeEyeM(p);
function aimCandidateAccessible(place, at) {
  const access = place.access;
  if (!access || access.type === "outdoor") return true;
  if (!Number.isFinite(at)) return false;
  const date = new Date(at + 9 * 3600000), minute = date.getUTCHours() * 60 + date.getUTCMinutes();
  if (!(minute >= access.openMinute && minute < access.closeMinute)) return false;
  if (access.type === "nerima") {
    const month = date.getUTCMonth() + 1, day = date.getUTCDate();
    if (month === 12 && day >= 29 || month === 1 && day <= 3) return false;
    if (date.getUTCDay() === 0 && day >= 22 && day <= 28) return false;
  }
  if (access.type === "tocho-south") {
    const year = date.getUTCFullYear(), month = date.getUTCMonth(), day = date.getUTCDate();
    if (month === 11 && day >= 29 || month === 0 && day >= 2 && day <= 3) return false;
    const first = 1 + (2 - new Date(Date.UTC(year, month, 1)).getUTCDay() + 7) % 7;
    const calendar = access.holidayCalendar;
    for (const regularDay of [first, first + 14]) {
      let closure = new Date(Date.UTC(year, month, regularDay));
      if (!(calendar?.years || []).includes(year)) {
        // 祝日表未公表の年は、定期休室と振替の可能性がある平日を確認済みにしない。
        const delta = (date - closure) / 86400000;
        if (delta >= 0 && delta < 4 && date.getUTCDay() >= 2 && date.getUTCDay() <= 5) return false;
        continue;
      }
      while (closure.getUTCDay() === 0 || closure.getUTCDay() === 6
        || calendar.dates.includes(closure.toISOString().slice(0, 10))) closure.setUTCDate(closure.getUTCDate() + 1);
      if (day === closure.getUTCDate() && month === closure.getUTCMonth()) return false;
    }
  }
  // 施設の臨時休館・予約・天候による屋上閉鎖は個別の案内を併記する。
  return true;
}

// 並べる順。**見通しの良い種類を先に**（公園は木や建物に囲まれやすい）。
// 富士山は遠くから高い所越しに見るので山・展望地・海岸、塔は街の中なので川岸・橋・水辺が向く
const AIM_KIND_WEIGHT = {
  fuji: { 定番: 1, 展望台: 0.95, 展望地: 0.95, 山頂: 0.9, 海岸: 0.9, 峠: 0.85, 桟橋: 0.85, 橋: 0.8, 川岸: 0.75, 公園: 0.7 },
  tower: { 展望台: 0.95, 川岸: 0.95, 橋: 0.9, 海岸: 0.9, 展望地: 0.9, 桟橋: 0.85, 山頂: 0.85, 峠: 0.8, 公園: 0.7 },
};
const AIM_OPEN_NAME = /展望|見晴|富士見|眺望|丘|河川敷|緑地|海浜|臨海|親水|水辺|湖|浜|岬|堤/;
function aimCandScore(c) {
  let s = ({ center: 1, overlap: 0.85, graze: 0.5 })[c.rank] || 0;
  s *= AIM_KIND_WEIGHT[aimIsFuji() ? "fuji" : "tower"][c.place.kind] ?? 0.7;
  // 塔は見上げ角が小さい（遠い）ほど、手前の建物や木に隠れやすい。3°未満は下げる（1.8°で6割）
  if (!aimIsFuji()) s *= Math.min(1, Math.max(0.6, c.targetAngle / 3));
  if (c.place.kind === "公園" && AIM_OPEN_NAME.test(c.place.name)) s *= 1.12;
  if (c.place.kind === "展望地" && !c.place.name) s *= 0.9;
  if (aim.body === "moon") s *= c.sunAltitude < -6 ? 1 : 0.85;
  return s;
}
const AIM_RANK_LABEL = { center: "ど真ん中", overlap: "重なる", graze: "縁がかすめる" };
/// 選んだ合わせ方どおりに重なる形の言い方（候補地は合わせ方どおりのものだけ出す。2026-10-02）
function aimFitPhrase() {
  if(aim.matchMode === "overlap")return "対象に重なる";
  const top = aimIsMountain(aim.target) ? "山頂" : "先端";
  return aim.limb === "onTop" ? `下の縁が${top}に乗る` : aim.limb === "behind" ? `上の縁が${top}に重なる` : `真ん中が${top}に重なる`;
}
/// この場所での実際の通り方（中心の高さ − 先端の高さ ＝ gap）。半径の2割以内なら、その縁が触れると言う
function aimPassage(e) {
  const top = aimIsMountain(aim.target) ? "山頂" : "先端", r = e.radius, g = e.gap, near = AstroNotesAlign.LIMB_FIT * r;
  if (!AstroNotesBodies.definition(aim.body).limbs) return `中心が${top}の${Math.abs(g).toFixed(2)}°${g > 0 ? "上" : "下"}を通る`;
  if (Math.abs(g - r) <= near) return `下の縁が${top}に乗る`;
  if (Math.abs(g) <= near) return `真ん中が${top}を通る`;
  if (Math.abs(g + r) <= near) return `上の縁が${top}に重なる`;
  return `中心が${top}の${Math.abs(g).toFixed(2)}°${g > 0 ? "上" : "下"}を通る`;
}
const AIM_DIR8 = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
/**
 * 見え方の図（1つ）に描く場面を決めて描く（2026-10-03 ユーザー「どこに重ねるかを変えても見え方が変わらないのと、見え方が二箇所にあるのはなんで？」）。
 *   1. 候補地を選んでいれば、その候補地（重なりを解いた立つ点・時刻）
 *   2. 無ければ、観測地点の近くで**選んだ合わせ方がぴったりになる計算上の地点**（その日の線の上で、観測地点と同じ距離の点）。
 *      側は、その日に観測地点で重なる回があればその側、無ければ候補地で見ている側
 * 図の上の一行に「どこから・いつ・どう重なるか」を書く（Codex: 何を描いているかを図の中身だけで推測させない）。
 * 合わせ方・日付・候補地のどれを替えても、ここで描き直すので図が変わる
 */
async function aimUpdateLook() {
  if(globalThis.TrialExplore?.ownsScene?.()??globalThis.TrialExplore?.active()){globalThis.TrialExplore.sync();return;}
  const seq = ++aim.lookSeq;
  const host = $("aimLook"), t = aim.target;
  host._planKey = null;
  if (!t || !(t.parts || []).length) { host.hidden = true; return; }
  if (aim.wantSpot) return;
  // 月は空の明るさが大事（2026-10-01 ユーザー「日の出何分後とか月の出何分後とかの情報をサクッと書いておいてほしい」）
  const light = (at, o) => {
    if (!AstroNotesBodies.definition(aim.body).limbs) {
      const sky = AstroNotesBodies.sky(AstroNotesAstro.sun(at, o).geometricAltitude);
      return `${sky}${aim.body === "saturn" ? " ・ 土星本体（環を除く）" : ""}`;
    }
    if (aim.body !== "moon") return null;
    let lit = "";
    try { lit = ` 輝面 ${Math.round(AstroNotesAstro.moon(at, o).illuminatedFraction * 100)}%`; } catch { lit = ""; }
    return [`${iconFor("moon", at, { text: true, observer: o })}${lit}`, lightTimingText(at, o)].filter(Boolean).join(" ・ ");
  };
  const c = aim.candPick !== null ? (aim.cands || [])[aim.candPick] : null;
  if (c) {
    const k = (aim.cands || []).filter((x) => x.side === c.side).indexOf(c) + 1;
    aimLookRender(host, { obs: { latitude: c.stand.latitude, longitude: c.stand.longitude, elevation: c.stand.elevationM },
      eyeM: aimCandidateEye(c.place), at: c.at, observerName: aimCandName(c), title: `候補地 ${k}. ${aimCandName(c)}から`,
      sub: "", light: light(c.at, c.stand) });
    return;
  }
  const f = aimFromPoint();
  if (!f) { host.hidden = true; return; }
  // 選択地点の実際の目の高さで描く。
  const ground = await aimElevation(f.latitude, f.longitude);
  if (seq !== aim.lookSeq || (globalThis.TrialExplore?.ownsScene?.()??globalThis.TrialExplore?.active())) return;
  const obs = aimObserverAt(f, ground);
  // **観測地点そのものの、その日の実際の通り方を出す**（2026-10-03 ユーザー「同じ日で観測地点をずらしたらその場所からの重なり方を出して欲しいだけ」
  // 「無理やり3択の場所に見え方を合わせてない？」）。選んだ縁が合わなくても、場所を動かさず、本当の通り方（中心が先端の◯°上を通る）で描く。
  // 合わせ方（下の縁・真ん中・上の縁）は、日付の帯・地図の線・候補地を決めるもので、ここでは通り方を変えない
  const opts = { partId: aim.partId, limb: "center", eyeM: obs.eyeM, stepMs: 3600000 };
  let rows = [];
  try { const view=await aimShootingView(obs,t,aim.body,aim.partId,aim.matchMode);if(seq!==aim.lookSeq)return;rows = view?view(aim.dayMs):AstroNotesAlign.dailyView(obs, t, aim.body, aim.dayMs, opts); } catch { rows = []; }
  if(seq!==aim.lookSeq)return;
  const dayRows = rows.filter((e) => S.JstCal.sameDay(e.at, aim.dayMs));
  const e = dayRows.find((x) => x.side === aim.candSide && dayRows.length > 1) || dayRows.sort((x, y) => Math.abs(x.gap) - Math.abs(y.gap))[0];
  if (!e) {
    host.hidden = false;
    host.innerHTML = `<div class="aim-look-h"><span>見え方</span></div><div class="aim-look-unavailable">見え方を計算できませんでした。日付を選び直してください。</div>`;
    return;
  }
  const mountain = aimIsMountain(t);
  const hits = mountain ? AstroNotesAlign.upcoming(obs, t, aim.body, { ...opts, from: aim.dayMs, days: 1, limit: 4 }) : [];
  const hit = hits.find((x) => x.side === e.side);
  const overlap = aim.matchMode === "overlap" ? AstroNotesShooting.matches(e,{target:t,body:aim.body,partId:aim.partId,limb:aim.limb,matchMode:"overlap"},aimIsMountain) : mountain ? !!hit && aimCalSolid(hit) : e.intersects;
  let selectedHit = null;
  if (aim.matchMode !== "overlap" && aim.partId !== "__whole") {
    try { selectedHit = AstroNotesAlign.upcoming(obs, t, aim.body, { ...opts, limb:aim.limb, from:aim.dayMs, days:1, limit:Infinity, groupDays:false }).find(x => x.side === e.side && aimCandidateMatch(x)); } catch {}
  }
  const at = aim.matchMode === "overlap" ? e.at : selectedHit?.at ?? hit?.at ?? e.at;
  aimLookRender(host, { obs, eyeM: obs.eyeM, at, observerName: f.name, title: "",
    sub: "",
    light: light(at, obs), atName: overlap ? undefined : "最接近" });
}const aimCandName = (c) => (c.place.kind === "川岸" ? `${c.place.name}の川岸`
  : c.place.name || `名前のない${c.place.kind}`);
const aimSideName = (side, body = aim.body) => (!AstroNotesBodies.definition(body).limbs ? (side === "set" ? "沈む側" : "昇る側") : body === "moon" ? (side === "set" ? "月の入" : "月の出") : (side === "set" ? "日の入" : "日の出"));
const aimCandSide = (c) => aimSideName(c.side);

const AIM_AUTO_CANDIDATES = false;
async function aimFindCandidates() {
  const seq = ++aim.candSeq;
  const lines = aim.lines || [];
  aim.cands = []; aim.candPick = null; aim.blockedAll = false; aim.brightSides = []; aim.candUnknownSides = []; aim.candClosedSides = [];
  $("aimCandList").innerHTML = ""; $("aimSideSeg").innerHTML = "";
  // 選ぶ候補地を待っている間、見え方の図はそのまま（aimUpdateLook が待つ）。見つからなくても待ちをやめて描き直す
  const giveUp = () => { if (seq === aim.candSeq && aim.wantSpot) { aim.wantSpot = null; aim.wantKey = null; aimUpdateLook(); } };
  // trial 2026-10-16: 自動候補地は外す（撮影候補は自分の地点の見えた記録から出す。仕様書 02_観測記録と自分の地点）
  if (AIM_AUTO_CANDIDATES === false) { $("aimCandInfo").textContent = ""; aim.candBusy = false; aimRefreshSheetCands(); giveUp(); return; }
  if (!lines.length) { $("aimCandInfo").textContent = "この日は線が無いので、候補地もありません。"; aim.candBusy = false; aimRefreshSheetCands(); giveUp(); return; }
  $("aimCandInfo").textContent = "候補地を探しています…";
  aim.candBusy = true; aimRefreshSheetCands();
  let places = [];
  try { places = await aimPlaces(); } catch {
    if (seq === aim.candSeq) { aim.lineWork = null; $("aimCandInfo").textContent = "候補地を読み込めませんでした。"; aim.candBusy = false; aimRefreshSheetCands(); }
    giveUp();
    return;
  }
  if (seq !== aim.candSeq) return;
  const pool = places; // 目標別の視認根拠を持つ登録点だけ。OSM分類や地名は根拠にしない。
  // 候補地では取得失敗を海抜0mへ置き換えない（線を引くための概算とは分ける）。
  const opts = { partId: aim.partId, limb: aim.limb, requireFreshElevation: true, isCurrent: () => seq === aim.candSeq,
    elevationAt: (lat, lon) => AstroNotesTerrain.groundElevation(lat, lon) };
  let found = [];
  // 地物の種類や名称では視認を保証できない。目標別の根拠がある点だけを解く。
  const eligible = pool.filter(aimCandidateSiteSupported);
  try { found = await AstroNotesAlign.candidates(lines, eligible, aim.target, aim.body, opts); } catch {
    if (seq === aim.candSeq) {
      aim.candBusy = false;
      aim.lineWork = null;
      $("aimCandInfo").textContent = "候補地を計算できませんでした。もう一度お試しください。";
      aimRefreshSheetCands();
    }
    giveUp(); return;
  }
  if (seq !== aim.candSeq) return;
  // パールは月が暗い空にあるときだけ（昼の月は重なっても写らない）
  const all = found.length;
  // 明るい空でだけ重なる側 = 明るい空の候補はあるが、暗い空の候補が初めから無い側（見通しなどで落ちた側は別の理由。Codex の点検）
  aim.brightSides = aim.body !== "moon" ? []
    : ["rise", "set"].filter((sd) => found.some((c) => c.side === sd && c.sunAltitude >= 0) && !found.some((c) => c.side === sd && c.sunAltitude < 0));
  if (aim.body === "moon") found = found.filter((c) => c.sunAltitude < 0);
  aim.candClosedSides = [...new Set(found.filter(c => !aimCandidateAccessible(c.place, c.at)).map(c => c.side))];
  found = found.filter(c => aimCandidateAccessible(c.place, c.at));
  for (const c of found) c.score = aimCandScore(c);
  // 同じ点数なら、目標に近い方（大きく写る）を先に。重なり方は点数に入っているので、ずれの細かい差では並べない
  found.sort((a, b) => Math.round((b.score - a.score) * 1000) || a.distanceKm - b.distanceKm);
  // 見通しが未確認の上位地点で、近くの良い地点を先に捨てない。
  const lineKm = Math.max(...lines.map((l) => l.points[l.points.length - 1].distanceKm));
  const spread = Math.max(0.3, lineKm / 40);
  const shown = [];
  const unknownSides = new Set();
  // 小さな束で確認する。12件そろうまで次の束も探す（遮蔽で減った数を補う）。
  for (let offset = 0; offset < found.length && shown.length < 12; offset += 4) {
    const checked = await Promise.all(found.slice(offset, offset + 4).map(async (k) => {
      try {
        const c = await aimOnLand(k, lines, opts);
        if (seq !== aim.candSeq || !c) return null;
        const los = await AstroNotesAlign.lineOfSight(
          { latitude: c.stand.latitude, longitude: c.stand.longitude, elevation: c.stand.elevationM + aimCandidateEye(c.place) - 1.5 },
          aim.target, { partId: aim.partId, maxAngleDeg: c.altitude,
            endSkipKm: aimIsMountain(aim.target) ? 1 : 0.01,
            elevations: (pts) => AstroNotesTerrain.elevations(pts, { from: c.stand }) });
        if (seq !== aim.candSeq) return null;
        if (!los) { unknownSides.add(c.side); return null; }
        if (!los.clear) return null;
        const [blocked] = await aimBuildingBlocks([c]);
        if (seq !== aim.candSeq) return null;
        if (blocked === null) { unknownSides.add(c.side); return null; }
        return blocked === false ? c : null;
      } catch { unknownSides.add(k.side); return null; }
    }));
    if (seq !== aim.candSeq) return;
    for (const c of checked) {
      if (!c || shown.length >= 12) continue;
      if (shown.some((k) => k.side === c.side && AstroNotesTerrain.distanceKm(k.stand.latitude, k.stand.longitude,
        c.stand.latitude, c.stand.longitude) < spread)) continue;
      shown.push(c);
    }
  }
  // 建物まで確かめた候補だけを一度に表示する。確認中に選べる仮候補は出さない。
  aim.cands = shown;
  aim.candUnknownSides = [...unknownSides];
  if (unknownSides.size) aim.lineWork = null; // 取得不能は次の操作で再試行する。
  aim.candBusy = false;
  const waited = !!aim.wantSpot;
  const want = aim.wantSpot ? shown.findIndex((c) => c.place.id === aim.wantSpot) : -1;
  aim.wantSpot = null; aim.wantKey = null;
  aim.candPick = want >= 0 ? want : null;
  AimMap.redraw();
  if (aim.candPick !== null || waited) aimUpdateLook();
  aimRenderCands();
}

function aimCandidateSiteSupported(place) {
  const target = AstroNotesAlign.targetById(aim.target?.id);
  return !!target && place.shape === "point" && place.heightKnown === true
    && place.sightline?.status === "verified" && (place.targetIds || []).includes(target.id)
    && AstroNotesTerrain.distanceKm(target.latitude, target.longitude, aim.target.latitude, aim.target.longitude) < 0.02;
}

/**
 * **候補地を水の上に置かない**（2026-10-01 ユーザー「観測地点は陸上に」「水の上にならないように」）。
 *
 * 川岸は川の中心線の上で、公園・海岸は面の中で重なりを解くので、立つ点が川面・池・海に出ることがある。
 * 水の上なら、**重なる線に沿って陸まで動かし、その点で重なりを解き直す**（線の上なら重なりは保たれる。
 * 動いた先で外れたら外す）。600m 動いても陸に出なければ外す。
 * 橋と桟橋は水の上でも人が立てる構造物なので確かめない。水かどうか分からない（通信の失敗）ときは候補にしない。
 */
const AIM_STAND_ON_WATER_OK = new Set(["橋", "桟橋"]);
async function aimOnLand(c, lines, opts) {
  if (AIM_STAND_ON_WATER_OK.has(c.place.kind) && !c.place.sightline) return c;
  const [water] = await AstroNotesTerrain.waterAt([c.stand]);
  if (c.place.sightline) return water === false ? c : null; // 視認根拠は登録位置だけ。別の道へ移さない。
  return water === true ? aimMoveToLand(c, lines, opts) : water === false ? c : null;
}

/// 線（緯度経度の折れ線）の上で、点にいちばん近い位置から、線に沿って ±d メートル動いた点を並べる（近い順）
function alongLine(points, from, stepsM) {
  const F = (la, lo) => [(lo - from.longitude) * 111320 * Math.cos(from.latitude * Math.PI / 180), (la - from.latitude) * 110540];
  const back = ([x, y]) => ({ latitude: from.latitude + y / 110540,
    longitude: from.longitude + x / (111320 * Math.cos(from.latitude * Math.PI / 180)) });
  const g = points.map((p) => F(p.latitude, p.longitude));
  // 折れ線を道のりで読む
  const acc = [0];
  for (let k = 1; k < g.length; k++) acc.push(acc[k - 1] + Math.hypot(g[k][0] - g[k - 1][0], g[k][1] - g[k - 1][1]));
  let best = { s: 0, d: Infinity };
  for (let k = 0; k + 1 < g.length; k++) {
    const [ax, ay] = g[k], [bx, by] = g[k + 1];
    const L2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
    const t = Math.max(0, Math.min(1, (-ax * (bx - ax) - ay * (by - ay)) / L2));
    const d = Math.hypot(ax + (bx - ax) * t, ay + (by - ay) * t);
    if (d < best.d) best = { s: acc[k] + t * (acc[k + 1] - acc[k]), d };
  }
  const at = (s) => {
    if (s < 0 || s > acc[acc.length - 1]) return null;
    let k = acc.findIndex((v) => v >= s);
    if (k <= 0) k = 1;
    const t = (s - acc[k - 1]) / ((acc[k] - acc[k - 1]) || 1);
    return back([g[k - 1][0] + (g[k][0] - g[k - 1][0]) * t, g[k - 1][1] + (g[k][1] - g[k - 1][1]) * t]);
  };
  const out = [];
  for (const d of stepsM) for (const sgn of [1, -1]) {
    const p = at(best.s + sgn * d);
    if (p) out.push({ ...p, movedM: d });
  }
  return out;
}

async function aimMoveToLand(c, lines, opts) {
  const l = lines.find((x) => x.side === c.side) || lines[0];
  if (!l || !l.points || l.points.length < 2) return null;
  const steps = [];
  for (let d = 20; d <= 600; d += 20) steps.push(d);
  const probes = alongLine(l.points, c.stand, steps);
  const water = await AstroNotesTerrain.waterAt(probes);
  for (let i = 0; i < probes.length; i++) {
    if (water[i] !== false) continue;
    const pt = probes[i];
    const e = await opts.elevationAt(pt.latitude, pt.longitude);
    if (!Number.isFinite(e)) continue;
    const ground = e;
    const hit = AstroNotesAlign.crossingNear({ latitude: pt.latitude, longitude: pt.longitude, elevation: ground },
      aim.target, aim.body, c.at, { ...opts, eyeM: aimCandidateEye(c.place) });
    if (!hit || !hit.rank) continue;   // 動いた先で重ならなければ、さらに先を見る
    return { ...c, ...hit, stand: { latitude: pt.latitude, longitude: pt.longitude, elevationM: ground }, movedM: pt.movedM };
  }
  return null;
}

/**
 * 候補地それぞれから目標へ向かう直線（最長1.5km）に、高い建物（7階以上・20m以上）が立ちふさがるか。
 * **同梱の data/tall-buildings.json で手元で判定する**（2026-10-01）。以前は画面から Overpass へ帯をまとめて
 * 問い合わせていたが、混んだ公開サーバーで 47〜64秒かかり、画面では間に合わなかった。
 * 読めなければ null（候補はそのまま出し、確かめられなかったと書く）
 */
let tallPromise = null;
function tallBuildings() {
  if (!tallPromise) {
    tallPromise = fetch("data/tall-buildings.json")
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then((j) => j.buildings.map((b) => ({ latitude: b[0] / 1e5, longitude: b[1] / 1e5, heightM: b[2], radiusM: b[3] })))
      .catch((e) => { tallPromise = null; throw e; });
  }
  return tallPromise;
}
/// その点に建つ建物の高さ。まず同梱の一覧（首都圏の20m以上・すぐ引ける）、無ければ OpenStreetMap に問い合わせる（10秒で打ち切り）
async function aimBuildingAt(lat, lon) {
  try {
    let best = null;
    for (const b of await tallBuildings()) {
      if (Math.abs(b.latitude - lat) > 0.003 || Math.abs(b.longitude - lon) > 0.004) continue;
      // 一覧の radiusM は建物の広さ。ピンは建物の中心から少しずれて置かれるので 15m 余裕を見る
      const over = AstroNotesTerrain.distanceKm(lat, lon, b.latitude, b.longitude) * 1000 - b.radiusM;
      if (over <= 15 && (!best || over < best.over)) best = { heightM: b.heightM, over };
    }
    if (best) return best;
  } catch { /* 一覧が読めなければ問い合わせへ */ }
  try { return await AstroNotesTerrain.buildingAt(lat, lon); } catch { return null; }
}
/// 同梱の一覧が届く範囲（首都圏）。外の建物は一覧に無いので、外では一覧で「隠れない」と言わない
let tallBox = null;
function tallCovers(all, lat, lon) {
  if (!tallBox) {
    tallBox = { s: 90, n: -90, w: 180, e: -180 };
    for (const b of all) {
      tallBox.s = Math.min(tallBox.s, b.latitude); tallBox.n = Math.max(tallBox.n, b.latitude);
      tallBox.w = Math.min(tallBox.w, b.longitude); tallBox.e = Math.max(tallBox.e, b.longitude);
    }
  }
  return lat >= tallBox.s && lat <= tallBox.n && lon >= tallBox.w && lon <= tallBox.e;
}
/// どこから重ねるか（1地点）の、建物の見通し。首都圏は同梱の一覧、外は目標へ向かう線に掛かる建物を OpenStreetMap に問い合わせる。
/// 確かめられなければ null
const aimAlongCache = new Map();
async function aimSightBuildings(obs, D, wanted = null, groundM = null) {
  const t = aim.target;
  const reach = Math.min(1.5, D - 0.3);
  if (!(reach > 0)) return { blocked: false, by: null };
  const end = AstroNotesTerrain.destination(obs.latitude, obs.longitude,
    AstroNotesTerrain.bearing(obs.latitude, obs.longitude, t.latitude, t.longitude), reach);
  let near = null;
  try {
    const all = await tallBuildings();
    if (tallCovers(all, obs.latitude, obs.longitude) && tallCovers(all, end.latitude, end.longitude)) {
      near = all.filter((b) => AstroNotesTerrain.distanceKm(obs.latitude, obs.longitude, b.latitude, b.longitude) <= reach + 0.05);
    }
  } catch { /* 一覧が読めなければ問い合わせへ */ }
  if (!near) {
    const key = [obs.latitude, obs.longitude, end.latitude, end.longitude].map((v) => v.toFixed(5)).join(",");
    if (!aimAlongCache.has(key)) {
      const got = await AstroNotesTerrain.buildingsAlong(obs, end, { wanted });
      if (!got) return null;            // 取れなかったことは覚えない（次は取れるかもしれない）
      aimAlongCache.set(key, got);
    }
    near = aimAlongCache.get(key);
  }
  near = await aimBuildingsOnLine(obs, groundM, t, near, reach);
  return AstroNotesAlign.buildingBlock(obs, t, near, { partId: aim.partId, eyeAboveGroundM: 1.5 });
}
/**
 * 目標へ向かう線に掛かる建物だけを選び、**建物の地面の標高と立つ場所の地面の差を高さに足す**（2026-10-02 総点検）。
 * buildingBlock は建物の地面を立つ場所と同じとみなすので、丘の上から見ると下の街の 20m の建物を「隠れる」と誤っていた
 * （候補地の絞り込みも同じ）。地面は標高タイル（z13）で建物の中心を読む
 */
async function aimBuildingsOnLine(stand, groundM, target, buildings, reachKm) {
  const brg = AstroNotesTerrain.bearing(stand.latitude, stand.longitude, target.latitude, target.longitude) * Math.PI / 180;
  const cosLat = Math.cos(stand.latitude * Math.PI / 180), L = reachKm * 1000;
  const xy = (la, lo) => [(lo - stand.longitude) * 111320 * cosLat, (la - stand.latitude) * 110540];
  const on = [];
  for (const b of buildings || []) {
    let c, r;
    if (b.ring) {
      const pts = b.ring.map(([la, lo]) => xy(la, lo));
      c = [pts.reduce((a, p) => a + p[0], 0) / pts.length, pts.reduce((a, p) => a + p[1], 0) / pts.length];
      r = Math.max(...pts.map((p) => Math.hypot(p[0] - c[0], p[1] - c[1])));
    } else { c = xy(b.latitude, b.longitude); r = b.radiusM || 0; }
    const along = c[0] * Math.sin(brg) + c[1] * Math.cos(brg), perp = Math.abs(c[0] * Math.cos(brg) - c[1] * Math.sin(brg));
    if (along < -r || along > L + r || perp > r + 1) continue;
    on.push({ b, lat: stand.latitude + c[1] / 110540, lon: stand.longitude + c[0] / (111320 * cosLat) });
  }
  if (!on.length || !Number.isFinite(groundM)) return on.map((x) => x.b);
  let g = [];
  // 建物の足もとも立つ場所と同じ標高API（最も精度の高いDEM）。数は線に掛かる建物だけ
  try { g = await Promise.all(on.map((x) => AstroNotesTerrain.groundElevation(x.lat, x.lon).catch(() => null))); } catch { g = []; }
  return on.map((x, i) => (Number.isFinite(g[i]) ? { ...x.b, heightM: x.b.heightM + (g[i] - groundM) } : x.b));
}
/// 候補地の建物判定。true=遮蔽、false=検査範囲で通過、null=未確認（候補へ出さない）。
/// 立つ点から1kmまでは国土地理院の建物（種別の下限の高さ）、塔は1.5kmまで同梱の高い建物も見る
async function aimBuildingBlocks(cands) {
  const t = aim.target;
  let all = null;
  if (!aimIsFuji()) { try { all = await tallBuildings(); } catch { all = null; } }
  return Promise.all(cands.map(async (c) => {
    const obs = { latitude: c.stand.latitude, longitude: c.stand.longitude, elevation: c.stand.elevationM + aimCandidateEye(c.place) - 1.5 };
    // 橋の上の立つ点の標高は橋の高さ込み。建物の高さは地面（川面・線路）から測る（以前は橋の高さを目の高さに2回足していた）
    const base = c.stand.elevationM - (c.place.bridgeM || 0);
    const eyeAbove = aimCandidateEye(c.place) + (c.place.bridgeM || 0);
    // 隠れたと数えるのは、建物が「目標の合わせる高さ」と「天体の中心」の低い方より高く見えるとき
    // （建物全体に重なる日は、天体が先端より下を通ることがある）
    const limit = Math.max(0, c.targetAngle - c.altitude);
    const hidden = (blk) => !!(blk && blk.by && blk.marginDeg < limit);
    const near = await aimNearBuildings(c, base);
    if (!near) return null;
    if (hidden(AstroNotesAlign.buildingBlock(obs, t, near, { partId: aim.partId, eyeAboveGroundM: eyeAbove, maxKm: 1 }))) return true;
    // 種別の下限で遮られないことは、実際の屋根より上を見通せる根拠にならない。
    if (aimIsFuji()) return false;
    // 首都圏の外の候補地は、同梱の一覧に建物が無いので確かめていない（「隠れない」とは言わない）
    if (!all || !tallCovers(all, c.stand.latitude, c.stand.longitude)) return null;
    // 目標までの間（1.5km）にある建物だけに絞ってから判定する（数万棟を毎回全部は見ない）
    const d = Math.min(1.6, c.distanceKm);
    const box = all.filter((b) => Math.abs(b.latitude - c.stand.latitude) < 0.016 && Math.abs(b.longitude - c.stand.longitude) < 0.02
      && AstroNotesTerrain.distanceKm(c.stand.latitude, c.stand.longitude, b.latitude, b.longitude) <= d + 0.05);
    const tall = await aimBuildingsOnLine(c.stand, base, t, box, Math.min(1.5, c.distanceKm - 0.3));
    return hidden(AstroNotesAlign.buildingBlock(obs, t, tall, { partId: aim.partId, eyeAboveGroundM: eyeAbove }));
  }));
}
/// 立つ点から目標へ1kmまでの国土地理院の建物（2026-10-06）。新四谷見附橋から月・スカイツリー（4.5°）の線は90m先から
/// 高さタグの無い建物に掛かっていたのに、同梱の高い建物にも OpenStreetMap の高さ付きの建物にも無く、候補に出ていた（ユーザー報告）。
/// 高さは種別の下限（低めに見積もる）＋建物の地面と立つ点の地面の差。地面は標高タイルで、線に掛かる建物の入口をまとめて読む。
/// 取れなければ null
async function aimNearBuildings(c, base) {
  const t = aim.target, s = c.stand;
  const reach = Math.min(1, c.distanceKm - 0.3);
  if (!(reach > 0)) return [];
  const end = AstroNotesTerrain.destination(s.latitude, s.longitude, AstroNotesTerrain.bearing(s.latitude, s.longitude, t.latitude, t.longitude), reach);
  const got = await AstroNotesTerrain.gsiBuildingsAlong(s, end);
  if (!got) return null;
  if (!got.length) return [];
  let g = [];
  try { g = await AstroNotesTerrain.elevations(got.map((b) => b.entry), { from: s }); } catch { g = []; }
  if (g.length !== got.length || g.some((v) => !Number.isFinite(v))) return null;
  return got.map((b, i) => ({ ring: b.ring, heightM: b.minHeightM + g[i] - base, heightUnknown: true }));
}

/// 撮影地の「この日の候補地」と、どこから重ねるかの地点の画面の候補地を同じ候補で描く
function aimRenderCands() {
  aimRenderCandList();
  aimRefreshSheetCands();
}

/// 候補地を、どこから重ねるかにする（2026-10-06）。立つ点と目の高さ（1.5m＋展望台・橋）は候補地を解いたときと同じにし、
/// 一覧に出した時刻のまま重なるようにする。見え方は観測地点（＝この候補地）で描き直す。地図は動かさない
function aimFromCandidate(c) {
  aim.candPick = null;
  const kind = c.place.kind === "定番" ? c.place.spotKind : c.place.kind;
  // 展望台・橋の上は立つ所として持つ（地上からは床の高さ＋目の高さ1.5m。橋の地面の標高は川面なので橋の高さを足す）
  const deck = c.place.deckM ? { name: c.place.name, aglM: c.place.deckM, ...(c.place.heightBasis === "published-viewpoint" ? {heightBasis:c.place.heightBasis} : {}) } : c.place.bridgeM ? { name: "橋の上", aglM: c.place.bridgeM } : null;
  aimSetFrom({ name: aimCandName(c), subtitle: c.place.address || kind || "",
    latitude: c.stand.latitude, longitude: c.stand.longitude,
    decks: deck ? [deck] : [], stand: deck ? deck.name : null }, { keepMap: true });
  aimRenderCands();
}

/// 地点の画面をどこから重ねるかで開いている間に候補地が変わったら（探し終わった・側を替えた）、そこも描き直す。
/// どこから行の下に「この日の候補地 Nか所」の釦を置いたが、カードを押せば同じ候補地が出るので外した（2026-10-06 ユーザー「このボタンはいらないんじゃない？」）
function aimRefreshSheetCands() {
  if ($("placeSheet").open && placeSheetFor === "aim") aimRenderSheetCands();
}

/// 地点の画面の「この日の候補地」（どこから重ねるかで開いたときだけ）。側の切り替えは撮影地の一覧の釦を写して、押すとそちらを押す
/// （側・数・時刻の幅・線なしを1か所で決める）。上から5か所。全部は撮影地の地図で
function aimRenderSheetCands() {
  const box = $("sheetCands");
  box.hidden = placeSheetFor !== "aim" || !(aim.target && (aim.target.parts || []).length);
  if (box.hidden) return;
  $("sheetCandsDay").textContent = Number.isFinite(aim.dayMs) ? `${S.Cal.monthDay(aim.dayMs)}(${S.Cal.weekday(aim.dayMs)})` : "";
  const all = aim.cands || [];
  const seg = $("sheetCandSide");
  seg.innerHTML = $("aimSideSeg").innerHTML;
  seg.setAttribute("aria-label", $("aimSideSeg").getAttribute("aria-label") || "側");
  for (const b of seg.querySelectorAll("[data-side]")) b.onclick = () => $("aimSideSeg").querySelector(`[data-side="${b.dataset.side}"]`)?.click();
  const list = all.map((c, i) => ({ c, i })).filter((x) => x.c.side === aim.candSide);
  $("sheetCandInfo").textContent = list.length ? "" : aim.candBusy ? "候補地を探しています…" : $("aimCandInfo").textContent;
  const moon = aim.body === "moon";
  // 行の右に、外の地図アプリで立つ点を開く釦（2026-10-06 ユーザー「どこから重ねるかの中の候補からもMAPに飛べるようにしたいな」。
  // ストリートビューで見通しを確かめる）。撮影地の地図の下の「地図アプリ」と同じ（覚えたアプリがあればその名前）
  const app = savedMapApp(), appLabel = app ? MAP_APPS[app].chipLabel : "地図アプリ";
  $("sheetCandList").innerHTML = list.slice(0, 5).map(({ c, i }, k) => {
    const kind = c.place.kind === "定番" ? c.place.spotKind : c.place.kind;
    return `<div class="al-row cand-row jump"><button type="button" class="cand-pick" data-sheet-cand="${i}">`
      + `<span class="al-w"><strong>${k + 1}. ${esc(aimCandName(c))}</strong>`
      + `<span class="tiny sub-line">${S.JstCal.hhmm(c.at)} ・ ${esc(kind)} ・ ${aimKm(c.distanceKm)}km${moon ? ` ${moonGlyphAt(c.at, c.stand)}` : ""}</span></span></button>`
      + `<button type="button" class="chip cand-app" data-sheet-cand-app="${i}" aria-label="${esc(aimCandName(c))}を${esc(app ? MAP_APPS[app].name : "地図アプリ")}で開く">${esc(appLabel)}`
      + `<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14 4h6v6M20 4l-9 9M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"/></svg></button></div>`;
  }).join("");
  // 開いても地点の画面は閉じない（続けてほかの候補地も確かめられる）。アプリを覚えていなければ選ぶ画面
  for (const el of $("sheetCandList").querySelectorAll("[data-sheet-cand-app]")) {
    el.onclick = () => {
      const c = (aim.cands || [])[+el.dataset.sheetCandApp];
      if (!c) return;
      const t = coordText(c.stand), a = savedMapApp();
      if (a) openMapApp(a, t); else openMapAppSheet(t);
    };
  }
  for (const el of $("sheetCandList").querySelectorAll("[data-sheet-cand]")) {
    el.onclick = () => {
      const c = (aim.cands || [])[+el.dataset.sheetCand];
      $("placeSheet").close();
      if (c) aimFromCandidate(c);
    };
  }
  $("sheetCandAll").hidden = !all.length;
}
$("sheetCandAll").onclick = () => {
  $("placeSheet").close();
  $("previewPlacesTab").click();
  requestAnimationFrame(() => window.scrollTo({ top: $("aimCanvas").getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" }));
};

function aimRenderCandList() {
  const all = aim.cands || [];
  const seg = $("aimSideSeg");
  const moon = aim.body === "moon";
  // 側ごとに、線があるか・時刻の幅・候補地の数
  const sides = ["rise", "set"].map((side) => {
    const l = (aim.lines || []).find((x) => x.side === side && x.points && x.points.length);
    const ts = l ? l.points.map((q) => q.at).filter(Number.isFinite) : [];
    return { side, has: !!l, n: all.filter((c) => c.side === side).length,
      from: ts.length ? Math.min(...ts) : null, to: ts.length ? Math.max(...ts) : null };
  });
  if (!sides.some((x) => x.has)) { seg.innerHTML = ""; $("aimCandList").innerHTML = ""; return; }
  const picked = aim.candPick !== null ? all[aim.candPick] : null;
  if (picked) aim.candSide = picked.side;
  // 見る側: 前に選んだ側（線があれば）。無ければ候補のある側の早い方、それも無ければ線のある側
  if (!sides.some((x) => x.side === aim.candSide && x.has)) {
    const pick = sides.filter((x) => x.has && x.n).sort((a, b) => a.from - b.from)[0] || sides.find((x) => x.has);
    aim.candSide = pick ? pick.side : null;
  }
  seg.setAttribute("aria-label", AstroNotesBodies.definition(aim.body).limbs ? (moon ? "月の出側か月の入側か" : "日の出側か日の入側か") : "昇る側か沈む側か");
  seg.innerHTML = sides.map((x) => `<button type="button" data-side="${x.side}" aria-pressed="${x.side === aim.candSide}"${x.has ? "" : " disabled"}>`
    // 2段（320px で時刻の幅が折り返して3段になっていた）
    + `${aimSideName(x.side)}${x.has ? ` ${x.n}か所` : ""}`
    + `<span class="sub-line">${x.has ? `${S.JstCal.hhmm(x.from)}〜${S.JstCal.hhmm(x.to)}` : "この日は線なし"}</span></button>`).join("");
  for (const b of seg.querySelectorAll("[data-side]")) {
    b.onclick = () => {
      if (b.disabled || b.dataset.side === aim.candSide) return;
      aim.candSide = b.dataset.side;
      // 選んでいた候補地が反対の側なら、選ぶのをやめる（見え方は観測地点の近くへ）
      if (aim.candPick !== null && all[aim.candPick].side !== aim.candSide) { aim.candPick = null; aimUpdateLook(); }
      aimRenderCands();
      AimMap.redraw();
    };
  }
  const list = all.map((c, i) => ({ c, i })).filter((x) => x.c.side === aim.candSide);
  $("aimCandInfo").textContent = list.length ? ""
    : (aim.brightSides || []).includes(aim.candSide) ? `この日の${aimSideName(aim.candSide)}側は、明るい空で重なります。`
    : aim.candBusy ? "見通しを確認しています…"
    : (aim.candClosedSides || []).includes(aim.candSide) ? "重なる登録点はありますが、利用時間・休室条件を満たす候補地がありません。"
    : (aim.candUnknownSides || []).includes(aim.candSide) ? "見通しを確認できる候補地がありません。"
    : `この日の${aimSideName(aim.candSide)}側には、見通しを確認した登録点で重なる場所がありません。撮影地点は地図から選べます。`;
  $("aimCandList").innerHTML = list.map(({ c, i }, k) => {
    const on = aim.candPick === i;
    const kind = c.place.kind === "定番" ? c.place.spotKind : c.place.kind;
    const deck = c.place.deckM ? `（地上${c.place.deckM}m）` : "";
    const edge = aimIsFuji() && c.rank !== "center" ? " ・ 火口の縁の端" : "";
    const more = !on ? "" : `<span class="tiny sub-line">${esc([kind + deck, c.place.address].filter(Boolean).join(" ・ "))}</span>`
      + (moon ? `<span class="tiny sub-line">${esc(lightTimingText(c.at, c.stand))}</span>` : "")
      + `<span class="tiny sub-line">${esc(aim.target.name)}まで ${aimKm(c.distanceKm)}km ・ 見上げ ${c.targetAngle.toFixed(1)}°</span>`
      + (c.place.note ? `<span class="tiny sub-line">${esc(c.place.note)}</span>` : "");
    return `<div class="al-row cand-row jump${on ? " on" : ""}"><button type="button" class="cand-pick" data-cand="${i}" aria-pressed="${on}">`
      + `<span class="al-w"><strong>${k + 1}. ${esc(aimCandName(c))}</strong>`
      + `<span class="tiny sub-line">${S.JstCal.hhmm(c.at)} ・ ${esc(kind)} ・ ${aimKm(c.distanceKm)}km${edge}${moon ? ` ${moonGlyphAt(c.at, c.stand)}` : ""}</span>${more}</span></button>`
      + (on ? `<button type="button" class="chip cand-map" data-cand-map="${i}">地図で見る</button>`
        // 行を押すのは見え方を一時的に替えるだけ。ここを観測地点にするのはこの釦（2026-10-06。地点の画面の候補地と同じ処理）
        + `<button type="button" class="chip cand-from" data-cand-from="${i}">ここから重ねる</button>` : "") + `</div>`;
  }).join("");
  // 行を押すと選ぶ（もう一度押すとやめる）。見え方と地図の印がその候補地に。地図は「地図で見る」で動かす（Codex: 地図を見たい人を勝手に動かさない）
  for (const el of $("aimCandList").querySelectorAll("[data-cand]")) {
    el.onclick = () => {
      const i = Number(el.dataset.cand);
      aim.candPick = aim.candPick === i ? null : i;
      aimRenderCands();
      aimUpdateLook();
      AimMap.redraw();
    };
  }
  for (const el of $("aimCandList").querySelectorAll("[data-cand-from]")) {
    el.onclick = () => {
      const c = aim.cands[Number(el.dataset.candFrom)];
      aimFromCandidate(c);
      $("aimCandInfo").textContent = `「${aimCandName(c)}」を撮影地点にしました。`;
    };
  }
  for (const el of $("aimCandList").querySelectorAll("[data-cand-map]")) {
    el.onclick = () => {
      const x = aim.cands[Number(el.dataset.candMap)];
      AimMap.open({ latitude: x.stand.latitude, longitude: x.stand.longitude }, 15);
      requestAnimationFrame(() => AimMap.redraw());
      window.scrollTo({ top: $("aimCanvas").getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" });
    };
  }
}
