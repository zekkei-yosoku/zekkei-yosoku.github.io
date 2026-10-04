import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url),AL=require('./sorami-align.js'),S=require('./sorami-core.js'),TR=require('./sorami-terrain.js'),A=require('./sorami-astro.js'),B=require('./sorami-bodies.js');
const observer={latitude:35.58386,longitude:139.56853,elevation:83},at=Date.parse('2026-10-03T06:00:00+09:00');
test('全既定目標の輪郭を同じ地点から作り、遠い順・重複なし・未設定拒否',()=>{
 const scene=AL.sceneTargets(observer,[...AL.TARGETS,AL.TARGETS[1],{id:'empty',parts:[]}]);
 assert.equal(scene.length,5);assert.equal(new Set(scene.map(x=>x.target.id)).size,5);
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
 const html=readFileSync(new URL('./index.html',import.meta.url),'utf8'),start=html.indexOf('async function aimLookRender('),end=html.indexOf('\n/**',start);
 const operations=[],calls=[],ctx=new Proxy({measureText:s=>({width:s.length*8}),createLinearGradient:()=>({addColorStop(){}})}, {get:(o,k)=>k in o?o[k]:(...args)=>{operations.push({method:k,args});if(k==='fillText')calls.push(args[0]);}});
 const canvas={clientWidth:600,style:{},getContext:()=>ctx,setAttribute:(k,v)=>{canvas[k]=v},getBoundingClientRect:()=>({left:0,top:0})};
 const els=new Map(),host={clientWidth:600,_lookSeq:0,_lensOffset:[0,0],querySelector:q=>q==='canvas'||q.includes('data-look-canvas')?canvas:els.get(q)||(()=>{const x={dataset:{},style:{},value:'',setAttribute(){},checkValidity:()=>true};els.set(q,x);return x})()};
 const target=AL.targetById('skytree'),aim={target,body:'moon',partId:'tip'},lens={on:true,mode:'manual',focal:60,sensor:'full',portrait:false};
 const c=vm.createContext({document:{getElementById:()=>null,activeElement:null},aim,S,SoramiBodies:B,SoramiAstro:A,SoramiAlign:AL,SoramiTerrain:TR,aimLens:lens,AIM_SENSOR:{full:[36,24]},aimLookHosts:new Set(),aimReverseClear(){},aimIsMountain:t=>!!t.rim,aimTargetList:()=>AL.TARGETS,aimLookRidge:async()=>null,aimLookPick(){},aimLookSky:()=>[[10,20,30],[30,40,50]],aimLookDisc(){},aimLookHMS:ms=>S.JstCal.hhmm(ms),aimLookRel:()=>'',esc:s=>s,window:{devicePixelRatio:1},localStorage:{setItem(){}},navigator:{},requestAnimationFrame:()=>1,cancelAnimationFrame(){}});
 vm.runInContext(html.slice(start,end)+';this.render=aimLookRender',c);
 await c.render(host,{obs:observer,eyeM:1.5,at,title:'試験地点から'});
 assert.ok(!calls.includes('東京タワー'));assert.ok(!calls.includes('東京スカイツリー'));assert.ok(canvas['aria-label'].includes('東京タワー'));assert.equal(aim.target.id,'skytree');
 assert.ok(calls.includes('地上'));assert.ok(operations.some(x=>x.method==='clip'));
 const bands=operations.filter(x=>x.method==='fillRect'&&x.args[1]!==0);assert.ok(bands.some(x=>x.args[3]>0&&x.args[3]<=24));
 const clip=operations.find(x=>x.method==='rect');assert.ok(clip.args[3]>=0&&clip.args[3]<=440);
 const clipAt=operations.findIndex(x=>x.method==='clip'),fillAt=operations.findIndex((x,i)=>i>clipAt&&x.method==='fill');assert.ok(clipAt<fillAt);
});
