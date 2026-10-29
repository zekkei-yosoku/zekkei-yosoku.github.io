// Conservative boundary lint, not a full JavaScript parser or a security sandbox.
// Contract tests additionally execute actual exports in isolated VMs.
export function codeOnly(source){
 let i=0;
 function scan(untilBrace=false){let out='',depth=untilBrace?1:0;
  while(i<source.length){const c=source[i],n=source[i+1];
   if(c==='/'&&n==='/'){while(i<source.length&&source[i]!=='\n')i++;out+=' ';continue;}
   if(c==='/'&&n==='*'){i+=2;while(i<source.length&&!(source[i]==='*'&&source[i+1]==='/'))i++;i+=2;out+=' ';continue;}
   if(c==='"'||c==="'"){const q=c;i++;while(i<source.length){if(source[i]==='\\'){i+=2;continue;}if(source[i++]===q)break;}out+=' ';continue;}
   if(c==='`'){i++;out+=' ';while(i<source.length){if(source[i]==='\\'){i+=2;continue;}if(source[i]==='`'){i++;break;}if(source[i]==='$'&&source[i+1]==='{'){i+=2;out+=' '+scan(true)+' ';continue;}i++;}continue;}
   i++;if(untilBrace){if(c==='{')depth++;if(c==='}'&&--depth===0)break;if(c!=='}'){}else if(depth<0)break;}
   out+=c;
  }return out;
 }return scan();
}
export function checkArchitecture(manifest,read){
 const a=manifest.architecture;if(!a)throw Error('Missing architecture contract');
 const paths=[...manifest.legacyRuntimeOrder,...manifest.generatedAssets.flatMap(x=>x.sourceOrder)],units=new Map(a.units.map(u=>[u.path,u]));
 if(units.size!==paths.length||paths.some(p=>!units.has(p)))throw Error('Unclassified or duplicate architecture unit');
 const providers=new Map();for(const u of units.values())for(const n of u.provides){if(providers.has(n))throw Error('Duplicate provider '+n);providers.set(n,u.path);}
 const externalFiles=[...read('src/index.html').matchAll(/<script\b[^>]*\bsrc="([^"?]+)(?:\?[^"]*)?"/g)].map(x=>x[1]).filter(n=>!manifest.generatedAssets.some(a=>a.output===n));
 const external=[];for(const file of [...new Set(externalFiles)].sort())for(const name of [...new Set([...read(file).matchAll(/\b(?:global|root|g|globalThis|window)\.(AstroNotes\w+)\s*=/g)].map(x=>x[1]))].sort())external.push({name,source:file});
 if(JSON.stringify(external)!==JSON.stringify(a.externalProviders))throw Error('External provider registry is stale');
 for(const p of external)if(providers.has(p.name))throw Error('External namespace collision '+p.name+' in '+p.source);
 const graph=new Map(),codes=new Map();
 for(const u of units.values()){
  const code=read(u.path);codes.set(u.path,code);
  if(u.scope==='factory'){const assigned=[...new Set([...codeOnly(code).matchAll(/\b(?:root|global|g|globalThis|window)\.([A-Za-z_$][\w$]*)\s*=(?!=)/g)].map(m=>m[1]))].sort();if(JSON.stringify(assigned)!==JSON.stringify([...u.provides].sort()))throw Error('Factory provider declaration mismatch '+u.path);}if(!u.layer||!u.scope)throw Error('Unclassified source '+u.path);
  if((u.layer==='domain'||u.layer==='ports'||u.scope==='factory')&&(!Array.isArray(u.forbiddenAmbient)||['document','window','localStorage','sessionStorage'].some(n=>!u.forbiddenAmbient.includes(n))))throw Error('Missing mandatory ambient policy '+u.path);
  const actual=[...providers.keys()].filter(n=>!u.provides.includes(n)&&new RegExp('\\b'+n+'\\b').test(code));
  if(JSON.stringify(actual)!==JSON.stringify(u.requires))throw Error('Undeclared factory dependency '+u.path);
  graph.set(u.path,u.requires.map(n=>providers.get(n)));
  const body=codeOnly(code.replace(/typeof globalThis !== "undefined" \? globalThis : window/g,'globalThis')).replace(/([,{]\s*)([A-Za-z_$][\w$]*)(\s*:)/g,'$1 $3');
  for(const name of u.forbiddenAmbient||[])if(new RegExp('(?<![\\w.$])'+name+'\\b').test(body))throw Error('Ambient dependency '+name+' in '+u.path);
 }
 const active=new Set(),done=new Set();function visit(n){if(active.has(n))throw Error('Factory dependency cycle '+n);if(done.has(n))return;active.add(n);for(const d of graph.get(n)||[])visit(d);active.delete(n);done.add(n);}for(const n of graph.keys())visit(n);
 const references=(name,definition)=>[...units.keys()].filter(p=>p!==definition&&units.get(p).scope!=='factory'&&new RegExp('\\b'+name+'\\b').test(codeOnly(codes.get(p))));
 const actual=[];for(const u of units.values())for(const m of codes.get(u.path).matchAll(/(\w+)\.defineLegacy\(["']([^"']+)/g))actual.push([m[2],m[1],u.path]);
 const declared=a.bridges.map(b=>{if(!b.purpose||!b.retireWhen||JSON.stringify(b.references)!==JSON.stringify(references(b.name,b.definition)))throw Error('Unclassified bridge or stale references '+b.name);return[b.name,b.owner,b.definition]});
 if(JSON.stringify(actual)!==JSON.stringify(declared))throw Error('Unregistered legacy accessor bridge');
 if(new Set(a.bridges.map(x=>x.retireWhen)).size!==declared.length)throw Error('Bridge retirement conditions must be specific');
 const compat=new Map((a.compatibility||[]).map(e=>[e.name,e]));
 for(const e of compat.values()){
  const code=codes.get(e.definition);if(!code||!e.owner||!e.purpose||!e.retireWhen||!code.includes(e.implementation))throw Error('Incomplete compatibility entry '+e.name);
  const pattern=e.kind==='function'?'function\\s+'+e.name+'\\s*\\(':'(?:const|let|var)\\s+(?:'+e.name+'\\b|\\{[^}]*\\b'+e.name+'\\b)';
  if(!new RegExp(pattern).test(codeOnly(code))||JSON.stringify(e.readers)!==JSON.stringify(references(e.name,e.definition)))throw Error('Stale compatibility entry '+e.name);
 }
 for(const [path,code] of codes)for(const x of code.matchAll(/function\s+(\w+)\([^)]*\)\s*\{\s*(?:return\s+)?(?:apiTransport|authStorage|navigationHistory|accountSync)\b/g))if(!compat.has(x[1]))throw Error('Unclassified adapter wrapper '+x[1]+' in '+path);
 // Compatibility aliases forward a provider value/function; constructor calls create owners, not aliases.
 for(const [path,source] of codes){if(units.get(path).scope==='factory')continue;const code=codeOnly(source);
  for(const m of code.matchAll(/\b(?:const|let|var)\s+(\{[^}]+\}|[A-Za-z_$][\w$]*)\s*=\s*([^;\n]+)/g)){
   const rhs=m[2].trim(),provider=[...providers.keys()].find(n=>new RegExp('^'+n+'(?:\\.[A-Za-z_$][\\w$]*)?$').test(rhs)||new RegExp('=>\\s*'+n+'\\b').test(rhs));
   if(!provider)continue;const names=m[1].startsWith('{')?m[1].slice(1,-1).split(',').map(n=>n.trim()):[m[1]];
   for(const name of names)if(!compat.has(name))throw Error('Unclassified adapter alias '+name+' in '+path);
  }
 }
 const refs=new Map();for(const [path,code] of codes)for(const m of code.matchAll(/\b(?:globalThis|window)\.([A-Za-z_$][\w$]*)/g)){if(!refs.has(m[1]))refs.set(m[1],new Set());refs.get(m[1]).add(path);}
 const listed=new Map((a.globalObjectReferences||[]).map(x=>[x.name,x]));if(refs.size!==listed.size)throw Error('Unclassified global object reference');
 for(const [name,readers] of refs){const e=listed.get(name);if(!e?.owner?.length||!e.category||!e.purpose||!e.retireWhen||JSON.stringify([...readers])!==JSON.stringify(e.readers))throw Error('Unclassified global object reference '+name);}
 return {units:units.size,bridges:declared.length,wrappers:compat.size,globalReferences:refs.size};
}
