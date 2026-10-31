// ---------------------------------------------------------------- 同期とログイン
//
// ログインは任意。押さなくても予報は全部見られる。ログインは「他の端末へ持ち越す」
// ためのもので、機能の門ではない。
//
// トークンの置き場所。**2段階ある。**
//
//   sessionStorage — 常に置く。読み込み直しで消えないようにするだけで、
//                    タブを閉じれば消える。メモリのみとの差はほぼ無い
//                    （このページで動く攻撃者は、どのみちメモリの変数を読める）
//   localStorage   — 「この端末でログインを保持する」を選んだときだけ。30日
//
// 元はメモリのみだった。しかし更新の自動読み直しが入ってからは、
// **配信のたびに再ログインが要る**状態になっていた。それは使えない。
//
// 長く持たせるにあたって、サーバー側に**取り消しの仕組みを先に入れた**
// （users.session_epoch）。トークンは署名だけで検証でき保存されないので、
// それが無いと「漏れたら期限まで止められない」ことになる。
const API = location.hostname === "localhost" || location.hostname === "127.0.0.1"
  ? "http://localhost:8787" : "https://zekkei-api.okayu-sorami.workers.dev";
const TOKEN_KEY = "sorami.token";

const accessState = { generation: 0 };             // 認証が切り替わるたびに増える世代。所有者はここだけ
let auth = null;                                   // { token, loginId, role }
let accessCheckedAt = 0;                           // 最後に /me で権限を確かめた時刻（recheckAccess）

// 置き場所は「保持する」を選んだかどうかで変わる。両方から消してから書く。
const authStorage = AstroNotesAuthStorage.create({session:()=>sessionStorage,local:()=>localStorage,boxStorage:name=>window[name],key:TOKEN_KEY});
function clearAuth() {
  accessState.generation++;
  auth = null;
  clearAdminView();
  authStorage.clear();
}
// localStorage を先に見る。「保持する」を選んだ端末では、タブを閉じても続く。
let syncInfo = store.get("sorami.sync", null);     // { loginId, rev }。端末に残す
let syncError = null;                              // 直近の同期の失敗
let pushQueue = store.get("sorami.queue", []);     // 送れていない変更 [{kind,id}]

// 手元のデータが誰のものか。null は「一度もログインしていない」。
// **401でセッションが切れても、これは消さない。** 誰のデータかは分かったままにする。
let dataOwner = store.get("sorami.owner", null);

// ログインしたとき、手元に残っているデータをどうするか。
//
// 401ではデータを消さない（サーバーが一時的に落ちただけで手元が空になってはいけない）。
// その結果、**別の人がログインしたときに前の人のデータが残っている**ことがある。
// 以前はそれを「初回ログイン」と読んで、まるごと新しいアカウントへ上げていた。
//
// 判断（2026-09-08）: 引き継ぐのは**一度もログインしていない端末のときだけ**。
// 「初めて入る人が、それまで手元に貯めた記録を持ち込む」は残す。
function migrationPlan(owner, loginId, hasLocal) {
  const same = (a, b) => String(a ?? "").trim().toLowerCase() === String(b ?? "").trim().toLowerCase();
  if (owner == null) return hasLocal ? "migrate" : "keep";   // 持ち主が居ない = 持ち込んでよい
  if (same(owner, loginId)) return "keep";                   // 同じ人の続き
  return "discard";                                          // 別の人。渡さない
}

const apiTransport = AstroNotesHttpClient.create({base:API,fetch:(...args)=>fetch(...args),getAuth:()=>auth,getGeneration:()=>accessState.generation,onUnauthorized:()=>{clearAuth();renderAuthButton();}});

// 長いセッションで、直前2時間より古いまま認証手段を変えようとすると、
// サーバーが「確認のため、もう一度ログインしてください」と断る（判断1）。
// **断って終わりにしない。** その場で入り直せる画面を開き、IDを写しておく。
// パスキーがあれば1回の Face ID で済む。
// アカウント画面での失敗の出し方。**確認し直しを求められたときだけ扱いを変える。**
// ほかの失敗は、そのまま理由を出す。
function accountFail(message) {
  if (/確認のため、もう一度ログイン/.test(message)) { askReauth(); return; }
  authFail($("accountErr"), message);
}

