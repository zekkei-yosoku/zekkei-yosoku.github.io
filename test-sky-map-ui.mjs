import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),A=require('./sorami-astro.js'),B=require('./sorami-bodies.js'),M=require('./sorami-sky-map.js'),TR=require('./sorami-terrain.js'),AL=require('./sorami-align.js'),MOON=require('./sorami-moon.js');
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8'),ui=/<script id="skyMapPresentation">([\s\S]*?)<\/script>/.exec(html)[1],day=Date.parse('2026-12-22T00:00:00+09:00');
const flush=()=>new Promise(r=>setImmediate(r));
export function fixture({saved=null,selected=true,tools=['skymap','tower'],accessResult=null,accessWaiting=false,loggedIn=true,ground=5.5,waiting=false,datesSearch=async()=>[]}={}){
 const elements=new Map(),clicks=[],data=new Map(saved?[['sorami.skyMap:testuser',saved]]:[]),observer={name:'観測地点',latitude:35.64285,longitude:139.78291,groundManualM:null,standAglM:1.5};let moves=0,loads=0,calls=0,resolveGround,resolveAccess,accessCalls=0;
 if(selected)data.set('sorami.skyMap:testuser',{observer,...saved});
 const element=id=>{if(!elements.has(id))elements.set(id,{hidden:false,open:false,dataset:{},value:'',options:[],children:[],disabled:false,textContent:'',innerHTML:'',setAttribute(k,v){this[k]=v;},replaceChildren(...v){this.children=v;this.options=v.filter(x=>x instanceof Option);},append(v){this.children.push(v)},add(v){this.options.push(v)},focus(){this.focused=true},listeners:{},addEventListener(k,f){(this.listeners[k]??=[]).push(f)},close(){this.open=false;for(const f of this.listeners.close??[])f()},querySelectorAll(){return []},querySelector(selector){return element(id+selector)},get parentElement(){return element('parent-'+id)},closest(){return element('mapWrap')},classList:{add(){},toggle(){return true},remove(){}}});return elements.get(id)};
 class Option{constructor(name,value){this.textContent=name;this.value=value;this.hidden=false;this.disabled=false;}}
 element('skyMapBody').options=B.definitions.map(d=>new Option(d.name,d.id));element('aimLook').hidden=true;element('aimView').hidden=true;
 const arcs=[],drawOps=[];const ctx=new Proxy({},{get:(_,k)=>k==='arc'?(...a)=>arcs.push(a):k==='lineTo'||k==='setLineDash'?(...a)=>drawOps.push({op:k,args:a}):()=>{},set:()=>true});let center={...observer},zoom=13,overlay;const discs=[];
 const map={onDoubleTap:f=>map.double=f,onPick:f=>map.pick=f,project:(lat,lon)=>[180+(lon-center.longitude)*10000,180-(lat-center.latitude)*10000],setOverlay:f=>overlay=f,open:(p,z)=>{center={...p};zoom=z;},center:()=>({...center}),zoom:()=>zoom,setCenter:(latitude,longitude)=>{center={latitude,longitude};},redraw:()=>{moves++;if(overlay)overlay(ctx,{project:(lat,lon)=>[180+(lon-center.longitude)*10000,180-(lat-center.latitude)*10000],width:390,height:400})}};
 const aim={body:'sun',target:AL.TARGETS.find(t=>t.id==='skytree'),partId:'__whole',limbsByBody:{},limb:'center',dayMs:day},cache=new Map();
 const targetList=()=>[...AL.TARGETS.filter(t=>tools.includes('tower')||!tools.length||t.id==='fuji'&&(tools.includes('diamond')||tools.includes('pearl'))),...(tools.includes('tower')||!tools.length?[{id:'custom',name:'他の目標',parts:[]}]:[])];
 const c={SoramiLibrary:require('./sorami-library.js'),SoramiShooting:require('./sorami-shooting.js'),aimIsMountain:t=>!!t&&t.id==='fuji',SoramiScrollTimeline:{mount(options){c.timeline=options;return {sync(){},stop(){}}}},UI_ICONS:{observer:'<svg></svg>',search:'<svg></svg>'},ToolDateTimeBar:{decorate(){},wireScrub(){return ()=>{}},label(){return '2026/12/22(火)'},dateText(){},calendar(){return{open:false,close(){}}},trackPointerFocus(){}},auth:loggedIn?{token:'test-token',loginId:'testuser',tools}:null,allowedTools:()=>tools,renderTools:()=>{},apiCall:async()=>{accessCalls++;if(accessWaiting)return new Promise(r=>{(c.accessRequests??=[]).push(r);resolveAccess=r});if(!tools.includes('skymap'))throw Error('スカイマップの利用が許可されていません');return accessResult||{allowed:true,tool:'skymap',tools,loginId:'testuser',role:'user'};},aimWithHeights:t=>t,aimFavTargets:()=>[],aimFavTarget:t=>t,document:{body:{append(){}},getElementById:element,addEventListener:(name,f)=>{if(name==='click')clicks.push(f)},createElement:()=>element('made'+Math.random())},Option,showSheet:e=>{e.open=true},store:{get:(k,d)=>data.has(k)?data.get(k):d,set:(k,v)=>data.set(k,v)},createMapView:()=>map,toolAllowed:id=>tools.includes(id),SoramiBodies:B,SoramiSkyMap:M,SoramiAstro:{...A,sun:(...a)=>{calls++;return A.sun(...a)},moon:(...a)=>{calls++;return A.moon(...a)}},SoramiMoon:MOON,SoramiTerrain:{...TR,groundElevation:async()=>{loads++;if(waiting)return new Promise(r=>resolveGround=r);return ground}},SoramiAlign:AL,aim,aimElevCache:cache,aimFromPoint:()=>observer,place:observer,aimObserverEye:p=>p.standAglM??1.5,aimObserverAt:(p,g)=>({latitude:p.latitude,longitude:p.longitude,elevation:p.groundManualM??g??0,eyeM:p.standAglM??1.5}),aimSavedFrom:p=>p?({...p}):null,aimLookKey:()=> 'current',aimLimbValue:()=> 'center',aimMapLabel:()=>{},aimLookDisc:(ctx,x,y,r,body,p)=>discs.push({body,...p}),aimTargetList:targetList,aimFillSelects:()=>{},goBack:()=>{},openPlaceSheet:()=>{},PLACE_PICKERS:{},SkyMapUI:null,routeFromHash:()=>null,pushRoute:hash=>{c.hash=hash;if(hash==='#/skymap'){element('skyMapView').hidden=false;c.SkyMapUI.open();}else c.SkyMapUI.leave();},S:{JstCal:{hhmm:at=>new Date(at+32400000).toISOString().slice(11,16)}},requestAnimationFrame:f=>{c.frame=f;return 1},cancelAnimationFrame:()=>{c.frame=null},Date,Math,Number,String,Array,Set,Map,Object,JSON};
 // 2026-10-18: map dates now use framing helpers; exercise their real key and markup with a bounded injected solver.
 c.esc=x=>String(x);c.S.Cal=require('./sorami-core.js').Cal;c.S.JstCal=require('./sorami-core.js').JstCal;c.SoramiAtmosphere={dataKey:()=> 'standard'};c.aimBuildingDays=datesSearch;c.moonGlyphAt=()=> '☾';
 c.$=element;c.favorites=[];c.bundle=null;
 vm.createContext(c);
 vm.runInContext(html.slice(html.indexOf('function renderPointCard('),html.indexOf('/// ☆ を押したら',html.indexOf('function renderPointCard('))),c);
 for(const [from,to] of [['function aimDaysInputKey(','function aimSyncFromDay()'],['function aimTwoYearEnd(','async function aimMoreDays()'],['function candidateDatesMarkup(','// The selected place is already known;']])vm.runInContext(html.slice(html.indexOf(from),html.indexOf(to,html.indexOf(from))),c);
 vm.runInContext(html.match(/const aimSideName =[^\n]+/)[0],c);
 vm.runInContext(ui,c);return{c,element,data,aim,cache,map,clicks,discs,arcs,drawOps,observer,open:async()=>{c.SkyMapUI.open();await flush();},releaseAccess:v=>resolveAccess(v),get accessCalls(){return accessCalls},get calls(){return calls},get loads(){return loads},release:v=>resolveGround(v),get draws(){return moves}};
}
test('前回の日時・天体・対象と地図中心を復元し、8天体が実runtimeで有限値を描く',async()=>{
 const f=fixture({saved:{at:day+45240000,body:'moon',targetId:AL.TARGETS.find(t=>t.name.includes('森JP')).id,observer:{latitude:35.64285,longitude:139.78291,name:'公園',standAglM:1.5},mapCenter:{latitude:35.65,longitude:139.79},zoom:15}});await f.open();assert.equal(f.element('skyMapTime').value,'12:34');assert.deepEqual(f.map.center(),{latitude:35.65,longitude:139.79});
 // Use the actual IDs; the supplied target must be permitted and present.
 const id=AL.TARGETS.find(t=>t.name.includes('森JP')).id;f.element('skyMapTarget').value=id;f.element('skyMapTarget').onchange();await flush();
 for(const d of B.definitions){f.element('skyMapBody').value=d.id;f.element('skyMapBody').onchange();await flush();assert.equal(f.element('skyMapBody').value,d.id);assert.ok(f.element('skyMapAngles').children[0].textContent.includes(d.name));assert.doesNotMatch(f.element('skyMapAngles').children[0].textContent,/NaN|Infinity/);}
 assert.match(f.element('skyMapTargetInfo').textContent,/仰角 .*距離.*対象の標高/);assert.doesNotMatch(f.element('skyMapTargetInfo').textContent,/NaN/);assert.ok(f.discs.some(d=>d.body==='moon'&&d.illuminated>0&&Number.isFinite(d.brightLimbZenithAngle)));
 f.c.SkyMapUI.leave();assert.equal(f.data.get('sorami.skyMap:testuser').targetId,id);
});
test('時間バー確定はrAF待ちでも反映、同日スクラブとパンで日計算や地盤取得をやり直さない',async()=>{
 const f=fixture({saved:{at:day+43200000}});await f.open();const calls=f.calls,loads=f.loads;f.element('skyMapRange').value='45240';f.element('skyMapRange').oninput();assert.ok(f.c.frame);f.element('skyMapRange').onchange();assert.equal(f.element('skyMapTime').value,'12:34');assert.equal(f.c.frame,null);assert.ok(f.calls-calls<20);assert.equal(f.loads,loads);
 const before=f.data.get('sorami.skyMap:testuser').observer;f.map.setCenter(35.66,139.79);f.element('skyMapLater').onclick();assert.equal(f.element('skyMapTime').value,'12:35');assert.equal(f.data.get('sorami.skyMap:testuser').observer.latitude,before.latitude);assert.equal(f.loads,loads);
 f.element('skyMapObserverTool').onclick();f.map.setCenter(35.66,139.79);f.element('skyMapObserverTool').onclick();await flush();assert.equal(f.data.get('sorami.skyMap:testuser').observer.latitude,35.66);assert.equal(f.loads,loads+1);
});
test('読込中の時刻操作を保持し、取得失敗は表示と再試行、失敗値は成功cacheに保存しない',async()=>{
 const f=fixture({waiting:true,saved:{at:day}});f.c.SkyMapUI.open();await flush();f.element('skyMapLater').onclick();assert.equal(f.element('skyMapTime').value,'00:01');assert.equal(f.element('skyMapUse').disabled,true);f.release(null);await flush();assert.match(f.element('skyMapStatus').textContent,/取得できません/);assert.equal(f.element('skyMapRetry').hidden,false);assert.equal(f.cache.size,0);
 const p=f.element('skyMapRetry').onclick();await flush();f.release(8);await p;assert.equal(f.element('skyMapTime').value,'00:01');assert.equal(f.cache.get('35.642850,139.782910'),8);
});
test('手入力標高を自動標高cacheへ混ぜず、目標なしも閲覧できる',async()=>{
 const f=fixture({saved:{at:day,observer:{latitude:35.64,longitude:139.78,groundManualM:88,standAglM:351.5}}});await f.open();assert.equal(f.loads,0);assert.equal(f.cache.size,0);assert.match(f.element('skyMapTargetInfo').textContent,/対象なし/);f.element('skyMapUse').onclick();assert.match(f.element('skyMapStatus').textContent,/対象を選んで/);
});
test('重ねる更新中の入口は保存済み天体より現在の天体・対象を優先、任意時刻を戻す',async()=>{
 const f=fixture({saved:{at:day,body:'moon'}});f.element('aimView').hidden=false;f.element('skyMapOpen').onclick();await flush();assert.equal(f.element('skyMapBody').value,'sun');assert.equal(f.element('skyMapTarget').value,f.aim.target.id);
 f.element('skyMapTime').value='12:34';f.element('skyMapTime').onchange();f.element('skyMapUse').onclick();assert.equal(f.c.hash,'#/aim');assert.equal(f.aim.plannerTransfer.at,day+45240000);assert.equal(f.aim.plannerTransfer.body,'sun');assert.equal(f.cache.get('35.642850,139.782910'),5.5);
 const capture=f.clicks[0];f.aim.plannerTransfer={at:1};capture({target:{closest:selector=>selector.includes('[data-cand]')?{}:null}});assert.equal(f.aim.plannerTransfer,null);
});
test('保存した自作目標は現在の許可に従い復元し、地図で置いた対象の切替復帰も同じ物になる',async()=>{
 const custom={name:'自作',latitude:35.65,longitude:139.79,heightM:100,groundM:5,topM:105};
 const f=fixture({tools:['skymap'],saved:{at:day,body:'sun',targetId:'custom',custom}});await f.open();assert.equal(f.element('skyMapBody').value,'sun');assert.equal(f.element('skyMapTarget').value,'custom');assert.equal(f.element('skyMapCustom').hidden,false);f.element('skyMapUse').onclick();assert.equal(f.c.hash,undefined);
 const g=fixture({saved:{at:day,targetId:'custom',custom}});await g.open();g.element('skyMapTarget').value='';g.element('skyMapTarget').onchange();await flush();g.element('skyMapTarget').value='custom';g.element('skyMapTarget').onchange();await flush();assert.match(g.element('skyMapTargetInfo').textContent,/自作/);g.element('skyMapUse').onclick();assert.equal(g.data.get('sorami.aimCustom').topM,105);
});
test('地盤cacheは約11mのセルを混同せず、幾何専用天体stateは大気providerを呼ばない',async()=>{
 const fn=html.slice(html.indexOf('async function aimElevation('),html.indexOf('/// 自分で置いた目標',html.indexOf('async function aimElevation(')));let n=0;const c={Map,aimElevCache:new Map(),SoramiTerrain:{groundElevation:async lat=>{n++;return lat*1000}}};vm.createContext(c);vm.runInContext(fn,c);const a=await c.aimElevation(35.000001,139),b=await c.aimElevation(35.000009,139);assert.notEqual(a,b);assert.equal(n,2);await c.aimElevation(35.000001,139);assert.equal(n,2);
 const src=readFileSync(new URL('./sorami-bodies.js',import.meta.url),'utf8'),d={require,Date,SoramiAstro:A,SoramiAtmosphere:{apply:()=>{throw Error('refraction called')}},module:{exports:{}},globalThis:null};d.globalThis=d;vm.createContext(d);vm.runInContext(src,d);for(const body of B.definitions){const st=d.module.exports.state(body.id,day,{latitude:35,longitude:139,elevation:0},{refraction:false});assert.ok(Number.isFinite(st.altitude));assert.equal(st.apparentAltitude,st.altitude);}
});
test('見え方からの往復は自動標高を手入力へ変えず、既知の標高・目の高さをそのまま使う',async()=>{
 const f=fixture();const look=f.element('aimLook');look.hidden=false;look._planKey='current';look._lookAt=day+45240000;look._lookSpec={obs:{latitude:f.observer.latitude,longitude:f.observer.longitude,elevation:91},eyeM:1.5,observerName:'観測地点'};f.element('aimView').hidden=false;f.element('skyMapOpen').onclick();await flush();assert.equal(f.loads,0);assert.equal(f.element('skyMapTime').value,'12:34');assert.equal(f.data.get('sorami.skyMap:testuser').observer.groundManualM,null);assert.equal(f.cache.get('35.642850,139.782910'),91);f.element('skyMapUse').onclick();assert.equal(f.aim.plannerTransfer.at,day+45240000);
});
test('三脚で観測点、ピンで登録済み目標または新しい位置を選び、高さ確定まで公式対象を保持する',async()=>{
 const f=fixture({saved:{at:day}});await f.open();f.element('skyMapObserverTool').onclick();assert.equal(f.element('skyMapObserverTool')['aria-pressed'],'true');const point={latitude:35.65,longitude:139.79};f.map.setCenter(point.latitude,point.longitude);f.element('skyMapObserverTool').onclick();await flush();assert.equal(f.data.get('sorami.skyMap:testuser').observer.latitude,35.65);assert.equal(f.element('skyMapObserverTool')['aria-pressed'],'false');
 f.element('skyMapTargetTool').onclick();const target=AL.TARGETS.find(t=>t.name.includes('森JP')),pixel=f.map.project(target.latitude,target.longitude);f.map.setCenter(target.latitude,target.longitude);f.element('skyMapTargetTool').onclick();await flush();assert.equal(f.element('skyMapTarget').value,target.id);assert.equal(f.element('skyMapTargetSheet').open,false);
 f.element('skyMapTargetTool').onclick();const newPoint={latitude:35.653,longitude:139.792},q=f.map.project(newPoint.latitude,newPoint.longitude);f.map.setCenter(newPoint.latitude,newPoint.longitude);f.element('skyMapTargetTool').onclick();assert.equal(f.element('skyMapTargetSheet').open,true);assert.equal(f.element('skyMapTarget').value,target.id);f.element('skyMapPickHeight').valueAsNumber=NaN;await f.element('skyMapPickSave').onclick();assert.match(f.element('skyMapPickError').textContent,/高さ/);assert.equal(f.element('skyMapTarget').value,target.id);
 f.element('skyMapPickHeight').valueAsNumber=120;f.element('skyMapPickName').value='撮影目標';await f.element('skyMapPickSave').onclick();await flush();assert.equal(f.element('skyMapTargetSheet').open,false);assert.equal(f.element('skyMapTarget').value,'custom');assert.match(f.element('skyMapTargetInfo').textContent,/撮影目標/);f.element('skyMapUse').onclick();assert.equal(f.data.get('sorami.aimCustom').topM,125.5);assert.equal(f.data.get('sorami.aimCustom').latitude,newPoint.latitude);
});
test('対象の高さ取得不能・閉じた入力・towerなしの自由配置は目標や公式座標を変更しない',async()=>{
 const f=fixture({ground:null,saved:{at:day,targetId:AL.TARGETS.find(t=>t.name.includes('森JP')).id}});await f.open();const before=f.element('skyMapTarget').value;f.element('skyMapTargetTool').onclick();f.map.setCenter(35.7,139.9);f.element('skyMapTargetTool').onclick();f.element('skyMapPickHeight').valueAsNumber=20;f.element('skyMapPickName').value='目標';await f.element('skyMapPickSave').onclick();assert.match(f.element('skyMapPickError').textContent,/取得できません/);assert.equal(f.element('skyMapTarget').value,before);f.element('skyMapTargetClose').onclick();assert.equal(f.element('skyMapTargetSheet').open,false);
 const g=fixture({tools:['skymap'],saved:{at:day}});await g.open();g.element('skyMapTargetTool').onclick();g.map.setCenter(35.7,139.9);g.element('skyMapTargetTool').onclick();assert.equal(g.element('skyMapTargetSheet').open,true);assert.equal(g.element('skyMapTarget').value,'');
});
test('高倍率で選択中の都庁の部位ピンをタップすると同じ部位を選び、新規入力にしない',async()=>{
 const target=AL.TARGETS.find(t=>t.name.includes('都庁'));const f=fixture({saved:{at:day,targetId:target.id,partId:'north'}});await f.open();f.map.project=(lat,lon)=>[lat*1e6,lon*1e6];f.element('skyMapTargetTool').onclick();const mark=AL.partTarget(target,'north'),q=f.map.project(mark.latitude,mark.longitude);assert.ok(Math.hypot(...f.map.project(target.latitude-mark.latitude,target.longitude-mark.longitude))>20);f.map.setCenter(mark.latitude,mark.longitude);f.element('skyMapTargetTool').onclick();await flush();assert.equal(f.element('skyMapTargetSheet').open,false);assert.equal(f.element('skyMapTarget').value,target.id);assert.equal(f.data.get('sorami.skyMap:testuser').partId,'north');
});
test('高さの取得中にシートを閉じると遅い結果で対象を変更しない',async()=>{
 const target=AL.TARGETS.find(t=>t.name.includes('森JP'));const f=fixture({waiting:true,saved:{at:day,targetId:target.id}});f.c.SkyMapUI.open();await flush();f.release(5.5);await flush();f.element('skyMapTargetTool').onclick();f.map.setCenter(35.7,139.9);f.element('skyMapTargetTool').onclick();f.element('skyMapPickHeight').valueAsNumber=120;f.element('skyMapPickName').value='未確定';const save=f.element('skyMapPickSave').onclick();await flush();f.element('skyMapTargetClose').onclick();f.release(10);await save;assert.equal(f.element('skyMapTarget').value,target.id);assert.equal(f.element('skyMapTargetSheet').open,false);
});
test('入力中にtowerの許可がなくなった場合も確定・重ねる連携を拒否する',async()=>{
 const tools=['skymap','tower'],target=AL.TARGETS.find(t=>t.name.includes('森JP')),f=fixture({tools,saved:{at:day,targetId:target.id}});await f.open();f.element('skyMapTargetTool').onclick();f.map.setCenter(35.7,139.9);f.element('skyMapTargetTool').onclick();tools.splice(0,2,'pearl');f.element('skyMapPickHeight').valueAsNumber=100;f.element('skyMapPickName').value='拒否対象';await f.element('skyMapPickSave').onclick();assert.match(f.element('skyMapPickError').textContent,/現在使えません/);assert.equal(f.element('skyMapTarget').value,target.id);f.element('skyMapTargetClose').onclick();f.element('skyMapUse').onclick();assert.equal(f.c.hash,undefined);
});
test('標高取得を待っている間にtowerの許可を失った場合も遅い結果を確定しない',async()=>{
 const tools=['skymap','tower'],target=AL.TARGETS.find(t=>t.name.includes('森JP')),f=fixture({waiting:true,tools,saved:{at:day,targetId:target.id}});f.c.SkyMapUI.open();await flush();f.release(5.5);await flush();f.element('skyMapTargetTool').onclick();f.map.setCenter(35.7,139.9);f.element('skyMapTargetTool').onclick();f.element('skyMapPickHeight').valueAsNumber=100;f.element('skyMapPickName').value='拒否対象';const saving=f.element('skyMapPickSave').onclick();await flush();tools.splice(0,2,'pearl');f.release(10);await saving;assert.equal(f.element('skyMapTarget').value,target.id);assert.equal(f.data.get('sorami.aimCustom'),undefined);
});

