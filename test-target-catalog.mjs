import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const L=createRequire(import.meta.url)('./sorami-library.js');
function catalog(rows){return {targetNameKey:L.nameKey,matchingTargetNames:(name,id)=>L.matchingNames(rows,name,id)};}
test('同名判定は全角英数・空白・大小文字を揃え、別名を混ぜない',()=>{
 const api=catalog([{id:'fav:a',name:'ＡＢＣ 塔'},{id:'fav:b',name:'abc塔'},{id:'other',name:'別の塔'},{id:'custom',name:'ABC塔'}]);
 assert.deepEqual(api.matchingTargetNames(' abc　塔 ').map(t=>t.id),['fav:a','fav:b']);assert.deepEqual(api.matchingTargetNames(''),[]);assert.deepEqual(api.matchingTargetNames('abc塔','fav:a').map(t=>t.id),['fav:b']);
});
test('対象の照合は現在のユーザーの一覧を都度読み、別地点の同名も確認候補へ残す',()=>{
 const rows=[{id:'fav:a',name:'展望塔',latitude:35,longitude:139},{id:'fav:b',name:'展望塔',latitude:40,longitude:140}];const api=catalog(rows);
 assert.equal(api.matchingTargetNames('展望塔').length,2);rows.splice(0,2,{id:'fav:other-user',name:'他ユーザーの対象'});assert.equal(api.matchingTargetNames('展望塔').length,0);
});
