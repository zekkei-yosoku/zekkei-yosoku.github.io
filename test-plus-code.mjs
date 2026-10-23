import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url), O=require('./astronotes-open-location-code.js'), P=require('./astronotes-plus-code.js'), T=require('./astronotes-terrain.js');
const read=name=>fs.readFileSync(new URL(name,import.meta.url),'utf8'), html=read('index.html');
const vectors=name=>read('vendor/open-location-code/'+name).split(/\r?\n/).filter(s=>s.trim()&&!s.startsWith('#')).map(s=>s.split(','));

test('pinned upstream bytes and official validity, decoding, recovery vectors',async()=>{
 const provenance=JSON.parse(read('vendor/open-location-code/provenance.json'));
 assert.equal(createHash('sha256').update(read('astronotes-open-location-code.js')).digest('hex'),provenance.sha256);
 for(const [code,valid,short,full] of vectors('validityTests.csv')){
  assert.equal(O.isValid(code),valid==='true',code);assert.equal(O.isShort(code),short==='true',code);assert.equal(O.isFull(code),full==='true',code);
 }
 for(const [code,length,...bounds] of vectors('decoding.csv')){
  const a=O.decode(code);assert.equal(a.codeLength,+length,code);
  for(const [i,key] of ['latitudeLo','longitudeLo','latitudeHi','longitudeHi'].entries())assert.ok(Math.abs(a[key]-Number(bounds[i]))<1e-9,code+' '+key);
  const parsed=P.parse(code);assert.equal(parsed.kind,'full',code);const {results:[r]}=await P.resolve(parsed,()=>{throw Error('must be offline')});
  assert.ok(r.latitude>=a.latitudeLo&&r.latitude<=a.latitudeHi);assert.ok(r.longitude>=a.longitudeLo&&r.longitude<=a.longitudeHi);
 }
 for(const [full,lat,lon,short,type] of vectors('shortCodeTests.csv')){
  if(type==='S')continue;
  assert.equal(O.recoverNearest(short,+lat,+lon),full);
  const {results:[r]}=await P.resolve(P.parse(short+' Test locality'),async()=>[{name:'Test locality',latitude:+lat,longitude:+lon}]);
  assert.equal(r.plusCode,full,short);
 }
});

test('full and short input normalization, name prefix, malformed codes, ordinary names and coordinates',async()=>{
 assert.equal(P.parse('８４９ｖｃｗｃ８＋ｒ９').code,'849VCWC8+R9');
 assert.equal(P.parse('849VCWC8+R9, Mountain View').code,'849VCWC8+R9');
 assert.equal(P.parse('CWC8+R9 Mountain View, CA').locality,'Mountain View, CA');
 assert.equal(P.parse('横浜市 CWC8+R9').locality,'横浜市');
 for(const text of ['849VCWC8+I9','XVCXCCCC+CC','849VCWC8+R9 8FVC9G8F+6X'])assert.equal(P.parse(text).kind,'invalid',text);
 for(const text of ['横浜市','C++ Cafe','A+B','B+COM','BOOK+CAFE','Cafe+Bar','AB+CD','+35.6, +139.7','https://maps.google.com/?q=849VCWC8%2BR9'])assert.equal(P.parse(text),null,text);
 for(const short of ['CWC8+R9','+2VX','22+'])assert.match((await P.resolve(P.parse(short),()=>{throw Error('must not search')})).message,/地域名/);
 assert.equal((await P.resolve(P.parse('849VCWC8+R9 Mountain View'),()=>{throw Error('must be offline')})).results.length,1);
});

test('short-code candidates preserve different regions, remove only duplicate full codes, and distinguish failures',async()=>{
 const query=P.parse('CWC8+R9 Test');let called='';
 const refs=[{name:'First city',detail:'North',latitude:37.4,longitude:-122.1},{name:'Duplicate',latitude:37.4,longitude:-122.1},{name:'Other city',detail:'South',latitude:35.4,longitude:139.6},{name:'Bad',latitude:NaN,longitude:3}];
 const out=await P.resolve(query,async q=>(called=q,refs));assert.equal(called,'Test');assert.equal(out.results.length,2);assert.notEqual(out.results[0].plusCode,out.results[1].plusCode);
 assert.match(out.results[0].detail,/First city/);assert.match(out.message,/確認して選んで/);
 assert.match((await P.resolve(query,async()=>[])).message,/見つかりません/);
 assert.match((await P.resolve(query,async()=>Object.assign([],{searchFailed:true}))).message,/接続できません/);
 assert.match((await P.resolve(query,async()=>{throw Error('offline')})).message,/検索できません/);
 const coarse=(await P.resolve(P.parse('84000000+'))).results[0];assert.ok(coarse.zoom<10);assert.match(coarse.detail,/km/);
});

