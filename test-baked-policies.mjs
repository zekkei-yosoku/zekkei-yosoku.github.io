// tools/ の方針モジュールは単体で検査している。配信物に同じ文面が入っていることをここで保証し、片方だけの変更を止める。
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
const delivered=readdirSync(new URL('.',import.meta.url)).filter(n=>/^(astronotes-.*\.js|overlap-calculation.*\.js|index\.html)$/.test(n)).map(n=>readFileSync(new URL(n,import.meta.url),'utf8')).join('\n');
const modules={
 'record-alignment-policy':['createRecordAlignmentPolicy'],'record-height-policy':['createRecordHeightPolicy'],'record-height-preference':['preferRecordHeight'],'record-height-scan':['scanRecordHeights'],
 'record-opportunity-scan':['createOpportunityScan'],'record-search-cache':['createRecordSearchCache'],'record-sort-policy':['createRecordSort'],'record-transfer-policy':['createRecordTransfer'],
 'server-opportunity-preferences':['createServerOpportunityPreferences','geometricOpportunitySettings'],'server-opportunity-scan':['createServerOpportunityScan'],'overlap-scope-policy':['createOverlapPolicy'],
 'native-ground-point':['createNativeGroundPoint'],'exact-polygon-distance':['exactScaledPolygonDistance','prepareExactPolygonDistance'],'exact-time-memo':['createExactTimeMemo'],'preview-path-runs':['nearestPathRun','visibleDayRuns'],
 'exact-terrain-batch':['createExactTerrainBatch'],'indexed-search-ridge':['createIndexedSearchRidge'],'resident-ridge-index':['createResidentHeightIndex'],'ridge-fan-bounds':['createMetricFanBounds','ridgeZoomRange'],
};
test('検査済みの方針関数は、配信物に同じ文面で入っている',async()=>{
 for(const [name,exports] of Object.entries(modules)){const loaded=await import(`./tools/${name}.mjs`);for(const key of exports){assert.equal(typeof loaded[key],'function',`${name}.${key}`);assert.ok(delivered.includes(loaded[key].toString()),`${name}.${key} が配信物と違う`);}}
});
test('検査が読むruntimeの写しは、配信物から3行を超えて離れない',()=>{
 for(const [name,allowed] of [['record-discovery-runtime.js',0],['record-transfer-runtime.js',0],['record-search-runtime.js',3]]){
  const lines=readFileSync(new URL('./tools/'+name,import.meta.url),'utf8').split('\n').map(l=>l.trim()).filter(Boolean),missing=lines.filter(l=>!delivered.includes(l));
  assert.ok(missing.length<=allowed,`${name}: ${missing.length}行が配信物に無い\n${missing.slice(0,3).join('\n')}`);
 }
});
