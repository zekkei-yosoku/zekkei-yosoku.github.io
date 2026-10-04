import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const a=html.indexOf('function aimSavedFrom('),b=html.indexOf('// 月の中の各日',a),src=html.slice(a,b);
function boot(mem){const inherited={name:'現在地',latitude:35,longitude:139};const nodes=new Map();const c=vm.createContext({SoramiTerrain:{decksFor:n=>n==='渋谷スカイ'?[{name:'展望台',aglM:229}]:null},aim:{},store:{get:(k,d)=>mem[k]??d,set:(k,v)=>mem[k]=JSON.parse(JSON.stringify(v))},inheritedPoint:()=>inherited,aimRenderFrom(){},$:id=>{if(!nodes.has(id))nodes.set(id,{dataset:{},value:"",checkValidity:()=>true});return nodes.get(id)},AimMap:{open(){},zoom:()=>11,redraw(){}}});vm.runInContext(src,c);return c;}
test('選択地点は更新後も復元し、継承の現在地では上書きしない',()=>{const mem={},c=boot(mem);assert.equal(c.aimFromPoint().name,'現在地');c.aimSetFrom({name:'鷺沼北公園',latitude:35.58386,longitude:139.56853});const re=boot(mem);assert.equal(re.aimFromPoint().name,'鷺沼北公園');assert.equal(re.aimFromPoint().latitude,35.58386);});
test('壊れた保存座標は継承地点へ戻し、明示的解除のnullも復元',()=>{for(const p of [null,{latitude:91,longitude:139},{latitude:35,longitude:181},{latitude:'35',longitude:139}])assert.equal(boot({'sorami.aimFrom':p}).aimFromPoint().name,'現在地');});

test('展望台の高さを選択・保存・復元し、地盤標高と分離する',()=>{
 const mem={},c=boot(mem);c.aimSetFrom({name:'渋谷スカイ',latitude:35.65838,longitude:139.70222,decks:[{name:'展望台',aglM:229}],eyeHeightAGL:229});
 const re=boot(mem),f=re.aimFromPoint(),o=re.aimObserverAt(f,19);
 assert.equal(f.eyeHeightAGL,229);assert.equal(f.decks[0].aglM,229);assert.equal(o.elevation,19);assert.equal(o.eyeM,229);
});
test('旧保存地点の既知展望台を補完するが、明示的な地上指定は維持する',()=>{
 const p={name:'渋谷スカイ',latitude:35.65838,longitude:139.70222};
 assert.equal(boot({'sorami.aimFrom':p}).aimFromPoint().eyeHeightAGL,229);
 for(const h of [0,1.5,100])assert.equal(boot({'sorami.aimFrom':{...p,eyeHeightAGL:h}}).aimFromPoint().eyeHeightAGL,h);
 assert.equal(boot({'sorami.aimFrom':{...p,name:'公園',eyeHeightAGL:Infinity,decks:[{aglM:-5}]}}).aimFromPoint().eyeHeightAGL,0);
});

test('地点選択の共通経路も展望台データを保ってねらうへ渡す',()=>{
 let selected;const picker={set:p=>selected=p};
 const c=vm.createContext({placeSheetFor:'aim',PLACE_PICKERS:{aim:picker},$(){return {close(){}}},aimAreaOf:()=>'',selectPlace(){throw Error('別の経路へ渡してはいけない')}});
 const start=html.indexOf('function choosePlace('),end=html.indexOf('/// 地点の画面を道具',start);
 vm.runInContext(html.slice(start,end),c);
 c.choosePlace({name:'渋谷スカイ',latitude:35.65838,longitude:139.70222,elevation:19,decks:[{name:'展望台',aglM:229}],eyeHeightAGL:229});
 assert.equal(selected.eyeHeightAGL,229);assert.equal(selected.decks[0].aglM,229);assert.equal(selected.elevation,19);
});

test('観測標高は海抜の絶対値で保存復元し、自動値へ戻せる',()=>{
 const mem={},c=boot(mem);c.aimSetFrom({name:'渋谷スカイ',latitude:35.65838,longitude:139.70222});
 assert.equal(c.aimSetObserverHeight(250.5),true);
 const re=boot(mem),f=re.aimFromPoint(),o=re.aimObserverAt(f,19);
 assert.equal(f.observationElevationM,250.5);assert.equal(o.elevation+o.eyeM,250.5);assert.equal(o.eyeM,231.5);
 assert.equal(re.aimSetObserverHeight(null),true);assert.equal(re.aimObserverAt(re.aimFromPoint(),19).eyeM,229);
 for(const x of [NaN,Infinity,-501,9001])assert.equal(re.aimSetObserverHeight(x),false);
 assert.equal(re.aimFromPoint().observationElevationM,null);
});
test('公園の自動値は地盤標高、展望台は地盤＋既知高さ',()=>{
 const c=boot({}),park=c.aimSavedFrom({name:'公園',latitude:35,longitude:139});
 const po=c.aimObserverAt(park,83);assert.equal(po.elevation+po.eyeM,83);
 const tower=c.aimSavedFrom({name:'渋谷スカイ',latitude:35,longitude:139});const to=c.aimObserverAt(tower,19);assert.equal(to.elevation+to.eyeM,248);
});

test('別地点を選び直すと前地点の手動標高は引き継がず新地点の自動値になる',()=>{
 const mem={},c=boot(mem);c.aimSetFrom({name:'渋谷スカイ',latitude:35.65838,longitude:139.70222});c.aimSetObserverHeight(250.5);
 c.aimSetFrom({name:'公園',latitude:35.58386,longitude:139.56853});
 let f=c.aimFromPoint();assert.equal(f.observationElevationM,null);assert.equal(c.aimObserverAt(f,83).eyeM,0);
 c.aimSetObserverHeight(84.5);assert.equal(c.aimObserverAt(c.aimFromPoint(),83).eyeM,1.5);
 c.aimSetFrom({name:'渋谷スカイ',latitude:35.65838,longitude:139.70222});f=c.aimFromPoint();assert.equal(f.observationElevationM,null);assert.equal(c.aimObserverAt(f,19).eyeM,229);
});

test('空欄と範囲外は表示を有効値へ戻し、計算に残る値と食い違わない',()=>{
 const c=boot({});c.aimSetFrom({name:'渋谷スカイ',latitude:35.65838,longitude:139.70222});c.aimRenderObserverHeight(c.aimFromPoint(),19);
 const input=c.$('aimObserverHeight'),error=c.$('aimObserverHeightError');
 input.value='9001';input.valueAsNumber=9001;input.checkValidity=()=>false;c.aimCommitObserverHeight();assert.equal(input.value,'248');assert.equal(error.hidden,false);assert.equal(c.aimFromPoint().observationElevationM,null);
 input.value='250.55';input.valueAsNumber=250.55;input.checkValidity=()=>true;c.aimCommitObserverHeight();assert.equal(c.aimFromPoint().observationElevationM,250.55);
 c.aimRenderObserverHeight(c.aimFromPoint(),19);assert.equal(input.value,'250.55');input.value='';c.aimCommitObserverHeight();assert.equal(input.value,'250.55');assert.equal(error.hidden,false);assert.equal(c.aimFromPoint().observationElevationM,250.55);
});
