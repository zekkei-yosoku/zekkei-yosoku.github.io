import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const require=createRequire(import.meta.url),B=require('./sorami-bodies.js'),A=require('./sorami-astro.js'),L=require('./sorami-align.js');
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const spherical=(a,b)=>{
 const vector=p=>{const z=p.azimuth*Math.PI/180,h=p.altitude*Math.PI/180;return [Math.cos(h)*Math.sin(z),Math.cos(h)*Math.cos(z),Math.sin(h)]};
 const x=vector(a),y=vector(b),cross=[x[1]*y[2]-x[2]*y[1],x[2]*y[0]-x[0]*y[2],x[0]*y[1]-x[1]*y[0]];
 return Math.atan2(Math.hypot(...cross),x.reduce((sum,v,i)=>sum+v*y[i],0))*180/Math.PI*3600;
};
const obs={latitude:35.68,longitude:139.77,elevation:10},at=Date.parse('2026-10-03T18:00Z');
test('UIとproviderの天体は8種類一致・旧2天体は値を変えない',()=>{
 const select=html.match(/<select id="aimBody"[\s\S]*?<\/select>/)[0];const ids=[...select.matchAll(/option value="([^"]+)"/g)].map(x=>x[1]);
 assert.deepEqual(ids,B.definitions.map(x=>x.id));assert.equal(ids.length,8);
 assert.deepEqual(B.state('sun',at,obs),A.sun(at,obs));assert.deepEqual(B.state('moon',at,obs),A.moon(at,obs));
 assert.throws(()=>B.state('unknown',at,obs),/未知/);
});
test('独立暦1614条件との空気差なし位置差が1分角以内',()=>{
 const data=JSON.parse(readFileSync(new URL('./data/celestial-reference.json',import.meta.url)));
 assert.equal(data.samples.length,1614);
 for(const f of data.samples){const s=B.state(f.body,Date.parse(f.utc),f.observer);const d=((s.azimuth-f.azimuth+540)%360)-180;const error=spherical(s,f);
  assert.ok(error<60,`${f.body} ${f.utc}: ${error}arcsec`);
  assert.ok(Math.abs(s.apparentAltitude-s.altitude-A.refraction(s.altitude))<1e-10);
 }
});
test('Sirius物理半径は0・惑星は距離に基づく半径・固有運動は進行する',()=>{
 assert.equal(B.state('sirius',at,obs).angularRadius,0);
 for(const id of ['mercury','venus','mars','jupiter','saturn']){const s=B.state(id,at,obs);assert.ok(s.angularRadius>0&&s.angularRadius<.05);}
 const c0=B.siriusCatalog(Date.UTC(2000,0,1,12)),c1=B.siriusCatalog(Date.UTC(2030,0,1,12));
 assert.ok(c1.ra<c0.ra&&c1.dec<c0.dec);
 assert.equal(L.rankOf(1e-7,0),'center');assert.equal(L.rankOf(.001,0),null);
});
test('全8天体で有限の日内経路・画角時刻・候補日を生成する',()=>{
 const target=L.targetById('skytree'),day=Date.parse('2026-10-03T00:00:00+09:00');
 for(const d of B.definitions){const rows=L.dailyView(obs,target,d.id,day);assert.ok(rows.length>=1);assert.ok(rows.every(e=>e.at>=day&&e.at<day+86400000&&Number.isFinite(e.altitude)));
  const st=B.state(d.id,rows[0].at,obs),proj=L.viewProjector(st.azimuth,st.apparentAltitude);
  const path=L.frameDayPath(d.id,obs,day,proj,{stepS:60});assert.equal(path.length,1441);assert.ok(path.every(p=>Number.isFinite(p.radius)));
  const passes=L.framePassages(path,{halfW:1,halfH:1});assert.ok(Array.isArray(passes));
 }
});
test('新天体の昼夜は太陽を参照し、地平線下/近接/実重なりを分ける',()=>{
 const target=L.targetById('skytree'),day=Date.parse('2026-10-03T00:00:00+09:00');
 for(const d of B.definitions.filter(x=>!x.limbs)){const rows=L.dailyView(obs,target,d.id,day);assert.ok(rows.every(e=>Number.isFinite(e.sunAltitude)));assert.ok(rows.every(e=>!e.intersects||e.nearTarget));}
 assert.equal(B.sky(-19),'夜');assert.equal(B.sky(-18),'薄明');assert.equal(B.sky(0),'日中');
});
test('新天体ライブラリは遅延読込し、失敗後の再試行ができる',async()=>{
 const scripts=[],source=readFileSync(new URL('./sorami-bodies.js',import.meta.url),'utf8');
 const c={SoramiAstro:A,Promise,Map,Math,Date,Number,Object,Error,document:{createElement:()=>({remove(){}}),head:{append:s=>scripts.push(s)}}};c.window=c;vm.runInNewContext(source,c);
 await c.SoramiBodies.ensure('moon');assert.equal(scripts.length,0);
 const a=c.SoramiBodies.ensure('sirius'),b=c.SoramiBodies.ensure('venus');assert.equal(a,b);assert.equal(scripts.length,1);
 scripts[0].onerror();await assert.rejects(a,/読み込めません/);assert.throws(()=>c.SoramiBodies.state('sirius',at,obs),/読み込めません/);
 const retry=c.SoramiBodies.ensure('sirius');assert.equal(scripts.length,2);c.Astronomy=require('./vendor/astronomy-engine-2.1.19.min.js');scripts[1].onload();await retry;assert.ok(Number.isFinite(c.SoramiBodies.state('sirius',at,obs).azimuth));
});
test('シリウスの点が建物内部を通る日は物理半径0でも重なる',()=>{
 const TR=require('./sorami-terrain.js'),eye={...obs,elevation:11.5},day=Date.parse('2026-10-03T00:00:00+09:00');
 let chosen;for(let t=day;t<day+86400000;t+=600000){const s=B.state('sirius',t,eye);if(s.apparentAltitude>10&&s.apparentAltitude<20){chosen={t,s};break;}}
 assert.ok(chosen);const loc=TR.destination(obs.latitude,obs.longitude,chosen.s.azimuth,.5);
 const height=Math.tan((chosen.s.apparentAltitude+3)*Math.PI/180)*500+11.5;
 const target={id:'test',name:'test',...loc,groundM:0,parts:[{id:'tip',m:height}]};
 const rows=L.dailyView(obs,target,'sirius',day);assert.ok(rows.some(e=>e.intersects));assert.ok(rows.some(e=>e.radius===0&&e.nearTarget));
});
test('シリウス・小惑星半径でも山の自動表示範囲は旧縮尺のまま有限',()=>{
 for(const radius of [0,.001,.004]){const top=3,base=top-5*Math.max(radius,.27),win=L.viewWindow({azimuth:240,baseAngle:base,topAngle:top,radiusDeg:radius,aspect:1.5});const focal=Math.max(24/(2*win.halfH*Math.PI/180),36/(2*win.halfW*Math.PI/180))*1.12;assert.ok(focal>8&&focal<2000);assert.ok(L.cameraFrame(focal));}
});
test('天体変更の遅い返答は最新選択を上書きせず、合わせ方を天体ごとに保持する',async()=>{
 const start=html.indexOf('    $("aimBody").onchange = async () => {'),end=html.indexOf('    $("aimHeightSet").onclick',start);assert.ok(start>0&&end>start);
 const waits={},els={aimBody:{value:'sirius'},aimLineInfo:{},aimLimb:{innerHTML:'old'}};
 const aim={body:'moon',bodySeq:0,limb:'behind',limbsByBody:{sun:'onTop'}};
 const c={aim,$:id=>els[id],SoramiBodies:{ensure:id=>new Promise((resolve,reject)=>waits[id]={resolve,reject})},aimLimbValue:()=>aim.limb,aimApply(){c.applied=aim.body}};
 vm.runInNewContext(html.slice(start,end),c);const first=els.aimBody.onchange();els.aimBody.value='sun';const second=els.aimBody.onchange();waits.sun.resolve();await second;waits.sirius.resolve();await first;
 assert.equal(aim.body,'sun');assert.equal(aim.limb,'onTop');assert.equal(aim.limbsByBody.moon,'behind');assert.equal(c.applied,'sun');
 els.aimBody.value='venus';const failure=els.aimBody.onchange();waits.venus.reject(Error('network'));await failure;assert.equal(aim.body,'sun');assert.equal(els.aimBody.value,'sun');assert.match(els.aimLineInfo.textContent,/再試行/);
});
test('初回読込中の太陽選択と明示URLは旧入口の完了で上書きされない',async()=>{
 const start=html.indexOf('function openAim(preset) {'),end=html.indexOf('/// 地図を開く中心と倍率',start),code=html.slice(start,end);
 function setup(){
  let done;const pending=new Promise(r=>done=r),els=new Map();
  const $=id=>{if(!els.has(id))els.set(id,{value:id==='aimTarget'?'skytree':'',innerHTML:'',textContent:''});return els.get(id)};
  const aim={body:'sirius',bodySeq:0,limb:'center',limbsByBody:{},target:null};
  const c={aim,$,AIM_PRESETS:{tower:{body:null,target:null},diamond:{body:'sun',target:'fuji'}},SoramiBodies:{definition:B.definition,ready:()=>false,ensure:id=>id==='sun'?Promise.resolve():pending},SoramiAlign:{targetById:()=>({id:'fuji',parts:[{id:'summit',m:3776}]})},aimFillSelects(){},aimFillParts(){},aimLimbValue:()=>aim.limb,store:{get:()=> 'skytree'},Date,Number,requestAnimationFrame(){},aimApply(){c.applied=aim.body},aimRedrawLine(){},aimRenderList(){},aimRenderFrom(){}};
  vm.runInNewContext('let aimReady=false;'+code+';this.open=openAim;',c);return {c,$,aim,done};
 }
 let f=setup();f.c.open('tower');assert.equal(typeof f.$('aimBody').onchange,'function');assert.ok(f.$('aimDate').value);assert.equal(f.$('aimTarget').value,'skytree');
 f.$('aimBody').value='sun';await f.$('aimBody').onchange();f.done();await Promise.resolve();await Promise.resolve();assert.equal(f.aim.body,'sun');assert.equal(f.c.applied,'sun');
 f=setup();f.c.open('tower');f.c.open('diamond');f.done();await Promise.resolve();await Promise.resolve();assert.equal(f.aim.body,'sun');assert.equal(f.$('aimTarget').value,'fuji');
});

test('固有運動をAstropyの空間運動とJ2000/2026/2036で独立照合',()=>{
 const data=JSON.parse(readFileSync(new URL('./data/celestial-reference.json',import.meta.url)));
 for(const f of data.spaceMotion){const c=B.siriusCatalog(Date.parse(f.utc));assert.ok(spherical({azimuth:c.ra*15,altitude:c.dec},{azimuth:f.ra*15,altitude:f.dec})<.1);assert.ok(Math.abs(c.distanceLightYears-f.distanceLightYears)<1e-6);}
});
