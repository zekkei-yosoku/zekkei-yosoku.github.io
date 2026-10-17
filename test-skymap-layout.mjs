import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync} from 'node:fs';import vm from 'node:vm';import {fixture} from './test-sky-map-ui.mjs';import {createRequire} from 'node:module';const createRequireFn=createRequire(import.meta.url);
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
 const d=dom(),c={document:d.document,Date};vm.createContext(c);vm.runInContext(readFileSync(new URL('./sorami-datetime-ui.js',import.meta.url),'utf8'),c);const button=d.document.createElement('button');let chosen;const at=Date.parse('2026-12-22T12:34:00+09:00'),dialog=c.ToolDateTimeBar.calendar({button,getAt:()=>at,setDay:x=>chosen=x});button.onclick();const grid=dialog.querySelector('[data-grid]');const last=grid.children.filter(x=>x.textContent==='31')[0];last.onclick();assert.equal(chosen,Date.parse('2026-12-31T00:00:00+09:00'));button.onclick();dialog.querySelector('[data-next]').onclick();assert.equal(dialog.querySelector('[data-year]').value,'2027');assert.equal(dialog.querySelector('[data-month]').value,'0');
 dialog.querySelector('[data-year]').value='2028';dialog.querySelector('[data-month]').value='2';dialog.querySelector('[data-month]').onchange();assert.equal(dialog.querySelector('[data-year]').value,'2028');assert.equal(dialog.querySelector('[data-month]').value,'2');assert.ok(grid.children.some(x=>x['aria-label']==='2028年3月1日'||x.attrs?.['aria-label']==='2028年3月1日'));
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
 f.element('skyMapScrubMode').onclick();assert.equal(f.element('skyMapRange').min,-7);assert.equal(f.element('skyMapScrubMode').dataset.mode,'date');f.element('skyMapRange').value='2';f.element('skyMapRange').onchange();await flush();assert.equal(f.element('skyMapDate').value,'2026-12-24');assert.equal(f.element('skyMapTime').value,'12:34');assert.equal(f.loads,loads);
 f.element('skyMapRange').onkeydown({key:'ArrowLeft',shiftKey:false,preventDefault(){}});await flush();assert.equal(f.element('skyMapDate').value,'2026-12-23');assert.equal(f.element('skyMapTime').value,'12:34');
 f.element('skyMapScrubMode').onclick();assert.equal(f.element('skyMapRange').max,86399);f.element('skyMapRange').value='3600';f.element('skyMapRange').onchange();assert.equal(f.element('skyMapDate').value,'2026-12-23');assert.equal(f.element('skyMapTime').value,'01:00');
 f.element('skyMapRange').value='7200';f.element('skyMapRange').oninput();assert.ok(f.c.frame);f.element('skyMapScrubMode').onclick();assert.equal(f.c.frame,null);assert.equal(f.element('skyMapTime').value,'01:00');assert.equal(f.data.get('sorami.skyMap:testuser').scrubMode,'date');
 const g=fixture({saved:f.data.get('sorami.skyMap:testuser')});await g.open();assert.equal(g.element('skyMapScrubMode').dataset.mode,'date');assert.equal(g.element('skyMapTime').value,'01:00');
});
test('地図の動く方角・イベント・高度文字を外し、出入り時刻を時計欄へ固定する',()=>{
 const draw=html.slice(html.indexOf(' function drawBody('),html.indexOf(' const bodyName='));assert.doesNotMatch(draw,/mapLabel\(/);
 const footer=html.slice(html.indexOf('<footer class="sky-map-footer"'),html.indexOf('</footer>',html.indexOf('<footer class="sky-map-footer"')));assert.match(footer,/id="skyMapEvents"/);assert.match(footer,/id="skyMapScrubMode"/);assert.doesNotMatch(footer,/id="skyMap(?:Date|Time)Mode"/);
 // E198: 画面上の固定「↑ 北」はE194で円の方角文字に置き換え済み。使われていないCSSは外し、読み上げで北が上を伝える
 assert.doesNotMatch(html,/sky-map-north/);assert.match(html,/<span class="sr-only">地図は北が上<\/span>/);assert.match(html,/\[\['北',0\],\['東',90\],\['南',180\],\['西',270\]\]/);
});

test('時刻バーの矢印とShiftは日付境界で止まり、日付バーのShiftは時刻を保って7日進む',async()=>{
 for(const [clock,key,shift,expected] of [['23:59','ArrowRight',false,'23:59'],['23:55','ArrowRight',true,'23:59'],['00:00','ArrowLeft',false,'00:00'],['00:05','ArrowLeft',true,'00:00'],['12:34','ArrowRight',true,'12:44']]){
  const f=fixture({saved:{at:Date.parse('2026-12-22T'+clock+':00+09:00')}});await f.open();f.element('skyMapRange').onkeydown({key,shiftKey:shift,preventDefault(){}});await flush();assert.equal(f.element('skyMapDate').value,'2026-12-22');assert.equal(f.element('skyMapTime').value,expected);
 }
 const f=fixture({saved:{at:Date.parse('2026-12-22T12:34:00+09:00')}});await f.open();f.element('skyMapScrubMode').onclick();f.element('skyMapRange').onkeydown({key:'ArrowRight',shiftKey:true,preventDefault(){}});await flush();assert.equal(f.element('skyMapDate').value,'2026-12-29');assert.equal(f.element('skyMapTime').value,'12:34');
});

test('日付更新中は前の日の出入り時刻を押せず、新しい時刻へ置き換わる',async()=>{
 const f=fixture({saved:{at:Date.parse('2026-12-22T12:34:00+09:00')}});await f.open();const before=f.element('skyMapEvents').children.filter(b=>b.type==='button');assert.ok(before.length);f.element('skyMapNext').onclick();assert.ok(before.every(b=>b.disabled));await flush();const after=f.element('skyMapEvents').children.filter(b=>b.type==='button');assert.ok(after.length);assert.ok(after.every(b=>!b.disabled));assert.notEqual(after[0],before[0]);
});

test('紫の目標方位を通過する時刻/高度は時計欄へ常時表示し、日付で更新、同日で保持、押すと移動する',async()=>{
 const f=fixture({saved:{at:Date.parse('2027-03-12T10:02:00+09:00'),targetId:'fuji'}});await f.open();const row=f.element('skyMapPassages'),buttons=()=>row.children.find(n=>n.className==='sky-map-passages-values')?.children.filter(b=>b.type==='button')||[],before=buttons();assert.ok(before.length);assert.ok(before.every(b=>/\d{2}:\d{2}.*°/.test(b.textContent)));const old=before[0];old.onclick();assert.equal(f.element('skyMapTime').value,old.textContent.match(/(\d{2}:\d{2})/)[1]);assert.equal(buttons()[0],old,'同日スクラブは通過表示を作り直さない');
 f.element('skyMapNext').onclick();assert.ok(row.children.some(b=>b.textContent==='計算中…'));assert.ok(!row.children.some(b=>b.type==='button'));await flush();assert.notEqual(buttons()[0],old);
 f.element('skyMapTarget').value='';f.element('skyMapTarget').onchange();await flush();assert.equal(row.children.length,0);
 const footer=html.slice(html.indexOf('<footer class="sky-map-footer"'),html.indexOf('</footer>',html.indexOf('<footer class="sky-map-footer"')));assert.match(footer,/id="skyMapPassages"/);
});

test('通過の計算失敗は計算中のまま残らず再試行でき、天体を隠しても目標仰角を保持する',async()=>{
 const f=fixture({saved:{at:Date.parse('2027-03-12T12:00:00+09:00'),targetId:'fuji'}});await f.open();const original=f.c.SoramiBodies;f.c.SoramiBodies={...original,ensure:async()=>{throw Error('fixture')}};f.element('skyMapBody').onchange();await flush();assert.ok(f.element('skyMapPassages').children.some(b=>b.textContent==='計算できません'));assert.equal(f.element('skyMapRetry').hidden,false);f.c.SoramiBodies=original;await f.element('skyMapRetry').onclick();assert.ok(f.element('skyMapPassages').children.some(n=>n.className==='sky-map-passages-values'&&n.children.some(b=>b.type==='button')));f.element('skyMapShowSun').onclick();await flush();assert.equal(f.element('skyMapShowSun')['aria-pressed'],'false');assert.equal(f.element('skyMapShowMoon')['aria-pressed'],'false');assert.equal(f.element('skyMapPassages').children.length,1);assert.match(f.element('skyMapPassages').children[0].children[1].textContent,/目標仰角.*°/);
});

test('通常プレビューのタップは移動を開始せず、拡大後だけピンの移動を始める',async()=>{
 const f=fixture({saved:{at:Date.parse('2027-03-12T12:00:00+09:00'),targetId:'fuji'}});await f.open();f.map.pick(f.observer,{x:180,y:180});assert.notEqual(f.element('skyMapObserverTool')['aria-pressed'],'true');f.element('skyMapExpand').onclick();f.map.pick(f.observer,{x:180,y:180});assert.equal(f.element('skyMapObserverTool')['aria-pressed'],'true');
});
test('目標仰角は通過天体の高度と区別し、観測高さと選択部位に一致する',async()=>{
 const f=fixture({saved:{at:Date.parse('2027-03-12T12:00:00+09:00'),targetId:'fuji'}});await f.open();const head=f.element('skyMapPassages').children.find(n=>n.className==='sky-map-passages-head');assert.equal(head.children[0].textContent,'目標方位を通過');assert.match(head.children[1].textContent,/目標仰角.*°/);const target=f.element('skyMapTargetInfo').textContent;assert.ok(target.includes(head.children[1].textContent.replace('目標仰角 ','')));
 const footer=html.slice(html.indexOf('<footer class="sky-map-footer"'),html.indexOf('</footer>',html.indexOf('<footer class="sky-map-footer"')));assert.match(footer,/id="skyMapStatus"/);assert.match(footer,/id="skyMapRetry"/);
});

test('月の通過時刻を押すと選択天体も月に揃い、重ねるへ渡す条件が混ざらない',async()=>{
 const f=fixture({saved:{at:Date.parse('2027-03-13T12:00:00+09:00'),body:'sun',targetId:'fuji'}});await f.open();const values=f.element('skyMapPassages').children.find(n=>n.className==='sky-map-passages-values'),moon=values.children.find(n=>n.type==='button'&&n['aria-label'].startsWith('月が'));assert.ok(moon);const loads=f.loads;moon.onclick();assert.equal(f.element('skyMapBody').value,'moon');assert.equal(f.data.get('sorami.skyMap:testuser').body,'moon');assert.equal(f.element('skyMapTime').value,moon.textContent.match(/\d{2}:\d{2}/)[0]);assert.equal(f.loads,loads);
});

test('通常地図で月/太陽を選ぶと実描画と表示フラグがその選択に揃う',async()=>{
 const f=fixture({saved:{at:Date.parse('2026-11-03T16:22:00+09:00'),body:'sun',showSun:true,showMoon:false,targetId:'fuji'}});await f.open();for(const body of ['moon','sun','moon']){f.element('skyMapBody').value=body;f.element('skyMapBody').onchange();await flush();const saved=f.data.get('sorami.skyMap:testuser');assert.equal(saved.showSun,body==='sun');assert.equal(saved.showMoon,body==='moon');assert.equal(f.discs.at(-1).body,body);}
});
test('転送後の下部バーは軌道の配列番号を日秒として読まず、実時刻と秒scopeで同期する',()=>{
 const d=dom(),c={document:d.document,Date,Number};vm.createContext(c);vm.runInContext(readFileSync(new URL('./sorami-datetime-ui.js',import.meta.url),'utf8'),c);
 const day=Date.parse('2026-11-03T00:00:00+09:00'),source={min:'0',max:'42',get value(){throw Error('配列番号を時刻へ使ってはいけない')}},range={setAttribute(){}};
 Object.assign(c,{state:{day,current:day+57840000,minSeconds:57300,maxSeconds:58200},mode:'scene',look:{_footerFrame:null,querySelector:()=>source},mapRange:source,footerRange:range,document:{...d.document,activeElement:null}});
 const start=html.indexOf("  const source=mode==='places'?mapRange:look.querySelector('[data-look-range]');"),end=html.indexOf('  if(state){footerRange.setAttribute',start);assert.ok(start>=0);const sync=html.slice(start,end);vm.runInContext('{'+sync+'}',c);assert.equal(range.value,'57840');assert.equal(range.min,'57300');assert.equal(range.max,'58200');
 c.state.current=day+57900000;vm.runInContext('{'+sync+'}',c);assert.equal(range.value,'57900');
 const invalid={min:'old',max:'old',value:'old'};assert.equal(c.ToolDateTimeBar.syncTimeRange(invalid,{day,current:NaN,min:0,max:86400}),false);assert.equal(invalid.value,'old');
});

test('body change after leaving cannot mutate or dereference a cleared session',async()=>{const f=fixture();await f.open();f.c.SkyMapUI.leave();const before=f.calls;f.element('skyMapBody').value='moon';assert.doesNotThrow(()=>f.element('skyMapBody').onchange());assert.equal(f.calls,before);});

test('重ねるから戻ると現在の選択天体を表示し以前の非表示設定で隠れない',async()=>{
 const f=fixture({saved:{at:Date.parse('2026-11-03T16:04:00+09:00'),body:'moon',showSun:false,showMoon:true}});f.element('aimView').hidden=false;f.element('skyMapOpen').onclick();await flush();assert.equal(f.element('skyMapBody').value,'sun');assert.equal(f.element('skyMapShowSun')['aria-pressed'],'true');assert.equal(f.element('skyMapShowMoon')['aria-pressed'],'false');assert.equal(f.discs.at(-1).body,'sun');
});
test('カレンダー指定時刻を微調整の秒範囲へ含め、表示の端への丸めを防ぐ',()=>{
 const start=html.indexOf('  const uiState = host._uiTime = {'),end=html.indexOf('  uiState.window();',start),day=Date.parse('2026-11-03T00:00:00+09:00'),range={setAttribute(){}},host={_lookAt:day+43200000};
 const c={host,range,uiDay:day,uiEnd:day+86400000-1,spec:{at:day+43200000},selectedAt:day+43200000,Number,Math,SoramiBodies:{state:()=>({azimuth:0,apparentAltitude:0})},body:'sun',eyeObs:{},proj:()=>[0,0],win:{halfW:100,halfH:100},aimLookHMS:()=>'',seq:1,timeIndex:x=>x,draw(){}};
 vm.createContext(c);vm.runInContext(html.slice(start,end)+'host._uiTime.window('+String(day+64800000)+');',c);assert.ok(+range.max>=64800);assert.equal(+range.value,43200);assert.equal(host._uiTime.maxSeconds,+range.max);
});

// ---- E198（2026-10-13）総点検の指摘の修正と地図ボタン配置
const day=Date.parse('2026-12-22T00:00:00+09:00');
test('E198: 全画面の切替は通常・全画面とも右上の同じ位置で、レイヤーはその下',()=>{
 assert.match(html,/\.sky-map-expand\{position:absolute;top:8px;right:8px;/);
 assert.match(html,/\.sky-map-wide \.sky-map-expand\{top:calc\(8px \+ env\(safe-area-inset-top\)\)/);
 assert.match(html,/\.sky-map-wide \.map-layers-btn\{top:calc\(58px \+ env\(safe-area-inset-top\)\)/);
 assert.doesNotMatch(html,/sky-map-expand\{top:calc\(58px/);
 // ズームの「拡大」と取り違えない名前
 assert.match(html,/id="skyMapExpand" aria-label="地図を全画面表示"/);assert.match(html,/wide\?'全画面表示を終了':'地図を全画面表示'/);assert.doesNotMatch(html,/地図を拡大表示/);
});
// 2026-10-15: switches were replaced by three peer menu entries; retain the in-map transfer paths.
test('構図への既存ボタンは条件を引き継ぎ、権限なしでは転送しない',async()=>{
 assert.match(html,/id="skyMapUseBelow"/);
 const f=fixture({saved:{at:day,targetId:'skytree'}});await f.open();assert.equal(f.element('skyMapUse').hidden,false);assert.equal(f.element('skyMapUse').disabled,false);
 f.element('skyMapUseBelow').onclick();assert.equal(f.c.hash,'#/aim');assert.equal(f.aim.plannerTransfer.body,'sun');
 const g=fixture({tools:['skymap'],saved:{at:day,targetId:'skytree'}});await g.open();assert.equal(g.element('skyMapUse').hidden,true);g.element('skyMapUseBelow').onclick();assert.equal(g.c.hash,undefined);
});
test('条件3行は構図と共通の天体・対象・撮影地点ラベル、出入りの表記を維持する',async()=>{
 const block=html.slice(html.indexOf('<div class="sky-map-controls">'),html.indexOf('<div class="mapwrap sky-map-wrap">'));
 assert.deepEqual([...block.matchAll(/class="aim-say-v condition-label"[^>]*><svg[^>]*>[\s\S]*?<\/svg><span[^>]*>([^<]+)<\/span>/g)].map(m=>m[1]),['天体','対象','撮影地点']);
 const sky=html.slice(html.indexOf('<section id="skyMapView"'),html.indexOf('</section>',html.indexOf('<section id="skyMapView"')));
 assert.doesNotMatch(sky,/観測点|出・入|出入は|中心に目標を置く/);// Current menu uses the short Japanese name adopted on 2026-10-15.
 assert.match(html,/id="skyMapTitle">地図<\/h2>/);
 const f=fixture({saved:{at:day,body:'sun',showSun:true,showMoon:false}});await f.open();
 const events=f.element('skyMapEvents').children.filter(b=>b.type==='button');assert.ok(events.length);
 for(const b of events){assert.match(b['aria-label'],/^日の(出|入) \d\d:\d\d・方位 /);assert.match(b.textContent,/^☀[出入] \d\d:\d\d$/);}
 assert.doesNotMatch(html,/太陽の出|太陽の入/);
});
test('E198: 日時の読み上げは画面と同じ表記、⋯は中身どおりの名前',()=>{
 assert.match(html,/setAttribute\('aria-label',`\$\{ToolDateTimeBar\.label\(session\.at\)\}、日付を選ぶ`\)/);
 assert.match(html,/session\.scrubMode==='date'\?ToolDateTimeBar\.label\(session\.at\)/);
 assert.match(html,/\$\("aimDate"\)\.value\.replaceAll\("-", "\/"\)/);
 assert.match(html,/id="skyMapTimeMore" aria-label="天体の位置と時刻"/);assert.match(html,/<strong>天体の位置と時刻<\/strong>/);
 assert.match(html,/id="skyMapEarlier">−1分<\/button>[\s\S]{0,80}id="skyMapLater">\+1分<\/button>/);
 const d={},c={document:{createElement:()=>d},Date};vm.createContext(c);vm.runInContext(readFileSync(new URL('./sorami-datetime-ui.js',import.meta.url),'utf8'),c);
 assert.equal(c.ToolDateTimeBar.label(Date.parse('2026-10-03T23:59:00+09:00')),'2026/10/03(土)');
});
test('E198: 予測の取得状態は道具の画面の上に出さない',()=>{
 assert.match(html,/main:has\(>:is\(#aimView,#planeView,#issView,#recordsView,#answersView,#skyMapView,#adminView\):not\(\[hidden\]\)\)>:is\(#status,#predictionDataNotice\)\{display:none\}/);
});
test('E198: 月・富士山の信頼度の説明で、何日先かを二重に言わない',()=>{
 const src=html.slice(html.indexOf('function confidenceText(ev)'),html.indexOf('// 51メンバーの散らばりを見せる。'));
 const fn=vm.runInNewContext(src+';confidenceText',{S:{MODELS:Array(8)}});
 for(const d of [1,2,4,5,6]){const text=fn({daysAhead:d,uncertainty:{basis:'single',expectedError:17},confidence:{key:'high'},models:0});
  assert.ok((text.match(new RegExp(d+'日先','g'))||[]).length<=1,text);assert.match(text,/点数は ±17点 ほど動く見込みです/);}
});
test('E198: 時刻は0を付けて桁を揃え、月丼の日付は今日と書かない',()=>{
 const S=createRequireFn('./sorami-core.js');S.setTimezoneOffset(9*3600);
 assert.equal(S.Cal.hhmm(Date.parse('2026-10-13T05:07:30+09:00')),'05:07');assert.equal(S.Cal.hhmmRounded(Date.parse('2026-10-13T09:59:40+09:00')),'10:00');
 assert.doesNotMatch(html,/・ 今日"/);assert.match(html,/\$\("planeWeekday"\)\.textContent = S\.Cal\.relativeDay\(ms\);/);
 assert.match(html,/月 方位\$\{Math\.round\(sp\.best\.moonAz\)\}°・高さ/);assert.match(html,/の方位\$\{Math\.round\(r\.azimuth\)\}°・高さ\$\{Math\.round\(r\.altitude\)\}°/);
});

test('追加6天体は太陽/月を維持して1つだけ表示し、選択/解除/保存/再開が同期する',async()=>{
 const f=fixture({saved:{at:day,body:'sun',showSun:true,showMoon:true,targetId:'skytree'}});await f.open();
 for(const id of ['sirius','mercury','venus','mars','jupiter','saturn']){
  f.element('skyMapMoreBodies').onclick();assert.equal(f.element('skyMapBodiesSheet').open,true);
  f.element('skyMapExtra-'+id).onclick();await flush();const s=f.data.get('sorami.skyMap:testuser');
  assert.equal(s.extraBody,id);assert.equal(s.body,id);assert.equal(s.showSun,true);assert.equal(s.showMoon,true);assert.equal(s.at,day);
  assert.equal(f.element('skyMapAngles').children.length,3);assert.equal(f.element('skyMapBodiesSheet').open,false);assert.equal(f.element('skyMapExtra-'+id)['aria-pressed'],'true');
  assert.equal(f.element('skyMapExtraName').textContent,f.c.SoramiBodies.definitions.find(d=>d.id===id).name);
 }
 const snapshot=f.data.get('sorami.skyMap:testuser'),g=fixture({saved:snapshot});await g.open();assert.equal(g.element('skyMapExtra-saturn')['aria-pressed'],'true');assert.equal(g.element('skyMapAngles').children.length,3);
 g.element('skyMapClearExtra').onclick();await flush();const cleared=g.data.get('sorami.skyMap:testuser');assert.equal(cleared.extraBody,null);assert.equal(cleared.showSun,true);assert.equal(cleared.showMoon,true);assert.equal(g.element('skyMapAngles').children.length,2);assert.equal(g.element('skyMapClearExtra').hidden,true);
 const h=fixture({saved:cleared});await h.open();assert.equal(h.element('skyMapAngles').children.length,2);assert.equal(h.element('skyMapExtra-none')['aria-pressed'],'true');
});
test('追加天体は太陽/月を非表示にしても残り、全て解除すると描画と出入りを消す',async()=>{
 const f=fixture({saved:{at:day,body:'sun',showSun:true,showMoon:true}});await f.open();f.element('skyMapExtra-jupiter').onclick();await flush();
 f.element('skyMapShowSun').onclick();await flush();f.element('skyMapShowMoon').onclick();await flush();assert.equal(f.element('skyMapAngles').children.length,1);assert.match(f.element('skyMapAngles').children[0].textContent,/木星/);
 f.element('skyMapExtra-none').onclick();await flush();assert.equal(f.element('skyMapAngles').children.length,0);assert.equal(f.element('skyMapEvents').children.length,0);
});
test('追加天体の選択は権限失効/画面離脱後のイベントを拒否し、計算失敗は再試行できる',async()=>{
 const tools=['skymap','tower'],f=fixture({tools,saved:{at:day}});await f.open();const old=f.data.get('sorami.skyMap:testuser');tools.splice(0,2,'tower');f.element('skyMapExtra-jupiter').onclick();await flush();assert.equal(f.data.get('sorami.skyMap:testuser'),old);
 const g=fixture({saved:{at:day}});await g.open();g.c.SkyMapUI.leave();g.element('skyMapExtra-jupiter').onclick();assert.equal(g.element('skyMapBodiesSheet').open,false);
 const h=fixture({saved:{at:day}});await h.open();const b=h.c.SoramiBodies;h.c.SoramiBodies={...b,ensure:async id=>{if(id==='jupiter')throw Error('offline')}};h.element('skyMapExtra-jupiter').onclick();await flush();assert.match(h.element('skyMapStatus').textContent,/再試行/);assert.equal(h.element('skyMapRetry').hidden,false);h.c.SoramiBodies=b;await h.element('skyMapRetry').onclick();assert.ok(h.element('skyMapAngles').children.some(d=>d.textContent.includes('木星')));
});

test('月を主天体にしたまま追加天体を解除すると月へ戻り、構図の権限も戻る',async()=>{
 const f=fixture({tools:['skymap','pearl'],saved:{at:day,body:'moon',showSun:true,showMoon:true,targetId:'fuji'}});await f.open();assert.equal(f.element('skyMapUse').hidden,false);f.element('skyMapExtra-venus').onclick();await flush();assert.equal(f.element('skyMapUse').hidden,true);
 f.element('skyMapClearExtra').onclick();await flush();assert.equal(f.element('skyMapBody').value,'moon');assert.equal(f.element('skyMapUse').hidden,false);assert.equal(f.data.get('sorami.skyMap:testuser').primaryBody,'moon');
});
test('追加天体の取得不能でも太陽/月を描き、選択天体の構図は止めて再試行で復帰する',async()=>{
 const f=fixture({saved:{at:day,body:'moon',showSun:true,showMoon:true,targetId:'skytree'}});await f.open();const provider=f.c.SoramiBodies;
 f.c.SoramiBodies={...provider,ensure:async id=>{if(id==='saturn')throw Error('offline')}};f.element('skyMapExtra-saturn').onclick();await flush();
 const names=f.element('skyMapAngles').children.map(x=>x.textContent);assert.equal(names.length,2);assert.ok(names.some(x=>x.startsWith('太陽')));assert.ok(names.some(x=>x.includes('月')));assert.equal(f.element('skyMapUse').disabled,true);assert.match(f.element('skyMapTargetInfo').textContent,/選択天体は計算できません/);assert.match(f.element('skyMapStatus').textContent,/土星.*再試行/);assert.equal(f.element('skyMapBody').value,'saturn');f.element('skyMapUse').onclick();assert.equal(f.c.hash,undefined);
 f.c.SoramiBodies=provider;await f.element('skyMapRetry').onclick();assert.equal(f.element('skyMapAngles').children.length,3);assert.equal(f.element('skyMapUse').disabled,false);
});
