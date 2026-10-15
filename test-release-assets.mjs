// 公開する画面（本体と trial）が読む自前の資産は、全部 Git に入っていること（2026-10-15 総点検M06）。
// 2026-10-15、trial の sorami-assets.js が未追跡のまま公開され、trial の構図・地図が形状を読めなくなりかけた
// （手元には生成物があるので画面の確認では気づけない）。**新しく作ったファイルは git add してから回す。**
import {readFileSync as read,existsSync as exists} from 'node:fs';import {execFileSync} from 'node:child_process';import {fileURLToPath} from 'node:url';import assert from 'node:assert/strict';
// どこから走らせても、このファイルのある公開元を見る
const root=fileURLToPath(new URL('./',import.meta.url));
const readFileSync=(f,e)=>read(root+f,e),existsSync=f=>exists(root+f);
const tracked=new Set(execFileSync('git',['-C',root,'ls-files','--cached'],{encoding:'utf8'}).split('\n').filter(Boolean));
const local=u=>!/^(?:[a-z]+:|\/\/|#|\$\{|data:)/i.test(u);
let checked=0;
for(const dir of ['','trial/']){
 const html=readFileSync(dir+'index.html','utf8');
 const refs=new Set();
 for(const [,u] of html.matchAll(/(?:src|href|content)="([A-Za-z0-9_./-]+\.(?:js|css|png|svg|json|webmanifest))(?:\?[^"]*)?"/g))if(local(u))refs.add(u);
 for(const [,u] of html.matchAll(/["'`]((?:data|vendor)\/[A-Za-z0-9_./-]+\.(?:json|js|bin))["'`]/g))refs.add(u);
 const manifest=JSON.parse(readFileSync(dir+'manifest.json','utf8'));
 for(const icon of manifest.icons||[])refs.add(icon.src.replace(/\?.*$/,''));
 // 画面が読む自前の JS の中から参照するもの（天体の計算の vendor など）
 for(const u of [...refs].filter(u=>u.endsWith('.js')&&existsSync(dir+u))){
  for(const [,v] of readFileSync(dir+u,'utf8').matchAll(/["'`]((?:data|vendor)\/[A-Za-z0-9_./-]+\.(?:json|js|bin))["'`]/g))refs.add(v);
 }
 assert.ok(refs.size>30,`${dir||'本体'}の参照を読めている（${refs.size}件）`);
 for(const u of refs){
  assert.ok(existsSync(dir+u),`${dir+u} が無い`);
  assert.ok(tracked.has(dir+u),`${dir+u} が Git に入っていない（git add してから公開する）`);
  checked++;
 }
}
console.log(`RELEASE ASSETS OK: ${checked} runtime references exist and are tracked (root + trial)`);
