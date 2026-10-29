// 記録の保存（記録・予定の画面のどちらで書いても）を拾って送る
{ const write = store.set; store.set = (key, value) => { const ok = write(key, value); if (ok) RecordSync.touched(key); return ok; }; }

/// 送れなかったものを覚えておく。次に繋がったときに送る。
function queuePush(kind, id) {
  if (!auth) return;
  const at = pushQueue.findIndex(q => q.kind === kind && q.id === id);
  const change = { kind, id };
  if (at < 0) pushQueue.push(change); else pushQueue[at] = change;
  store.set("sorami.queue", pushQueue);
  renderAuthButton();
  syncNow().catch(() => {});
}

async function syncNow() {
  if (!auth) return;
  const generation = authGeneration;
  if (syncNow.flight?.generation === generation) { syncNow.flight.again = true; return syncNow.flight.promise; }
  const job = { generation, again: false, promise: null };
  syncNow.flight = job;
  const current = () => generation === authGeneration && !!auth;
  job.promise = (async () => {
    try {
      let sent = 0;
      do {
        job.again = false;
        if (typeof RecordSync !== "undefined") RecordSync.scan();
        // 同じアカウントの通信は直列化し、500件を超える取込も続けて送る。
        while (pushQueue.length && sent++ < 40) {
          const batch = pushQueue.slice(0, 500);
          const favs = batch.filter(q => q.kind === "fav")
            .map(q => { const f = favorites.find(x => x.id === q.id); return f ? toItem(f) : toItem({ id: q.id }, true); });
          const sights = batch.filter(q => q.kind === "sight")
            .map(q => { const x = sightings.find(y => y.id === q.id); return x ? toItem(x) : toItem({ id: q.id }, true); });
          const recs = typeof RecordSync !== "undefined" ? batch.filter(q => q.kind === "rec").map(q => RecordSync.item(q.id)) : [];
          const res = await apiCall("POST", "/sync", { favorites: favs, sightings: sights,
            ...(recs.length ? { records: recs.map(({ sent, ...r }) => r) } : {}) });
          if (!current()) return;
          const okFav = new Set(res?.accepted?.favorites ?? []), okSight = new Set(res?.accepted?.sightings ?? []), okRec = new Set(res?.accepted?.records ?? []);
          const accepted = q => (q.kind === "fav" ? okFav : q.kind === "rec" ? okRec : okSight).has(q.id);
          if (recs.length) RecordSync.accepted(recs.filter(r => okRec.has(r.id)));
          // IDが同じでも送信中に編集された項目は別のオブジェクト。新しい変更は消さない。
          pushQueue = pushQueue.filter(q => !batch.includes(q) || !accepted(q));
          store.set("sorami.queue", pushQueue);
          if (!batch.some(accepted)) break;
        }
        let since = syncInfo?.loginId === auth.loginId && syncInfo.records === 1 ? (syncInfo.rev || 0) : 0;
        for (let round = 0; round < 20; round++) {
          const got = await apiCall("GET", `/sync?since=${since}`);
          if (!current()) return;
          applyIncoming(got);
          const next = got.rev ?? since;
          syncInfo = { loginId: auth.loginId, rev: next, records: 1 };
          store.set("sorami.sync", syncInfo);
          if (!got.more || next <= since) break;
          since = next;
        }
        syncError = pushQueue.length ? `未送信の変更が${pushQueue.length}件あります。同期を再試行してください` : null;
        if (pushQueue.length && sent >= 40) break;
      } while (job.again && current());
    } catch (e) {
      if (!current()) return;
      syncError = e.message;
    }
    if (current()) renderAuthButton();
  })();
  try { return await job.promise; }
  finally { if (syncNow.flight === job) syncNow.flight = null; }
}

/// サーバーから来たものをローカルへ入れる。**サーバー側も外部データとして検査する。**
/// 通信相手を信用しないのは、取り込みファイルを信用しないのと同じ理由。
function applyIncoming(got) {
  const put = (list, incoming, clean, kind) => {
    const pending = new Set(pushQueue.filter(q => q.kind === kind).map(q => q.id));
    const byId = new Map(list.map((x) => [x.id, x]));
    for (const row of incoming || []) {
      if (pending.has(row.id)) continue;
      if (row.deleted) { byId.delete(row.id); continue; }
      let body; try { body = JSON.parse(row.body); } catch { continue; }
      const cleaned = clean({ ...body, id: row.id });
      if (cleaned) byId.set(row.id, cleaned);
    }
    return [...byId.values()];
  };
  favorites = put(favorites, got.favorites, cleanFavorite, "fav");
  sightings = put(sightings, got.sightings, cleanSighting, "sight");
  if (typeof RecordSync !== "undefined") RecordSync.apply(got.records);
  store.set("sorami.favorites", favorites);
  store.set("sorami.sightings", sightings);
  globalThis.AstroTargetPicker?.refresh?.();
}

// 「保持する」の希望。**既定は外す**（2026-09-08 ユーザー判断）。
// 30日残る鍵を、頼まれてもいないのに置かない。外したままでも
// sessionStorage には入るので、**読み込み直しで再ログインにはならない。**
// 選んだかどうかは端末に覚えるので、一度入れた端末で勝手に外れない。
const wantsRemember = () => {
  const box = $("rememberMe");
  return box ? box.checked : store.get("sorami.remember", false);
};

// 認証手段を変える操作は、他の端末を切ったうえで新しいトークンを返す。
// **受け取らないと、操作した本人が自分の操作で締め出される。**
function adoptToken(res) {
  if (!res?.token || !auth || res.loginId !== auth.loginId) return res;
  auth = { ...auth, token: res.token };
  saveAuth(auth, !!localStorageHasToken());
  return res;
}
const localStorageHasToken = () => {
  try { return !!localStorage.getItem(TOKEN_KEY); } catch { return false; }
};

