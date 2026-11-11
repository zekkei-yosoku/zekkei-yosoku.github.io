// 手で書くsourceの弱点を「今より増やさない」ための上限。減らしたら数字も下げる。
// 対象: src/ の .js と、生成物・形状データを除いた astronotes-*.js。
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
const manifest=JSON.parse(readFileSync(new URL('src/source-manifest.json',import.meta.url),'utf8'));
const generated=new Set(manifest.generatedAssets.map(a=>a.output));
const walk=dir=>readdirSync(new URL(dir,import.meta.url),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+e.name+'/'):e.name.endsWith('.js')?[dir+e.name]:[]);
const files=[...walk('src/'),...readdirSync(new URL('.',import.meta.url)).filter(n=>/^astronotes-.*\.js$/.test(n)&&!generated.has(n))];
const sources=files.map(f=>[f,readFileSync(new URL(f,import.meta.url),'utf8')]);
const count=re=>sources.reduce((n,[,t])=>n+(t.match(re)||[]).length,0);
const LIMITS={silentCatch:2,staleCounters:36,longLines:584};
test('理由を書かずに失敗を握る catch を増やさない',()=>{
 // 握るなら AstroNotesErrors.note へ渡すか、握ってよい理由を catch の中に書く。
 const n=count(/catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*\}/g);assert.ok(n<=LIMITS.silentCatch,`silent catch ${n} > ${LIMITS.silentCatch}`);
});
test('古い処理を止める番号カウンタを増やさない',()=>{
 // 新しい画面処理は既存の番号を借りるか AbortController を使う。番号を足す前に、どの番号が何を止めるかを確かめる。
 const n=count(/\b\w*(?:Seq|Generation|Epoch|Revision)\s*=\s*0\b|\b(?:seq|generation|revision)\s*=\s*0\b/g);assert.ok(n<=LIMITS.staleCounters,`counters ${n} > ${LIMITS.staleCounters}`);
});
test('300字を超える行を増やさない（形状・暦の数表は除く）',()=>{
 let n=0;for(const [,t] of sources)for(const line of t.split('\n'))if(line.length>300&&!/^\s*(?:\(function\(g\)\{)?(?:"use strict";)?const \w+\s*=\s*[\[{"]/.test(line))n++;
 assert.ok(n<=LIMITS.longLines,`long lines ${n} > ${LIMITS.longLines}`);
});
