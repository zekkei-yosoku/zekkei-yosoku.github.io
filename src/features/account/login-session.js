/// ログインできたときの共通処理。初回は端末に残っているものを全部上げる。
async function onLoggedIn(res, remember = wantsRemember(), { keepOpen = false } = {}) {
  loginSettling = true;
  try {
  const sameOwnerDraft = auth?.loginId === res.loginId ? (adminUnmount?.snapshot?.() || privateDraft?.value) : null;
  accessState.generation++; clearAdminView();
  if (sameOwnerDraft) privateDraft = {loginId:res.loginId,value:sameOwnerDraft};
  auth = { token: res.token, loginId: res.loginId, role: res.role, tools: res.tools };
  accessCheckedAt = Array.isArray(res.tools) ? Date.now() : 0;
  const generation = accessState.generation;
  lastLoginId = auth.loginId;
  authStorage.save(auth, remember);
  // **使えるメニューはサーバーが決める。** ログインの返りに入っていなければ聞きに行く
  if (!Array.isArray(auth.tools)) {
    try {
      const me = await apiTransport("GET", "/me");
      // /me と同じ項目を持つ。ownerAdmin が欠けると、次の確かめ直しで「変わった」と読んで管理画面を組み直す
      auth = { ...auth, tools: Array.isArray(me.tools) ? me.tools : [], role: me.role ?? auth.role, ownerAdmin: !!me.ownerAdmin };
      accessCheckedAt = Date.now();
      authStorage.save(auth, remember);
    } catch { /* 取れなければ許可なしで出す */ }
  }
  if (generation !== accessState.generation || auth?.loginId !== res.loginId) return;
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
  await accountSync().syncNow();
  if (generation !== accessState.generation || auth?.loginId !== res.loginId) return;
  renderAuthButton();
  if (viewState.aim) openAim(routeFromHash()?.preset || null);
  render();
  // 件数のアラートは出さない。**取り込んだ結果はそのまま画面に出る**ので、
  // 同じことを数字で言い直すだけの割り込みになる。
  // 同期の状態（できている／未送信がある／失敗している）はアカウント画面に常時出す。
  } finally { loginSettling = false; finishRatingLogin(); }
}

// 写真の評価（sky-rating.html）からログインに来たときは、ログインを終えたら評価へ戻す（2026-10-28）。
// 同期を待ち、回復コードやパスキーの案内を開いている間は閉じるまで待つ。ログインせずに閉じたら戻らない。
