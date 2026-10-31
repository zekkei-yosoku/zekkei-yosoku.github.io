import {sourceUnit} from './tools/test-source.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';

const source=sourceUnit('src/startup/preferences.js');
const begin=source.indexOf(' const openStartup = async()=>{');
const end=source.indexOf(" document.addEventListener('visibilitychange'",begin);
assert(begin>=0&&end>begin);

function setup(){
 let ready,fail,next=0;
 const frames=new Map(),listeners=new Set(),routes=[];
 const status={hidden:false,textContent:'Existing forecast feedback'},message={textContent:''};
 const forecast={addEventListener(type,fn,capture){assert.equal(type,'click');assert.equal(capture,true);listeners.add(fn);},removeEventListener(type,fn,capture){assert.equal(capture,true);listeners.delete(fn);}};
 const location={hash:'',search:''};
 const context={location,initialHash:'',initialSearch:'',startupInteracted:false,
  get:()=> 'map',permitted:()=>true,update(){},
  $:id=>id==='toolsHome'?forecast:id==='startupMessage'?message:status,
  history:{state:null,replaceState(_state,_unused,hash){location.hash=hash;}},
  applyRoute(){routes.push(location.hash);},
  startupSessionReady:new Promise((resolve,reject)=>{ready=resolve;fail=reject;}),
  requestAnimationFrame(fn){frames.set(++next,fn);return next;},
  cancelAnimationFrame(id){frames.delete(id);}
 };
 vm.createContext(context);
 vm.runInContext(source.slice(begin,end)+';globalThis.start=openStartup;',context);
 return {context,location,status,message,frames,listeners,routes,ready,fail,start:context.start,
  frame(){for(const [id,fn]of [...frames]){frames.delete(id);fn();}},
  chooseForecast(){for(const fn of [...listeners])fn();}
 };
}

test('launch waits for access, preserves forecast feedback, and releases its frame/listener on success',async()=>{
 const s=setup(),pending=s.start();
 assert.equal(s.frames.size,1);assert.equal(s.listeners.size,1);
 assert.match(s.message.textContent,/ログイン状態/);
 assert.equal(s.status.textContent,'Existing forecast feedback');assert.equal(s.status.hidden,false);
 s.frame();assert.equal(s.frames.size,1);assert.equal(s.routes.length,0);
 s.ready();await pending;
 assert.equal(s.location.hash,'#/skymap');assert.deepEqual(s.routes,['#/skymap']);
 assert.equal(s.frames.size,0);assert.equal(s.listeners.size,0);
});

test('a manual route is shown before old access completes, and the late response cannot reapply the launch preset',async()=>{
 const s=setup(),pending=s.start();s.context.startupInteracted=true;s.location.hash='#/almanac';
 s.frame();await pending;
 assert.deepEqual(s.routes,['#/almanac']);assert.equal(s.frames.size,0);assert.equal(s.listeners.size,0);
 s.ready();await Promise.resolve();s.frame();
 assert.equal(s.location.hash,'#/almanac');assert.equal(s.routes.length,1);
});

test('explicit forecast selection is navigation even when the initial hash is already empty',async()=>{
 const s=setup(),pending=s.start();s.chooseForecast();s.frame();await pending;
 assert.equal(s.location.hash,'');assert.deepEqual(s.routes,['']);
 assert.equal(s.frames.size,0);assert.equal(s.listeners.size,0);
 s.ready();await Promise.resolve();assert.equal(s.routes.length,1);
});

test('menu interaction without a destination does not bypass the access wait',async()=>{
 const s=setup(),pending=s.start();s.context.startupInteracted=true;s.frame();
 assert.equal(s.routes.length,0);assert.equal(s.frames.size,1);assert.equal(s.listeners.size,1);
 s.ready();await pending;
 assert.equal(s.location.hash,'');assert.equal(s.frames.size,0);assert.equal(s.listeners.size,0);
});

test('an unexpected rejected readiness promise stays rejected, cleans up and never opens the protected preset',async()=>{
 const s=setup(),pending=s.start(),error=new Error('synthetic access failure');
 s.fail(error);await assert.rejects(pending,e=>e===error);
 assert.equal(s.routes.length,0);assert.equal(s.location.hash,'');
 assert.equal(s.frames.size,0);assert.equal(s.listeners.size,0);
});
