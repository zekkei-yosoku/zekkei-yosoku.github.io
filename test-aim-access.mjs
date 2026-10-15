// 未ログイン・権限なしで構図を直URLで開いたとき、本体ではなく案内を出す（2026-10-15）。
// 以前は openAim が aimView ごと隠したあと、render() がルートだけで表示へ戻し、本体が「計算しています…」のまま止まっていた。
import {readFileSync} from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');

// 案内カードは構図画面の先頭。権限なしは本体カード・固定フッター・ダイアログを隠し、フッター分の余白も取らない
assert.match(html.slice(html.indexOf('<div id="aimView" hidden>')),/^<div id="aimView" hidden>\s*<div id="aimAccess" hidden><div class="sky-map-head"><h2>構図<\/h2><\/div><div class="card">.*id="aimAccessMessage".*id="aimAccessLogin"/);
assert.ok(html.includes('#aimView[data-locked]>:not(#aimAccess){display:none!important}'));
assert.ok(html.includes('main:has(>#aimView:not([hidden],[data-locked]))'));
assert.ok(html.includes('$("aimAccessLogin").onclick = () => $("authButton").click();'));

// render() はルートだけで画面を出すので、構図のときは権限を当て直す（ログアウト直後も本体を出さない）
const renderStart=html.indexOf('function render() {');
assert.match(html.slice(renderStart,html.indexOf('$("backBar").hidden',renderStart)),/for \(const v of VIEWS\) \$\(v\.el\)\.hidden = v\.id !== view;[\s\S]*if \(view === "aim"\) renderAimAccess\(\);/);

const src=html.slice(html.indexOf('function renderAimAccess() {'),html.indexOf('$("aimAccessLogin").onclick'));
function fixture(auth){
 const els={};
 const c={auth,$:id=>els[id]??={hidden:false,textContent:'',attrs:new Set(),toggleAttribute(n,on){on?this.attrs.add(n):this.attrs.delete(n);}}};
 c.toolAllowed=id=>(c.auth?.tools||[]).includes(id);
 vm.createContext(c);vm.runInContext(src,c);return c;
}
const locked=c=>c.$('aimView').attrs.has('data-locked');

{const c=fixture(null);
 assert.equal(c.renderAimAccess(),false);assert.ok(locked(c));assert.equal(c.$('aimAccess').hidden,false);
 assert.equal(c.$('aimAccessMessage').textContent,'ログインすると利用権限を確認できます');assert.equal(c.$('aimAccessLogin').hidden,false);}

{const c=fixture({token:'fixture-only-token',tools:['skymap','plane']});
 assert.equal(c.renderAimAccess(),false);assert.ok(locked(c));
 assert.equal(c.$('aimAccessMessage').textContent,'構図の利用が許可されていません');assert.equal(c.$('aimAccessLogin').hidden,true);}

// 富士山だけの許可（diamond/pearl）でも構図は開ける。ログアウトしたら再び案内へ
for(const tool of ['tower','diamond','pearl']){
 const c=fixture({token:'fixture-only-token',tools:[tool]});
 assert.equal(c.renderAimAccess(),true);assert.ok(!locked(c));assert.equal(c.$('aimAccess').hidden,true);
 c.auth=null;assert.equal(c.renderAimAccess(),false);assert.ok(locked(c));assert.equal(c.$('aimAccess').hidden,false);
}

// openAim は権限が無ければ形状の取得も計算も始めず、待っている古い計算を無効にする
const openStart=html.indexOf('function openAim(preset) {');
const gate=html.slice(openStart,html.indexOf('if (preset) aim.pendingModelPreset = preset;',openStart));
assert.ok(!gate.includes('$("aimView").hidden'),'aimView の表示は render() に任せる');
const g={aim:{bodySeq:3,pendingModelPreset:null},renderAimAccess:()=>false};vm.createContext(g);vm.runInContext(gate+'}',g);
g.openAim('tower');assert.equal(g.aim.bodySeq,4);assert.equal(g.aim.pendingModelPreset,null);

console.log('AIM ACCESS OK: guest/denied/allowed/logout states, render re-check, openAim gate');
