import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const repo=new URL('./',import.meta.url).pathname;const require=createRequire(repo+'test-terrain.mjs'),T=require(repo+'sorami-terrain.js');const html=fs.readFileSync(repo+'index.html','utf8');const data=JSON.parse(fs.readFileSync(repo+'data/search-supplement.json'));const src=html.slice(html.indexOf('let searchSupplementPromise'),html.indexOf('/// 検索結果を並べる。'));
let networkFail=false, remoteRequests=0;const saved={id:'fav:example',name:'独自の撮影ポイント',latitude:35.58,longitude:139.57,eyeHeightAGL:15,elevation:70};const ctx=vm.createContext({SoramiTerrain:T,SoramiPlaceSearch:require(repo+'sorami-search.js'),SoramiAlign:require(repo+"sorami-align.js"),URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:async u=>{if(u.startsWith('data/'))return {ok:true,json:async()=>data};remoteRequests++;if(networkFail)throw Error('offline');return {ok:true,json:async()=>[]};},favorites:[saved],place:{latitude:35.68,longitude:139.76},placeIndex:async()=>({places:[]})});vm.runInContext(src,ctx);
for(const q of ['鷺沼北公園','鷺沼北','土橋第４公園','サギヌマキタコウエン']){const a=await ctx.searchPlaces(q);assert.equal(a[0].name,'鷺沼北公園');assert.equal(a[0].latitude,35.58426157);}
let a=await ctx.searchPlaces('独自の撮影');assert.equal(a[0].savedPlace,saved);assert.equal(a[0].savedPlace.eyeHeightAGL,15);assert.equal(ctx.namedPlaceMatches('',[saved]).length,0);
networkFail=true;vm.runInContext('searchResponseCache.clear()',ctx);a=await ctx.searchPlaces('鷺沼北公園');assert.equal(a[0].name,'鷺沼北公園');
console.log('SEARCH NAMES OK: exact, prefix, alias, kana, favorite metadata, blank, external failure');

ctx.placeIndex=async()=>({kinds:{v:'展望地'},munis:['埼玉県飯能市'],places:[['v','東京スカイツリー眺望処','',3580000,13910000,null,0]]});
const tree=await ctx.searchPlaces('スカイツリー');assert.equal(tree[0].name,'東京スカイツリー');assert.equal(tree[0].latitude,35.710063);assert.equal(tree[0].decks.length,2);
console.log('LANDMARK ORDER OK');
assert.equal(tree[1].name,'東京スカイツリー眺望処');

const before=remoteRequests;await ctx.searchPlaces('スカイツリー',{localOnly:true});assert.equal(remoteRequests,before);
networkFail=false;vm.runInContext('searchResponseCache.clear()',ctx);const start=remoteRequests;await Promise.all([ctx.searchPlaces('東京タワー'),ctx.searchPlaces('東京タワー')]);assert.equal(remoteRequests-start,2);
console.log('LOCAL ONLY / IN-FLIGHT CACHE OK');

vm.runInContext('searchResponseCache.clear()',ctx);networkFail=true;const none=await ctx.searchPlaces('存在しない検索テスト');assert.equal(none.length,0);assert.equal(none.searchFailed,true);
networkFail=false;vm.runInContext('searchResponseCache.clear()',ctx);ctx.placeIndex=async()=>({kinds:{v:'展望地'},munis:['東京都'],places:[['v','高尾山展望台','',3550000,13920000,null,0]]});ctx.fetch=async u=>u.startsWith('data/')?{ok:true,json:async()=>data}:u.includes('msearch.gsi')?{ok:true,json:async()=>[{geometry:{coordinates:[139.243,35.625]},properties:{title:'高尾山'}}]}:{ok:true,json:async()=>[]};
const exact=await ctx.searchPlaces('高尾山');assert.equal(exact[0].name,'高尾山');assert.equal(exact[1].name,'高尾山展望台');console.log('CROSS-SOURCE EXACT ORDER / NETWORK FAILURE OK');

