import test from "node:test";
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFileSync} from "node:fs";
import vm from "node:vm";
const require=createRequire(import.meta.url),AL=require("./sorami-align.js"),S=require("./sorami-core.js");
const observer={latitude:35.58386,longitude:139.56853,elevation:83},target=AL.targetById("skytree");
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
 let rendered;const c=vm.createContext({SoramiBodies:globalThis.SoramiBodies,aim,$:()=>host,S,SoramiAlign:AL,aimFromPoint:()=>({...observer,name:"試験地点"}),aimElevation:async()=>83,aimLookRender:(h,s)=>{h.hidden=false;rendered=s},aimIsMountain:t=>!!t.rim,aimCalSolid:e=>e.intersects??Math.abs(e.gap)<=1.2*e.radius,aimDateLabel:()=>"日付",aimSideName:()=>"月の出",aimPassage:()=>"通過",moonGlyphAt:()=>"月",lightTimingText:()=>"夜",Math,Date,Number});
 vm.runInContext(html.slice(a,b)+";this.update=aimUpdateLook",c);
 for(const d of ["03","02","04"]){aim.dayMs=day(d);await c.update();assert.equal(host.hidden,false);assert.ok(rendered);assert.equal(rendered.obs.latitude,observer.latitude);assert.ok(rendered.at>=day(d)&&rendered.at<day(d)+86400000);assert.equal(rendered.atName,d==="03"?undefined:"最接近");}
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
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8"),a=html.indexOf("async function aimBuildingDays"),b=html.indexOf("async function aimRenderFrom",a);
 const aim={fromSeq:1};let calls=0,waits=0;
 const c=vm.createContext({SoramiBodies:globalThis.SoramiBodies,aim,S,Date,Promise,setTimeout:(f)=>{waits++;if(waits===2)aim.fromSeq=2;f()},SoramiAlign:{dailyView:()=>{calls++;return []}}});
 vm.runInContext(html.slice(a,b)+";this.run=aimBuildingDays",c);
 const rows=await c.run(observer,target,"moon","tip",1);assert.equal(rows.length,0);assert.equal(calls,8);assert.equal(waits,2);
});


test("自動表示は旧200mmを移行せず、手動指定だけ保持する",()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8"),a=html.indexOf("const AIM_SENSOR ="),b=html.indexOf("const aimLookHosts",a);
 for(const [saved,mode] of [[{},"auto"],[{on:true,focal:200},"auto"],[{mode:"manual",on:true,focal:700},"manual"]]) {
  const c=vm.createContext({SoramiBodies:globalThis.SoramiBodies,localStorage:{getItem:()=>JSON.stringify(saved)}});vm.runInContext(html.slice(a,b)+";this.lens=aimLens",c);
  assert.equal(c.lens.mode,mode);assert.equal(c.lens.on,true);if(mode==="manual")assert.equal(c.lens.focal,700);
 }
});
test("自動表示の相当焦点距離を反映しても図の縮尺が変わらない",()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8"),a=html.indexOf("  const sensor = AIM_SENSOR[aimLens.sensor]"),b=html.indexOf("  const proj =",a);
 for(const sensor of ["full","aps","canon","m43"])for(const portrait of [false,true])for(const [W,H] of [[316,284],[610,440]]) {
  const base=AL.viewWindow({azimuth:70,baseAngle:.1,topAngle:1.3,radiusDeg:.27,aspect:W/H}),info={textContent:""},button={setAttribute:()=>{}},lensFocal={};
  const aimLens={sensor,portrait,mode:"auto",on:true};const c=vm.createContext({SoramiBodies:globalThis.SoramiBodies,AIM_SENSOR:{full:[36,24],aps:[23.5,15.6],canon:[22.3,14.9],m43:[17.3,13]},aimLens,win:{...base},W,H,lensFocal,Math,SoramiAlign:AL,host:{querySelector:q=>q.includes("auto")?button:info}});
  vm.runInContext(html.slice(a,b),c);assert.equal(c.win.halfH,base.halfH);assert.match(info.textContent,/見やすい表示：約/);
  aimLens.mode="manual";aimLens.focal=+lensFocal.value;c.win={...base};vm.runInContext("{ "+html.slice(a,b)+" }",c);
  assert.ok(Math.abs(c.win.halfH/base.halfH-1)<.0002);assert.equal(c.win.alt0,base.alt0);
 }
});
test("構図の移動・復帰は時刻と天体逆引きを変えない",()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8"),a=html.indexOf('  const move = host.querySelector("[data-lens-move]")'),b=html.indexOf('  draw(i0);',a);
 let draws=0,prevented=0,clears=0;const move={setAttribute:()=>{}},center={},hint={},host={_lensMoving:true,_pick:null,querySelector:q=>q.includes("hint")?hint:q.includes("center")?center:move};
 const cv={style:{},setPointerCapture:()=>{}},cur=43,W=316,H=284,k=10,frame={halfW:5,halfH:6};
 const c=vm.createContext({SoramiBodies:globalThis.SoramiBodies,panLimit:1,host,cv,cur,W,H,k,frame,hiddenY:null,baseY:220,mountain:false,navigator:{vibrate:()=>{}},Math,draw:()=>draws++,aimLookRender:()=>{},aimReverseClear:()=>clears++,spec:{}});vm.runInContext(html.slice(a,b),c);
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
 center.onclick();host._pick={result:{}};move.onclick();assert.equal(host._pick,null);assert.equal(clears,1);
});


