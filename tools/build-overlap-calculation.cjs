'use strict';
// Trusted-source extraction only. Never run against downloaded or user-supplied code.
// Same extraction as api/overlap-worker/build-bundle.cjs, so the device frame runs the
// server's verified engine byte for byte when built from the same trial sources.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const hash=x=>crypto.createHash('sha256').update(x).digest('hex');
function buildBundle(webRoot,trialDir=path.join(webRoot,'trial')){
 const root=fs.realpathSync(webRoot),trial=fs.realpathSync(trialDir);
 const {parse,scan}=require(path.join(root,'tools/module-scan.cjs'));
 const read=name=>fs.readFileSync(path.join(trial,name),'utf8');
 const html=read('index.html'),myplaces=read('astronotes-myplaces.js');
 const inline=[...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(x=>x[1]).filter(s=>s.includes('function aimSavedFrom(p)'));
 if(inline.length!==1)throw Error('inline boundary');
 const index=inline[0],iAst=parse(index,'script'),mAst=parse(myplaces,'script');
 const scopes=mAst.body.filter(n=>n.type==='ExpressionStatement'&&n.expression.type==='CallExpression'&&n.expression.callee.type==='FunctionExpression');
 if(scopes.length!==1)throw Error('myplaces boundary');
 const entries=new Map();
 function collect(src,nodes,source){for(const node of nodes){
  if(node.type==='FunctionDeclaration')entries.set(node.id.name,{name:node.id.name,source,start:node.start,code:src.slice(node.start,node.end)});
  if(node.type==='VariableDeclaration')for(const d of node.declarations)if(d.id.type==='Identifier')entries.set(d.id.name,{name:d.id.name,source,start:d.start,code:node.kind+' '+src.slice(d.start,d.end)+';'});
 }}
 collect(index,iAst.body,'index.html');collect(myplaces,scopes[0].expression.callee.body.body,'astronotes-myplaces.js');
 const libraries=['astro','refraction','atmosphere','bodies','terrain','tower-models','city-models','align','shooting','library','access'].map(n=>'astronotes-'+n+'.js');
 const globals=new Set(['Array','ArrayBuffer','Boolean','Date','Error','Float64Array','Int8Array','Int16Array','Int32Array','Uint16Array','Uint32Array','Float32Array','Infinity','JSON','Map','Math','MessageChannel','NaN','Number','Object','Promise','RangeError','Set','String','WeakMap','Uint8Array','clearInterval','clearTimeout','document','globalThis','performance','setInterval','setTimeout','structuredClone','undefined','encodeURIComponent','parseFloat','parseInt','crypto']);
 const environment=new Set(['auth','accessState','version','aimAirSettings','favorites','store','toolAllowed','AstroNotesAssets','sheetState','aim','S','aimCustomTarget']);
 for(const n of ['Astro','Refraction','Atmosphere','Bodies','Terrain','TowerModels','CityModels','Align','Shooting','Library','Access'])globals.add('AstroNotes'+n);
 const selected=new Map(),queue=['cleanFavorite','opportunityPairs','recordSearch','recordEventOptions'];
 while(queue.length){const name=queue.shift();if(selected.has(name)||globals.has(name)||environment.has(name))continue;const entry=entries.get(name);if(!entry)throw Error('unresolved extraction dependency: '+name);selected.set(name,entry);for(const free of scan(parse(entry.code,'script')).free)if(!selected.has(free))queue.push(free);}
 const extracted=[...selected.values()].sort((a,b)=>a.source===b.source?a.start-b.start:a.source==='index.html'?-1:1);
 const files=Object.fromEntries(libraries.map(n=>[n,read(n)]));
 // This is the sole numerical source change: atmosphere sees one captured clock per job.
 files['astronotes-atmosphere.js']=files['astronotes-atmosphere.js'].replaceAll('Date.now()','globalThis.__overlapClock()');
 const atmosphereExport='global.AstroNotesAtmosphere={';
 if(files['astronotes-atmosphere.js'].split(atmosphereExport).length!==2)throw Error('atmosphere snapshot boundary');
 files['astronotes-atmosphere.js']=files['astronotes-atmosphere.js'].replace(atmosphereExport,`function resetSnapshot(){if(pending.size||linePending.size)throw Error('atmosphere fetch pending');records.clear();lines.clear();lineList=[];lineVersion++;lineListVersion=-1;}
  global.AstroNotesAtmosphere={resetSnapshot,`);
 const adapter=fs.readFileSync(path.join(__dirname,'overlap-calculation-adapter.js'),'utf8');
 const env=`let auth={token:'isolated-calculation',loginId:'isolated',tools:[]},accessState={generation:0},version=0,aimAirSettings={mode:'auto'},favorites=[],sheetState=null,aim={sharedTarget:null};
 const S={PHENOMENA:Object.create(null)};
 let values=Object.create(null);const store={get:(key,fallback)=>Object.hasOwn(values,key)?values[key]:fallback};
 const toolAllowed=name=>auth.tools.includes(name);
 const AstroNotesAssets={modelsReady:()=>true,ensureModels:()=>Promise.resolve()};
 const aimCustomTarget=()=>null;
 `;
 const source=`globalThis.__overlapNow=Date.now();globalThis.__overlapClock=()=>globalThis.__overlapNow;\n`+
  libraries.map(n=>files[n]).join('\n')+'\n(function(){"use strict";\n'+env+extracted.map(x=>x.code).join('\n')+'\n'+adapter+'\n})();';
 // Astronomy must be present before Bodies captures it.
 const final=source.replace(files['astronotes-bodies.js'],read('vendor/astronomy-engine-2.1.19.min.js')+'\n'+files['astronotes-bodies.js']);
 parse(final,'script');
 const manifest={schema:'astronotes.overlap.bundle.v1',version:read('app-version.txt').trim(),files:Object.fromEntries(libraries.map(n=>[n,hash(read(n))])),extraction:extracted.map(({name,source,start,code})=>({name,source,start,sha256:hash(code)})),adapterHash:hash(adapter),sha256:hash(final)};
 return {source:final,manifest};
}
module.exports={buildBundle};
if(require.main===module){const web=process.argv[2],out=process.argv[3],trialDir=process.argv[4];if(!web||!out)throw Error('Usage: build-overlap-calculation.cjs WEB_ROOT OUTPUT_DIRECTORY [TRIAL_DIRECTORY]');const bundle=buildBundle(web,trialDir);fs.mkdirSync(out,{recursive:true});fs.writeFileSync(path.join(out,'calculation.js'),bundle.source);fs.writeFileSync(path.join(out,'manifest.json'),JSON.stringify(bundle.manifest,null,2)+'\n');console.log(JSON.stringify({built:true,version:bundle.manifest.version,sha256:bundle.manifest.sha256,functions:bundle.manifest.extraction.length}));}
