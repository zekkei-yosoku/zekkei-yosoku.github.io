import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const source='let aimCustomRequest=0;'+html.slice(html.indexOf('async function aimSetCustomTarget('),html.indexOf('/// 目標の場所のカード',html.indexOf('async function aimSetCustomTarget(')));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function setup(){const pending=[],writes=[],nodes={aimTarget:{value:'skytree'},aimCustomH:{value:'',dataset:{}},aimTargetSub:{}};const ctx={auth:{token:'owner'},atAim:true,$:id=>nodes[id],store:{set:(key,value)=>writes.push(value)},AstroNotesTerrain:{wikidataHeight:async()=>null},aimBuildingAt:()=>null,aimElevation:()=>{const d=deferred();pending.push(d);return d.promise;},aimFillSelects:()=>{},aimApply:()=>{}};vm.createContext(ctx);vm.runInContext(source,ctx);return {ctx,pending,writes,nodes};}
test('対象変更の応答順が逆転しても最後の対象だけを保存する',async()=>{const h=setup();const first=h.ctx.aimSetCustomTarget({name:'first',latitude:35,longitude:139,heightM:1});const last=h.ctx.aimSetCustomTarget({name:'last',latitude:36,longitude:140,heightM:2});h.pending[1].resolve(10);await last;h.pending[0].resolve(9);await first;assert.deepEqual(h.writes.map(x=>x.name),['last']);});
for(const action of ['target','owner','route'])test('標高待ち中の'+action+'変更で古い対象を反映しない',async()=>{const h=setup();const task=h.ctx.aimSetCustomTarget({name:'old',latitude:35,longitude:139,heightM:1});if(action==='target')h.nodes.aimTarget.value='fuji';if(action==='owner')h.ctx.auth={token:'other'};if(action==='route')h.ctx.atAim=false;h.pending[0].resolve(12);await task;assert.equal(h.writes.length,0);});

test('対象の選び直し・画面を往復して同じ値へ戻っても世代を失効する',async()=>{for(const mode of ['target','route']){const h=setup();const task=h.ctx.aimSetCustomTarget({name:'old',latitude:35,longitude:139,heightM:1});vm.runInContext('aimCustomRequest++',h.ctx);h.pending[0].resolve(12);await task;assert.equal(h.writes.length,0);}assert.match(html,/if\(atAim!==!!\(route&&route\.aim\)\)aimCustomRequest\+\+/);assert.match(html,/if\(id==='aimTarget'\)\{aimCustomRequest\+\+/);});
