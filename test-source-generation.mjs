// Generated delivery keeps browser scope/order stable while editing source is organized by responsibility.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {renderIndex,releaseIndex,releaseProducts,checkClassicScripts,root} from './tools/build-index.mjs';
test('source reconstructs the complete versioned/CSP delivery byte for byte',()=>{
 const output=releaseIndex();
 assert.equal(output.html,readFileSync(new URL('index.html',import.meta.url),'utf8'));
 assert.equal(new Set(output.sources).size,output.sources.length,'source units occur once, without hidden duplicate definitions');
 assert(!output.html.includes('@@include:'));
});
test('source manifest lists every classic JS unit in exact execution order',()=>{
 const {sources}=renderIndex(),manifest=JSON.parse(readFileSync(new URL('src/source-manifest.json',import.meta.url)));
 const actual=sources.filter(n=>n.endsWith('.js'));
 assert.deepEqual(actual,manifest.legacyRuntimeOrder);
 for(const n of actual){const r=spawnSync(process.execPath,['--check',resolve(root,n)],{encoding:'utf8'});assert.equal(r.status,0,n+': '+r.stderr);}
 const collect=dir=>readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?collect(resolve(dir,e.name)):[resolve(dir,e.name)]);
 const assetSources=manifest.generatedAssets.flatMap(asset=>{const rendered=renderIndex({entry:asset.entry});assert.deepEqual(rendered.sources.filter(n=>n.endsWith('.js')),asset.sourceOrder);return rendered.sources;});
 const all=collect(resolve(root,'src')).filter(n=>/\.(?:js|css|inc|html)$/.test(n));
 assert.deepEqual(all.sort(),[...new Set([...sources,...assetSources])].map(n=>resolve(root,n)).sort(),'no source fragment is left disconnected');
});
test('include resolution rejects traversal and recursive include cycles',()=>{
 const path=resolve(root,'src/index.html');
 assert.throws(()=>renderIndex({read:()=> '@@include:../outside@@'}),/outside src/);
 assert.throws(()=>renderIndex({read:()=> '@@include:src/index.html@@'}),/Circular/);
});

test('every delivery product and rating asset version matches its source',()=>{
 for(const [name,content] of releaseProducts().products)assert.equal(readFileSync(new URL(name,import.meta.url),'utf8'),content,name);
});
test('assembled classic scripts reject duplicate lexical declarations across fragments',()=>{
 checkClassicScripts('<script>const same=1;</script><script>const other=2;</script>');
 assert.throws(()=>checkClassicScripts('<script>const same=1;\nconst same=2;</script>'),SyntaxError);
 assert.throws(()=>checkClassicScripts('<script>const same=1;</script><script>const same=2;</script>'),SyntaxError);
 assert.throws(()=>checkClassicScripts('<script src="old.js"></script><script>let same=2;</script>',()=> 'var same=1;'),SyntaxError);
 assert.throws(()=>checkClassicScripts('<script>owner.defineLegacy("atAim",false);</script><script>function atAim(){}</script>'),SyntaxError);
 assert.throws(()=>checkClassicScripts('<script>owner.defineLegacy("authGeneration",0);</script><script>var authGeneration;</script>'),SyntaxError);
 checkClassicScripts(readFileSync(new URL('index.html',import.meta.url),'utf8'));
});
