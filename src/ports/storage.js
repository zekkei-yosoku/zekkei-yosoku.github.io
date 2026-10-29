(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesStorage=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function create(storage){
 let onWrite=null;
 function get(key,fallback){try{const v=storage().getItem(key);return v?JSON.parse(v):fallback;}catch{return fallback;}}
 function set(key,value){try{storage().setItem(key,JSON.stringify(value));}catch{return false;}if(onWrite)onWrite(key,value);return true;}
 return {get,set,setWriteHook(fn){onWrite=fn;}};
}
return {create};
});