test('専用権限は未ログイン・旧権限・不正応答を拒否し、天体や地盤の計算を始めない',async()=>{for(const options of [{loggedIn:false},{tools:['tower','diamond','pearl']},{accessResult:{allowed:true,tool:'skymap',tools:[]}}]){const f=fixture(options);await f.open();assert.equal(f.loads,0);assert.equal(f.calls,0);assert.equal(f.element('skyMapContent').hidden,true);}});
test('遅い許可応答は離脱・アカウント変更後の画面を開かない',async()=>{for(const change of ['leave','account']){const f=fixture({accessWaiting:true});f.c.SkyMapUI.open();await flush();if(change==='leave')f.c.SkyMapUI.leave();else{f.c.auth={token:'different',loginId:'other',tools:['skymap']};f.c.SkyMapUI.authChanged();}f.c.accessRequests[0]({allowed:true,tool:'skymap',tools:['skymap'],loginId:'testuser'});await flush();assert.equal(f.loads,0);assert.equal(f.element('skyMapContent').hidden,true);}});
test('専用権限だけで8天体・建物・自作対象を使え、重ねるへの転送は別権限を必要とする',async()=>{const f=fixture({tools:['skymap'],saved:{at:day,targetId:'skytree'}});await f.open();assert.equal(f.element('skyMapBody').options.filter(o=>!o.disabled).length,8);assert.equal(f.element('skyMapCustom').hidden,false);f.element('skyMapUse').onclick();assert.equal(f.c.hash,undefined);const n=f.accessCalls;f.element('skyMapLater').onclick();f.element('skyMapTime').value='12:34';f.element('skyMapTime').onchange();assert.equal(f.accessCalls,n);});