// A panel owns one pending action; preserve its original disabled states and labels.
const pendingAccountPanels=new WeakSet();
function withPendingAction(panel,button,action){
  return async function(event){
    if(pendingAccountPanels.has(panel))return;
    pendingAccountPanels.add(panel);
    const holdOpen=['doSignupPasskey','doSignup','newRecovery','disablePw'].includes(button.id);
    const cancel=e=>{if(holdOpen)e.preventDefault();};panel.addEventListener('cancel',cancel);
    const controls=[...panel.querySelectorAll('button')].filter(e=>holdOpen||!e.matches('.page-back,[data-back],.panel-back,#authClose,#accountClose,#accountBack'));
    const disabled=controls.map(e=>[e,e.disabled]),label=button.innerHTML;
    for(const [e]of disabled)e.disabled=true;
    panel.setAttribute('aria-busy','true');button.setAttribute('aria-busy','true');button.textContent='処理中…';
    try{return await action.call(button,event);}
    finally{for(const [e,value]of disabled)if(e.isConnected)e.disabled=value;button.innerHTML=label;button.removeAttribute('aria-busy');panel.removeAttribute('aria-busy');panel.removeEventListener('cancel',cancel);pendingAccountPanels.delete(panel);}
  };
}

// 401 を受けた時点で clearAuth() が走り auth が消える。**誰だったかは覚えておく。**
// でないと、入り直す画面でIDを打ち直させることになる。
let lastLoginId = null;

function askReauth() {
  $("accountSheet").close();
  showAuthPanel("login");
  $("authId").value = auth?.loginId ?? lastLoginId ?? "";
  $("authPw").value = "";
  const supported = !!window.PublicKeyCredential;
  $("passkeyLogin").hidden = !supported;
  $("passkeyNote").hidden = !supported;
  if (!$("authSheet").open) showSheet($("authSheet"));
  authFail($("authErr"), "確認のため、もう一度ログインしてください");
  if (!supported) $("authPw").focus();
}

/** 利用権限は /me の tools が正本。メニュー・直URL・画面の操作に同じ判定を使う。
 * 公開JavaScriptの配布制限ではない。個人データと管理操作はAPIでも認証する。
 * recordsは記録一覧の閲覧権限。予測詳細からの回答・入力は別の既存仕様。
 */
function allowedTools() {
  return auth?.token && Array.isArray(auth.tools) ? auth.tools : [];
}
/// **道具の中身は、メニュー以外の画面でも同じ判定で出し分ける。**
/// 富士山の詳細のダイヤモンド富士・パール富士、月の詳細の「空の見え方を見る」など。
/// メニューだけ隠しても、誰でも開く詳細に出ていれば見えてしまう（2026-10-01 ユーザー指摘）
function toolAllowed(id) {
  return allowedTools().includes(id);
}
/// 画面ごとに要る許可は astronotes-access.js の認可表だけを見る（構図・地図・月丼・ISS・記録）
function screenAllowed(screen) {
  return AstroNotesAccess.canOpen(allowedTools(), screen);
}
const RESTRICTED_SCREENS = ["plane", "iss", "records", "answers"];
function renderToolAccess(id) {
  const permitted = screenAllowed(id);
  $(id + "View").toggleAttribute("data-locked", !permitted);
  $(id + "Access").hidden = permitted;
  if (!permitted) {
    $(id + "AccessMessage").textContent = auth?.token
      ? AstroNotesAccess.SCREENS[id].label + "の利用が許可されていません"
      : "ログインすると利用権限を確認できます";
    $(id + "AccessLogin").hidden = !!auth?.token;
  }
  return permitted;
}
for (const id of RESTRICTED_SCREENS) {
  $(id + "AccessLogin").onclick = () => $("authButton").click();
}
let restrictedToolsKey = null;
function refreshRestrictedTools() {
  const key = JSON.stringify([auth?.token, allowedTools()]);
  for (const id of RESTRICTED_SCREENS) renderToolAccess(id);
  if (key === restrictedToolsKey) return;
  restrictedToolsKey = key;
  // 古いアカウント/権限で開始した処理を無効にし、記録を即座に消す。
  plane.seq++; iss.seq++; photosRequest++;
  photos = []; photosCursor = null; photosOwner = null; photosLoading = false; photosError = null; renderPhotos(); renderPhotoListState();
  if (viewState.aim) openAim(null);
  if (viewState.plane) openPlane();
  if (viewState.iss) openIss();
  if (viewState.answers) loadPhotos();
  if (viewState.answers) {
    $("answerHistory").open=false;
    renderRecords(Date.now(),true);
    if(toolAllowed("records"))void savedRoundClient.ensure(place,()=>render());
  }
}
function renderTools() {
  $("skyMapOpen").hidden = !screenAllowed("skymap");
  const allowed = allowedTools();
  let shown = 1; // The local astronomical almanac is available without a protected API.
  for (const el of $("toolsMenu").querySelectorAll("[data-id]")) {
    // どれか1つでも許されていれば出す（富士山に重ねるは、ダイヤモンド富士かパール富士のどちらか）
    const on = el.dataset.id.split(" ").some((id) => allowed.includes(id));
    el.hidden = !on;
    if (on) shown++;
  }
  $("astroToolsGroup").hidden = !Array.from($("astroToolsGroup").querySelectorAll("[data-id]")).some(el=>!el.hidden);
  $("toolsButton").hidden = shown === 0;
  if (shown === 0) closeTools();
  globalThis.TrialExplore?.render();
}
/**
 * 引き出しの開け閉め。
 * `hidden` を外してから次のフレームで `.on` を付ける（そうしないと動きが出ない）。
 * 閉じるときは動きが終わってから `hidden` へ戻す。
 */
