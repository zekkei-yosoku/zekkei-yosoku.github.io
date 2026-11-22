import {sourceHtml,sourceDeclaration} from './tools/test-source.mjs';
import './tools/test-owner-adapter.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url),AL=require('./astronotes-align.js'),S=require('./astronotes-core.js'),TR=require('./astronotes-terrain.js'),A=require('./astronotes-astro.js'),B=require('./astronotes-bodies.js');
const observer={latitude:35.58386,longitude:139.56853,elevation:83},at=Date.parse('2026-10-03T06:00:00+09:00');
test('全既定目標の輪郭を同じ地点から作り、遠い順・重複なし・未設定拒否',()=>{
 const scene=AL.sceneTargets(observer,[...AL.TARGETS,AL.TARGETS[1],{id:'empty',parts:[]}]);
 // タワー・オブ・テラー追加で既定目標は10件（既存9件を保持）。
 assert.equal(scene.length,10);assert.equal(new Set(scene.map(x=>x.target.id)).size,10);assert.deepEqual(new Set(scene.map(x=>x.target.id)),new Set(AL.TARGETS.map(x=>x.id)));assert.ok(scene.some(x=>x.target.id==="tocho-building"));
 assert.ok(scene.every((x,i)=>Number.isFinite(x.topAngle)&&(!i||scene[i-1].distanceKm>=x.distanceKm)));
 assert.ok(scene.find(x=>x.target.id==='skytree').outline.points.length>20);
 assert.ok(scene.find(x=>x.target.id==='tokyotower').outline.points.length>20);
 assert.equal(scene.find(x=>x.target.id==='fuji').outline,null);
});
test('実座標から相対方位を投影し、二つの塔を左右反転しない',()=>{
 const rows=AL.sceneTargets(observer,AL.TARGETS),sky=rows.find(x=>x.target.id==='skytree'),tower=rows.find(x=>x.target.id==='tokyotower');
 const project=AL.viewProjector(sky.azimuth,sky.topAngle);
 assert.ok(tower.azimuth>sky.azimuth);assert.ok(project(tower.azimuth,tower.topAngle)[0]>0);
 const west={...observer,longitude:140.1},eastRows=AL.sceneTargets(west,AL.TARGETS),eSky=eastRows.find(x=>x.target.id==='skytree'),eTower=eastRows.find(x=>x.target.id==='tokyotower');
 assert.ok(AL.viewProjector(eSky.azimuth,eSky.topAngle)(eTower.azimuth,eTower.topAngle)[0]<0);
});
test('一日の軌道は画面外でも続き、4時間以上移した1秒時刻を保持',()=>{
 const proj=AL.viewProjector(60,2),day=S.JstCal.startOfDay(at),includeAt=day+21*3600000+1234;
 const path=AL.viewPath('moon',{...observer,elevation:84.5},at,proj,{halfW:1,halfH:1},{dayMs:day,includeAt});
 assert.equal(path[0].at,day);assert.equal(path.at(-1).at,day+86400000-1);assert.ok(path.some(p=>p.at===includeAt));assert.ok(path.some(p=>p.x===null));
 assert.throws(()=>AL.viewPath('moon',observer,at,proj,{},{dayMs:day,stepS:0}),RangeError);
});
test('実レンダーが周囲の東京タワーを描き、古い主目標への置換をしない',async()=>{
 const html=sourceHtml(),start=html.indexOf('async function aimLookRender('),end=html.indexOf('\n/**',start);
 const operations=[],calls=[],makeCtx=()=>new Proxy({measureText:s=>({width:s.length*8}),getImageData:(x,y,w,h)=>({data:new Uint8ClampedArray(w*h*4)}),createLinearGradient:()=>({addColorStop(){}})}, {get:(o,k)=>k in o?o[k]:(...args)=>{operations.push({method:k,args});if(k==='fillText')calls.push(args[0]);}}),ctx=makeCtx();
 const canvas={addEventListener(){},clientWidth:600,style:{},getContext:()=>ctx,setAttribute:(k,v)=>{canvas[k]=v},getBoundingClientRect:()=>({left:0,top:0})};
 const els=new Map(),host={isConnected:true,getClientRects:()=>[{}],clientWidth:600,_lookSeq:0,_lensOffset:[0,0],querySelector:q=>q==='canvas'||q.includes('data-look-canvas')?canvas:els.get(q)||(()=>{const x={dataset:{},style:{},value:'',setAttribute(){},checkValidity:()=>true};els.set(q,x);return x})()};
 const target=AL.targetById('skytree'),aim={target,body:'moon',partId:'tip'},lens={on:true,mode:'manual',focal:60,sensor:'full',portrait:false};
 const c=vm.createContext({Path2D:class{moveTo(){}lineTo(){}arc(){}},blendBodyState:(a,b,f)=>({...a,azimuth:a.azimuth+(b.azimuth-a.azimuth)*f,apparentAltitude:a.apparentAltitude+(b.apparentAltitude-a.apparentAltitude)*f}),aimAirCompare:null,aimAirDescribe(){},aimTerrainFront:async()=>null,aimTerrainBeyond:async()=>null,AstroNotesAtmosphere:{targetK:()=>undefined},aimAirAngle:A.targetElevationAngle,document:{createElement:()=>({width:0,height:0,getContext:makeCtx}),getElementById:()=>null,activeElement:null},aim,S,AstroNotesBodies:B,AstroNotesAstro:A,AstroNotesAlign:AL,AstroNotesTerrain:TR,aimLens:lens,AIM_SENSOR:{full:[36,24]},aimLookHosts:new Set(),aimReverseClear(){},aimIsMountain:t=>!!t.rim,aimTargetList:()=>AL.TARGETS,aimSceneBackdrop:()=>AL.TARGETS,aimLookRidge:async()=>null,aimLookPick(host,opts){if(host._pick){opts.cv.onkeydown=()=>{};opts.cv.tabIndex=0}},aimLookSky:()=>[[10,20,30],[30,40,50]],aimLookDisc(...args){operations.push({method:"bodyDisc",args:args.slice(1,4)})},aimLookHMS:ms=>S.JstCal.hhmm(ms),aimLookRel:()=>'',esc:s=>s,window:{devicePixelRatio:1},localStorage:{setItem(){}},navigator:{},requestAnimationFrame:()=>1,cancelAnimationFrame(){}});
 vm.runInContext(sourceDeclaration("aimDrawGrid")+sourceDeclaration("aimLookVisible"),c);
 // E94: the renderer now records the exact plan key; load its real helper in this isolated harness.
 vm.runInContext(html.match(/^const aimLookKey = .*;$/m)[0],c);
 vm.runInContext(html.slice(html.indexOf('function aimLookSolidSilhouette('),start),c);
 vm.runInContext(html.slice(start,end)+';this.render=aimLookRender',c);
 await c.render(host,{obs:observer,eyeM:1.5,at,title:'試験地点から'});
 assert.equal(host._planKey, vm.runInContext('aimLookKey()',c));
 assert.ok(!calls.includes('東京タワー'));assert.ok(!calls.includes('東京スカイツリー'));assert.ok(canvas['aria-label'].includes('東京タワー'));assert.equal(aim.target.id,'skytree');
 assert.ok(!calls.includes('地上'));assert.ok(operations.some(x=>x.method==='clip'));
 const bands=operations.filter(x=>x.method==='fillRect'&&x.args[1]!==0);assert.ok(bands.some(x=>x.args[3]>0&&x.args[3]<=24));
 const clip=operations.find(x=>x.method==='rect');assert.ok(clip.args[3]>=0&&clip.args[3]<=440);
 const clipAt=operations.findIndex(x=>x.method==='clip'),fillAt=operations.findIndex((x,i)=>i>clipAt&&x.method==='fill');assert.ok(clipAt<fillAt);
 // 移動中も実際の円盤を一つだけ描く。構図の移動分を二重に足さない。
 for(const body of ['sun','moon','sirius','mercury','venus','mars','jupiter','saturn']){
 aim.body=body;host._pick={ghost:[210,190]};host._lensOffset=[.1,.05];operations.length=0;
 await c.render(host,{obs:observer,eyeM:1.5,at,pick:true,title:'試験地点から'});
 const discs=operations.filter(x=>x.method==='bodyDisc');assert.equal(discs.length,1);assert.equal(typeof canvas.onkeydown,"function");assert.equal(canvas.tabIndex,0);
 const translated=operations.filter(x=>x.method==='translate');
 assert.ok(translated.some(x=>Math.abs(x.args[0]-(210-60))<1e-8));
 assert.ok(!operations.some(x=>x.method==='arc'&&x.args[0]===210&&x.args[1]===190));
 }
 // Date interpolation must not override a newly selected clock time.
 aim.body='sun';host._pick=null;
 await c.render(host,{obs:observer,eyeM:1.5,at,title:'試験地点から'});
 const state=host._uiTime;
 state.blend({from:at,to:at+86400000,f:.25});assert.ok(host._blendP);
 const chosen=at+5*3600000+1234;
 state.set(chosen);
 assert.equal(host._blendP,null);assert.equal(host._lookAt,chosen);assert.equal(state.current,chosen);
 assert.ok(operations.some(x=>x.method==='reset'));
 const layers=host._lookLayers;assert.notEqual(layers.sky,layers.body);assert.notEqual(layers.sky,layers.buildings);
 const builds=layers.stats.buildings,frames=layers.stats.body;
 for(let i=0;i<30;i++)state.set(chosen+i*15000);
 assert.equal(layers.stats.buildings,builds);assert.equal(layers.stats.body,frames+30);


});

