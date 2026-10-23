import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('./trial/index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function keepNotebookPlan('),html.indexOf('function initPlanSharing()'));
test('trial予定保存は開いた時のowner/世代/権限を固定し、切替後の保存を拒否する',()=>{
 let writes=0,rendered=0,record;
 const c=vm.createContext({auth:{token:'synthetic',loginId:'a'},authGeneration:1,toolAllowed:()=>true,schedule:()=>({add:r=>{writes++;record=r;return {ok:true};}}),renderNotebook:()=>rendered++});vm.runInContext(source,c);
 const cur={saveOwner:{generation:1,loginId:'a'},payload:{at:123,l:{focal:400}}},event={title:'計画',start:100,end:200};
 assert.equal(c.keepNotebookPlan(cur,event).ok,true);assert.equal(record.value,cur.payload);assert.equal(writes,1);assert.equal(rendered,1);
 for(const change of [()=>c.authGeneration++,()=>c.auth={token:'synthetic-b',loginId:'b'},()=>c.toolAllowed=()=>false,()=>c.auth=null]){c.auth={token:'synthetic',loginId:'a'};c.authGeneration=1;c.toolAllowed=()=>true;change();assert.equal(c.keepNotebookPlan(cur,event).ok,false);assert.equal(writes,1);assert.equal(rendered,1);}
});
test('保存失敗の結果をUIへ返し、成功へ偽装しない',()=>{
 const c=vm.createContext({auth:{token:'synthetic',loginId:'a'},authGeneration:1,toolAllowed:()=>true,schedule:()=>({add:()=>({ok:false})}),renderNotebook(){}});vm.runInContext(source,c);assert.equal(c.keepNotebookPlan({saveOwner:{generation:1,loginId:'a'},payload:{}},{title:'x',start:1,end:2}).ok,false);
});
