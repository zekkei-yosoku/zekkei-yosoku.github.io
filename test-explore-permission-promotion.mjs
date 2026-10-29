import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const js=fs.readFileSync(new URL('./astronotes-explore.js',import.meta.url),'utf8'),code=js.slice(js.indexOf('function render(){'),js.indexOf('function sceneDraw('));
function fixture(){
 let resolve,models=0,opened=0,entered=0,synced=0;
 const plan={at:1793358900123.5,pan:[.0625,-.125]},c={allowed:false,atAim:true,atSkyMap:false,routing:false,transferMode:null,mode:'scene',authGeneration:1,auth:null,location:{hash:'#/aim?plan=synthetic'},aim:{pendingPlan:plan},aimView:{hidden:true},eligible:()=>c.allowed,menu(){},layout:{mount(){},unmount(){}},renderAimAccess(){},sync:()=>synced++,routeFromHash:()=>({aim:true}),AstroNotesAssets:{ensureModels:()=>{models++;return new Promise(r=>resolve=r)}},openAim:()=>{opened++;c.aim.pendingPlan=null;},SkyMapUI:{enter:(fromAim,at)=>{entered++;assert.equal(fromAim,true);assert.equal(at,plan.at);assert.equal(c.aim.pendingPlan,plan);c.atAim=false;c.atSkyMap=true;c.routeChanged();}}};
 vm.createContext(c);vm.runInContext(code,c);return {c,plan,resolve:()=>resolve(),stats:()=>({models,opened,entered,synced})};
}
test('ログインや権限到着の共通renderで一度だけ探すへ切り替え、共有条件を保つ',async()=>{
 const f=fixture();f.c.render();assert.equal(f.stats().models,0);f.c.allowed=true;f.c.auth={token:'synthetic'};f.c.render();f.c.render();f.c.routeChanged();assert.equal(f.stats().models,1);
 f.c.aim.pendingPlan=null;f.resolve();await new Promise(r=>setImmediate(r));assert.equal(f.stats().opened,1);assert.equal(f.stats().entered,1);assert.equal(f.c.aim.pendingPlan,f.plan);assert(f.stats().synced>0);f.c.render();assert.equal(f.stats().entered,1);
});
test('形状読込中にアカウント/権限/ルートが変わったら古い画面へ移さない',async()=>{
 for(const mutate of [c=>c.auth={token:'other',loginId:'other-account'},c=>c.authGeneration++,c=>c.allowed=false,c=>c.location.hash='#/records']){
  const f=fixture();f.c.allowed=true;f.c.auth={token:'synthetic',loginId:'fixture'};f.c.render();mutate(f.c);f.resolve();await new Promise(r=>setImmediate(r));assert.equal(f.stats().entered,0);assert.equal(f.stats().opened,0);assert.equal(f.c.routing,false);
 }
});
test('同じアカウントのセッション更新では共有復元を中断しない',async()=>{
 const f=fixture();f.c.allowed=true;f.c.auth={token:'before',loginId:'fixture'};f.c.render();f.c.auth={token:'renewed',loginId:'fixture'};f.resolve();await new Promise(r=>setImmediate(r));assert.equal(f.stats().entered,1);
});