// E202: 通過チップはselectとは別経路。太陽/月の移動先権限も毎回同期する。
test('通過チップの天体変更で構図の2入口が権限に追従する',async()=>{
 const f=fixture({tools:['skymap','pearl'],saved:{at:Date.parse('2026-06-22T00:00:00+09:00'),body:'sun',targetId:'fuji',showSun:true,showMoon:true}});await f.open();
 const walk=e=>[e,...(e.children||[]).flatMap(walk)],buttons=walk(f.element('skyMapPassages')).filter(e=>e.type==='button');
 const moon=buttons.find(e=>e.textContent.startsWith('☾')),sun=buttons.find(e=>e.textContent.startsWith('☀'));assert.ok(moon);assert.ok(sun);
 for(const id of ['skyMapUse'])assert.equal(f.element(id).hidden,true);
 moon.onclick();assert.equal(f.element('skyMapBody').value,'moon');
 for(const id of ['skyMapUse']){assert.equal(f.element(id).hidden,false);assert.equal(f.element(id).disabled,false);}
 sun.onclick();for(const id of ['skyMapUse'])assert.equal(f.element(id).hidden,true);
});
// E202: 日付変更は配置している対象とは独立。閉じる/別対象選択は引き続き失効させる。
test('対象の標高取得中に日付を変えても配置は完了する',async()=>{
 const target=AL.TARGETS.find(t=>t.name.includes('森JP')),f=fixture({waiting:true,saved:{at:day,targetId:target.id}});f.c.SkyMapUI.open();await flush();f.release(5.5);await flush();
 f.element('skyMapHeight').valueAsNumber=20;const placing=f.element('skyMapPlaceTarget').onclick();await flush();
 f.element('skyMapNext').onclick();await flush();f.release(10);await placing;await flush();
 assert.equal(f.element('skyMapTarget').value,'custom');assert.equal(f.data.get('sorami.skyMap:testuser').custom.topM,30);assert.equal(f.data.get('sorami.skyMap:testuser').at,day+86400000);
});

