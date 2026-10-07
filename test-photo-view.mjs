import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const require=createRequire(import.meta.url),AL=require("./sorami-align.js"),S=require("./sorami-core.js");
// 10/3 に月が先端の約23′下を通る位置（2026-10-05、方位を楕円体にしたので元の 35.58386,139.56853 から視線に直角に52m動かした）
const observer={latitude:35.583465,longitude:139.568839,elevation:83},target=AL.targetById("skytree");
const day=d=>Date.parse(`2026-10-${d}T00:00:00+09:00`);
test("先端より下を通る月も建物全体との重なりとして候補へ出す",()=>{
 const row=AL.dailyView(observer,target,"moon",day("03"),{partId:"tip"})[0];
 assert.ok(row.gap < -row.radius);assert.equal(row.intersects,true);
 const next=AL.buildingUpcoming(observer,target,"moon",{from:day("03"),days:31,limit:4,partId:"tip"});
 assert.ok(next.some(e=>S.JstCal.sameDay(e.at,day("03"))));
 assert.ok(AL.buildingUpcoming(observer,target,"moon",{from:row.at+1000,days:31,limit:4}).every(e=>e.at>row.at));
});
test("重ならない日と地平線の下の日にも日内の見え方を返す",()=>{
 for(const d of ["02","04"]){const rows=AL.dailyView(observer,target,"moon",day(d),{partId:"tip"});assert.ok(rows.length);assert.ok(rows.every(e=>e.at>=day(d)&&e.at<day(d)+86400000));assert.equal(rows[0].intersects,false);}
 assert.ok(AL.dailyView(observer,target,"moon",day("04"))[0].altitude<0);
});
test("輪郭の内部・縁と円盤の距離を正しく区別する",()=>{
 const square=[[0,0],[2,0],[2,2],[0,2]];
 assert.equal(AL.polygonDistance([1,1],square),0);assert.equal(AL.polygonDistance([1,0],square),0);
 assert.equal(AL.polygonDistance([3,1],square),1);assert.ok(Math.abs(AL.polygonDistance([3,3],square)-Math.SQRT2)<1e-12);
});
test("焦点距離・センサーサイズ・縦横から実画角を計算する",()=>{
 const full=AL.cameraFrame(50),aps=AL.cameraFrame(50,23.5,15.6),portrait=AL.cameraFrame(50,36,24,true),tele=AL.cameraFrame(100);
 assert.ok(Math.abs(full.horizontalDeg-39.597752709)<1e-8);assert.ok(Math.abs(full.verticalDeg-26.991466562)<1e-8);
 assert.ok(aps.horizontalDeg<full.horizontalDeg);assert.equal(portrait.horizontalDeg,full.verticalDeg);assert.equal(portrait.verticalDeg,full.horizontalDeg);
 assert.equal(tele.halfW,full.halfW/2);assert.equal(AL.cameraFrame(0),null);assert.equal(AL.cameraFrame(NaN),null);assert.equal(AL.cameraFrame(2001),null);
});
test("日付変更で重なりなしや見通しNGでも図へ描画を渡す",async()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8"),a=html.indexOf("async function aimUpdateLook()"),b=html.indexOf("\n}const aimCandName",a)+2;
 const host={hidden:true},aim={target,body:"moon",partId:"tip",candPick:null,candSide:null,lookSeq:0,sight:{hidden:true,key:"same"}};
 let rendered;const c=vm.createContext({SoramiTerrain:{decksFor:()=>null},SoramiBodies:globalThis.SoramiBodies,aim,$:()=>host,S,SoramiAlign:AL,aimFromPoint:()=>({...observer,name:"試験地点"}),aimElevation:async()=>83,aimLookRender:(h,s)=>{h.hidden=false;rendered=s},aimIsMountain:t=>!!t.rim,aimCalSolid:e=>e.intersects??Math.abs(e.gap)<=1.2*e.radius,aimCandidateMatch:e=>Math.abs(e.gap)<=Math.max(1/60,.2*(e.radius||0)),aimDateLabel:()=>"日付",aimSideName:()=>"月の出",aimPassage:()=>"通過",moonGlyphAt:()=>"月",lightTimingText:()=>"夜",Math,Date,Number});
 vm.runInContext(html.slice(html.indexOf('function aimObserverEye('),html.indexOf('aim.from = aimSavedFrom'))+html.slice(a,b)+";this.update=aimUpdateLook",c);
 for(const d of ["03","02","04"]){aim.dayMs=day(d);await c.update();assert.equal(host.hidden,false);assert.ok(rendered);assert.equal(rendered.obs.latitude,observer.latitude);assert.ok(rendered.at>=day(d)&&rendered.at<day(d)+86400000);assert.equal(rendered.atName,d==="03"?undefined:"最接近");}
 assert.equal(rendered.sub, "");
 assert.match(rendered.extra,/地平線の下/);
});

