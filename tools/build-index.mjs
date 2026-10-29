// src is the editing source. Delivery products retain classic scope/order and old asset URLs.
import {readFileSync,writeFileSync,renameSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve,relative,sep} from 'node:path';
import {versionAssets,hashCsp,versionRating} from './release-html.mjs';
import vm from 'node:vm';
import {checkArchitecture} from './check-architecture.mjs';
export const root=fileURLToPath(new URL('../',import.meta.url));
export function renderIndex({entry='src/index.html',directory=root,read=path=>readFileSync(path,'utf8')}={}){
 const base=resolve(directory),seen=[];
 function include(name,stack=[]){
  const target=resolve(base,name),rel=relative(base,target);
  if(!rel.startsWith('src'+sep)||rel.split(sep).includes('..'))throw Error('Source include outside src: '+name);
  if(stack.includes(target))throw Error('Circular source include: '+name);
  seen.push(rel.split(sep).join('/'));
  return read(target).replace(/@@include:([^@]+)@@/g,(_,next)=>include(next,[...stack,target]));
 }
 return {html:include(entry),sources:seen};
}
export function checkClassicScripts(html,readExternal){
 const globalScripts=[];
 for(const [,attrs,body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){
  const src=attrs.match(/\bsrc="([^"?]+)(?:\?[^"]*)?"/);
  const code=src?(readExternal?String(readExternal(src[1])):null):body;
  if(code?.trim()){new vm.Script(code);globalScripts.push(code);}
 }
 // Classic tags share one global lexical environment. Parsing each tag alone
 // misses a let/const/class collision with a different tag or external script.
 const combined=globalScripts.join('\n;\n');
 const bridges=[...new Set([...combined.matchAll(/\.defineLegacy\(["']([A-Za-z_$][\w$]*)["']/g)].map(m=>m[1]))];
 // Accessor-backed legacy names must never be shadowed by a later classic
 // declaration. Treat them as lexical declarations for the static guard.
 new vm.Script((bridges.length?'let '+bridges.join(',')+';\n':'')+combined);
}
export function releaseProducts(directory=root){
 const manifest=JSON.parse(readFileSync(resolve(directory,'src/source-manifest.json'),'utf8')),products=new Map(),sources=[];
 checkArchitecture(manifest,name=>readFileSync(resolve(directory,name),'utf8'));
 for(const asset of manifest.generatedAssets){
  if(!/^astronotes-[\w-]+\.js$/.test(asset.output))throw Error('Invalid generated asset output');
  const result=renderIndex({entry:asset.entry,directory});
  if(asset.legacyAccessPolicy){
   // Old cached HTML can combine an old access object with a freshly fetched Explore.
   // Generate the compatibility method from the one canonical policy, never a hand copy.
   const context=vm.createContext({});vm.runInContext(readFileSync(resolve(directory,'astronotes-access.js'),'utf8'),context);
   const policy=context.AstroNotesAccess.canFrame.toString();
   result.html='(function(root){if(root.AstroNotesAccess&&!root.AstroNotesAccess.canFrame)root.AstroNotesAccess.canFrame='+policy+';})(globalThis);\n'+result.html;
  }
  new vm.Script(result.html,{filename:asset.output});
  products.set(asset.output,result.html);sources.push(...result.sources);
 }
 const rendered=renderIndex({directory});sources.push(...rendered.sources);
 const readAsset=name=>products.has(name)?products.get(name):readFileSync(resolve(directory,name));
 const versioned=versionAssets(rendered.html,readAsset),csp=hashCsp(versioned.html);
 checkClassicScripts(csp.html,readAsset);products.set('index.html',csp.html);
 products.set('sky-rating.html',versionRating(readFileSync(resolve(directory,'sky-rating.html'),'utf8'),readAsset));
 return {products,sources,hashes:csp.hashes};
}
export function releaseIndex(directory=root){const result=releaseProducts(directory);return {html:result.products.get('index.html'),sources:renderIndex({directory}).sources,hashes:result.hashes};}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const check=process.argv.includes('--check'),result=releaseProducts();
 // Validate every product before writing anything. Each replacement is atomic;
 // assets are written before the HTML that names their new content versions.
 for(const [name,content] of result.products){
  const target=resolve(root,name);
  if(check){if(readFileSync(target,'utf8')!==content)throw Error('Generated output is stale: '+name+' (run ./bump.sh, then python3 build-preview.py)');}
  else{const tmp=target+'.build-'+process.pid;writeFileSync(tmp,content);renameSync(tmp,target);}
 }
 console.log(`${check?'Verified':'Built'} ${result.products.size} delivery products; ${new Set(result.sources).size} source units; ${result.hashes.length} inline CSP hashes`);
}
