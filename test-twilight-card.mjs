import {sourceHtml} from './tools/test-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
// 朝夕焼けの時間帯ごとの見込み（API の twilight-phase-v1、2026-10-20）
const require=createRequire(import.meta.url),P=require('./astronotes-prediction.js');
const at=Date.now(),place={latitude:35.7,longitude:139.7};
const phases=()=>[{id:'before',label:'日の入前',window:[at,at+1500000],score:72,models:8},{id:'around',label:'日の入',window:[at+1500000,at+2700000],score:60,models:8},{id:'after',label:'日の入後',window:[at+2700000,at+3600000],score:null,models:0}];
const dto=()=>({schemaVersion:1,algorithmVersion:P.VERSION,place:{...place,elevation:null,eyeHeightAGL:1.5,terrain:null},asOf:at,bundle:{fetchedAt:at,utcOffsetSeconds:32400,home:{byModel:{}}},
 weeks:Object.fromEntries(P.IDS.map(id=>[id,[{dayMs:at,evaluation:{score:70,rank:{key:'good'},factors:[],unavailable:null,...(id==='sunset'?{twilight:{method:'twilight-phase-v1',phases:phases(),best:'before'}}:{})}}]]))});
test('時間帯の見込みは形が合っているときだけ受け取る（無ければ従来どおり）',()=>{
 assert.ok(P.validate(dto(),place));
 const unv=dto();unv.weeks.sunset[0].evaluation.twilight.phases[2].verified=false;assert.ok(P.validate(unv,place));
 const none=dto();delete none.weeks.sunset[0].evaluation.twilight;assert.ok(P.validate(none,place));
 for(const mutate of [t=>t.phases[0].score=101,t=>t.phases[0].score=NaN,t=>t.best='nowhere',t=>t.phases[1].window=[at+5,at],t=>t.phases=[],t=>t.phases[0].label='x'.repeat(40),t=>t.method=1,t=>t.phases[0].verified='yes']){
  const d=dto();mutate(d.weeks.sunset[0].evaluation.twilight);assert.throws(()=>P.validate(d,place));
 }
 const other=dto();other.weeks.starrySky[0].evaluation.twilight={method:'twilight-phase-v1',phases:phases(),best:null};assert.throws(()=>P.validate(other,place),'朝夕以外には付かない');
});
test('詳細に時間帯のカードを出し、注記・検証中・見頃の文字は出さない。古い予測のキャッシュは読み直す',()=>{
 const html=sourceHtml();
 assert.match(html,/\$\{renderTwilight\(ev\)\}/);
 const fn=html.slice(html.indexOf('function renderTwilight('),html.indexOf('// 評価の言葉を主役'));
 assert.doesNotMatch(fn,/見頃|検証中|目安|tw-note|t\.best|verified/,'ユーザー指定で出さない');
 assert.match(html,/S\.phrasing\(ev\.phenomenon, r\)\.label/,'評価の語は上のカードと同じ');
 assert.match(html,/<span class="tw-score">\$\{ok \? Math\.round\(p\.score\) : "—"\}<\/span>/,'点数も出す');
 assert.match(readFileSync(new URL('./astronotes-prediction.js',import.meta.url),'utf8'),/CACHE='sorami-predictions-twilight-v1'/);
});