function wireRuntime(){
 const nodes=new Map(),dialog={events:{},addEventListener(n,f){this.events[n]=f;}};
 const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',dataset:{},attrs:{},events:{},parentElement:{classList:{add(){}}},classList:{add(){}},getAttribute(){return null;},addEventListener(n,f){this.events[n]=f;},setAttribute(n,v){this.attrs[n]=v;},removeAttribute(n){delete this.attrs[n];},closest(){return dialog;},insertAdjacentHTML(_p,s){this.innerHTML+=s;}});return nodes.get(id);};
 const calls=[],picks=[],coords=[],pending=[];
 const ctx=vm.createContext({setTimeout,clearTimeout,AstroNotesPlusCode:P,AstroNotesTerrain:T,$:node,document:{getElementById:node},MapPick:{center:()=>({latitude:0,longitude:0})},placeSheetFor:null,place:{},esc:s=>String(s).replace(/</g,'&lt;'),searchPlaces:(q,o)=>{calls.push({q,o});return o.localOnly?Promise.resolve([]):new Promise(resolve=>pending.push(resolve));},renderSearchResults:(h,r,pick)=>{h.rows=r;h.pick=pick;h.innerHTML=r.map(x=>x.name).join(',');}});
 vm.runInContext(html.slice(html.indexOf('function wireSearchBox('),html.indexOf('wireSearchBox("searchBox"')),ctx);
 ctx.wireSearchBox('searchBox','searchResults',r=>picks.push(r),c=>coords.push(c));
 return{node,dialog,calls,picks,coords,pending,box:node('searchBox'),out:node('searchResults'),go:node('searchBoxGo')};
}
const tick=()=>new Promise(setImmediate);
test('actual shared input handler: full code is offline and requires a pick; short alone guides, coordinates keep direct selection',async()=>{
 const r=wireRuntime();r.box.value='849VCWC8+R9';r.box.events.input();await r.go.onclick();await tick();
 assert.equal(r.calls.length,0);assert.equal(r.picks.length,0);assert.equal(r.out.rows[0].plusCode,'849VCWC8+R9');r.out.pick(r.out.rows[0]);assert.equal(r.picks.length,1);assert.ok(!('aria-busy'in r.out.attrs));
 r.box.value='CWC8+R9';r.box.events.input();r.go.onclick();await tick();assert.match(r.out.innerHTML,/地域名/);assert.equal(r.calls.length,0);
 r.box.value='35.6,139.7';r.box.events.input();r.go.onclick();assert.equal(r.coords[0].latitude,35.6);assert.equal(r.calls.length,0);
});
test('short input only calls locality lookup on submit; clearing, switching and closing reject late results and stale picks',async()=>{
 const r=wireRuntime();r.box.value='CWC8+R9 Yokohama';r.box.events.input();await new Promise(resolve=>setTimeout(resolve,250));assert.equal(r.calls.length,0);r.go.onclick();await tick();assert.equal(r.calls[0].q,'Yokohama');assert.equal(r.calls[0].o.localityOnly,true);
 r.box.value='CWC8+R9 Tokyo';r.box.events.input();assert.equal(r.out.innerHTML,'');r.go.onclick();await tick();
 r.pending[1]([{name:'Tokyo',latitude:35.68,longitude:139.76}]);await tick();const pick=r.out.pick,old=r.out.rows[0];assert.match(old.detail,/Tokyo/);
 r.pending[0]([{name:'Yokohama',latitude:35.44,longitude:139.64}]);await tick();assert.match(r.out.rows[0].detail,/Tokyo/);
 r.box.value='';r.box.events.input();pick(old);assert.equal(r.picks.length,0);assert.equal(r.out.innerHTML,'');
 r.box.value='CWC8+R9 Yokohama';r.go.onclick();await tick();r.dialog.events.close();r.pending[2]([{name:'Yokohama',latitude:35.44,longitude:139.64}]);await tick();assert.equal(r.out.innerHTML,'');assert.ok(!('aria-busy'in r.out.attrs));
});

