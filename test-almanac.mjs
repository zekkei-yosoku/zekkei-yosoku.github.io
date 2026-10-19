import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const html=readFileSync(new URL('./trial/index.html',import.meta.url),'utf8');
process.env.TZ='Asia/Tokyo';
const c={};vm.createContext(c);
vm.runInContext(readFileSync(new URL('./trial/sorami-home-time.js',import.meta.url),'utf8'),c);
vm.runInContext(readFileSync(new URL('./sorami-astro.js',import.meta.url),'utf8'),c);
vm.runInContext(html.slice(html.indexOf('function almanacEvents('),html.indexOf('function routeFromHash()')),c);
const day=Date.parse('2026-10-19T00:00:00+09:00'),point={name:'東京',latitude:35.68,longitude:139.76};
for(const body of ['sun','moon']){
  const events=c.almanacEvents(body,day,point);assert.equal(events.length,2);
  for(const e of events){assert.ok(e.at>=day&&e.at<day+86400000);assert.ok(e.azimuth>=0&&e.azimuth<360);assert.ok(Math.abs(c.SoramiAstro[body](e.at,{...point,elevation:0}).upperLimbAltitude)<.001);}
}
const moon=c.almanacEvents('moon',day,point),existing=c.SoramiAstro.moonCrossings(day,day+86400000,{...point,elevation:0});
assert.equal(moon.length,existing.length);moon.forEach((e,i)=>assert.ok(Math.abs(e.at-existing[i].at)<1000));
assert.equal(c.almanacEvents('sun',Date.parse('2026-06-21T00:00:00+09:00'),{latitude:78,longitude:15}).length,0);
assert.equal(c.almanacEvents('moon',day+86400000,point).filter(e=>e.kind==='set').length,0);
assert.throws(()=>c.almanacEvents('sun',day,{latitude:NaN,longitude:0}));
class Element{
  children=[];textContent='';append(...nodes){this.children.push(...nodes);}replaceChildren(){this.children=[];}setAttribute(){}style={};
}
const elements=new Map(),get=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
Object.assign(c,{$:get,place:point,almanacPoint:null,almanacDay:day,document:{createElement:()=>new Element()},openPlaceSheet:()=>{}});
c.renderAlmanac();assert.equal(get('almanacOutput').children.length,2);
get('almanacNext').onclick();assert.equal(get('almanacDate').value,'2026-10-20');
const text=e=>e.textContent+' '+e.children.map(n=>text(n)).join(' ');
assert.match(text(get('almanacOutput')),/この日はありません/);
c.SoramiAstro.sun=()=>{throw Error('Unavailable');};c.renderAlmanac();assert.match(text(get('almanacOutput')),/時刻を計算できません/);assert.match(text(get('almanacOutput')),/再計算/);
get('almanacDate').value='invalid';get('almanacDate').onchange();assert.equal(get('almanacDate').value,'2026-10-20');
console.log('ALMANAC OK: events, existing moon parity, missing events, polar day, invalid coordinates/date, date navigation and failure output');

const dashboardContext={};vm.createContext(dashboardContext);vm.runInContext(readFileSync(new URL('./trial/sorami-home-time.js',import.meta.url),'utf8'),dashboardContext);vm.runInContext(readFileSync(new URL('./trial/sorami-almanac-dashboard.js',import.meta.url),'utf8'),dashboardContext);
const clean={};vm.createContext(clean);vm.runInContext(readFileSync(new URL('./sorami-astro.js',import.meta.url),'utf8'),clean);c.SoramiAstro.sun=clean.SoramiAstro.sun;const d=dashboardContext.SoramiAlmanacDashboard.data(day,point,(...args)=>c.almanacEvents(...args),clean.SoramiAstro);
assert.equal(d.bodies.sun.points.length,97);assert.ok(d.daylight>10*3600000&&d.daylight<12*3600000);assert.ok(d.bodies.moon.noon.illuminatedFraction>=0&&d.bodies.moon.noon.illuminatedFraction<=1);console.log('DASHBOARD DATA OK');
