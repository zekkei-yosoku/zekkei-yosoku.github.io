import './tools/test-owner-adapter.mjs';
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
test('trialは旧部位・縁指定も建物と山の全体へ正規化する',()=>{
 const start=html.indexOf(' function normalizeWholeAlignment('),code=html.slice(start,html.indexOf(' function render(){',start));
 for(const mountain of [false,true])for(const mode of ['limb','overlap']){
  const c=vm.createContext({session:{target:{id:mountain?'fuji':'tower'},partId:'tip',limb:'behind',matchMode:mode,at:123},aimIsMountain:t=>t.id==='fuji'});vm.runInContext(code,c);c.normalizeWholeAlignment();
  assert.equal(c.session.matchMode,'overlap');assert.equal(c.session.partId,mountain?null:'__whole');assert.equal(c.session.limb,'center');assert.equal(c.session.at,123);
 }
 assert.match(html.slice(start,html.indexOf(' function setTime(',start)),/function render\(\)\{\s*normalizeWholeAlignment\(\)/);
 assert.match(html.slice(html.indexOf(' async function refresh(){',start)),/normalizeWholeAlignment\(\)/);
 const js=readFileSync(new URL('./trial/astronotes-myplaces.js',import.meta.url),'utf8');
 assert.match(js,/detail.hidden=true;el\('skyMapAlignmentSummary'\)/);assert.doesNotMatch(js,/function mountainAlignment|alignment-dropdown|天体のどこを合わせるか/);
});
