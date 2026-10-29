import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{create}=require('./src/app/state-owner.js');
test('legacy identifiers and the injected owner use the same value, with no mirror',()=>{
 const scope={},owner=create(scope);owner.defineLegacy('authGeneration',0);const context=vm.createContext(scope);
 vm.runInContext('authGeneration++;authGeneration++;',context);assert.equal(owner.get('authGeneration'),2);
 owner.set('authGeneration',9);assert.equal(vm.runInContext('authGeneration',context),9);assert.equal(scope.authGeneration,9);
 assert.deepEqual(owner.snapshot(),{authGeneration:9});assert(Object.isFrozen(owner.snapshot()));assert.deepEqual(Object.keys(scope),[],'compat bridge is not enumerable');
});
test('view and access owners have separate lifetimes and names',()=>{
 const scope={},view=create(scope),access=create(scope);view.defineLegacy('atSkyMap',false);access.defineLegacy('authGeneration',0);
 scope.atSkyMap=true;scope.authGeneration++;assert.deepEqual(view.snapshot(),{atSkyMap:true});assert.deepEqual(access.snapshot(),{authGeneration:1});
 assert.throws(()=>view.get('authGeneration'),/Unknown/);assert.throws(()=>access.set('atSkyMap',false),/Unknown/);assert.throws(()=>view.defineLegacy('atSkyMap',false),/Duplicate/);
});
test('legacy writes have no subscriber side effects or additional failure boundary',()=>{
 const scope={},owner=create(scope);owner.defineLegacy('authGeneration',0);assert.equal('subscribe' in owner,false);
 assert.equal(owner.set('authGeneration',1),1);scope.authGeneration++;assert.equal(owner.get('authGeneration'),2);
});
