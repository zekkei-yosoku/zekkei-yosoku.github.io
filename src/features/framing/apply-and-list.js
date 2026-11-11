import {$,S,esc} from '../../ui/presentation-helpers.js';
import {store} from '../../app/browser-state.js';
import {lightTimingText,moonGlyphAt} from '../forecast/view.js';
import {AimMap,aim,aimCustomTarget,aimFavTarget,aimFavTargets,aimFillParts,aimFillSelects,aimIsMountain,aimLimbValue,aimRedrawLine,aimSideLabel,aimWithHeights,aimZoomFor} from './controller.js';
import {aimFromPoint,aimRenderFrom,aimRenderSelectedPoint,aimRenderTargetCard,candidateWaitMarkup} from './observer.js';
import {aimCandidateAccessible,aimCandidateSiteSupported,aimPlaces,aimRefreshSheetCands,aimSideName} from './candidates.js';
import {aimAirEnsure,aimMapView,aimTitleFor} from './reverse-and-entry.js';
import {screenAllowed,toolAllowed} from '../account/session-and-access.js';
function aimApply({ redraw = true, recenter = false } = {}) {
  if(globalThis.TrialExplore?.ownsScene?.()??globalThis.TrialExplore?.active()){globalThis.TrialExplore.invalidate();return false;}
  aimRenderSelectedPoint();
  if (!AstroNotesBodies.definition(aim.body).limbs && !AstroNotesBodies.ready()) {
    const request = aim.bodySeq.next();
    AstroNotesBodies.ensure(aim.body).then(() => { if(aim.bodySeq.current(request)) aimApply({redraw,recenter}); }).catch(() => {
      if(aim.bodySeq.current(request)) $("aimLineInfo").textContent = "天体計算を読み込めませんでした。天体を選び直して再試行してください";
    });
    return false;
  }
  // お気に入りは増えたり消えたりする（ほかの画面・同期）ので、毎回組み直す。消えた目標を選んでいたら先頭へ
  aimFillSelects();
  const wanted = $("aimTarget").value;   // "" は未選択
  const isFuji = wanted === "fuji";
  // 次に開いたときも同じ目標で開く
  store.set("sorami.aimTarget", wanted);
  // 富士山: 太陽の釦はダイヤモンド富士、月の釦はパール富士の許可で出す（許可は2つのまま。ユーザー指定）。
  // どちらも無い（URL を直接開いた）ときは両方出す。いまの天体が許されていなければ、許されている方へ
  const sunOk = !isFuji || toolAllowed("diamond"), moonOk = !isFuji || toolAllowed("pearl");
  const anyOk = sunOk || moonOk;
  const previousBody = aim.body;
  const newBodyOk = toolAllowed("tower") || !screenAllowed("framing");
  for (const option of $("aimBody").options) {
    const allowed = option.value === "sun" ? (!anyOk || sunOk) : option.value === "moon" ? (!anyOk || moonOk) : newBodyOk;
    option.disabled = !allowed; option.hidden = !allowed;
  }
  if (!AstroNotesBodies.definition(aim.body).limbs && !newBodyOk) aim.body = sunOk ? "sun" : "moon";
  if (aim.body === "sun" && anyOk && !sunOk) aim.body = "moon";
  if (aim.body === "moon" && anyOk && !moonOk) aim.body = "sun";
  if (previousBody !== aim.body) {
    aim.limb = aim.limbsByBody[aim.body] || "center";
    $("aimLimb").innerHTML = "";
    aimFillSelects();
  }
  store.set("sorami.aimBody", aim.body);
  const favT = wanted.startsWith("fav:") ? aimFavTargets().find((f) => `fav:${f.id}` === wanted) : null;
  aim.target = !wanted ? { id: "", name: "", parts: [] } : wanted === aim.sharedTarget?.id ? aim.sharedTarget : wanted === "custom"
    ? (aimCustomTarget() || { id: "custom", name: "他の対象", parts: [] })
    : favT ? aimFavTarget(favT)
    : aimWithHeights(AstroNotesAlign.targetById(wanted) || AstroNotesAlign.TARGETS[0]);
  // 他の目標・お気に入りの目標のときだけ、目標の場所のカード・高さの入力・地図の「ここに重ねる」を出す
  const customOn = wanted === "custom" || !!favT;
  $("aimTargetCard").hidden = true;
  $("aimCustomRow").hidden = true;
  $("aimPickTarget").hidden = true;
  if (customOn) aimRenderTargetCard();
  // 目標の高さの注記（塔だけ。富士山の山頂は当たり前なので出さない）
  // 自分で置く目標は、場所のカードに標高と高さを書くので、ここには出さない
  // 目標の高さの内訳（「地上の高さ＋地面の標高およそ2m」）は出さない（2026-10-01 細かい説明文は出さない）。推定の高さは下の欄で直す
  $("aimTargetNote").hidden = true;
  // 題名はいつも目標を選ぶ枠。富士山のときは枠の字を「ダイヤモンド富士」「パール富士」にする（有名な呼び名を残す）。
  // 太陽／月は題名の右で同じ位置
  $("aimTargetLabel").textContent = aimTitleFor().title;
  const single = $("aimTarget").options.length < 2;
  $("aimTarget").disabled = single;
  document.querySelector("#aimTargetPick .aim-pick").classList.toggle("single", single);
  $("aimView").classList.toggle("moon", aim.body === "moon");
  $("aimBody").value = aim.body;
  aim.limb = aim.matchMode === "overlap" ? "center" : aimLimbValue() || AstroNotesAlign.LIMBS[0].id;
  // **選び直した高さは、選択肢を作り直す前に読む。** aimFillParts は aim.partId で選び直すので、
  // 後で読むと元の値（先端）に戻る（2026-09-25 から 10-01 まで高さを替えられなかった。
  // ユーザー「スカイツリーで場所は曽谷を選んで、どこに重ねるかが先端から動かせない」）
  if(aim.matchMode === "overlap") {aim.partId=aimIsMountain(aim.target)?null:"__whole";$("aimPart").value=aim.partId||"";}
  else aim.partId = $("aimPart").value || aim.partId;
  aimFillParts();
  $("aimAlignmentDetails").hidden = !(aim.target?.parts||[]).length;
  $("aimAlignmentSummary").textContent = "重ね方";
  // 高さが推定の部位だけ、直せるようにする
  const part = (aim.target.parts || []).find((p) => p.id === aim.partId);
  $("aimHeightRow").hidden = !(part && part.adjustable);
  // 高さを直せない目標へ替えたら、前の目標の注記を残さない（ティンカーベルから富士山へ替えて「53m は…」が残っていた）
  if (!(part && part.adjustable)) $("aimHeightNote").textContent = "";
  if (part && part.adjustable) {
    const g = aim.target.groundM || 0;
    $("aimHeightM").value = String(Math.round(part.m - g));
    // 「◯m は地図の中心（◯km先）から ◯°」は出さない（2026-10-03 ユーザーが選んだ「いらない説明文」）
    $("aimHeightNote").textContent = "";
  }
  const picked = $("aimDate").value ? Date.parse(`${$("aimDate").value}T00:00:00+09:00`) : null;
  aim.dayMs = Number.isFinite(picked) ? picked : S.Cal.startOfDay(Date.now());
  if(aimAirEnsure(aimFromPoint(),aim.dayMs))return false;
  $("aimKeySet").textContent = aimSideLabel("set");
  $("aimKeyRise").textContent = aimSideLabel("rise");
  $("aimCalendarOpen").innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6M17 2v6M3 11h18"/></svg>${$("aimDate").value.replaceAll("-", "/")}(${S.Cal.weekday(aim.dayMs)})`;
  $("aimCalendarOpen").setAttribute("aria-label", `${$("aimDate").value.replaceAll("-", "/")}(${S.Cal.weekday(aim.dayMs)})、重なる日カレンダーを開く`);
  // 目標が決まっていなければ線は引けない（高さが無い）
  if (!(aim.target.parts || []).length) {
    aim.seq.cancel(); aim.candSeq.cancel();
    aim.cands = []; aim.candPick = null; aim.wantSpot = null; aim.wantKey = null;
    aim.lines = [];
    aimRenderFrom();
    // 地図をまだ開いていなければ（中心が無ければ）、どこから重ねるかの地点で開く
    const c = AimMap.center();
    if (!c || !Number.isFinite(c.latitude)) AimMap.open(...aimMapView());
    else AimMap.redraw();
    $("aimLineInfo").textContent = ""; // 未選択の案内は対象の選択欄に表示する。
    $("aimLineTable").hidden = true;
    $("aimLineTable").replaceChildren(document.createElement('tbody'));
    $("aimList").innerHTML = "";
    $("aimCandBox").hidden = true;
    $("aimListBox").hidden = true;
    aim.cands = []; aim.candBusy = false; aimRefreshSheetCands();
    return false;
  }
  $("aimCandBox").hidden = false;
  // 目標を替えたら、その目標の線が入る倍率で開き直す
  if (recenter && Number.isFinite(aim.target.latitude)) {
    AimMap.open({ latitude: aim.target.latitude, longitude: aim.target.longitude },
      aimZoomFor(aim.target, aim.partId));
  }
  if (redraw) { aimRedrawLine(); aimRenderList(); aimRenderFrom(); }
  return true;
}

