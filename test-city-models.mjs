import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),A=require('./sorami-align.js'),TR=require('./sorami-terrain.js');
const ids=['shibuya-sky','azabudai-hills','kabukicho-tower'];
test('公式3施設の絶対座標・標高と、方位による輪郭変化を保つ',()=>{
 for(const id of ids){const t=A.targetById(id),m=A.CITY_MODELS[id];
  assert.equal(m.vertices.length,m.geoVertices.length);assert.equal(m.provenance.rescaled,false);
  assert.ok(m.sourceUrl.startsWith('https://www.geospatial.jp/ckan/dataset/plateau-'));
  assert.equal(m.heightM,Math.round((t.parts[0].m-t.groundM)*1e6)/1e6);
  const view=b=>A.towerOutline({...TR.destination(t.latitude,t.longitude,b,3),elevation:20},t),o=view(0),q=view(65);
  assert.equal(o.modelId,id+'-plateau-lod2-2025');assert.equal(o.polygons,o.hitPolygons);
  assert.ok(o.points.every(p=>p.every(Number.isFinite)));assert.ok(o.points.length>100);
  const width=o=>Math.max(...o.points.map(p=>p[0]))-Math.min(...o.points.map(p=>p[0]));assert.ok(Math.abs(width(o)-width(q))>1e-5);
  assert.ok(m.triangles.every(f=>f.length===3&&f.every(i=>i>=0&&i<m.vertices.length)));
  const obs={...TR.destination(t.latitude,t.longitude,250,5),elevation:10};const start=performance.now();assert.ok(Array.isArray(A.dailyView(obs,t,'moon',Date.parse('2026-11-04T00:00:00+09:00'))));assert.ok(performance.now()-start<3500,id+'の検索時間');
 }
});
test('渋谷スカイは屋上を狙い、さらに高い付属物と区別する',()=>{const t=A.targetById('shibuya-sky'),m=A.CITY_MODELS[t.id];assert.equal(t.parts[0].name,'屋上（SKY STAGE）');assert.equal(t.parts[0].m,243.637);assert.equal(m.provenance.sourceTopM,245.586);assert.ok(m.provenance.sourceTopM>t.parts[0].m);});
