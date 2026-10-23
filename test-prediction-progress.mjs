import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import fs from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url),P=require('./astronotes-prediction.js'),place={latitude:35,longitude:139,elevation:0,eyeHeightAGL:1.5,terrain:null},now=Date.now();
const dto=()=>({asOf:now,bundle:{fetchedAt:now,utcOffsetSeconds:32400},place,value:'雲と月'});
const progress=(phase,completed,total)=>({type:'progress',phase,completed,total});
const wire=rows=>rows.map(x=>JSON.stringify(x)+'\n').join('');
const client=transport=>P.createClient({transport,cacheStorage:undefined,now:()=>now,verify:x=>x});
const response=rows=>new Response(wire(rows),{headers:{'content-type':'application/x-ndjson'}});
test('取得・計算の実進捗とUTF8分割を読み、完成DTOだけを保存する',async()=>{
 const events=[],data=wire([progress('fetch',3,6),progress('calculate',4,8),{type:'result',data:dto()}]),bytes=new TextEncoder().encode(data);let requests=0;
 const c=client(async(_url,opts)=>{requests++;assert.equal(opts.headers.accept,'application/x-ndjson');return new Response(new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=7)controller.enqueue(bytes.slice(i,i+7));controller.close();}}),{headers:{'content-type':'application/x-ndjson'}});});
 assert.deepEqual(await c.request(place,{onProgress:p=>events.push(p)}),dto());assert.deepEqual(events.map(e=>e.phase),['fetch','calculate']);assert.equal(requests,1);
 events.length=0;await c.request(place,{onProgress:p=>events.push(p)});assert.equal(requests,1);assert.equal(events[0].phase,'cached');
});
test('同じ要求の複数画面は1通信で最新進捗を共有し、表示失敗で結果を落とさない',async()=>{
 let controller,requests=0;const encoder=new TextEncoder(),seen=[];
 const c=client(async()=>{requests++;return new Response(new ReadableStream({start(x){controller=x;}}),{headers:{'content-type':'application/x-ndjson'}});});
 const a=c.request(place,{onProgress:()=>{throw Error('view');}});while(!controller)await Promise.resolve();controller.enqueue(encoder.encode(wire([progress('fetch',2,6)])));
 const b=c.request(place,{onProgress:p=>seen.push(p)});await Promise.resolve();controller.enqueue(encoder.encode(wire([progress('fetch',3,6),{type:'result',data:dto()}])));controller.close();
 assert.deepEqual(await a,await b);assert.equal(requests,1);assert(seen.some(x=>x.phase==='fetch'&&x.completed===3));
});
test('途中終了・エラー・不正進捗を成功扱いせず、再試行を妨げない',async()=>{
 for(const rows of [[progress('fetch',1,6)],[progress('fetch',7,6)],[{type:'error',message:'private'}],[{type:'result',data:dto()},{type:'result',data:dto()}]]){
  let n=0;const c=client(async()=>++n===1?response(rows):new Response(JSON.stringify(dto())));await assert.rejects(c.request(place));assert.deepEqual(await c.request(place),dto());
 }
});
test('受信本文も45秒期限の対象で、止まったストリームを打ち切る',async t=>{
 t.mock.timers.enable({apis:['setTimeout']});let started=false;
 const c=client(async(_url,{signal})=>{started=true;return new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});}}),{headers:{'content-type':'application/x-ndjson'}});});
 const pending=c.request(place),rejected=assert.rejects(pending,{name:'AbortError'});while(!started)await Promise.resolve();t.mock.timers.tick(45000);await rejected;
});
test('古い画面を更新せず、文字の件数を出さず、バーは段階を跨いで後退しない',()=>{
 const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8'),start=html.indexOf('function renderPredictionProgress('),end=html.indexOf('let loadSeq =',start),nodes=new Map();let visible=true;
 const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',setAttribute(k,v){this[k]=v;},removeAttribute(k){delete this[k];}});return nodes.get(id);};
 const c={loadSeq:2,predictionNeeded:()=>visible,$:node};vm.createContext(c);vm.runInContext(html.slice(start,end),c);
 const bar=node('predictionProgressBar'),fill=node('predictionProgressFill');node('predictionProgressMessage').textContent='予測中です';
 c.renderPredictionProgress({phase:'fetch',completed:6,total:6},2);const fetched=+bar['aria-valuenow'];assert.equal(fetched,43);
 c.renderPredictionProgress({phase:'calculate',completed:0,total:8},2);assert.equal(+bar['aria-valuenow'],fetched);
 c.renderPredictionProgress({phase:'calculate',completed:4,total:8},1);assert.equal(+bar['aria-valuenow'],fetched);
 c.renderPredictionProgress({phase:'calculate',completed:4,total:8},2);assert.equal(+bar['aria-valuenow'],71);assert.match(fill.style,/scaleX/);
 visible=false;c.renderPredictionProgress({phase:'fetch',completed:0,total:6},2);assert.equal(+bar['aria-valuenow'],71);
 visible=true;c.renderPredictionProgress({phase:'finish'},2);assert.equal(+bar['aria-valuenow'],100);
 c.renderPredictionProgress({phase:'prepare'},2);assert.equal(bar['aria-valuenow'],undefined);
 assert.equal(node('predictionProgressMessage').textContent,'予測中です');assert(!html.includes('id="predictionProgressDetail"'));assert.match(html,/transition:transform 450ms ease-out/);assert.match(html,/prefers-reduced-motion:reduce/);
});

test('予測未取得を見どころなしと表示せず、待機中の表を残す',()=>{const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');assert.match(html,/else if \(!bundle\) \{\s*\$\("bestNote"\)\.hidden = true;\s*\$\("cards"\)\.innerHTML = renderSkeleton\(now\);/);});
