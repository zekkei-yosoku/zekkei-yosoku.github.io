import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
const html=readFileSync(new URL('./trial/index.html',import.meta.url),'utf8');
const source=html.slice(html.indexOf('function keepNotebookPlan('),html.indexOf('function initPlanSharing()'));
test('trial予定保存は開いた時のowner/世代/権限を固定し、切替後の保存を拒否する',()=>{
 let writes=0,rendered=0,record;
 const c=vm.createContext({auth:{token:'synthetic',loginId:'a'},authGeneration:1,toolAllowed:()=>true,schedule:()=>({add:r=>{writes++;record=r;return {ok:true};}}),renderNotebook:()=>rendered++});vm.runInContext(source,c);
 const cur={saveOwner:{generation:1,loginId:'a'},payload:{at:123,l:{focal:400}}},event={title:'計画',start:100,end:200};
 assert.equal(c.keepNotebookPlan(cur,event).ok,true);assert.equal(record.value,cur.payload);assert.equal(writes,1);assert.equal(rendered,1);
 for(const change of [()=>c.authGeneration++,()=>c.auth={token:'synthetic-b',loginId:'b'},()=>c.toolAllowed=()=>false,()=>c.auth=null]){c.auth={token:'synthetic',loginId:'a'};c.authGeneration=1;c.toolAllowed=()=>true;change();assert.equal(c.keepNotebookPlan(cur,event).ok,false);assert.equal(writes,1);assert.equal(rendered,1);}
});
test('保存失敗の結果をUIへ返し、成功へ偽装しない',()=>{
 const c=vm.createContext({auth:{token:'synthetic',loginId:'a'},authGeneration:1,toolAllowed:()=>true,schedule:()=>({add:()=>({ok:false})}),renderNotebook(){}});vm.runInContext(source,c);assert.equal(c.keepNotebookPlan({saveOwner:{generation:1,loginId:'a'},payload:{}},{title:'x',start:1,end:2}).ok,false);
});
test('条件要約は建物全体と山頂指定を区別し、高さを維持する',()=>{
 const js=readFileSync(new URL('./trial/astronotes-explore.js',import.meta.url),'utf8'),code=js.slice(js.indexOf('function conditionText('),js.indexOf('function updateConditions('));
 const c=vm.createContext({AstroNotesBodies:{definition:()=>({name:'太陽'})},AstroNotesAlign:{limbById:()=>({name:'下の縁'})},$:()=>({textContent:'高さ：標高40m・地上から80m'})});vm.runInContext(code,c);
 const s={body:'sun',target:{name:'対象',parts:[{id:'tip',name:'先端'}]},observer:{name:'撮影地'},partId:'__whole',matchMode:'limb'};
 assert.match(c.conditionText(s).detail,/建物全体に重なる/);assert.doesNotMatch(c.conditionText(s).detail,/下の縁/);assert.match(c.conditionText(s).detail,/地上から80m/);
 s.partId=null;assert.match(c.conditionText(s).detail,/先端・下の縁/);s.matchMode='overlap';assert.match(c.conditionText(s).detail,/全体に重なる/);
});
function alignmentFixture(mountain=true,state={}){
 const js=readFileSync(new URL('./trial/astronotes-myplaces.js',import.meta.url),'utf8'),helper=js.slice(js.indexOf('function mountainAlignment('),js.indexOf("document.addEventListener('click',e=>{for(const d"));
 const code=js.slice(js.indexOf("  const alignment=document.createElement('div');"),js.indexOf("  const status=document.createElement('p');",js.indexOf("  const alignment=document.createElement('div');")));
 const calls=[],host={replaceChildren(n){this.child=n;},querySelector(){return null;}};
 const element=tag=>({tag,children:[],attrs:{},events:{},open:false,append(...n){this.children.push(...n);},replaceChildren(...n){this.children=n;},setAttribute(k,v){this.attrs[k]=v;},addEventListener(k,f){this.events[k]=f;},focus(){this.focused=true;},contains(){return false;}});
 const t={parts:[{id:'tip',name:'先端',m:634}],groundM:0},s={body:'moon',partId:mountain?null:'__whole',limb:'center',matchMode:'overlap',...state};
 const c=vm.createContext({document:{createElement:element},queueMicrotask:f=>f(),t,s,aimIsMountain:()=>mountain,AstroNotesBodies:{definition:()=>({limbs:true})},AstroNotesAlign:{LIMBS:[{id:'onTop',name:'下の縁',sign:1},{id:'center',name:'真ん中',sign:0},{id:'behind',name:'上の縁',sign:-1}]},SkyMapUI:{setAlignment:(...a)=>calls.push(a)},Option:function(text,value){return {tag:'option',text,value};},esc:x=>x,aimLimbSay:id=>'説明:'+id,aimLimbFigure:(sign,m,id)=>'<svg id="'+id+'">'+sign+'</svg>',el:()=>host});vm.runInContext(helper+'\n'+code,c);return {nodes:host.child.children,calls};
}
test('山は単一dropdown、建物は既存selectに全体を一本化する',()=>{
 const building=alignmentFixture(false);assert.equal(building.nodes.filter(x=>x.tag==='details').length,0);const select=building.nodes.find(x=>x.tag==='select');assert.equal(select.children.filter(x=>x.value==='__whole').length,1);select.value='tip';select.onchange();assert.deepEqual(building.calls[0],['tip','center','limb']);
 const mountain=alignmentFixture(),dropdown=mountain.nodes.find(x=>x.tag==='details');assert.ok(dropdown);assert.equal(dropdown.children[1].children.length,4);assert.equal(mountain.nodes.find(x=>x.tag==='select').hidden,true);assert.equal(mountain.nodes.find(x=>x.className==='aim-limb').hidden,true);
});
test('dropdownの4状態は既存値へ渡り、選択中項目の再選択でトグルしない',()=>{
 const f=alignmentFixture(),menu=f.nodes[0],rows=menu.children[1].children;rows[0].onclick();assert.equal(f.calls.length,0);
 for(let i=1;i<4;i++)rows[i].onclick();assert.deepEqual(f.calls,[[null,'onTop','limb'],[null,'center','limb'],[null,'behind','limb']]);
 const g=alignmentFixture(true,{matchMode:'limb',limb:'behind'}),d=g.nodes[0];assert.match(d.children[0].innerHTML,/上の縁/);assert.match(d.children[0].innerHTML,/<svg/);assert.equal(d.children[1].children[3].attrs['aria-pressed'],'true');d.children[1].children[0].onclick();assert.deepEqual(g.calls[0],[null,'center','overlap']);
});
test('dropdownは矢印で項目へ進み、Escapeで値を変えず閉じる',()=>{
 const f=alignmentFixture(),menu=f.nodes[0],summary=menu.children[0],rows=menu.children[1].children;const event=(key,target)=>({key,target,preventDefault(){},stopPropagation(){}});
 menu.onkeydown(event('ArrowDown',summary));assert.equal(menu.open,true);assert.equal(rows[0].focused,true);menu.onkeydown(event('End',rows[0]));assert.equal(rows[3].focused,true);menu.onkeydown(event('Escape',rows[3]));assert.equal(menu.open,false);assert.equal(summary.focused,true);assert.equal(f.calls.length,0);
});
