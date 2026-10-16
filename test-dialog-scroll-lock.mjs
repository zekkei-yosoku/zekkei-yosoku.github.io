import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
test('後から追加したdialogと入れ子も背景を固定し、最後を閉じるまで位置を戻さない',()=>{
 let openCount=0,observer,options;const restores=[],style={removeProperty(k){delete this[k];}};
 const c={document:{body:{style},querySelector:()=>openCount?{}:null},window:{scrollY:420,scrollTo:(x,y)=>restores.push([x,y])},MutationObserver:class{constructor(fn){observer=fn}observe(root,opts){options=opts;}}};
 const start=html.indexOf('const scrollLock ='),end=html.indexOf('\n\nrenderAuthButton();',start);vm.runInNewContext(html.slice(start,end),c);
 assert.equal(options.subtree,true);assert.equal(options.childList,true);assert.ok(options.attributeFilter.includes('open'));
 openCount=1;observer();assert.equal(style.position,'fixed');assert.equal(style.top,'-420px');
 openCount=2;observer();openCount=1;observer();assert.equal(style.position,'fixed');assert.equal(restores.length,0);
 openCount=0;observer();assert.equal(style.position,undefined);assert.deepEqual(restores,[[0,420]]);observer();assert.equal(restores.length,1);
 openCount=1;observer();openCount=0;observer();assert.equal(restores.length,2);
});