test("日末10分内の方位通過も他の通過とともに当日内で検出する",()=>{
 const Astro=require("./sorami-astro.js"),old=Astro.moon,start=day("03");
 const geo=AL.geometryFrom(observer,target,{partId:"tip"});
 try {
  Astro.moon=(at)=>{const min=(at-start)/60000;const diff=min<=720?min/36-10:min<1430?10:10-(min-1430)*2;return {azimuth:geo.azimuth+diff,apparentAltitude:1,angularRadius:.27,illuminatedFraction:.5}};
  const rows=AL.dailyView(observer,target,"moon",start,{partId:"tip"});
  assert.ok(rows.length>=2);assert.ok(rows.some(e=>e.at>=start+1430*60000));assert.ok(rows.every(e=>e.at>=start&&e.at<start+86400000));
 }finally{Astro.moon=old}
});
test("焦点距離の空欄・範囲外は保存せず、有効値のみ反映する",()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8"),a=html.indexOf("  lensFocal.onchange = () =>"),b=html.indexOf("  host.querySelector(\"[data-lens-apply]\")",a);
 for(const value of ["","0","2001","600"]){let reports=0,saves=0;const lensFocal={value,checkValidity:()=>true,reportValidity:()=>reports++},aimLens={focal:200,on:false};
  new Function("lensFocal","aimLens","saveLens",html.slice(a,b)+"lensFocal.onchange();")(lensFocal,aimLens,()=>saves++);
  assert.equal(saves,value==="600"?1:0);assert.equal(aimLens.focal,value==="600"?600:200);assert.equal(reports,value==="600"?0:1);
 }
});

test("年間探索は途中で操作に戻り、古い地点の結果を破棄する",async()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8"),a=html.indexOf("function aimCandidateMatch"),b=html.indexOf("async function aimRenderFrom",a);
 const aim={fromSeq:1};let calls=0,waits=0;
 const c=vm.createContext({SoramiBodies:globalThis.SoramiBodies,aim,S,Date,Promise,setTimeout:(f)=>{waits++;if(waits===2)aim.fromSeq=2;f()},SoramiAlign:{dailyView:()=>{calls++;return []}}});
 vm.runInContext(html.slice(html.indexOf('function aimObserverEye('),html.indexOf('aim.from = aimSavedFrom'))+html.slice(a,b)+";this.run=aimBuildingDays",c);
 const rows=await c.run(observer,target,"moon","__whole",1);assert.equal(rows.length,0);assert.equal(calls,8);assert.equal(waits,2);
});


