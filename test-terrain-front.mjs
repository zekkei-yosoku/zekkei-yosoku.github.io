import {sourceHtml} from './tools/test-source.mjs';
// 塔・建物の手前の地形と、浮いた建物の足元（2026-10-20 ユーザー「これ絶対に見えないであろう距離」「シルエットが浮いてたりして見栄えが悪い」）
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
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
test('見え方：手前の地面は探索と同じ計算で、街並みの図と天体は同じ輪郭を使う',()=>{
 assert.match(html,/const lookObs = \{ latitude: spec\.obs\.latitude, longitude: spec\.obs\.longitude, elevation: ground, eyeM: spec\.eyeM \};/);
 assert.match(html,/AstroNotesCandidatePicker\.hiddenView\(lookObs, t, aim\.partId\)/);
 assert.doesNotMatch(html,/frontPending|horizonPoints|aimHiddenNote|horizonText|beyondPending|beyondRidge/);
 assert.doesNotMatch(html,/dataset\.terrain|label\.sub/);
 assert.match(html,/else ctx\.rect\(-panX, -panY - H, W, groundEdge \+ panY \+ H\);\s*ctx\.clip\(\);/);
 assert.match(html,/townEdge\(ctx, -panX, W - panX\)/);
 assert.match(html,/if\(!selected\)\{\s*let bottom=-Infinity;/);
});
test('街並みの階段状の輪郭は、遠い山や地平線で持ち上げない',()=>{
 const start=html.indexOf('const townEdge ='),end=html.indexOf('\n  // 山の稜線は',start);assert(start>=0&&end>start);
 const town=[[0,180,80],[50,90,90],[100,160,100]];
 const c=vm.createContext({town,Math,horizonAt:()=>{throw Error('distant horizon must not mask the building preview');}});
 vm.runInContext(html.slice(start,end)+';globalThis.edge=townEdge;',c);
 const points=[];c.edge({lineTo:(x,y)=>points.push([x,y])},-25,125);
 assert.deepEqual(points,[[-25,180],[-25,180],[25,180],[25,90],[75,90],[75,160],[125,160],[125,160]]);
});
test('高所の建物図の地上線は対象の足元または手前の遮蔽で決まり、遠景を使わない',()=>{
 const start=html.indexOf('const placeGround ='),end=html.indexOf('\n  placeGround();',start);assert(start>=0&&end>start);
 const c=vm.createContext({mountain:false,groundEdge:0,fillEdge:0,footY:200,hidden:null,az:90,D:10,eye:150,aimAirAngle:(_,__,h)=>h,proj:(_,y)=>[0,y],toPx:p=>p,horizonAt:()=>{throw Error('unexpected distant horizon');}});
 vm.runInContext(html.slice(start,end)+';globalThis.place=placeGround;',c);
 c.place();assert.equal(c.groundEdge,200);assert.equal(c.fillEdge,200);
 c.hidden={m:90};c.place();assert.equal(c.groundEdge,90);assert.equal(c.fillEdge,90);
 c.hidden={m:250};c.place();assert.equal(c.groundEdge,200,'足元より低い遮蔽は足元を動かさない');
});
test('図中の通常説明は出さず、既知の街並みがあっても未確認は隠さない。山の水平基準は残す',()=>{
 const start=html.indexOf('let groundText ='),end=html.indexOf('    // 図中に目標名',start);assert(start>=0&&end>start);
 const code=html.slice(start,end)+';globalThis.label=groundText;';
 const label=(extra={})=>{const c=vm.createContext({hiddenUnread:false,mountain:false,town:[[0,80]],groundY:80,panY:0,panX:0,H:300,W:390,ctx:{},...extra});vm.runInContext(code,c);return c.label;};
 assert.equal(label(),null);
 assert.equal(label({hidden:{m:90,label:'手前の街並み'},hiddenText:'天望デッキから上が見えます。'}),null);
 assert.equal(label({hiddenUnread:true,hidden:{m:90,label:'手前の街並み'}}).str,'手前の地形は未確認');
 assert.equal(label({hiddenUnread:true,groundY:-100}).y,30,'遮蔽が画面外でも未確認は見える');
 assert.equal(label({mountain:true}).str,'水平（0°）');
});
