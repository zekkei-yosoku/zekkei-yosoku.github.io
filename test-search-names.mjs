import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const repo=new URL('./',import.meta.url).pathname;const require=createRequire(repo+'test-terrain.mjs'),T=require(repo+'sorami-terrain.js');const html=fs.readFileSync(repo+'index.html','utf8');const data=JSON.parse(fs.readFileSync(repo+'data/search-supplement.json'));const src=html.slice(html.indexOf('let searchSupplementPromise'),html.indexOf('/// 検索結果を並べる。'));
let networkFail=false, remoteRequests=0;const saved={id:'fav:example',name:'独自の撮影ポイント',latitude:35.58,longitude:139.57,eyeHeightAGL:15,elevation:70};const ctx=vm.createContext({SoramiTerrain:T,SoramiAlign:require(repo+"sorami-align.js"),URLSearchParams,AbortController,setTimeout,clearTimeout,fetch:async u=>{if(u.startsWith('data/'))return {ok:true,json:async()=>data};remoteRequests++;if(networkFail)throw Error('offline');return {ok:true,json:async()=>[]};},favorites:[saved],place:{latitude:35.68,longitude:139.76},placeIndex:async()=>({places:[]})});vm.runInContext(src,ctx);
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
const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',innerHTML:'',dataset:{},events:{},addEventListener(n,f){this.events[n]=f;},setAttribute(){},removeAttribute(){},closest(){return dialog;},insertAdjacentHTML(_p,s){this.innerHTML+=s;}});return nodes.get(id);};
const pending=[];const race=vm.createContext({setTimeout,clearTimeout,$:node,document:{getElementById:node},MapPick:{center:()=>({})},placeSheetFor:null,place:{},SoramiTerrain:{parseLatLon:()=>null,isShortMapLink:()=>false},searchPlaces:(q,o)=>o?.localOnly?Promise.resolve([]):new Promise(resolve=>pending.push({q,resolve})),renderSearchResults:(h,r)=>{h.innerHTML=r.map(x=>x.name).join(',');}});
vm.runInContext(html.slice(html.indexOf('function wireSearchBox('),html.indexOf('wireSearchBox("searchBox"')),race);race.wireSearchBox('searchBox','searchResults',()=>{},()=>{});
const box=node('searchBox'),out=node('searchResults'),go=node('searchBoxGo');box.value='旧候補';box.events.input();go.onclick();await new Promise(setImmediate);box.value='';box.events.input();pending.shift().resolve([{name:'旧候補'}]);await new Promise(setImmediate);assert.equal(out.innerHTML,'');
box.value='A候補';box.events.input();go.onclick();await new Promise(setImmediate);box.value='B候補';box.events.input();go.onclick();await new Promise(setImmediate);const pa=pending.shift(),pb=pending.shift();pb.resolve([{name:'B候補'}]);await new Promise(setImmediate);pa.resolve([{name:'A候補'}]);await new Promise(setImmediate);assert.equal(out.innerHTML,'B候補');dialog.events.close();assert.equal(out.innerHTML,'');
console.log('CLEAR / OUT-OF-ORDER / CLOSE RACE OK');
