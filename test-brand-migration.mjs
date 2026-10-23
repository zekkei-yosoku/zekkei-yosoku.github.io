import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
test('cached HTML legacy assets retain their original bytes and canonical assets exist in root and trial',()=>{
 const {sha256}=JSON.parse(read('legacy-assets.json'));
 for(const [old,hash] of Object.entries(sha256)){
  const name=old.replace(/^sorami-/,'astronotes-');
  for(const prefix of ['','trial/'])assert.equal(createHash('sha256').update(readFileSync(new URL(prefix+old,import.meta.url))).digest('hex'),hash,prefix+old);
  assert.equal(read(name),read('trial/'+name),name);
 }
 const html=read('index.html');assert.doesNotMatch(html,/(?:src|href)="sorami-[^"]+\.(?:js|css)/);
});
test('canonical globals publish legacy aliases with the same value',()=>{
 for(const [name,current,legacy] of [['core','AstroNotes','Sorami'],['astro','AstroNotesAstro','SoramiAstro'],['library','AstroNotesLibrary','SoramiLibrary']]){
  const api=require('./astronotes-'+name+'.js');assert.equal(globalThis[current],api);assert.equal(globalThis[legacy],api);
 }
});
test('brand migration retains existing persistence and protocol identifiers',()=>{
 const {sha256}=JSON.parse(read('legacy-assets.json'));
 const identifiers=s=>[...s.matchAll(/["'`](sorami[.:][A-Za-z0-9_.:-]*|sorami-(?:open-meteo|dem|predictions)[A-Za-z0-9_.:-]*|x-sorami-[A-Za-z0-9-]+)["'`]/g)].map(m=>m[1]).sort();
 for(const old of Object.keys(sha256).filter(n=>n.endsWith('.js')))assert.deepEqual(identifiers(read(old.replace(/^sorami-/,'astronotes-'))),identifiers(read(old)),old);
});
