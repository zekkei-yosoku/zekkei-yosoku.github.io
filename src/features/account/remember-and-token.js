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
  authStorage.save(auth, !!localStorageHasToken());
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