test('同じ天体の一日と画角用時刻は同じ標本を共有し、任意秒と大気条件は更新する',()=>{
 const source=readFileSync(new URL('./src/features/framing/scene/calculations.js',import.meta.url),'utf8');
 let air='standard',stateCalls=0;
 const ctx=vm.createContext({AstroNotesAlign:AL,AstroNotesAtmosphere:{dataKey:()=>air},
  AstroNotesBodies:{state:(_body,ms,_obs)=>{
   stateCalls++;
   return {azimuth:61,apparentAltitude:air==='none'?1:2,angularRadius:0.25,illuminatedFraction:ms%1000/1000};
  }}});
 vm.runInContext(source.replace(/^export .*;$/m,'')+';globalThis.samples=aimLookEphemeris;',ctx);
 const host={},day=S.JstCal.startOfDay(at),win={az0:61,alt0:2,halfW:1,halfH:1},project=AL.viewProjector(win.az0,win.alt0);
 const run=(selected=at,window=win,proj=project)=>ctx.samples(host,'moon',observer,day,at,selected,window,proj,true);
 const first=run(),n=stateCalls;
 assert.equal(first.path.length,4321);assert.equal(first.framePoints.length,2161);
 assert(n<first.path.length+first.framePoints.length,'same-minute entries are sampled only once');
 const zoom=run(at,{...win,halfW:.5,halfH:.5});
 assert.strictEqual(zoom.path,first.path);assert.strictEqual(zoom.framePoints,first.framePoints);assert.equal(stateCalls,n);
 const selected=at+137;
 const moved=run(selected);
 assert.equal(moved.path.find(p=>p.at===selected).illuminated,.137);
 assert.equal(stateCalls,n+1);assert.strictEqual(moved.framePoints,first.framePoints);
 const turn=run(selected,{...win,az0:62},AL.viewProjector(62,2));
 assert.notEqual(turn.path[0].x,moved.path[0].x);
 assert.equal(stateCalls,n+1,'another projection can reuse the same physical states');
 air='none';
 const refracted=run(selected);
 assert.equal(refracted.path[0].altitude,1);assert(stateCalls>n+1);
});

