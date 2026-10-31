import {S} from '../../app/presentation-helpers.js';
const AIM_SENSOR = { full: [36, 24], aps: [23.5, 15.6], canon: [22.3, 14.9], m43: [17.3, 13] };
// 旧版の固定200mmは引き継がず、見やすい自動表示を初期値にする。
// グリッドは中央固定の撮影枠にだけ重ねる。実景や天体の座標は変更しない。
function aimDrawGrid(ctx, x, y, w, h, mode) {
  if (!["thirds", "diagonal"].includes(mode)) return;
  ctx.save(); ctx.setLineDash([]); ctx.beginPath();
  for (const ratio of [1/3, 2/3]) {
    ctx.moveTo(x + w * ratio, y); ctx.lineTo(x + w * ratio, y + h);
    ctx.moveTo(x, y + h * ratio); ctx.lineTo(x + w, y + h * ratio);
  }
  if (mode === "diagonal") {
    ctx.moveTo(x, y); ctx.lineTo(x + w, y + h);
    ctx.moveTo(x + w, y); ctx.lineTo(x, y + h);
  }
  ctx.strokeStyle = "rgba(0,0,0,.45)"; ctx.lineWidth = 3; ctx.stroke();
  ctx.strokeStyle = "rgba(255,255,255,.65)"; ctx.lineWidth = 1; ctx.stroke(); ctx.restore();
}
const aimLens = (() => { try { const x = JSON.parse(localStorage.getItem("sorami.lens") || "{}"); return { on: x.mode ? !!x.on : true, mode: x.mode === "manual" ? "manual" : "auto", focal: Number.isFinite(x.focal) && x.focal >= 8 && x.focal <= 2000 ? x.focal : null, sensor: AIM_SENSOR[x.sensor] ? x.sensor : "full", portrait: !!x.portrait, grid: ["thirds", "diagonal"].includes(x.grid) ? x.grid : "none" }; } catch { return { on: true, mode: "auto", focal: null, sensor: "full", portrait: false, grid: "none" }; } })();
const aimLookHosts = new Set();
const aimLookHMS = (ms) => `${S.JstCal.hhmm(ms)}:${String(new Date(ms).getUTCSeconds()).padStart(2, "0")}`;
/// 重なる時刻からの差を短く（「重なる3分前」「重なる20秒後」）
function aimLookRel(dt, name = "重なる") {
  if (Math.abs(dt) < 1000) return `${name}時刻`;
  const s = Math.round(Math.abs(dt) / 1000);
  // 1時間を超えると秒まで読む意味が薄く、下部の日時欄にも収まらない。
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  const v = s < 60 ? `${s}秒` : h ? `${h}時間${m ? `${m}分` : ""}` : s % 60 ? `${m}分${s % 60}秒` : `${m}分`;
  return `${name}${v}${dt < 0 ? "前" : "後"}`;
}
/**
 * 見え方の図を host に描く。spec: { obs: 立つ場所（elevation は地面の標高）, eyeM: 地面からの目の高さ, at: 重なる時刻, label: 場所の名前 }
 */
// 部品を別々に不透明マスクへ描き、外の空から届かない内部の穴だけ埋める。
// 凸包ではないので、城の塔間・像の腕の外など、空へ開いた凹輪郭を保つ。
export {AIM_SENSOR,aimDrawGrid,aimLens,aimLookHMS,aimLookHosts,aimLookRel};
