(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesHttpClient=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function create({base,fetch,getAuth,getGeneration,onUnauthorized}){
return async function apiCall(method, path, body, signal) {
  const requestToken = getAuth()?.token, requestGeneration = getGeneration();
  const headers = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (getAuth()) headers.authorization = `Bearer ${getAuth().token}`;
  // 電波が切れたときの英語の失敗文（Failed to fetch / Load failed）を画面に出さない（2026-10-21 総点検）
  let res;
  try {
    res = await fetch(base + path, { method, headers, signal,
      body: body === undefined ? undefined : JSON.stringify(body) });
  } catch (e) {
    if (e?.name === "AbortError") throw e;
    const error = new Error("通信できませんでした。電波の状態を確かめて、もう一度お試しください"); error.network = true; throw error;
  }
  let data = null;
  try { data = await res.json(); } catch { /* 本文が無いこともある */ }
  if (!res.ok) {
    // 401 はセッション切れ。**データは消さない。** 入り直せば続きから使える。
    if (res.status === 401 && data?.code !== "reauth_required" && getAuth()?.token === requestToken && getGeneration() === requestGeneration) { onUnauthorized(); }
    const error = new Error(data?.error || `通信できませんでした（${res.status}）`);
    // 状態も渡す。権限が無い（403）ときに「再試行」を出さないための判定に使う（2026-10-15）
    error.code = data?.code; error.status = res.status; throw error;
  }
  if (getGeneration() !== requestGeneration || getAuth()?.token !== requestToken) throw new Error("アカウントが変更されました。操作をやり直してください");
  return data;
};
}
return {create};
});
