import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
const source=/<script id="uiVisualPrimitives">([\s\S]*?)<\/script>/.exec(html)[1];
function fixture(kind,value){
 let changes=0,mutations=0;
 const element=()=>({children:[],dataset:{},attrs:{},classList:{add(){}},append(e){this.children.push(e);},setAttribute(k,v){this.attrs[k]=v;mutations++;},getAttribute(k){return this.attrs[k];}});
 const parent=element();parent.querySelector=()=>parent.children[0]||null;
 const values=kind==='orientation'?['landscape','portrait']:['none','thirds','diagonal'];
 const names=kind==='orientation'?['横位置','縦位置']:['なし','9分割','9分割＋対角'];
 const select={value,parentElement:parent,disabled:false,options:values.map((value,i)=>({value,textContent:names[i],hidden:false,disabled:false})),getAttribute:()=>kind==='orientation'?'画角の向き':'構図のグリッド',dispatchEvent(e){assert.equal(e.type,'change');assert.equal(e.bubbles,true);changes++;}};
 const c=vm.createContext({document:{createElement:element},Event:class{constructor(type,opts){this.type=type;Object.assign(this,opts);}}});vm.runInContext(source,c);
 const sync=()=>c.uiVisualChoices(select,kind);sync();return {select,sync,parent,buttons:parent.children[0].children,changes:()=>changes,mutations:()=>mutations};
}
test('図形の選択は元の値とchange経路へ一度だけ渡し、同じ選択で再計算を要求しない',()=>{
 for(const kind of ['orientation','grid']){const f=fixture(kind,kind==='orientation'?'landscape':'none');assert.equal(f.select.hidden,true);assert.equal(f.buttons[0].getAttribute('aria-pressed'),'true');f.buttons[1].onclick();assert.equal(f.select.value,kind==='orientation'?'portrait':'thirds');assert.equal(f.changes(),1);assert.equal(f.buttons[1].getAttribute('aria-pressed'),'true');f.buttons[1].onclick();assert.equal(f.changes(),1);const group=f.parent.children[0],mutations=f.mutations();f.sync();assert.equal(f.parent.children[0],group);assert.equal(f.mutations(),mutations,'時刻描画ごとにDOMを変えず選択と焦点を維持');}
});
test('復元・枠外変更・使用不可の状態が図形の選択へ反映される',()=>{
 const f=fixture('grid','diagonal');assert.equal(f.buttons[2].getAttribute('aria-pressed'),'true');f.select.value='none';f.select.options[1].disabled=true;f.select.options[2].hidden=true;f.sync();assert.equal(f.buttons[0].getAttribute('aria-pressed'),'true');assert.equal(f.buttons[1].disabled,true);assert.equal(f.buttons[2].hidden,true);f.select.disabled=true;f.sync();assert.ok(f.buttons.every(b=>b.disabled));assert.equal(f.changes(),0);
});
test('縦横とグリッドの図は区別でき、操作は読み上げ名を残す',()=>{
 const o=fixture('orientation','landscape'),g=fixture('grid','none');assert.notEqual(o.buttons[0].innerHTML,o.buttons[1].innerHTML);assert.equal(new Set(g.buttons.map(b=>b.innerHTML)).size,3);assert.equal(g.buttons[2].getAttribute('aria-label'),'9分割＋対角');assert.match(html,/id="skyMapObserverTool"[^>]*aria-label="観測地点を地図で変更"/);assert.doesNotMatch(html,/id="skyMapCenter"/);
});
test('現在位置の帯は独立MAP・通常/共有/旧URLの重ねるでも一意に付く',()=>{
 const extract=name=>{const at=html.indexOf('function '+name+'(');return html.slice(at,html.indexOf('\n}',at)+2);};
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{attrs:{},dataset:{},setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];}});return nodes.get(id);};
 const tools=['#/aim/tower','#/plane','#/iss','#/records'].map(path=>{const n=node(path);n.dataset.tool=path;return n;});node('toolsMenu').querySelectorAll=()=>tools;
 const c=vm.createContext({$:node,location:{hash:''},S:{PHENOMENA:{}}});vm.runInContext(extract('routeFromHash')+'\n'+extract('markToolsCurrent'),c);
 for(const [hash,current] of [['','toolsHome'],['#/skymap','skyMapMenu'],['#/aim','#/aim/tower'],['#/aim?plan=example','#/aim/tower'],['#/aim/fuji','#/aim/tower'],['#/aim/pearl','#/aim/tower'],['#/plane','#/plane'],['#/iss','#/iss'],['#/records','#/records']]){c.location.hash=hash;c.markToolsCurrent();assert.equal(node(current).attrs['aria-current'],'page',hash);assert.equal([...nodes.values()].filter(n=>n.attrs['aria-current']==='page').length,1,hash);}
});
test('観測地点を確定した確認表示と復帰表示の後にも三脚の形が残る',async()=>{
 const start=html.indexOf('$("aimPick").onclick = async () => {'),end=html.indexOf('\n    };',start)+7;
 const label={textContent:'ここから重ねる'},button={icon:'tripod',querySelector:()=>label,set textContent(v){this.icon=null;label.textContent=v;}};const timers=[];let point;
 const c=vm.createContext({$:()=>button,AimMap:{center:()=>({latitude:35,longitude:139})},nearName:async()=>({name:'地図で選んだ点',area:'東京'}),aimSetFrom:p=>{point=p;},setTimeout:fn=>timers.push(fn)});vm.runInContext(html.slice(start,end),c);await button.onclick();assert.equal(point.latitude,35);assert.equal(button.icon,'tripod');assert.match(label.textContent,/観測地点にしました/);timers[0]();assert.equal(label.textContent,'ここから重ねる');assert.equal(button.icon,'tripod');
});