test("自動表示は旧200mmを移行せず、手動指定だけ保持する",()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8"),a=html.indexOf("const AIM_SENSOR ="),b=html.indexOf("const aimLookHosts",a);
 for(const [saved,mode] of [[{},"auto"],[{on:true,focal:200},"auto"],[{mode:"manual",on:true,focal:700},"manual"]]) {
  const c=vm.createContext({SoramiBodies:globalThis.SoramiBodies,localStorage:{getItem:()=>JSON.stringify(saved)}});vm.runInContext(html.slice(html.indexOf('function aimObserverEye('),html.indexOf('aim.from = aimSavedFrom'))+html.slice(a,b)+";this.lens=aimLens",c);
  assert.equal(c.lens.mode,mode);assert.equal(c.lens.on,true);if(mode==="manual")assert.equal(c.lens.focal,700);
 }
});
test("自動表示の相当焦点距離を反映しても図の縮尺が変わらない",()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8"),a=html.indexOf("  const sensor = AIM_SENSOR[aimLens.sensor]"),b=html.indexOf("  const proj =",a);
 for(const sensor of ["full","aps","canon","m43"])for(const portrait of [false,true])for(const [W,H] of [[316,284],[610,440]]) {
  const base=AL.viewWindow({azimuth:70,baseAngle:.1,topAngle:1.3,radiusDeg:.27,aspect:W/H}),info={textContent:""},button={setAttribute:()=>{}},lensFocal={};
  const aimLens={sensor,portrait,mode:"auto",on:true};const c=vm.createContext({SoramiBodies:globalThis.SoramiBodies,AIM_SENSOR:{full:[36,24],aps:[23.5,15.6],canon:[22.3,14.9],m43:[17.3,13]},aimLens,win:{...base},W,H,lensFocal,Math,SoramiAlign:AL,host:{querySelector:q=>q.includes("auto")?button:info}});
  vm.runInContext(html.slice(a,b),c);assert.equal(c.win.halfH,base.halfH);assert.match(info.textContent,/^約/);
  aimLens.mode="manual";aimLens.focal=+lensFocal.value;c.win={...base};vm.runInContext("{ "+html.slice(a,b)+" }",c);
  assert.ok(Math.abs(c.win.halfH/base.halfH-1)<.0002);assert.equal(c.win.alt0,base.alt0);
 }
});
test("山でも基準線に吸着・離脱し、構図の移動・復帰は時刻と天体逆引きを変えない",()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8"),a=html.indexOf('  const move = host.querySelector("[data-lens-move]")'),b=html.indexOf('  cur = timeIndex(selectedAt); draw(cur);',a);
 let draws=0,prevented=0,clears=0;const move={setAttribute:()=>{}},center={},hint={},host={_lensMoving:true,_pick:null,querySelector:q=>q.includes("hint")?hint:q.includes("center")?center:move};
 const cv={style:{},setPointerCapture:()=>{}},cur=43,W=316,H=284,k=10,frame={halfW:5,halfH:6};
 const c=vm.createContext({SoramiBodies:globalThis.SoramiBodies,panLimit:1,host,cv,cur,W,H,k,frame,hiddenY:null,baseY:220,groundEdge:220,mountain:true,navigator:{vibrate:()=>{}},Math,draw:()=>draws++,aimLookRender:()=>{},aimReverseClear:()=>clears++,spec:{}});vm.runInContext(html.slice(a,b),c);
 cv.onpointerdown({clientX:100,clientY:100,pointerId:1});cv.onpointermove({pointerId:1,clientX:150,clientY:120});cv.onpointerup();
 assert.ok(host._lensOffset[0]>0);assert.ok(host._lensOffset[1]>0);assert.equal(c.cur,43);assert.equal(host._pick,null);
 cv.onkeydown({key:"ArrowLeft",preventDefault:()=>prevented++});assert.equal(prevented,1);center.onclick();assert.deepEqual(Array.from(host._lensOffset),[0,0]);assert.ok(draws>=3);
 // 下端202px、地面220px。吸着→近傍維持→離脱と横移動の独立性。
 cv.onpointerdown({clientX:100,clientY:100,pointerId:1});
 cv.onpointermove({pointerId:1,clientX:130,clientY:86});assert.equal(host._lensOffset[1],-18/H);
 cv.onpointermove({pointerId:1,clientX:140,clientY:94});assert.equal(host._lensOffset[1],-18/H);
 cv.onpointermove({pointerId:1,clientX:150,clientY:105});assert.equal(host._lensOffset[1],5/H);
 cv.onpointerup();assert.equal(host._lensOffset[0],50/W);
 host._lensOffset=[0,(-18+4)/H];cv.onkeydown({key:"ArrowUp",preventDefault:()=>{}});assert.equal(host._lensOffset[1],-18/H);
 for(let i=0;i<10;i++)cv.onkeydown({key:"ArrowUp",preventDefault:()=>{}});assert.ok(host._lensOffset[1]<-36/H);
 center.onclick();
 cv.onpointerdown({clientX:100,clientY:100,pointerId:1});
 cv.onpointermove({pointerId:1,clientX:107,clientY:150});assert.equal(host._lensOffset[0],0);assert.ok(host._lensOffset[1]>0);
 cv.onpointermove({pointerId:1,clientX:116,clientY:155});assert.equal(host._lensOffset[0],0);
 cv.onpointermove({pointerId:1,clientX:125,clientY:160});assert.equal(host._lensOffset[0],25/W);
 cv.onpointerup();center.onclick();host._pick={result:{}};move.onclick();assert.equal(host._pick,null);assert.equal(clears,1);
});


