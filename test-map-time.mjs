import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const h=readFileSync(new URL('./index.html',import.meta.url),'utf8'),a=h.indexOf('function aimLineAtTime('),c=vm.createContext({});vm.runInContext(h.slice(a,h.indexOf('\n}',a)+2),c);
const pts=[{at:100,latitude:10,longitude:20},{at:200,latitude:20,longitude:40},{at:300,latitude:30,longitude:60}];
test('時刻補間は昇順・降順と端点で連続し区間外を表示しない',()=>{for(const p of [pts,[...pts].reverse()]){const q=c.aimLineAtTime(p,150);assert.equal(q.length,1);assert.equal(q[0].latitude,15);assert.equal(q[0].longitude,30);assert.equal(c.aimLineAtTime(p,200).length,1);assert.equal(c.aimLineAtTime(p,50).length,0);assert.equal(c.aimLineAtTime(p,350).length,0);}});
test('時間が折り返す場合は複数解、無効値は表示しない',()=>{const p=[...pts.slice(0,2),{...pts[2],at:100}];assert.equal(c.aimLineAtTime(p,150).length,2);assert.equal(c.aimLineAtTime(pts,NaN).length,0);assert.equal(c.aimLineAtTime([],100).length,0);});
test('日時は下部固定欄に集約し、見え方と撮影地で同じ時間バーを使う',()=>{
 const p=h.slice(h.indexOf('<script id="previewPresentation">')),css=h.slice(h.indexOf('<style id="previewStyles">'),h.indexOf('</style></head>'));
 assert.match(h,/aria-controls="previewPlaces"[^>]*>撮影地<\/button>/);
 assert.match(p,/footer\.className='preview-datetime-footer'/);assert.match(p,/footer\.append\(dateRow\)/);
 assert.match(p,/setPointerCapture/,'iPhoneでもバー全体を指で動かせる');
 assert.match(p,/mode==='places'\?mapRange:look\.querySelector\('\[data-look-range\]'\)/,'撮影地は出入線、見え方は図の時間幅');
 assert.match(p,/focusin',e=>e\.target\.toggleAttribute\('data-pointer-focus',!keyNav\)/,'指で閉じたカレンダーから戻っても日付に青枠を出さない');assert.match(css,/\[data-pointer-focus\]:focus\{outline:none\}/);
 assert.match(p,/state\.set\(state\.reference\);\}if\(timeDialog\.open\)timeDialog\.close\(\);/,'基準時刻へ移動したら設定を閉じる');
 assert.ok(css.lastIndexOf('#aimView .aim-look-time,')>css.lastIndexOf('#aimView .aim-look-time{'),'重複した時刻バーの非表示が後勝ちになる');
});
test('E79 総点検で見つけた下部欄まわりの不具合を戻さない',()=>{
 const p=h.slice(h.indexOf('<script id="previewPresentation">')),css=h.slice(h.indexOf('<style id="previewStyles">'),h.indexOf('</style></head>'));
 assert.match(h,/e\.target\.closest\("\.mapwrap, canvas, input, select, textarea, \.preview-footer-track"\)/,'時間バーの左端からなぞってもメニューを開かない');
 assert.match(p,/root\.addEventListener\('focusin',e=>e\.target\.toggleAttribute\('data-pointer-focus',!keyNav\)\)/,'天体・目標の選択から戻っても青枠を出さない');
 assert.match(css,/#aimView button\[data-pointer-focus\]:focus\{outline:none\}/);
 assert.match(p,/if\(\(!state\|\|look\.hidden\)&&clock\.value\)clock\.value='';/,'図が無い時に前の時刻を残さない');
 assert.match(p,/if\(dateValue&&Number\.isFinite\(aim\.dayMs\)\)/,'日付が入る前に曜日だけを出さない');
 assert.match(css,/\.aim-date\{display:grid;grid-template-columns:32px auto minmax\(0,1fr\) 32px 32px;/,'日付は内容幅、時刻と差は残りの幅');
 assert.match(css,/\.preview-footer-rel\{max-width:100%;overflow:hidden;text-overflow:ellipsis;/);
 assert.match(p,/footerRange\.onkeydown=[\s\S]{0,300}e\.shiftKey\?600:60/,'矢印は1分、Shiftで10分');
 assert.match(p,/focalInput\.value=button\.dataset\.focalPreset;focalInput\.onchange\(\);const sheet=button\.closest\('dialog'\);if\(sheet\?\.open\)sheet\.close\(\);/,'焦点距離の代表値を押したら画角調整を閉じる');
});
