import {$} from '../../app/presentation-helpers.js';
import {SkyMapUI,viewState} from '../../app/browser-state.js';
import {favDraft} from '../places/controller.js';
import {auth,pushQueue,refreshRestrictedTools,renderTools,syncError} from './session-and-access.js';
import {redrawIfToolsChanged} from '../../ui/gestures.js';
import {adminRenderAuth,renderAdmin} from './admin-view.js';
import {recentHistory} from '../framing/presentation.js';
function renderAuthButton() {
  globalThis.AstroNotesPlanUI?.refreshPermissions();
  try { recentHistory.accountChanged(); } catch { /* History is optional during startup. */ }
  if (viewState.admin && auth !== adminRenderAuth) renderAdmin();
  renderTools();
  SkyMapUI?.authChanged();
  window.AstroTargetPicker?.authChanged();
  if(favDraft&&favDraft.ownerToken!==auth?.token){$("favDuplicateTargets")?.remove();if($("favSheet").open)$("favSheet").close();}
  redrawIfToolsChanged();
  refreshRestrictedTools();
  const b = $("authButton");
  if (!auth) { b.textContent = "ログイン"; b.classList.remove("warn"); b.setAttribute("aria-label", "ログイン"); return; }
  const failing = !!syncError || pushQueue.length > 0;
  b.textContent = failing ? `⚠ ${auth.loginId}` : auth.loginId;
  b.classList.toggle("warn", failing);
  b.setAttribute("aria-label", failing ? "同期できていません。設定を開く" : "設定を開く");
}

/// ローカルの1件をサーバーへ送る形にする。body に中身を丸ごと入れる。
const toItem = (o, deleted = false) => ({ id: o.id, body: o, updated_at: Date.now(), deleted });

// 記録（見えたもの・線や範囲・予定）の同期（2026-10-21 ユーザー「記録の見えたもの・線や範囲・予定もサーバー同期してアカウントに紐づけて」）。
// それまではログインID別にこの端末だけへ保存していた。保存の形（キー・中身）は変えず、前回の同期で一致していた中身の要約（snapshot）と
// 今の中身を比べて、違うものだけを送る（書く場所を1つずつ直さない。記録・予定・取り込みのどこで書いても送れる）。
// サーバーでは favorites 表に id "rec:<種類>:<id>" で置き、GET /sync の records 欄で受け取る。
// 初めてこの仕組みで同期するアカウントは、記録を最初から取り直す（旧画面が先に進めた rev より前の記録を取りこぼさない）。
export {renderAuthButton,toItem};
