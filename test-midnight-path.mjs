// 日付をまたぐ通り道と画角内の時刻（2026-10-20 ユーザー「日付を跨ぐ際に線が途切れる問題に対処して」）
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),Al=require('./astronotes-align.js');
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
 assert.match(html,/t < frameDay \? "前日" : t >= dayEnd \? "翌日" : ""/);assert.doesNotMatch(html,/"24:00まで枠内"|"0:00時点で枠内"/);
});
test('構図の図の操作で触っていない部品を動かさない（2026-10-20 ユーザー「なんで触ってないボタンがズレるの?」）',()=>{
 const c=fs.readFileSync(new URL('./astronotes-flair.css',import.meta.url),'utf8');
 assert.match(c,/#aimLook \.preview-figure-tools\{align-items:flex-end\}/);
assert.match(c,/#aimLook \.preview-center\{display:grid;/);
 assert.doesNotMatch(html,/\.aim-look-figure'\)\?\.after\(actions\)/);assert.doesNotMatch(html,/data-look-undo|data-body-actions/);
});
test('旧逆算（1点を解く）は切り替え1つで止め、処理は残す（2026-10-20 ユーザー「外してしまおう。戻しやすいように」）',()=>{
 assert.match(html,/const AIM_REVERSE_ENABLED = false;/);assert.match(html,/btn\.hidden = !\(AIM_REVERSE_ENABLED \|\| placeMode\)/);
 assert.match(html,/function aimReverseClear\(/,'逆算の処理は残す');
 assert.match(fs.readFileSync(new URL('./astronotes-flair.css',import.meta.url),'utf8'),/#aimLook \[data-look-pick\]\[hidden\]\{display:none!important\}/);
});
test('図は直接panでき、図内は撮影設定と中央復帰。大気差は通常画面（2026-10-22 最新指示）',()=>{
 assert.match(html,/center\.setAttribute\('aria-label','構図を中央に戻す'\)/);
 assert.match(html,/settings\.setAttribute\('aria-label','撮影設定'\)/);
 assert.doesNotMatch(html,/expand\.setAttribute\('aria-label','全画面で表示'\)/);
 assert.doesNotMatch(html,/content\.append\(airTitle,airControls\)/);
 assert.match(html,/cv\.style\.touchAction = "pan-y"/);
 assert.match(html,/gesture\.suppressClick/);
});
test('天体の位置調整と逆算入口を撤去し、Undoと残像を出さない（2026-10-22 最新指示）',()=>{
 assert.match(html,/const AIM_PLACE_ENABLED = false;/);
 assert.match(html,/<div class="aim-shift" id="aimShift" hidden>/);
 assert.match(html,/if \(!AIM_PLACE_ENABLED\) return;/);
 assert.doesNotMatch(html,/_pickUndo|data-look-undo/);
 assert.doesNotMatch(html,/ctx\.arc\(place\[0\], place\[1\]/);
 const finish=html.slice(html.indexOf('if (host._pick && placeMode)'),html.indexOf('if (host._pick) {',html.indexOf('if (host._pick && placeMode)')));
 assert.match(finish,/placeFromGhost\(editing\.ghost\)/);
 assert.doesNotMatch(finish,/aimLineSheetOpen/);
});
