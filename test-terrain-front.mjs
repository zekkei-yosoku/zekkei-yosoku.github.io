import {sourceHtml} from './tools/test-source.mjs';
// 塔・建物の手前の地形と、浮いた建物の足元（2026-10-20 ユーザー「これ絶対に見えないであろう距離」「シルエットが浮いてたりして見栄えが悪い」）
import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';
const html=sourceHtml();
const src=html.slice(html.indexOf('const AIM_FRONT_SPAN'),html.indexOf('async function aimLookRidge('));
function load(heightAt){
 const c={Math,Map,Number,AstroNotesAtmosphere:{targetK:()=>0.13},
  AstroNotesTerrain:{distanceKm:()=>100,bearing:()=>90,destination:(lat,lon,az,d)=>({latitude:lat,longitude:lon+d/90,az,d}),elevations:async(pts)=>pts.map(p=>heightAt(p.d,p.az)),tileElevations:async(pts)=>pts.map(p=>heightAt(p.d,p.az))},
  // 曲率だけの簡単な見かけの高さ（度）
  aimAirAngle:(d,eye,h)=>Math.atan2(h-eye-(d*1000)**2/(2*6371000),d*1000)*180/Math.PI};
 vm.createContext(c);vm.runInContext(src+';globalThis.front=aimTerrainFront;',c);return c;
}
test('目標の方位の手前に高い地形があれば、その距離と見かけの高さを返す',async()=>{
 const c=load((d)=>d>6.5&&d<7.5?1700:900);const r=await c.front({latitude:35.5,longitude:138.6},1261,{latitude:35.7,longitude:139.8});
 assert.equal(r.ridge.length,81);assert.ok(Math.abs(r.block.km-7)<0.6,String(r.block.km));assert.ok(r.block.angle>3&&r.block.angle<4,String(r.block.angle));
});
test('近すぎる目標は地形を読まない／読めなければ null',async()=>{
 const c=load(()=>0);c.AstroNotesTerrain.distanceKm=()=>0.5;assert.deepEqual(JSON.parse(JSON.stringify(await c.front({latitude:0,longitude:0},10,{latitude:0,longitude:0.001}))),{ridge:[],block:null});
 const e=load(()=>0);e.AstroNotesTerrain.elevations=async()=>{throw Error('x');};assert.equal(await e.front({latitude:1,longitude:1},10,{latitude:1,longitude:2}),null);
});
test('山の外の地形は広い幅で読む。幅を変えても既定の幅の結果を混ぜない',async()=>{
 const c=load(()=>900),obs={latitude:35.5,longitude:138.6},target={latitude:35.7,longitude:139.8};
 const wide=await c.front(obs,1261,target,45),base=await c.front(obs,1261,target);
 assert.equal(wide.ridge.length,121);assert.equal(wide.ridge[0][0],45);assert.equal(wide.ridge[120][0],135);
 assert.equal(base.ridge.length,81);assert.equal(base.ridge[0][0],70);
});
test('見え方：塔の中心視線と街並みを独立に取得し、建物と月の両方に同じ輪郭を使う',()=>{
 assert.match(html,/const lookObs = \{ latitude: spec\.obs\.latitude, longitude: spec\.obs\.longitude, elevation: ground, eyeM: spec\.eyeM \};/);
 assert.match(html,/\.hiddenView\(lookObs, t, aim\.partId, currentLook\)/);
 assert.match(html,/\.skylineView\(lookObs, t, bearings, currentLook\)/);
 assert.match(html,/globalCompositeOperation = "destination-out"; ctx\.fillStyle = "#000"; ctx\.fill\(foreground\)/);
 assert.match(html,/ctx\.fillStyle = "rgba\(4,6,12,0\.62\)"; ctx\.fill\(foreground\)/);
 assert.doesNotMatch(html,/frontPending|horizonPoints|aimHiddenNote|horizonText|beyondPending|beyondRidge|townEdge/);
 assert.match(html,/if\(!selected\)\{\s*let bottom=-Infinity;/);
});
test('高い屋根でも、投影後の横位置がずれる方位区間と屋根角だけを描く',()=>{
 const start=html.indexOf('function aimLookForeground('),end=html.indexOf('const AIM_MOUNTAIN_SKY_SPAN',start);
 assert(start>=0&&end>start);
 class Path2D{
  rings=[];
  moveTo(...p){this.rings.push([p]);}
  lineTo(...p){this.rings.at(-1).push(p);}
  closePath(){}
 }
 const c=vm.createContext({Path2D});
 vm.runInContext(html.slice(start,end)+';globalThis.mask=aimLookForeground;',c);
 const project=(az,alt)=>{
  const rad=Math.PI/180,t=35*rad,a=az*rad,h=alt*rad,f=Math.cos(a)*Math.cos(h),z=Math.sin(h);
  const depth=f*Math.cos(t)+z*Math.sin(t);
  return [50+Math.cos(h)*Math.sin(a)/depth/rad,50-(z*Math.cos(t)-f*Math.sin(t))/depth/rad];
 };
 const contains=(polygon,point)=>{
  const edges=polygon.map(([x,y],i)=>{const [a,b]=polygon[(i+1)%polygon.length];return (a-x)*(point[1]-y)-(b-y)*(point[0]-x);});
  return edges.every(v=>v>=-1e-8)||edges.every(v=>v<=1e-8);
 };
 const mask=c.mask([{angle:70,complete:false},{angle:-Infinity,complete:true}],[21,23],.7,
  {az0:0,alt0:35,halfW:50,halfH:50},1,[0,0,100,100]);
 assert.equal(mask.rings.length,1);
 assert(contains(mask.rings[0],project(21,69)));
 assert(!contains(mask.rings[0],project(21,71)));
 assert(!contains(mask.rings[0],project(23,69)));
});
test('高所の建物図の地上線は対象の足元または手前の遮蔽で決まり、遠景を使わない',()=>{
 const start=html.indexOf('const placeGround ='),end=html.indexOf('\n  placeGround();',start);assert(start>=0&&end>start);
 const c=vm.createContext({mountain:false,groundEdge:0,fillEdge:0,footY:200,hidden:null,az:90,D:10,eye:150,aimAirAngle:(_,__,h)=>h,proj:(_,y)=>[0,y],toPx:p=>p,horizonAt:()=>{throw Error('unexpected distant horizon');}});
 vm.runInContext(html.slice(start,end)+';globalThis.place=placeGround;',c);
 c.place();assert.equal(c.groundEdge,200);assert.equal(c.fillEdge,200);
 c.hidden={m:90};c.place();assert.equal(c.groundEdge,90);assert.equal(c.fillEdge,90);
 c.hidden={m:250};c.place();assert.equal(c.groundEdge,200,'足元より低い遮蔽は足元を動かさない');
});
test('確認中・欠測・山の水平基準を表示する',()=>{
 assert.match(html,/frontageStatus = "手前の建物を確認中"/);
 assert.match(html,/hiddenUnread \? "手前の地形は未確認"/);
 assert.match(html,/hiddenPartial \|\| beyondFrontage \? "手前の遮蔽は一部未確認"/);
 assert.match(html,/if \(mountain\) groundText = \{ str: "水平（0°）"/);
});
