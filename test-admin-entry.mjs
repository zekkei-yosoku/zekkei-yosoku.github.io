import './tools/test-owner-adapter.mjs';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import assert from 'node:assert/strict';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const start=html.indexOf('async function renderPrivateEntry(');
const source=html.slice(start,html.indexOf('\nasync function renderAdmin()',start));
// 2026-10-15 入口は設定一覧（右上のID→管理）。アカウント画面の奥から移した
assert.match(html,/ownerEntry\.id='settingsPrivateEntry';categories\.append\(ownerEntry\);/,'設定一覧に入口の受け皿がある');
assert.match(html,/const openSettings=opener=>\{[^}]*showSheet\(settings\);scrollLock\.on\(\);renderPrivateEntry\(\);\};/,'設定一覧を開くたびに入口を確かめる');
assert.ok(!/id="accountPrivateEntry"/.test(html),'アカウント画面の奥には入口を置かない');
// 2026-10-15 本番で非所有者の#/adminに「再試行」が出た。apiCallがHTTPの状態を渡しておらず、403の判定が当たらなかった
assert.match(html,/error\.code = data\?\.code; error\.status = res\.status; throw error;/,'通信の失敗に状態（403など）を持たせる');
{const s=html.indexOf('async function renderAdmin()');const body=html.slice(s,html.indexOf('\n}\n',s));assert.match(body,/if \(e\.status !== 403\) \{/,'権限が無いときは管理画面にも再試行を出さない');}
function fixture(load,{ownerAdmin=true,unknown=false,me}={}){
  const entry={children:[],replaceChildren(...v){this.children=v;},append(...v){this.children.push(...v);}};
  const settings={open:true,close(){this.open=false;}};
  let calls=0,reauth=0,opened=0,meCalls=0;
  const c={auth:{token:'fixture-token',...(unknown?{}:{ownerAdmin})},privateEntrySeq:0,
    $:id=>id==='appSettings'?settings:id==='settingsPrivateEntry'?entry:null,
    document:{createElement:tag=>({tag,style:{},setAttribute(){}})},
    apiCall:async(m,p)=>{assert.equal(p,'/me');meCalls++;return me();},
    ownerModule:async()=>{calls++;return load();},
    askReauth:()=>{reauth++;},
    pushRoute:route=>{assert.equal(route,'#/admin');opened++;}};
  const render=runInNewContext(source+';renderPrivateEntry',c);
  return {c,entry,settings,render,get calls(){return calls;},get reauth(){return reauth;},get opened(){return opened;},get meCalls(){return meCalls;}};
}
const fail=(code,status)=>()=>{throw Object.assign(new Error('private diagnostic'),{code,status});};
const f=fixture(fail('reauth_required',401));
await f.render();
assert.match(f.entry.children[0].textContent,/もう一度ログイン/);
assert.equal(f.entry.children[1].textContent,'ログインして管理者の画面を確認');
f.entry.children[1].onclick();assert.equal(f.reauth,1);assert.equal(f.calls,1);
const net=fixture(fail(undefined,503));await net.render();
assert.match(net.entry.children[0].textContent,/再試行/);
assert.doesNotMatch(net.entry.children[0].textContent,/private diagnostic/);
await net.entry.children[1].onclick();assert.equal(net.calls,2,'再試行は入口をもう一度確かめる');
const ordinary=fixture(fail('reauth_required',401),{ownerAdmin:false});await ordinary.render();
assert.equal(ordinary.calls,0);assert.equal(ordinary.entry.children.length,0);
const denied=fixture(fail(undefined,403));await denied.render();
assert.equal(denied.entry.children.length,1);assert.match(denied.entry.children[0].textContent,/権限/);
const success=fixture(()=>({entry:({open})=>({tag:'button',onclick:open,textContent:'管理'})}));
await success.render();success.entry.children[0].onclick();assert.equal(success.opened,1);assert.equal(success.settings.open,false);
// ログイン直後でまだ所有者か知らないときは /me で確かめる。取れなければ入口も警告も出さない
const unknownOwner=fixture(()=>({entry:()=>({tag:'button'})}),{unknown:true,me:()=>({ownerAdmin:true})});
await unknownOwner.render();assert.equal(unknownOwner.meCalls,1);assert.equal(unknownOwner.calls,1);assert.equal(unknownOwner.c.auth.ownerAdmin,true);assert.equal(unknownOwner.entry.children.length,1);
const unknownOrdinary=fixture(fail('reauth_required',401),{unknown:true,me:()=>({ownerAdmin:false})});
await unknownOrdinary.render();assert.equal(unknownOrdinary.calls,0);assert.equal(unknownOrdinary.entry.children.length,0);
const unknownOffline=fixture(fail('reauth_required',401),{unknown:true,me:()=>{throw new Error('offline');}});
await unknownOffline.render();assert.equal(unknownOffline.calls,0);assert.equal(unknownOffline.entry.children.length,0);
const loggedOut=fixture(fail('reauth_required',401));loggedOut.c.auth=null;await loggedOut.render();
assert.equal(loggedOut.calls,0);assert.equal(loggedOut.entry.children.length,0);
for(const change of ['token','closed','sequence']){
  let reject;const race=fixture(()=>new Promise((resolve,r)=>reject=r));
  const pending=race.render();
  if(change==='token')race.c.auth={token:'another-token',ownerAdmin:true};
  if(change==='closed')race.settings.open=false;
  if(change==='sequence')race.c.privateEntrySeq++;
  reject(Object.assign(new Error('old'),{code:'reauth_required'}));await pending;
  assert.equal(race.entry.children.length,0);
}
for(const change of ['token','closed','sequence']){
  const stale=fixture(fail('reauth_required',401));await stale.render();
  const oldButton=stale.entry.children[1];
  if(change==='token')stale.c.auth={token:'another-token',ownerAdmin:true};
  if(change==='closed')stale.settings.open=false;
  if(change==='sequence')stale.c.privateEntrySeq++;
  oldButton.onclick();assert.equal(stale.reauth,0);
}
console.log('ADMIN ENTRY OK: settings-list entry, owner success, reauth, retry, non-owner, unknown owner via /me, forbidden, late responses and stale actions');
