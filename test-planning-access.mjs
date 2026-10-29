// Contract: extract the existing target/body policy without changing grants or short-circuit order.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),A=require('./astronotes-access.js');
const previous=(allow,target,body)=>target!=='fuji'?allow('tower'):body==='sun'?allow('diamond'):body==='moon'?allow('pearl'):allow('tower')&&(allow('diamond')||allow('pearl'));
test('128 grant sets preserve every target/body result and predicate call order',()=>{
 let cases=0;
 for(let mask=0;mask<128;mask++){
  const granted=A.TOOLS.filter((_,i)=>mask&(1<<i));
  for(const target of ['fuji','skytree','custom',undefined])for(const body of ['sun','moon','venus','unknown']){
   const before=[],after=[],expected=previous(t=>{before.push(t);return granted.includes(t);},target,body);
   assert.equal(A.canFrame(granted,target,body),expected);
   assert.equal(A.canFrame(t=>{after.push(t);return granted.includes(t);},target,body),expected);
   assert.deepEqual(after,before);cases++;
  }
 }
 assert.equal(cases,2048);
});
test('missing grants deny without supplying unauthenticated defaults',()=>{
 for(const granted of [null,undefined,{},'tower'])for(const target of ['fuji','skytree'])for(const body of ['sun','moon','venus'])assert.equal(A.canFrame(granted,target,body),false);
});
// Independently execute the actual pre-refactor consumer, so the handwritten
// truth-table reference above cannot silently define a new policy.
test('actual 1cf4068 Explore function agrees for all grants/targets/bodies',async()=>{
 const {execFileSync}=await import('node:child_process');
 const source=execFileSync('git',['show','1cf4068:astronotes-explore.js'],{cwd:new URL('.',import.meta.url),encoding:'utf8',maxBuffer:4<<20});
 const code=source.match(/^function canFrame\(s\)\{[^\n]+\}$/m)?.[0];assert(code);
 for(let mask=0;mask<128;mask++){
  const grants=A.TOOLS.filter((_,i)=>mask&(1<<i)),before=new Function('eligible','toolAllowed',code+';return canFrame;')(()=>true,t=>grants.includes(t));
  for(const target of ['fuji','skytree','custom',undefined])for(const body of ['sun','moon','venus','unknown'])assert.equal(A.canFrame(grants,target,body),before({target:{id:target},body}));
 }
});

test('generated old-access fallback is self-contained and matches the canonical policy',async()=>{
 const vm=await import('node:vm'),{readFileSync}=await import('node:fs');
 const bundle=readFileSync(new URL('./astronotes-explore.js',import.meta.url),'utf8'),end=bundle.indexOf('})(globalThis);\n');assert(end>0);
 const context=vm.createContext({AstroNotesAccess:{}});vm.runInContext(bundle.slice(0,end+'})(globalThis);'.length),context);
 const fallback=context.AstroNotesAccess.canFrame;assert.equal(typeof fallback,'function');
 for(let mask=0;mask<128;mask++){const grants=A.TOOLS.filter((_,i)=>mask&(1<<i));for(const target of ['fuji','skytree','custom',undefined])for(const body of ['sun','moon','venus','unknown'])assert.equal(fallback(grants,target,body),A.canFrame(grants,target,body));}
});