/// 日付。**今年でなければ年も書く**（400日先まで並べるので、同じ月日が2回出ることがある）
function aimDateLabel(ms) {
  const y = new Date(ms + 9 * 3600000).getUTCFullYear();
  const now = new Date(Date.now() + 9 * 3600000).getUTCFullYear();
  return `${y === now ? "" : `${y}/`}${S.Cal.monthDay(ms)}(${S.Cal.weekday(ms)}) ${S.JstCal.hhmm(ms)}`;
}

/// ダイヤモンド富士・パール富士の一覧は、主な観測スポットごとに次の日を出す
const aimIsFuji = () => aim.target && aim.target.id === "fuji";

function aimRenderList() {
  // 撮影地点の提案は、記録した地点を使う地図の一覧へ集約。
  $("aimListBox").hidden = true;
  $("aimList").replaceChildren();
}

function aimShowDay(day, spot = null) {
  $("aimDate").value = new Date(day + 9 * 3600000).toISOString().slice(0, 10);
  aim.spot = spot;
  // その日の候補地が出そろったら、このスポットを選んだ状態にする
  aim.wantSpot = spot ? spot.id : null;
  if (spot) AimMap.open({ latitude: spot.latitude, longitude: spot.longitude }, Math.max(10, Math.round(AimMap.zoom())));
  aimApply();
  window.scrollTo({ top: $("aimCanvas").getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" });
}

/**
 * 主な観測スポットと、それぞれで次に重なる日（2026-09-30）。
 * 以前は「いま選んでいる地点から見た日」だけで、どこへ行けばよいかが分からなかった（ユーザー指摘）。
 * 23か所×1年を解くので、1か所ずつ間をあけて描く（画面を止めない）。
 */
function aimSpotKey(now = Date.now()) {
  return JSON.stringify([aim.target, aim.body, aim.limb, AstroNotesAtmosphere.dataKey(now), S.Cal.startOfDay(now)]);
}
async function aimSpotRows() {
  const now = Date.now(), key = aimSpotKey(now), old = aim.spotWork;
  if (old?.key === key && now < old.until) return old.rows || old.promise;
  const target = aim.target, body = aim.body, limb = aim.limb;
  const work = { key, until: Infinity, rows: null, promise: null };
  aim.spotWork = work;
  work.promise = (async () => {
    const rows = [];
    let missingGround = false, usablePlaces = 0;
    const places = await aimPlaces();
    if (aim.spotWork !== work || aimSpotKey() !== key) return null;
    for (const place of places.filter(aimCandidateSiteSupported)) {
      if (aim.spotWork !== work || aimSpotKey() !== key) return null;
      const groundM = await AstroNotesTerrain.groundElevation(place.latitude, place.longitude).catch(() => null);
      if (aim.spotWork !== work || aimSpotKey() !== key) return null;
      if (!Number.isFinite(groundM)) { missingGround = true; continue; }
      usablePlaces++;
      const sp = {...place, groundM};
      await new Promise(resolve => setTimeout(resolve, 0));
      if (aim.spotWork !== work || aimSpotKey() !== key) return null;
      let ev = [];
      try { ev = AstroNotesAlign.upcoming(AstroNotesAlign.spotObserver(sp), target, body,
        { from: now, days: 400, limit: body === "moon" ? 12 : 4, limb, stepMs: 3600000, eyeM: sp.heightBasis === "published-viewpoint" ? 0 : 1.5,
          acceptEvent: e => e.rank !== "graze" && (body !== "moon" || e.sunAltitude < 0) && aimCandidateAccessible(sp, e.at) }); } catch (error) { throw error; }
      ev = ev.filter(e => e.rank !== "graze" && (body !== "moon" || e.sunAltitude < 0) && aimCandidateAccessible(sp, e.at));
      if (ev.length) rows.push({ sp, ev: ev.slice(0, 2) });
    }
    if (aim.spotWork !== work || aimSpotKey() !== key) return null;
    rows.sort((a, b) => a.ev[0].at - b.ev[0].at);
    if (missingGround && !usablePlaces) throw new Error("候補地の標高を取得できませんでした");
    work.rows = rows;
    work.until = Math.min(missingGround ? now + 60000 : Infinity, S.Cal.startOfDay(now) + 86400000, ...rows.flatMap(r => r.ev.map(e => e.at)));
    return rows;
  })().catch(error => { if (aim.spotWork === work) aim.spotWork = null; throw error; });
  return work.promise;
}
async function aimRenderSpots() {
  const seq = aim.spotSeq.next();
  const moon = aim.body === "moon";
  $("aimListTitle").textContent = "定番スポット";
  $("aimListSub").textContent = !AstroNotesBodies.definition(aim.body).limbs ? "次に富士山を通る日" : moon ? "次にパール富士が見える日" : "次にダイヤモンド富士が見える日";
  $("aimList").innerHTML = candidateWaitMarkup("計算中です…");
  let rows;
  try { rows = await aimSpotRows(); } catch {
    if (!aim.spotSeq.current(seq) || !aimIsFuji()) return;
    $("aimList").innerHTML = '<p class="tiny" role="status">定番スポットの候補日を計算できませんでした。</p><button type="button" class="fav-btn" data-spot-retry>再試行</button>';
    $("aimList").querySelector('[data-spot-retry]').onclick = () => aimRenderSpots();
    return;
  }
  if (!aim.spotSeq.current(seq) || !aimIsFuji()) return;
  if (rows === null) { aim.spotWork = null; return aimRenderSpots(); }
  if (!rows.length) { $("aimList").innerHTML = `<p class="tiny">この1年、見通しを確認したスポットで重なる日は見つかりません。</p>`; return; }
  $("aimList").innerHTML = rows.map(({ sp, ev }, i) => {
    const when = ev.map((e) => {
      const lit = moon ? ` ${moonGlyphAt(e.at, AstroNotesAlign.spotObserver(sp))}輝面${Math.round(e.illuminated * 100)}%` : "";
      const light = moon ? `<span class="sub-line">${esc(lightTimingText(e.at, AstroNotesAlign.spotObserver(sp)))}</span>` : "";
      return `<button class="tiny aim-day" data-spot="${i}" data-day="${S.Cal.startOfDay(e.at)}">${aimDateLabel(e.at)}`
        + `${aimSideName(e.side)}${lit}${light}</button>`;
    }).join("");
    const tags = [sp.kind, sp.deckM ? `地上${sp.deckM}m` : null, sp.note].filter(Boolean).join(" ・ ");
    return `<div class="al-row aim-spot">
      <div class="al-w"><strong>${esc(sp.name)}</strong>
        <span class="tiny">${esc(sp.address)}</span>
        <span class="tiny" style="color:var(--tertiary)">${esc(tags)}</span>
        <div class="aim-days">${when}</div></div></div>`;
  }).join("");
  for (const el of $("aimList").querySelectorAll("[data-day]")) {
    el.onclick = () => aimShowDay(+el.dataset.day, rows[+el.dataset.spot].sp);
  }
}
export {aimApply,aimDateLabel,aimIsFuji,aimRenderList};
