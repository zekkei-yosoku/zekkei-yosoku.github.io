import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {VALIDATION_TARGETS,freezeEvaluations} from './record-validation-forecast.mjs';
const S=createRequire(import.meta.url)('./sorami-core.js');
test('7現象と東京近郊の固定6地点を保存対象に含める',()=>{
 assert.deepEqual([...new Set(VALIDATION_TARGETS.flatMap(s=>s.targets))].sort(),Object.keys(S.PHENOMENA).sort());
 assert.equal(VALIDATION_TARGETS.length,10);
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
