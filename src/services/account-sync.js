(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesAccountSync=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
// state は呼出時に現在の値を読み書きする。写しを持つと controller 側の代入と食い違う。
// records は RecordSync 本体を移さず、呼出時に取る（未定義なら記録の同期を飛ばす）。
// The API allows 20,000 rows per account across the two storage tables.
const MAX_RECEIVE_PAGES = 50;
const RECEIVE_VERSION = 1;
const RECEIVE_PENDING = "まだ受信していない変更があります。同期を再試行してください。";
const RECEIVE_STORAGE_ERROR = "同期した変更を端末に保存できませんでした。空き容量や保存設定を確認して、同期を再試行してください。";

function create({state,session,apiCall,store,toItem,cleanFavorite,cleanSighting,records,refresh,render}){

// Preserve Array.find's first-match behavior while indexing once per POST.
function firstById(list) {
  const rows = new Map();
  for (const row of list) if (!rows.has(row.id)) rows.set(row.id, row);
  return rows;
}

/// 送れなかったものを覚えておく。次に繋がったときに送る。
function queuePush(kind, id) {
  if (!session.auth()) return;
  const at = state.pushQueue.findIndex(q => q.kind === kind && q.id === id);
  const change = { kind, id };
  if (at < 0) state.pushQueue.push(change); else state.pushQueue[at] = change;
  store.set("sorami.queue", state.pushQueue);
  render();
  syncNow().catch(() => {});
}

async function syncNow() {
  if (!session.auth()) return;
  const generation = session.generation();
  if (syncNow.flight?.generation === generation) { syncNow.flight.again = true; return syncNow.flight.promise; }
  const job = { generation, again: false, promise: null };
  syncNow.flight = job;
  const current = () => generation === session.generation() && !!session.auth();
  job.promise = (async () => {
    try {
      let sent = 0;
      do {
        job.again = false;
        if (records()) records().scan();
        // 同じアカウントの通信は直列化し、500件を超える取込も続けて送る。
        while (state.pushQueue.length && sent++ < 40) {
          const batch = state.pushQueue.slice(0, 500);
          const favoriteById = firstById(state.favorites);
          const sightingById = firstById(state.sightings);
          const favs = batch.filter(q => q.kind === "fav")
            .map(q => { const f = favoriteById.get(q.id); return f ? toItem(f) : toItem({ id: q.id }, true); });
          const sights = batch.filter(q => q.kind === "sight")
            .map(q => { const x = sightingById.get(q.id); return x ? toItem(x) : toItem({ id: q.id }, true); });
          const recs = records() ? records().items(batch.filter(q => q.kind === "rec").map(q => q.id)) : [];
          const res = await apiCall("POST", "/sync", { favorites: favs, sightings: sights,
            ...(recs.length ? { records: recs.map(({ sent, ...r }) => r) } : {}) });
          if (!current()) return;
          const okFav = new Set(res?.accepted?.favorites ?? []), okSight = new Set(res?.accepted?.sightings ?? []), okRec = new Set(res?.accepted?.records ?? []);
          const accepted = q => (q.kind === "fav" ? okFav : q.kind === "rec" ? okRec : okSight).has(q.id);
          if (recs.length) records().accepted(recs.filter(r => okRec.has(r.id)));
          // IDが同じでも送信中に編集された項目は別のオブジェクト。新しい変更は消さない。
          const sentItems = new Set(batch);
          state.pushQueue = state.pushQueue.filter(q => !sentItems.has(q) || !accepted(q));
          store.set("sorami.queue", state.pushQueue);
          if (!batch.some(accepted)) break;
        }
        const loginId = session.auth().loginId;
        const saved = state.syncInfo;
        // Replay cursors saved before local write failures could interrupt receipt.
        const canResume = saved?.loginId === loginId && saved.records === 1 && saved.receiveVersion === RECEIVE_VERSION;
        let since = canResume ? saved.rev || 0 : 0;
        for (let round = 0; round < MAX_RECEIVE_PAGES; round++) {
          const got = await apiCall("GET", `/sync?since=${since}`);
          if (!current()) return;
          const next = got.rev ?? since;
          if (got.more && next <= since) throw new Error(RECEIVE_PENDING);
          applyIncoming(got);
          const received = { loginId, rev: next, records: 1, receiveVersion: RECEIVE_VERSION };
          if (!store.set("sorami.sync", received)) throw new Error(RECEIVE_STORAGE_ERROR);
          state.syncInfo = received;
          if (!got.more) break;
          if (round + 1 === MAX_RECEIVE_PAGES) throw new Error(RECEIVE_PENDING);
          since = next;
        }
        state.syncError = state.pushQueue.length ? `未送信の変更が${state.pushQueue.length}件あります。同期を再試行してください` : null;
        if (state.pushQueue.length && sent >= 40) break;
      } while (job.again && current());
    } catch (e) {
      if (!current()) return;
      state.syncError = e.message;
    }
    if (current()) render();
  })();
  try { return await job.promise; }
  finally { if (syncNow.flight === job) syncNow.flight = null; }
}

/// サーバーから来たものをローカルへ入れる。**サーバー側も外部データとして検査する。**
/// 通信相手を信用しないのは、取り込みファイルを信用しないのと同じ理由。
function applyIncoming(got) {
  const put = (list, incoming, clean, kind) => {
    const pending = new Set(state.pushQueue.filter(q => q.kind === kind).map(q => q.id));
    const byId = new Map(list.map((x) => [x.id, x]));
    for (const row of incoming || []) {
      if (pending.has(row.id)) continue;
      if (row.deleted) { byId.delete(row.id); continue; }
      let body; try { body = JSON.parse(row.body); } catch { continue; }
      const cleaned = clean({ ...body, id: row.id });
      if (cleaned) byId.set(row.id, cleaned);
    }
    return [...byId.values()];
  };
  const receivedFavorites = put(state.favorites, got.favorites, cleanFavorite, "fav");
  const receivedSightings = put(state.sightings, got.sightings, cleanSighting, "sight");
  if (records()) records().apply(got.records);
  saveReceivedList("favorites", receivedFavorites);
  saveReceivedList("sightings", receivedSightings);
  refresh();
}

function saveReceivedList(name, value) {
  const previous = state[name];
  // Publish the list for the synchronous storage write hook.
  state[name] = value;
  if (!store.set("sorami." + name, value)) {
    state[name] = previous;
    throw new Error(RECEIVE_STORAGE_ERROR);
  }
}

return {queuePush,syncNow,applyIncoming};
}
return {create};
});
