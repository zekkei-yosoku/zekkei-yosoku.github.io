import {sourceHtml} from './tools/test-source.mjs';
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
// 2026-10-21 ユーザー「月の軌道がズレるようになった」：置いた位置の点線円のための再描画（aimShiftSync）が前の日の図を描き直し、
// 押した候補日の時刻（plannerTransfer）を前の時刻で上書きして、図の線と天体が別の時刻になっていた
test('構図：図の描き直しは、自分が受け取った引き継ぎ時刻だけを書き戻す',()=>{
 const h=sourceHtml();
 assert.doesNotMatch(h,/aim\.plannerTransfer\.at\s*=/,'今の plannerTransfer を無条件に書き換えない');
 assert.match(h,/const transfer=host\.id==='aimLook'\?aim\.plannerTransfer:null;/);
 assert.match(h,/if\(host\.id==='aimLook'&&transfer&&aim\.plannerTransfer===transfer\)transfer\.at=p\.at;/);
});
// 2026-10-21 総点検：同じ型の上書き（比べる時刻）、置いた位置の持ち越し、英語の通信失敗文、表記の揺れ
test('総点検で直したところが戻っていない',()=>{
 const h=sourceHtml(),d=fs.readFileSync(new URL('./astronotes-almanac-dashboard.js',import.meta.url),'utf8');
 assert.doesNotMatch(h,/if\(aimAirCompare\)aimAirCompare\.at=p\.at;/,'比べる時刻を別の日の図が書き戻さない');
 assert.match(h,/function aimShiftCheck\(\)/,'置いた位置は目標・天体を替えたら消す');
 assert.match(h,/通信できませんでした。電波の状態を確かめて、もう一度お試しください/,'電波が切れたときの英語の失敗文を出さない');
 assert.doesNotMatch(h+d,/日の入り'|月の入り'|照明率|輝面比/,'表記は 日の入・月の入・輝面');
 assert.doesNotMatch(d,/スライダー/,'無くなった部品の名前を書かない');
});