test('対象の標高取得中の明示的な別目標選択を遅い配置結果が上書きしない',async()=>{
 const f=fixture({waiting:true,saved:{at:day,targetId:'skytree'}});f.c.SkyMapUI.open();await flush();f.release(5.5);await flush();
 f.element('skyMapHeight').valueAsNumber=20;const placing=f.element('skyMapPlaceTarget').onclick();await flush();
 f.element('skyMapTarget').value='fuji';f.element('skyMapTarget').onchange();await flush();f.release(10);await placing;
 assert.equal(f.element('skyMapTarget').value,'fuji');assert.equal(f.data.get('sorami.skyMap:testuser').custom,null);
});

test('日付スクロール中の計算結果失効でも方位円と現在位置を描き、古い日軌道を使わない',async()=>{
 const f=fixture();await f.open();f.arcs.length=0;f.discs.length=0;f.c.timeline.onChange(day+86400000+45240000);assert.ok(f.arcs.some(a=>a[2]>100),'方位円を保持');assert.ok(f.discs.length>0,'現在天体も描く');assert.ok(f.discs.every(d=>Number.isFinite(d.brightLimbZenithAngle)||d.body!=='moon'));f.c.timeline.onSettle();await flush();assert.ok(f.element('skyMapEvents').children.length>0);
});
test('未読込の追加天体があっても計算待ちの円と月を消さず、未準備engineのstateを呼ばない',async()=>{
 const f=fixture();await f.open();f.c.SoramiBodies={...B,ready:()=>false,state:()=>{throw Error('Unloaded planet')},ensure:id=>id==='jupiter'?Promise.reject(Error('load failure')):B.ensure(id)};f.element('skyMapExtra-jupiter').onclick();await flush();f.arcs.length=0;f.discs.length=0;assert.doesNotThrow(()=>f.c.timeline.onChange(day+86400000+45240000));assert.ok(f.arcs.some(a=>a[2]>100));assert.ok(f.discs.some(d=>d.body==='sun'||d.body==='moon'));assert.ok(!f.discs.some(d=>d.body==='jupiter'));
});

