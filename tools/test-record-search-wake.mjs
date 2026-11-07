import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const runtime=readFileSync(new URL('./record-search-runtime.js',import.meta.url),'utf8');
const scheduler=runtime.slice(runtime.indexOf('const recordSearchFrame='),runtime.indexOf('const recordSearchScope='));
function fixture(){
 let now=0,nextTimer=0,channel;
 const timers=new Map(),messages=[],documentListeners=new Map(),windowListeners=new Map();
 const listen=(map,type,fn)=>{const list=map.get(type)||[];list.push(fn);map.set(type,list);};
 const document={hidden:false,addEventListener:(type,fn)=>listen(documentListeners,type,fn)};
 const context=vm.createContext({document,performance:{now:()=>now},addEventListener:(type,fn)=>listen(windowListeners,type,fn),
  setTimeout:(fn,ms)=>{const id=++nextTimer;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id),
  MessageChannel:class{constructor(){channel=this;this.port1={};this.port2={postMessage:id=>messages.push(id)};}}
 });
 vm.runInContext(scheduler+'\nglobalThis.yieldTask=recordSearchYield;',context);
 return {yieldTask:context.yieldTask,document,timers,messages,now:value=>{now=value;},deliver:id=>channel.port1.onmessage({data:id}),
  emit:type=>{for(const fn of (type==='visibilitychange'?documentListeners:windowListeners).get(type)||[])fn();},
  fire:id=>{const task=timers.get(id);assert(task,'timer exists');timers.delete(id);task.fn();}
 };
}
const observe=p=>{const state={settled:false};p.then(()=>{state.settled=true;});return state;};

test('normal messages coalesce callers, clear the fallback and reset the work budget',async()=>{
 const f=fixture();await f.yieldTask();f.now(7);await f.yieldTask();assert.equal(f.messages.length,0);
 f.now(8);const a=f.yieldTask(),b=f.yieldTask();assert.equal(a,b);assert.equal(f.messages.length,1);assert.equal(f.timers.size,1);
 assert.equal([...f.timers.values()][0].ms,50);
 f.deliver(f.messages[0]);await a;assert.equal(f.timers.size,0);
 f.now(15);await f.yieldTask();assert.equal(f.messages.length,1);
 f.now(16);const next=f.yieldTask();assert.equal(f.messages.length,2);f.deliver(f.messages[1]);await next;
});

test('a lost MessageChannel notification resolves through the bounded fallback',async()=>{
 const f=fixture();f.now(8);const pending=f.yieldTask(),state=observe(pending);await Promise.resolve();assert.equal(state.settled,false);
 const id=[...f.timers.keys()][0];f.now(58);f.fire(id);await pending;assert.equal(state.settled,true);assert.equal(f.timers.size,0);
 // The late channel event may arrive after the fallback already completed.
 f.deliver(f.messages[0]);await f.yieldTask();assert.equal(f.messages.length,1);
});

test('visibility, focus and pageshow wake a foreground wait without waking hidden work',async()=>{
 for(const type of ['visibilitychange','focus','pageshow']){
  const f=fixture();f.now(8);const pending=f.yieldTask(),state=observe(pending);
  f.document.hidden=true;f.emit(type);await Promise.resolve();assert.equal(state.settled,false,type+' while hidden');
  f.document.hidden=false;f.emit(type);await pending;assert.equal(state.settled,true,type+' on foreground');assert.equal(f.timers.size,0);
  f.emit(type);f.emit(type);assert.equal(f.timers.size,0,'repeated resume is harmless');
 }
});

test('late messages and timer callbacks from an older ticket cannot release a new wait',async()=>{
 const f=fixture();f.now(8);const old=f.yieldTask(),oldTicket=f.messages[0],oldTimer=[...f.timers.values()][0].fn;
 f.emit('pageshow');await old;
 f.now(16);const pending=f.yieldTask(),state=observe(pending),newTicket=f.messages[1];assert.notEqual(newTicket,oldTicket);
 f.deliver(oldTicket);oldTimer();await Promise.resolve();assert.equal(state.settled,false);assert.equal(f.timers.size,1);
 assert.equal(f.yieldTask(),pending,'new callers still join the current wait');
 f.deliver(newTicket);await pending;assert.equal(state.settled,true);assert.equal(f.timers.size,0);
});
