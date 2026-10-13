import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const start=html.indexOf('async function renderPrivateEntry(');
const source=html.slice(start,html.indexOf('\nasync function renderAdmin()',start));
function fixture(load){
  const entry={children:[],replaceChildren(...v){this.children=v;},append(...v){this.children.push(...v);}};
  const account={open:true,close(){this.open=false;}};
  let calls=0,reauth=0,retries=0,opened=0;
  const c={auth:{token:'fixture-token'},privateEntrySeq:0,
    $:id=>id==='accountSheet'?account:entry,
    document:{createElement:tag=>({tag,style:{},setAttribute(){}})},
    ownerModule:async()=>{calls++;return load();},
    askReauth:()=>{reauth++;},openAccountSheet:()=>{retries++;},
    pushRoute:route=>{assert.equal(route,'#/admin');opened++;}};
  const render=runInNewContext(source+';renderPrivateEntry',c);
  return {c,entry,account,render,get calls(){return calls;},get reauth(){return reauth;},get retries(){return retries;},get opened(){return opened;}};
}
const fail=(code,status)=>()=>{throw Object.assign(new Error('private diagnostic'),{code,status});};
const f=fixture(fail('reauth_required',401));
await f.render({ownerAdmin:true});
assert.match(f.entry.children[0].textContent,/もう一度ログイン/);
assert.equal(f.entry.children[1].textContent,'ログインして管理者の画面を確認');
f.entry.children[1].onclick();assert.equal(f.reauth,1);assert.equal(f.retries,0);
const net=fixture(fail(undefined,503));await net.render({ownerAdmin:true});
assert.match(net.entry.children[0].textContent,/再試行/);
assert.doesNotMatch(net.entry.children[0].textContent,/private diagnostic/);
net.entry.children[1].onclick();assert.equal(net.retries,1);
const ordinary=fixture(fail('reauth_required',401));await ordinary.render({ownerAdmin:false,role:'admin'});
assert.equal(ordinary.calls,0);assert.equal(ordinary.entry.children.length,0);
const denied=fixture(fail(undefined,403));await denied.render({ownerAdmin:true});
assert.equal(denied.entry.children.length,1);assert.match(denied.entry.children[0].textContent,/権限/);
const success=fixture(()=>({entry:({open})=>({tag:'button',onclick:open,textContent:'管理者の画面をひらく'})}));
await success.render({ownerAdmin:true});success.entry.children[0].onclick();assert.equal(success.opened,1);assert.equal(success.account.open,false);
for(const change of ['token','closed','sequence']){
  let reject;const race=fixture(()=>new Promise((resolve,r)=>reject=r));
  const pending=race.render({ownerAdmin:true});
  if(change==='token')race.c.auth={token:'another-token'};
  if(change==='closed')race.account.open=false;
  if(change==='sequence')race.c.privateEntrySeq++;
  reject(Object.assign(new Error('old'),{code:'reauth_required'}));await pending;
  assert.equal(race.entry.children.length,0);
}
for(const change of ['token','closed','sequence']){
  const stale=fixture(fail('reauth_required',401));await stale.render({ownerAdmin:true});
  const oldButton=stale.entry.children[1];
  if(change==='token')stale.c.auth={token:'another-token'};
  if(change==='closed')stale.account.open=false;
  if(change==='sequence')stale.c.privateEntrySeq++;
  oldButton.onclick();assert.equal(stale.reauth,0);
}
console.log('ADMIN ENTRY OK: owner success, reauth, retry, non-owner, forbidden, late responses and stale actions');