/// 権限は /me が正本。起動時（下の restoreSession）に加えて、画面へ戻ったとき・回線が戻ったとき・
/// 表示中は5分ごとに確かめ直す（2026-10-15 総点検A04）。別の端末での取消しは、次に確かめた時点で
/// 反映し、開いている保護画面はその場で閉じる。**変わっていなければ何も描き直さない。**
/// 圏外などで確かめられないときは、最後に確かめた権限のまま使える（起動時と同じ。
/// 2026-09-28 ユーザー指摘「圏外でログイン済みなのにメニューが出ない」）。保護APIはサーバーが毎回判定する。
const ACCESS_RECHECK_MS = 5 * 60 * 1000;
let accessRecheck = null;
const accessKey = (a) => JSON.stringify([a?.loginId, a?.role, !!a?.ownerAdmin, Array.isArray(a?.tools) ? a.tools : null]);
function recheckAccess(maxAge = ACCESS_RECHECK_MS) {
  if (!auth?.token || document.hidden || Date.now() - accessCheckedAt < maxAge) return null;
  if (accessRecheck) return accessRecheck;
  const token = auth.token, generation = authGeneration;
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10000);
  accessRecheck = (async () => {
    let me;
    try { me = await apiCall("GET", "/me", undefined, controller.signal); }
    catch { return; /* 401 は apiCall が片付ける。圏外・失敗は今の権限のまま、次の機会に確かめる */ }
    finally { clearTimeout(timer); accessRecheck = null; }
    if (generation !== authGeneration || auth?.token !== token) return;
    accessCheckedAt = Date.now();
    const next = { ...auth, loginId: me.loginId ?? auth.loginId, role: me.role ?? auth.role,
                   tools: Array.isArray(me.tools) ? me.tools : [], ownerAdmin: !!me.ownerAdmin };
    if (accessKey(next) === accessKey(auth)) return;
    // 管理画面は描き直しで組み直すので、書きかけを先に預ける（背面へ回るときと同じ）
    const draft = atAdmin ? adminUnmount?.snapshot?.() : null;
    if (draft && next.ownerAdmin) privateDraft = { loginId: next.loginId, value: draft };
    auth = next; lastLoginId = auth.loginId;
    saveAuth(auth, localStorageHasToken());
    if (atAim) openAim(null);
    renderAuthButton();
    render();
  })();
  return accessRecheck;
}
setInterval(() => void recheckAccess(), 60 * 1000);
window.addEventListener("online", () => void recheckAccess(30 * 1000));

// 開いたときに、残っているトークンで入り直す。
// **通るかどうかはサーバーに訊く。** 期限も、取り消されたかどうかも、手元では分からない。
async function restoreSession({ onAccessReady = () => {} } = {}) {
  const found = storedAuth();
  if (!found) return;
  authGeneration++;
  auth = found.auth;
  const generation = authGeneration;
  // **/me の返事を待たずに出す。** 待っていると、圏外や応答が遅いときに
  // ログイン済みなのにメニューが出ないままになる（2026-09-28 ユーザー指摘）
  renderAuthButton();
  const accessController = new AbortController(), accessTimer = setTimeout(() => accessController.abort(), 10000);
  try {
    const me = await apiCall("GET", "/me", undefined, accessController.signal);
    clearTimeout(accessTimer);
    if (generation !== authGeneration || !auth) return;
    auth = { ...auth, loginId: me.loginId ?? auth.loginId, role: me.role ?? auth.role,
             tools: Array.isArray(me.tools) ? me.tools : [], ownerAdmin: !!me.ownerAdmin };
    lastLoginId = auth.loginId;
    accessCheckedAt = Date.now();
    saveAuth(auth, found.remembered);
    if (atAim) openAim(null);
    render();
    onAccessReady();
    // 折り返しを過ぎた長いセッションは、ここで出し直す。
    // これをしないと、30日で持たせても30日目に必ず切れる。
    if (found.remembered) {
      try { adoptToken(await apiCall("POST", "/session/refresh")); } catch { /* 次の起動で試す */ }
    }
    renderAuthButton();
    await syncNow();
    if (generation !== authGeneration || !auth) return;
    // Refresh synced favorites without reapplying a launch preset over user input.
    if (atAim) openAim(null);
    SkyMapUI?.refreshTargets();
    render();
  } catch {
    // 401 は apiCall 側で片付いている。それ以外（圏外など）はトークンを捨てない
    renderAuthButton();
  } finally { clearTimeout(accessTimer); }
}

/// ログインできたときの共通処理。初回は端末に残っているものを全部上げる。
async function onLoggedIn(res, remember = wantsRemember(), { keepOpen = false } = {}) {
  loginSettling = true;
  try {
  const sameOwnerDraft = auth?.loginId === res.loginId ? (adminUnmount?.snapshot?.() || privateDraft?.value) : null;
  authGeneration++; clearAdminView();
  if (sameOwnerDraft) privateDraft = {loginId:res.loginId,value:sameOwnerDraft};
  auth = { token: res.token, loginId: res.loginId, role: res.role, tools: res.tools };
  accessCheckedAt = Array.isArray(res.tools) ? Date.now() : 0;
  const generation = authGeneration;
  lastLoginId = auth.loginId;
  saveAuth(auth, remember);
  // **使えるメニューはサーバーが決める。** ログインの返りに入っていなければ聞きに行く
  if (!Array.isArray(auth.tools)) {
    try {
      const me = await apiCall("GET", "/me");
      // /me と同じ項目を持つ。ownerAdmin が欠けると、次の確かめ直しで「変わった」と読んで管理画面を組み直す
      auth = { ...auth, tools: Array.isArray(me.tools) ? me.tools : [], role: me.role ?? auth.role, ownerAdmin: !!me.ownerAdmin };
      accessCheckedAt = Date.now();
      saveAuth(auth, remember);
    } catch { /* 取れなければ許可なしで出す */ }
  }
  if (generation !== authGeneration || auth?.loginId !== res.loginId) return;
  if (!keepOpen) $("authSheet").close();

  const plan = migrationPlan(dataOwner, auth.loginId, favorites.length || sightings.length);
  if (plan === "migrate") {
    // 一度もログインしていない端末。手元に貯めた記録を持ち込む
    pushQueue = [...favorites.map((f) => ({ kind: "fav", id: f.id })),
                 ...sightings.map((x) => ({ kind: "sight", id: x.id }))];
    store.set("sorami.queue", pushQueue);
  } else if (plan === "discard") {
    // **別の人のデータ。渡さないし、見せない。** 送信待ちも巻き添えで消す
    clearAdminView();
    aim.from=null; aim.plannerTransfer=null; aim.candPick=null;
    aim.sharedTarget=null; aim.pendingPlan=null; aim.wantSpot=null; aim.spot=null;
    store.set("sorami.aimFrom",null); store.set("sorami.aimCustom",null);
    favorites = []; sightings = []; pushQueue = [];
    store.set("sorami.favorites", []); store.set("sorami.sightings", []);
    store.set("sorami.queue", []);
  }
  if (plan !== "keep" || syncInfo?.loginId !== auth.loginId) {
    syncInfo = null; store.set("sorami.sync", null);
  }
  dataOwner = auth.loginId; store.set("sorami.owner", dataOwner);
  await syncNow();
  if (generation !== authGeneration || auth?.loginId !== res.loginId) return;
  renderAuthButton();
  if (atAim) openAim(routeFromHash()?.preset || null);
  render();
  // 件数のアラートは出さない。**取り込んだ結果はそのまま画面に出る**ので、
  // 同じことを数字で言い直すだけの割り込みになる。
  // 同期の状態（できている／未送信がある／失敗している）はアカウント画面に常時出す。
  } finally { loginSettling = false; finishRatingLogin(); }
}

