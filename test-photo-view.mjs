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
 let rendered;const c=vm.createContext({aim,$:()=>host,S,SoramiAlign:AL,aimFromPoint:()=>({...observer,name:"試験地点"}),aimElevation:async()=>83,aimLookRender:(h,s)=>{h.hidden=false;rendered=s},aimIsMountain:t=>!!t.rim,aimCalSolid:e=>e.intersects??Math.abs(e.gap)<=1.2*e.radius,aimDateLabel:()=>"日付",aimSideName:()=>"月の出",aimPassage:()=>"通過",moonGlyphAt:()=>"月",lightTimingText:()=>"夜",Math,Date,Number});
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
 const c=vm.createContext({aim,S,Date,Promise,setTimeout:(f)=>{waits++;if(waits===2)aim.fromSeq=2;f()},SoramiAlign:{dailyView:()=>{calls++;return []}}});
 vm.runInContext(html.slice(a,b)+";this.run=aimBuildingDays",c);
 const rows=await c.run(observer,target,"moon","tip",1);assert.equal(rows.length,0);assert.equal(calls,8);assert.equal(waits,2);
});


test("自動表示は旧200mmを移行せず、手動指定だけ保持する",()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8"),a=html.indexOf("const AIM_SENSOR ="),b=html.indexOf("const aimLookHosts",a);
 for(const [saved,mode] of [[{},"auto"],[{on:true,focal:200},"auto"],[{mode:"manual",on:true,focal:700},"manual"]]) {
  const c=vm.createContext({localStorage:{getItem:()=>JSON.stringify(saved)}});vm.runInContext(html.slice(a,b)+";this.lens=aimLens",c);
  assert.equal(c.lens.mode,mode);assert.equal(c.lens.on,true);if(mode==="manual")assert.equal(c.lens.focal,700);
 }
});
test("自動表示の相当焦点距離を反映しても図の縮尺が変わらない",()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8"),a=html.indexOf("  const sensor = AIM_SENSOR[aimLens.sensor]"),b=html.indexOf("  const proj =",a);
 for(const sensor of ["full","aps","canon","m43"])for(const portrait of [false,true])for(const [W,H] of [[316,284],[610,440]]) {
  const base=AL.viewWindow({azimuth:70,baseAngle:.1,topAngle:1.3,radiusDeg:.27,aspect:W/H}),info={textContent:""},button={setAttribute:()=>{}},lensFocal={};
  const aimLens={sensor,portrait,mode:"auto",on:true};const c=vm.createContext({AIM_SENSOR:{full:[36,24],aps:[23.5,15.6],canon:[22.3,14.9],m43:[17.3,13]},aimLens,win:{...base},W,H,lensFocal,Math,SoramiAlign:AL,host:{querySelector:q=>q.includes("auto")?button:info}});
  vm.runInContext(html.slice(a,b),c);assert.equal(c.win.halfH,base.halfH);assert.match(info.textContent,/見やすい表示：約/);
  aimLens.mode="manual";aimLens.focal=+lensFocal.value;c.win={...base};vm.runInContext("{ "+html.slice(a,b)+" }",c);
  assert.ok(Math.abs(c.win.halfH/base.halfH-1)<.0002);assert.equal(c.win.alt0,base.alt0);
 }
});
test("枠の移動・中央復帰は時刻と天体逆引きを変えない",()=>{
 const html=readFileSync(new URL("./index.html",import.meta.url),"utf8"),a=html.indexOf('  const move = host.querySelector("[data-lens-move]")'),b=html.indexOf('  draw(i0);',a);
 let draws=0,prevented=0,clears=0;const move={setAttribute:()=>{}},center={},hint={},host={_lensMoving:true,_pick:null,querySelector:q=>q.includes("hint")?hint:q.includes("center")?center:move};
 const cv={style:{},setPointerCapture:()=>{}},cur=43,W=316,H=284,k=10,frame={halfW:5,halfH:6};
 const c=vm.createContext({host,cv,cur,W,H,k,frame,Math,draw:()=>draws++,aimLookRender:()=>{},aimReverseClear:()=>clears++,spec:{}});vm.runInContext(html.slice(a,b),c);
 cv.onpointerdown({clientX:100,clientY:100,pointerId:1});cv.onpointermove({clientX:150,clientY:120});cv.onpointerup();
 assert.ok(host._lensOffset[0]>0);assert.ok(host._lensOffset[1]>0);assert.equal(c.cur,43);assert.equal(host._pick,null);
 cv.onkeydown({key:"ArrowLeft",preventDefault:()=>prevented++});assert.equal(prevented,1);center.onclick();assert.deepEqual(Array.from(host._lensOffset),[0,0]);assert.ok(draws>=3);host._pick={result:{}};move.onclick();assert.equal(host._pick,null);assert.equal(clears,1);
});