test("図を移動しても画角枠は中央、道のタップは移動分を引いて時刻を選ぶ",()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8"),a=html.indexOf("  cv.onclick = (ev) => {",html.indexOf("async function aimLookRender")),b=html.indexOf("  aimLookPick(host",a);
 const cv={getBoundingClientRect:()=>({left:10,top:20})},host={_lensOffset:[.2,.1]},range={};let drawn=-1;
 const c=vm.createContext({SoramiBodies:globalThis.SoramiBodies,cv,host,range,W:300,H:270,path:[{x:5,y:6},{x:10,y:20}],toPx:xy=>xy,Math,draw:i=>drawn=i});
 vm.runInContext(html.slice(a,b),c);cv.onclick({clientX:10+60+10,clientY:20+27+20});assert.equal(drawn,1);assert.equal(range.value,"1");
 const f=html.slice(html.indexOf("    if (frame) {",html.indexOf("const draw = (v)")),html.indexOf('    const outside = host.querySelector'));
 assert.match(f,/const fx = \(W - fw\) \/ 2, fy = \(H - fh\) \/ 2/);assert.doesNotMatch(f,/_lensOffset/);
 assert.match(html,/ctx\.save\(\); ctx\.translate\(panX, panY\)/);assert.match(html,/const px = screenX - panX, py = screenY - panY/);
});


test("稜線の地形範囲は画角・構図移動で粗くならない",async()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8");
 const ridge=html.slice(html.indexOf("const aimRidgeCache"),html.indexOf("const AIM_SENSOR"));
 let calls=0;
 const c=vm.createContext({SoramiTerrain:{distanceKm:()=>100,bearing:()=>180,destination:(lat,lng,az,d)=>({latitude:lat,longitude:lng}),elevations:async pts=>{calls++;return pts.map(()=>1000)}},SoramiAlign:{rimOutline:()=>null},SoramiAstro:{targetElevationAngle:()=>2}});
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
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8"),a=html.indexOf('  const move = host.querySelector("[data-lens-move]")'),b=html.indexOf('  draw(i0);',a),code="{ "+html.slice(a,b)+" }";
 let queued=null,renders=0,saved=0,draws=0;
 const controls={move:{setAttribute:()=>{}},center:{},hint:{}};
 const host={_lensMoving:true,_pick:null,_lensOffset:[.1,.1],querySelector:q=>q.includes("hint")?controls.hint:q.includes("center")?controls.center:controls.move};
 const cv={style:{},setPointerCapture:()=>{},getBoundingClientRect:()=>({left:0,top:0})};
 const R=Math.PI/180,H=300,W=300,halfH=24/(2*200*R)*1.12,aimLens={mode:"manual",focal:200,on:true};
 const c=vm.createContext({SoramiBodies:globalThis.SoramiBodies,panLimit:1,host,cv,cur:43,W,H,k:H/2/halfH,frame:{halfH:24/(400*R)},win:{halfH},focal:200,sh:24,sw:36,hiddenY:null,baseY:250,mountain:false,navigator:{},Math,Map,aimLens,localStorage:{setItem:()=>saved++},spec:{},draw:()=>draws++,aimReverseClear:()=>{},requestAnimationFrame:fn=>{queued=fn;return 1;},cancelAnimationFrame:()=>{queued=null;},aimLookRender:()=>{renders++;c.focal=aimLens.focal;c.win={halfH:Math.max(24/(2*c.focal*R),36/(2*c.focal*R))*1.12};vm.runInContext(code,c);}});
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
