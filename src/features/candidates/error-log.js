// 画面で起きた異常の直近20件をこの端末の中に残す（外へは送らない。同期・書き出しの対象外の鍵）。
// 利用者の報告だけでは分からない端末側の不具合を、後から端末をつないで読むため。
(()=>{
 const KEY='astronotes.trial.errors',MAX=20;
 const version=()=>{try{return document.querySelector('meta[name="app-version"]')?.content||'';}catch{return '';}};
 const file=s=>String(s||'').split(/[?#]/)[0].split('/').pop().slice(0,60);
 const keep=(kind,message,source,line)=>{try{
  const list=JSON.parse(localStorage.getItem(KEY)||'[]'),row={at:new Date().toISOString(),v:version(),kind,message:String(message||'').slice(0,200),source:file(source),line:Number(line)||0,page:String(location.hash||'').split('?')[0].slice(0,40)};
  const last=list[list.length-1];if(last&&last.message===row.message&&last.source===row.source&&last.line===row.line){last.count=(last.count||1)+1;last.at=row.at;}else list.push(row);
  localStorage.setItem(KEY,JSON.stringify(list.slice(-MAX)));
 }catch{/* 保存できない端末では何も残さない */}};
 // 握って続行する箇所からの記録。同じ場所は5秒に1回まで（描画の繰り返しで端末の保存を叩かない）。
 const noted=new Map();
 globalThis.AstroNotesErrors={note(where,error){if(error?.name==='AbortError')return;const now=Date.now();if(now-(noted.get(where)||0)<5000)return;noted.set(where,now);keep('handled',error?.message||error,where,0);}};
 addEventListener('error',e=>{if(e&&(e.message||e.error))keep('error',e.message||e.error?.message,e.filename,e.lineno);});
 addEventListener('unhandledrejection',e=>{const r=e?.reason;if(r?.name==='AbortError')return;const where=/([\w.-]+\.js)[^:\s]*:(\d+)/.exec(String(r?.stack||''));keep('rejection',r?.message||r,where?.[1],where?.[2]);});
})();