test('指を離さない日付変更中も現在日の出入線を描き、前日の線や空データにしない',async()=>{
 const f=fixture();await f.open();const nextDay=day+3*86400000,at=nextDay+45240000;f.drawOps.length=0;f.c.timeline.onChange(at);
 const expected=M.daily('sun',nextDay,{latitude:f.observer.latitude,longitude:f.observer.longitude,elevation:7},(body,at,o)=>{const s=A.sun(at,o);return {...s,altitude:s.geometricAltitude};});
 assert.equal(expected.events.length,2);const rays=f.drawOps.filter(x=>x.op==='lineTo'&&Math.hypot(x.args[0]-180,x.args[1]-180)>390*.36+10);
 for(const event of expected.events){const angle=Math.atan2(Math.sin(event.azimuth*Math.PI/180),Math.cos(event.azimuth*Math.PI/180))*180/Math.PI;assert.ok(rays.some(x=>Math.abs(M.delta(Math.atan2(x.args[0]-180,180-x.args[1])*180/Math.PI,angle))<.01),'選択日の'+event.side+'線');}
 assert.ok(f.drawOps.some(x=>x.op==='setLineDash'&&x.args[0][0]===9),'入りは破線');f.c.timeline.onSettle();await flush();
});

test('メニュー向け準備は日時/天体/地点/目の高さ/対象を保ち、先にleaveしない',async()=>{
 const at=day+45240000,observer={latitude:35.65829,longitude:139.70226,name:'渋谷スカイ',groundManualM:14.9,standAglM:229},f=fixture({saved:{at,body:'moon',observer,targetId:'skytree'}});await f.open();
 assert.equal(f.c.SkyMapUI.prepareFraming(),true);assert.equal(f.c.hash,undefined);assert.equal(f.aim.plannerTransfer.at,at);assert.equal(f.aim.body,'moon');assert.equal(f.element('aimDate').value,'2026-12-22');assert.equal(f.element('aimTarget').value,'skytree');assert.equal(f.data.get('sorami.aimTarget'),'skytree','モデル読込前の再読込でも対象を保持する');assert.equal(f.aim.from.standAglM,229);assert.equal(f.aim.from.groundManualM,14.9);
 f.c.SkyMapUI.leave();assert.equal(f.aim.plannerTransfer.at,at);assert.equal(f.aim.from.name,'渋谷スカイ');
});
test('メニュー向け準備も構図権限なし/離脱後は状態を転送しない',async()=>{
 const f=fixture({tools:['skymap'],saved:{at:day,targetId:'skytree'}});await f.open();assert.notEqual(f.c.SkyMapUI.prepareFraming(),true);assert.equal(f.aim.plannerTransfer,undefined);
 f.c.SkyMapUI.leave();assert.equal(f.c.SkyMapUI.prepareFraming(),false);assert.equal(f.aim.plannerTransfer,undefined);
});

