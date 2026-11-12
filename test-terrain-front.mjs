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
test('見え方：手前の地形に隠れる文を出し、選んでいない建物を地上まで下ろす',()=>{
 assert.match(html,/const frontPending = outline \? aimTerrainFront\(spec\.obs, eye, t\) : null;/);
 // 2026-11-12 距離でなく、どこから下が何に隠れるかを書く（文は AstroNotesAlign.hiddenBelowText、種類は AstroNotesTerrain.obstacleKind）
 assert.match(html,/void aimHiddenNote\(spec\.obs, eye, t, D, b\)/);
 assert.doesNotMatch(html,/km先の地形に隠れ/);
 assert.match(html,/if\(!selected\)\{\s*let bottom=-Infinity;/);
 assert.match(html,/front\.some\(\(q\) => q\[1\] < groundY - 0\.5\)/);
});
