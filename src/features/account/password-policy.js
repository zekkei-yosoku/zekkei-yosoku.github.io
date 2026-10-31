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
    await onLoggedIn(await apiTransport("POST", "/signup",
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
    const res = await apiTransport("POST", "/recovery/use",
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

