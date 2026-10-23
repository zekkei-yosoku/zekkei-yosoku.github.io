import{execFileSync}from'node:child_process';import test from 'node:test';import assert from 'node:assert/strict';import{createRequire}from'node:module';import fs from'node:fs';import vm from'node:vm';import{createHash}from'node:crypto';
const require=createRequire(import.meta.url),portrait=require('./trial/astronotes-moon-portrait.js'),A=require('./astronotes-astro.js'),engine=require('./vendor/astronomy-engine-2.1.19.min.js');
test('Illuminated projected area matches fraction at all orientations',()=>{
 const size=220;for(const f of [0,.02,.1,.25,.5,.7,.9,.98,1])for(const a of [0,45,90,180,270]){let area=0,lit=0;for(let y=0;y<size;y++)for(let x=0;x<size;x++){const dot=portrait.incidence(2*(x+.5)/size-1,2*(y+.5)/size-1,f,a);if(dot===null)continue;area++;if(dot>0)lit++;}assert.ok(Math.abs(lit/area-f)<.004,`f=${f} angle=${a} got=${lit/area}`);}
});
test('Light direction agrees with independent local-horizon vector projection',()=>{
 const o={latitude:35.68,longitude:139.76,elevation:0},rad=Math.PI/180;
 for(const iso of ['2026-10-19T09:00:00Z','2026-10-04T21:00:00Z','2026-10-26T12:00:00Z']){
  const at=Date.parse(iso),m=A.moon(at,o),s=A.sun(at,o),az=m.azimuth*rad,alt=m.geometricAltitude*rad,sa=s.azimuth*rad,sh=s.geometricAltitude*rad;
  const right=Math.cos(sh)*Math.sin(sa-az),up=Math.sin(sh)*Math.cos(alt)-Math.cos(sh)*Math.sin(alt)*Math.cos(sa-az),length=Math.hypot(right,up),v=portrait.lightVector(m.illuminatedFraction,m.brightLimbZenithAngle),len=Math.hypot(v.x,v.y);
  assert.ok(Math.abs(v.x/len-right/length)<.015);assert.ok(Math.abs(v.y/len+up/length)<.015);
 }
});
test('Moon fractions agree with independent Astronomy Engine to 0.6 percentage point',()=>{
 const o={latitude:35.68,longitude:139.76,elevation:0};for(let day=1;day<=31;day++){const at=Date.UTC(2026,9,day,9),a=A.moon(at,o).illuminatedFraction,b=engine.Illumination('Moon',new Date(at)).phase_fraction;assert.ok(Math.abs(a-b)<.006);}
 const photo=engine.Illumination('Moon',new Date('2024-10-17T18:16:38+09:00')).phase_fraction;assert.ok(photo>.999&&photo<1);
});
test('New, quarter and full Moon raster retain transparent exterior and continuous shadow',()=>{
 // 2026-10-19: the night side is a faint earthshine (opaque, ~11% of the surface), not pure black.
 const size=64,base=new Uint8ClampedArray(size*size*4).fill(255);const dark=portrait.shade(base,size,0,90),full=portrait.shade(base,size,1,90),quarter=portrait.shade(base,size,.5,270),left=(32*size+16)*4,right=(32*size+48)*4;
 assert.ok(dark[left]>15&&dark[left]<45&&dark[left+3]>250);assert.ok(full[left]>245);assert.ok(quarter[left]>15&&quarter[left]<45&&quarter[left+3]>250);assert.ok(quarter[right]>100);assert.equal(full[3],0);assert.ok(full[(32*size+32)*4+3]>250);assert.throws(()=>portrait.lightVector(NaN,0));
});
test('Texture failure falls back to computed phase without throwing',async()=>{
 const sandbox={Uint8ClampedArray,setTimeout,clearTimeout,Image:class{set src(v){queueMicrotask(()=>this.onerror());}},document:{createElement:()=>({width:0,height:0,getContext:()=>({save(){},translate(){},rotate(){},fillStyle:'',beginPath(){},arc(){},fill(){},restore(){},getImageData:()=>({data:new Uint8ClampedArray(512*512*4).fill(255)})})})}};vm.createContext(sandbox);vm.runInContext(fs.readFileSync(new URL('./trial/astronotes-moon-portrait.js',import.meta.url),'utf8'),sandbox);let painted=false;const canvas={isConnected:true,setAttribute(){},getContext:()=>({putImageData(){painted=true;}})};const result=await sandbox.AstroNotesMoonPortrait.draw(canvas,{illuminatedFraction:.5,brightLimbZenithAngle:270,parallacticAngle:0});assert.equal(result.texture,false);assert.equal(painted,true);
});
test('Trial CSP, local assets, switch and home startup contract',()=>{
 const html=fs.readFileSync(new URL('./trial/index.html',import.meta.url),'utf8');for(const[,attrs,body]of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)){if(/\bsrc\s*=/.test(attrs)||!body.trim())continue;assert.ok(html.includes(`'sha256-${createHash('sha256').update(body).digest('base64')}'`));new vm.Script(body);}
 assert.match(html,/\['home','ホーム'\]/);assert.match(html,/if\(preferred==='home'\)/);assert.match(html,/homeLink"\)\.onclick[^\n]*pushRoute\("#\/almanac"\)/);assert.match(html,/ToolDateTimeBar\.calendar/);const png=fs.readFileSync(new URL('./trial/almanac-moon-surface-v1.png',import.meta.url));assert.equal(png.readUInt32BE(16),png.readUInt32BE(20));assert.ok(png.readUInt32BE(16)>=512);assert.equal(png[25],6);assert.ok(png.length<4*1024*1024);assert.ok(execFileSync('git',['ls-files','--cached','trial/almanac-moon-surface-v1.png'],{encoding:'utf8'}).trim(),'moon surface is tracked for release');
});
test('Forecast failure notices stay off the independent home',()=>{
 const h=fs.readFileSync(new URL('./trial/index.html',import.meta.url),'utf8');assert.match(h,/main:has\([^\n]*#almanacView[^\n]*#status,#predictionDataNotice\)\{display:none\}/);
});
test('Actual trial startup branch respects explicit routes and stored choices',async()=>{
 const h=fs.readFileSync(new URL('./trial/index.html',import.meta.url),'utf8'),script=h.match(/<script id="startupPreference">([\s\S]*?)<\/script>/)[1];
 const definitions=script.slice(script.indexOf(' const key='),script.indexOf(' const row='));
 const start=script.slice(script.indexOf(' const openStartup ='),script.indexOf(" document.addEventListener('visibilitychange'"));
 for(const [preference,hash,allowed,expected] of [[null,'',false,'#/almanac'],['forecast','',false,''],['home','#/records',false,'#/records'],['map','',true,'#/skymap'],['map','',false,'#/almanac'],['framing','',true,'#/aim/tower']]){
  const location={hash,search:''},status={},c={location,localStorage:{getItem:()=>preference},screenAllowed:()=>allowed,history:{state:null,replaceState(_state,_unused,url){location.hash=url;}},applyRoute(){},$:()=>status,update(){},startupSessionReady:Promise.resolve()};vm.createContext(c);vm.runInContext(`const initialHash=location.hash,initialSearch=location.search;let startupInteracted=false;${definitions}${start};globalThis.run=openStartup;`,c);await c.run();assert.equal(location.hash,expected,`preference=${preference}, hash=${hash}, allowed=${allowed}`);
 }
});
