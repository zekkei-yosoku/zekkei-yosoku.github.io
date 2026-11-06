// 重ねる対象（個別/全て）の判定と統合。通信しない。
// 全て = 各対象を既存solverで個別に厳密判定した結果のOR。囲み矩形や重心は使わない。
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createOverlapPolicy} from './overlap-scope-policy.mjs';
import {overlapRuntime} from './build-overlap-scope.mjs';
const require=createRequire(new URL('../x.js',import.meta.url));
const TR=require('./astronotes-terrain.js'),AL=require('./astronotes-align.js'),AS=require('./astronotes-astro.js');
const P=createOverlapPolicy();
let pass=0,fail=0;const ok=(c,name,extra='')=>{c?pass++:fail++;console.log(`  ${c?'ok  ':'FAIL'} ${name}`,extra);};

console.log('== 表示集合と重ねる対象 ==');
ok(JSON.stringify(P.members('a',['b','a','c']))==='["a","b","c"]','表示集合は主対象を先頭に重複なし');
ok(P.scope({all:true},['a'])==='single','1件は自動（全ての保存値があっても単体）');
ok(P.scope({all:true},['a','b'])==='all'&&P.scope(null,['a','b'])==='one','2件以上で全て/個別');
ok(JSON.stringify(P.chooseMain(['custom','a','b'],'b'))==='{"main":"b","fallback":false}','対象を追加しても選んだ重ねる対象を保つ');
ok(JSON.stringify(P.chooseMain(['custom','a'],'b'))==='{"main":"custom","fallback":true}','重ねる対象を外すと先頭へ明示fallback');
ok(P.chooseMain(['a'],'b').fallback===false,'残り1件はfallback通知なしの自動');

console.log('== ORの和集合と未確認 ==');
ok(P.combine([false,true,null])===true,'一つでも重なれば重なる');
ok(P.combine([false,false])===false,'全員が重ならない時だけ否定');
ok(P.combine([false,null])===null&&P.combine([])===null,'未確認がある否定は未確認のまま');

console.log('== 実solver：隙間は重なりにしない ==');
const O={latitude:35.68,longitude:139.76,elevation:5},T=Date.UTC(2026,11,1,7,0),sun=AS.sun(T,{...O,elevation:6.5});
const tower=(id,dAz)=>{const p=TR.destination(O.latitude,O.longitude,sun.azimuth+dAz,3);return {id,name:id,latitude:p.latitude,longitude:p.longitude,groundM:0,kind:'tower',widthM:50,parts:[{id:'tip',name:'先端',m:600}]};};
const at=(t)=>AL.dailyView(O,t,'sun',T-16*3600000,{partId:'__whole',at:T,eyeM:1.5})[0];
const A=tower('a',-1.2),B=tower('b',1.2),C=tower('c',.3);
const gap=P.unionAt([at(A),at(B)]);
// The naive group rectangle would contain the sun between the two towers.
const pts=[A,B].flatMap(t=>AL.towerOutline(O,t,{eyeM:1.5}).points),rel=a=>((a-sun.azimuth+540)%360)-180;
const inBox=Math.min(...pts.map(p=>rel(p[0])))<0&&Math.max(...pts.map(p=>rel(p[0])))>0&&Math.max(...pts.map(p=>p[1]))>sun.apparentAltitude&&Math.min(...pts.map(p=>p[1]))<sun.apparentAltitude;
ok(inBox,'前提：二つの塔の囲み矩形は太陽を含む');
ok(gap.intersects===false&&gap.distanceToTarget>sun.angularRadius,'塔の間の隙間を通る太陽は全てに重ならない',gap.distanceToTarget.toFixed(3)+'°');
const hit=P.unionAt([at(A),at(C)]);
ok(hit.intersects===true&&hit.member===1,'片方の輪郭に掛かれば全てに重なる');
ok(at(A).intersects===false,'個別Aは同時刻に重ならない（全員ANDではなくOR）');
ok(P.unionAt([at(A),null]).intersects===null,'他方の幾何が取得できない時は否定しない');

console.log('== 候補日の統合 ==');
const day=(d,h=6)=>Date.UTC(2026,10,d,h);
// Brute force: a union day is any day of any member.
const full=[[day(3),day(5),day(9),day(12),day(20)],[day(4),day(5,10),day(30)],[]];
const limited=full.map(rows=>({rows:rows.slice(0,4).map(at=>({at})),scanned:rows.length>=4?rows[3]+86400000:day(31)}));
const merged=P.mergeDays(limited,4),truth=[...new Set(full.flat().map(P.jstDay))].sort((a,b)=>a-b).slice(0,4);
ok(JSON.stringify(merged.map(r=>P.jstDay(r.at)))===JSON.stringify(truth),'各対象の先頭4日から和集合の先頭4日を正しく得る');
ok(merged[2].at===day(5)&&merged[2].overlapMember===0,'同じ日は早い時刻の対象を代表にする');
ok(P.scannedUntil([{scanned:day(20)},{scanned:day(25)}],[{at:day(3)}],4)===day(20),'4日未満なら走査済み範囲は最短の対象まで');