test('locality lookup keeps remote regional alternatives and allows overseas references without changing ordinary search JP restriction',async()=>{
 const urls=[];const ctx=vm.createContext({AstroNotesPlaceSearch:require('./astronotes-search.js'),AstroNotesTerrain:T,AstroNotesAlign:require('./astronotes-align.js'),URLSearchParams,AbortController,setTimeout,clearTimeout,favorites:[],place:{latitude:35.68,longitude:139.76},placeIndex:async()=>({places:[]}),fetch:async url=>{urls.push(url);return{ok:true,json:async()=>url.startsWith('data/')?{places:[]}:url.includes('msearch')?[]:[{name:'Mountain View',lat:'37.4',lon:'-122.1',display_name:'Mountain View, California'},{name:'Mountain View',lat:'20.5',lon:'-155.2',display_name:'Mountain View, Hawaii'}]};}});
 vm.runInContext(html.slice(html.indexOf('let searchSupplementPromise'),html.indexOf('/// 検索結果を並べる。')),ctx);
 const refs=await ctx.searchPlaces('Mountain View',{localityOnly:true});assert.equal(refs.length,2);assert.ok(urls.some(u=>u.includes('nominatim')&&!u.includes('countrycodes')));
 urls.length=0;await ctx.searchPlaces('Mountain View');assert.ok(urls.some(u=>u.includes('nominatim')&&u.includes('countrycodes=jp')));
});

test('overseas locality with empty GSI and unavailable OSM is a connection failure, not absence',async()=>{
 const ctx=vm.createContext({AstroNotesPlaceSearch:require('./astronotes-search.js'),AstroNotesTerrain:T,AstroNotesAlign:require('./astronotes-align.js'),URLSearchParams,AbortController,setTimeout,clearTimeout,favorites:[],place:{latitude:35.68,longitude:139.76},placeIndex:async()=>({places:[]}),fetch:async url=>{if(url.includes('nominatim'))throw Error('unavailable');return{ok:true,json:async()=>url.startsWith('data/')?{places:[]}:[]};}});
 vm.runInContext(html.slice(html.indexOf('let searchSupplementPromise'),html.indexOf('/// 検索結果を並べる。')),ctx);
 const out=await P.resolve(P.parse('CWC8+R9 Mountain View'),q=>ctx.searchPlaces(q,{localityOnly:true}));
 assert.equal(out.results.length,0);assert.match(out.message,/接続できません/);
});

test('actual GSI Yokohama response does not turn fire stations into extra reference cities',async()=>{
 const fixture=JSON.parse(read('fixtures/plus-code-gsi-yokohama.json'));assert.ok(fixture.length>100);
 const ctx=vm.createContext({AstroNotesPlaceSearch:require('./astronotes-search.js'),AstroNotesTerrain:T,AstroNotesAlign:require('./astronotes-align.js'),URLSearchParams,AbortController,setTimeout,clearTimeout,favorites:[],place:{latitude:35.68,longitude:139.76},placeIndex:async()=>({places:[]}),fetch:async url=>({ok:true,json:async()=>url.startsWith('data/')?{places:[]}:url.includes('msearch')?fixture:[]})});
 vm.runInContext(html.slice(html.indexOf('let searchSupplementPromise'),html.indexOf('/// 検索結果を並べる。')),ctx);
 const refs=await ctx.searchPlaces('横浜市',{localityOnly:true});assert.equal(refs.length,1);assert.equal(refs[0].name,'神奈川県横浜市');
 const out=await P.resolve(P.parse('CWC8+R9 横浜市'),async()=>refs);assert.equal(out.results.length,1);assert.match(out.results[0].detail,/基準の地名：神奈川県横浜市/);
});

test('an exact facility does not hide a qualified or translated regional reference',async()=>{
 const ctx=vm.createContext({AstroNotesPlaceSearch:require('./astronotes-search.js'),AstroNotesTerrain:T,AstroNotesAlign:require('./astronotes-align.js'),URLSearchParams,AbortController,setTimeout,clearTimeout,favorites:[],place:{latitude:35.68,longitude:139.76},placeIndex:async()=>({places:[]}),fetch:async url=>({ok:true,json:async()=>url.startsWith('data/')?{places:[]}:url.includes('msearch')?[{properties:{title:'Foo'},geometry:{coordinates:[139.6,35.4]}}]:[{name:'Foo City',lat:'36.4',lon:'140.6',display_name:'Foo City, Japan',category:'place',type:'city'}]})});
 vm.runInContext(html.slice(html.indexOf('let searchSupplementPromise'),html.indexOf('/// 検索結果を並べる。')),ctx);
 const refs=await ctx.searchPlaces('Foo',{localityOnly:true});assert.deepEqual(Array.from(refs,r=>r.name),['Foo','Foo City']);
});
