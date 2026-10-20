import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
// 2026-10-21 ユーザー「記録の見えたもの・線や範囲・予定もサーバー同期してアカウントに紐づけて」
// 通しの確認（2台の端末・隔離API）は scratchpad の tools/recsync.cjs。ここでは組み込みが外れていないことを見る
test('記録（見えたもの・線や範囲・予定）を同期の送受信に入れている',()=>{
 const h=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8'),m=fs.readFileSync(new URL('./sorami-myplaces.js',import.meta.url),'utf8');
 assert.match(h,/const RecordSync = \(\(\) => \{/);
 for(const k of ['obs','shape','plan'])assert.match(h,new RegExp(`\\n    ${k}: \\{ key:`),'種類 '+k);
 assert.match(h,/records: recs\.map\(\(\{ sent, \.\.\.r \}\) => r\)/,'送る');
 assert.match(h,/RecordSync\.apply\(got\.records\)/,'受け取る');
 assert.match(h,/syncInfo\.records === 1 \? \(syncInfo\.rev \|\| 0\) : 0/,'初めては最初から取り直す');
 assert.match(h,/store\.set = \(key, value\) => \{ const ok = write\(key, value\); if \(ok\) RecordSync\.touched\(key\)/,'保存したら送る');
 assert.match(m,/addEventListener\('sorami:records-synced'/,'届いたら記録の画面を描き直す');
 assert.match(m,/RecordSync\.kick\(\)/,'記録の一括保存のあとも送る');
 assert.doesNotMatch(m+fs.readFileSync(new URL('./sorami-schedule.js',import.meta.url),'utf8'),/APIは未対応|同期はしない/,'古い説明を残さない');
});
