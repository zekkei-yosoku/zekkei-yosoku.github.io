import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const a=html.indexOf('function aimSavedFrom('),b=html.indexOf('// 月の中の各日',a),src=html.slice(a,b);
function boot(mem){const inherited={name:'現在地',latitude:35,longitude:139};const c=vm.createContext({aim:{},store:{get:(k,d)=>mem[k]??d,set:(k,v)=>mem[k]=JSON.parse(JSON.stringify(v))},inheritedPoint:()=>inherited,aimRenderFrom(){},AimMap:{open(){},zoom:()=>11,redraw(){}}});vm.runInContext(src,c);return c;}
test('選択地点は更新後も復元し、継承の現在地では上書きしない',()=>{const mem={},c=boot(mem);assert.equal(c.aimFromPoint().name,'現在地');c.aimSetFrom({name:'鷺沼北公園',latitude:35.58386,longitude:139.56853});const re=boot(mem);assert.equal(re.aimFromPoint().name,'鷺沼北公園');assert.equal(re.aimFromPoint().latitude,35.58386);});
test('壊れた保存座標は継承地点へ戻し、明示的解除のnullも復元',()=>{for(const p of [null,{latitude:91,longitude:139},{latitude:35,longitude:181},{latitude:'35',longitude:139}])assert.equal(boot({'sorami.aimFrom':p}).aimFromPoint().name,'現在地');});