test('撮影地点なしで開き、予測地点を補完せず、日付・対象の編集と地図からの配置ができる',async()=>{
 const f=fixture({selected:false,saved:{at:day,targetId:'skytree'}});await f.open();
 assert.equal(f.data.get('sorami.skyMap:testuser').observer,null);assert.equal(f.loads,0);assert.equal(f.calls,0);assert.equal(f.element('skyMapObserverClear').hidden,true);assert.equal(f.element('skyMapUse').disabled,false);assert.equal(f.element('skyMapPassages').children.length,0);
 f.element('skyMapNext').onclick();await flush();assert.equal(f.element('skyMapDate').value,'2026-12-23');assert.equal(f.loads,0);
 f.element('skyMapTargetTool').onclick();f.map.setCenter(35.7,139.9);f.element('skyMapTargetTool').onclick();assert.equal(f.element('skyMapTargetSheet').open,true);f.element('skyMapTargetClose').onclick();
 f.element('skyMapObserverTool').onclick();f.map.setCenter(35.65,139.79);f.element('skyMapObserverTool').onclick();await flush();assert.equal(f.data.get('sorami.skyMap:testuser').observer.latitude,35.65);assert.equal(f.element('skyMapObserverClear').hidden,false);assert.equal(f.loads,1);
});
test('地点の解除は保存され、遅い標高応答・再読込・構図からの移動でも地点が復活しない',async()=>{
 const f=fixture({waiting:true,saved:{at:day,targetId:'skytree'}});f.c.SkyMapUI.open();await flush();f.element('skyMapObserverClear').onclick();f.release(20);await flush();
 const saved=f.data.get('sorami.skyMap:testuser');assert.equal(saved.observer,null);assert.equal(f.element('skyMapAngles').children.length,0);assert.equal(f.element('skyMapPassages').children.length,0);
 const g=fixture({selected:false,saved});await g.open();assert.equal(g.loads,0);assert.equal(g.data.get('sorami.skyMap:testuser').observer,null);
 g.c.aimFromPoint=()=>null;g.element('skyMapOpen').onclick();await flush();assert.equal(g.data.get('sorami.skyMap:testuser').observer,null);assert.equal(g.element('skyMapTarget').value,g.aim.target.id);assert.equal(g.loads,0);
});

