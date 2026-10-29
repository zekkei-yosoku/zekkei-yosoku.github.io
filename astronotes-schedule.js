/* NOTEBOOK の予定（2026-10-20 ユーザー「超未来のこーゆー予定を保存しておくページが欲しい。カレンダー反映で自分のカレンダーには追加できるけど、AstroNotesで気軽にみたい」）。
   構図で見つけた重なり（対象・天体・撮影地点・日時・画角）を、共有シートの「カレンダー」から保存して並べる。
   値の形は履歴の「重ねる条件」と同じ（AstroNotesPlan で検証）。ログインID別にこのブラウザへ保存し、ログイン中はサーバーと同期する（2026-10-21〜。index.html の RecordSync）。 */
(function (g) {
'use strict';
const KEY = 'sorami.schedule.v1:';
function create({ read, write, validate, scope = () => 'guest', now = Date.now, limit = 200 }) {
  const key = () => KEY + encodeURIComponent(scope());
  const clean = (r) => {
    if (!r || typeof r.id !== 'string' || r.id.length > 40 || !Number.isFinite(r.start) || !Number.isFinite(r.savedAt)) return null;
    const value = validate(r.value); if (!value) return null;
    const title = typeof r.title === 'string' && r.title.length <= 200 ? r.title : '';
    return { id: r.id, value, title, start: r.start, end: Number.isFinite(r.end) && r.end >= r.start ? r.end : r.start, savedAt: r.savedAt };
  };
  const stored = () => { const s = read(key(), null); return Array.isArray(s) ? s : []; };
  const list = () => stored().map(clean).filter(Boolean).sort((a, b) => a.start - b.start);
  const completeKey=v=>JSON.stringify([v.at,v.o?.slice(1),v.t&&[v.t.id,v.t.latitude,v.t.longitude,v.t.groundM??0,v.t.widthM??null,v.t.parts?.map(p=>[p.id,p.m,p.latitude??null,p.longitude??null])],v.body,v.part,v.limb,v.matchMode||'limb',v.air,v.l&&[v.l.on,v.l.mode,v.l.focal,v.l.sensor,v.l.portrait,v.l.grid],v.pan,v.timelapse&&[v.timelapse.interval,v.timelapse.count,v.timelapse.fps]||null]);
  const sameComplete=(a,b)=>completeKey(a)===completeKey(b);
  function add({ value, title, start, end, preserveExisting=false }) {
    value = validate(value);
    if (!value || !Number.isFinite(start)) return { ok: false };
    const raw = stored(), rows = list(), old = rows.find((r) => sameComplete(r.value, value));
    if(old&&preserveExisting)return {ok:true,already:true,row:old};
    if (!old && raw.length >= limit) return { ok: false, error: `予定は${limit}件まで保存できます。不要な予定を整理してから追加してください。` };
    const row = { id: old ? old.id : 's' + now().toString(36) + Math.random().toString(36).slice(2, 6), value, title: String(title || '').slice(0, 200),
      start, end: Number.isFinite(end) && end >= start ? end : start, savedAt: now() };
    const next = [...raw.filter((r) => !old || r?.id !== old.id), row];
    return { ok: !!write(key(), next), updated: !!old, row };
  }
  const remove = (id) => !!write(key(), stored().filter((r) => r?.id !== id));
  const find=value=>{const v=validate(value);return v?list().find(r=>sameComplete(r.value,v))||null:null;};
  return { add, remove, list, find };
}
const api = { create, KEY };
g.AstroNotesSchedule = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);

/* Legacy global names remain aliases for cached integrations. */
if(typeof AstroNotesPlan!=='undefined')globalThis.SoramiPlan=AstroNotesPlan;if(typeof AstroNotesSchedule!=='undefined')globalThis.SoramiSchedule=AstroNotesSchedule;
