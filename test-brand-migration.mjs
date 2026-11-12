import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),read=name=>readFileSync(new URL(name,import.meta.url),'utf8');
test('cached HTML legacy assets retain their original bytes and canonical assets exist in root and trial',()=>{
 const {sha256}=JSON.parse(read('legacy-assets.json'));
 const digest=value=>createHash('sha256').update(value).digest('hex');
 for(const [old,hash] of Object.entries(sha256)){
  const name=old.replace(/^sorami-/,'astronotes-');
  for(const prefix of ['','trial/'])assert.equal(createHash('sha256').update(readFileSync(new URL(prefix+old,import.meta.url))).digest('hex'),hash,prefix+old);
  // The trial is a copy of the public app: every canonical asset has the same bytes in both places.
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
 for(const old of Object.keys(sha256).filter(n=>n.endsWith('.js'))){
  // Only the disposable forecast cache changes version. Accounts, records, and all other keys stay stable.
  const expected=identifiers(read(old)).map(id=>old==='sorami-prediction.js'&&id==='sorami-predictions-twilight-v1'?'sorami-predictions-quality-20261107-v1':id).sort();
  // Features added since use further keys and repeat existing ones; none of the earlier identifiers may disappear.
  const current=new Set(identifiers(read(old.replace(/^sorami-/,'astronotes-'))));
  assert.deepEqual(expected.filter(id=>!current.has(id)),[],old);
 }
});
