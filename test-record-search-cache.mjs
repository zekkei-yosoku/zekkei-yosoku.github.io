import test from 'node:test';
import assert from 'node:assert/strict';
import {createRecordSearchCache} from './tools/record-search-cache.mjs';
const result=(at=1)=>({rows:[{event:{at}}],failed:0});
const alive=()=>true;
test('completed positive and empty results reuse exact keys without sharing mutable rows',async()=>{
 const c=createRecordSearchCache(),solve=async()=>result();
 const a=await c.read('day1',solve,alive);a.rows[0].event.at=99;
 assert.deepEqual(await c.read('day1',solve,alive),result());
 assert.deepEqual(await c.read('day2',async()=>({rows:[],failed:0}),alive),{rows:[],failed:0});
 assert.deepEqual(await c.read('day2',()=>{throw Error('should reuse complete empty');},alive),{rows:[],failed:0});
 assert.deepEqual(c.stats,{hits:2,solves:2,joins:0});
});
test('overlapping callers share work, and a cancelled caller cannot receive it',async()=>{
 const c=createRecordSearchCache();let release,open=true,live;
 const a=c.read('day',l=>{live=l;return new Promise(r=>release=r);},()=>open);
 const b=c.read('day',()=>{throw Error('must join');},alive);
 await Promise.resolve();open=false;assert(live());release(result());
 assert.equal((await a).cancelled,true);assert.deepEqual(await b,result());assert.equal(c.stats.solves,1);
});
test('failed, cancelled and rejected work can be retried',async()=>{
 const c=createRecordSearchCache({limit:1});let keep=true,release;
 const old=c.read('cancelled',()=>new Promise(r=>release=r),()=>keep);
 await Promise.resolve();keep=false;release(result());assert.equal((await old).cancelled,true);
 assert.deepEqual(await c.read('cancelled',()=>result(2),alive),result(2));
 await c.read('partial',()=>({rows:[{event:{at:3}}],failed:1}),alive);
 await assert.rejects(c.read('partial',()=>{throw Error('network');},alive),/network/);
 assert.deepEqual(await c.read('partial',()=>result(4),alive),result(4));
 assert.deepEqual(await c.read('cancelled',()=>result(5),alive),result(5),'LRU cap evicts prior success');
});
test('returning starts the interrupted pair without waiting for an obsolete solver', {timeout:1000},async()=>{
 const c=createRecordSearchCache();let keep=true,release;
 const old=c.read('day',()=>new Promise(r=>release=r),()=>keep);
 await Promise.resolve();keep=false;
 assert.deepEqual(await c.read('day',()=>result(2),alive),result(2));
 release(result(9));assert.equal((await old).cancelled,true);
 assert.deepEqual(await c.read('day',()=>{throw Error('must reuse the new result');},alive),result(2));
});
