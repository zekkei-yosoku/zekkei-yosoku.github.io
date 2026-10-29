// Small app control-state owners; domain data and authentication secrets stay outside.
(function(root){
 'use strict';
 function create(scope){
  const values=new Map();
  function get(name){if(!values.has(name))throw Error('Unknown app state: '+name);return values.get(name);}
  function set(name,value){if(!values.has(name))throw Error('Unknown app state: '+name);values.set(name,value);return value;}
  function defineLegacy(name,initial){
   if(values.has(name))throw Error('Duplicate app state: '+name);
   values.set(name,initial);
   Object.defineProperty(scope,name,{configurable:true,get:()=>get(name),set:value=>set(name,value)});
  }
  return {defineLegacy,get,set,snapshot:()=>Object.freeze(Object.fromEntries(values))};
 }
 const api={create};root.AstroNotesStateOwner=api;
 if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
