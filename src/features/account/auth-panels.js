import {$} from '../../app/presentation-helpers.js';
import {auth,pendingAccountPanels} from './session-and-access.js';
import {showSheet} from '../../app/overlays.js';
import {wantsRemember} from './remember-and-token.js';
import {onLoggedIn} from './login-session.js';
import {ID_MSG,ID_RE} from './password-policy.js';
import {leaveAccountCodes,openAccountSheet,signupWithPasskey} from './account-actions.js';
import {openAccountSheet2,showCodes,shownCodes} from './recovery-codes.js';
const RATING_LOGIN_KEY = "astronotes.rating.login";
let loginSettling = false;
const ratingLoginPending = () => { try { return sessionStorage.getItem(RATING_LOGIN_KEY) === "1"; } catch { return false; } };
function finishRatingLogin() {
  if (!ratingLoginPending()) return;
  setTimeout(() => {
    if (!ratingLoginPending() || loginSettling || document.querySelector("dialog[open]")) return;
    try { sessionStorage.removeItem(RATING_LOGIN_KEY); } catch {}
    if (auth) location.href = "sky-rating.html";
  }, 0);
}
// 起動の画面選び（openStartup）が終わってから開く。先に開くと、起動時の画面の切り替えで閉じられる
function resumeRatingLogin() { if (!ratingLoginPending()) return; if (auth) finishRatingLogin(); else $("authButton").click(); }

const authFail = (el, msg) => {
  el.textContent=msg;el.hidden=false;el.setAttribute('role','alert');
  const dialog=el.closest('dialog');
  if(dialog?.open){const r=el.getBoundingClientRect(),d=dialog.getBoundingClientRect(),head=dialog.querySelector('.sheet-head')?.getBoundingClientRect();if(r.top<Math.max(0,head?.bottom??d.top)||r.bottom>Math.min(innerHeight,d.bottom))el.scrollIntoView({block:'center',behavior:'instant'});}
};
// 新規登録は欄ごとにエラーを出すので、次に出すときは前の分を全部消す。
// 消し忘れると、直した欄の下に古い理由が残る。
const AUTH_ERRS = ["authErr", "newIdErr", "newPwErr"];
const clearAuthErrs = () => { for (const id of AUTH_ERRS) $(id).hidden = true; };


// 同じダイアログの中で1画面ずつ出す。目的の違うフォームを同時に見せない。
const AUTH_PANELS = { login: "ログイン", signup: "新規登録", recovery: "アカウントの回復",
  passkey: "パスキーの登録" };
function showAuthPanel(which) {
  clearAuthErrs();
  for (const k of Object.keys(AUTH_PANELS)) {
    $("panel" + k[0].toUpperCase() + k.slice(1)).hidden = k !== which;
  }
  $("authTitle").textContent = AUTH_PANELS[which];
  // 開いた画面の最初の欄へ入れるようにする
  const first = { login: "authId", signup: "newId", recovery: "codeId" }[which];
  if (first && which !== "login") $(first).focus();
}
$("authButton").onclick = () => {
  if (auth) { openAccountSheet(); return; }
  // パスキー非対応のブラウザでは、出しても押せないので隠す
  const supported = !!window.PublicKeyCredential;
  $("passkeyLogin").hidden = !supported;
  $("passkeyNote").hidden = !supported;
  showAuthPanel("login");
  showSheet($("authSheet"));
};
// パスキーに寄せる。対応していない端末では丸ごと隠して、これまでどおりパスワードで登録する。
function setSignupWays() {
  const supported = !!window.PublicKeyCredential;
  $("signupPasskeyWay").hidden = !supported;
  // 対応端末では、まずパスキーだけを出す。パスワードは押されたときに出す。
  $("signupPwWay").hidden = supported;
  $("doSignupPasskey").classList.toggle('primary',supported);
  $("showSignupPw").hidden=false;
}
$("goSignup").onclick = () => { setSignupWays(); showAuthPanel("signup"); };
$("showSignupPw").onclick = () => {
  // **パスキーの口は残す。** 引っ込めると、選び直せないように見える。
  $("signupPwWay").hidden = false;
  $("doSignupPasskey").classList.remove('primary');
  $("showSignupPw").hidden = true;
  $("newPw").focus();
};
$("doSignupPasskey").onclick = async () => {
  clearAuthErrs();
  // パスキーで送るのはIDだけなので、断られる理由もIDのこと。ID欄の下に出す。
  if (!ID_RE.test($("newId").value.trim().toLowerCase())) { authFail($("newIdErr"), ID_MSG); $("newId").focus(); return; }
  try {
    const res = await signupWithPasskey($("newId").value, wantsRemember());
    // 回復コードを見せきるまで閉じない。ここで閉じると、二度と出せないものが消える。
    await onLoggedIn(res, undefined, { keepOpen: true });
    $("authSheet").close();
    showCodes(res.codes);
    await openAccountSheet2();
  } catch (e) {
    if (e.name === "NotAllowedError") return;    // 生体認証を取り消しただけ
    authFail($("newIdErr"), e.message);
  }
};
$("goRecovery").onclick = () => showAuthPanel("recovery");
for (const el of document.querySelectorAll("[data-back]")) el.onclick = () => showAuthPanel("login");
$("authClose").onclick = () => $("authSheet").close();
// 写真の評価から来たログインは、ログインの画面（と続けて開く回復コードの画面）を閉じたときに評価へ戻す
for (const id of ["authSheet", "accountSheet"]) $(id).addEventListener("close", finishRatingLogin);
$("accountClose").onclick = () => { if(leaveAccountCodes()) $("accountSheet").close(); };
$("accountSheet").addEventListener('keydown',event=>{
  if(event.key!=='Escape'||$("recoveryShown").hidden)return;
  event.preventDefault();event.stopPropagation();
  if(!pendingAccountPanels.has($("accountSheet")) && leaveAccountCodes())$("accountSheet").close();
});
$("accountSheet").addEventListener('cancel',event=>{ if(!leaveAccountCodes())event.preventDefault(); });
$("accountSheet").addEventListener('close',()=>{
  $("recoveryShown").hidden=true; $("recoveryCode").textContent=''; shownCodes=[]; $("accountSheet").dataset.codesShown='false';
  $("newAccPw").value=''; $("loginHistoryList").textContent='';
});

// base64url ⇄ ArrayBuffer。WebAuthn の受け渡しで要る。
export {authFail,clearAuthErrs,finishRatingLogin,loginSettling,resumeRatingLogin,showAuthPanel};
