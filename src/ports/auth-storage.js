(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesAuthStorage=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function create({session,local,boxStorage,key}){
function save(a, remember) {
  const payload = JSON.stringify(a);
  try { session().setItem(key, payload); } catch { /* 使えなくても動く */ }
  try {
    if (remember) local().setItem(key, payload);
    else local().removeItem(key);
  } catch { /* 同上 */ }
}
function read() {
  for (const box of ["localStorage", "sessionStorage"]) {
    try {
      const raw = boxStorage(box).getItem(key);
      if (!raw) continue;
      const a = JSON.parse(raw);
      if (a && typeof a.token === "string" && typeof a.loginId === "string") {
        return { auth: a, remembered: box === "localStorage" };
      }
    } catch { /* 壊れていたら次を見る */ }
  }
  return null;
}
function clear(){try{session().removeItem(key);}catch{}try{local().removeItem(key);}catch{}}
return {save,read,clear};
}
return {create};
});