test('一日の準備を中断でき、大気が途中で変わっても新しい標本を揃えてから投影する',async()=>{
 const source=readFileSync(new URL('./src/features/framing/scene/calculations.js',import.meta.url),'utf8');
 let air='standard',clock=0,yields=0,calls=0,active=true,abortOnYield=false;
 const ctx=vm.createContext({AstroNotesAlign:AL,AstroNotesAtmosphere:{dataKey:()=>air},performance:{now:()=>clock},
  setTimeout:f=>queueMicrotask(()=>{yields++;air='none';if(abortOnYield)active=false;f();}),
  AstroNotesBodies:{state:()=>{clock+=.05;calls++;return {azimuth:61,apparentAltitude:air==='none'?1:2,angularRadius:.25};}}});
 vm.runInContext(source.replace(/^export .*;$/m,'')+';globalThis.warm=warmLookEphemeris;globalThis.samples=aimLookEphemeris;',ctx);
 const host={},day=S.JstCal.startOfDay(at),win={az0:61,alt0:1,halfW:1,halfH:1};
 assert(await ctx.warm(host,'moon',observer,day,()=>active));
 assert(yields>2,'traversal yields between short batches');
 const before=calls,used=ctx.samples(host,'moon',observer,day,day,day,win,AL.viewProjector(61,1),null);
 assert.equal(calls,before+1,'projection only needs the existing exact final-second sample');
 assert(used.path.every(p=>p.altitude===1));
 assert(await ctx.warm(host,'moon',observer,day,()=>active));
 assert.equal(calls,before+1,'a prepared day does not resample at the same camera position');
 abortOnYield=true;
 assert.equal(await ctx.warm(host,'moon',observer,day+86400000,()=>active),false);
 assert(calls-before<250,'a superseded scene stops instead of completing the unused day');
});

test('同じモデルIDを別の形状に置き換えたときは描画用の頂点を更新する',()=>{
 const id='outline-refresh-probe';
 const target={id,latitude:35.7099,longitude:139.8107,groundM:2,parts:[{id:'tip',m:32}]};
 const model=width=>({id:'same-model-id',heightM:30,referenceBearing:0,vertices:[[-width,0,0],[width,0,0],[0,0,30]],faces:[[0,1,2]]});
 const previous=globalThis.AstroNotesCityModels;
 try {
  globalThis.AstroNotesCityModels={...previous,[id]:model(5)};
  const first=AL.towerOutline(observer,target);
  globalThis.AstroNotesCityModels[id]=model(20);
  const revised=AL.towerOutline(observer,target);
  assert.equal(revised.modelId,first.modelId);
  assert.notDeepEqual(revised.vertices,first.vertices);
  assert.equal(revised.vertices[2][1],first.vertices[2][1]);
 } finally {globalThis.AstroNotesCityModels=previous;}
});
