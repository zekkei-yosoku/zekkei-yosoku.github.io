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