test("図を移動しても画角枠は中央、道のタップは移動分を引いて時刻を選ぶ",()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8"),a=html.indexOf("  cv.onclick = (ev) => {",html.indexOf("async function aimLookRender")),b=html.indexOf("  aimLookPick(host",a);
 const cv={getBoundingClientRect:()=>({left:10,top:20})},host={_lensOffset:[.2,.1]},range={};let drawn=-1;
 const c=vm.createContext({SoramiBodies:globalThis.SoramiBodies,cv,host,range,W:300,H:270,path:[{x:5,y:6},{x:10,y:20}],toPx:xy=>xy,Math,draw:i=>drawn=i});
 vm.runInContext(html.slice(a,b),c);cv.onclick({clientX:10+60+10,clientY:20+27+20});assert.equal(drawn,1);assert.equal(range.value,"1");
 host._lookSceneBottom=40;drawn=-1;cv.onclick({clientX:80,clientY:67});assert.equal(drawn,-1);
 // ポインターは範囲内でも、36px以内の省略された候補点を選ばない。
 cv.onclick({clientX:80,clientY:59});assert.notEqual(drawn,1);

 const f=html.slice(html.indexOf("    if (frame) {",html.indexOf("const draw = (v)")),html.indexOf('    const outside = host.querySelector'));
 assert.match(f,/const fx = \(W - fw\) \/ 2, fy = \(H - fh\) \/ 2/);assert.doesNotMatch(f,/_lensOffset/);
 assert.match(html,/ctx\.save\(\); ctx\.translate\(panX, panY\)/);assert.match(html,/const px = screenX - panX, py = screenY - panY/);
});


test("稜線の地形範囲は画角・構図移動で粗くならない",async()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8");
 const ridge=html.slice(html.indexOf("const aimRidgeCache"),html.indexOf("const AIM_SENSOR"));
 let calls=0;
 const c=vm.createContext({SoramiAtmosphere:{targetK:()=>7/6},aimAirAngle:()=>2,SoramiTerrain:{distanceKm:()=>100,bearing:()=>180,destination:(lat,lng,az,d)=>({latitude:lat,longitude:lng}),elevations:async pts=>{calls++;return pts.map(()=>1000)}},SoramiAlign:{rimOutline:()=>null},SoramiAstro:{targetElevationAngle:()=>2}});
 vm.runInContext(ridge,c);
 const obs={latitude:35,longitude:139},target={latitude:36,longitude:139,parts:[{m:3776}]};
 const narrow=await c.aimLookRidge(obs,10,target,{az0:180,alt0:2,halfW:3,panLimit:1});
 const wide=await c.aimLookRidge(obs,10,target,{az0:180,alt0:2,halfW:144,panLimit:20});
 assert.equal(narrow,wide);assert.equal(calls,1);assert.equal(narrow.length,241);
 assert.ok(narrow.every(([,alt])=>Number.isFinite(alt)));assert.ok(narrow.at(-1)[0]-narrow[0][0]<18);
});


test("画角への出入りは円盤の縁で判定し、構図移動で時刻が変わる",()=>{
 const points=[{at:0,x:-3,y:0,radius:.5},{at:60000,x:3,y:0,radius:.5}],frame={halfW:1,halfH:1};
 const r=AL.framePassages(points,frame);assert.equal(r.length,1);const R=Math.PI/180,edge=Math.tan(Math.atan(R)+.5*R)/R;assert.ok(Math.abs(r[0].start-60000*(3-edge)/6)<1);assert.ok(Math.abs(r[0].end-60000*(3+edge)/6)<1);
 const moved=AL.framePassages(points,frame,{x:1,y:0});const left=Math.tan(Math.atan(-2*R)-.5*R)/R,right=Math.tan(.5*R)/R;assert.ok(Math.abs(moved[0].start-60000*(3+left)/6)<1);assert.ok(Math.abs(moved[0].end-60000*(3+right)/6)<1);
 assert.equal(AL.framePassages(points,frame,{y:4}).length,0);assert.equal(AL.framePassages(points,null).length,0);
});
test("矩形の角をかすめる通過と日境界・投影外を区別する",()=>{
 const frame={halfW:1,halfH:1};
 const glancing=AL.framePassages([{at:0,x:-2,y:0,radius:.1},{at:60000,x:0,y:2,radius:.1}],frame);assert.equal(glancing.length,1);assert.ok(glancing[0].start>0&&glancing[0].end<60000);
 const staying=AL.framePassages([{at:0,x:0,y:0,radius:.1},{at:60000,x:0,y:0,radius:.1}],frame);assert.ok(staying[0].openStart&&staying[0].openEnd);
 assert.equal(AL.framePassages([{at:0,x:null,y:null,radius:.1},{at:60000,x:0,y:0,radius:.1}],frame).length,0);
});
test("当日の画角判定用の道は深夜から翌0時まで切らずに生成する",()=>{
 const start=day("03"),points=AL.frameDayPath("moon",observer,start,AL.viewProjector(60,5));
 assert.equal(points[0].at,start);assert.equal(points.at(-1).at,start+86400000);assert.equal(points.length,1441);assert.ok(points.every(p=>Number.isFinite(p.radius)));
});


test("広角の画面端は拡大する円盤の縁で入る時刻を判定する",()=>{
 const R=Math.PI/180,edge=Math.tan(Math.atan(100*R)+.25*R)/R;
 const spans=AL.framePassages([{at:0,x:102,y:0,radius:.25},{at:60000,x:98,y:0,radius:.25}],{halfW:100,halfH:10});
 assert.equal(spans.length,1);assert.ok(Math.abs(spans[0].start-(102-edge)/4*60000)<1);assert.ok(spans[0].openEnd);
});
test("採取間隔の不正値は無限ループせず拒否する",()=>{
 for(const stepS of [0,-1,NaN,Infinity,.01,61]) assert.throws(()=>AL.frameDayPath("moon",observer,day("03"),()=>[0,0],{stepS}),RangeError);
 assert.throws(()=>AL.frameDayPath("moon",observer,NaN,()=>[0,0]),RangeError);
});


