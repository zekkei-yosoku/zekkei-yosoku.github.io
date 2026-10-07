import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),A=require("./sorami-align.js"),T=require("./sorami-terrain.js");
const target=A.targetById("tocho-building");
test("都庁の南北塔は独立した位置で、PLATEAUの塔頂標高を二重加算しない",async()=>{
 assert.equal(target.name,"東京都庁 第一本庁舎");assert.ok(A.FUJI_SPOTS.find(s=>s.id==="tocho"));
 const n=A.partTarget(target,"north"),s=A.partTarget(target,"south");
 assert.ok(n.latitude>s.latitude);assert.ok(Math.abs(T.distanceKm(n.latitude,n.longitude,s.latitude,s.longitude)-.064)<.001);
 const observer={...T.destination(target.latitude,target.longitude,80,2),elevation:35};
 const ng=A.geometryFrom(observer,target,{partId:"north"}),sg=A.geometryFrom(observer,target,{partId:"south"});
 assert.equal(ng.topM,277.68);assert.ok(Math.abs(ng.azimuth-sg.azimuth)>1);
 assert.equal(A.partTarget(target,"__whole"),target);
 const date=Date.parse("2026-11-04T00:00:00+09:00"),opts={elevationAt:async()=>35,rounds:4,limb:"center"};
 const pn=await A.solvePoint(target,"sun",date,3,"rise",{...opts,partId:"north"}),ps=await A.solvePoint(target,"sun",date,3,"rise",{...opts,partId:"south"});
 assert.ok(pn&&ps);assert.ok(T.distanceKm(pn.latitude,pn.longitude,ps.latitude,ps.longitude)>.04);
});
test("都庁は東西から双塔に見え、南北から重なる公式LOD2",()=>{
 const views=[80,170,260,350].map(b=>A.towerOutline({...T.destination(target.latitude,target.longitude,b,2),elevation:35},target));
 const widths=views.map(o=>Math.max(...o.points.map(p=>p[0]))-Math.min(...o.points.map(p=>p[0])));
 assert.ok(widths[0]>widths[1]*1.5,JSON.stringify(widths));assert.equal(views[0].modelId,"tocho-plateau-lod2-2025");
 for(const o of views){assert.ok(o.approximate);assert.equal(o.polygons,o.hitPolygons);assert.ok(o.points.every(p=>p.every(Number.isFinite)));}
 assert.equal(A.TOCHO_MODEL.buildingId,"bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7");
 assert.equal(A.TOCHO_MODEL.heightM,243.05);
 assert.ok(Math.abs(Math.max(...A.TOCHO_MODEL.vertices.map(p=>p[2]))-260.649)<.001);
 assert.ok(views[0].sourceLabel.includes("PLATEAU"));
 assert.ok(views[0].topAngle>A.geometryFrom({...T.destination(target.latitude,target.longitude,80,2),elevation:35},target).angle);
});
test("双塔の間の上空に当たり判定を作らず、塔の内部には当たる",()=>{
 const obs={...T.destination(target.latitude,target.longitude,80,2),elevation:35},o=A.towerOutline(obs,target),P=A.viewProjector(o.azimuth,(o.topAngle+o.baseAngle)/2),polys=o.polygons.map(p=>p.map(q=>P(...q)));
 const geo=A.geometryFrom(obs,{...target,parts:[{m:35+210}]});
 const gap=P(o.azimuth,geo.angle);assert.ok(Math.min(...polys.map(p=>A.polygonDistance(gap,p)))>.05);
 const n=A.geometryFrom(obs,target,{partId:"north"});const mid=P(n.azimuth,A.geometryFrom(obs,{...A.partTarget(target,"north"),parts:[{m:245}]}).angle);
 assert.equal(Math.min(...polys.map(p=>A.polygonDistance(mid,p))),0);
});

test("LOD2の狭い塔間空間は高倍率でも埋まらず、屋上付属物も輪郭に残る",()=>{
 const obs={...T.destination(target.latitude,target.longitude,90,2),elevation:35};
 const o=A.towerOutline(obs,target),project=A.viewProjector(o.azimuth,(o.topAngle+o.baseAngle)/2);
 const polygons=o.hitPolygons.map(p=>p.map(q=>project(...q)));
 for(const height of [180,210,235]){
  const angle=A.geometryFrom(obs,{...target,parts:[{m:target.groundM+height}]}).angle;
  assert.ok(Math.min(...polygons.map(p=>A.polygonDistance(project(o.azimuth,angle),p)))>.01,`gap at ${height}`);
 }
 const start=performance.now();A.dailyView(obs,target,"moon",Date.parse("2026-11-04T00:00:00+09:00"));
 assert.ok(performance.now()-start<2500,"日別検索が実用時間内に終わる");
});

test("公式頂点の緯度経度を丸めた局所距離から再構成せず保持する",()=>{
 const model=A.TOCHO_MODEL;assert.equal(model.geoVertices.length,model.vertices.length);
 for(const p of model.geoVertices){assert.ok(p.every(Number.isFinite));assert.ok(p[0]>35.6889&&p[0]<35.6901);assert.ok(p[1]>139.6913&&p[1]<139.6921);}
});
