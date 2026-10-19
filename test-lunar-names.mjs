import test from 'node:test';import assert from 'node:assert/strict';import{createRequire}from'node:module';
process.env.TZ='Asia/Tokyo';
const require=createRequire(import.meta.url),N=require('./trial/sorami-lunar-names.js'),A=require('./trial/sorami-astro.js'),E=require('./vendor/astronomy-engine-2.1.19.min.js'),P=require('./trial/sorami-moon-portrait.js');
const jst=t=>new Date(t+32400000).toISOString().slice(0,10),full=y=>N.calendar(y,A).events.filter(e=>e.kind===2),tags=e=>e.tags.map(t=>t[1]);
test('All four event times agree with independent engine across supported years',()=>{
 for(const y of [2020,2024,2026,2030]){const c=N.calendar(y,A);assert.ok(c.events.length>=48&&c.events.length<=51);for(const e of c.events){const found=E.SearchMoonPhase(e.kind*90,new Date(e.at-86400000),2);assert.ok(found);assert.ok(Math.abs(found.date.getTime()-e.at)<120000,`${y} ${e.kind} ${new Date(e.at).toISOString()}`);}}
});
test('JST event days, eight phase names and month names remain distinct',()=>{
 const o={latitude:35.68,longitude:139.76},seen=new Set();for(let d=1;d<=31;d++){const t=Date.UTC(2026,9,d,3),n=N.describe(t,A.moon(t,o),A);seen.add(n.en);if(n.event)assert.equal(jst(n.event.at),jst(t));}
 assert.equal(seen.size,8);assert.equal(N.MONTHS.length,12);assert.equal(new Set(N.MONTHS.map(n=>n[1])).size,12);
 const at=Date.parse('2024-10-17T18:16:38+09:00'),n=N.describe(at,A.moon(at,o),A);assert.equal(n.ja,'満月');assert.equal(n.event.name[1],'Hunter’s Moon');assert.ok(tags(n.event).includes('Supermoon'));
});
test('Harvest can occur in October, Hunter follows it, Blue supports both calendars',()=>{
 const moons=full(2025),harvest=moons.find(e=>e.name[1]==='Harvest Moon'),hunter=moons.find(e=>e.at>harvest.at);assert.equal(jst(harvest.at),'2025-10-07');assert.equal(hunter.name[1],'Hunter’s Moon');
 assert.ok(tags(full(2026).find(e=>jst(e.at)==='2026-05-31')).includes('Blue Moon'));
 assert.ok(tags(full(2024).find(e=>jst(e.at)==='2024-08-20')).includes('Seasonal Blue Moon'));
 const combined=full(2023).find(e=>jst(e.at)==='2023-08-31');assert.ok(tags(combined).includes('Blue Moon'));assert.ok(tags(combined).includes('Supermoon'));
 for(const y of [2024,2026]){const c=N.calendar(y,A);for(const e of full(y)){const range=c.maxDistanceKm-c.minDistanceKm;assert.equal(tags(e).includes('Supermoon'),e.distanceKm<=c.maxDistanceKm-.9*range);assert.equal(tags(e).includes('Micromoon'),e.distanceKm>=c.minDistanceKm+.9*range);assert.ok(!(tags(e).includes('Supermoon')&&tags(e).includes('Micromoon')));}}
});
test('Generated alpha cannot introduce arbitrary notches into the physical lunar limb',()=>{
 const size=64,base=new Uint8ClampedArray(size*size*4);for(let y=4;y<60;y++)for(let x=4;x<60;x++){const i=(y*size+x)*4;base.set([150,160,170,255],i);}base[(10*size+32)*4+3]=0;
 const restored=P.circularSurface(base,size),r=size/2;for(let y=0;y<size;y++)for(let x=0;x<size;x++)if(Math.hypot(x+.5-r,y+.5-r)<=r){assert.equal(restored[(y*size+x)*4+3],255);assert.equal(restored[(y*size+x)*4],150);}
 const shaded=P.shade(restored,size,1,0);assert.equal(shaded[3],0);assert.ok(shaded[(32*size+62)*4+3]>250);
});
test('Japanese night names count civil dates from the actual new Moon, not fixed illumination bins',()=>{
 const o={latitude:35.68,longitude:139.76};for(const[day,name]of [['2026-10-13','三日月'],['2026-10-19','上弦の月'],['2026-10-23','十三夜'],['2026-10-24','小望月'],['2026-10-27','立待月'],['2026-10-30','更待月']]){const at=Date.parse(day+'T12:00:00+09:00');assert.equal(N.describe(at,A.moon(at,o),A).ja,name);}
 assert.equal(N.traditional(Date.parse('2026-10-26T12:00:00+09:00'),A).name,'十六夜');
 for(const year of [2020,2024,2026,2030])for(const e of N.calendar(year,A).events.filter(e=>e.kind===0)){const day=Date.parse(jst(e.at)+'T12:00:00+09:00');assert.equal(N.traditional(day,A).day,1);assert.equal(N.traditional(day+2*86400000,A).name,'三日月');}
});