// 写真の評価（sky-rating.html）からログインに来たときは、ログインを終えたら評価へ戻す（2026-10-28）。
// 同期を待ち、回復コードやパスキーの案内を開いている間は閉じるまで待つ。ログインせずに閉じたら戻らない。
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
const b64uToBuf = (s) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0));
const bufToB64u = (b) => btoa(String.fromCharCode(...new Uint8Array(b)))
  .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

// 一度入れた端末では、次に開いたときも入ったままにする
$("rememberMe").checked = store.get("sorami.remember", false);
$("rememberMe").onchange = (e) => store.set("sorami.remember", e.target.checked);

$("passkeyLogin").onclick = async () => {
  $("authErr").hidden = true;
  try {
    const { challengeId, options } = await apiCall("POST", "/passkey/login/begin", {});
    const cred = await navigator.credentials.get({ publicKey: {
      ...options, challenge: b64uToBuf(options.challenge),
      allowCredentials: (options.allowCredentials || []).map((c) => ({ ...c, id: b64uToBuf(c.id) })) } });
    const res = await apiCall("POST", "/passkey/login/finish", { challengeId, remember: wantsRemember(), response: {
      id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
      response: {
        clientDataJSON: bufToB64u(cred.response.clientDataJSON),
        authenticatorData: bufToB64u(cred.response.authenticatorData),
        signature: bufToB64u(cred.response.signature),
        userHandle: cred.response.userHandle ? bufToB64u(cred.response.userHandle) : null,
      },
      clientExtensionResults: cred.getClientExtensionResults() } });
    await onLoggedIn(res);
  } catch (e) {
    // 利用者が生体認証を取り消した場合はエラーにしない
    if (e.name === "NotAllowedError") return;
    authFail($("authErr"), e.message);
  }
};
$("pwLogin").onclick = async () => {
  $("authErr").hidden = true;
  try { await onLoggedIn(await apiCall("POST", "/login",
    { loginId: $("authId").value, password: $("authPw").value, remember: wantsRemember() })); }
  catch (e) { authFail($("authErr"), e.message); }
  finally { $("authPw").value = ""; }
};
// サーバー（api/src/auth.js の checkPassword）と同じ規則。**判定の正本はサーバー。**
// ここで見るのは、往復させる前に理由を言うため。文言も揃えてある。
// サーバー（api/src/auth.js の LOGIN_ID_RE）と同じ。判定の正本はサーバー。
const ID_RE = /^[a-z0-9][a-z0-9._-]{5,31}$/;
const ID_MSG = "IDは6〜32文字。英字・数字と . _ - が使えます（1文字目は英字か数字）";

