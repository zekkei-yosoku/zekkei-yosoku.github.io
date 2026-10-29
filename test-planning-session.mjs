// 探すの見え方job（src/domain/planning/session.js）が旧exploreの snapshot/stamp と epoch/frameKey/frameBase/pendingKey の遷移を変えないこと（2026-10-29 構造整理）。
import {createRequire} from 'node:module';import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);
const {create}=require('./src/domain/planning/session.js');
const DAY=86400000,JST=32400000;
const dayStart=at=>Math.floor((at+JST)/DAY)*DAY-JST;

function env(){
 const e={gen:1,air:'standard',atm:'atm-v1',hooks:[],clones:0,
  state:{body:'moon',target:{id:'fuji',name:'富士山',parts:[{id:'top'}]},observer:{name:'A',latitude:35.1,longitude:138.7,groundManualM:12},ground:10,eyeM:1.5,partId:'top',limb:'center',matchMode:'overlap',at:Date.UTC(2026,9,29,9)}};
 e.deps={readRenderState:()=>e.state,clone:v=>{e.clones++;return structuredClone(v);},getAuthGeneration:()=>e.gen,dayStart,getAirMode:()=>e.air,getAtmosphereKey:()=>e.atm};
 return e;
}
// 旧exploreの該当部分をそのまま写した基準
function legacy(e){
 let epoch=0,frameKey='',frameBase='',pendingKey='';
 const snapshot=()=>structuredClone(e.state);
 const stamp=s=>JSON.stringify([e.gen,s.body,s.target,s.observer,s.ground,s.eyeM,s.partId,s.limb,s.matchMode,dayStart(s.at),e.air,e.atm]);
 const baseStamp=s=>JSON.stringify([e.gen,s.body,s.target,s.observer,s.ground,s.eyeM,s.partId,s.limb,s.matchMode,e.air]);
 const invalidate=()=>{epoch++;frameKey='';frameBase='';pendingKey='';};
 return {snapshot,stamp,baseStamp,invalidate,
  begin(key,soft){const keepBase=frameBase;invalidate();if(soft)frameBase=keepBase;const run=epoch;pendingKey=key;return run;},
  current:run=>run===epoch,matches:key=>stamp(snapshot())===key,
  commit(key,s){frameKey=key;frameBase=baseStamp(s);},
  settle(run){if(run===epoch){pendingKey='';return true;}return false;},
  forgetFrame(){frameKey='';},
  get state(){return {epoch,frameKey,frameBase,pendingKey};}};
}
const view=p=>({epoch:p.epoch,frameKey:p.frameKey,frameBase:p.frameBase,pendingKey:p.pendingKey});

// cache key: フィールド・並び・undefined→null が旧と同じ
{
 const e=env(),p=create(e.deps),old=legacy(e);
 for(const mutate of [()=>{},()=>{e.atm=undefined;},()=>{e.state.matchMode=undefined;e.state.ground=undefined;},()=>{e.air='off';e.state.body='sun';},()=>{e.state.at+=DAY;}]){
  mutate();const s=p.snapshot();
  assert.equal(p.stamp(s),old.stamp(s),'stampが旧と同じ');assert.equal(p.baseStamp(s),old.baseStamp(s),'baseStampが旧と同じ');
 }
 e.atm=undefined;const a=JSON.parse(p.stamp(p.snapshot()));assert.equal(a.length,12);assert.equal(a[11],null,'dataKey未定義はnull');
 assert.equal(JSON.parse(p.baseStamp(p.snapshot())).length,10);
}

// snapshotはstructuredCloneで、後のsession変更から隔離される
{
 const e=env(),p=create(e.deps),s=p.snapshot();
 assert.equal(e.clones,1);assert.notEqual(s,e.state);assert.notEqual(s.target,e.state.target);
 e.state.target.name='変更';e.state.observer.latitude=0;
 assert.equal(s.target.name,'富士山');assert.equal(s.observer.latitude,35.1);
}

