// ホームの金星: 輝面・見かけの大きさ・明けの明星と宵の明星の判定・出入りの時刻を天文計算の値と合わせる
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {readFileSync} from 'node:fs';import vm from 'node:vm';
const require=createRequire(import.meta.url);process.env.TZ='Asia/Tokyo';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
function load(){
 const c={console,Date,Math,Number,Promise,globalThis:null};c.globalThis=c;vm.createContext(c);
 c.AstroNotesBodies=require('./astronotes-bodies.js');
 vm.runInContext(readFileSync(new URL('./astronotes-home-time.js',import.meta.url),'utf8'),c);
 vm.runInContext(readFileSync(new URL('./astronotes-astro.js',import.meta.url),'utf8'),c);
 vm.runInContext(readFileSync(new URL('./astronotes-almanac-dashboard.js',import.meta.url),'utf8'),c);
 vm.runInContext(html.slice(html.indexOf('function almanacEvents('),html.indexOf("if(typeof document!=='undefined')document.addEventListener('visibilitychange'")),c);
 return c;
}
const site={latitude:35.68,longitude:139.76,elevation:0};
test('金星の輝面と大きさと時期',()=>{
 const c=load(),D=c.AstroNotesAlmanacDashboard,s=D.venusState(Date.UTC(2026,10,2,8),site,c.AstroNotesAstro);
 assert.ok(Math.abs(s.illuminatedFraction-.0326)<.001,String(s.illuminatedFraction));
 assert.ok(s.diameterArcsec>55&&s.diameterArcsec<62,String(s.diameterArcsec));
 assert.ok(s.magnitude<-4&&s.magnitude>-5,String(s.magnitude));
 assert.equal(D.venusSeason(s).ja,'明けの明星');
 assert.equal(D.venusSeason({...s,visibility:'evening'}).ja,'宵の明星');
 assert.equal(D.venusSeason({...s,elongation:5}).ja,'太陽の近く');
});
test('金星のタブは試用版だけに出す',()=>{
 const c=load(),D=c.AstroNotesAlmanacDashboard,ids=()=>Array.from(D.bodyTabs(),t=>t[0]).join();
 assert.equal(ids(),'sun,moon');
 for(const pathname of ['/','/index.html']){c.location={pathname};assert.equal(ids(),'sun,moon');}
 for(const pathname of ['/trial/','/trial/index.html']){c.location={pathname};assert.equal(ids(),'sun,moon,venus');}
});
test('金星の出入りはその日の範囲で返す',()=>{
 const c=load(),day=Date.parse('2026-11-02T00:00:00+09:00'),events=c.almanacEvents('venus',day,site);
 assert.deepEqual(events.map(e=>e.kind),['rise','set']);
 assert.equal(new Date(events[0].at).toISOString().slice(0,16),'2026-11-01T20:04');
 assert.equal(new Date(events[1].at).toISOString().slice(0,16),'2026-11-02T06:44');
 for(const e of events){assert.ok(e.at>=day&&e.at<day+86400000);assert.ok(e.azimuth>=0&&e.azimuth<360);}
 assert.deepEqual(JSON.parse(JSON.stringify(c.almanacEvents('venus',day,{latitude:89.9,longitude:0}).filter(e=>!Number.isFinite(e.at)))),[]);
});
