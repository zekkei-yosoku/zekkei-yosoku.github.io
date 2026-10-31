import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {createRequire} from 'node:module';
import {sourceDeclaration as decl} from './tools/test-source.mjs';
const require=createRequire(import.meta.url),Align=require('./astronotes-align.js');
const run=(names,context)=>{vm.createContext(context);vm.runInContext(names.map(decl).join('\n'),context);return context;};
const el=()=>({textContent:'',disabled:false,hidden:false});
test('saveFavorites writes the list to storage and reports failure on screen',()=>{
 const writes=[],errs=[{hidden:false}];const c=run(['saveFavorites'],{favorites:[{id:'a'}],store:{set:(k,v)=>{writes.push([k,v]);return c.ok;}},document:{querySelectorAll:()=>errs},ok:true});
 assert.equal(c.saveFavorites(),true);assert.deepEqual(JSON.parse(JSON.stringify(writes)),[['sorami.favorites',[{id:'a'}]]]);assert.equal(errs[0].hidden,true);
 c.ok=false;assert.equal(c.saveFavorites(),false);assert.equal(errs[0].hidden,false);
});
test('targetCategoryOf reads the favorite category, then the built-in target kind',()=>{
 const c=run(['targetCategoryOf'],{favorites:[{id:'f',targetCategory:'橋'}],AstroNotesAlign:Align});
 assert.equal(c.targetCategoryOf({favId:'f'}),'橋');assert.equal(c.targetCategoryOf({favId:'gone'}),'');assert.equal(c.targetCategoryOf({id:'fuji'}),'山');assert.equal(c.targetCategoryOf({id:'skytree'}),'建物');assert.equal(c.targetCategoryOf({id:'no-such'}),'');
});
test('issPickFindVisible releases its button when there is nothing to search',async()=>{
 const button=el();const c=run(['issPickFindVisible'],{issPick:{visSeq:0,list:[]},issFromPoint:()=>null,issLoadSat:async()=>null,$:()=>button});
 const running=c.issPickFindVisible();assert.equal(button.disabled,true);await running;assert.equal(button.disabled,false);
});
test('issPickFindVisible says so when the calculation parts cannot load',async()=>{
 const nodes={issPickVisible:el(),issPickInfo:el()};const c=run(['issPickFindVisible'],{issPick:{visSeq:0,list:[{}]},issFromPoint:()=>({}),issLoadSat:async()=>{throw Error('x');},$:id=>nodes[id]});
 await c.issPickFindVisible();assert.match(nodes.issPickInfo.textContent,/読めませんでした/);assert.equal(nodes.issPickVisible.disabled,false);
});
test('aimLineSheetPick asks for a tap on the line when the tap misses',async()=>{
 const note=el();const c=run(['aimLineSheetPick'],{aimLineSheetCache:{runs:[{}]},aimLineNearest:()=>null,aimLineSheetSeq:0,$:()=>note});
 await c.aimLineSheetPick({},{x:1,y:2});assert.equal(note.textContent,'線の上をタップしてください');
 note.textContent='';await c.aimLineSheetPick({},null);assert.equal(note.textContent,'');
});
test('renderMoonTimes stays empty without an observer and shows times with one',()=>{
 const S=require('./astronotes-core.js');
 const none=run(['renderMoonTimes'],{AstroNotesAstro:{},AstroNotesMoon:{},moonObs:null,moonHorizon:null,S});assert.equal(none.renderMoonTimes(0),'');
 const day=Date.parse('2026-10-10T00:00:00+09:00'),at=day+3600000;
 const events={terrain:[{kind:'rise',event:'firstLimb',at}],astronomical:[{kind:'rise',at}]};let requested=null;
 const c=run(['renderMoonTimes'],{AstroNotesAstro:{moonEvents:()=>events},AstroNotesMoon:{},moonObs:{},moonHorizon:null,S,moonVisibility:new Map(),requestMoonDetails:d=>requested=d,esc:String,place:{},AstroNotesTerrain:{locationScope:()=>'point'}});
 const html=c.renderMoonTimes(day);assert.match(html,/id="moonTimes"/);assert.match(html,/この場所では/);assert.match(html,/月の出/);assert.equal(requested,day);
});
test('clearFavMapReturn ends the return-to-form state',()=>{
 const c={};vm.createContext(c);vm.runInContext(decl('favMapReturn')+'\n'+decl('clearFavMapReturn')+'\nfavMapReturn=true;clearFavMapReturn();globalThis.after=favMapReturn;',c);assert.equal(c.after,false);
});
test('resetAimAirLoad invalidates the loading weather request',()=>{
 const c={};vm.createContext(c);vm.runInContext(decl('aimAirLoadKey')+'\n'+decl('resetAimAirLoad')+'\naimAirLoadKey="key";resetAimAirLoad();globalThis.after=[aimAirSeq,aimAirLoadKey];',c);assert.deepEqual([...c.after],[1,'']);
});
const owned=(names,script)=>{const c={};vm.createContext(c);vm.runInContext(names.map(decl).join('\n')+'\n'+script,c);return c.after;};
test('state owner functions write their own variable',()=>{
 assert.equal(owned(['aimCustomRequest','nextAimCustomRequest'],'const a=nextAimCustomRequest();globalThis.after=[a,aimCustomRequest].join();'),'1,1');
 assert.equal(owned(['setAlmanacDay'],'let almanacDay=0;setAlmanacDay(5);globalThis.after=almanacDay;'),5);
 assert.equal(owned(['setExtrasLoadedSeq'],'let extrasLoadedSeq=-1;setExtrasLoadedSeq(7);globalThis.after=extrasLoadedSeq;'),7);
 assert.equal(owned(['SkyMapUI','setSkyMapUI'],'setSkyMapUI("ui");globalThis.after=SkyMapUI;'),'ui');
 assert.equal(owned(['aimAirLoadKey','clearAimAirCompare'],'aimAirCompare="x";clearAimAirCompare();globalThis.after=aimAirCompare;'),null);
});
