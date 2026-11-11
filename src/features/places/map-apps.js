import {store} from '../../app/browser-state.js';
import {AimMap} from '../framing/controller.js';
import {PlaneMap} from '../aircraft/controller.js';
import {issStandPoint} from '../satellites/controller.js';
import {aimRefreshSheetCands} from '../framing/candidates.js';
import {showSheet} from '../../app/overlays.js';
// ---------------------------------------------------------------- ピンの位置を、ほかの地図アプリへ（2026-10-02）
//
// ユーザー「撮影ポイントをピンポイントに知りたい場合、詳細な緯度経度が欲しい」「他のMAPアプリに飛ばしたりとかってできるの？」
// →「座標コピーのボタンと、地図アプリで開くのボタン。押したら端末の標準か Google か Apple かを選ばせ、選んだアプリを常に使うか聞く。よくある仕様に」。
// 座標は小数第5位（約1m）。国土地理院の座標と Google・Apple の座標のずれは1m未満。
// 選べるアプリは端末で変わる: iPhone・Mac は標準が Apple マップ（「この端末の標準」と添える）、Android は geo: で端末の地図アプリ、
// それ以外（Windows など）は端末の標準が無いので Google と Apple
AstroNotesPlan.externalApps=AstroNotesPlan.createExternalApps({storage:store,show:showSheet,onMapChange:()=>{renderCoordRows();aimRefreshSheetCands();}});
const MAP_APPS=AstroNotesPlan.externalApps.mapApps;
const coordText=c=>c.latitude.toFixed(5)+', '+c.longitude.toFixed(5);
const mapAppChoices=()=>AstroNotesPlan.externalApps.choices('map').map(x=>x.id);
const savedMapApp=()=>AstroNotesPlan.externalApps.get('map');
function openMapApp(app,t){AstroNotesPlan.externalApps.requestMap(t,{app});}
function openMapAppSheet(t){AstroNotesPlan.externalApps.requestMap(t,{forceChoose:true});}
function renderCoordRows() {
  const app = savedMapApp();
  for (const row of document.querySelectorAll(".coord-row")) {
    // 釦の名前は短く（Google・Apple）。「Google マップ」まで書くと 375px で座標と1行に並ばなかった。↗ の印で地図アプリへ飛ぶと分かる
    row.querySelector("[data-map-app-label]").textContent = app ? MAP_APPS[app].chipLabel : "地図アプリ";
    row.querySelector("[data-map-app-change]").hidden = !app;
    row.querySelector("[data-map-app-open]").classList.toggle("split", !!app);
  }
}
async function copyText(t) {
  try { await navigator.clipboard.writeText(t); return true; } catch { /* 古い仕組みで写す */ }
  const ta = document.createElement("textarea");
  ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.appendChild(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch { ok = false; }
  ta.remove();
  return ok;
}
for (const row of document.querySelectorAll(".coord-row")) {
  // ISS は選んでいる回の立つ場所の例、ほかは地図の中心（ピン）
  const center = () => (row.dataset.map === "iss" ? issStandPoint() : ({ aim: AimMap, plane: PlaneMap })[row.dataset.map].center());
  const copy = row.querySelector("[data-coord-copy]");
  // 地図をまだ描いていない（座標が「—」）なら何もしない（見えていない初期位置を写さない）
  const ready = () => row.querySelector(".coord").textContent !== "—" && !!center();
  copy.onclick = async () => {
    if (!ready()) return;
    const ok = await copyText(coordText(center()));
    const done = copy.querySelector(".copied"), c = copy.querySelector(".coord");
    done.textContent = ok ? "コピーしました" : "コピーできませんでした";
    done.hidden = false; c.hidden = true;
    clearTimeout(copy.timer);
    copy.timer = setTimeout(() => { done.hidden = true; c.hidden = false; }, 1500);
  };
  row.querySelector("[data-map-app-open]").onclick = () => {
    if (!ready()) return;
    const app = savedMapApp(), t = coordText(center());
    if (app) openMapApp(app, t); else openMapAppSheet(t);
  };
  row.querySelector("[data-map-app-change]").onclick = () => { if (ready()) openMapAppSheet(coordText(center())); };
}
renderCoordRows();
export {MAP_APPS,coordText,openMapApp,openMapAppSheet,savedMapApp};
