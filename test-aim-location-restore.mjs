import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const a=html.indexOf('function aimSavedFrom('),b=html.indexOf('// 月の中の各日',a),src=html.slice(a,b);
function boot(mem){const inherited={name:'現在地',latitude:35,longitude:139};const nodes=new Map();const c=vm.createContext({SoramiTerrain:{decksFor:n=>n==='渋谷スカイ'?[{name:'展望台',aglM:229}]:n==='東京スカイツリー'?[{name:'天望デッキ',aglM:350},{name:'天望回廊',aglM:450}]:null,deckLabel:d=>d},esc:x=>x,aim:{},store:{get:(k,d)=>mem[k]??d,set:(k,v)=>mem[k]=JSON.parse(JSON.stringify(v))},inheritedPoint:()=>inherited,aimRenderFrom(){},$:id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},value:"",textContent:"",innerHTML:"",checkValidity:()=>true,querySelectorAll:()=>[]});return nodes.get(id)},AimMap:{open(){},zoom:()=>11,redraw(){}}});vm.runInContext(src,c);return c;}
test('選択地点は更新後も復元し、継承の現在地では上書きしない',()=>{const mem={},c=boot(mem);assert.equal(c.aimFromPoint().name,'現在地');c.aimSetFrom({name:'鷺沼北公園',latitude:35.58386,longitude:139.56853});const re=boot(mem);assert.equal(re.aimFromPoint().name,'鷺沼北公園');assert.equal(re.aimFromPoint().latitude,35.58386);});
test('壊れた保存座標は継承地点へ戻し、明示的解除のnullも復元',()=>{for(const p of [null,{latitude:91,longitude:139},{latitude:35,longitude:181},{latitude:'35',longitude:139}])assert.equal(boot({'sorami.aimFrom':p}).aimFromPoint().name,'現在地');});

// 2026-10-06 観測標高を「標高」（地面だけ）と「地上から」（目の高さ1.5m＋立つ所）に分けた（ユーザー「標高は標高だけ。展望台の高さは目線のところに」）。
// 展望台は床の高さ＋1.5m（候補地を解く SoramiAlign と同じ）。それまでは普通の地点が0m、展望台は床の高さのままだった
test('展望台は立つ所として保存・復元し、地上からは床の高さ＋目の高さ、標高は地面だけ',()=>{
 const mem={},c=boot(mem);c.aimSetFrom({name:'渋谷スカイ',latitude:35.65838,longitude:139.70222,decks:[{name:'展望台',aglM:229}],eyeHeightAGL:229});
 const re=boot(mem),f=re.aimFromPoint(),o=re.aimObserverAt(f,19);
 assert.equal(f.stand,'展望台');assert.equal(f.standAglM,null);assert.equal(f.decks[0].aglM,229);assert.equal(o.elevation,19);assert.equal(o.eyeM,230.5);
});
test('検索・地点カード・前の保存の目の高さは立つ所に読み替え、どれにも当たらない高さは手入力として残す',()=>{
 const p={name:'渋谷スカイ',latitude:35.65838,longitude:139.70222};
 const eye=x=>{const c=boot({'sorami.aimFrom':x});return c.aimObserverAt(c.aimFromPoint(),19).eyeM;};
 assert.equal(eye(p),230.5,'既知の展望台を補う');
 for(const h of [0,1.5]){const f=boot({'sorami.aimFrom':{...p,eyeHeightAGL:h}}).aimFromPoint();assert.equal(f.stand,'ground');assert.equal(eye({...p,eyeHeightAGL:h}),1.5);}
 for(const h of [229,230.5])assert.equal(boot({'sorami.aimFrom':{...p,eyeHeightAGL:h}}).aimFromPoint().stand,'展望台');
 const roof=boot({'sorami.aimFrom':{...p,eyeHeightAGL:100}}).aimFromPoint();assert.equal(roof.standAglM,100);assert.equal(eye({...p,eyeHeightAGL:100}),100);
 assert.equal(eye({...p,name:'公園',eyeHeightAGL:Infinity,decks:[{aglM:-5}]}),1.5,'壊れた値は地面＋目の高さ');
 assert.equal(eye({name:'公園',latitude:35,longitude:139,eyeHeightAGL:0}),1.5,'前のねらうの普通の地点（0m）も1.5m');
});
test('展望台が2つある施設は立つ所を選べ、選んだ展望台で地上からが決まる',()=>{
 const mem={},c=boot(mem);c.aimSetFrom({name:'東京スカイツリー',latitude:35.71,longitude:139.81});
 assert.equal(c.aimObserverAt(c.aimFromPoint(),2).eyeM,351.5,'既定は先頭の展望台');
 c.aimSetStand('天望回廊');assert.equal(boot(mem).aimObserverAt(boot(mem).aimFromPoint(),2).eyeM,451.5);
 c.aimSetStand('ground');assert.equal(c.aimObserverAt(c.aimFromPoint(),2).eyeM,1.5);
});

