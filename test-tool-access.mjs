import {sourceHtml} from './tools/test-source.mjs';
import './tools/test-owner-adapter.mjs';
import {readFileSync} from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';
const html=sourceHtml();
const src=html.slice(html.indexOf('function allowedTools()'),html.indexOf('function renderTools()'));
const access=readFileSync(new URL('./astronotes-access.js',import.meta.url),'utf8');
function fixture(auth){const els={};const c={auth,$:id=>els[id]??={hidden:false,textContent:'',toggleAttribute(k,v){this[k]=v;}},plane:{seq:0},iss:{seq:0},photosRequest:0,photos:[],photosCursor:null,photosOwner:null,photosLoading:false,photosError:null,photosRetryAppend:false,renderPhotoListState(){},renderPhotos(){},atAim:false,atPlane:false,atIss:false,atRecords:false,atAnswers:false};vm.createContext(c);vm.runInContext(access,c);vm.runInContext(src,c);return c;}
for(const tools of [[],['plane'],['iss'],['records'],['plane','iss','records']]){
 const c=fixture({token:'fixture',tools});for(const t of ['plane','iss','records']){assert.equal(c.renderToolAccess(t),tools.includes(t));assert.equal(c.$(t+'View')['data-locked'],!tools.includes(t));if(!tools.includes(t)) assert.equal(c.$(t+'AccessLogin').hidden,true);}
 c.auth=null;for(const t of ['plane','iss','records']){assert.equal(c.renderToolAccess(t),false);assert.equal(c.$(t+'AccessLogin').hidden,false);}
}
const c=fixture({tools:['plane']});assert.equal(c.toolAllowed('plane'),false,'tools without authenticated session rejected');
const f=fixture({token:'fixture',tools:['records']});const pending=[];f.apiCall=()=>new Promise((resolve,reject)=>pending.push({resolve,reject}));let displayed=[];f.renderPhotos=()=>displayed.push(f.photos);
vm.runInContext(html.slice(html.indexOf('async function loadPhotos('),html.indexOf('function renderPhotos()')),f);
const old=f.loadPhotos(),fresh=f.loadPhotos();pending[1].resolve({photos:[{id:'fresh'}]});await fresh;pending[0].reject(Error('old error'));await old;assert.equal(f.photos[0].id,'fresh','late old error cannot clear newer photos');
const revoked=f.loadPhotos();f.auth.tools=[];f.refreshRestrictedTools();pending[2].resolve({photos:[{id:'revoked'}]});await revoked;assert.equal(f.photos.length,0,'revoked response is discarded');assert.equal(f.$('recordsView')['data-locked'],true);
for(const [name,id] of [['openPlane','plane'],['openIss','iss'],['planeApply','plane'],['issApply','iss']]){
 const start=html.indexOf('function '+name+'(');assert.match(html.slice(start,start+170),new RegExp('(?:renderToolAccess|toolAllowed)\\("'+id+'"\\)'));
}
console.log('TOOL ACCESS OK: grant matrix, token required, logout, revocation and out-of-order photo responses');
