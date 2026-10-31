import {sourceUnit} from './tools/test-source.mjs';
import './tools/test-owner-adapter.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import vm from 'node:vm';
import { createRequire } from 'node:module';

// 旧 navigation（構造整理前の実source）と新 navigation＋factory を同じ偽のブラウザで動かし、route と history の呼出列を比べる
const require = createRequire(import.meta.url);
const OLD = '/Users/okadayudai/Developer/AstroNotes/public-web/src/app/navigation.js';
const NEW = new URL('./src/app/navigation.js', import.meta.url);
const ROUTES = new URL('./src/domain/navigation/routes.js', import.meta.url);
const HISTORY = new URL('./src/domain/navigation/history.js', import.meta.url);
const R = require('./src/domain/navigation/routes.js');
const H = require('./src/domain/navigation/history.js');

// applyRoute 本文は含めない（DOM/描画は別契約）。listener 登録までは同じ位置で動かす
function navigationSlice(src) {
  const a = src.indexOf('function applyRoute('), b = src.indexOf('document.addEventListener("click"');
  assert.ok(a > 0 && b > a);
  return src.slice(0, a) + src.slice(b);
}

const PHENOMENA = { sunset: {}, fuji: {}, moon: {} };
const hashOf = url => { const i = url.indexOf('#'); return i < 0 ? '' : url.slice(i); };

function browser(src, { standalone, hash = '', state = null, factories = false }) {
  const trace = [], listeners = {}, waiting = [];
  const location = { pathname: '/app/', search: '?q=1', hash };
  const entries = [{ state, hash }]; let index = 0;
  const history = {
    get state() { return entries[index].state; },
    pushState(s, _, url) { trace.push(['pushState', s, url]); entries.splice(index + 1); entries.push({ state: s, hash: hashOf(url) }); index++; location.hash = hashOf(url); },
    replaceState(s, _, url) { trace.push(['replaceState', s, url]); entries[index] = { state: s, hash: hashOf(url) }; location.hash = hashOf(url); },
    back() { trace.push(['back']); this._move(-1); },
    go(n) { trace.push(['go', n]); this._move(n); },
    _move(n) { index = Math.max(0, Math.min(entries.length - 1, index + n)); location.hash = entries[index].hash; },
  };
  const c = vm.createContext({
    location, history, navigator: { standalone }, S: { PHENOMENA },
    pagePop: { n: 0 },
    closeTools: () => trace.push(['closeTools']),
    afterPagePop: run => { trace.push(['afterPagePop']); waiting.push(run); },
    upcoming: () => null, weeks: {},
    document: { addEventListener: (t, f) => (listeners['document:' + t] = f) },
    window: { addEventListener: (t, f) => (listeners['window:' + t] = f) },
  });
  // 実 applyRoute と同じく先頭で routeFromHash を読む（#p= の置換時点も比べる）
  c.applyRoute = () => trace.push(['applyRoute', location.hash, JSON.stringify(vm.runInContext('routeFromHash()', c))]);
  if (factories) { vm.runInContext(fs.readFileSync(ROUTES, 'utf8'), c); vm.runInContext(fs.readFileSync(HISTORY, 'utf8'), c); }
  vm.runInContext(navigationSlice(src), c);
  const call = expr => vm.runInContext(expr, c);
  return {
    trace, location, c, call,
    hashchange() { trace.push(['hashchange', location.hash]); listeners['window:hashchange'](); },
    click(href, ev = {}) { let prevented = false; listeners['document:click']({ target: { closest: () => ({ getAttribute: () => href }) }, defaultPrevented: false, metaKey: false, ctrlKey: false, shiftKey: false, button: 0, ...ev, preventDefault: () => (prevented = true) }); return prevented; },
    resumePagePop() { c.pagePop.n = 0; while (waiting.length) waiting.shift()(); },
  };
}

