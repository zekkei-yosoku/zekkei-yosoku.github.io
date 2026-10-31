import {$} from '../../app/presentation-helpers.js';
import {SkyMapUI,cleanFavorite,cleanSighting,favorites,sightings} from '../../app/browser-state.js';
import {render} from '../forecast/view.js';
import {aimFillSelects} from '../framing/controller.js';
import {accessState,auth,dataOwner,pushQueue} from './session-and-access.js';
import {renderAuthButton} from './status.js';
import {accountSync} from './sync-bridge.js';
function downloadLibraryBackup(){
 const local=globalThis.MyPlacesUI?.backupState?.()||{observations:[],shapes:{}};
 const payload=AstroNotesLibrary.backup({favorites,sightings,...local,owner:auth?.loginId||dataOwner});
 const blob=new Blob([JSON.stringify(payload,null,1)],{type:'application/json'}),a=document.createElement('a');
 a.href=URL.createObjectURL(blob);a.download=`AstroNotes-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
$("exportBtn").onclick=downloadLibraryBackup;
$("importBtn").onclick=()=>$("importFile").click();
// 全項目を書けた場合だけ確定し、容量超過時は成功した書込を元へ戻す。
function persistImportedData(entries) { AstroNotesLibrary.transaction(localStorage,entries); }
let importRequest = 0;
$("importFile").onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const request = ++importRequest, generation = accessState.generation, owner = dataOwner;
  try {
    const data = JSON.parse(await file.text());
    if (request !== importRequest) return;
    if (generation !== accessState.generation || owner !== dataOwner) throw new Error("ログイン状態が変わりました。取り込むアカウントを確認して、もう一度読み込んでください");
    if(data?.schemaVersion===2&&data.owner&&data.owner!==(auth?.loginId||dataOwner)&&!confirm('別のアカウントの控えです。現在のアカウントに読み込みますか？')){e.target.value='';return;}
    const local=globalThis.MyPlacesUI?.backupState?.()||{observations:[],shapes:{}};
    const restored=AstroNotesLibrary.restore(data,{favorites,sightings,...local,cleanFavorite,cleanSighting,cleanShape:AstroNotesShooting.cleanShape});
    const {goodRecs,goodFavs,dropped}=restored,nextSightings=restored.sightings,nextFavorites=restored.favorites;
    const nextQueue = pushQueue.slice();
    if (auth) for (const [kind, records] of [["sight", goodRecs], ["fav", goodFavs]]) {
      for (const { id } of records) {
        const at = nextQueue.findIndex(q => q.kind === kind && q.id === id), change = { kind, id };
        if (at < 0) nextQueue.push(change); else nextQueue[at] = change;
      }
    }
    const libraryKeys=AstroNotesLibrary.keys(auth?.loginId||dataOwner);
    persistImportedData([["sorami.sightings",nextSightings],["sorami.favorites",nextFavorites],["sorami.queue",nextQueue],[libraryKeys.observations,restored.observations],[libraryKeys.shapes,restored.shapes]]);
    sightings = nextSightings; favorites = nextFavorites; pushQueue = nextQueue;
    if (auth) { renderAuthButton(); void accountSync().syncNow(); }
    globalThis.MyPlacesUI?.imported?.();aimFillSelects();SkyMapUI?.refreshTargets?.();
    render();   // 押下の配線と画面の出し分けごとやり直す
    // 落としたものは黙って捨てない。何件・なぜ捨てたか分からないと、
    // 「読み込んだのに入っていない」が事故に見える。
    alert(`予測の結果 ${goodRecs.length}件・撮影地点/対象 ${goodFavs.length}件・見える対象 ${restored.observationCount}件・線/範囲 ${restored.shapeCount}件を読み込みました`
      + `（合計 予測の結果 ${sightings.length}件・撮影地点/対象 ${favorites.length}件）`
      + (dropped ? `\n形式が合わない ${dropped}件は取り込みませんでした。` : ""));
  } catch (err) {
    if (request !== importRequest) return;
    alert("読み込めませんでした：" + err.message);
  }
  if (request === importRequest) e.target.value = "";
};

// ブラウザに「この保存領域を勝手に消さないでほしい」と申請する。
// **申請だけして、結果は画面に出さない。** 消えても本体はアカウントにあるので、
// 利用者にできることが無い（2026-09-28 ユーザー指摘「この説明はいらない」）。
navigator.storage?.persist?.().catch(() => {});

