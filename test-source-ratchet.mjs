// 手で書くsourceの弱点を「今より増やさない」ための上限。減らしたら数字も下げる。
// 対象: src/ の .js と、生成物・形状データを除いた astronotes-*.js。
import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,readdirSync} from 'node:fs';
const manifest=JSON.parse(readFileSync(new URL('src/source-manifest.json',import.meta.url),'utf8'));
const generated=new Set(manifest.generatedAssets.map(a=>a.output));
const walk=dir=>readdirSync(new URL(dir,import.meta.url),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(dir+e.name+'/'):e.name.endsWith('.js')?[dir+e.name]:[]);
const files=[...walk('src/'),...readdirSync(new URL('.',import.meta.url)).filter(n=>/^astronotes-.*\.js$/.test(n)&&!generated.has(n))];
const sources=files.map(f=>[f,readFileSync(new URL(f,import.meta.url),'utf8')]);
const count=re=>sources.reduce((n,[,t])=>n+(t.match(re)||[]).length,0);
const LIMITS={silentCatch:0,longLines:28};
test('理由を書かずに失敗を握る catch を増やさない',()=>{
 // 握るなら AstroNotesErrors.note へ渡すか、握ってよい理由を catch の中に書く。
 const n=count(/catch\s*(?:\(\s*\w*\s*\))?\s*\{\s*\}/g);assert.ok(n<=LIMITS.silentCatch,`silent catch ${n} > ${LIMITS.silentCatch}`);
});
test('古い処理を止める番号は AstroNotesLibrary.gate() を使い、生の番号は名前で許した分だけ',()=>{
 // gate は next()/current(ticket)/cancel() で自分の番号だけを比べる。生の数値を足すなら、採番・透かし用途であることを確かめてここへ名前を足す。
 const RAW=new Set(['generation','opportunityFrameSeq','opportunityWorkerSeq','recordHeightRequestSeq','recordDataEpoch','moonAcceptedSeq']);
 const found=new Set();for(const [,t] of sources)for(const m of t.matchAll(/\b(\w*(?:Seq|Generation|Epoch|Revision)|seq|generation|revision)\s*[=:]\s*0\b/g))found.add(m[1]);
 assert.deepEqual([...found].filter(n=>!RAW.has(n)),[]);
});
test('300字を超える行を増やさない（形状・暦の数表は除く）',()=>{
 let n=0;for(const [,t] of sources)for(const line of t.split('\n'))if(line.length>300&&!/^\s*(?:\(function\(g\)\{)?(?:"use strict";)?const \w+\s*=\s*[\[{"]/.test(line))n++;
 assert.ok(n<=LIMITS.longLines,`long lines ${n} > ${LIMITS.longLines}`);
});
