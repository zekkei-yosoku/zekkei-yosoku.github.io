import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deflateSync,gzipSync} from 'node:zlib';
import {runInNewContext} from 'node:vm';
import {buildMoonMapTrial} from './tools/build-moon-map-trial.mjs';
import {hashCsp} from './tools/release-html.mjs';

const prefix='experiments/moon-map/';
const sourceNames=['src/index.html','src/features/aircraft/controller.js','astronotes-plane.js','astronotes-routes.js','astronotes-datetime-ui.css'];
const sha=value=>createHash('sha256').update(value).digest('hex');
const baseline=name=>readFileSync(new URL(name,import.meta.url),'utf8');
function inputs(changes={}){
 const overlays=Object.fromEntries(sourceNames.map(name=>[prefix+name,baseline(name)]));
 const files={...overlays,...changes};
 return {
  readFile:name=>Object.hasOwn(files,name)?files[name]:baseline(name),
  existsFile:name=>Object.hasOwn(files,name)
 };
}

test('trial builder versions the overlaid assets and preserves inspectable source and output hashes',()=>{
 const plane=baseline('astronotes-plane.js')+'\n// a trial-only engine revision\n';
 const files=buildMoonMapTrial(inputs({[prefix+'astronotes-plane.js']:plane}));
 assert.equal(files['astronotes-plane.js'],plane);
 assert.equal(files['index.html'].match(/astronotes-plane\.js\?v=(\d+)/)[1],BigInt('0x'+sha(plane).slice(0,16)).toString());
 assert.equal(files['app-version.txt'],files['index.html'].match(/name="app-version" content="(\d+)"/)[1]+'\n');
 assert.notEqual(files['app-version.txt'],baseline('app-version.txt'));
 assert.match(files['index.html'],/name="astronotes-data-base" content="\.\.\/data\/"/);
 const revision=JSON.parse(readFileSync(new URL('experiments/moon-map/manifest.json',import.meta.url),'utf8')).revision;
 assert.ok(files['index.html'].includes(`name="astronotes-trial-experiment" content="20261124-moon-route-map-r${revision}"`));
 assert.equal(hashCsp(files['index.html']).html,files['index.html']);
 const manifest=JSON.parse(files['moon-map-experiment.json']);
 assert.equal(manifest.overlaySha256['astronotes-plane.js'],sha(plane));
 assert.equal(manifest.productionSha256['index.html'],sha(baseline('index.html')));
 for(const [name,hash] of Object.entries(manifest.files))assert.equal(sha(files[name]),hash,name);
 assert(!Object.keys(files).some(name=>name.startsWith('src/')),'development source is not copied into trial runtime');
});

test('trial build stops when production source drifts, an overlay is missing, or the allowlist changes',()=>{
 assert.throws(()=>buildMoonMapTrial(inputs({'src/index.html':baseline('src/index.html')+'\n'})),/baseline changed: src\/index.html/);
 const missing=inputs();missing.existsFile=name=>!name.endsWith('/astronotes-plane.js');
 assert.throws(()=>buildMoonMapTrial(missing),/Missing required.*astronotes-plane/);
 const missingRoutes=inputs();missingRoutes.existsFile=name=>!name.endsWith('/astronotes-routes.js');
 assert.throws(()=>buildMoonMapTrial(missingRoutes),/Missing required.*astronotes-routes/);
 const missingStyles=inputs();missingStyles.existsFile=name=>!name.endsWith('/astronotes-datetime-ui.css');
 assert.throws(()=>buildMoonMapTrial(missingStyles),/Missing required.*astronotes-datetime-ui/);
 const manifest=JSON.parse(baseline(prefix+'manifest.json'));
 manifest.overlays[0].path='src/features/account/session-and-access.js';
 assert.throws(()=>buildMoonMapTrial(inputs({[prefix+'manifest.json']:JSON.stringify(manifest)})),/allowlist changed/);
});

test('trial build rejects a duplicate declaration across external and inline classic scripts',()=>{
 const html=baseline('src/index.html').replace('</body>','<script>const plane = 1;</script>\n</body>');
 assert.throws(()=>buildMoonMapTrial(inputs({[prefix+'src/index.html']:html})),SyntaxError);
});

test('an overlaid explore source re-renders the trial explore bundle; untouched sources keep the production bundle',()=>{
 const same=buildMoonMapTrial(inputs({[prefix+'src/features/explore/controller.js']:baseline('src/features/explore/controller.js')}));
 assert.equal(same['astronotes-explore-simple.js'],baseline('astronotes-explore-simple.js'),'an identical overlay renders the production bundle byte for byte');
 const changed=baseline('src/features/explore/controller.js').replace("let mode='scene',","let mode='scene',/*trial-check*/");
 assert.notEqual(changed,baseline('src/features/explore/controller.js'));
 const files=buildMoonMapTrial(inputs({[prefix+'src/features/explore/controller.js']:changed}));
 assert.ok(files['astronotes-explore-simple.js'].includes('/*trial-check*/'));
 assert.equal(files['index.html'].match(/astronotes-explore-simple\.js\?v=(\d+)/)[1],BigInt('0x'+sha(files['astronotes-explore-simple.js']).slice(0,16)).toString());
 assert.equal(JSON.parse(files['moon-map-experiment.json']).files['astronotes-explore-simple.js'],sha(files['astronotes-explore-simple.js']));
 const plain=buildMoonMapTrial(inputs());
 assert.equal(plain['astronotes-explore-simple.js'],undefined,'without an explore overlay the bundle is copied from production');
});

test('trial candidate sources share a byte stream for gzip and deflate, including buffers and offsets',async()=>{
 const files=buildMoonMapTrial();
 const bundle=files['astronotes-candidate-search.js'];
 assert.equal([...bundle.matchAll(/\bdecompressCandidateBytes\(/g)].length,7);
 assert.equal([...bundle.matchAll(/new DecompressionStream\(/g)].length,1);
 const entry=baseline(prefix+'src/features/candidates/entry.inc').split('@@include:')[0];
 const decode=runInNewContext(entry+'\ndecompressCandidateBytes',{ReadableStream,DecompressionStream,Response,Uint8Array});
 const data=Buffer.alloc(300000);
 let state=1;
 for(let i=0;i<data.length;i++){state=(Math.imul(state,1664525)+1013904223)>>>0;data[i]=state>>>24;}
 const gzip=gzipSync(data),deflate=deflateSync(data);
 assert(gzip.length>65536);
 const padded=Buffer.concat([Buffer.from([1,2]),gzip,Buffer.from([3])]);
 const toBuffer=async response=>Buffer.from(await response.arrayBuffer());
 const [gzipData,deflateData]=await Promise.all([
  toBuffer(decode(padded.subarray(2,-1))),
  toBuffer(decode(deflate.buffer.slice(deflate.byteOffset,deflate.byteOffset+deflate.byteLength),'deflate'))
 ]);
 assert.deepEqual(gzipData,data);
 assert.deepEqual(deflateData,data);
 await assert.rejects(toBuffer(decode(Uint8Array.of(1,2,3))));
 assert.deepEqual(await toBuffer(decode(gzip)),data,'a failed stream does not affect another decoder');
});