test("2本指のピンチは焦点距離と構図を連動し、再描画後も累積誤差なし・指を離すとドラッグへ戻る",()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8"),a=html.indexOf('  const move = host.querySelector("[data-lens-move]")'),b=html.indexOf('  cur = timeIndex(selectedAt); draw(cur);',a),code="{ "+html.slice(a,b)+" }";
 let queued=null,renders=0,saved=0,draws=0;
 const controls={move:{setAttribute:()=>{}},center:{},hint:{}};
 const host={_lensMoving:true,_pick:null,_lensOffset:[.1,.1],querySelector:q=>q.includes("hint")?controls.hint:q.includes("center")?controls.center:controls.move};
 const cv={style:{},setPointerCapture:()=>{},getBoundingClientRect:()=>({left:0,top:0})};
 const R=Math.PI/180,H=300,W=300,halfH=24/(2*200*R)*1.12,aimLens={mode:"manual",focal:200,on:true};
 const c=vm.createContext({SoramiBodies:globalThis.SoramiBodies,panLimit:1,host,cv,cur:43,W,H,k:H/2/halfH,frame:{halfH:24/(400*R)},win:{halfH},focal:200,sh:24,sw:36,hiddenY:null,baseY:250,groundEdge:250,mountain:false,navigator:{},Math,Map,aimLens,localStorage:{setItem:()=>saved++},spec:{},draw:()=>draws++,aimReverseClear:()=>{},requestAnimationFrame:fn=>{queued=fn;return 1;},cancelAnimationFrame:()=>{queued=null;},aimLookRender:()=>{renders++;c.focal=aimLens.focal;c.win={halfH:Math.max(24/(2*c.focal*R),36/(2*c.focal*R))*1.12};vm.runInContext(code,c);}});
 // 正方形では横寸法が画面範囲を決める。
 c.win.halfH=36/(400*R)*1.12;c.k=H/2/c.win.halfH;
 vm.runInContext(code,c);
 cv.onpointerdown({pointerId:1,clientX:100,clientY:150});cv.onpointerdown({pointerId:2,clientX:200,clientY:150});
 cv.onpointermove({pointerId:2,clientX:300,clientY:150});assert.equal(aimLens.focal,200);queued();assert.equal(aimLens.focal,400);assert.equal(aimLens.mode,"manual");assert.ok(Math.abs(host._lensOffset[0]-(.2+50/W))<1e-9);
 cv.onpointermove({pointerId:2,clientX:400,clientY:150});queued();assert.equal(aimLens.focal,600);assert.ok(Math.abs(host._lensOffset[0]-(.3+100/W))<1e-9);assert.ok(Math.abs(host._lensOffset[1]-.3)<1e-9);
 cv.onpointerup({pointerId:2});const before=[...host._lensOffset];cv.onpointermove({pointerId:1,clientX:110,clientY:160});assert.ok(Math.abs(host._lensOffset[0]-before[0]-10/W)<1e-9);assert.equal(renders,2);assert.equal(saved,2);assert.ok(draws>0);
 cv.onpointercancel({pointerId:1});assert.equal(host._lensGesture.points.size,0);
 // 狭めると広角になり、範囲を超えても8mm以上。
 cv.onpointerdown({pointerId:1,clientX:0,clientY:0});cv.onpointerdown({pointerId:2,clientX:1000,clientY:0});cv.onpointermove({pointerId:2,clientX:1,clientY:0});queued();assert.equal(aimLens.focal,8);
 cv.onpointercancel({pointerId:1});cv.onpointercancel({pointerId:2});
 // 次のRAFより早く指を離しても最後の拡大率を反映。余分な指/重複lostcaptureは無視。
 cv.onpointerdown({pointerId:1,clientX:100,clientY:150});cv.onpointerdown({pointerId:2,clientX:200,clientY:150});
 cv.onpointermove({pointerId:2,clientX:300,clientY:150});assert.equal(aimLens.focal,8);
 cv.onpointerup({pointerId:99});assert.equal(aimLens.focal,8);
 cv.onpointerup({pointerId:2});assert.equal(aimLens.focal,16);assert.equal(host._lensGesture.points.size,1);
 const r=renders;cv.onlostpointercapture({pointerId:2});assert.equal(renders,r);cv.onpointercancel({pointerId:1});
});


