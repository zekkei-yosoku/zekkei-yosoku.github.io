import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const start=html.indexOf('function removeFavorite('),end=html.indexOf('// お気に入りはアカウント',start);
function fixture(fail=false){
 const writes=[],queued=[],c={favorites:[{id:'one'},{id:'two'}],favUndo:[],saveFavorites:()=>{writes.push(JSON.stringify(c.favorites));return !fail;},queuePush:(...args)=>queued.push(args),renderFavToggle(){},renderSheet(){}};
 vm.createContext(c);vm.runInContext(html.slice(start,end),c);return {c,writes,queued};
}
test('a favorite already deleted by synchronization never removes an unrelated row',()=>{
 for(const index of [-1,2,NaN,undefined,.5]){const {c,writes,queued}=fixture();assert.equal(c.removeFavorite(index),true);assert.deepEqual(c.favorites.map(r=>r.id),['one','two']);assert.equal(writes.length,0);assert.equal(queued.length,0);assert.equal(c.favUndo.length,0);}
});
test('valid removal preserves queued identity and undo; storage failure restores the row',()=>{
 const {c,queued}=fixture();assert.equal(c.removeFavorite(0),true);assert.deepEqual(c.favorites.map(r=>r.id),['two']);assert.deepEqual(queued,[['fav','one']]);assert.equal(c.favUndo[0].entry.id,'one');assert.equal(c.favUndo[0].index,0);
 const failed=fixture(true);assert.equal(failed.c.removeFavorite(0),false);assert.deepEqual(failed.c.favorites.map(r=>r.id),['one','two']);assert.equal(failed.queued.length,0);assert.equal(failed.c.favUndo.length,0);
});
