/* NOTEBOOK の予定（2026-10-20 ユーザー「超未来のこーゆー予定を保存しておくページが欲しい。カレンダー反映で自分のカレンダーには追加できるけど、AstroNotesで気軽にみたい」）。
   構図で見つけた重なり（対象・天体・撮影地点・日時・画角）を、共有シートの「カレンダー」から保存して並べる。
   値の形は履歴の「重ねる条件」と同じ（SoramiPlan で検証）。このブラウザだけに保存し、同期はしない。 */
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
  const list = () => { const s = read(key(), null); return (Array.isArray(s) ? s : []).map(clean).filter(Boolean).sort((a, b) => a.start - b.start); };
  const same = (a, b) => JSON.stringify([a.t, a.o, a.body, a.part, a.limb, a.matchMode || 'limb', a.at]) === JSON.stringify([b.t, b.o, b.body, b.part, b.limb, b.matchMode || 'limb', b.at]);
  function add({ value, title, start, end }) {
    value = validate(value);
    if (!value || !Number.isFinite(start)) return { ok: false };
    const rows = list(), old = rows.find((r) => same(r.value, value));
    const row = { id: old ? old.id : 's' + now().toString(36) + Math.random().toString(36).slice(2, 6), value, title: String(title || '').slice(0, 200),
      start, end: Number.isFinite(end) && end >= start ? end : start, savedAt: now() };
    const next = [...rows.filter((r) => r !== old), row].sort((a, b) => a.start - b.start).slice(-limit);
    return { ok: !!write(key(), next), updated: !!old, row };
  }
  const remove = (id) => !!write(key(), list().filter((r) => r.id !== id));
  return { add, remove, list };
}
const api = { create, KEY };
g.SoramiSchedule = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
