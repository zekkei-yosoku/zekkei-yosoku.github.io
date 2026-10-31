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
    const me = await apiTransport("GET", "/me");
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
      try { adoptToken(await apiTransport("POST", "/passkey/delete", { credentialId: el.dataset.delkey })); if(panel.open)openAccountSheet(); }
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
    if (retry) retry.onclick = withPendingAction(panel,retry,async () => { await accountSync().syncNow(); if(panel.open)openAccountSheet(); });
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
    const { entries } = await apiTransport("GET", "/me/logins");
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
  const { challengeId, options } = await apiTransport("POST", "/passkey/register/begin", {});
  const response = await createPasskey(options);
  await apiTransport("POST", "/passkey/register/finish", { challengeId, label, response });
}

// パスワードを作らずに、パスキーだけでアカウントを作る。
// 回復コードが一緒に返る。**パスキーは端末とドメインに紐づくので、それだけだと
// 端末を失った時点で入る手段がゼロになる。** 必ず保存してもらう。
async function signupWithPasskey(loginId, remember) {
  const { challengeId, options } = await apiTransport("POST", "/signup/passkey/begin", { loginId });
  const response = await createPasskey(options);
  return apiTransport("POST", "/signup/passkey/finish",
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
