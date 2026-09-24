import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const ctx={};vm.runInNewContext(fs.readFileSync(new URL('./sorami-cap-cloud.js',import.meta.url),'utf8'),ctx);const {view,render}=ctx.SoramiCapCloud;
const now=Date.parse('2026-09-15T01:00:00Z'),snap=()=>({capturedAt:new Date(now-1000).toISOString(),rows:[{validAt:'2026-09-15T02:00:00Z',status:'ready',upwind:{rh_summit:93,wind_speed:10,moist_peak_base_m:3600,moist_peak_top_m:4300}}]});
test('shows physical values without an occurrence score',()=>{const v=view(snap(),now,now),h=render(v);assert.equal(v.probability,null);assert.match(h,/93%/);assert.match(h,/10.0m\/s/);assert.match(h,/未検証/);assert.match(h,/雲の厚さを意味しません/);});
test('expired data is not presented as current',()=>{const s=snap();s.capturedAt=new Date(now-7200000).toISOString();assert.equal(view(s,now,now).status,'unavailable');});
test('forecast range is limited and past hours omitted',()=>{assert.equal(view(snap(),now+7*86400000,now).status,'outside');assert.equal(view(snap(),now,now+2*3600000).status,'unavailable');});
test('missing rows cannot become dry air',()=>{const s=snap();s.rows[0].status='unavailable';assert.match(render(view(s,now,now)),/計算できません/);});
test('unavailable message is escaped',()=>{assert.doesNotMatch(render({status:'unavailable',message:'<script>'}),/<script>/);});
