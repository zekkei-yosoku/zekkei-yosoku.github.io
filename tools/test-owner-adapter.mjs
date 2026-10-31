// Test harness only. Existing VM tests stub the app's former shared names; map the current owners onto those stubs so
// the assertions stay unchanged. Never imported by the app.
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
const VIEW={skyMap:'atSkyMap',aim:'atAim',plane:'atPlane',iss:'atIss',answers:'atAnswers',almanac:'atAlmanac',records:'atRecords',admin:'atAdmin'};
const {createContext,isContext,runInContext,runInNewContext}=vm;
const read=(ctx,n)=>runInContext(`typeof ${n}==='undefined'?undefined:${n}`,ctx);
const write=(ctx,n,v)=>{ctx.__ownerValue=v;try{runInContext(`${n}=globalThis.__ownerValue`,ctx);}finally{delete ctx.__ownerValue;}};
const call=(ctx,n,args)=>{const f=read(ctx,n);if(typeof f!=='function')throw new ReferenceError(n+' is not defined');return f(...args);};
const define=(ctx,name,value)=>{if(!Object.prototype.hasOwnProperty.call(ctx,name))Object.defineProperty(ctx,name,{value,configurable:true,writable:true,enumerable:false});};
function adapt(ctx){
 const viewState={};for(const [key,name] of Object.entries(VIEW))Object.defineProperty(viewState,key,{enumerable:true,get:()=>read(ctx,name),set:v=>write(ctx,name,v)});
 define(ctx,'viewState',viewState);
 define(ctx,'accessState',{get generation(){return read(ctx,'authGeneration');},set generation(v){write(ctx,'authGeneration',v);}});
 define(ctx,'apiTransport',(...a)=>call(ctx,'apiCall',a));
 define(ctx,'authStorage',{save:(...a)=>call(ctx,'saveAuth',a),read:(...a)=>call(ctx,'storedAuth',a),clear:(...a)=>call(ctx,'clearStoredAuth',a)});
 define(ctx,'navigationHistory',{pushRoute:(...a)=>call(ctx,'pushRoute',a),goBack:(...a)=>call(ctx,'goBack',a),goList:(...a)=>call(ctx,'goList',a),settleListAfterBack:(...a)=>call(ctx,'settleListAfterBack',a),get noHistory(){return read(ctx,'NO_HISTORY');},get appTrail(){return read(ctx,'appTrail');}});
 define(ctx,'accountSync',()=>({queuePush:(...a)=>call(ctx,'queuePush',a),syncNow:(...a)=>call(ctx,'syncNow',a),applyIncoming:(...a)=>call(ctx,'applyIncoming',a)}));
 const appearance=createContext({});runInContext(readFileSync(new URL('../src/domain/scene/appearance.js',import.meta.url),'utf8'),appearance);
 const real=appearance.AstroNotesSceneAppearance;
 const fallback=n=>(...x)=>{const f=read(ctx,n);return typeof f==='function'?f(...x):real[n](...x);};
 define(ctx,'AstroNotesSceneAppearance',{aimLookSky:fallback('aimLookSky'),aimLimbDir:fallback('aimLimbDir'),aimLookDisc:fallback('aimLookDisc'),get AIM_LOOK_SKY(){return read(ctx,'AIM_LOOK_SKY')??real.AIM_LOOK_SKY;}});
 return ctx;
}
vm.createContext=(ctx={},...rest)=>{const c=createContext(ctx,...rest);return adapt(c);};
vm.runInNewContext=(code,ctx={},...rest)=>{const c=isContext(ctx)?ctx:vm.createContext(ctx);return runInContext(code,c,...rest);};
syncBuiltinESMExports();
void runInNewContext;
