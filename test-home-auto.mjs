import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import{createRequire}from'node:module';
process.env.TZ='Asia/Tokyo';const require=createRequire(import.meta.url),T=require('./sorami-home-time.js'),A=require('./sorami-astro.js');
function setup(saved){
 let now=Date.parse('2026-10-19T16:00:00+09:00'),writesFail=false;const boundary=Date.parse('2026-10-19T17:00:00+09:00'),store=new Map(saved===undefined?[]:[['sorami.homeAutoBody',saved]]),timers=new Map();let sequence=0;
 class Element{children=[];attrs={};dataset={};isConnected=true;append(...n){this.children.push(...n);}prepend(...n){this.children.unshift(...n);}replaceChildren(){this.children=[];}setAttribute(k,v){this.attrs[k]=String(v);}focus(){}contains(){return true;}querySelector(s){return all(this).find(e=>s==='.alm-range'?e.type==='range':e.dataset.body===s.match(/data-body="([^"]+)/)?.[1]);}}
 const all=e=>[e,...e.children.flatMap(all)],root=new Element(),FakeDate=class extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return now;}};
 const astro={sun:t=>({upperLimbAltitude:t<boundary?1:-1,geometricAltitude:t<boundary?1:-1,azimuth:180}),moon:()=>({upperLimbAltitude:1,geometricAltitude:1,azimuth:90,synodicAge:8,illuminatedFraction:.6,waxing:true,distanceKm:380000})};
 const context={Date:FakeDate,SoramiHomeTime:T,SoramiMoonPortrait:{draw:async()=>({texture:true})},document:{hidden:false,addEventListener(){},createElement:()=>new Element(),createElementNS:()=>new Element()},localStorage:{getItem:k=>store.get(k)??null,setItem(k,v){if(writesFail)throw Error('denied');store.set(k,v);}},setInterval:fn=>{const id=++sequence;timers.set(id,fn);return id;},clearInterval:id=>timers.delete(id)};
 vm.createContext(context);vm.runInContext(fs.readFileSync('sorami-almanac-dashboard.js','utf8'),context);const D=context.SoramiAlmanacDashboard,p={latitude:35.68,longitude:139.76};let day=T.start(now),enabled=true;
 const render=()=>D.render(root,day,p,()=>[],astro,{isActive:()=>enabled,onLiveDay:()=>{day=T.start(now);render();}});
 return{D,root,render,all,store,timers,context,enter:()=>{if(D.enter())day=T.start(now);render();},setNow:v=>now=Date.parse(v),fail:()=>writesFail=true,disable:()=>enabled=false,click:b=>all(root).find(e=>e.dataset.body===b).onclick()};
}
test('Live home follows sunset, respects manual choice and resumes automatic selection on entry',()=>{
 const f=setup();f.render();assert.equal(f.root.dataset.body,'sun');assert.equal(f.timers.size,1);
 f.setNow('2026-10-19T17:00:01+09:00');f.D.refresh();assert.equal(f.root.dataset.body,'moon');assert.equal(f.timers.size,1);
 f.click('sun');f.D.refresh();assert.equal(f.root.dataset.body,'sun');f.D.enter();f.render();assert.equal(f.root.dataset.body,'moon');
 f.D.stop();assert.equal(f.timers.size,0);f.setNow('2026-10-20T16:00:00+09:00');assert.equal(f.D.enter(),true);
 // Host synchronizes its selected day when enter reports live mode.
 f.context.document.hidden=false;
});
test('Auto setting persists, applies immediately and reports storage failures without changing preference',()=>{
 const f=setup('false');f.render();assert.equal(f.root.dataset.body,'moon');assert.equal(f.D.getAuto(),false);
 assert.equal(f.D.setAuto(true),true);assert.equal(f.root.dataset.body,'sun');assert.equal(f.store.get('sorami.homeAutoBody'),'true');
 assert.equal(f.D.setAuto(false),true);f.click('moon');f.D.enter();f.render();assert.equal(f.root.dataset.body,'moon');
 f.fail();assert.equal(f.D.setAuto(true),false);assert.equal(f.D.getAuto(),false);assert.equal(f.root.dataset.body,'moon');f.D.stop();
});
test('Exploring a time pauses live following; Today resumes it; hidden/inactive screens do no work',()=>{
 const f=setup();f.render();const range=f.all(f.root).find(e=>e.type==='range');range.value='1200';range.oninput();assert.equal(f.root.dataset.body,'moon');
 f.setNow('2026-10-19T12:00:00+09:00');f.D.refresh();assert.equal(f.root.dataset.body,'moon');f.D.today();f.render();assert.equal(f.root.dataset.body,'moon','今日を押しても見ている天体のまま（2026-10-20 ユーザー「月を見てるんだから月でしょ」）');
 f.setNow('2026-10-19T18:00:00+09:00');f.context.document.hidden=true;f.D.refresh();assert.equal(f.root.dataset.body,'moon');f.context.document.hidden=false;f.D.refresh();assert.equal(f.root.dataset.body,'moon','今日のあとは自動で切り替えない');
 f.setNow('2026-10-20T00:01:00+09:00');f.D.refresh();assert.equal(f.all(f.root).find(e=>e.type==='range').value,'1');f.disable();f.setNow('2026-10-20T01:00:00+09:00');f.D.refresh();assert.equal(f.all(f.root).find(e=>e.type==='range').value,'1');f.D.stop();
});
test('Visible upper limb defines daylight, including polar day/night and unavailable state',()=>{
 assert.equal(A.sun(Date.parse('2026-06-21T12:00:00Z'),{latitude:78,longitude:15}).upperLimbAltitude>0,true);
 const D=setup().D;assert.equal(D.preferredBody(Date.parse('2026-06-21T12:00:00Z'),{latitude:78,longitude:15},A),'sun');assert.equal(D.preferredBody(Date.parse('2026-12-21T12:00:00Z'),{latitude:78,longitude:15},A),'moon');
 assert.equal(D.preferredBody(0,{}, {sun:()=>({upperLimbAltitude:0})}),'sun');assert.equal(D.preferredBody(0,{}, {sun:()=>({upperLimbAltitude:NaN})}),null);
});

test('Reentry keeps live following across midnight and preserves an explored date',()=>{const f=setup();f.render();f.D.stop();f.setNow('2026-10-20T16:00:00+09:00');f.enter();assert.equal(f.all(f.root).find(e=>e.type==='range').value,'960');assert.equal(f.D.enter(),true); const g=setup();g.render();const range=g.all(g.root).find(e=>e.type==='range');range.value='1200';range.oninput();g.D.stop();assert.equal(g.D.enter(),false);});
