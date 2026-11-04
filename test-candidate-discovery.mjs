import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url),D=require('./experiments/candidate-visibility/search.js');
const at=Date.parse('2026-11-04T12:00:00+09:00');
const feature={sourceId:'sidewalk',polygonId:'p',function:'2000',coordinatesLonLatHeight:[[139,35,0],[139.0002,35,0],[139.0002,35.0002,0],[139,35.0002,0],[139,35,0]],groundKnown:false,standingSurfaceKnown:false,accessKnown:false};
const data={version:'1',features:[feature],visibilityCertified:false},plan={owner:'synthetic',target:{id:'skytree',parts:[{m:636}]},body:'moon',at};
test('歩道の形状から未知の位置を生成し、車道と地名の固定一覧を使わない',()=>{
 const r=D.sampleSidewalks(data);assert(r.rows.length>2);assert(r.rows.every(p=>p.latitude>=35&&p.latitude<=35.0002&&p.longitude>=139&&p.longitude<=139.0002));
 assert.equal(D.sampleSidewalks({...data,features:[{...feature,function:'1000'}]}).rows.length,0);
 assert.equal(D.sampleSidewalks(data,1).limited,true);
});
test('実168歩道面の0mを地面と信じず、新規位置は推薦しない',async()=>{
 const actual=JSON.parse(readFileSync(new URL('./experiments/candidate-visibility/sidewalks.json',import.meta.url)));assert.equal(actual.features.length,168);
 let evaluated=0;const engine=D.create({loadData:async()=>actual,evaluate:async()=>{evaluated++;return {status:'verified',recommend:true};},yieldTask:async()=>{}});
 const r=await engine.search(plan);assert(r.counts.sampled>100);assert.equal(r.counts.unknown,r.counts.sampled);assert.equal(evaluated,0);assert.deepEqual(r.rows,[]);
});
test('情報不足でも登録済み候補の計算・保存先に触れない',async()=>{
 const original=JSON.stringify(data);const engine=D.create({loadData:async()=>data,evaluate:async()=>assert.fail('unknown must skip evaluation')});
 const r=await engine.search(plan);assert.equal(r.rows.length,0);assert.equal(JSON.stringify(data),original);
});
test('同じ条件の重複起動は1計算にまとめ、再表示はキャッシュ',async()=>{
 let n=0;const ready={...data,features:[{...feature,groundKnown:true,standingSurfaceKnown:true,accessKnown:true}]};
 const engine=D.create({loadData:async()=>ready,evaluate:async()=>{n++;await new Promise(r=>setTimeout(r,1));return {status:'unknown'};}});
 const [a,b]=await Promise.all([engine.search(plan),engine.search(plan)]);assert.equal(n,a.counts.sampled);assert.deepEqual(a.counts,b.counts);
 assert.equal((await engine.search(plan)).cached,true);assert.equal(n,a.counts.sampled);
});
test('日付・対象高さ・天体・大気・所有者・データ更新を別キーにする',()=>{
 const key=D.keyFor(plan,'1','standard');
 for(const p of [{...plan,at:at+86400000},{...plan,target:{...plan.target,parts:[{m:352}]}},{...plan,body:'sun'},{...plan,owner:'other'}])assert.notEqual(D.keyFor(p,'1','standard'),key);
 assert.notEqual(D.keyFor(plan,'2','standard'),key);assert.notEqual(D.keyFor(plan,'1','forecast'),key);
});
test('閉じた画面の古いjobを完了キャッシュに残さない',async()=>{
 let current=true,yields=0;const engine=D.create({loadData:async()=>data,evaluate:async()=>({}),yieldTask:async()=>{yields++;current=false;}});
 assert.equal((await engine.search(plan,{isCurrent:()=>current})).cancelled,true);
 current=true;const r=await engine.search(plan,{isCurrent:()=>current});assert.equal(r.cancelled,true);assert.equal(yields,2);
});
test('取得失敗は完成結果へ入れず、再試行できる',async()=>{
 let n=0;const engine=D.create({loadData:async()=>{if(++n===1)throw Error('offline');return data;},evaluate:async()=>({})});
 await assert.rejects(engine.search(plan),/offline/);assert.equal((await engine.search(plan)).cached,false);assert.equal(n,2);
});
test('未知とblockを推薦せず、データ全体の証明なしならverified自己申告も通さない',async()=>{
 const ready={...data,features:[{...feature,groundKnown:true,standingSurfaceKnown:true,accessKnown:true}]};
 for(const status of ['unknown','blocked','verified']){
  const engine=D.create({loadData:async()=>ready,evaluate:async()=>({status,recommend:true,event:{at}})});
  assert.equal((await engine.search(plan)).rows.length,0);
 }
});
test('別日のeventは候補へ出さない（合成の認定済みデータで境界検査）',async()=>{
 const ready={...data,visibilityCertified:true,features:[{...feature,groundKnown:true,standingSurfaceKnown:true,accessKnown:true}]};
 const engine=D.create({loadData:async()=>ready,evaluate:async()=>({status:'verified',recommend:true,event:{at:at+86400000}})});
 assert.equal((await engine.search(plan)).rows.length,0);
});
test('本番HTMLへ試用の検索を読ませない、trialだけが単一の見え方を使う',()=>{
 const root=readFileSync(new URL('./index.html',import.meta.url),'utf8'),trial=readFileSync(new URL('./trial/index.html',import.meta.url),'utf8');
 assert(!root.includes('astronotes-candidate-search.js'));assert(!root.includes('astronotes-explore-simple.js'));
 assert(trial.includes('astronotes-candidate-search.js'));assert(trial.includes('astronotes-explore-simple.js'));
 const code=readFileSync(new URL('./trial/astronotes-explore-simple.js',import.meta.url),'utf8');assert(code.includes("mode='scene';\n tabs.hidden=true"));
});
test('未知地点の診断を実行してもverified自己申告を推薦へ昇格させない',async()=>{const d={version:1,visibilityCertified:true,features:[{function:'2000',coordinatesLonLatHeight:[[139,35,0],[139.0001,35,0],[139.0001,35.0001,0],[139,35.0001,0],[139,35,0]]}]};let calls=0;const engine=D.create({loadData:async()=>d,diagnoseUnknown:true,evaluate:async()=>{calls++;return {status:'verified',recommend:true,event:{at:0}}},yieldTask:async()=>{}});const r=await engine.search({at:0});assert(calls>0);assert.equal(r.rows.length,0);});
test('評価待ちの取消しを完成cacheへ入れず、再検索で再計算する',async()=>{const d={version:1,features:[{function:'2000',coordinatesLonLatHeight:[[139,35,0],[139.0001,35,0],[139.0001,35.0001,0],[139,35.0001,0],[139,35,0]]}]};let resolve,started,calls=0,current=true;const ready=new Promise(r=>started=r);const engine=D.create({loadData:async()=>d,diagnoseUnknown:true,yieldTask:async()=>{},evaluate:async()=>{calls++;if(calls===1){started();await new Promise(r=>resolve=r);}return {status:'unknown',recommend:false}}});const pending=engine.search({at:0},{isCurrent:()=>current});await ready;current=false;resolve();assert.equal((await pending).cancelled,true);const result=await engine.search({at:0});assert.equal(result.cached,false);assert(calls>1);});