const PW_MIN = 8;
const PW_MAX = 128;   // IDは32で止めているのに、PWだけ無制限だった
// 使える記号は決め打ち。サーバー（api/src/auth.js の PASSWORD_SYMBOLS）と同じ並び。
// 外したのは、貼り付けや表示で化けやすいもの（引用符・バックスラッシュ・山括弧）と、
// URL・シェル・パスで意味を持つもの（/ : ; , | ^ ~ 括弧類）と空白。
const PW_SYMBOLS = "!#$%&*+-.=?@_";
const PW_SYMBOL_LIST = PW_SYMBOLS.split("").join(" ");
const PW_OK_RE = /^[A-Za-z0-9!#$%&*+.=?@_-]*$/;
const PW_COMMON = ["password", "passwd", "qwerty", "letmein", "welcome", "iloveyou",
  "monkey", "dragon", "sunshine", "princess", "football", "baseball", "admin",
  "abc123", "123456", "111111", "zekkei", "sorami", "yosoku"];
const pwFlat = (t) => t.toLowerCase().replace(/[^a-z0-9]/g, "");
function pwRun(t, len = 4) {
  let up = 1, down = 1;
  for (let i = 1; i < t.length; i++) {
    const d = t.charCodeAt(i) - t.charCodeAt(i - 1);
    up = d === 1 ? up + 1 : 1;
    down = d === -1 ? down + 1 : 1;
    if (up >= len || down >= len) return true;
  }
  return false;
}
function checkPw(pw, loginId = "") {
  if (typeof pw !== "string") return "パスワードを入れてください";
  // 使える文字の判定を先に。全角で打った人に「大文字を入れて」では直しようがない。
  // 空文字は長さ側で言うので `*`
  if (!PW_OK_RE.test(pw)) return `半角の英字・数字と、記号 ${PW_SYMBOL_LIST} だけが使えます`;
  if (pw.length < PW_MIN) return `パスワードは${PW_MIN}文字以上にしてください`;
  if (pw.length > PW_MAX) return `パスワードは${PW_MAX}文字までにしてください`;
  if (!/[A-Z]/.test(pw)) return "大文字を1つ以上入れてください";
  if (!/[a-z]/.test(pw)) return "小文字を1つ以上入れてください";
  if (!/[^A-Za-z0-9]/.test(pw)) return `記号を1つ以上入れてください（${PW_SYMBOL_LIST}）`;
  const flat = pwFlat(pw), id = pwFlat(loginId);
  if (id.length >= 3 && flat.includes(id)) return "IDと同じ文字を含めないでください";
  for (const w of PW_COMMON) if (flat.includes(w)) return `よくある言葉（${w}）を含めないでください`;
  if (/(.)\1{3,}/.test(pw)) return "同じ文字を4つ以上続けないでください";
  if (pwRun(pw.toLowerCase())) return "連番や並び順のままの4文字を含めないでください";
  return null;
}

$("signupPasskey").onclick = async () => {
  $("authErr").hidden = true;
  try {
    await registerPasskey("この端末");
    $("authSheet").close();
  } catch (e) {
    if (e.name === "NotAllowedError") return;    // 生体認証を取り消しただけ
    authFail($("authErr"), e.message);
  }
};
$("skipPasskey").onclick = () => $("authSheet").close();

$("doSignup").onclick = async () => {
  clearAuthErrs();
  const pw = $("newPw").value;
  // 打ち間違えたパスワードで登録すると、本人が入れなくなる。送る前に確かめる。
  // IDも送る前に見る。大文字で打たれていても通す（サーバーが小文字にする）
  // **理由は直す欄の下に出す。** IDの話はID欄、パスワードの話はパスワード欄。
  if (!ID_RE.test($("newId").value.trim().toLowerCase())) { authFail($("newIdErr"), ID_MSG); $("newId").focus(); return; }
  if (pw !== $("newPw2").value) { authFail($("newPwErr"), "パスワードが一致しません"); return; }
  const weak = checkPw(pw, $("newId").value);
  if (weak) { authFail($("newPwErr"), weak); return; }
  try {
    await onLoggedIn(await apiCall("POST", "/signup",
      { loginId: $("newId").value, password: pw, remember: wantsRemember() }), undefined,
      { keepOpen: !!window.PublicKeyCredential });
    // 対応していない端末では出しても押せないので、そのまま閉じる
    if (window.PublicKeyCredential) showAuthPanel("passkey");
  }
  // サーバーの断り文句も、直せる欄の下へ振り分ける。IDが埋まっている・使えないは
  // ID欄、それ以外（パスワードが弱い・回線が混んでいる）は押したボタンのそば。
  // 「IDと同じ文字を含めないでください」はパスワードの話なので、頭で見分ける。
  catch (e) { authFail($(/^(このID|IDは6)/.test(e.message) ? "newIdErr" : "newPwErr"), e.message); }
  finally { $("newPw").value = ""; $("newPw2").value = ""; }
};
$("codeLogin").onclick = async () => {
  $("authErr").hidden = true;
  // 上のID欄に入っていればそれも使う（打ち直させない）
  const who = $("codeId").value.trim();
  if (!who) { authFail($("authErr"), "IDを入れてください"); $("codeId").focus(); return; }
  if (!$("authCode").value.trim()) { authFail($("authErr"), "回復コードを入れてください"); return; }
  try {
    const res = await apiCall("POST", "/recovery/use",
      { loginId: who, code: $("authCode").value, remember: wantsRemember() });
    await onLoggedIn(res);
    // 1つ使い捨てた。残りが少なくなったら作り直すよう促す。
    if (typeof res.remaining === "number" && res.remaining <= RECOVERY_LOW) {
      alert(`回復コードを1つ使いました。残り ${res.remaining}個 です。\n`
        + "アカウント画面から発行し直しておいてください。");
    }
  } catch (e) { authFail($("authErr"), e.message); }
  finally { $("authCode").value = ""; }
};
// 画面をまたいでもIDを打ち直させない
$("authId").addEventListener("input", () => {
  for (const id of ["newId", "codeId"]) if (!$(id).value) $(id).value = $("authId").value;
});

const ACCOUNT_VIEWS = { overview: "アカウント", passkeys: "パスキー", password: "パスワード", recovery: "回復コード", history: "ログイン履歴", sessions: "ほかの端末" };
function leaveAccountCodes() {
  if ($("recoveryShown").hidden) return true;
  if (!confirm("回復コードを保存しましたか？\nこの画面を離れると、発行済みのコードは再表示できません。")) return false;
  $("recoveryShown").hidden=true;
  $("accountSheet").dataset.codesShown='false';
  $("recoveryCode").textContent='';
  shownCodes=[];
  return true;
}
function showAccountView(view, focus = false) {
  if (!Object.hasOwn(ACCOUNT_VIEWS, view)) view = 'overview';
  const panel = $("accountSheet"), previous = panel.dataset.accountView;
  if (focus && previous === 'overview') panel.dataset.overviewScroll=String(panel.querySelector('.sheet-body').scrollTop);
  if (focus && previous === 'recovery' && view !== 'recovery' && !leaveAccountCodes()) return;
  panel.dataset.accountView = view;
  for (const section of panel.querySelectorAll('[data-account-view]')) section.hidden = section.dataset.accountView !== view;
  $("accountBody").hidden = view !== 'overview';
  $("accountTitle").textContent = ACCOUNT_VIEWS[view];
  $("accountBack").setAttribute('aria-label', view === 'overview' ? '設定へ戻る' : 'アカウントへ戻る');
  if (focus) {
    $("accountErr").hidden=true;
    $("accountRefreshRetry").hidden=true;
    panel.querySelector('.sheet-body').scrollTop = view === 'overview' ? Number(panel.dataset.overviewScroll)||0 : 0;
    const target = view === 'overview' ? panel.querySelector(`[data-account-open="${previous}"]`) : $("accountTitle");
    target?.focus({preventScroll:true});
  }
}
for (const button of $("accountSheet").querySelectorAll('[data-account-open]')) button.onclick = () => {
  showAccountView(button.dataset.accountOpen, true);
  if (button.dataset.accountOpen === 'history') loadAccountHistory();
};
$("accountTitle").tabIndex = -1;

async function openAccountSheet() {
  const panel=$("accountSheet"),token=auth?.token,request=String((Number(panel.dataset.loadId)||0)+1);
  const refresh=panel.open && panel.dataset.accountReady==='true' && panel.dataset.accountOwner===auth?.loginId;
  const view=panel.open && panel.dataset.accountOwner === auth?.loginId ? panel.dataset.accountView : 'overview';
  panel.dataset.accountView=view||'overview';
  panel.dataset.accountOwner=auth?.loginId ?? '';
  panel.dataset.loadId=request;
  $("accountErr").hidden=true;
  $("accountRefreshRetry").hidden=true;
  if (!refresh) {
    panel.dataset.accountReady='false';
    $("accountBody").hidden=false;
    $("accountTitle").textContent='アカウント';
    $("accountBody").textContent='アカウント情報を確認しています…';
    $("recoveryShown").hidden=true;
    panel.dataset.codesShown='false';
  }
  if (!panel.open) showSheet(panel);
  try {
    const me = await apiCall("GET", "/me");
    if(auth?.token!==token||panel.dataset.loadId!==request)return;
    if(!me||typeof me.loginId!=='string'||!Array.isArray(me.credentials)||typeof me.hasPassword!=='boolean'||!Number.isInteger(me.recoveryCodes)||me.recoveryCodes<0||me.credentials.some(c=>!c||typeof c.id!=='string'))throw new Error('invalid account');
    $("disablePw").hidden = !me.hasPassword || !me.credentials.length;
    $("enablePwWay").hidden = me.hasPassword;
    $("accountPwRequirement").hidden = !me.hasPassword || !!me.credentials.length;
    $("deleteAccount").hidden = !!me.ownerAdmin;
    const when = (t) => (t ? new Date(t).toLocaleDateString("ja-JP") : "未使用");
    const passkeys = (me.credentials || []).length;
    $("accountBody").innerHTML =
      `<div class="account-identity">${esc(me.loginId)}${me.role === "admin" ? `<span class="tiny"> ・ 管理者</span>` : ""}</div>`
      + `<div class="tiny" style="margin:2px 0 0">${syncError ? `<span class="warn">同期できていません：${esc(syncError)}</span>`
          : pushQueue.length ? `<span class="warn">未送信の変更が ${pushQueue.length}件 あります</span>`
          : "同期できています"}${(syncError || pushQueue.length)
          ? ` <button id="retrySync" style="color:var(--accent);font-weight:700">再試行</button>` : ""}</div>`;
    // 概要では状態だけを示し、操作は各詳細へ分ける。
    $("accountPasskeyState").textContent = passkeys ? `${passkeys}台` : "未登録";
    $("accountPwState").textContent = me.hasPassword ? "有効" : "無効";
    $("accountCodesState").textContent = `${me.recoveryCodes}件`;
    $("accountPwDetail").textContent = me.hasPassword ? 'パスワードでのログインは有効です。' : 'パスワードでのログインは無効です。';
    $("accountCodesDetail").textContent = `使える回復コードは${me.recoveryCodes}件です。`;
    $("newRecovery").textContent = me.recoveryCodes ? "回復コードを再発行" : "回復コードを発行";
    $("newRecovery").setAttribute("aria-label", me.recoveryCodes ? "回復コードを再発行" : "回復コードを発行");
    // 塗るのは次にすべきこと1つだけ。パスキーが無ければ登録、あれば回復コードが無いときの発行
    $("addPasskey").classList.toggle("primary", !passkeys);
    $("newRecovery").classList.toggle("primary", !!passkeys && !me.recoveryCodes);
    $("accountPasskeys").innerHTML = me.credentials.length ? me.credentials.map((c) => `<div class="fav-row">
            <div class="list-item" style="border-top:none">${esc(c.label || "名称なし")}
              <div class="tiny">登録 ${when(c.created_at)}<br>最終利用 ${when(c.last_used_at)}</div></div>
            <button class="fav-del" data-delkey="${esc(c.id)}" aria-label="${esc(c.label || "この端末")}のパスキーを消す" style="color:var(--red)"><svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
          </div>`).join("") : `<p class="tiny account-empty">まだ登録されていません。</p>`;
    // 認証手段が1つだけだと、それを失った時点で自分のデータへ入れなくなる。
    // 起きてから言っても遅いので、そうなる前に言う。本人の画面には「薦め」も出す
    const s = nextStep({ passkeys: (me.credentials || []).length,
                         has_password: me.hasPassword, codes: me.recoveryCodes });
    $("accountAdvice").hidden = !s.message;
    $("accountAdvice").className = s.level === "suggest" ? "tiny" : "warn";
    $("accountAdvice").textContent = s.message || "";
    for (const el of $("accountPasskeys").querySelectorAll("[data-delkey]")) el.onclick = withPendingAction(panel,el,async () => {
      // 消したパスキーは戻せない。作り直しになるので確認する。
      if (!confirm("この端末のパスキーを消します。\nこの端末からは、パスワードか回復コードでしか入れなくなります。")) return;
      $("accountErr").hidden = true;
      try { adoptToken(await apiCall("POST", "/passkey/delete", { credentialId: el.dataset.delkey })); if(panel.open)openAccountSheet(); }
      catch (e) {
        accountFail(e.message);
        // 断って終わりにしない。**その場で直せる場所を開いて指を置く。**
        // 「最後の1つだから消せません」と言われても、どうすればいいか分からなければ意味がない。
        if (/最後のパスキー/.test(e.message) && !$("enablePwWay").hidden) {
          showAccountView("password");
          $("newAccPw").focus();
        }
      }
    });
    const retry = $("retrySync");
    if (retry) retry.onclick = withPendingAction(panel,retry,async () => { await syncNow(); if(panel.open)openAccountSheet(); });
    panel.dataset.accountReady='true';
    showAccountView(view);
    if(refresh)$("accountTitle").focus?.({preventScroll:true});
    if(view==='history')loadAccountHistory();
  } catch (e) {
    if(auth?.token!==token||panel.dataset.loadId!==request)return;
    if (refresh) {
      accountFail('最新のアカウント情報を確認できませんでした。表示は更新前の状態です。');
      $("accountRefreshRetry").hidden=false;
    } else {
      showAccountView('overview');
      accountFail('アカウント情報を取得できませんでした。もう一度お試しください。');
      $("accountBody").innerHTML='<button type="button" class="chip" id="accountRetry">再取得</button>';
      $("accountRetry").onclick=openAccountSheet;
    }
  }
}

$("accountRefreshRetry").onclick=openAccountSheet;

// 履歴は詳細を開いたときだけ取得し、別利用者や閉じた画面へ書き戻さない。
async function loadAccountHistory() {
  const panel=$("accountSheet"),token=auth?.token,loadId=panel.dataset.loadId;
  const request=String((Number(panel.dataset.historyRequest)||0)+1);
  panel.dataset.historyRequest=request;
  const current=()=>panel.open && auth?.token===token && panel.dataset.loadId===loadId && panel.dataset.historyRequest===request && panel.dataset.accountView==='history';
  $("accountErr").hidden=true;
  $("loginHistoryList").textContent='履歴を確認しています…';
  try {
    const { entries } = await apiCall("GET", "/me/logins");
    if (!current()) return;
    const WAY = { password: "パスワード", passkey: "パスキー", recovery: "回復コード" };
    $("loginHistoryList").innerHTML = entries.length
      ? entries.map((e) => `<div class="list-item">
          <span style="color:${e.success ? "var(--secondary)" : "var(--red)"}">
            ${e.success ? "入れた" : "失敗"}</span> ・ ${esc(WAY[e.method] ?? e.method)}
          ${e.note ? ` ・ ${esc(e.note)}` : ""}
          <div class="tiny">${new Date(e.created_at).toLocaleString("ja-JP", { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" })}${e.ip ? ` ・ ${esc(e.ip)}` : ""}</div>
        </div>`).join("")
      : `<p class="tiny">まだありません。</p>`;
  } catch (e) { if(current()){ $("loginHistoryList").textContent='履歴を取得できませんでした。'; accountFail(e.message); } }
}
$("accountHistoryRetry").onclick=loadAccountHistory;

// 鍵を作らせて、送り返せる形にするところまで。**新規登録と端末追加で同じものを使う。**
// 別々に書くと、片方だけ直して食い違う。
async function createPasskey(options) {
  const cred = await navigator.credentials.create({ publicKey: {
    ...options,
    challenge: b64uToBuf(options.challenge),
    user: { ...options.user, id: b64uToBuf(options.user.id) },
    excludeCredentials: (options.excludeCredentials || []).map((c) => ({ ...c, id: b64uToBuf(c.id) })) } });
  return { id: cred.id, rawId: bufToB64u(cred.rawId), type: cred.type,
    response: {
      clientDataJSON: bufToB64u(cred.response.clientDataJSON),
      attestationObject: bufToB64u(cred.response.attestationObject),
    },
    clientExtensionResults: cred.getClientExtensionResults() };
}

// 登録の中身は、アカウント画面からも新規登録の直後からも同じ。
// **パスワードには触らない。** 鍵が増えるだけで、入り方は減らさない。
async function registerPasskey(label) {
  const { challengeId, options } = await apiCall("POST", "/passkey/register/begin", {});
  const response = await createPasskey(options);
  await apiCall("POST", "/passkey/register/finish", { challengeId, label, response });
}

// パスワードを作らずに、パスキーだけでアカウントを作る。
// 回復コードが一緒に返る。**パスキーは端末とドメインに紐づくので、それだけだと
// 端末を失った時点で入る手段がゼロになる。** 必ず保存してもらう。
async function signupWithPasskey(loginId, remember) {
  const { challengeId, options } = await apiCall("POST", "/signup/passkey/begin", { loginId });
  const response = await createPasskey(options);
  return apiCall("POST", "/signup/passkey/finish",
    { challengeId, label: "この端末", remember, response });
}

$("addPasskey").onclick = async () => {
  $("accountErr").hidden = true;
  try {
    // 2台目以降は見分けが要るので名前を訊く
    await registerPasskey(prompt("この端末の名前（例：iPhone）", "この端末") || "この端末");
    if($("accountSheet").open)openAccountSheet();
  } catch (e) {
    if (e.name === "NotAllowedError") return;
    accountFail(e.message);
  }
};
// まとめて発行するので、表示も一覧にする。1個ずつだと使った瞬間に手持ちがゼロになる。
let shownCodes = [];
// **IDも一緒に見せて、コピーにも含める。** 回復コードで入るには ID が要るので、
// コードだけ保存していると、IDを忘れたときに手詰まりになる。
const codeBlock = (loginId, codes) =>
  `AstroNotes ${location.origin}\nID: ${loginId}\n\n${codes.join("\n")}`;
const showCodes = (codes) => {
  shownCodes = codes;
  $("recoveryCode").innerHTML = `<div style="font-weight:400;margin-bottom:6px">ID: ${esc(auth?.loginId ?? "")}</div>`
    + codes.map((c) => esc(c)).join("<br>");
  $("recoveryShown").hidden = false;
  $("accountSheet").dataset.codesShown='true';
  showAccountView("recovery");
  $("recoveryShown").focus();
};
$("copyCodes").onclick = async () => {
  try {
    await navigator.clipboard.writeText(codeBlock(auth?.loginId ?? "", shownCodes));
    $("copyCodes").textContent = "コピーしました（IDも入っています）";
  } catch { $("copyCodes").textContent = "コピーできませんでした。選んで写してください"; }
};
$("newRecovery").onclick = async () => {
  if (Number.parseInt($("accountCodesState").textContent,10)>0 && !confirm("回復コードを再発行します。\n以前の回復コードはすべて使えなくなります。続けますか？")) return;
  $("accountErr").hidden = true;
  try { showCodes((await apiCall("POST", "/recovery/issue", {})).codes); openAccountSheet2(); }
  catch (e) { accountFail(e.message); }
};
// 発行の表示を消さずに中身だけ更新する
async function openAccountSheet2() {
  const shown = !$("recoveryShown").hidden, codes = shownCodes;
  await openAccountSheet();
  if (shown) showCodes(codes);
}
// 退会したIDの端末内コピーも消す。他の利用者のデータには触れない。
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
    await apiCall("DELETE", "/me");
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
    adoptToken(await apiCall("POST", "/password/enable", { password: $("newAccPw").value }));
    $("newAccPw").value = "";
    if($("accountSheet").open)openAccountSheet();
  } catch (e) { accountFail(e.message); }
};
$("disablePw").onclick = async () => {
  if (!confirm("パスワードでのログインをやめます。\n代わりの回復コードを発行します。必ず保存してください。")) return;
  try { const r = await apiCall("POST", "/password/disable", {}); adoptToken(r); showCodes(r.codes); openAccountSheet2(); }
  catch (e) { accountFail(e.message); }
};
// **取り消しの唯一の手段。** トークンは署名だけで検証でき、サーバーに残らないので、
// 世代番号を進める以外に「あの端末を切る」方法が無い。
$("logoutAll").onclick = async () => {
  if (!confirm("ほかの端末のログインをすべて切ります。\nこの端末は入ったままです。\n\n続けますか？")) return;
  try {
    adoptToken(await apiCall("POST", "/me/logout-all"));
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
    const bundle = await apiCall("GET", "/admin/ui");
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
    try { const me = await apiCall("GET", "/me"); if (seq !== privateEntrySeq || token !== auth?.token) return; auth = { ...auth, ownerAdmin: !!me.ownerAdmin }; }
    catch { return; }
  }
  if (!auth.ownerAdmin) return;
  try {
    const module = await ownerModule();
    if (seq !== privateEntrySeq || token !== auth?.token || !$("appSettings").open) return;
    box.append(module.entry({open:()=>{$("appSettings").close();pushRoute("#/admin");}}));
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
    if (seq !== adminRenderSeq || auth?.token !== token || !atAdmin) return;
    $("adminView").replaceChildren();
    adminUnmount = module.mount($("adminView"), {nextStep,draft:privateDraft && privateDraft.loginId===auth.loginId?privateDraft.value:null,apiCall:async (...args)=>{
      if (seq !== adminRenderSeq || auth?.token !== token || !atAdmin) throw new Error("画面の確認をやり直してください");
      const result = await apiCall(...args);
      if (seq !== adminRenderSeq || auth?.token !== token || !atAdmin) throw new Error("画面の確認をやり直してください");
      return result;
    }, onReauth:askReauth});
  } catch (e) {
    if (seq !== adminRenderSeq || auth?.token !== token || !atAdmin) return;
    status.textContent = e.message; $("adminView").replaceChildren(status);
    // 読めなかったときも、その場でやり直せるようにする（2026-10-15）
    const reauth = e.code === "reauth_required";
    if (e.status !== 403) {
      const again = document.createElement("button"); again.type = "button"; again.className = "chip";
      again.textContent = reauth ? "ログインし直す" : "再試行";
      again.onclick = () => { if (seq === adminRenderSeq && auth?.token === token && atAdmin) { if (reauth) askReauth(); else renderAdmin(); } };
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
    if (atAdmin) renderAdmin();
    if (atSkyMap) SkyMapUI?.open(true);
    void recheckAccess(30 * 1000);
  }
});
window.addEventListener("pagehide", clearAdminView);
window.addEventListener("pageshow", e => { if (!e.persisted) return; if (atAdmin) renderAdmin(); void recheckAccess(30 * 1000); });

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
const RECOVERY_LOW = 3;