test("拡大で道が短くなっても表示範囲外の選択時刻と20秒未満の補間時刻を残す",()=>{
 const obs={latitude:35.68,longitude:139.76,elevation:10},at=Date.parse("2026-10-03T06:00:00+09:00"),st=globalThis.SoramiAstro.sun(at,obs),proj=AL.viewProjector(st.azimuth,st.apparentAltitude),win={halfW:.1,halfH:.1};
 const short=AL.viewPath("sun",obs,at,proj,win),selected=at+1837000;
 assert.ok(short.at(-1).at<selected);
 const kept=AL.viewPath("sun",obs,at,proj,win,{includeAt:selected});assert.ok(kept.some(p=>p.at===selected));assert.ok(kept.at(-1).at>=selected);assert.ok(kept.length>short.length);
 const exact=kept.find(p=>p.at===selected),expected=globalThis.SoramiAstro.sun(selected,obs);assert.equal(exact.altitude,expected.apparentAltitude);
 for(let i=1;i<kept.length;i++)assert.ok(kept[i].at>kept[i-1].at);
 const early=AL.viewPath("sun",obs,at,proj,win,{includeAt:at-1737000});assert.ok(early.some(p=>p.at===at-1737000));
});


test("候補帯は選択高さの許容誤差だけ採用し、全体モードは輪郭通過を採用",async()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8"),a=html.indexOf("function aimCandidateMatch"),b=html.indexOf("async function aimRenderFrom",a);
 const aim={fromSeq:1,partId:"tip",limb:"lower"},seen=[],now=Date.now();
 const c=vm.createContext({aim,S,Date,Promise,setTimeout:f=>f(),SoramiAlign:{
 upcoming:(o,t,body,opts)=>{seen.push(opts);return [{at:opts.from+23*3600000,gap:seen.length<3?.2:.03,radius:.25,sunAltitude:-10,intersects:true}];},
 dailyView:()=>[{at:now+86400000,gap:2,radius:.25,intersects:true,sunAltitude:-10}]
 }});vm.runInContext(html.slice(a,b),c);
 assert.equal(c.aimCandidateMatch({gap:.05,radius:.25,intersects:false}),true);
 assert.equal(c.aimCandidateMatch({gap:.051,radius:.25,intersects:true}),false);
 assert.equal(c.aimCandidateMatch({gap:.01,radius:0}),true);
 assert.equal(c.aimCandidateMatch({gap:.02,radius:0}),false);
 assert.equal(c.aimCandidateMatch({gap:2,intersects:true},true),true);
 const selected=await c.aimBuildingDays(observer,target,"moon","tip",1);
 assert.equal(selected.length,4);assert.ok(selected.every(e=>e.gap===.03));assert.ok(seen.every(o=>o.partId==="tip"&&o.limb==="lower"));
 const whole=await c.aimBuildingDays(observer,target,"moon","__whole",1);assert.equal(whole.length,4);assert.ok(whole.every(e=>e.gap===2));
});

// 2026-10-06 観測標高を「標高」と「地上から」に分け、展望台では床の高さ229mに目の高さ1.5mを足す（候補地を解く SoramiAlign と同じ）。
// aimFromPoint が返すのは aimSavedFrom を通った形（立つ所 stand と展望台 decks）
test("渋谷スカイの図の基準時刻は展望台229m＋目の高さ1.5mの直接計算に一致し、標高と二重加算しない",async()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8");
 const f={name:"渋谷スカイ",latitude:35.65838,longitude:139.70222,decks:[{name:"展望台",aglM:229}],stand:"展望台"},host={hidden:true};
 const aim={target,body:"moon",partId:"tip",limb:"center",candPick:null,candSide:null,dayMs:day("04"),lookSeq:0};
 let rendered;const c=vm.createContext({aim,$:()=>host,S,SoramiAlign:AL,SoramiBodies:globalThis.SoramiBodies,SoramiTerrain:{decksFor:()=>null},aimFromPoint:()=>f,aimElevation:async()=>19,aimLookRender:(h,s)=>rendered=s,aimIsMountain:()=>false,aimCandidateMatch:e=>Math.abs(e.gap)<=Math.max(1/60,.2*(e.radius||0)),moonGlyphAt:()=>"月",lightTimingText:()=>"夜",Date,Math,Number});
 const a=html.indexOf('async function aimUpdateLook()'),b=html.indexOf('\n}const aimCandName',a)+2;
 vm.runInContext(html.slice(html.indexOf('function aimObserverEye('),html.indexOf('aim.from = aimSavedFrom'))+html.slice(a,b),c);await c.aimUpdateLook();
 const obs={latitude:f.latitude,longitude:f.longitude,elevation:19};
 const expected=AL.dailyView(obs,target,'moon',day('04'),{partId:'tip',eyeM:230.5}).sort((x,y)=>Math.abs(x.gap)-Math.abs(y.gap))[0];
 assert.equal(rendered.eyeM,230.5);assert.equal(rendered.obs.elevation,19);assert.equal(rendered.at,expected.at);assert.equal(rendered.sub,'');
 const ground=AL.geometryFrom(obs,target,{partId:'tip',eyeM:1.5}),roof=AL.geometryFrom(obs,target,{partId:'tip',eyeM:229});
 assert.ok(ground.angle-roof.angle>.8);assert.notEqual(AL.dailyView(obs,target,'moon',day('04'),{partId:'tip',eyeM:1.5})[0].at,expected.at);
});