test('未選択で構図に移ると対象・天体・日付と未選択を渡し、以前の撮影地点を使わない',async()=>{
 const f=fixture({selected:false,saved:{at:day+12340000,targetId:'skytree',body:'moon'}});await f.open();f.aim.from={...f.observer};f.aim.plannerTransfer={at:1};
 assert.equal(f.c.SkyMapUI.prepareFraming(),true);assert.equal(f.aim.from,null);assert.equal(f.aim.plannerTransfer,null);assert.equal(f.aim.body,'moon');assert.equal(f.element('aimTarget').value,'skytree');assert.equal(f.element('aimDate').value,'2026-12-22');assert.equal(f.data.get('sorami.aimFrom'),null);assert.equal(f.loads,0);
});
test('候補の保存標高30mと地上4mを、DEM27.4mへすり替えず構図へ渡す',async()=>{
 const f=fixture({selected:false,ground:27.4,saved:{at:day,targetId:'skytree',body:'sun',partId:'__whole',limb:'center'}});await f.open();
 const target=AL.targetById('skytree'),expected=JSON.stringify(['sun',target,'__whole','center',day,'overlap']);
 assert.equal(f.c.SkyMapUI.selectCandidate({place:{name:'記録地点',latitude:35.72,longitude:139.86,elevation:30,eyeHeightAGL:4,standAglM:4},event:{at:day+55057000}},expected),true);await flush();
 assert.equal(f.data.get('sorami.skyMap:testuser').observer.groundManualM,30);assert.equal(f.loads,0);assert.equal(f.c.SkyMapUI.prepareFraming(),true);assert.equal(f.aim.from.groundManualM,30);assert.equal(f.aim.from.standAglM,4);assert.equal(f.aim.plannerTransfer.at,day+55057000);
});

test('地図共有は地点なし・離脱後を拒否し、計算済みの現在条件だけを返す',async()=>{
 let f=fixture({selected:false});await f.open();assert.throws(()=>f.c.SkyMapUI.shareState());
 f=fixture({saved:{at:day+55057000,body:'moon',targetId:'skytree',partId:'tip',limb:'behind',matchMode:'limb'}});await f.open();const p=f.c.SkyMapUI.shareState();assert.equal(p.at,day+55057000);assert.equal(p.body,'moon');assert.equal(p.limb,'behind');assert.equal(p.matchMode,'limb');assert.ok(Number.isFinite(p.eyeM));f.c.SkyMapUI.leave();assert.throws(()=>f.c.SkyMapUI.shareState());
});

 test('同じ座標と高さでも地図で選んだ地点の名称と説明を構図へ引き継ぐ',async()=>{
 const observer={name:'新しい地点名',subtitle:'変更後の説明',latitude:35.64285,longitude:139.78291,groundManualM:null,standAglM:1.5};
 const f=fixture({saved:{at:day,targetId:'skytree',observer}});await f.open();assert.equal(f.c.SkyMapUI.prepareFraming(),true);assert.equal(f.aim.from.name,observer.name);assert.equal(f.aim.from.subtitle,observer.subtitle);
 });
 test('構図からの保留転送はアカウントを変更した後に受け取らない',async()=>{
 const f=fixture({accessWaiting:true,selected:false});f.c.SkyMapUI.enter(true);await flush();f.c.auth={token:'other-token',loginId:'other',tools:['skymap','tower']};f.c.SkyMapUI.authChanged();await flush();
 f.c.accessRequests.at(-1)({allowed:true,tool:'skymap',tools:['skymap','tower'],loginId:'other'});await flush();assert.equal(f.element('skyMapContent').hidden,false);assert.equal(f.c.SkyMapUI.snapshot(),null);assert.equal(f.element('skyMapObserver').textContent,'撮影地点を選ぶ');
 f.c.accessRequests[0]({allowed:true,tool:'skymap',tools:['skymap','tower'],loginId:'testuser'});await flush();assert.equal(f.element('skyMapContent').hidden,false);assert.equal(f.c.SkyMapUI.snapshot(),null);assert.equal(f.element('skyMapObserver').textContent,'撮影地点を選ぶ');
 });