function nextStep(u) {
  const passkeys = u.passkeys ?? 0;
  const codes = u.codes ?? 0;
  const pw = !!u.has_password;

  if (!passkeys && !pw && !codes) {
    return { level: "danger", message: "入る手段がありません。回復コードを発行してください。" };
  }
  // 端末に依存しない手段が無い状態を、いちばん重く見る
  if (passkeys && !pw && !codes) {
    return { level: "warn",
      message: "回復コードがありません。端末を失うと入れなくなります。発行して手元に保管してください。" };
  }
  if (!passkeys && pw && !codes) {
    return { level: "warn",
      message: "パスワードだけです。忘れると戻れません。パスキーを登録してください。" };
  }
  // 回復コードだけ。**自分では作れない**（最後のパスキーは消せないし、パスワードの
  // 無効化にはパスキーが要る）。管理者が盗まれた鍵を失効させたときにだけ起こる。
  // 使い切ると終わりなので、日常の入り方を戻してもらう。
  if (!passkeys && !pw && codes) {
    return { level: "warn",
      message: `回復コードしかありません（残り${codes}）。使い切ると入れなくなります。パスキーを登録してください。` };
  }
  // ここから下は「もっと良くできる」段
  if (!passkeys) {
    return { level: "suggest",
      message: "パスキーを登録すると、次から Face ID / Touch ID だけで入れます。" };
  }
  if (pw) {
    return { level: "suggest",
      message: "パスワードを無効にすると、パスワードが漏れる経路がなくなります。回復コードは自動で発行されます。" };
  }
  // ここまで来たのはパスキーのみの人。回復コードが**端末を失ったときの唯一の戻り道**なので、
  // 残りが少なくなったら発行し直してもらう。10個渡るのはパスワードを無効にしたときで、
  // そのあと使うたびに減る。ゼロになってから言っても、そのときはもう手遅れ。
  if (codes <= RECOVERY_LOW) {
    return { level: "warn",
      message: `回復コードが残り${codes}です。端末を失ったときの唯一の戻り道なので、発行し直してください。` };
  }
  return { level: "ok", message: "" };
}

