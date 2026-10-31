import {$} from '../../app/presentation-helpers.js';
import {favorites,sightings,store} from '../../app/browser-state.js';
import {render} from '../forecast/view.js';
import {accountFail,apiTransport,auth,clearAuth,dataOwner,lastLoginId,pushQueue,syncInfo,withPendingAction} from './session-and-access.js';
import {renderAuthButton} from './status.js';
import {adoptToken} from './remember-and-token.js';
import {authFail} from './auth-panels.js';
import {checkPw} from './password-policy.js';
import {openAccountSheet} from './account-actions.js';
import {openAccountSheet2,showCodes} from './recovery-codes.js';
import {clearAdminView} from './admin-view.js';
function clearRetiredStorage(loginId) {
  const suffix = encodeURIComponent(loginId);
  let cleared = true;
  for (const prefix of ["sorami.observations.v1:", "sorami.placeShapes.v1:", "sorami.schedule.v1:", "sorami.recordSync.v1:", "sorami.skyMap:", "astronotes.sky-ratings.v2:"]) {
    try { localStorage.removeItem(prefix + suffix); } catch { cleared = false; }
  }
  return cleared;
}
$("deleteAccount").onclick = async () => {
  const retiringId = auth?.loginId, retiringToken = auth?.token;
  // 消えるのはサーバー側だけでなく、この端末のものも含めて全部。取り返しがつかない。
  if (!confirm("アカウントに紐づくすべてのデータを削除します。\n"
    + "取り消せません。\n\n先に「記録」の「データの控え」から書き出してください。写真ファイルは控えに含まれません。\n\n本当に削除しますか？")) return;
  if (!confirm("最終確認です。アカウントを削除しますか？")) return;
  try {
    await apiTransport("DELETE", "/me");
    const cleared = clearRetiredStorage(retiringId);
    if (auth?.token !== retiringToken) return;
    clearAuth(); clearAdminView(); syncInfo = null; pushQueue = [];
    favorites = []; sightings = [];
    dataOwner = null; store.set("sorami.owner", null);
    for (const k of ["sorami.sync", "sorami.queue", "sorami.favorites", "sorami.sightings"]) store.set(k, k.endsWith("sync") ? null : []);
    $("accountSheet").close();
    renderAuthButton();
    render();
    if (!cleared) alert("アカウントは削除しましたが、この端末の保存データを消せませんでした。ブラウザのサイトデータを削除してください。");
  } catch (e) { accountFail(e.message); }
};
$("enablePw").onclick = async () => {
  $("accountErr").hidden = true;
  try {
    const weakAcc = checkPw($("newAccPw").value, auth?.loginId ?? "");
    if (weakAcc) { authFail($("accountErr"), weakAcc); return; }
    adoptToken(await apiTransport("POST", "/password/enable", { password: $("newAccPw").value }));
    $("newAccPw").value = "";
    if($("accountSheet").open)openAccountSheet();
  } catch (e) { accountFail(e.message); }
};
$("disablePw").onclick = async () => {
  if (!confirm("パスワードでのログインをやめます。\n代わりの回復コードを発行します。必ず保存してください。")) return;
  try { const r = await apiTransport("POST", "/password/disable", {}); adoptToken(r); showCodes(r.codes); openAccountSheet2(); }
  catch (e) { accountFail(e.message); }
};
// **取り消しの唯一の手段。** トークンは署名だけで検証でき、サーバーに残らないので、
// 世代番号を進める以外に「あの端末を切る」方法が無い。
$("logoutAll").onclick = async () => {
  if (!confirm("ほかの端末のログインをすべて切ります。\nこの端末は入ったままです。\n\n続けますか？")) return;
  try {
    adoptToken(await apiTransport("POST", "/me/logout-all"));
    alert("ほかの端末のログインを切りました。");
  } catch (e) { accountFail(e.message); }
};

$("logout").onclick = () => {
  // 同期済みのものはローカルから消す。残すと、別のアカウントで入ったときに混ざる。
  if (pushQueue.length && !confirm(`まだ送っていない変更が ${pushQueue.length}件 あります。\n消えますが、ログアウトしますか？`)) return;
  clearAuth(); clearAdminView(); syncInfo = null; pushQueue = [];
  favorites = []; sightings = [];
  lastLoginId = null;
  dataOwner = null; store.set("sorami.owner", null);
  store.set("sorami.sync", null); store.set("sorami.queue", []);
  store.set("sorami.favorites", []); store.set("sorami.sightings", []);
  $("accountSheet").close();
  renderAuthButton();
  render();
};

for(const id of ['doSignupPasskey','passkeyLogin','pwLogin','signupPasskey','doSignup','codeLogin','addPasskey','newRecovery','deleteAccount','enablePw','disablePw','logoutAll']){
  const button=$(id),panel=button.closest('dialog');button.onclick=withPendingAction(panel,button,button.onclick);
}

// 所有者向けの処理は認証済みAPIから取得する。公開ページは空の受け皿だけ持つ。
