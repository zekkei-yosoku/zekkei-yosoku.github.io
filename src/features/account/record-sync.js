import {store} from '../../app/browser-state.js';
import {auth,pushQueue,syncInfo} from './session-and-access.js';
import {toItem} from './status.js';
import {accountSync} from './sync-bridge.js';
const RecordSync = (() => {
  const SNAP = "sorami.recordSync.v1:", PREFIX = "rec:";
  const kinds = {
    obs: { key: (id) => AstroNotesLibrary.keys(id).observations, empty: [],
      items: (v) => Array.isArray(v) ? v.filter((r) => r && typeof r.id === "string").map((r) => [r.id, r]) : [],
      build: (m) => [...m.values()], clean: (v) => AstroNotesLibrary.cleanObservation(v) },
    shape: { key: (id) => AstroNotesLibrary.keys(id).shapes, empty: {},
      items: (v) => v && typeof v === "object" && !Array.isArray(v) ? Object.entries(v) : [],
      build: (m) => Object.fromEntries(m),
      clean: (v) => v && Number.isFinite(v.latitude) && Number.isFinite(v.longitude) && AstroNotesShooting.cleanShape(v.shape) ? { latitude: v.latitude, longitude: v.longitude, shape: AstroNotesShooting.cleanShape(v.shape) } : null },
    plan: { key: (id) => "sorami.schedule.v1:" + encodeURIComponent(id), empty: [],
      items: (v) => Array.isArray(v) ? v.filter((r) => r && typeof r.id === "string").map((r) => [r.id, r]) : [],
      build: (m) => [...m.values()].sort((a, b) => a.start - b.start),
      clean: (v) => v && typeof v.id === "string" && v.id.length <= 40 && Number.isFinite(v.start) && Number.isFinite(v.savedAt) ? v : null },
  };
  const login = () => typeof AstroNotesLibrary !== "undefined" && auth?.loginId || null;
  const hash = (v) => { const t = JSON.stringify(v); let h = 2166136261; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619); return (h >>> 0).toString(36) + t.length.toString(36); };
  const snap = (id) => { const v = store.get(SNAP + encodeURIComponent(id), null); return v && typeof v === "object" ? { obs: v.obs || {}, shape: v.shape || {}, plan: v.plan || {}, receiving: v.receiving || {} } : { obs: {}, shape: {}, plan: {}, receiving: {} }; };
  const saveSnap = (id, v) => { try { localStorage.setItem(SNAP + encodeURIComponent(id), JSON.stringify(v)); } catch { throw new Error("記録を端末に保存できませんでした。空き容量や保存設定を確認して、同期を再試行してください。"); } };
  // Journal hashes before incoming writes so an interrupted receipt is never uploaded as a local edit.
  function recover(id, s) {
    let retry = false;
    for (const [kind, entries] of Object.entries(s.receiving)) {
      if (!kinds[kind] || !entries || typeof entries !== "object") continue;
      const current = local(id, kind);
      for (const [k, expected] of Object.entries(entries)) {
        const value = current.get(k), actual = value === undefined ? null : hash(value);
        if (actual === expected) { if (expected === null) delete s[kind][k]; else s[kind][k] = expected; }
        else retry = true;
      }
    }
    if (Object.keys(s.receiving).length) {
      s.receiving = {}; saveSnap(id, s);
      if (retry && syncInfo?.loginId === id) { syncInfo = { ...syncInfo, records: 0 }; store.set("sorami.sync", syncInfo); }
    }
    return retry;
  }
  const local = (id, kind) => new Map(kinds[kind].items(store.get(kinds[kind].key(id), kinds[kind].empty)));
  const split = (recId) => { const m = /^rec:(obs|shape|plan):(.+)$/.exec(recId); return m ? [m[1], m[2]] : [null, null]; };
  let timer = null, writing = false;
  // 記録を書いたら少し待ってまとめて送る
  function touched(key) {
    const id = login();
    if (writing || !id || !Object.values(kinds).some((k) => k.key(id) === key)) return;
    clearTimeout(timer); timer = setTimeout(() => { accountSync().syncNow().catch(() => {}); }, 800);
  }
  // 前回の同期と違うものを送信待ちに入れる。消えたものは削除として送る
  function scan() {
    const id = login(); if (!id) return 0;
    const s = snap(id); recover(id, s);
    const lists = Object.fromEntries(Object.keys(kinds).map(kind => [kind, local(id, kind)]));
    if (Object.keys(kinds).some(kind => lists[kind].size || Object.keys(s[kind]).length)) saveSnap(id, s);
    const changes = [];
    for (const kind of Object.keys(kinds)) {
      const now = lists[kind], before = s[kind];
      // 保存そのものが消えたとき（サイトのデータの削除など）に、サーバーの記録まで消さない。取り直す（自分で全部消したときは空の保存が残る）
      if (!now.size && Object.keys(before).length && store.get(kinds[kind].key(id), undefined) === undefined) { s[kind] = {}; saveSnap(id, s); if (syncInfo?.loginId === id) { syncInfo = { ...syncInfo, records: 0 }; store.set("sorami.sync", syncInfo); } continue; }
      for (const [k, v] of now) if (before[k] !== hash(v)) changes.push(PREFIX + kind + ":" + k);
      for (const k of Object.keys(before)) if (!now.has(k)) changes.push(PREFIX + kind + ":" + k);
    }
    enqueueAll(changes);
    return changes.length;
  }
  function enqueueAll(ids) {
    if (!ids.length) return;
    const positions = new Map();
    pushQueue.forEach((q, i) => { if (q.kind === "rec" && !positions.has(q.id)) positions.set(q.id, i); });
    for (const recId of ids) {
      const change = { kind: "rec", id: recId };
      if (positions.has(recId)) pushQueue[positions.get(recId)] = change;
      else { positions.set(recId, pushQueue.length); pushQueue.push(change); }
    }
    store.set("sorami.queue", pushQueue);
  }
  // 送る中身（無ければ削除）
  function item(recId) {
    return items([recId])[0];
  }
  // Snapshots live only for this synchronous batch. The next batch/ack must
  // reread storage so an edit made during POST remains queued.
  function items(ids) {
    const id = login(), lists = {};
    return ids.map(recId => {
      const [kind, k] = split(recId);
      const v = id && kind ? (lists[kind] ||= local(id, kind)).get(k) : undefined;
      return v === undefined ? { ...toItem({ id: recId }, true), sent: null } : { id: recId, body: { kind, value: v }, updated_at: Date.now(), deleted: false, sent: hash(v) };
    });
  }
  // 受理されたら、送った中身を「一致」として覚える
  function accepted(sent) {
    const id = login(); if (!id) return;
    const s = snap(id), current = items(sent.map(it => it.id)), changed = [];
    for (let i = 0; i < sent.length; i++) {
      const it = sent[i];
      const [kind, k] = split(it.id); if (!kind) continue;
      if (it.sent === null) delete s[kind][k]; else s[kind][k] = it.sent;
      if (current[i].sent !== it.sent) changed.push(it.id);
    }
    enqueueAll(changed);
    saveSnap(id, s);
  }
  // サーバーから届いた記録を、この端末の保存へ反映する（送信待ちのものは端末を優先）
  function apply(rows) {
    const id = login(); if (!id || !Array.isArray(rows) || !rows.length) return;
    const pending = new Set(pushQueue.filter((q) => q.kind === "rec").map((q) => q.id)), s = snap(id), originals = {}, maps = {}, dirty = new Set(), receipts = {}, changed = [];
    if (recover(id, s)) throw new Error("記録の受信を再開しています。同期を再試行してください。");
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || pending.has(row.id)) continue;
      const [kind, k] = split(row.id); if (!kind) continue;
      // Compare to the local snapshot, not earlier rows in the same receipt.
      // Duplicate IDs must still let a later tombstone replace an earlier row.
      if (!maps[kind]) { originals[kind] = local(id, kind); maps[kind] = new Map(originals[kind]); }
      const existing = originals[kind].get(k), actual = existing === undefined ? undefined : hash(existing);
      if (actual !== s[kind][k]) { changed.push(row.id); continue; }
      receipts[kind] ||= {};
      if (row.deleted) { if (maps[kind].delete(k)) dirty.add(kind); receipts[kind][k] = null; continue; }
      let body; try { body = JSON.parse(row.body); } catch { continue; }
      const v = body?.kind === kind ? kinds[kind].clean(body.value) : null;
      if (!v || (kind !== "shape" && v.id !== k)) continue;
      maps[kind].set(k, v); receipts[kind][k] = hash(v); dirty.add(kind);
    }
    enqueueAll(changed);
    if (!Object.keys(receipts).length) return;
    s.receiving = receipts; saveSnap(id, s);
    writing = true;
    try {
      for (const kind of dirty) if (!store.set(kinds[kind].key(id), kinds[kind].build(maps[kind])))
        throw new Error("記録を端末に保存できませんでした。空き容量や保存設定を確認して、同期を再試行してください。");
    } finally { writing = false; }
    for (const [kind, entries] of Object.entries(receipts)) for (const [k, expected] of Object.entries(entries)) {
      if (expected === null) delete s[kind][k]; else s[kind][k] = expected;
    }
    s.receiving = {}; saveSnap(id, s);
    if (dirty.size) window.dispatchEvent(new CustomEvent("sorami:records-synced"));
  }
  return { touched, scan, item, items, accepted, apply, kick: () => { if (login()) touched(kinds.obs.key(login())); } };
})();
export {RecordSync};