console.log('== 登録地点・新規地点の統合 ==');
const row=(id,at,partId)=>({place:{id,latitude:1,longitude:2},event:{at,partId,matchMode:'overlap'}});
const rows=P.mergeRows([{rows:[row('p',day(3),'__whole'),row('q',day(4),'__whole')]},{rows:[row('p',day(3),null)],failed:1}],{partId:'__whole'},['a','fuji']);
ok(rows.rows.length===2&&rows.failed===1,'同じ地点・同じ秒は一つにまとめ、失敗件数は残す');
ok(rows.rows.every(r=>r.event.partId==='__whole'&&r.event.matchMode==='overlap'),'候補を開く条件は基準対象の全体へ揃える（山のpartIdを流用しない）');
ok(P.mergeRows([{rows:[]},{cancelled:true}],{partId:null}).cancelled===true,'取消は統合結果も取消');
const pos={recommend:true,id:'x',event:{at:1},additionalCandidates:[{recommend:true,id:'y',event:{at:2}}]};
const ev=P.mergeEvaluations([{status:'no-overlap',recommend:false},pos],{partId:'__whole'},['a','b']);
ok(ev.recommend&&ev.additionalCandidates.length===1&&ev.event.overlapTargetId==='b','どれかの対象で成立した地点を推薦');
ok(P.mergeEvaluations([{status:'no-overlap'},{status:'unknown'}],{partId:null}).status==='unknown','未確認は否定より優先して残す');
ok(P.mergeEvaluations([{status:'no-overlap'},{status:'model-blocked'}],{partId:null}).status==='model-blocked','重なるが遮られる対象があれば遮蔽として返す');
ok(P.mergeSeeds([{seeds:[1],partial:false},{seeds:[2,3],partial:true}]).seeds.length===3,'逆算の種は全対象の和');

console.log('== 共有拡張 ==');
const ext=P.payloadExt([{id:'skytree',name:'東京スカイツリー',latitude:35.71,longitude:139.81},{id:'fuji',name:'富士山',latitude:35.36,longitude:138.72}]);
ok(P.parseExt(ext)?.length===2&&P.parseExt({...ext,members:[ext.members[0]]})===null,'2件以上の正しい拡張だけを受け入れる');
ok(P.resolveMembers(ext.members,[{id:'skytree',latitude:35.71,longitude:139.81,parts:[{}]},{id:'fuji',latitude:35.36,longitude:138.72,parts:[{}]}])?.length===2,'受信側の同じ対象へ解決');
ok(P.resolveMembers(ext.members,[{id:'skytree',latitude:35.71,longitude:139.81,parts:[{}]},{id:'fuji',latitude:35.5,longitude:138.72,parts:[{}]}])===null,'位置が違う対象は全てとして復元しない');

console.log('== trial runtime（隔離VM） ==');
const stored=new Map(),events=[];let extras=['fuji'],main={id:'skytree',name:'東京スカイツリー',latitude:35.71,longitude:139.81,parts:[{id:'tip',m:636}]};const fuji={id:'fuji',name:'富士山',latitude:35.36,longitude:138.72,parts:[{id:'summit',m:3776}]};
const alignments=[];
const ctx={queueMicrotask:f=>f(),console,getComputedStyle:()=>({getPropertyValue:()=>''}),
 document:{addEventListener:(t)=>events.push(t),getElementById:()=>null,dispatchEvent(){},createElement:()=>({})},
 auth:{loginId:'u1',token:'t'},store:{get:(k,d)=>stored.has(k)?stored.get(k):d,set:(k,v)=>stored.set(k,v)},
 aimSceneExtrasAllowed:()=>true,aimIsMountain:t=>t.id==='fuji',aimSceneExtraTargets:id=>[main,fuji].filter(t=>extras.includes(t.id)&&t.id!==id),aimSetSceneExtras:ids=>{extras=ids;},aimTargetList:()=>[main,fuji],
 SkyMapUI:{selectionState:()=>({target:main,matchMode:'overlap',partId:'__whole'}),setAlignment:(...a)=>alignments.push(a),render(){},setTarget(){}}};