test('9分割と対角グリッドは撮影枠だけに描き中央で交差する',()=>{
 const source=readFileSync(new URL('./index.html',import.meta.url),'utf8');
 const a=source.indexOf('function aimDrawGrid('),b=source.indexOf('const aimLens =',a);
 const draw=new Function(source.slice(a,b)+';return aimDrawGrid;')();
 const lines=[],ctx={save(){},restore(){},setLineDash(){},beginPath(){},moveTo(x,y){lines.push(['M',x,y])},lineTo(x,y){lines.push(['L',x,y])},stroke(){}};
 draw(ctx,10,20,300,150,'none');assert.equal(lines.length,0);
 draw(ctx,10,20,300,150,'thirds');assert.equal(lines.length,8);assert.deepEqual(lines.slice(0,4),[['M',110,20],['L',110,170],['M',10,70],['L',310,70]]);
 lines.length=0;draw(ctx,10,20,300,150,'diagonal');assert.equal(lines.length,12);assert.deepEqual(lines.slice(8),[['M',10,20],['L',310,170],['M',310,20],['L',10,170]]);
});

test("ティンカーベル全体は像と杖だけに当たり、ホテルとドームには当たらない",()=>{
 const obs={latitude:35.640308,longitude:139.871555,elevation:2.8},t=AL.targetById("tinkerbell"),o=AL.towerOutline(obs,t),A=require("./sorami-astro.js");
 assert.equal(t.wholeLabel,"像全体に重なる");assert.ok(o.hitPoints.length>20);assert.ok(o.points.length>o.hitPoints.length);
 const hit=o.hitPoints.reduce((a,p)=>p[1]>a[1]?p:a),positions=[{p:hit,expected:true},{p:[o.azimuth,A.targetElevationAngle(o.distanceKm,4.3,t.parts[0].m-8)],expected:false},{p:[o.azimuth,A.targetElevationAngle(o.distanceKm,4.3,25)],expected:false}];
 for(const {p,expected}of positions){
  const c=vm.createContext({require,SoramiBodies:{state:()=>({azimuth:p[0],apparentAltitude:p[1],angularRadius:.00001,geometricAltitude:p[1]})}});
  vm.runInContext(readFileSync(new URL("./sorami-align.js",import.meta.url),"utf8"),c);
  const rows=c.SoramiAlign.dailyView(obs,t,"venus",day("03"));assert.ok(rows.length);assert.ok(rows.every(r=>r.intersects===expected));
 }
 const min=Math.min(...o.hitPoints.map(p=>p[1])),base=A.targetElevationAngle(o.distanceKm,4.3,t.parts[0].m-2.5);
 assert.ok(Math.abs(min-base)<.001);
});

