import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import{createRequire}from'node:module';const require=createRequire(import.meta.url),S=require('./astronotes-search.js'),T=require('./astronotes-terrain.js'),A=require('./astronotes-align.js');
const data=JSON.parse(fs.readFileSync('data/aim-places.json')),rows=S.open(data),near={latitude:35.7,longitude:139.84};
test('existing bridge and every bundled kind are searchable without the remote services',()=>{
 for(const kind of Object.values(data.kinds)){const r=rows.find(r=>r.kind===kind);assert.ok(S.search(rows,r.name).some(x=>x.latitude===r.latitude&&x.longitude===r.longitude),kind);}
 for(const q of ['ふれあい橋','旧中川 ふれあい橋','ふれあい橋 旧中川','旧中川ふれあい橋','江戸川区　ふれあい橋','ふれあい橋 平井','フレアイ橋'])assert.ok(S.search(rows,q).some(r=>r.latitude===35.70076&&r.longitude===139.84115),q);
 for(const q of ['多摩川 ふれあい橋 江戸川区','大阪府 ふれあい橋 平井','旧中川 存在しない橋'])assert.equal(S.search(rows,q).length,0,q);
 assert.equal(S.search(rows,'').length,0);assert.ok(S.search(rows,'江戸川区').every(r=>r.name.includes('江戸川区')),'an address term alone must not return every place in that address');
});
test('river context uses segments near the bridge, not the distant label point or other rivers',()=>{
 const r=S.open({gRelative:true,kinds:{b:'橋',w:'川岸'},places:[{k:'b',n:'テスト橋',a:'試験市',p:[3500000,13900000]},{k:'w',n:'流れる川',p:[3501000,13900000],g:[-2000,0,2000,0]},{k:'w',n:'遠い川',p:[3600000,14000000]}]});
 assert.deepEqual(r[0].context,['流れる川']);assert.equal(S.search(r,'流れる川 テスト橋').length,1);assert.equal(S.search(r,'遠い川 テスト橋').length,0);
 assert.deepEqual(S.open({places:[{n:'壊れた橋',p:[NaN,0]},{n:'範囲外',p:[9100000,0]}]}),[]);
});
function runtime({offline=false,failPhoto=false}={}){
 const html=fs.readFileSync('index.html','utf8'),src=html.slice(html.indexOf('let searchSupplementPromise'),html.indexOf('/// 検索結果を並べる。'));let loads=0;
 const ctx=vm.createContext({AstroNotesPlaceSearch:S,AstroNotesTerrain:T,AstroNotesAlign:A,URLSearchParams,AbortController,setTimeout,clearTimeout,favorites:[],place:near,placeIndex:async()=>({places:[]}),fetch:async u=>{
  if(u==='data/aim-places.json'){loads++;if(failPhoto)throw Error('unavailable');return{ok:true,json:async()=>data};}
  if(u.startsWith('data/'))return{ok:true,json:async()=>({places:[]})};
  if(offline)throw Error('offline');return{ok:true,json:async()=>u.includes('msearch')?[]:[{name:'ふれあい橋',lat:'35.7517',lon:'139.2488',display_name:'ふれあい橋, 日の出町, 東京都',type:'road'}]};
 }});vm.runInContext(src,ctx);return{ctx,loads:()=>loads};
}
test('shared runtime ANDs remote and local terms, ranks the nearby bridge and preserves point selection',async()=>{
 const{ctx,loads}=runtime();for(const q of ['ふれあい橋','旧中川 ふれあい橋','江戸川区 ふれあい橋']){const out=await ctx.searchPlaces(q);assert.equal(out[0].latitude,35.70076);assert.equal(out[0].scope,'point');assert.match(out[0].detail,/平井三丁目/);if(q.includes(' '))assert.ok(out.every(r=>r.latitude!==35.7517));}
 assert.equal(loads(),1);assert.equal((await ctx.searchPlaces('旧中川 ふれあい橋',{localOnly:true}))[0].longitude,139.84115);
});
test('external failure retains the local bridge; local file failure is retryable and does not break other sources',async()=>{
 const{ctx}=runtime({offline:true});assert.equal((await ctx.searchPlaces('旧中川 ふれあい橋'))[0].latitude,35.70076);
 const{ctx:bad,loads}=runtime({failPhoto:true});assert.equal((await bad.searchPlaces('ふれあい橋'))[0].source,'osm');await bad.searchPlaces('ふれあい橋');assert.equal(loads(),2);
});