// 旧exploreと同じ操作列で状態が一致する
{
 const e=env(),p=create(e.deps),old=legacy(e),both=f=>{const r=[f(p),f(old)];assert.deepEqual(view(p),old.state);return r;};
 const s0=p.snapshot(),k0=p.stamp(s0);
 const [r1,o1]=both(x=>x.begin(k0,false));assert.equal(r1,o1);
 both(x=>x.commit(k0,s0));both(x=>x.settle(r1));
 e.state.at+=DAY;const s1=p.snapshot(),k1=p.stamp(s1);
 const soft=!!p.frameBase&&p.frameBase===p.baseStamp(s1);assert.ok(soft,'日付だけの変化はsoft対象');
 const [r2]=both(x=>x.begin(k1,soft));assert.equal(p.frameBase,p.baseStamp(s0),'softはframeBaseを保持');assert.equal(p.frameKey,'');
 const [r3]=both(x=>x.begin(k1,false));assert.equal(p.frameBase,'','softでなければframeBaseを消す');
 both(x=>x.settle(r2));assert.equal(p.pendingKey,k1,'古いfinallyはpendingKeyを消さない');
 both(x=>x.settle(r3));both(x=>x.invalidate());both(x=>x.forgetFrame());
 both(x=>x.commit(k1,s1));both(x=>x.forgetFrame());assert.equal(p.frameBase,p.baseStamp(s1),'forgetFrameはframeKeyだけ消す');
}

// request競合: 後発jobだけが受理され、古いjobはfinallyも無視される
{
 const e=env(),p=create(e.deps),k=p.stamp(p.snapshot());
 const a=p.begin(k,false),b=p.begin(k,false);
 assert.equal(p.current(a),false);assert.equal(p.current(b),true);
 assert.equal(p.settle(a),false);assert.equal(p.pendingKey,k);
 assert.equal(p.settle(b),true);assert.equal(p.pendingKey,'');
}

// 同じkeyの抑制はpendingKeyで判定できる。同日の時刻変化はkey不変、日付変化はkey変化
{
 const e=env(),p=create(e.deps),k=p.stamp(p.snapshot());p.begin(k,false);
 assert.equal(p.pendingKey===k,true,'同じjobはpendingKeyで抑制');
 e.state.at+=3600000;assert.equal(p.stamp(p.snapshot()),k,'同日の時刻変化は同じkey');assert.equal(p.matches(k),true);
 e.state.at+=DAY;assert.notEqual(p.stamp(p.snapshot()),k,'日付変化は別key');assert.equal(p.matches(k),false);
}

// owner generationや条件が変わったjobは受理しない
{
 const e=env(),p=create(e.deps),k=p.stamp(p.snapshot());p.begin(k,false);
 e.gen=2;assert.equal(p.matches(k),false,'generation変化は不受理');e.gen=1;assert.equal(p.matches(k),true);
 e.state.limb='top';assert.equal(p.matches(k),false,'条件変化は不受理');
 e.state.limb='center';e.air='off';assert.equal(p.matches(k),false,'大気mode変化は不受理');
}

// invalidate: 全てを消してepochを進め、host処理はstate消去の後に呼ぶ
{
 const e=env(),seen=[];let p;
 p=create({...e.deps,onInvalidate:()=>seen.push(view(p))});
 const s=p.snapshot(),k=p.stamp(s),run=p.begin(k,false);p.commit(k,s);
 assert.equal(seen.length,1);
 p.invalidate();
 assert.deepEqual(seen[1],{epoch:run+1,frameKey:'',frameBase:'',pendingKey:''});
 assert.equal(p.current(run),false);assert.equal(p.settle(run),false);
 const soft=p.begin(k,true);assert.equal(seen.length,3);assert.equal(p.current(soft),true);
}
console.log('planning session ok');