// 城の参照方向は10/7ユーザー提示の地点候補へ更新。以前の逆算地点を消さない。
test("城の撮影地点候補と像の逆算地点は出典を分けて保持する",()=>{
 const v=AL.TOWER_SHAPES.cinderella.referenceView,TR=require("./sorami-terrain.js"),t=AL.targetById("cinderella");
 assert.equal(v.source,"user-estimated");assert.equal(v.observer.latitude,35.6394512);assert.equal(v.observer.longitude,139.8405504);
 assert.ok(Math.abs(TR.distanceKm(v.inferredObserver.latitude,v.inferredObserver.longitude,t.latitude,t.longitude)-2.85)<.005);
 assert.equal(AL.TOWER_SHAPES.tinkerbell.referenceView.source,"photo-inferred");
 for(const id of ["tinkerbell","cinderella"]){const r=AL.TOWER_SHAPES[id].referenceView;assert.ok(Number.isFinite(Date.parse(r.photoAt)));assert.equal(r.observer.eyeM,1.5);}
});
test("自作の城は最高点51mで、側面・背面の輪郭と塔の順が変わる",()=>{
 const TR=require("./sorami-terrain.js"),t=AL.targetById("cinderella"),ref=AL.TOWER_SHAPES.cinderella.referenceView.observer;
 assert.equal(Math.max(...AL.CASTLE_MODEL.solids.flat().map(p=>p[2])),51);
 const b=TR.bearing(t.latitude,t.longitude,ref.latitude,ref.longitude),views=[0,90,180,270].map(delta=>AL.towerOutline({...TR.destination(t.latitude,t.longitude,b+delta,3),elevation:2},t));
 const widths=views.map(o=>Math.max(...o.points.map(p=>p[0]))-Math.min(...o.points.map(p=>p[0])));
 assert.ok(widths[0]>widths[1]*1.5,JSON.stringify(widths));
 for(const o of views){assert.equal(o.approximate,true);assert.ok(o.polygons.length>30);assert.equal(o.hitPolygons,o.polygons);assert.ok(o.points.every(p=>p.every(Number.isFinite)));}
 const index=AL.CASTLE_MODEL.solids.findIndex(poly=>poly.reduce((sum,p)=>sum+p[0],0)/poly.length>5);
 const right=views[0].polygons[index].reduce((s,p)=>s+p[0],0)/views[0].polygons[index].length-views[0].azimuth;
 const back=views[2].polygons[index].reduce((s,p)=>s+p[0],0)/views[2].polygons[index].length-views[2].azimuth;
 assert.ok(right*back<0,"同じ小塔が反対側へ移る");
});
test("城の全体判定は部品の和集合を使い、塔の間の空白を埋めない",()=>{
 const obs={...AL.TOWER_SHAPES.cinderella.referenceView.observer},t=AL.targetById("cinderella"),o=AL.towerOutline(obs,t),P=AL.viewProjector(o.azimuth,(o.baseAngle+o.topAngle)/2);
 const polys=o.polygons.map(poly=>poly.map(p=>P(...p))),hull=AL.convexHull(polys.flat()),unproject=AL.viewUnprojector(o.azimuth,(o.baseAngle+o.topAngle)/2);
 const x0=Math.min(...hull.map(p=>p[0])),x1=Math.max(...hull.map(p=>p[0])),y0=Math.min(...hull.map(p=>p[1])),y1=Math.max(...hull.map(p=>p[1]));let gap=null;
 for(let i=1;i<80&&!gap;i++)for(let j=25;j<79;j++){const q=[x0+(x1-x0)*i/80,y0+(y1-y0)*j/80];if(AL.polygonDistance(q,hull)===0&&Math.min(...polys.map(p=>AL.polygonDistance(q,p)))>.001){gap=unproject(...q);break;}}
 assert.ok(gap,"凸包なら誤って当たる塔の間の空白がある");
 const hit=o.polygons[0].reduce((a,p)=>[a[0]+p[0]/o.polygons[0].length,a[1]+p[1]/o.polygons[0].length],[0,0]);
 for(const [p,expected]of [[gap,false],[hit,true]]){const c=vm.createContext({require,SoramiBodies:{state:()=>({azimuth:p[0],apparentAltitude:p[1],angularRadius:.00001,geometricAltitude:p[1]})}});vm.runInContext(readFileSync(new URL("./sorami-align.js",import.meta.url),"utf8"),c);const rows=c.SoramiAlign.dailyView(obs,t,"venus",day("03"));assert.ok(rows.length);assert.ok(rows.every(r=>r.intersects===expected));assert.ok(rows.every(r=>r.approximate));}
});
test("城の高さ変更・日付変更は立体を保ち、方位0度の境界でも輪郭が飛ばない",()=>{
 const TR=require("./sorami-terrain.js"),t=AL.targetById("cinderella"),obs={...TR.destination(t.latitude,t.longitude,180,1),elevation:3},a=AL.towerOutline(obs,t),b=AL.towerOutline(obs,t,{heightM:102});
 assert.equal(a.polygons.length,b.polygons.length);assert.ok(b.topAngle>a.topAngle*1.8);assert.ok(Math.max(...a.points.map(p=>p[0]))-Math.min(...a.points.map(p=>p[0]))<10);
 assert.deepEqual(a.points,AL.towerOutline(obs,t).points);
});

test("2023写真の推定地点から、月の横径で縮尺を固定して5塔先端に合う",()=>{
 const c=AL.CASTLE_MODEL.calibration,o=AL.towerOutline(c.observer,AL.targetById("cinderella"));
 assert.equal(c.photoAt,"2023-08-31T18:41:19+09:00");assert.equal(c.source,"user-estimated");assert.equal(c.depthMeasured,false);
 assert.equal(AL.TOWER_SHAPES.cinderella.referenceView.photoAt,"2024-08-20T19:02:04+09:00");
 const scale=744/.5565571875567298,points=o.points.map(([a,h])=>[646+(a-o.azimuth)*scale,724-(h-o.topAngle)*scale]);
 for(const q of [[646,724],[595,1084],[540,1140],[771,921],[827,949]])assert.ok(Math.min(...points.map(p=>Math.hypot(p[0]-q[0],p[1]-q[1])))<3,`photo landmark ${q}`);
 const balcony=points.filter(p=>p[1]>1030&&p[1]<1050);assert.ok(balcony.some(p=>p[0]<610));assert.ok(balcony.some(p=>p[0]>682));
});
