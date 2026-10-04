import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const a=html.indexOf('function aimSavedFrom('),b=html.indexOf('// 月の中の各日',a),src=html.slice(a,b);
function boot(mem){const inherited={name:'現在地',latitude:35,longitude:139};const c=vm.createContext({SoramiTerrain:{decksFor:n=>n==='渋谷スカイ'?[{name:'展望台',aglM:229}]:null},aim:{},store:{get:(k,d)=>mem[k]??d,set:(k,v)=>mem[k]=JSON.parse(JSON.stringify(v))},inheritedPoint:()=>inherited,aimRenderFrom(){},AimMap:{open(){},zoom:()=>11,redraw(){}}});vm.runInContext(src,c);return c;}
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
 assert.equal(boot({'sorami.aimFrom':{...p,name:'公園',eyeHeightAGL:Infinity,decks:[{aglM:-5}]}}).aimFromPoint().eyeHeightAGL,1.5);
});

test('地点選択の共通経路も展望台データを保ってねらうへ渡す',()=>{
 let selected;const picker={set:p=>selected=p};
 const c=vm.createContext({placeSheetFor:'aim',PLACE_PICKERS:{aim:picker},$(){return {close(){}}},aimAreaOf:()=>'',selectPlace(){throw Error('別の経路へ渡してはいけない')}});
 const start=html.indexOf('function choosePlace('),end=html.indexOf('/// 地点の画面を道具',start);
 vm.runInContext(html.slice(start,end),c);
 c.choosePlace({name:'渋谷スカイ',latitude:35.65838,longitude:139.70222,elevation:19,decks:[{name:'展望台',aglM:229}],eyeHeightAGL:229});
 assert.equal(selected.eyeHeightAGL,229);assert.equal(selected.decks[0].aglM,229);assert.equal(selected.elevation,19);
});
