import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {sourceUnit} from './tools/test-source.mjs';
const {parse}=createRequire(import.meta.url)('./tools/module-scan.cjs');
const code=sourceUnit('src/features/explore/controller.js');
function find(n){if(n?.type==='FunctionDeclaration'&&n.id.name==='createObserverGuidePaint')return n;if(!n||typeof n!=='object')return;for(const v of Object.values(n)){if(Array.isArray(v)){for(const child of v){const found=find(child);if(found)return found;}}else{const found=find(v);if(found)return found;}}}
const declaration=find(parse(code,'script'));assert(declaration,'the local presentation gate is part of Explore');
function harness(){
 let id=0;const tasks=new Map(),writes=[];
 const context={setTimeout(fn,delay){assert.equal(delay,0);tasks.set(++id,fn);return id;},clearTimeout(id){tasks.delete(id);}};
 vm.createContext(context);vm.runInContext(code.slice(declaration.start,declaration.end)+';this.gate=createObserverGuidePaint();',context);
 return {gate:context.gate,tasks,writes,paint:value=>()=>writes.push(value),tick(){const batch=[...tasks.values()];tasks.clear();for(const fn of batch)fn();}};
}
test('unpressed guide results paint immediately without retaining a timer',()=>{const h=harness();h.gate.paint(h.paint('ready'));assert.deepEqual(h.writes,['ready']);assert.equal(h.tasks.size,0);});
test('pressed guide transitions coalesce to the latest complete state until the click task ends',()=>{const h=harness();h.gate.hold(1);h.gate.paint(h.paint('clear'));h.gate.paint(h.paint('error'));h.gate.paint(h.paint('success'));assert.deepEqual(h.writes,[]);h.gate.release(1);assert.equal(h.tasks.size,1);assert.deepEqual(h.writes,[]);h.tick();assert.deepEqual(h.writes,['success']);assert.equal(h.tasks.size,0);});
test('a result arriving between pointerup and native click remains deferred',()=>{const h=harness();h.gate.hold(1);h.gate.release(1);h.gate.paint(h.paint('arrived after up'));assert.deepEqual(h.writes,[]);h.tick();assert.deepEqual(h.writes,['arrived after up']);});
test('unrelated pointers cannot release a press and multiple pointers must all finish',()=>{const h=harness();h.gate.hold(1);h.gate.hold(2);h.gate.paint(h.paint('ready'));h.gate.release(3);h.gate.release(1);assert.equal(h.tasks.size,0);h.gate.release(2);h.gate.release(2);assert.equal(h.tasks.size,1);h.tick();assert.deepEqual(h.writes,['ready']);});
test('a new press before the scheduled flush retains the pending latest result',()=>{const h=harness();h.gate.hold(1);h.gate.paint(h.paint('first'));h.gate.release(1);h.gate.hold(2);assert.equal(h.tasks.size,0);h.gate.paint(h.paint('second'));h.tick();assert.deepEqual(h.writes,[]);h.gate.release(2);h.tick();assert.deepEqual(h.writes,['second']);});
test('blur releases stuck pointers once and lets the latest result paint',()=>{const h=harness();h.gate.hold(1);h.gate.hold(2);h.gate.paint(h.paint('ready'));h.gate.releaseAll();h.gate.releaseAll();assert.equal(h.tasks.size,1);h.tick();assert.deepEqual(h.writes,['ready']);});
test('close, hide or route reset discards old work and permits immediate fresh paint',()=>{const h=harness();h.gate.hold(1);h.gate.paint(h.paint('old'));h.gate.release(1);h.gate.reset();assert.equal(h.tasks.size,0);h.gate.release(1);h.tick();h.gate.paint(h.paint('new'));assert.deepEqual(h.writes,['new']);});
test('a deferred result rechecks its owning condition at paint time',()=>{const h=harness();let current=true;h.gate.hold(1);h.gate.paint(()=>{if(current)h.writes.push('stale');});current=false;h.gate.release(1);h.tick();assert.deepEqual(h.writes,[]);});
