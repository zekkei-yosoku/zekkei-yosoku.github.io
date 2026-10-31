import {$,esc} from '../../app/presentation-helpers.js';
import {accountFail,apiTransport,auth} from './session-and-access.js';
import {openAccountSheet,showAccountView} from './account-actions.js';
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
  try { showCodes((await apiTransport("POST", "/recovery/issue", {})).codes); openAccountSheet2(); }
  catch (e) { accountFail(e.message); }
};
// 発行の表示を消さずに中身だけ更新する
async function openAccountSheet2() {
  const shown = !$("recoveryShown").hidden, codes = shownCodes;
  await openAccountSheet();
  if (shown) showCodes(codes);
}
// 退会したIDの端末内コピーも消す。他の利用者のデータには触れない。
export {openAccountSheet2,showCodes,shownCodes};
