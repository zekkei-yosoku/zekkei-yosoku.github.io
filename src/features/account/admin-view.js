import {$} from '../../app/presentation-helpers.js';
import {SkyMapUI,viewState} from '../../app/browser-state.js';
import {navigationHistory} from '../../app/navigation.js';
import {apiTransport,askReauth,auth} from './session-and-access.js';
import {recheckAccess} from './access-recheck.js';
import {nextStep} from './guidance.js';
let adminRenderSeq = 0, adminRenderAuth = null, privateModulePromise = null;
let privateDraft = null;
let privateEntrySeq = 0, adminUnmount = null, privateModule = null, privateModuleToken = null;
function clearAdminView() {
  privateDraft = null;
  adminRenderSeq++; privateEntrySeq++; adminUnmount?.(); adminUnmount = null;
  privateModule = null; privateModuleToken = null; privateModulePromise = null;
  $("adminView").replaceChildren(); $("settingsPrivateEntry")?.replaceChildren();
}
async function ownerModule() {
  const token = auth?.token;
  if (!token || window.top !== window.self) throw new Error("この画面を開けません");
  if (privateModule && privateModuleToken === token) return privateModule;
  if (privateModulePromise?.token === token) return privateModulePromise.promise;
  const promise = (async () => {
    const bundle = await apiTransport("GET", "/admin/ui");
    if (auth?.token !== token || !bundle || bundle.version !== 1 || typeof bundle.module !== "string") throw new Error("画面の確認をやり直してください");
    const url = URL.createObjectURL(new Blob([bundle.module], {type:"text/javascript"}));
    try {
      const module = await import(url);
      if (auth?.token !== token) throw new Error("画面の確認をやり直してください");
      privateModule = module; privateModuleToken = token; return module;
    } finally { URL.revokeObjectURL(url); }
  })();
  privateModulePromise = {token, promise};
  try { return await promise; } finally { if (privateModulePromise?.promise === promise) privateModulePromise = null; }
}
// 管理の入口は設定一覧に置く（2026-10-15 ユーザー「右上→設定→アカウント→管理者の画面、と入るのが深すぎる」）。
// 入口の部品も所有者の確認を通ったあとに非公開APIから受け取る（E186）。
async function renderPrivateEntry() {
  const seq = ++privateEntrySeq, token = auth?.token, box = $("settingsPrivateEntry");
  box?.replaceChildren();
  if (!box || !token) return;
  // ログイン直後でまだ所有者か分からなければ訊く。取れなければ入口を出さない（判定はサーバー）
  if (auth.ownerAdmin === undefined) {
    try { const me = await apiTransport("GET", "/me"); if (seq !== privateEntrySeq || token !== auth?.token) return; auth = { ...auth, ownerAdmin: !!me.ownerAdmin }; }
    catch { return; }
  }
  if (!auth.ownerAdmin) return;
  try {
    const module = await ownerModule();
    if (seq !== privateEntrySeq || token !== auth?.token || !$("appSettings").open) return;
    box.append(module.entry({open:()=>{$("appSettings").close();navigationHistory.pushRoute("#/admin");}}));
  } catch (e) {
    if (seq !== privateEntrySeq || token !== auth?.token || !$("appSettings").open) return;
    const reauth = e.code === "reauth_required";
    const denied = e.status === 403;
    const status = document.createElement("p");
    status.className = "warn"; status.setAttribute("role", "status");
    status.textContent = reauth ? "管理者の画面を開くには、もう一度ログインしてください。"
      : denied ? "管理者の権限を確認できませんでした。"
      : "管理者の画面を読み込めませんでした。再試行してください。";
    box.append(status);
    if (denied) return;
    const retry = document.createElement("button");
    retry.type = "button"; retry.className = "fav-btn"; retry.style.marginTop = "8px";
    retry.textContent = reauth ? "ログインして管理者の画面を確認" : "管理者の画面を再試行";
    retry.onclick = () => {
      if (seq !== privateEntrySeq || token !== auth?.token || !$("appSettings").open) return;
      if (reauth) askReauth(); else renderPrivateEntry();
    };
    box.append(retry);
  }
}
async function renderAdmin() {
  const seq = ++adminRenderSeq, token = auth?.token;
  adminRenderAuth = auth; adminUnmount?.(); adminUnmount = null;
  $("adminView").replaceChildren();
  const status = document.createElement("p"); status.className = "warn"; status.setAttribute("role","status");
  status.textContent = token ? "確認しています…" : "ログインしてください"; $("adminView").append(status);
  if (!token) return;
  try {
    const module = await ownerModule();
    if (seq !== adminRenderSeq || auth?.token !== token || !viewState.admin) return;
    $("adminView").replaceChildren();
    adminUnmount = module.mount($("adminView"), {nextStep,draft:privateDraft && privateDraft.loginId===auth.loginId?privateDraft.value:null,apiCall:async (...args)=>{
      if (seq !== adminRenderSeq || auth?.token !== token || !viewState.admin) throw new Error("画面の確認をやり直してください");
      const result = await apiTransport(...args);
      if (seq !== adminRenderSeq || auth?.token !== token || !viewState.admin) throw new Error("画面の確認をやり直してください");
      return result;
    }, onReauth:askReauth});
  } catch (e) {
    if (seq !== adminRenderSeq || auth?.token !== token || !viewState.admin) return;
    status.textContent = e.message; $("adminView").replaceChildren(status);
    // 読めなかったときも、その場でやり直せるようにする（2026-10-15）
    const reauth = e.code === "reauth_required";
    if (e.status !== 403) {
      const again = document.createElement("button"); again.type = "button"; again.className = "chip";
      again.textContent = reauth ? "ログインし直す" : "再試行";
      again.onclick = () => { if (seq === adminRenderSeq && auth?.token === token && viewState.admin) { if (reauth) askReauth(); else renderAdmin(); } };
      $("adminView").append(again);
    }
    if (reauth) askReauth();
  }
}
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    const draft = adminUnmount?.snapshot?.(); const loginId = auth?.loginId;
    clearAdminView(); if (draft && loginId) privateDraft = {loginId,value:draft};
    SkyMapUI?.suspend();
  } else {
    if (viewState.admin) renderAdmin();
    if (viewState.skyMap) SkyMapUI?.open(true);
    void recheckAccess(30 * 1000);
  }
});
window.addEventListener("pagehide", clearAdminView);
window.addEventListener("pageshow", e => { if (!e.persisted) return; if (viewState.admin) renderAdmin(); void recheckAccess(30 * 1000); });

// **次の一歩を示す。** 危なさを言うだけでは、何をすればいいか分からない。
//
// 一番好ましい形は「パスキー ＋ パスワード無効 ＋ 回復コードを保管」。
// そこへ向かう順序として案内する。段は飛ばさない。
//
//   1. パスキーを使っていない  → パスキーを薦める
//   2. パスキーが使えている（PWも生きている） → パスワードの無効化を薦める
//   3. 無効化まで済んだ → 回復コードの話
//   4. 揃った → 何も言わない
//
// 数では判定しない。「パスワード1 + パスキーの台数 + 回復コードがあれば1」を
// 足していたが、種類の違うものを足しても意味を持たない。パスキー2台は「2」だが
// 同じキーチェーンなら実質1つで、**台数は端末を失う話の答えにならない。**
// 残りがこれ以下になったら発行し直しを促す
export {adminRenderAuth,adminUnmount,clearAdminView,privateDraft,renderAdmin,renderPrivateEntry};
