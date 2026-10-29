// 探すの日付カレンダー: renderMonth port で重なる日の描画を使い、他の共通カレンダーは従来どおり。
// 依存なし（node:vm と最小の偽DOM）。実ブラウザの表示は別途確認する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const require = createRequire(import.meta.url), S = require('./astronotes-core.js');
const uiSrc = readFileSync(new URL('./astronotes-datetime-ui.js', import.meta.url), 'utf8');
const mapSrc = readFileSync(new URL('./src/features/explore/map-presentation.js', import.meta.url), 'utf8');
const obsSrc = readFileSync(new URL('./src/features/framing/observer.js', import.meta.url), 'utf8');
const slice = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a); assert.ok(a >= 0 && b > a, `slice ${from}`); return src.slice(a, b); };
const observerCode = slice(obsSrc, 'function aimObserverEye(', 'aim.from = aimSavedFrom') + slice(obsSrc, 'const aimCal = {', 'function aimCalDraw(');
const mapCode = slice(mapSrc, ' const calendarCache=new Map();', '\n const skyCalendar=');

const DAY = 86400000, OFF = 32400000, H = 3600000;
const NOW = Date.UTC(2026, 9, 30, 3);
const dayOf = (y, m, d) => Date.UTC(y, m, d) - OFF;
const flush = async (n = 6) => { for (let i = 0; i < n; i++) await new Promise(r => setTimeout(r, 0)); };

