import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require=createRequire(import.meta.url),A=require("./sorami-align.js"),T=require("./sorami-terrain.js");
const target=A.targetById("tocho-building");
test("都庁の南北塔は独立した位置で、公式全高を標高と一度だけ加算する",async()=>{
 assert.equal(target.name,"東京都庁 第一本庁舎");assert.ok(A.FUJI_SPOTS.find(s=>s.id==="tocho"));
 const n=A.partTarget(target,"north"),s=A.partTarget(target,"south");
 assert.ok(n.latitude>s.latitude);assert.ok(Math.abs(T.distanceKm(n.latitude,n.longitude,s.latitude,s.longitude)-.064)<.001);
 const observer={...T.destination(target.latitude,target.longitude,80,2),elevation:35};
 const ng=A.geometryFrom(observer,target,{partId:"north"}),sg=A.geometryFrom(observer,target,{partId:"south"});
 assert.equal(ng.topM,278.4);assert.ok(Math.abs(ng.azimuth-sg.azimuth)>1);
 assert.equal(A.partTarget(target,"__whole"),target);
 const date=Date.parse("2026-11-04T00:00:00+09:00"),opts={elevationAt:async()=>35,rounds:4,limb:"center"};
 const pn=await A.solvePoint(target,"sun",date,3,"rise",{...opts,partId:"north"}),ps=await A.solvePoint(target,"sun",date,3,"rise",{...opts,partId:"south"});
 assert.ok(pn&&ps);assert.ok(T.distanceKm(pn.latitude,pn.longitude,ps.latitude,ps.longitude)>.04);
});
test("都庁は東西から双塔に見え、南北から重なる簡易3D",()=>{
 const views=[80,170,260,350].map(b=>A.towerOutline({...T.destination(target.latitude,target.longitude,b,2),elevation:35},target));
 const widths=views.map(o=>Math.max(...o.points.map(p=>p[0]))-Math.min(...o.points.map(p=>p[0])));
 assert.ok(widths[0]>widths[1]*1.5,JSON.stringify(widths));assert.equal(views[0].modelId,"tocho-simple-v1");
 for(const o of views){assert.ok(o.approximate);assert.equal(o.polygons,o.hitPolygons);assert.ok(o.points.every(p=>p.every(Number.isFinite)));}
 assert.equal(Math.max(...A.TOCHO_MODEL.solids.flat().map(p=>p[2])),243.4);
});
test("双塔の間の上空に当たり判定を作らず、塔の内部には当たる",()=>{
 const obs={...T.destination(target.latitude,target.longitude,80,2),elevation:35},o=A.towerOutline(obs,target),P=A.viewProjector(o.azimuth,(o.topAngle+o.baseAngle)/2),polys=o.polygons.map(p=>p.map(q=>P(...q)));
 const geo=A.geometryFrom(obs,{...target,parts:[{m:35+210}]});
 const gap=P(o.azimuth,geo.angle);assert.ok(Math.min(...polys.map(p=>A.polygonDistance(gap,p)))>.05);
 const n=A.geometryFrom(obs,target,{partId:"north"});const mid=P(n.azimuth,A.geometryFrom(obs,{...A.partTarget(target,"north"),parts:[{m:245}]}).angle);
 assert.equal(Math.min(...polys.map(p=>A.polygonDistance(mid,p))),0);
});