test('地点選択の共通経路も展望台データを保ってねらうへ渡す',()=>{
 let selected;const picker={set:p=>selected=p};
 const c=vm.createContext({placeSheetFor:'aim',PLACE_PICKERS:{aim:picker},$(){return {close(){}}},aimAreaOf:()=>'',selectPlace(){throw Error('別の経路へ渡してはいけない')}});
 const start=html.indexOf('function choosePlace('),end=html.indexOf('/// 地点の画面を道具',start);
 vm.runInContext(html.slice(start,end),c);
 c.choosePlace({name:'渋谷スカイ',latitude:35.65838,longitude:139.70222,elevation:19,decks:[{name:'展望台',aglM:229}],eyeHeightAGL:229});
 assert.equal(selected.eyeHeightAGL,229);assert.equal(selected.decks[0].aglM,229);assert.equal(selected.elevation,19);
});

test('標高と地上からは別々に手で入れて保存復元し、それぞれ自動値へ戻せる',()=>{
 const mem={},c=boot(mem);c.aimSetFrom({name:'渋谷スカイ',latitude:35.65838,longitude:139.70222});
 assert.equal(c.aimSetGround(20),true);assert.equal(c.aimSetStandAgl(240),true);
 const re=boot(mem),o=re.aimObserverAt(re.aimFromPoint(),19);assert.equal(o.elevation,20);assert.equal(o.eyeM,240);
 assert.equal(re.aimSetGround(null),true);assert.equal(re.aimObserverAt(re.aimFromPoint(),19).elevation,19);assert.equal(re.aimObserverAt(re.aimFromPoint(),19).eyeM,240,'標高を戻しても地上からは残す');
 assert.equal(re.aimSetFromHeight({standAglM:null}),true);assert.equal(re.aimObserverAt(re.aimFromPoint(),19).eyeM,230.5);
 for(const x of [NaN,Infinity,-501,9001])assert.equal(re.aimSetGround(x),false);
 for(const x of [NaN,-0.1,701])assert.equal(re.aimSetStandAgl(x),false);
});
test('前の観測標高（海抜で1つ）は地面を自動のまま地上からに読み替え、入れ直すと新しい欄へ移す',()=>{
 const p={name:'渋谷スカイ',latitude:35.65838,longitude:139.70222,observationElevationM:250.5};
 const mem={'sorami.aimFrom':p},c=boot(mem),o=c.aimObserverAt(c.aimFromPoint(),19);
 assert.equal(o.elevation,19);assert.equal(o.eyeM,231.5);assert.equal(o.elevation+o.eyeM,250.5);
 c.aimRenderObserverHeight(c.aimFromPoint(),19);c.aimSetGround(20);
 const f=c.aimFromPoint();assert.equal(f.observationElevationM,null);assert.equal(f.standAglM,231.5);assert.equal(c.aimObserverAt(f,19).elevation+c.aimObserverAt(f,19).eyeM,251.5);
});
test('公園は地面＋目の高さ、展望台は地面＋床の高さ＋目の高さ',()=>{
 const c=boot({}),park=c.aimSavedFrom({name:'公園',latitude:35,longitude:139});
 const po=c.aimObserverAt(park,83);assert.equal(po.elevation+po.eyeM,84.5);
 const tower=c.aimSavedFrom({name:'渋谷スカイ',latitude:35,longitude:139});const to=c.aimObserverAt(tower,19);assert.equal(to.elevation+to.eyeM,249.5);
});

