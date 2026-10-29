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

