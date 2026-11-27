// The moon-map experiment is composed from guarded source overlays. No production file is written.
// build-preview.py owns both generation and --check of the resulting trial delivery products.
import {readFileSync,existsSync} from 'node:fs';
import {relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {renderIndex,renderGeneratedAsset,checkClassicScripts,root} from './build-index.mjs';
import {checkArchitecture} from './check-architecture.mjs';
import {checkUiComponents} from './check-ui-components.mjs';
import {checkModuleGraph} from './check-module-graph.mjs';
import {stripModuleSyntax} from './source-modules.mjs';
import {versionAssets,hashCsp} from './release-html.mjs';

const experiment='experiments/moon-map/';
const allowed=new Map([
 ['src/index.html',true],['src/features/aircraft/controller.js',true],['astronotes-plane.js',true],
 ['astronotes-routes.js',true],['astronotes-datetime-ui.css',true],['src/source-manifest.json',false],
 // 2026-11-25 重なる日の一覧の詰め方と、見え方の「対象に合わせる」釦（trialで試す）
 ['astronotes-myplaces.js',false],['src/features/framing/scene/render.js',false],['src/features/framing/presentation.js',false],
 // 2026-11-26 探すを全画面地図にする段階①（trialで試す）
 ['src/features/explore/controller.js',false],['src/features/explore/map-presentation.js',false],['astronotes-map-workspace.js',false],['astronotes-map-workspace.css',false],
 // 2026-11-26 段階②: 目標物が中心から探す新しい地点は、探索の種を重なる範囲（帯）に絞る
 ['src/features/candidates/ui.js',false],['src/features/candidates/generic-search.js',false],
 // 2026-11-26 段階④: 点天体の夜間条件を地図と候補の最終判定で共有する
 ['astronotes-shooting.js',false],
 // 2026-11-27 対象を追加する入口を試用版の共通対象選択に出す
 ['astronotes-target-ui.js',false],
 // 時刻バーのラベルを左端のフェードに掛けない
 ['astronotes-scroll-timeline.js',false],
 // Shared height inputs and browser-independent candidate bytes in the trial.
 ['src/ui/presentation-helpers.js',false],
 ['src/features/framing/observer.js',false],
 ['src/features/candidates/entry.inc',false],
 ['src/features/candidates/building-model.js',false],
 ['src/features/candidates/terrain-model.js',false],
 ['src/features/candidates/height-grid.js',false],
 ['src/features/candidates/plateau-buildings.js',false],
 ['src/features/candidates/osm-places.js',false],
 ['src/features/candidates/tree-heights.js',false],
 ['src/features/satellites/controller.js',false],['src/features/satellites/state.js',false],['astronotes-iss.js',false],['src/features/places/search.js',false],['src/ui/map/picker.js',false]
]);
const guarded=['index.html','app-version.txt',...allowed.keys()];
const digest=value=>createHash('sha256').update(value).digest('hex');
const replaceOnce=(source,from,to)=>{
 if(source.split(from).length!==2)throw Error('Moon-map trial source boundary changed: '+from);
 return source.replace(from,()=>to);
};

export function buildMoonMapTrial({directory=root,
 readFile=name=>readFileSync(resolve(directory,name)),
 existsFile=name=>existsSync(resolve(directory,name))}={}){
 const manifest=JSON.parse(readFile(experiment+'manifest.json'));
 if(manifest.schemaVersion!==1||manifest.id!=='20261124-moon-route-map'||
    !Number.isInteger(manifest.revision)||manifest.revision<1||
    !/^[a-f0-9]{40}$/.test(manifest.baselineCommit))throw Error('Invalid moon-map experiment identity');
 if(!Array.isArray(manifest.overlays)||manifest.overlays.length!==allowed.size||
    new Set(manifest.overlays.map(entry=>entry.path)).size!==allowed.size||
    manifest.overlays.some(entry=>!allowed.has(entry.path)||allowed.get(entry.path)!==entry.required)){
  throw Error('Moon-map overlay allowlist changed; review its source and delivery contract');
 }
 if(!manifest.baselineSha256||Object.keys(manifest.baselineSha256).length!==guarded.length||
    guarded.some(name=>!Object.hasOwn(manifest.baselineSha256,name))){
  throw Error('Incomplete moon-map baseline guards');
 }
 for(const name of guarded){
  if(digest(readFile(name))!==manifest.baselineSha256[name]){
   throw Error('Moon-map production baseline changed: '+name+'; review the overlay before rebuilding');
  }
 }
 const overlays=new Map();
 for(const {path,required} of manifest.overlays){
  const name=experiment+path;
  if(existsFile(name))overlays.set(path,String(readFile(name)));
  else if(required)throw Error('Missing required moon-map source overlay: '+name);
 }
 const read=name=>overlays.has(name)?overlays.get(name):String(readFile(name));
 const sourceManifest=JSON.parse(read('src/source-manifest.json'));
 const baselineManifest=JSON.parse(readFile('src/source-manifest.json'));
 // Generated bundles and execution order remain production-owned in this experiment.
 for(const key of Object.keys(baselineManifest).filter(name=>name!=='architecture'&&name!=='uiComponents')){
  if(JSON.stringify(sourceManifest[key])!==JSON.stringify(baselineManifest[key])){
   throw Error('Moon-map source manifest changes unsupported production contract: '+key);
  }
 }
 checkArchitecture(sourceManifest,name=>name.startsWith('src/')&&name.endsWith('.js')?
  stripModuleSyntax(read(name)):read(name));
 checkModuleGraph(sourceManifest,read);
 checkUiComponents(sourceManifest.uiComponents,sourceManifest,read);
 const rendered=renderIndex({directory,read:path=>read(relative(directory,path).split(sep).join('/'))});
 if(JSON.stringify(rendered.sources.filter(name=>name.endsWith('.js')))!==JSON.stringify(sourceManifest.legacyRuntimeOrder)){
  throw Error('Moon-map source execution order changed');
 }
 const files={};
 for(const [name,content] of overlays)if(!name.startsWith('src/'))files[name]=content;
 // A generated bundle whose source is overlaid is re-rendered from the overlay through the production
 // renderer (same compatibility prefixes and data hashes); untouched bundles stay production copies.
 for(const asset of sourceManifest.generatedAssets){
  if(!asset.sourceOrder.some(name=>overlays.has(name)))continue;
  // The renderer reads these companions from production; an overlaid companion would be silently ignored.
  const companions=[asset.legacyAccessPolicy&&'astronotes-access.js',asset.legacyShapeLoader,...Object.values(asset.dataFiles||{})].filter(Boolean);
  if(companions.some(name=>overlays.has(name)))throw Error('Moon-map trial cannot overlay a generated asset companion: '+asset.output);
  const bundle=renderGeneratedAsset(asset,{directory,read:path=>read(relative(directory,path).split(sep).join('/'))});
  if(JSON.stringify(bundle.sources.filter(name=>name.endsWith('.js')))!==JSON.stringify(asset.sourceOrder))throw Error('Moon-map generated source order changed: '+asset.output);
  files[asset.output]=bundle.html;
 }
 const readAsset=name=>Object.hasOwn(files,name)?files[name]:readFile(name);
 let html=replaceOnce(rendered.html,'<title>AstroNotes</title>',
  '<title>AstroNotes 試用版</title>\n<meta name="astronotes-data-base" content="../data/">'+
  '\n<meta name="astronotes-trial-experiment" content="'+manifest.id+'-r'+manifest.revision+'">');
 html=replaceOnce(html,'name="apple-mobile-web-app-title" content="AstroNotes"',
  'name="apple-mobile-web-app-title" content="AstroNotes 試用版"');
 html=replaceOnce(html,'  <div class="masthead">',
  '  <p style="position:relative;z-index:1;font-size:12px;padding:6px 2px;color:var(--secondary)">'+
  '試用版 · 本番とアカウント・保存データ共通 <a href="../">本番へ</a></p>\n  <div class="masthead">');
 const versioned=versionAssets(html,readAsset);
 files['index.html']=hashCsp(versioned.html).html;
 checkClassicScripts(files['index.html'],readAsset);
 files['app-version.txt']=versioned.id+'\n';
 files['moon-map-experiment.json']=JSON.stringify({
  schemaVersion:1,id:manifest.id,revision:manifest.revision,baselineCommit:manifest.baselineCommit,
  productionSha256:manifest.baselineSha256,
  overlaySha256:Object.fromEntries([...overlays].map(([name,content])=>[name,digest(content)])),
  files:Object.fromEntries(Object.entries(files).map(([name,content])=>[name,digest(content)]))
 },null,2)+'\n';
 return files;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 process.stdout.write(JSON.stringify(buildMoonMapTrial()));
}
