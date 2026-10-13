import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import {fixture} from './test-sky-map-ui.mjs';
const flush=()=>new Promise(r=>setImmediate(r));
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
test('観測点配置は中心固定のパンで候補だけ動き、確定まで観測点・計算を変えない',async()=>{
 const f=fixture();await f.open();const original=f.data.get('sorami.skyMap:testuser').observer,loads=f.loads,calls=f.calls;
 f.element('skyMapObserverTool').onclick();assert.equal(f.element('skyMapObserverTool')['aria-pressed'],'true');assert.equal(f.element('skyMapObserverTool')['aria-label'],'観測地点の移動を完了');assert.doesNotMatch(html,/id="skyMapPickConfirm"|id="skyMapPickCancel"|id="skyMapCenter"/);
 f.map.setCenter(35.68,139.77);f.map.redraw();assert.equal(f.loads,loads);assert.equal(f.calls,calls);assert.deepEqual(f.data.get('sorami.skyMap:testuser').observer,original);
 f.map.pick({latitude:0,longitude:0},{x:2,y:2});assert.deepEqual(f.data.get('sorami.skyMap:testuser').observer,original);
 f.element('skyMapObserverTool').onclick();await flush();assert.equal(f.data.get('sorami.skyMap:testuser').observer.latitude,35.68);assert.equal(f.data.get('sorami.skyMap:testuser').observer.longitude,139.77);assert.equal(f.loads,loads+1);
});
test('配置キャンセルは元の観測点を保持し、目標なしでも明示した中心から新規目標を置ける',async()=>{
 const f=fixture();await f.open();const before=f.data.get('sorami.skyMap:testuser').observer;f.element('skyMapObserverTool').onclick();f.map.setCenter(36,140);f.map.double();assert.deepEqual(f.data.get('sorami.skyMap:testuser').observer,before);
 f.element('skyMapTargetTool').onclick();f.map.setCenter(35.7,139.9);f.element('skyMapTargetTool').onclick();assert.equal(f.element('skyMapTargetSheet').open,true);assert.equal(f.element('skyMapPickLatitude').value,'35.7');assert.equal(f.element('skyMapPickLongitude').value,'139.9');
 f.element('skyMapPickName').value='手動目標';f.element('skyMapPickHeight').valueAsNumber=100;f.element('skyMapPickLatitude').value='35.701';f.element('skyMapPickLongitude').value='139.902';await f.element('skyMapPickSave').onclick();await flush();assert.equal(f.data.get('sorami.skyMap:testuser').custom.latitude,35.701);assert.equal(f.data.get('sorami.skyMap:testuser').custom.longitude,139.902);
});
test('空欄・範囲外座標では目標を確定しない',async()=>{
 const f=fixture();await f.open();f.element('skyMapTargetTool').onclick();f.map.setCenter(35.7,139.9);f.element('skyMapTargetTool').onclick();f.element('skyMapPickHeight').valueAsNumber=100;f.element('skyMapPickLatitude').value='';await f.element('skyMapPickSave').onclick();assert.match(f.element('skyMapPickError').textContent,/緯度/);assert.equal(f.element('skyMapTargetSheet').open,true);f.element('skyMapPickLatitude').value='91';await f.element('skyMapPickSave').onclick();assert.equal(f.element('skyMapTarget').value,'');
});
test('日時バーはAim/Sky双方で同じ部品を使い、場所枠と精密照準を共通形状へ揃える',()=>{
 assert.match(html,/ToolDateTimeBar.decorate\(\{footer,row:dateRow/);assert.match(html,/ToolDateTimeBar.decorate\(\{footer:skyFooter/);assert.match(html,/class="place-pick" id="skyMapChoose"/);assert.match(html,/pickMode\?\[width\/2,height\/2\]/);assert.doesNotMatch(html,/ctx.arc\(x,y,14,0,Math.PI\*2\)/);assert.match(html,/ctx.lineWidth=main\?6:5/);assert.match(html,/type="hidden" id="skyMapDate"/);
 for(const m of html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g))new vm.Script(m[1]);
});
function dom(){const nodes=[];const make=()=>{const n={children:[],attrs:{},classList:{add(){}},append(...items){this.children.push(...items)},replaceChildren(...items){this.children=items},setAttribute(k,v){this.attrs[k]=v},focus(){},listeners:{},addEventListener(k,f){this.listeners[k]=f},showModal(){this.open=true},close(){this.open=false;this.listeners.close?.()},querySelector(k){return this.parts[k]??=make()},parts:{}};nodes.push(n);return n;};return {nodes,document:{createElement:make,body:{append(){}}}};}
test('共通カレンダーは月末の選択・年月送りを扱い、時刻の適用を道具側へ委ねる',()=>{
 const d=dom(),c={document:d.document,Date};vm.createContext(c);vm.runInContext(readFileSync(new URL('./sorami-datetime-ui.js',import.meta.url),'utf8'),c);const button=d.document.createElement('button');let chosen;const at=Date.parse('2026-12-22T12:34:00+09:00'),dialog=c.ToolDateTimeBar.calendar({button,getAt:()=>at,setDay:x=>chosen=x});button.onclick();const grid=dialog.querySelector('[data-grid]');const last=grid.children.filter(x=>x.textContent==='31')[0];last.onclick();assert.equal(chosen,Date.parse('2026-12-31T00:00:00+09:00'));button.onclick();dialog.querySelector('[data-next]').onclick();assert.equal(dialog.querySelector('[data-month]').value,'2027-01');
});
test('共通時間バーはつまみを掴むと跳ばず、指を離して確定し、使用不可なら操作しない',()=>{
 const d=dom(),c={document:d.document,Date};vm.createContext(c);vm.runInContext(readFileSync(new URL('./sorami-datetime-ui.js',import.meta.url),'utf8'),c);const track=d.document.createElement('div'),range=d.document.createElement('input');Object.assign(range,{min:0,max:86400,value:43200,getBoundingClientRect:()=>({left:0,width:200})});track.setPointerCapture=()=>{};let inputs=0,commits=0,enabled=true;range.oninput=()=>inputs++;range.onchange=()=>commits++;c.ToolDateTimeBar.wireScrub({track,range,enabled:()=>enabled});const e=(x)=>({pointerId:1,button:0,clientX:x,preventDefault(){}});track.listeners.pointerdown(e(100));assert.equal(inputs,0);track.listeners.pointermove(e(120));assert.ok(Number(range.value)>43200);track.listeners.pointerup(e(120));assert.equal(inputs,1);assert.equal(commits,1);enabled=false;track.listeners.pointerdown(e(10));assert.equal(inputs,1);
});

test('太陽・月の4表示状態は保存され、非表示でも日時と重ねる条件は変えない',async()=>{
 const f=fixture({saved:{at:Date.parse('2026-12-22T12:34:00+09:00'),targetId:'skytree'}});await f.open();const loads=f.loads;
 const state=()=>f.data.get('sorami.skyMap:testuser');const before=state();
 const names=()=>f.element('skyMapAngles').children.map(x=>x.textContent);
 assert.equal(names().length,2);
 f.element('skyMapShowSun').onclick();await flush();assert.equal(names().length,1);assert.match(names()[0],/月/);assert.equal(state().showSun,false);assert.equal(state().showMoon,true);
 f.element('skyMapShowMoon').onclick();await flush();assert.equal(names().length,0);assert.equal(f.element('skyMapEvents').children.length,0);assert.equal(state().showMoon,false);
 f.element('skyMapShowSun').onclick();await flush();assert.equal(names().length,1);assert.match(names()[0],/太陽/);
 f.element('skyMapShowMoon').onclick();await flush();assert.equal(names().length,2);assert.equal(state().at,before.at);assert.equal(state().body,before.body);assert.deepEqual(state().observer,before.observer);assert.equal(state().targetId,before.targetId);assert.equal(f.loads,loads);
 const g=fixture({saved:{...before,showSun:false,showMoon:false}});await g.open();assert.equal(g.element('skyMapAngles').children.length,0);assert.equal(g.element('skyMapShowSun')['aria-pressed'],'false');
});
test('太陽・月を隠しても選択した別の天体は表示できる',async()=>{
 const f=fixture({saved:{body:'sirius',showSun:false,showMoon:false}});await f.open();assert.equal(f.element('skyMapAngles').children.length,1);assert.match(f.element('skyMapAngles').children[0].textContent,/シリウス/);
 assert.match(html,/sky-map-wrap\.sky-map-wide\{position:fixed;inset:0;/);assert.doesNotMatch(html,/sky-map-wide\{[^}]*inset:64px/);
});
test('日付バーは時刻を保持し、時刻バーは同じ日に戻り、モード切替が保留中スクラブを止める',async()=>{
 const at=Date.parse('2026-12-22T12:34:00+09:00'),f=fixture({saved:{at,targetId:'skytree'}});await f.open();const loads=f.loads;
 f.element('skyMapDateMode').onclick();assert.equal(f.element('skyMapRange').min,-730);assert.equal(f.element('skyMapDateMode')['aria-pressed'],'true');f.element('skyMapRange').value='2';f.element('skyMapRange').onchange();await flush();assert.equal(f.element('skyMapDate').value,'2026-12-24');assert.equal(f.element('skyMapTime').value,'12:34');assert.equal(f.loads,loads);
 f.element('skyMapRange').onkeydown({key:'ArrowLeft',shiftKey:false,preventDefault(){}});await flush();assert.equal(f.element('skyMapDate').value,'2026-12-23');assert.equal(f.element('skyMapTime').value,'12:34');
 f.element('skyMapTimeMode').onclick();assert.equal(f.element('skyMapRange').max,86399);f.element('skyMapRange').value='3600';f.element('skyMapRange').onchange();assert.equal(f.element('skyMapDate').value,'2026-12-23');assert.equal(f.element('skyMapTime').value,'01:00');
 f.element('skyMapRange').value='7200';f.element('skyMapRange').oninput();assert.ok(f.c.frame);f.element('skyMapDateMode').onclick();assert.equal(f.c.frame,null);assert.equal(f.element('skyMapTime').value,'01:00');assert.equal(f.data.get('sorami.skyMap:testuser').scrubMode,'date');
 const g=fixture({saved:f.data.get('sorami.skyMap:testuser')});await g.open();assert.equal(g.element('skyMapDateMode')['aria-pressed'],'true');assert.equal(g.element('skyMapTime').value,'01:00');
});
test('地図の動く方角・イベント・高度文字を外し、出入り時刻を時計欄へ固定する',()=>{
 const draw=html.slice(html.indexOf(' function drawBody('),html.indexOf(' const bodyName='));assert.doesNotMatch(draw,/mapLabel\(/);
 const footer=html.slice(html.indexOf('<footer class="sky-map-footer"'),html.indexOf('</footer>',html.indexOf('<footer class="sky-map-footer"')));assert.match(footer,/id="skyMapEvents"/);assert.match(footer,/id="skyMapDateMode"/);assert.match(footer,/id="skyMapTimeMode"/);
 assert.match(html,/sky-map-north/);assert.doesNotMatch(html,/\[\['北',0\],\['東',90\]/);
});

test('時刻バーの矢印とShiftは日付境界で止まり、日付バーのShiftは時刻を保って7日進む',async()=>{
 for(const [clock,key,shift,expected] of [['23:59','ArrowRight',false,'23:59'],['23:55','ArrowRight',true,'23:59'],['00:00','ArrowLeft',false,'00:00'],['00:05','ArrowLeft',true,'00:00'],['12:34','ArrowRight',true,'12:44']]){
  const f=fixture({saved:{at:Date.parse('2026-12-22T'+clock+':00+09:00')}});await f.open();f.element('skyMapRange').onkeydown({key,shiftKey:shift,preventDefault(){}});await flush();assert.equal(f.element('skyMapDate').value,'2026-12-22');assert.equal(f.element('skyMapTime').value,expected);
 }
 const f=fixture({saved:{at:Date.parse('2026-12-22T12:34:00+09:00')}});await f.open();f.element('skyMapDateMode').onclick();f.element('skyMapRange').onkeydown({key:'ArrowRight',shiftKey:true,preventDefault(){}});await flush();assert.equal(f.element('skyMapDate').value,'2026-12-29');assert.equal(f.element('skyMapTime').value,'12:34');
});

test('日付更新中は前の日の出入り時刻を押せず、新しい時刻へ置き換わる',async()=>{
 const f=fixture({saved:{at:Date.parse('2026-12-22T12:34:00+09:00')}});await f.open();const before=f.element('skyMapEvents').children.filter(b=>b.type==='button');assert.ok(before.length);f.element('skyMapNext').onclick();assert.ok(before.every(b=>b.disabled));await flush();const after=f.element('skyMapEvents').children.filter(b=>b.type==='button');assert.ok(after.length);assert.ok(after.every(b=>!b.disabled));assert.notEqual(after[0],before[0]);
});
