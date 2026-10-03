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