test('別地点を選び直すと前地点の手入力は引き継がず新地点の自動値になる',()=>{
 const mem={},c=boot(mem);c.aimSetFrom({name:'渋谷スカイ',latitude:35.65838,longitude:139.70222});c.aimSetGround(25);c.aimSetStandAgl(240);
 c.aimSetFrom({name:'公園',latitude:35.58386,longitude:139.56853});
 let f=c.aimFromPoint();assert.equal(f.groundManualM,null);assert.equal(f.standAglM,null);assert.equal(c.aimObserverAt(f,83).eyeM,1.5);assert.equal(c.aimObserverAt(f,83).elevation,83);
 c.aimSetFrom({name:'渋谷スカイ',latitude:35.65838,longitude:139.70222});f=c.aimFromPoint();assert.equal(c.aimObserverAt(f,19).eyeM,230.5);
});

test('空欄と範囲外は表示を有効値へ戻し、計算に残る値と食い違わない',()=>{
 const c=boot({});c.aimSetFrom({name:'渋谷スカイ',latitude:35.65838,longitude:139.70222});c.aimRenderObserverHeight(c.aimFromPoint(),19);
 const g=c.$('aimGroundHeight'),h=c.$('aimStandHeight'),error=c.$('aimObserverHeightError');
 assert.equal(g.value,'19');assert.equal(h.value,'230.5');assert.match(c.$('aimObserverHeightHint').textContent,/観測標高 249.5m/);
 h.value='701';h.valueAsNumber=701;h.checkValidity=()=>false;h.onchange();assert.equal(h.value,'230.5');assert.equal(error.hidden,false);assert.equal(c.aimFromPoint().standAglM,null);
 h.value='240.5';h.valueAsNumber=240.5;h.checkValidity=()=>true;h.onchange();assert.equal(c.aimFromPoint().standAglM,240.5);
 c.aimRenderObserverHeight(c.aimFromPoint(),19);assert.equal(h.value,'240.5');h.value='';h.onchange();assert.equal(h.value,'240.5');assert.equal(c.aimFromPoint().standAglM,240.5);
 g.value='9001';g.valueAsNumber=9001;g.checkValidity=()=>false;g.onchange();assert.equal(g.value,'19');assert.equal(c.aimFromPoint().groundManualM,null);
});


test('未設定のその他目標でも観測地点の標高を取得して表示する',async()=>{
 const nodes=new Map(),calls=[];const from={name:'公園',latitude:35,longitude:139};
 const c=vm.createContext({aim:{fromSeq:0,target:{parts:[]},body:'moon'},aimFromPoint:()=>from,
 $:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id)},renderPointCard(){},
 aimRenderObserverHeight:(f,g)=>calls.push(g),aimUpdateLook(){},esc:s=>s,setTimeout,
 aimElevation:async()=>83,aimObserverAt:()=>({elevation:83,eyeM:0})});
 const start=html.indexOf('async function aimRenderFrom()'),stop=html.indexOf('  // 候補帯',start);
 vm.runInContext(html.slice(start,stop)+'}',c);await c.aimRenderFrom();
 assert.deepEqual(calls,[null,83]);assert.equal(c.$('aimLook').hidden,true);assert.equal(c.$('aimFrom').innerHTML,'');
});

test('継承観測地点の標高カードは観測標高と同じ座標DEMを使う',()=>{
 const nodes=new Map(),c=vm.createContext({place:{elevation:10},bundle:null,
 $:id=>{if(!nodes.has(id))nodes.set(id,{});return nodes.get(id)},renderFavStar(){}});
 const a=html.indexOf('function renderPointCard('),b=html.indexOf('function renderFavStar(',a);
 vm.runInContext(html.slice(a,b),c);const f={name:'東京',subtitle:'東京都',inherited:true};
 c.renderPointCard('aimFrom',f,3.4);assert.match(c.$('aimFromSub').textContent,/標高 3.4m/);
 c.renderPointCard('aimFrom',f);assert.doesNotMatch(c.$('aimFromSub').textContent,/標高/);
 c.renderPointCard('issFrom',f,3.4);assert.match(c.$('issFromSub').textContent,/標高 10m/);
});