const oldSrc = execFileSync('git',['show','97356e2:src/app/navigation.js'],{cwd:new URL('.',import.meta.url),encoding:'utf8'}), newSrc = sourceUnit('src/app/navigation.js')+'\nfunction pushRoute(h){navigationHistory.pushRoute(h);}function goBack(){navigationHistory.goBack();}function goList(){navigationHistory.goList();}const appTrail=navigationHistory.appTrail;const NO_HISTORY=navigationHistory.noHistory;';
// vm の context ごとに Object.prototype が違うので、比べる前に同じ realm の値へ写す
const plain = v => JSON.parse(JSON.stringify(v));
function both(opts, run) {
  const a = browser(oldSrc, opts), b = browser(newSrc, { ...opts, factories: true });
  const ra = run(a), rb = run(b);
  assert.deepEqual(plain(b.trace), plain(a.trace));
  assert.deepEqual(plain(rb), plain(ra));
  assert.equal(b.location.hash, a.location.hash);
  return a;
}

const HASHES = ['', '#', '#/', '#/explore', '#/almanac', '#/skymap', '#/records', '#/answers', '#/forecast/results', '#/aim', '#/aim/fuji', '#/aim/diamond', '#/aim/pearl', '#/aim/tower', '#/aim/bad', '#/plane', '#/iss', '#/iss/pick', '#/admin',
  '#/sunset', '#/sunset/0', '#/sunset/1790000000000', '#/sunset/abc', '#/fuji', '#/moon/12', '#/unknown', '#/unknown/1', '#/constructor', '#/toString/1', '#/Sunset',
  '#/aim?plan=abc', '#/aim?plan=', '#/sunset/123?plan=x', '#/sunset?plan=x', '#/unknown/1?plan=x', '#/old?plan=x', '#/records?plan=x', '#/explore?plan=x',
  '#p=abc', '#p=a.b,c/d-e_f', '#p=a%2Fb', '#p=%41%42', '#p=', '#p=%', '#p=%E0%A4%A', '#p=bad token', '#p=a%20b', '#p=' + 'x'.repeat(8000), '#p=' + 'x'.repeat(8001), '#p=日本'];

test('全hash表: 旧 routeFromHash と新 wrapper は同じ route・同じ replaceState(state, URL)・同じ回数', () => {
  for (const hash of HASHES) for (const state of [null, { depth: 2 }]) {
    both({ standalone: false, hash, state }, x => [JSON.stringify(x.call('routeFromHash()')), JSON.stringify(x.call('routeFromHash()')), x.call('isMenuPage()')]);
  }
});

test('純粋 normalizeLegacyHash/parseRoute は旧の replace 先と route を副作用なしで返す', () => {
  for (const hash of HASHES) {
    const old = browser(oldSrc, { standalone: false, hash });
    const route = JSON.stringify(old.call('routeFromHash()'));
    const legacy = R.normalizeLegacyHash(hash);
    const replaced = plain(old.trace.filter(t => t[0] === 'replaceState'));
    assert.deepEqual(replaced, legacy === null ? [] : [['replaceState', null, '/app/?q=1' + legacy]], hash);
    const next = legacy === null ? hash : legacy;
    assert.equal(JSON.stringify(R.parseRoute(next, PHENOMENA)), route, hash);
    assert.equal(JSON.stringify(R.parseRoute(next, () => PHENOMENA)), route, hash);
  }
  assert.equal(R.normalizeLegacyHash('#p=%'), null);
  assert.equal(R.normalizeLegacyHash('#p=a%2Fb'), '#/aim?plan=a/b');
  assert.deepEqual(R.parseRoute('#/sunset/5', PHENOMENA), { id: 'sunset', dayMs: 5 });
  assert.equal(R.parseRoute('#/unknown', PHENOMENA), null);
  // 表を引かない hash では PHENOMENA を読まない（旧と同じく S が未準備でも落ちない）
  assert.deepEqual(R.parseRoute('#/aim', () => { throw new Error('read'); }), { aim: true });
});

test('#p= は hashchange→applyRoute の中で1回だけ置換され、以後は置換後の URL を読む', () => {
  const a = both({ standalone: false, hash: '#p=abc' }, x => { x.hashchange(); x.hashchange(); return x.location.hash; });
  assert.equal(a.location.hash, '#/aim?plan=abc');
  assert.equal(a.trace.filter(t => t[0] === 'replaceState').length, 1);
});