// 実際の入力ハンドラーで、消去・連続検索・閉じる後の旧応答を検査する。
const nodes=new Map();const dialog={events:{},addEventListener(n,f){this.events[n]=f;}};
const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',dataset:{},events:{},parentElement:{classList:{add(){}}},classList:{add(){}},getAttribute(){return null;},addEventListener(n,f){this.events[n]=f;},setAttribute(){},removeAttribute(){},closest(){return dialog;},insertAdjacentHTML(_p,s){this.innerHTML+=s;}});return nodes.get(id);};
const pending=[];const race=vm.createContext({setTimeout,clearTimeout,$:node,document:{getElementById:node},MapPick:{center:()=>({})},placeSheetFor:null,place:{},SoramiTerrain:{parseLatLon:()=>null,isShortMapLink:()=>false},searchPlaces:(q,o)=>o?.localOnly?Promise.resolve([]):new Promise(resolve=>pending.push({q,resolve})),renderSearchResults:(h,r)=>{h.innerHTML=r.map(x=>x.name).join(',');}});
vm.runInContext(html.slice(html.indexOf('function wireSearchBox('),html.indexOf('wireSearchBox("searchBox"')),race);race.wireSearchBox('searchBox','searchResults',()=>{},()=>{});
const box=node('searchBox'),out=node('searchResults'),go=node('searchBoxGo');box.value='旧候補';box.events.input();go.onclick();await new Promise(setImmediate);box.value='';box.events.input();pending.shift().resolve([{name:'旧候補'}]);await new Promise(setImmediate);assert.equal(out.innerHTML,'');
box.value='A候補';box.events.input();go.onclick();await new Promise(setImmediate);box.value='B候補';box.events.input();go.onclick();await new Promise(setImmediate);const pa=pending.shift(),pb=pending.shift();pb.resolve([{name:'B候補'}]);await new Promise(setImmediate);pa.resolve([{name:'A候補'}]);await new Promise(setImmediate);assert.equal(out.innerHTML,'B候補');dialog.events.close();assert.equal(out.innerHTML,'');
console.log('CLEAR / OUT-OF-ORDER / CLOSE RACE OK');

box.value='変換候補';box.events.input();const count=pending.length;box.events.keydown({key:'Enter',isComposing:true,keyCode:13});box.events.keydown({key:'Enter',isComposing:false,keyCode:229});await new Promise(setImmediate);assert.equal(pending.length,count);dialog.events.close();console.log('IME CONFIRM DOES NOT SEARCH OK');

for(const q of ['練馬区役所','練馬区役所本庁舎','練馬区役所 展望ロビー']){const r=await ctx.searchPlaces(q,{localOnly:true});assert.equal(r[0].name,'練馬区役所');assert.equal(r[0].decks[0].aglM,80);assert.equal(r[0].decks[0].heightBasis,'published-viewpoint');assert.match(r[0].decks[0].source,/city.nerima.tokyo.jp/);assert.ok(Math.abs(r[0].longitude-139.651667)<.000001);}
for(const name of ['練馬区役所前バス停','練馬区役所入口','練馬区役所西庁舎','練馬区役所付近の公園'])assert.equal(T.decksFor(name),null);
assert.equal(T.decksFor('練馬区役所本庁舎20階展望ロビー')[0].aglM,80);
console.log('OFFICIAL LOOKOUT REGISTRY / LOBBY SEARCH / FALSE POI MATCH OK');

ctx.placeIndex=async()=>({kinds:{v:'展望地'},munis:['大阪府堺市'],places:[['v','堺市役所高層館展望ロビー','',3460000,13548000,null,0]]});
const relevant=await ctx.searchPlaces('練馬区役所',{localOnly:true});assert.equal(relevant.length,1);assert.equal(relevant[0].name,'練馬区役所');console.log('EXACT FACILITY DOES NOT INCLUDE UNRELATED WARD HALLS OK');

// GSIだけにある候補でも、同名施設を住所で見分けられる。座標そのものは変えない。
ctx.placeIndex=async()=>({places:[]});ctx.favorites=[];
vm.runInContext('searchResponseCache.clear()',ctx);
ctx.fetch=async u=>u.startsWith('data/')?{ok:true,json:async()=>data}:u.includes('msearch.gsi')?{ok:true,json:async()=>[
 {geometry:{coordinates:[140.597638222222,36.4095667777778]},properties:{title:'ひたち海浜公園',addressCode:'8221'}},
 {geometry:{coordinates:[140.593820666667,36.3977911111111]},properties:{title:'ひたち海浜公園ＩＣ',addressCode:'08221'}},
 {geometry:{coordinates:[140.5,36.3]},properties:{title:'ひたち海浜公園（住所不明）',addressCode:'unknown'}}]}:{ok:true,json:async()=>[]};
const addressed=await ctx.searchPlaces('ひたち海浜公園');
assert.equal(addressed[0].address,'茨城県ひたちなか市');assert.match(addressed[0].detail,/茨城県ひたちなか市/);assert.equal(addressed[0].latitude,36.4095667777778);assert.equal(addressed.find(r=>r.name==='ひたち海浜公園ＩＣ').address,'茨城県ひたちなか市');assert.match(addressed.find(r=>r.name.includes('住所不明')).detail,/住所を確認できません/);assert.ok(addressed.every(r=>!/[緯経]度/.test(r.detail)));console.log('GSI ADDRESS CODE: municipality, padded code, unknown fallback, coordinates preserved OK');
