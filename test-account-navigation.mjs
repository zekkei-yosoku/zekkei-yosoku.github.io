import './tools/test-owner-adapter.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('const ACCOUNT_VIEWS ='),html.indexOf('for (const button of $("accountSheet").querySelectorAll'));
function fixture(){
 const elements=new Map();const $=id=>{if(!elements.has(id))elements.set(id,{dataset:{},hidden:false,textContent:'',setAttribute(k,v){this[k]=v;},focus(){context.focused=id;}});return elements.get(id);};
 const sections=['overview','passkeys','password','recovery','history','sessions'].map(view=>({dataset:{accountView:view},hidden:view!=='overview'}));
 const body={scrollTop:130};$('accountSheet').dataset.accountView='overview';$('accountSheet').querySelectorAll=()=>sections;
 $('accountSheet').querySelector=selector=>selector==='.sheet-body'?body:{focus(){context.focused=selector;}};
 $('recoveryShown').hidden=true;
 const context={$,shownCodes:['fixture-only'],confirm:()=>false};vm.createContext(context);vm.runInContext(source,context);
 return{$,context,sections,body};
}
test('details hide overview and unrelated forms; back restores opener and scroll',()=>{
 const f=fixture();f.context.showAccountView('password',true);
 assert.deepEqual(f.sections.filter(s=>!s.hidden).map(s=>s.dataset.accountView),['password']);assert.equal(f.$('accountBody').hidden,true);assert.equal(f.$('accountTitle').textContent,'パスワード');assert.equal(f.context.focused,'accountTitle');assert.equal(f.$('accountBack')['aria-label'],'アカウントへ戻る');
 f.context.showAccountView('overview',true);assert.equal(f.body.scrollTop,130);assert.match(f.context.focused,/password/);assert.equal(f.$('accountBody').hidden,false);assert.equal(f.$('accountBack')['aria-label'],'設定へ戻る');
});
test('declining to leave one-time codes keeps them visible; accepting removes their contents',()=>{
 const f=fixture();f.context.showAccountView('recovery');f.$('recoveryShown').hidden=false;f.$('recoveryCode').textContent='fixture-only';
 f.context.showAccountView('overview',true);assert.equal(f.$('accountSheet').dataset.accountView,'recovery');assert.equal(f.$('recoveryCode').textContent,'fixture-only');
 f.context.confirm=()=>true;f.context.showAccountView('overview',true);assert.equal(f.$('accountSheet').dataset.accountView,'overview');assert.equal(f.$('recoveryShown').hidden,true);assert.equal(f.$('recoveryCode').textContent,'');assert.equal(f.context.shownCodes.length,0);
});
test('invalid destinations safely return to account overview',()=>{const f=fixture();f.context.showAccountView('toString');assert.equal(f.$('accountSheet').dataset.accountView,'overview');});
const historySource=html.slice(html.indexOf('async function loadAccountHistory()'),html.indexOf('// 鍵を作らせて',html.indexOf('async function loadAccountHistory()')));
for(const change of ['owner','view','closed','newer request'])test(`history discards results after ${change}`,async()=>{
 const f=fixture(),c=f.context,p=f.$('accountSheet'),pending=[];p.open=true;p.dataset.loadId='1';p.dataset.accountView='history';
 c.auth={token:'old'};c.apiCall=()=>new Promise(resolve=>pending.push(resolve));c.esc=x=>String(x);c.accountFail=()=>assert.fail('stale failure must not render');vm.runInContext(historySource,c);
 const old=c.loadAccountHistory();
 if(change==='owner')c.auth={token:'new'};else if(change==='view')p.dataset.accountView='overview';else if(change==='closed')p.open=false;else{const current=c.loadAccountHistory();pending[1]({entries:[]});await current;}
 const before=f.$('loginHistoryList').innerHTML;pending[0]({entries:[{note:'stale-private-entry',success:true,method:'password',created_at:1}]});await old;assert.equal(f.$('loginHistoryList').innerHTML,before);
});
