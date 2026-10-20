// 日付をまたぐ通り道と画角内の時刻（2026-10-20 ユーザー「日付を跨ぐ際に線が途切れる問題に対処して」）
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Al=require('./sorami-align.js');
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
test('frameDayPath は前日・翌日へ広げられ、既定はその日の0〜24時',()=>{
 const day=Date.parse('2026-10-20T00:00:00+09:00'),obs={latitude:35.74,longitude:139.93,elevation:20},proj=()=>[0,0];
 const d=Al.frameDayPath('moon',obs,day,proj);assert.equal(d[0].at,day);assert.equal(d.at(-1).at,day+86400000);
 const w=Al.frameDayPath('moon',obs,day,proj,{startMs:day-6*3600000,endMs:day+30*3600000});assert.equal(w[0].at,day-6*3600000);assert.equal(w.at(-1).at,day+30*3600000);
});
test('図は見ている時刻を含む1本の通り道だけを前日・翌日へつなげて描き、画角内は前日・翌を付けて書く',()=>{
 assert.match(html,/const fullPath = \[\.\.\.pathBefore, \.\.\.path, \.\.\.pathAfter\];/);
 assert.match(html,/const run = runAt\(p\.at\)/);assert.match(html,/for \(const q of run \? fullPath\.slice\(run\[0\], run\[1\] \+ 1\) : path\)/);
 assert.match(html,/startMs: frameDay - 6 \* 3600000, endMs: frameDay \+ 30 \* 3600000/);
 assert.match(html,/t < frameDay \? "前日" : t >= dayEnd \? "翌" : ""/);assert.doesNotMatch(html,/"24:00まで枠内"|"0:00時点で枠内"/);
});
test('構図の図の操作で触っていない部品を動かさない（2026-10-20 ユーザー「なんで触ってないボタンがズレるの?」）',()=>{
 const c=fs.readFileSync(new URL('./sorami-flair.css',import.meta.url),'utf8');
 assert.match(c,/#aimLook \.preview-figure-tools\{align-items:flex-end\}/);
 assert.match(c,/#aimLook \.aim-look-figure \.aim-body-actions\{position:absolute;/);assert.match(c,/#aimLook \.aim-look-figure>\.preview-compose\{position:absolute;/);
 assert.match(html,/\(figure\|\|lens\)\.append\(compose\);const bodyActions=look\.querySelector\('\[data-body-actions\]'\);if\(figure&&bodyActions\)figure\.append\(bodyActions\);/);
});