let toolsAnim = 0;
/// focus: キーボードや ☰ から開いたときは最初の項目へ。なぞって開いたときは焦点を動かさない（青い枠が出る）
function openTools({ focus = true } = {}) {
  clearTimeout(toolsAnim);
  markToolsCurrent();
  $("toolsScrim").hidden = false;
  $("toolsMenu").hidden = false;
  // **次のフレームを待たない。** `requestAnimationFrame` は画面が止まっていると
  // 呼ばれないことがあり、そのときは引き出しが画面の外に居たまま開いたことになる
  // （2026-09-28 実測）。読み取りで組み直しを起こしてから、その場で class を付ける。
  void $("toolsMenu").offsetWidth;
  $("toolsScrim").classList.add("on");
  $("toolsMenu").classList.add("on");
  $("toolsButton").setAttribute("aria-expanded", "true");
  // 開いているあいだ、後ろは動かさない（閉じたときに位置が変わらないように）
  document.body.style.overflow = "hidden";
  if (focus) $("toolsHome").focus();
}
function closeTools({ restoreFocus = false } = {}) {
  if ($("toolsMenu").hidden) return;
  $("toolsScrim").classList.remove("on");
  $("toolsMenu").classList.remove("on");
  $("toolsButton").setAttribute("aria-expanded", "false");
  document.body.style.overflow = "";
  clearTimeout(toolsAnim);
  toolsAnim = setTimeout(() => { $("toolsScrim").hidden = true; $("toolsMenu").hidden = true; }, 220);
  if (restoreFocus) $("toolsButton").focus();
}
/// いまいる画面に帯を付ける。戻ってきたときにどこから来たか分かる
function markToolsCurrent() {
  if(location.hash==='#/almanac')$("almanacMenu").setAttribute('aria-current','page');
  else $("almanacMenu").removeAttribute('aria-current');
  // 予測の振り返りは予測の中の画面なので、予測に帯を付ける（2026-10-17 ユーザー「予測の振り返りは予測の中にあるべき」）
  if (!routeFromHash() || routeFromHash().answers) $("toolsHome").setAttribute("aria-current", "page");
  else $("toolsHome").removeAttribute("aria-current");
  for (const el of $("toolsMenu").querySelectorAll("[data-tool]")) {
    const route = routeFromHash(), here = route?.aim ? "#/aim/tower" : route?.iss ? "#/iss" : location.hash;
    if (el.dataset.tool === here) el.setAttribute("aria-current", "page");
    else el.removeAttribute("aria-current");
  }
}
