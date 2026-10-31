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
export {RECOVERY_LOW,nextStep};
