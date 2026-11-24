import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
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