// 誰が何で入っているかを、印として出せる形にする。
// **日常の入り方（パスキー・パスワード）と、非常用（回復コード）を分ける。**
// 一列に混ぜていたので「実際に何で入るのか」が読み取れなかった。
function authWays(u) {
  const labels = [];
  // 台数は印の中に入れる。1台なら数を出さない
  if (u.passkeys) labels.push(u.passkeys > 1 ? `パスキー${u.passkeys}` : "パスキー");
  if (u.has_password) labels.push("PW");
  if (!labels.length) labels.push(u.codes ? "回復コードのみ" : "なし");

  // 締め出しの近さは数で見る。1つだと、それを失った時点で入れなくなる
  const methods = (u.has_password ? 1 : 0) + u.passkeys + (u.codes > 0 ? 1 : 0);

  // **印で言ったことを繰り返さない。** 印に出ない回復コードの数だけ残す
  const detail = `回復コード${u.codes ?? 0}`;
  return { labels, methods, detail };
}

// アカウント同期とは別に、記録とお気に入りのJSONの控えを書き出す。既存の控えも読み込める。
function downloadLibraryBackup(){
 const local=globalThis.MyPlacesUI?.backupState?.()||{observations:[],shapes:{}};
 const payload=AstroNotesLibrary.backup({favorites,sightings,...local,owner:auth?.loginId||dataOwner});
 const blob=new Blob([JSON.stringify(payload,null,1)],{type:'application/json'}),a=document.createElement('a');
 a.href=URL.createObjectURL(blob);a.download=`AstroNotes-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
$("exportBtn").onclick=downloadLibraryBackup;
$("importBtn").onclick=()=>$("importFile").click();
// 全項目を書けた場合だけ確定し、容量超過時は成功した書込を元へ戻す。
function persistImportedData(entries) { AstroNotesLibrary.transaction(localStorage,entries); }
let importRequest = 0;
$("importFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const request = ++importRequest, generation = authGeneration, owner = dataOwner;
  try {
    const data = JSON.parse(await file.text());
    if (request !== importRequest) return;
    if (generation !== authGeneration || owner !== dataOwner) throw new Error("ログイン状態が変わりました。取り込むアカウントを確認して、もう一度読み込んでください");
    if(data?.schemaVersion===2&&data.owner&&data.owner!==(auth?.loginId||dataOwner)&&!confirm('別のアカウントの控えです。現在のアカウントに読み込みますか？')){e.target.value='';return;}
    const local=globalThis.MyPlacesUI?.backupState?.()||{observations:[],shapes:{}};
    const restored=AstroNotesLibrary.restore(data,{favorites,sightings,...local,cleanFavorite,cleanSighting,cleanShape:AstroNotesShooting.cleanShape});
    const {goodRecs,goodFavs,dropped}=restored,nextSightings=restored.sightings,nextFavorites=restored.favorites;
    const nextQueue = pushQueue.slice();
    if (auth) for (const [kind, records] of [["sight", goodRecs], ["fav", goodFavs]]) {
      for (const { id } of records) {
        const at = nextQueue.findIndex(q => q.kind === kind && q.id === id), change = { kind, id };
        if (at < 0) nextQueue.push(change); else nextQueue[at] = change;
      }
    }
    const libraryKeys=AstroNotesLibrary.keys(auth?.loginId||dataOwner);
    persistImportedData([["sorami.sightings",nextSightings],["sorami.favorites",nextFavorites],["sorami.queue",nextQueue],[libraryKeys.observations,restored.observations],[libraryKeys.shapes,restored.shapes]]);
    sightings = nextSightings; favorites = nextFavorites; pushQueue = nextQueue;
    if (auth) { renderAuthButton(); void syncNow(); }
    globalThis.MyPlacesUI?.imported?.();aimFillSelects();SkyMapUI?.refreshTargets?.();
    render();   // 押下の配線と画面の出し分けごとやり直す
    // 落としたものは黙って捨てない。何件・なぜ捨てたか分からないと、
    // 「読み込んだのに入っていない」が事故に見える。
    alert(`予測の結果 ${goodRecs.length}件・撮影地点/対象 ${goodFavs.length}件・見える対象 ${restored.observationCount}件・線/範囲 ${restored.shapeCount}件を読み込みました`
      + `（合計 予測の結果 ${sightings.length}件・撮影地点/対象 ${favorites.length}件）`
      + (dropped ? `\n形式が合わない ${dropped}件は取り込みませんでした。` : ""));
  } catch (err) {
    if (request !== importRequest) return;
    alert("読み込めませんでした：" + err.message);
  }
  if (request === importRequest) e.target.value = "";
};

// ブラウザに「この保存領域を勝手に消さないでほしい」と申請する。
// **申請だけして、結果は画面に出さない。** 消えても本体はアカウントにあるので、
// 利用者にできることが無い（2026-09-28 ユーザー指摘「この説明はいらない」）。
navigator.storage?.persist?.().catch(() => {});

// 幅が閾値をまたいだら描画し直す（ウィンドウのリサイズ・画面回転）
WIDE.addEventListener("change", () => { if (bundle) render(); });

// GitHub Pages は HTML に max-age=600 を付けるため、更新しても最大10分は
// 古い index.html が使われる。JS 側にキャッシュバスターを付けていても、
// その版番号を書いている HTML 自体が古いので効かない（実際に旧画面が出た）。
//
// 読み込み後に本物の HTML を取りに行き、版が違えば一度だけ読み直す。
// 一度きりにするのは、取得に失敗し続けたときの再読み込みループを避けるため。
async function checkForUpdate() {
  const release = document.querySelector('meta[name="app-version"]')?.content;
  const running = (document.querySelector('script[src*="astronotes-core.js"]') || {}).src || "";
  const mine = release || (running.match(/[?&]v=(\d+)/) || [])[1];
  if (!mine) return;
  try {
    const html = await (await fetch(location.pathname + "?v=" + Date.now(), { cache: "no-store" })).text();
    const latest = (html.match(/name="app-version" content="(\d+)"/) || [])[1] || (html.match(/astronotes-core\.js\?v=(\d+)/) || [])[1];
    if (!latest || latest === mine) return;
    // 読み直し済みの印は「読み直した先の版」で持つ。走っている版で持つと、
    // 同じセッション中の2回目の配信を拾えなくなる（1回で打ち止めになる）
    if (sessionStorage.getItem("sorami.reloaded") === latest) return;
    sessionStorage.setItem("sorami.reloaded", latest);
    location.reload();
  } catch { /* 取れなければそのまま使う。更新確認は補助 */ }
}

// 枠の中で開かれていたら止める。**戻せない操作がある**（アカウントの削除、
// すべての端末からログアウト）。GitHub Pages はヘッダを足せず、
// frame-ancestors は meta では効かないので、ここで見るしかない。
if (window.top !== window.self) {
  document.body.innerHTML =
    '<p style="padding:24px;font:16px/1.8 system-ui">この画面は枠の中では開けません。'
    + '<br><a href="https://zekkei-yosoku.github.io/" target="_top">AstroNotesをひらく</a></p>';
  throw new Error("枠の中では開けません");
}

// 説明文の折り返し候補を、句読点の後ろだけに置く。
// CSS の word-break:keep-all と対で効く。**片方だけでは意味が無い。**
for (const el of document.querySelectorAll(".sheet .hint, .sheet .tiny")) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const texts = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n);
  for (const t of texts) {
    if (!/[。、・]/.test(t.data)) continue;
    const frag = document.createDocumentFragment();
    // 区切り文字を残したまま分ける
    for (const part of t.data.split(/([。、・])/)) {
      if (!part) continue;
      frag.append(part);
      if (/^[。、・]$/.test(part)) frag.append(document.createElement("wbr"));
    }
    t.replaceWith(frag);
  }
}

// シートを開いている間、後ろの本文を動かさない。
// **`<dialog>` は背面の「操作」は止めるが、「スクロール」は止めない。**
// 指やホイールが背面に乗ると本文が流れ、閉じたときに別の場所を見ていることになる。
//
// 開閉のたびに各所へ書き足すのではなく、dialog の open 属性を見て一括で扱う。
// 呼び出し箇所は10か所以上あり、**書き忘れが必ず出る**（管理画面で同じ失敗をした）。
// E94: calendar, image and shared link all use the same immutable plan snapshot.
function planButtons(attrs = '') {
  return `<button type="button" class="plan-trigger" aria-label="撮影計画を共有" title="共有" data-plan-action="share" ${attrs}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8v12M8.4 6.3 12 2.8l3.6 3.5M8.6 9.5H7.2A2.2 2.2 0 0 0 5 11.7v7.1A2.2 2.2 0 0 0 7.2 21h9.6a2.2 2.2 0 0 0 2.2-2.2v-7.1a2.2 2.2 0 0 0-2.2-2.2h-1.4"/></svg></button>`;
}