test('予測からの地図入口は地点・高さ・選択日を渡し、対象と天体は維持する',async()=>{
 const f=fixture({saved:{at:day,body:'moon',targetId:'skytree'}});const observer={name:'予測の場所',latitude:36,longitude:138,groundManualM:1665,eyeHeightAGL:4};
 assert.equal(f.c.SkyMapUI.enterForecast(observer,day+86400000),true);await flush();const state=f.c.SkyMapUI.snapshot();assert.equal(state.observer.name,observer.name);assert.equal(state.observer.groundManualM,1665);assert.equal(state.body,'moon');assert.equal(state.target.id,'skytree');assert.equal(state.at,day+86400000+43200000);
});

// 2026-10-18: 候補日の非同期探索は日付操作と独立し、別条件・離脱後の応答を破棄する。
test('地図候補は構図の共通描画を使い、日付移動で再探索しない',async()=>{
 let searches=0;const at=Date.now()+86400000;
 const f=fixture({tools:['skymap','tower','pearl'],saved:{targetId:'fuji',body:'moon'},datesSearch:async()=>{searches++;return[{at,side:'set',illuminated:.5}]}});await f.open();await flush();
 assert.match(f.element('skyMapDates').innerHTML,/月の入/);assert.doesNotMatch(f.element('skyMapDates').innerHTML,/日の入/);assert.match(f.element('skyMapDates').innerHTML,new RegExp('data-from-at="'+at+'"'));
 f.c.SkyMapUI.setTime(at);await flush();assert.equal(searches,1);assert.equal(f.c.SkyMapUI.snapshot().at,at);assert.equal(f.element('skyMapUseBelow').hidden,false);
 f.element('skyMapUseBelow').onclick();assert.equal(f.c.hash,'#/aim');assert.equal(f.aim.plannerTransfer.at,at);
});
test('地図候補の旧探索と離脱後の応答は候補欄へ戻らない',async()=>{
 const pending=[];const f=fixture({saved:{targetId:'skytree'},datesSearch:(...args)=>new Promise(resolve=>pending.push({resolve,options:args[5]}))});await f.open();assert.equal(pending.length,1);
 f.c.SkyMapUI.setTarget('fuji');await flush();assert.equal(pending[0].options.isCurrent(),false);assert.equal(pending.length,2);
 pending[0].resolve([{at:Date.now()+86400000,side:'set'}]);await flush();assert.doesNotMatch(f.element('skyMapDates').innerHTML,/data-from-at/);
 f.c.SkyMapUI.leave();assert.equal(pending[1].options.isCurrent(),false);pending[1].resolve([]);await flush();
});
test('地図候補の失敗は再試行でき、空結果は日付変更でも保持する',async()=>{
 let searches=0;const f=fixture({saved:{targetId:'skytree'},datesSearch:async()=>{if(++searches===1)throw Error('synthetic');return[]}});await f.open();await flush();assert.match(f.element('skyMapDates').innerHTML,/再試行/);
 f.element('skyMapDates[data-dates-retry]').onclick();await flush();assert.match(f.element('skyMapDates').innerHTML,/候補日は見つかりません/);
 f.c.SkyMapUI.setTime(Date.now()+2*86400000);await flush();assert.equal(searches,2);
});

test('地図の撮影地点も共通部品で星・標高を表示し、登録編集・解除を反映する',async()=>{
 const f=fixture({ground:19});f.c.favorites=[{id:'saved',name:'保存済み',latitude:35.64285,longitude:139.78291}];await f.open();
 assert.equal(f.element('skyMapObserverFav').textContent,'★');assert.equal(f.element('skyMapObserverFav')['aria-label'],'お気に入りを編集');assert.equal(f.element('skyMapObserverSub').textContent,'標高 19m');
 let after;f.c.favForPoint=(p,cb)=>{after=cb;assert.equal(p.elevation,19);};f.element('skyMapObserverFav').onclick();
 after({...f.c.favorites[0],name:'変更した名前',eyeHeightAGL:80});await flush();assert.equal(f.element('skyMapObserver').textContent,'変更した名前');
 f.c.favorites=[];f.c.SkyMapUI.render();assert.equal(f.element('skyMapObserverFav').textContent,'☆');
 f.element('skyMapObserverClear').onclick();assert.equal(f.element('skyMapObserverFav').hidden,true);assert.equal(f.element('skyMapObserverSub').textContent,'');
});
test('地図の星から開いた古い編集結果は別の撮影地点へ適用しない',async()=>{
 const f=fixture();await f.open();let after;f.c.favForPoint=(p,cb)=>after=cb;f.element('skyMapObserverFav').onclick();f.c.SkyMapUI.setObserver({name:'別の地点',latitude:35.64286,longitude:139.78292});await flush();after({name:'古い編集',latitude:35.64285,longitude:139.78291});assert.equal(f.element('skyMapObserver').textContent,'別の地点');
});
