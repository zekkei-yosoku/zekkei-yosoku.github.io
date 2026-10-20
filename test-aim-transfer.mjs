import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
// 2026-10-21 ユーザー「月の軌道がズレるようになった」：置いた位置の点線円のための再描画（aimShiftSync）が前の日の図を描き直し、
// 押した候補日の時刻（plannerTransfer）を前の時刻で上書きして、図の線と天体が別の時刻になっていた
test('構図：図の描き直しは、自分が受け取った引き継ぎ時刻だけを書き戻す',()=>{
 const h=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
 assert.doesNotMatch(h,/aim\.plannerTransfer\.at\s*=/,'今の plannerTransfer を無条件に書き換えない');
 assert.match(h,/const transfer=host\.id==='aimLook'\?aim\.plannerTransfer:null;/);
 assert.match(h,/if\(host\.id==='aimLook'&&transfer&&aim\.plannerTransfer===transfer\)transfer\.at=p\.at;/);
});
