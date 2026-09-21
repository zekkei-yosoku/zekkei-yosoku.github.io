import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {VALIDATION_TARGETS,freezeEvaluations} from './record-validation-forecast.mjs';
const S=createRequire(import.meta.url)('./sorami-core.js');
// **保存対象は `SCORERS` で決まる。`PHENOMENA` ではない。**
// 富士山・月・笠雲は sorami-fuji.js / sorami-moon.js / sorami-capcloud.js が採点していて core の `evaluate` を
// 通らないので、この仕組み（S.evaluate を呼んで凍結する）には乗らない。
// PHENOMENA には表へ並べるための名前だけが入っている（富士山と月は 2026-09-14、笠雲は 2026-09-15 に足した）。
// 2026-09-21: 朝夕焼けの定点カメラ4地点を追加して 10→14。再解析では視程・気圧面湿度・
// エアロゾルが取れず採点規則の半分が発火しないので、同じ土俵で測れる発表時点の予報を貯める。
test('core が採点する7現象と、固定10地点＋定点カメラ4地点を保存対象に含める',()=>{
 assert.deepEqual([...new Set(VALIDATION_TARGETS.flatMap(s=>s.targets))].sort(),Object.keys(S.SCORERS).sort());
 assert.equal(VALIDATION_TARGETS.length,14);
});
test('表に並ぶ現象のうち、core が採点しないものは保存対象に含めない',()=>{
 const scored=new Set(Object.keys(S.SCORERS));
 const listed=Object.keys(S.PHENOMENA).filter(id=>!scored.has(id));
 // 笠雲を足した 2026-09-15 にこの期待値を直し忘れ、落ちたまま配信していた（2026-09-17 に発見して修正）。
 // 保存対象から外す仕組み自体は正しく動いていた（下の assert は通っていた）。
 assert.deepEqual(listed.sort(),['capCloud','fuji','moon']);
 const targets=new Set(VALIDATION_TARGETS.flatMap(s=>s.targets));
 for(const id of listed) assert.ok(!targets.has(id),`${id} は保存対象に入れない`);
});
test('始まった回を事前予測と偽らず、取得不能と未観測も区別する',()=>{
 const original=S.evaluate,now=Date.parse('2026-09-06T12:00:00+09:00');
 S.evaluate=(_,day)=>({window:[day+6*3600000,day+8*3600000],score:0,unavailable:{kind:'missingData'}});
 try {
  const rows=freezeEvaluations({id:'test',targets:['seaOfClouds']},{utcOffsetSeconds:32400},now,2);
  assert.equal(rows.length,1);assert.equal(rows[0].date,'2026-09-07');
  assert.equal(rows[0].leadHours,18);assert.equal(rows[0].observedQuality,null);
  assert.equal(rows[0].predictionStatus,'unavailable');assert.equal(rows[0].observationStatus,'pending');
 } finally{S.evaluate=original;}
});
