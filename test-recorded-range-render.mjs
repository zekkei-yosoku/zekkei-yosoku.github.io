import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {sourceUnit} from './tools/test-source.mjs';
const source=sourceUnit('src/features/explore/controller.js'),renderSource=source.slice(source.indexOf('async function renderRecordRows('),source.indexOf('function stopRecordLoading('));
function fixture(){
 const node=(tag,props={},text)=>({tag,...props,text,children:[],attributes:{},parentNode:null,isConnected:true,
  setAttribute(k,v){this.attributes[k]=v;},append(...nodes){for(const n of nodes){n.parentNode=this;n.isConnected=true;this.children.push(n);}},
  prepend(n){n.parentNode=this;this.children.unshift(n);},replaceChildren(...nodes){for(const n of this.children){n.parentNode=null;n.isConnected=false;}this.children=[];this.append(...nodes);}});
 const pane=node('section'),pending=[],c={recordPane:pane,recordState:{key:'old',status:'complete'},node,active:true,recordCurrent:()=>c.active,
  AstroNotesCandidatePicker:{renderRecorded:()=>new Promise(resolve=>pending.push(resolve))}};
 vm.createContext(c);vm.runInContext(renderSource,c);
 return {c,pane,pending};
}
test('leaving while recorded labels load releases busy state and permits a cached redraw on return',async()=>{
 const {c,pane,pending}=fixture(),render=c.renderRecordRows({key:'old'},{rows:[{}],failed:0});
 assert.equal(pane.attributes['aria-busy'],'true');c.active=false;pending.shift()(1);await render;
 assert.equal(pane.attributes['aria-busy'],'false');assert.equal(c.recordState.key,'');
});
test('late recorded rendering cannot clear a newer request or publish its old rows',async()=>{
 const {c,pane,pending}=fixture(),old=c.renderRecordRows({key:'old'},{rows:[{}],failed:0});
 c.recordState={key:'new',status:'complete'};const next=c.renderRecordRows({key:'new'},{rows:[{}],failed:0});
 pending.shift()(5);await old;assert.equal(pane.attributes['aria-busy'],'true');assert.equal(c.recordState.key,'new');
 pending.shift()(2);await next;assert.equal(pane.attributes['aria-busy'],'false');assert.equal(pane.children[0].text,'撮影候補');assert.equal(pane.children[0].children[0].text,'2件');
});