for (const standalone of [false, true]) {
  test(`standalone=${standalone}: 進む・同じ画面・戻る・一覧の呼出列が同じ`, () => {
    both({ standalone }, x => {
      x.call('pushRoute("#/sunset/1")'); x.call('pushRoute("#/sunset/1")'); x.call('pushRoute("#/aim")'); x.call('pushRoute("#/records")');
      x.call('goBack()'); if (!standalone) x.hashchange();
      x.call('goList()'); if (!standalone) x.hashchange();
      x.call('goList()'); x.call('goBack()');
      return [x.location.hash, x.call('appTrail.length'), x.call('NO_HISTORY')];
    });
  });

  test(`standalone=${standalone}: URL を直接開いた画面からの戻る・一覧（fromdeeplink）`, () => {
    both({ standalone, hash: '#/sunset/1' }, x => { x.call('goBack()'); return x.location.hash; });
    both({ standalone, hash: '#/sunset/1' }, x => {
      x.call('pushRoute("#/aim")'); x.call('pushRoute("#/aim/fuji")');
      x.call('goList()'); if (!standalone) x.hashchange();
      return [x.location.hash, x.call('appTrail.length')];
    });
    both({ standalone, hash: '#/sunset/1' }, x => {
      x.call('pushRoute("#/aim")'); x.call('goBack()'); if (!standalone) x.hashchange(); x.call('goBack()'); if (!standalone) x.hashchange();
      return x.location.hash;
    });
    both({ standalone, hash: '' }, x => { x.call('pushRoute("#/aim")'); x.call('goBack()'); if (!standalone) x.hashchange(); return x.location.hash; });
  });

  test(`standalone=${standalone}: pagePop 中は閉じ終わるまで待ってから進む・戻る`, () => {
    both({ standalone }, x => {
      x.call('pushRoute("#/sunset/1")');
      x.c.pagePop.n = 1; x.call('pushRoute("#/aim")'); x.call('goBack()');
      const during = x.location.hash;
      x.resumePagePop(); if (!standalone) x.hashchange();
      return [during, x.location.hash];
    });
  });

  test(`standalone=${standalone}: アプリ内リンクの click と修飾キー`, () => {
    both({ standalone }, x => [x.click('#/aim'), x.click('#/records', { metaKey: true }), x.click('#/records', { button: 1 }), x.click('#/records', { defaultPrevented: true }), x.location.hash]);
  });

  test(`standalone=${standalone}: ブラウザの戻る・進む（toListAfterBack 無し）の hashchange`, () => {
    both({ standalone }, x => {
      x.call('pushRoute("#/sunset/1")'); x.call('pushRoute("#/aim")');
      x.c.history.go(-1); x.hashchange(); x.c.history.go(1); x.hashchange();
      return x.location.hash;
    });
  });
}

test('standalone の期待する呼出列（明示）: 履歴を積まず appTrail で戻る', () => {
  const x = browser(newSrc, { standalone: true, hash: '#/sunset/1', factories: true });
  x.call('pushRoute("#/aim")'); x.call('goBack()'); x.call('goBack()');
  assert.deepEqual(plain(x.trace).filter(t => t[0] !== 'closeTools' && t[0] !== 'applyRoute'), [
    ['replaceState', { depth: 1 }, '#/aim'], ['replaceState', { depth: 0 }, '#/sunset/1'], ['replaceState', null, '/app/?q=1']]);
});

test('history owner: create は deps に触れず、NO_HISTORY は渡した時点の値・appTrail は同じ配列', () => {
  const touched = [];
  const deps = new Proxy({ noHistory: true }, { get(t, k) { if (k !== 'noHistory') touched.push(k); return t[k]; } });
  const h = H.createHistory(deps);
  assert.deepEqual(touched, []);
  assert.equal(h.noHistory, true);
  assert.equal(h.appTrail, h.appTrail);
  const x = browser(newSrc, { standalone: true, factories: true });
  assert.equal(x.call('appTrail === navigationHistory.appTrail'), true);
  x.c.navigator.standalone = false;
  x.call('pushRoute("#/aim")');
  assert.equal(x.trace.some(t => t[0] === 'pushState'), false);
});