// ---- 最小の偽DOM（innerHTML の解析・属性/子孫セレクタ・イベントの捕捉/バブル・dialog・canvas）
const VOID = new Set(['input', 'br', 'img', 'meta', 'hr', 'link']);
const decode = s => s.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const kebab = k => k.replace(/[A-Z]/g, c => '-' + c.toLowerCase());
class FakeEvent { constructor(type, init = {}) { this.type = type; this.bubbles = !!init.bubbles; this.defaultPrevented = false; } preventDefault() { this.defaultPrevented = true; } stopPropagation() { this._stop = true; } stopImmediatePropagation() { this._stop = this._stopImmediate = true; } }
class FakeNode { remove() { const p = this.parentNode; if (!p) return; p.childNodes.splice(p.childNodes.indexOf(this), 1); this.parentNode = null; } }
class FakeText extends FakeNode { constructor(data) { super(); this.nodeType = 3; this.data = data; this.parentNode = null; } get textContent() { return this.data; } }
function* walk(el) { for (const c of el.childNodes) if (c.nodeType === 1) { yield c; yield* walk(c); } }
function compound(el, sel) {
  const m = sel.match(/^([a-zA-Z][\w-]*)?((?:\.[\w-]+|\[[^\]]+\])*)$/); if (!m) throw Error('selector ' + sel);
  if (m[1] && el.localName !== m[1].toLowerCase()) return false;
  for (const part of m[2].match(/\.[\w-]+|\[[^\]]+\]/g) || []) {
    if (part[0] === '.') { if (!el.classList.contains(part.slice(1))) return false; continue; }
    const [, name, value] = part.match(/^\[([\w-]+)(?:=["']?([^"'\]]*)["']?)?\]$/);
    if (!el.hasAttribute(name) || (value !== undefined && el.getAttribute(name) !== value)) return false;
  }
  return true;
}
const matches = (el, selector) => selector.split(',').some(s => {
  const parts = s.trim().split(/\s+/); if (!compound(el, parts.at(-1))) return false;
  let i = parts.length - 2, node = el.parentNode;
  while (i >= 0 && node) { if (node.nodeType === 1 && compound(node, parts[i])) i--; node = node.parentNode; }
  return i < 0;
});
const serialize = n => n.nodeType === 3 ? n.data.replace(/&/g, '&amp;').replace(/</g, '&lt;') : `<${n.localName}${[...n.attrs].map(([k, v]) => ` ${k}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('')}>${n.childNodes.map(serialize).join('')}${VOID.has(n.localName) ? '' : `</${n.localName}>`}`;
class FakeElement extends FakeNode {
  constructor(tag, doc) {
    super(); this.nodeType = 1; this.localName = tag.toLowerCase(); this.tagName = tag.toUpperCase(); this.ownerDocument = doc;
    this.attrs = new Map(); this.childNodes = []; this.parentNode = null; this.listeners = []; this.style = {}; this.open = false; this.drawn = [];
    const self = this;
    this.dataset = new Proxy({}, { get: (_, k) => typeof k === 'string' ? self.getAttribute('data-' + kebab(k)) ?? undefined : undefined, set: (_, k, v) => { self.setAttribute('data-' + kebab(k), v); return true; }, deleteProperty: (_, k) => { self.removeAttribute('data-' + kebab(k)); return true; }, has: (_, k) => self.hasAttribute('data-' + kebab(k)) });
    this.classList = { contains: c => (self.getAttribute('class') || '').split(/\s+/).includes(c), add: (...cs) => { const s = new Set((self.getAttribute('class') || '').split(/\s+/).filter(Boolean)); cs.forEach(c => s.add(c)); self.setAttribute('class', [...s].join(' ')); }, remove: (...cs) => { self.setAttribute('class', (self.getAttribute('class') || '').split(/\s+/).filter(c => c && !cs.includes(c)).join(' ')); } };
  }
  get className() { return this.getAttribute('class') || ''; } set className(v) { this.setAttribute('class', v); }
  get id() { return this.getAttribute('id') || ''; } set id(v) { this.setAttribute('id', v); }
  setAttribute(k, v) { this.attrs.set(k, String(v)); } getAttribute(k) { return this.attrs.has(k) ? this.attrs.get(k) : null; }
  hasAttribute(k) { return this.attrs.has(k); } removeAttribute(k) { this.attrs.delete(k); }
  toggleAttribute(k, force) { const on = force ?? !this.hasAttribute(k); if (on) this.setAttribute(k, ''); else this.removeAttribute(k); return on; }
  appendChild(n) { n.remove(); n.parentNode = this; this.childNodes.push(n); return n; }
  append(...ns) { for (const n of ns) this.appendChild(typeof n === 'string' ? new FakeText(n) : n); }
  replaceChildren(...ns) { for (const c of [...this.childNodes]) c.remove(); this.append(...ns); }
  after(n) { n.remove(); const p = this.parentNode; n.parentNode = p; p.childNodes.splice(p.childNodes.indexOf(this) + 1, 0, n); }
  get children() { return this.childNodes.filter(c => c.nodeType === 1); }
  get textContent() { return this.childNodes.map(c => c.textContent).join(''); }
  set textContent(v) { this.replaceChildren(); if (String(v ?? '') !== '') this.appendChild(new FakeText(String(v))); }
  get innerHTML() { return this.childNodes.map(serialize).join(''); }
  set innerHTML(html) {
    this.replaceChildren();
    const re = /<!--[\s\S]*?-->|<\/([a-zA-Z][\w-]*)\s*>|<([a-zA-Z][\w-]*)((?:\s+[^\s=>\/]+(?:="[^"]*")?)*)\s*\/?>|([^<]+)/g;
    let cur = this, m;
    while ((m = re.exec(String(html)))) {
      if (m[1]) { if (cur !== this) cur = cur.parentNode; continue; }
      if (m[2]) { const el = this.ownerDocument.createElement(m[2]); for (const a of m[3].matchAll(/([^\s=>\/]+)(?:="([^"]*)")?/g)) el.setAttribute(a[1], a[2] === undefined ? '' : decode(a[2])); cur.appendChild(el); if (!VOID.has(el.localName)) cur = el; continue; }
      if (m[4]) cur.appendChild(new FakeText(decode(m[4])));
    }
  }
  get isConnected() { for (let n = this; n; n = n.parentNode) if (n === this.ownerDocument) return true; return false; }
  querySelector(s) { for (const e of walk(this)) if (matches(e, s)) return e; return null; }
  querySelectorAll(s) { return [...walk(this)].filter(e => matches(e, s)); }
  addEventListener(type, fn, opt) { this.listeners.push({ type, fn, capture: opt === true || !!opt?.capture }); }
  removeEventListener() {}
  dispatchEvent(e) {
    e.target = this; const path = []; for (let n = this; n && n.nodeType === 1; n = n.parentNode) path.push(n);
    const run = (node, capture) => { e.currentTarget = node; for (const l of [...node.listeners]) if (l.type === e.type && l.capture === capture) { l.fn.call(node, e); if (e._stopImmediate) return; } };
    const prop = node => { if (!e._stopImmediate && typeof node['on' + e.type] === 'function') { e.currentTarget = node; node['on' + e.type](e); } };
    for (const n of path.slice(1).reverse()) { run(n, true); if (e._stop) return true; }
    run(this, true); if (e._stopImmediate) return true; run(this, false); prop(this);
    if (!e.bubbles || e._stop) return true;
    for (const n of path.slice(1)) { run(n, false); prop(n); if (e._stop) return true; }
    return true;
  }
  click() { this.dispatchEvent(new FakeEvent('click', { bubbles: true })); }
  focus() { this.ownerDocument.activeElement = this; }
  showModal() { this.open = true; }
  close() { if (!this.open) return; this.open = false; this.dispatchEvent(new FakeEvent('close')); }
  getBoundingClientRect() { return { left: 0, right: 0, top: 0, bottom: 0, width: 0, height: 0 }; }
  getContext() { const el = this; return { drawImage: (...a) => el.drawn.push(a) }; }
}
function makeDocument() {
  const doc = { nodeType: 9, activeElement: null, createElement: t => new FakeElement(t, doc), addEventListener() {}, getElementById: id => [...walk(doc.body)].find(e => e.id === id) || null };
  doc.body = new FakeElement('body', doc); doc.body.parentNode = doc;
  return doc;
}

// ---- 共通カレンダー＋探すの calendarMonth（実コード）＋ねらうの aimCalGridHtml/aimCalSolid/aimObserverAt（実コード）
const rowsFor = (y, m) => [
  { at: dayOf(y, m, 5) + 18 * H + 16 * 60000, side: 'rise', intersects: true, sunAltitude: -10 },
  { at: dayOf(y, m, 9) + 20 * H, side: 'set', intersects: false, gap: 3, radius: .25, sunAltitude: -12 },
];
function mount() {
  const doc = makeDocument();
  const ctx = {
    document: doc, Event: FakeEvent, setTimeout, console, S,
    esc: s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;'),
    session: null, auth: { token: 'A' }, access: true, shown: true,
    hasAccess: () => ctx.access, active: () => ctx.shown,
    validPoint: p => !!p && Number.isFinite(p.latitude) && Number.isFinite(p.longitude),
    aim: { body: 'sun', from: null }, fromCalls: 0, aimFromPoint: () => { ctx.fromCalls++; return ctx.aim.from; },
    sideArgs: [], aimSideName: (...a) => { ctx.sideArgs.push(a.length); return (a[1] || 'aim') + ':' + a[0]; },
    aimIsMountain: () => false,
    groundCalls: 0, groundResult: () => 12,
    AstroNotesTerrain: { decksFor: () => null, groundElevation: async () => { ctx.groundCalls++; return ctx.groundResult(); } },
    atmos: 'standard', AstroNotesAtmosphere: { dataKey: () => ctx.atmos },
    AstroNotesBodies: { state: (id, at, o) => ({ id, at, o }), definition: id => ({ name: id, limbs: id === 'sun' || id === 'moon' }), sky: () => '夜' },
    AstroNotesMoon: { phaseOf: () => ({ name: '満月' }) },
    moonRequests: [], AstroNotesCalendarMoon: { request: (state, cb) => { ctx.moonRequests.push({ state, cb }); return { canvas: 'portrait', status: 'ready' }; } },
    candidateWaitMarkup: t => `<span class="candidate-wait">${t}</span>`,
    viewCalls: [], viewGate: null,
    aimShootingView: (...a) => { ctx.viewCalls.push(a); return ctx.viewGate ? new Promise((r, j) => ctx.viewGate.push({ r, j })) : Promise.resolve('view'); },
    rowCalls: [],
  };
  vm.createContext(ctx);
  vm.runInContext(uiSrc, ctx);
  vm.runInContext(observerCode + mapCode + ';this.calendarMonth=calendarMonth;this.calendarCache=calendarCache;this.grid=aimCalGridHtml;', ctx);
  ctx.aimCalRows = (...a) => { ctx.rowCalls.push(a); return rowsFor(a[3], a[4]); };
  const button = doc.createElement('button'); doc.body.append(button);
  return { ctx, doc, button };
}
const plan = (over = {}) => ({ observer: { name: '地点', latitude: 35.6, longitude: 139.7, decks: null, stand: null, standAglM: null, groundManualM: null }, ground: 10, target: { id: 't', name: '塔', parts: [{ id: 'tip', m: 100 }] }, body: 'moon', partId: '__whole', limb: 'center', matchMode: 'overlap', at: dayOf(2026, 10, 5) + 18 * H, ...over });
function exploreCalendar(env) {
  const { ctx, button } = env; ctx.picked = [];
  // map-presentation の setDay と同じ式（その日の元の時刻を保つ）。配線そのものは下の source 照合で確かめる
  return ctx.ToolDateTimeBar.calendar({ button, getAt: () => ctx.session?.at ?? NOW, getNow: () => NOW, renderMonth: ctx.calendarMonth,
    setDay: day => { ctx.picked.push(day); if (ctx.session) ctx.session.at = day + (ctx.session.at - S.JstCal.startOfDay(ctx.session.at)); } });
}
const gridOf = d => d.querySelector('[data-grid]'), statusOf = d => d.querySelector('[role=status]');

test('renderMonth 未指定: 数字だけの従来DOMと挙動（描いてから開く順序、状態文なし）', () => {
  const { ctx, button } = mount();
  let at = dayOf(2026, 10, 5) + 12 * H; const picked = [];
  const dialog = ctx.ToolDateTimeBar.calendar({ button, getAt: () => at, setDay: d => picked.push(d), getNow: () => NOW });
  let paintedBeforeOpen = null; const show = dialog.showModal; dialog.showModal = function () { paintedBeforeOpen = gridOf(this).querySelectorAll('button').length; show.call(this); };
  button.click();
  assert.equal(paintedBeforeOpen, 30);
  assert.equal(dialog.open, true);
  assert.equal(statusOf(dialog), null);
  const grid = gridOf(dialog), days = grid.querySelectorAll('button');
  assert.equal(days.length, 30);
  assert.equal(grid.children.filter(e => e.localName === 'span').length, new Date(Date.UTC(2026, 10, 1)).getUTCDay());
  assert.equal(days[0].textContent, '1');
  assert.equal(days[4].getAttribute('aria-label'), '2026年11月5日');
  assert.equal(days[4].getAttribute('aria-pressed'), 'true');
  assert.equal(grid.querySelector('.has-event,canvas,.aim-cal-mark'), null);
  dialog.querySelector('[data-next]').click();
  assert.equal(dialog.querySelector('[data-month]').value, '11');
  dialog.querySelector('[data-prev]').click();
  assert.equal(dialog.querySelector('[data-month]').value, '10');
  gridOf(dialog).querySelectorAll('button')[4].click();
  assert.deepEqual(picked, [dayOf(2026, 10, 5)]);
  assert.equal(dialog.open, false);
  assert.equal(ctx.document.activeElement, button);
  button.click(); dialog.querySelector('[data-today]').click();
  assert.equal(picked.at(-1), dayOf(2026, 9, 30));
  assert.equal(dialog.open, false);
  button.click(); dialog.querySelector('[data-close]').click();
  assert.equal(dialog.open, false);
});

test('renderMonth 指定: 開いた後に格子だけ任せ、年月/前後/今日/閉じるは共通。月替え・閉じた後の旧応答は isCurrent=false', () => {
  const { ctx, button } = mount();
  let at = dayOf(2026, 10, 5) + 18 * H; const picked = [], calls = [], openAtCall = [];
  const dialog = ctx.ToolDateTimeBar.calendar({ button, getAt: () => at, setDay: d => { picked.push(d); at = d + 18 * H; }, getNow: () => NOW, renderMonth: args => {
    calls.push(args); openAtCall.push(args.dialog.open);
    args.grid.innerHTML = `<button type="button" data-cal-day="${dayOf(args.year, args.month, 5)}" class="has-event" aria-label="x"><span>5</span><span class="aim-cal-mark" aria-hidden="true">●</span></button>`;
    args.grid.querySelector('[data-cal-day]').onclick = e => args.pickDay(+e.currentTarget.dataset.calDay);
  } });
  button.click();
  assert.equal(calls.length, 1);
  assert.equal(openAtCall[0], true, 'custom month paints after showModal');
  const first = calls[0];
  assert.deepEqual([first.year, first.month, first.selected, first.today], [2026, 10, at, NOW]);
  assert.equal(first.grid, gridOf(dialog));
  assert.equal(first.dialog, dialog);
  assert.equal(first.status, statusOf(dialog));
  assert.equal(first.status.className, 'tiny');
  assert.equal(first.isCurrent(), true);
  assert.equal(gridOf(dialog).textContent.includes('●'), true);
  dialog.querySelector('[data-next]').click();
  assert.equal(first.isCurrent(), false, 'month change rejects the old month');
  assert.equal(calls[1].month, 11);
  dialog.querySelector('[data-year]').value = '2027'; dialog.querySelector('[data-year]').dispatchEvent(new FakeEvent('change'));
  assert.equal(calls[1].isCurrent(), false);
  assert.equal(calls[2].year, 2027);
  dialog.querySelector('[data-grid] [data-cal-day]').click();
  assert.deepEqual(picked, [dayOf(2027, 11, 5)]);
  assert.equal(dialog.open, false);
  assert.equal(calls[2].isCurrent(), false, 'closing rejects pending months');
  button.click();
  const reopened = calls.at(-1);
  assert.equal(openAtCall.at(-1), true);
  dialog.querySelector('[data-today]').click();
  assert.equal(picked.at(-1), dayOf(2026, 9, 30));
  assert.equal(reopened.isCurrent(), false);
});

test('探す: 月全体の重なる日●・近接○・時刻・月相canvas・読み上げ・状態文を既存描画で出す', async () => {
  const env = mount(), { ctx, button } = env; ctx.session = plan();
  const dialog = exploreCalendar(env);
  button.click();
  const grid = gridOf(dialog);
  assert.equal(grid.getAttribute('aria-busy'), 'true');
  assert.match(statusOf(dialog).textContent, /重なる日を計算中/);
  assert.equal(grid.querySelectorAll('[data-cal-moon]').length, 30, 'moon phase canvases are painted while waiting');
  assert.ok(grid.querySelectorAll('[data-cal-moon]').every(c => c.drawn.length === 1 && c.dataset.portraitStatus === 'ready'));
  await flush();
  assert.equal(grid.getAttribute('aria-busy'), 'false');
  assert.equal(ctx.rowCalls.length, 1);
  const [obs, target, body, year, month, partId, view, owner] = ctx.rowCalls[0];
  assert.deepEqual([obs.elevation, obs.eyeM, target.id, body, year, month, partId, view], [10, 1.5, 't', 'moon', 2026, 10, '__whole', 'view']);
  assert.deepEqual({ ...owner }, { target: ctx.session.target, body: 'moon', partId: '__whole', limb: 'center', matchMode: 'overlap' });
  const days = grid.querySelectorAll('[data-cal-day]');
  assert.equal(days.length, 30, 'whole month, not only band candidates');
  const fifth = days[4], ninth = days[8];
  assert.equal(fifth.classList.contains('has-event'), true);
  assert.equal(fifth.querySelector('.aim-cal-mark').textContent.trim(), '●');
  assert.equal(fifth.querySelector('.aim-cal-time').textContent, '18:16');
  assert.equal(fifth.getAttribute('aria-label'), '2026年11月5日、満月、重なる日、moon:rise 18:16');
  assert.equal(fifth.getAttribute('aria-pressed'), 'true');
  assert.equal(ninth.querySelector('.aim-cal-mark').textContent.trim(), '○');
  assert.match(ninth.getAttribute('aria-label'), /近くを通る日、moon:set 20:00/);
  assert.equal(days[0].classList.contains('has-event'), false);
  assert.ok(ctx.sideArgs.every(n => n === 2), 'explore labels pass the plan body to aimSideName');
  assert.ok(days.every(d => d.querySelector('canvas[data-cal-moon]')?.drawn.length === 1));
  assert.equal(statusOf(dialog).textContent, '重なる日 1日 ・ 近くを通る日 1日（暗い空の時間）');
  // 日を選ぶとその日の元の時刻を保つ（イベント時刻へ飛ばさない）
  ninth.click();
  assert.deepEqual(ctx.picked, [dayOf(2026, 10, 9)]);
  assert.equal(ctx.session.at, dayOf(2026, 10, 9) + 18 * H);
  assert.equal(dialog.open, false);
});

test('探す: 撮影地点ありで対象なしでも開いた直後に月相を描く。太陽は月相なし', async () => {
  const env = mount(), { ctx, button } = env; ctx.session = plan({ target: null });
  const dialog = exploreCalendar(env);
  button.click();
  const grid = gridOf(dialog);
  assert.equal(grid.querySelectorAll('canvas[data-cal-moon]').length, 30);
  assert.ok(grid.querySelectorAll('canvas[data-cal-moon]').every(c => c.drawn.length === 1));
  assert.equal(statusOf(dialog).textContent, '撮影地点と対象を選んでください');
  assert.equal(grid.getAttribute('aria-busy'), 'false');
  await flush(); assert.equal(ctx.viewCalls.length, 0);
  dialog.close();
  ctx.session = plan({ body: 'sun' }); ctx.moonRequests.length = 0;
  button.click(); await flush();
  assert.equal(gridOf(dialog).querySelector('canvas'), null);
  assert.equal(ctx.moonRequests.length, 0);
  assert.equal(statusOf(dialog).textContent, '重なる日 1日 ・ 近くを通る日 1日');
  dialog.close();
  ctx.session = plan({ observer: null }); button.click();
  assert.equal(gridOf(dialog).querySelector('canvas'), null);
  assert.equal(gridOf(dialog).querySelectorAll('[data-cal-day]').length, 30);
  assert.equal(statusOf(dialog).textContent, '撮影地点と対象を選んでください');
});

test('探す: 閉じた・月を替えた・条件が替わった旧応答を捨て、待機のまま残さない', async () => {
  const env = mount(), { ctx, button } = env; ctx.session = plan(); ctx.viewGate = [];
  const dialog = exploreCalendar(env);
  // 月替え
  button.click(); await flush();
  assert.equal(ctx.viewGate.length, 1);
  dialog.querySelector('[data-next]').click(); await flush();
  assert.equal(ctx.viewGate.length, 2);
  ctx.viewGate[0].r('view'); await flush();
  assert.equal(ctx.rowCalls.length, 0, 'old month result is discarded');
  ctx.viewGate[1].r('view'); await flush();
  assert.deepEqual(ctx.rowCalls.map(a => a[4]), [11]);
  assert.equal(dialog.querySelector('[data-month]').value, '11');
  assert.equal(gridOf(dialog).querySelectorAll('[data-cal-day]').length, 31);
  assert.equal(gridOf(dialog).getAttribute('aria-busy'), 'false');
  // 閉じる
  dialog.close(); ctx.session.at = dayOf(2027, 0, 5) + 9 * H; button.click(); await flush();
  const pending = ctx.viewGate.at(-1); dialog.close(); pending.r('view'); await flush();
  assert.equal(ctx.rowCalls.length, 1, 'closed calendar result is discarded');
  // 条件（地面の標高・限界・大気）が替わったら同じ月を新しい条件で解き直す
  button.click(); await flush();
  const before = ctx.viewGate.length; ctx.session.ground = 30; ctx.viewGate.at(-1).r('view'); await flush();
  assert.equal(ctx.viewGate.length, before + 1, 'stale condition restarts the open month');
  assert.equal(ctx.rowCalls.length, 1);
  assert.equal(gridOf(dialog).getAttribute('aria-busy'), 'true');
  ctx.atmos = 'measured'; ctx.viewGate.at(-1).r('view'); await flush();
  assert.equal(ctx.viewGate.length, before + 2);
  ctx.viewGate.at(-1).r('view'); await flush();
  assert.equal(ctx.rowCalls.length, 2);
  assert.equal(ctx.rowCalls[1][0].elevation, 30);
  assert.equal(gridOf(dialog).getAttribute('aria-busy'), 'false');
  assert.match(statusOf(dialog).textContent, /^重なる日 1日/);
  // 権限が外れた旧応答は待機を解く
  dialog.querySelector('[data-next]').click(); await flush();
  ctx.access = false; ctx.viewGate.at(-1).r('view'); await flush();
  assert.equal(gridOf(dialog).getAttribute('aria-busy'), 'false');
  assert.equal(statusOf(dialog).textContent, '');
  assert.equal(ctx.rowCalls.length, 2);
});

test('探す: 月相画像の後着コールバックも月・持ち主・条件が替わったら描かない', async () => {
  const env = mount(), { ctx, button } = env; ctx.session = plan();
  const dialog = exploreCalendar(env);
  button.click(); await flush();
  // 最後の要求は最後の日の canvas のもの
  const canvas = gridOf(dialog).querySelectorAll('canvas[data-cal-moon]').at(-1), late = ctx.moonRequests.at(-1);
  const count = () => gridOf(dialog).querySelectorAll('canvas').reduce((n, c) => n + c.drawn.length, 0);
  const drawn = count();
  ctx.session.limb = 'onTop'; late.cb();
  assert.equal(count(), drawn, 'condition change');
  ctx.session.limb = 'center'; ctx.auth = { token: 'B' }; late.cb();
  assert.equal(count(), drawn, 'owner change');
  ctx.auth = { token: 'A' }; const live = ctx.moonRequests.at(-1); live.cb();
  assert.equal(count(), drawn + 1, 'current image callback still paints');
  dialog.querySelector('[data-next]').click(); await flush();
  const length = canvas.drawn.length; live.cb();
  assert.equal(canvas.drawn.length, length, 'month change');
  assert.equal(canvas.isConnected, false);
});

test('探す: 標高を取得できなければ0mにせず失敗し、月を替えると再試行できる', async () => {
  const env = mount(), { ctx, button } = env; ctx.session = plan({ ground: null });
  const dialog = exploreCalendar(env);
  ctx.groundResult = () => { throw Error('offline'); };
  button.click(); await flush();
  assert.equal(statusOf(dialog).textContent, '計算できませんでした。月を選び直して再試行してください');
  assert.equal(gridOf(dialog).getAttribute('aria-busy'), 'false');
  assert.equal(ctx.rowCalls.length, 0);
  ctx.groundResult = () => null;
  dialog.querySelector('[data-next]').click(); await flush();
  assert.equal(statusOf(dialog).textContent, '計算できませんでした。月を選び直して再試行してください');
  assert.equal(ctx.rowCalls.length, 0);
  ctx.groundResult = () => 25;
  dialog.querySelector('[data-prev]').click(); await flush();
  assert.equal(ctx.rowCalls.length, 1);
  assert.equal(ctx.rowCalls[0][0].elevation, 25);
  assert.match(statusOf(dialog).textContent, /^重なる日 1日/);
  // 計算そのものの失敗も同じ再試行文言
  ctx.aimCalRows = () => { throw Error('solver'); };
  dialog.querySelector('[data-next]').click(); await flush();
  assert.equal(statusOf(dialog).textContent, '計算できませんでした。月を選び直して再試行してください');
  assert.equal(gridOf(dialog).getAttribute('aria-busy'), 'false');
});

test('探す: キャッシュは月+条件+持ち主。同じ月なら時刻が違っても再計算しない', async () => {
  const env = mount(), { ctx, button } = env; ctx.session = plan();
  const dialog = exploreCalendar(env);
  button.click(); await flush(); dialog.close();
  ctx.session.at = dayOf(2026, 10, 20) + 23 * H + 59 * 60000; button.click(); await flush(); dialog.close();
  ctx.session.at = dayOf(2026, 10, 1); button.click(); await flush();
  assert.equal(ctx.rowCalls.length, 1);
  assert.equal(gridOf(dialog).querySelectorAll('[data-cal-day]')[0].getAttribute('aria-pressed'), 'true', 'selection follows the current time without recalculating');
  assert.equal(gridOf(dialog).querySelector('.has-event .aim-cal-mark').textContent.trim(), '●');
  dialog.close(); ctx.auth = { token: 'B' }; button.click(); await flush(); dialog.close();
  assert.equal(ctx.rowCalls.length, 2, 'owner');
  ctx.session.limb = 'onTop'; button.click(); await flush(); dialog.close();
  assert.equal(ctx.rowCalls.length, 3, 'condition');
  ctx.session.observer = { ...ctx.session.observer, groundManualM: 50 }; button.click(); await flush(); dialog.close();
  assert.equal(ctx.rowCalls.length, 4, 'ground');
  assert.equal(ctx.rowCalls[3][0].elevation, 50);
  dialog.close(); button.click(); dialog.querySelector('[data-next]').click(); await flush();
  assert.equal(ctx.rowCalls.length, 5, 'month');
});

test('ねらうの既定呼出は従来どおり: 太陽では撮影地点を引かず、月だけ引く', () => {
  const { ctx } = mount();
  const start = dayOf(2026, 10, 1), events = new Map([[dayOf(2026, 10, 5), rowsFor(2026, 10).slice(0, 1)]]);
  ctx.aim.body = 'sun'; ctx.aim.from = { latitude: 35, longitude: 139 };
  const sun = ctx.grid(2026, 10, events, start, start);
  assert.equal(ctx.fromCalls, 0);
  assert.doesNotMatch(sun, /data-cal-moon/);
  assert.match(sun, /重なる日、aim:rise 18:16/);
  assert.deepEqual(ctx.sideArgs, [1], 'legacy aim label keeps the single-argument aimSideName call');
  ctx.aim.body = 'moon';
  const moon = ctx.grid(2026, 10, events, start, start);
  assert.equal(ctx.fromCalls, 1);
  assert.equal((moon.match(/data-cal-moon=/g) || []).length, 30);
  ctx.aim.from = null; ctx.fromCalls = 0;
  assert.doesNotMatch(ctx.grid(2026, 10, events, start, start), /data-cal-moon/);
  const explicitNone = ctx.grid(2026, 10, events, start, start, { body: 'moon' }, null);
  assert.equal(ctx.fromCalls, 1);
  assert.doesNotMatch(explicitNone, /data-cal-moon/);
});

test('探すの配線: renderMonth に calendarMonth、setDay は元の時刻を保つ', () => {
  assert.match(mapSrc, /ToolDateTimeBar\.calendar\(\{button:el\('skyMapCalendarOpen'\),[^\n]*renderMonth:calendarMonth\}\)/);
  assert.match(mapSrc, /setDay:day=>\{if\(session\)setTime\(day\+\(session\.at-AstroNotesSkyMap\.dayStart\(session\.at\)\)\);\}/);
  assert.doesNotMatch(mapCode, /\.catch\(\(\)=>\{\}\)/);
});
