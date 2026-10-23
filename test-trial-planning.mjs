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
test('建物全体は部位selectだけ、山の全体はボタンだけにして操作を重複させない',()=>{
 const js=readFileSync(new URL('./trial/astronotes-myplaces.js',import.meta.url),'utf8'),code=js.slice(js.indexOf("  const alignment=document.createElement('div');"),js.indexOf("  const status=document.createElement('p');",js.indexOf("  const alignment=document.createElement('div');")));
 function render(mountain){
  const calls=[],host={replaceChildren(n){this.child=n;}},element=tag=>({tag,children:[],attrs:{},append(...n){this.children.push(...n);},replaceChildren(...n){this.children=n;},setAttribute(k,v){this.attrs[k]=v;}});
  const t={parts:[{id:'tip',name:'先端',m:634}],groundM:0},s={body:'sun',partId:mountain?null:'__whole',limb:'center',matchMode:'overlap'};
  const c=vm.createContext({document:{createElement:element},t,s,aimIsMountain:()=>mountain,AstroNotesBodies:{definition:()=>({limbs:true})},AstroNotesAlign:{LIMBS:[{id:'center',name:'真ん中',sign:0}]},SkyMapUI:{setAlignment:(...a)=>calls.push(a)},Option:function(text,value){return {tag:'option',text,value};},esc:x=>x,aimLimbSay:()=>'',aimLimbFigure:()=>'',el:()=>host});vm.runInContext(code,c);return {nodes:host.child.children,calls};
 }
 const building=render(false);assert.equal(building.nodes.filter(x=>x.textContent==='全体に重なる').length,0);const select=building.nodes.find(x=>x.tag==='select');assert.equal(select.children.filter(x=>x.value==='__whole').length,1);select.value='tip';select.onchange();assert.deepEqual(building.calls[0],['tip','center','limb']);
 const mountain=render(true),broad=mountain.nodes.filter(x=>x.textContent==='全体に重なる');assert.equal(broad.length,1);assert.equal(mountain.nodes.find(x=>x.tag==='select').hidden,true);broad[0].onclick();assert.deepEqual(mountain.calls[0],[null,'center','overlap']);
});
