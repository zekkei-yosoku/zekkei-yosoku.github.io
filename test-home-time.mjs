import test from 'node:test';import assert from 'node:assert/strict';import{execFileSync}from'node:child_process';
test('Home civil days, shared date-bar bridge and events follow viewer zones including DST',()=>{
 const script=String.raw`
 const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),T=require('./trial/sorami-home-time.js'),N=require('./trial/sorami-lunar-names.js'),A=require('./trial/sorami-astro.js');
 for(const day of ['2026-03-08','2026-11-01','2026-10-19','2030-12-31']){const at=T.parse(day);assert.equal(T.date(at),day);assert.equal(T.fromRuler(T.toRuler(at)),at);assert.equal(T.date(T.addDays(T.addDays(at,1),-1)),day);assert.equal(T.time(T.atHour(at,12)),'12:00');}
 assert.ok(Number.isNaN(T.parse('2026-02-30')));assert.ok(Number.isNaN(T.parse('bad')));
 if(process.env.TZ==='America/New_York'){assert.equal((T.addDays(T.parse('2026-03-08'),1)-T.parse('2026-03-08'))/3600000,23);assert.equal((T.addDays(T.parse('2026-11-01'),1)-T.parse('2026-11-01'))/3600000,25);}
 const html=fs.readFileSync('trial/index.html','utf8'),c={SoramiHomeTime:T,SoramiAstro:A};vm.createContext(c);vm.runInContext(html.slice(html.indexOf('function almanacEvents('),html.indexOf('function routeFromHash()')),c);
 for(const day of ['2026-03-08','2026-11-01']){const start=T.parse(day),end=T.addDays(start,1),point={latitude:40.71,longitude:-74};for(const body of ['sun','moon']){const actual=c.almanacEvents(body,start,point);for(const e of actual)assert.ok(e.at>=start&&e.at<end);if(body==='moon'){const other=A.moonCrossings(start,end,{...point,elevation:0});assert.equal(actual.length,other.length);actual.forEach((e,i)=>assert.ok(Math.abs(e.at-other[i].at)<1000));}}}
 class El{constructor(){this.style={};this.children=[];this.attrs={};this.dataset={};this.classList={add(){}};}append(...n){this.children.push(...n);}prepend(...n){this.children.unshift(...n);}replaceChildren(){this.children=[];}setAttribute(k,v){this.attrs[k]=String(v);}getAttribute(k){return this.attrs[k];}querySelector(k){return(this.nodes||={})[k]||=((new El()));}addEventListener(){}showModal(){}focus(){}close(){}}
 const button=new El(),fixed=Date.parse('2026-10-20T00:00:00Z'),FixedDate=class extends Date{constructor(...a){super(...(a.length?a:[fixed]));}static now(){return fixed;}};
 const ui={Date:FixedDate,document:{createElement:()=>new El(),body:new El()}};vm.createContext(ui);vm.runInContext(fs.readFileSync('trial/sorami-datetime-ui.js','utf8'),ui);let chosen;
 const dialog=ui.ToolDateTimeBar.calendar({button,getAt:()=>T.toRuler(fixed),getNow:()=>T.toRuler(fixed),setDay:t=>{chosen=T.fromRuler(t);}});button.onclick();dialog.querySelector('[data-today]').onclick();assert.equal(T.date(chosen),T.date(fixed));
 const grid=dialog.querySelector('[data-grid]');assert.equal(grid.children.filter(e=>e.attrs['aria-current']==='date').length,1);const today=grid.children.find(e=>e.attrs['aria-current']==='date');assert.equal(today.textContent,String(new Date(fixed).getDate()));
 if(process.env.TZ==='America/New_York'){const d=T.parse('2026-03-08');assert.equal(T.time(T.atHour(d,12)),'12:00');assert.equal(T.time(T.atHour(d,2)+30*60000),'03:30');
 global.document={createElement:()=>new El(),createElementNS:()=>new El()};global.SoramiMoonPortrait={draw:async()=>({texture:true})};El.prototype.contains=()=>true;
 const D=require('./trial/sorami-almanac-dashboard.js'),root=new El(),point={latitude:40.71,longitude:-74},all=e=>[e,...e.children.flatMap(all)];
 D.render(root,T.parse('2026-03-07'),point,()=>[],A);D.render(root,T.parse('2026-03-08'),point,()=>[],A);let day0=T.parse('2026-03-08');assert.equal(D.at(),day0+660*60000);D.setAt(day0+5000*60000);assert.equal(D.at(),day0+1379*60000);D.setAt(day0+660*60000);
 D.render(root,T.parse('2026-11-01'),point,()=>[],A);day0=T.parse('2026-11-01');assert.equal(D.at(),day0+780*60000);D.setAt(day0+5000*60000);assert.equal(D.at(),day0+1499*60000);
 }
 const full=N.calendar(2026,A).events.filter(e=>e.kind===2);assert.equal(full.length,13);const may=full.find(e=>T.date(e.at).slice(0,7)==='2026-05'&&e.tags.some(t=>t[1]==='Blue Moon'));assert.ok(may);
 const at=Date.parse('2026-09-26T16:49:00Z'),name=N.describe(at,A.moon(at,{latitude:35,longitude:139}),A);assert.equal(name.ja,'満月');assert.equal(T.date(name.event.at),T.date(at));
 console.log(JSON.stringify({zone:T.zone(),fullDay:T.date(at),time:T.time(at)}));
 `;
 for(const zone of ['Asia/Tokyo','UTC','America/New_York','Pacific/Honolulu','Pacific/Auckland']){const out=execFileSync(process.execPath,['-e',script],{cwd:new URL('.',import.meta.url),env:{...process.env,TZ:zone},encoding:'utf8'});assert.equal(JSON.parse(out).zone,zone);}
});