test('a nearby geocoder duplicate keeps the bridge representative point and address',async()=>{
 const{ctx}=runtime();const fetchJson=ctx.searchJson;ctx.searchJson=async url=>url.startsWith('data/')?fetchJson(url):url.includes('msearch')?[]:[{name:'ふれあい橋',lat:'35.7005',lon:'139.841',display_name:'ふれあい橋, 平井, 江戸川区',type:'road'}];
 const out=await ctx.searchPlaces('ふれあい橋');assert.equal(out.filter(r=>r.latitude>35.69&&r.latitude<35.71&&r.longitude>139.83&&r.longitude<139.85).length,1);assert.equal(out[0].latitude,35.70076);assert.equal(out[0].address,'東京都江戸川区平井三丁目');assert.equal(out[0].source,'photo');
});
test('AND search keeps favorite identity and height, and matches registered facility aliases',async()=>{
 const{ctx}=runtime();ctx.favorites=[{id:'favorite1',name:'朝の撮影ポイント',subtitle:'東京都江東区',latitude:35.7,longitude:139.84,eyeHeightAGL:12}];const out=await ctx.searchPlaces('江東区 撮影ポイント',{localOnly:true});assert.equal(out[0].savedPlace,ctx.favorites[0]);assert.equal(out[0].savedPlace.eyeHeightAGL,12);
 const lobby=await ctx.searchPlaces('練馬区役所 展望ロビー',{localOnly:true});assert.equal(lobby[0].name,'練馬区役所');assert.equal(lobby[0].decks[0].aglM,80);
});

test('wide rivers match the whole bridge geometry and preserve elevation and canonical deck metadata',async()=>{
 for(const [q,name] of [['多摩川 丸子橋','丸子橋'],['多摩川 多摩川大橋','多摩川大橋']])assert.ok(S.search(rows,q).some(r=>r.name===name),q);
 const{ctx}=runtime();const deck=(await ctx.searchPlaces('東京タワー メインデッキ',{localOnly:true})).find(r=>r.name==='東京タワー メインデッキ');assert.equal(deck.decks[0].aglM,125,'current registry floor estimate, not legacy catalog 150m');assert.equal(deck.elevation,21);
 const top=(await ctx.searchPlaces('東京スカイツリー 天望回廊',{localOnly:true})).find(r=>r.name==='東京スカイツリー 天望回廊');assert.equal(top.decks[0].aglM,450);
 const hill=(await ctx.searchPlaces('高尾山',{localOnly:true})).find(r=>r.kind==='山頂');assert.ok(Number.isFinite(hill.elevation));
});
test('translated names and normalized street addresses still use geocoder results when local literal AND has no match',async()=>{
 const{ctx}=runtime();const fetchJson=ctx.searchJson;ctx.searchJson=async url=>url.startsWith('data/')?fetchJson(url):url.includes('msearch')?[]:[{name:'東京タワー',lat:'35.6586',lon:'139.7454',display_name:'東京タワー, 芝公園四丁目, 港区, 東京都',type:'tower'}];
 assert.ok((await ctx.searchPlaces('Tokyo Tower')).some(r=>r.name==='東京タワー'));assert.ok((await ctx.searchPlaces('東京都 港区 芝公園4-2-8')).some(r=>r.name==='東京タワー'));
});
test('a compound area name cannot fabricate a hit on a generic viewpoint',()=>{
 const r=S.open({kinds:{d:'展望台'},places:[{k:'d',n:'展望台',a:'東京都荒川区',p:[3500000,13900000]}]});assert.equal(S.search(r,'荒川展望台').length,0);
});
