import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {LEVELS,VARIABLES,FUJI,physicalFeatures,profileAt,validateLocation,deriveSnapshot,samplePoints,buildURL,captureForecast} from './cap-cloud/atmosphere.mjs';
import {collect,health} from './cap-cloud/collect.mjs';
import {validateObservation,joinObservations} from './cap-cloud/observations.mjs';
const at=Date.parse('2026-09-14T00:00:00Z');
function location(index=0){
 const hourly={time:[at/1000,at/1000+3600,at/1000+7200]},hourly_units={time:'unixtime'};
 for(const key of VARIABLES){
  const base=key.replace(/_\d+hPa$/,''),p=Number(key.match(/_(\d+)hPa$/)[1]),i=LEVELS.indexOf(p);
  const vals={geopotential_height:[1500,2000,3000,4300,5600,7000][i],temperature:15-i*7,relative_humidity:[50,60,75,90,70,30][i],wind_speed:10+i,wind_direction:225};
  hourly[key]=[vals[base],vals[base],vals[base]];
  hourly_units[key]={geopotential_height:'m',temperature:'°C',relative_humidity:'%',wind_speed:'m/s',wind_direction:'°'}[base];
 }
 return {latitude:35+index*.05,longitude:138.75,hourly,hourly_units};
}
const dataset=()=>samplePoints().map((_,i)=>location(i));
const obs=(changes={})=>({observationId:'obs1',eventId:'event1',weatherEpisodeId:'weather1',cameraEra:'era1',label:'CAP_DETACHED',quality:'GOLD',validFrom:'2026-09-14T00:57:00Z',validTo:'2026-09-14T01:03:01Z',reviewedAt:'2026-09-15T00:00:00Z',cameraIds:['east','west'],reviewMethod:'human',reviewerIds:['reviewer'],evidence:[{uri:'local:evidence',sha256:'a'.repeat(64)}],capPresent:true,daylight:true,maxFrameGapSeconds:30,...changes});
const snapshot=()=>({...deriveSnapshot(dataset(),samplePoints(),at+1),rawSha256:'a'.repeat(64),sourceSha256:'b'.repeat(64),rows:deriveSnapshot(dataset(),samplePoints(),at+1).rows.map((r,i)=>({...r,predictionId:'p'+i}))});
test('units are explicit and a fixed model is used',()=>{const u=new URL(buildURL());assert.equal(u.searchParams.get('models'),'gfs_global');assert.equal(u.searchParams.get('wind_speed_unit'),'ms');assert.equal(samplePoints().length,9);assert.equal(u.searchParams.get('elevation').split(',').length,9);});
test('wrong wind units fail instead of silently rescaling',()=>{const r=location();r.hourly_units.wind_speed_700hPa='km/h';assert.throws(()=>validateLocation(r),/単位/);});
test('UV interpolates across 360 degrees without pointing south',()=>{const levels=profileAt(location(),0);levels.forEach(l=>{l.u_ms=l.z_m<3776?1:-1;l.v_ms=-10;});const f=physicalFeatures(levels,at);assert.ok(f.wind_direction_deg<10||f.wind_direction_deg>350);});
test('null is not dry weather',()=>{const r=location();r.hourly.relative_humidity_600hPa[1]=null;assert.throws(()=>physicalFeatures(profileAt(r,1),at),/欠測/);});
test('no summit extrapolation',()=>{const levels=profileAt(location(),0).map(l=>({...l,z_m:l.z_m+9000}));assert.throws(()=>physicalFeatures(levels,at),/外挿/);});
test('flat RH profile has no invented moisture-peak height',()=>{const f=physicalFeatures(profileAt(location(),0).map(l=>({...l,rh_pct:70})),at);assert.equal(f.z_rhmax_minus_summit,null);});
test('windward selection is based on wind FROM',()=>{const s=snapshot();assert.equal(s.rows[0].upwindPoint.bearing,225);assert.equal(s.rows[0].status,'ready');});
test('same model grid is not an independent upwind sample',()=>{const d=dataset();d[6].latitude=d[0].latitude;const s=deriveSnapshot(d,samplePoints(),at+1);assert.equal(s.rows[0].status,'unavailable');});
test('past values and invented model run times are excluded',()=>{const s=snapshot();assert.equal(s.rows.length,2);assert.equal(s.modelIssuedAt,null);assert.equal(s.rows[0].forecastLeadHours,null);assert.ok(s.rows[0].snapshotLeadHours>0);assert.equal(s.uiEnabled,false);});
test('HTTP 429 is preserved and never retried automatically',async()=>{let calls=0,saved;await assert.rejects(captureForecast({fetchImpl:async()=>{calls++;return new Response('{"reason":"limit"}',{status:429,headers:{'retry-after':'60'}})},onResponse:async r=>saved=r}),/429/);assert.equal(calls,1);assert.equal(saved.retryAfter,'60');});
test('two-view >5 minute gold label accepted; exactly 5 min rejected',()=>{assert.equal(validateObservation(obs()).quality,'GOLD');assert.throws(()=>validateObservation(obs({validTo:'2026-09-14T01:02:00Z'})),/5分超/);});
test('obscured cannot become NO_CAP',()=>{assert.throws(()=>validateObservation(obs({label:'MOUNTAIN_OBSCURED',capPresent:false})),/陰性化/);});
test('tsurushi does not imply no cap; subtype is not fabricated',()=>{const j=joinObservations(snapshot(),[obs({label:'TSURUSHI',capPresent:true})]);assert.equal(j.rows[0].label,'CAP');assert.equal(j.rows[0].original_label,'TSURUSHI');});
test('unobserved and unknown coverage are explicit',()=>{const j=joinObservations(snapshot(),[obs({label:'UNKNOWN',capPresent:null,quality:'UNKNOWN'})]);assert.equal(j.rows.length,0);assert.equal(j.coverage.unmatched,1);assert.equal(j.coverage.unknown,1);});
test('conflicting annotations are excluded, not cherry-picked',()=>{const j=joinObservations(snapshot(),[obs(),obs({observationId:'obs2',label:'NO_CAP',capPresent:false})]);assert.equal(j.coverage.conflict,1);assert.equal(j.rows.length,0);});
test('snapshot lead and evidence reach training rows',()=>{const j=joinObservations(snapshot(),[obs()]);assert.equal(j.rows[0].issued_at,null);assert.equal(j.rows[0].forecast_reference_kind,'snapshot');assert.equal(j.rows[0].weather_episode_id,'weather1');assert.equal(j.rows[0].provenance.evidence[0].sha256,'a'.repeat(64));});
test('capture failure creates a failed manifest',async()=>{const dir=await mkdtemp(join(tmpdir(),'fuji-cap-'));const r=await collect(dir,{capture:async()=>{throw Error('offline')}});assert.equal(r.status,'failed');assert.equal((await health(dir)).status,'attention');});
test('saved raw data detects tampering and staleness',async()=>{const dir=await mkdtemp(join(tmpdir(),'fuji-cap-'));const r=await collect(dir,{capture:async()=>({raw:dataset(),request:{},snapshot:snapshot()}),now:()=>at+1});assert.equal(r.status,'success');assert.equal((await health(dir,{now:at+60000})).status,'healthy');assert.equal((await health(dir,{now:at+10*3600000})).status,'attention');await writeFile(join(r.directory,'raw.json'),'changed');assert.deepEqual((await health(dir,{now:at+60000})).integrityErrors,['raw.json']);});
const {readiness,UI_ENABLED}=await import('./cap-cloud/release.mjs');
test('release gate never exposes unvalidated probabilities',()=>{const r=readiness({synthetic:true});assert.equal(r.status,'not_ready');assert.equal(r.uiEnabled,false);assert.equal(r.probability,null);assert.ok(r.reasons.length>=8);});
test('review eligibility still cannot switch UI on',()=>{const r=readiness({synthetic:false,highQualityLabelsVerified:true,longTermDataEvaluated:true,timeLeakageAuditPassed:true,eraHoldoutPassed:true,forecastValidationPassed:true,leadReference:'snapshot',leadSpecificCalibrationPassed:true,brierDeltaVsLogistic95CI:[-.05,-.01],calibrationReviewPassed:true,coverageReviewPassed:true});assert.equal(r.status,'eligible_for_review');assert.equal(UI_ENABLED,false);});
test('saturated layer stays in dataset with peak-interval flag',()=>{const d=dataset();for(const r of d)for(const p of LEVELS)r.hourly[`relative_humidity_${p}hPa`].fill(100);const s=deriveSnapshot(d,samplePoints(),at+1);assert.equal(s.rows[0].status,'ready');assert.equal(s.rows[0].upwind.z_rhmax_minus_summit,null);assert.ok(s.rows[0].featureWarnings.length);});
test('example observation cannot masquerade as real evidence',()=>{assert.throws(()=>joinObservations(snapshot(),[obs({synthetic:true})]),/合成/);});

test('interrupted collection is visible to monitoring',async()=>{const dir=await mkdtemp(join(tmpdir(),'fuji-cap-'));await mkdir(join(dir,'unfinished'));const state=await health(dir);assert.equal(state.status,'attention');assert.deepEqual(state.unreadableRuns,['unfinished']);});

test('review method is explicit and AI cannot be GOLD',()=>{assert.throws(()=>validateObservation(obs({reviewMethod:undefined})),/確認方法/);assert.throws(()=>validateObservation(obs({reviewMethod:'ai'})),/AI仮判定/);const j=joinObservations(snapshot(),[obs({reviewMethod:'ai',quality:'UNKNOWN',label:'UNKNOWN',capPresent:null})]);assert.equal(j.rows.length,0);});