ctx.globalThis=ctx;vm.createContext(ctx);vm.runInContext(overlapRuntime(),ctx);
const R=ctx.AstroNotesTrialOverlap;
ok(R&&R.isAll()===false&&R.key()===null,'既定は個別（既存keyを変えない）');
stored.set('sorami.sceneOverlap:u1',{all:true});
ok(R.isAll()&&JSON.parse(R.key())[1].map(t=>t[0]).join()==='skytree,fuji','全ては表示集合のkeyを持つ');
ok(R.searchPlan().overlapMembers.map(m=>m.partId).join()==='__whole,','対象ごとの全体（建物__whole・山null）');
stored.set('sorami.sceneOverlap:u2',{all:false});ctx.auth={loginId:'u2',token:'t'};
ok(R.isAll()===false,'ownerごとに分離（別アカウントへ全てを持ち込まない）');ctx.auth={loginId:'u1',token:'t'};
const calls=[];const fn=async(obs,t,body,partId,seq,o)=>{calls.push([t.id,partId,o.matchMode]);o.onScanned(day(30));return t.id==='fuji'?[{at:day(4)},{at:day(8)}]:[{at:day(6)}];};
const days=await R.buildingDays(fn,ctx.SkyMapUI.selectionState())({},main,'sun','__whole',null,{limit:4,isCurrent:()=>true,onScanned(){}});
ok(calls.length===2&&calls.every(c=>c[2]==='overlap')&&days.map(d=>d.overlapTargetId).join()==='fuji,skytree,fuji','候補日は各対象を全体で走査して和にする');
const disc=await R.discovery({overlapMembers:R.searchPlan().overlapMembers,partId:'__whole'},async p=>({rows:p.target.id==='fuji'?[row('p',day(2),null)]:[]}));
ok(disc.rows.length===1&&disc.rows[0].event.partId==='__whole'&&disc.rows[0].event.overlapTargetId==='fuji','登録地点は対象ごとの既存solverの和');
const seen=[];await R.evaluate({overlapMembers:R.searchPlan().overlapMembers,lens:{mode:'evaluate'},composition:{x:1}},async p=>{seen.push(p);return {status:'no-overlap'};});
ok(seen[0].composition===null&&seen[1].overlapAnchor?.target.id==='skytree'&&seen[1].extraTargets[0].id==='skytree'&&seen[0].requireAllTargets===false,'新規地点は図内位置指定を外し、全員AND条件にしない。枠は基準対象で判定');
const payload={kind:'aim',t:{id:'skytree'}},share={title:'太陽 × 東京スカイツリー',rows:[['対象・重ね方','x']]};R.annotate('skymap',share,payload);
ok(payload.ov?.members.length===2&&share.title.includes('全て（東京スカイツリー、富士山）')&&share.rows[0][1].startsWith('全て'),'共有・予定は全てと対象を保持し文言も全て');
R.restore({kind:'aim',t:{id:'skytree',name:'東京スカイツリー'}});
ok(stored.get('sorami.sceneOverlap:u1').all===false,'拡張のない共有は個別として開く');
extras=[];R.restore({kind:'aim',t:{id:'skytree',name:'東京スカイツリー'},ov:payload.ov});
ok(stored.get('sorami.sceneOverlap:u1').all===true&&extras.join()==='fuji','全ての共有は表示集合と全てを復元');
R.restore({kind:'aim',t:{id:'skytree',name:'東京スカイツリー'},ov:{...payload.ov,members:[payload.ov.members[0],{...payload.ov.members[1],id:'fav:x'}]}});
ok(stored.get('sorami.sceneOverlap:u1').all===false,'受信側に無い対象を含む全ては基準対象へ戻す');

console.log('== 生成物の接続 ==');
const html=readFileSync(new URL('../trial/index.html',import.meta.url),'utf8'),bundle=readFileSync(new URL('../trial/astronotes-candidate-search.js',import.meta.url),'utf8'),explore=readFileSync(new URL('../trial/astronotes-explore-simple.js',import.meta.url),'utf8'),root=readFileSync(new URL('../index.html',import.meta.url),'utf8');
ok(['buildingDays','accent','annotate','restore','quickRecord','chooseMain','custom'].every(k=>html.includes('AstroNotesTrialOverlap?.'+k)),'trial文書の各経路へ接続');
ok(bundle.includes('globalThis.AstroNotesTrialOverlap={')&&bundle.includes('AstroNotesTrialOverlap?.evaluate')&&explore.includes('AstroNotesTrialOverlap?.discovery'),'候補探索と登録地点へ接続');
ok(!root.includes('AstroNotesTrialOverlap')&&!readFileSync(new URL('../astronotes-explore.js',import.meta.url),'utf8').includes('AstroNotesTrialOverlap'),'本番rootは変更しない');


ok(P.resolveMembers(ext.members,[{id:'skytree',latitude:35.71,longitude:0,parts:[{}]},{id:'fuji',latitude:35.36,longitude:138.72,parts:[{}]}])===null,'longitude mismatch must not restore a group');
ok(P.parseExt({...ext,members:[ext.members[0],ext.members[0]]})===null,'duplicate share members rejected');
ok(P.parseExt({...ext,members:[ext.members[0],{...ext.members[1],latitude:91}]})===null,'out of range shared coordinates rejected');
ok(P.scannedUntil([{scanned:day(20)},{scanned:null}],[{at:day(3)}],4)===null,'unknown member never claims scanned completion');

ctx.toolAllowed=()=>true;ctx.AstroNotesAccess={canFrame:()=>false};stored.set('sorami.sceneOverlap:u1',{all:true});ok(R.isAll()===false,'全ても各対象の利用権限を守る');delete ctx.toolAllowed;delete ctx.AstroNotesAccess;
console.log(`\n${pass} passed, ${fail} failed`);if(fail)process.exit(1);
