import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const read=n=>readFileSync(new URL(n,import.meta.url),'utf8'),js=read('trial/astronotes-explore.js'),html=read('trial/index.html');
test('未完成条件の表示用状態は選択済み天体と地点を失わず、完全条件snapshotは別に維持',()=>{
 const start=html.indexOf('selectionState:()=>'),end=html.indexOf(',renderState:',start);assert(start>0&&end>start);
 const c=vm.createContext({session:{body:'sun',target:null,observer:{name:'撮影地'}},AstroNotesShooting:{conditions:()=>null}});vm.runInContext('const api={'+html.slice(start,end)+'};this.read=api.selectionState;',c);
 assert.equal(c.read().body,'sun');assert.equal(c.read().observer.name,'撮影地');assert.equal(c.read().target,null);assert.match(html,/snapshot:\(\)=>session&&AstroNotesShooting.conditions\(session\)/);
});
test('不足条件ボタンは対象→地点へ誘導し、揃った時だけ結果へ進む',()=>{
 let selected={target:null,observer:null},clicked=[],shown=0,focused=0;const conditions={open:true,getBoundingClientRect:()=>({height:50})};
 const c=vm.createContext({layout:{mounted:true,conditions},mode:'scene',SkyMapUI:{selectionState:()=>selected},$:id=>({click:()=>clicked.push(id)}),sceneTab:{focus:()=>focused++},mapTab:{},tabs:{style:{},scrollIntoView:()=>shown++},sync(){}});
 vm.runInContext(js.slice(js.indexOf('function showResult('),js.indexOf('function addSaveAction(')),c);
 c.showResult();assert.deepEqual(clicked,['skyMapTargetOpen']);assert.equal(conditions.open,true);selected={target:{},observer:null};c.showResult();assert.equal(clicked.at(-1),'skyMapChoose');assert.equal(shown,0);selected.observer={};c.showResult();assert.equal(conditions.open,false);assert.equal(shown,1);assert.equal(focused,1);
});
