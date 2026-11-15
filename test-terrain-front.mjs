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
test('見え方：手前の地面は探索と同じ計算で、街並みが読めない場合は地面の線で天体を切る',()=>{
 // 2026-11-13 ユーザー「その建物が立ってるところの地面をグランドラインにして天体の軌道は関係なくラインで出せばいいんじゃないの?」
 assert.match(html,/const lookObs = \{ latitude: spec\.obs\.latitude, longitude: spec\.obs\.longitude, elevation: ground, eyeM: spec\.eyeM \};/);
 assert.match(html,/AstroNotesCandidatePicker\.hiddenView\(lookObs, t, aim\.partId\)/);
 assert.doesNotMatch(html,/frontPending|horizonPoints|aimHiddenNote|horizonText/);
 assert.doesNotMatch(html,/str: "地平線"/);
 assert.match(html,/groundText = \{ str: groundLabel, y: groundY - 4 \+ panY, sub: hidden && groundLabel === hidden\.label \? hiddenText : "", subY: groundY \+ 6 \+ panY \};/);
 // 隠れる文は図の中に書く。図の下の行に後から足すと下の欄が押し下がる（2026-11-13）
 assert.doesNotMatch(html,/dataset\.terrain/);
 assert.match(html,/else ctx\.rect\(-panX, -panY - H, W, groundEdge \+ panY \+ H\);\s*ctx\.clip\(\);/);
 assert.match(html,/townEdge\(ctx, -panX, W - panX, true\)/);
 assert.match(html,/if\(!selected\)\{\s*let bottom=-Infinity;/);
});
test('街並みの天体マスクは低い建物の上にある遠い地平線を越えない。後着地形にも追従し、影の高さは変えない',()=>{
 const start=html.indexOf('const townEdge ='),end=html.indexOf('\n  // 山の稜線は',start);assert(start>=0&&end>start);
 const town=[[0,180,80],[50,90,90],[100,160,100]],horizon=new Map([[80,130],[90,130],[100,140]]);
 const c=vm.createContext({town,Math,horizonAt:az=>horizon.get(az),proj:(az,y)=>[az,y],toPx:p=>p});
 vm.runInContext(html.slice(start,end)+';globalThis.edge=townEdge;',c);
 const trace=clip=>{const points=[];c.edge({lineTo:(x,y)=>points.push([x,y])},-25,125,clip);return points;};
 // 同じ方位で、空を切る上端は建物と地平線の高い側（画面では小さいy）。建物が低い隙間から地下を見せない。
 assert.deepEqual(trace(true),[[-25,130],[-25,130],[25,130],[25,90],[75,90],[75,140],[125,140],[125,140]]);
 assert.deepEqual(trace(false),[[-25,180],[-25,180],[25,180],[25,90],[75,90],[75,160],[125,160],[125,160]]);
 horizon.set(80,70);assert.equal(trace(true)[0][1],70,'後から読めた山並みで天体マスクを更新');assert.equal(trace(false)[0][1],180,'足元と地平線の間の空は塗らない');
});
