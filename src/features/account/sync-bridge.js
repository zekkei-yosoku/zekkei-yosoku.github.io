import {cleanFavorite,cleanSighting,favorites,sightings,store} from '../../app/browser-state.js';
import {accessState,apiTransport,auth,pushQueue,syncError,syncInfo} from './session-and-access.js';
import {renderAuthButton,toItem} from './status.js';
import {RecordSync} from '../../services/record-sync.js';
// 記録の保存（記録・予定の画面のどちらで書いても）を拾って送る
store.setWriteHook(key=>RecordSync.touched(key));

// 送信待ち・同期・受信は src/services/account-sync.js。状態は写さず、毎回ここの変数を読み書きする。
// 関数宣言の巻き上げを保つため、初回呼出しで1つだけ作る（作るだけでは保存・通信・描画をしない）。
function accountSync() {
  return accountSync.instance ??= AstroNotesAccountSync.create({
    state: {
      get pushQueue() { return pushQueue; }, set pushQueue(v) { pushQueue = v; },
      get syncInfo() { return syncInfo; }, set syncInfo(v) { syncInfo = v; },
      get syncError() { return syncError; }, set syncError(v) { syncError = v; },
      get favorites() { return favorites; }, set favorites(v) { favorites = v; },
      get sightings() { return sightings; }, set sightings(v) { sightings = v; },
    },
    session: { auth: () => auth, generation: () => accessState.generation },
    apiCall: (...args) => apiTransport(...args),
    store,
    toItem, cleanFavorite, cleanSighting,
    records: () => typeof RecordSync !== "undefined" ? RecordSync : undefined,
    refresh: () => globalThis.AstroTargetPicker?.refresh?.(),
    render: () => renderAuthButton(),
  });
}

/// 送れなかったものを覚えておく。次に繋がったときに送る。
/// サーバーから来たものをローカルへ入れる。**サーバー側も外部データとして検査する。**

export {accountSync};
