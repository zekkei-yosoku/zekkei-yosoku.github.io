import {sourceHtml} from './tools/test-source.mjs';
import './tools/test-owner-adapter.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const html=sourceHtml();
const source=html.slice(html.indexOf('function clearRetiredStorage('),html.indexOf('$("enablePw").onclick'));
function setup(answers,{fail=false,change=false}={}){
 const elements=new Map(),calls=[],messages=[],data=new Map();
 const prefixes=['sorami.observations.v1:','sorami.placeShapes.v1:','sorami.schedule.v1:','sorami.recordSync.v1:','sorami.skyMap:'];
 for(const p of prefixes){data.set(p+'test_user','private');data.set(p+'someone_else','other');}
 const el=id=>{if(!elements.has(id))elements.set(id,{close(){calls.push('close')}});return elements.get(id);};
 const ctx={auth:{loginId:'test_user',token:'session'},$:el,confirm:text=>{messages.push(text);return answers.shift();},
  localStorage:{removeItem:k=>data.delete(k)},apiCall:async(m,p)=>{calls.push([m,p]);if(fail)throw Error('通信に失敗しました');if(change)ctx.auth={loginId:'someone_else',token:'other'};},
  clearAuth:()=>{calls.push('clear');ctx.auth=null;},clearAdminView:()=>{},store:{set:()=>{}},renderAuthButton:()=>{},render:()=>{},accountFail:e=>messages.push(e),alert:e=>messages.push(e)};
 vm.runInNewContext(source,ctx);
 return{run:()=>el('deleteAccount').onclick(),calls,messages,data,prefixes,ctx};
}
for(const answers of [[false],[true,false]])test('cancel '+JSON.stringify(answers)+' sends no deletion and leaves local copies',async()=>{
 const h=setup([...answers]);await h.run();assert.deepEqual(h.calls,[]);assert.equal(h.data.size,10);
});
test('confirmed deletion uses requested short wording, clears only retired ID local records',async()=>{
 const h=setup([true,true]);await h.run();assert.match(h.messages[0],/^アカウントに紐づくすべてのデータを削除します。/);
 assert.deepEqual(h.calls,[['DELETE','/me'],'clear','close']);
 for(const p of h.prefixes){assert.equal(h.data.has(p+'test_user'),false);assert.equal(h.data.get(p+'someone_else'),'other');}
});
test('server deletion failure retains auth/local data and displays the error',async()=>{
 const h=setup([true,true],{fail:true});await h.run();assert.equal(h.data.size,10);assert.equal(h.ctx.auth.loginId,'test_user');assert.match(h.messages.at(-1),/通信に失敗/);
});
test('completion of old account deletion does not log out a newly signed-in account',async()=>{
 const h=setup([true,true],{change:true});await h.run();assert.equal(h.ctx.auth.loginId,'someone_else');assert.equal(h.calls.includes('clear'),false);
 for(const p of h.prefixes)assert.equal(h.data.get(p+'someone_else'),'other');
});
