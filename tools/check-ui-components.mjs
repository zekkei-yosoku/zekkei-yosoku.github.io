// UI ownership inventory. Checks declared APIs' direct source calls, not dynamic aliases or all UI discovery.
import {createRequire} from 'node:module';
const {parse}=createRequire(import.meta.url)('./module-scan.cjs');
export function uiSourcePaths(manifest,read){
 const generated=new Set(manifest.generatedAssets.map(a=>a.output));
 const external=[...read('src/index.html').matchAll(/<script\b[^>]*\bsrc="([^"?]+)(?:\?[^\"]*)?"/g)].map(m=>m[1]).filter(p=>p.endsWith('.js')&&!generated.has(p)&&!p.includes('://')&&!p.startsWith('vendor/'));
 return [...new Set([...manifest.legacyRuntimeOrder,...manifest.generatedAssets.flatMap(a=>a.sourceOrder),...external])].sort();
}
const name=n=>n?.type==='Identifier'?n.name:n?.type==='MemberExpression'&&!n.computed?[name(n.object),n.property.name].filter(Boolean).join('.'):n?.type==='ChainExpression'?name(n.expression):null;
export function inspectUiSources(manifest,read){
 const sources=new Map();
 for(const path of uiSourcePaths(manifest,read)){
  const ast=parse(read(path),'module'),definitions=new Set(),calls=[],phrases=[];
  function walk(n,scope='<top-level>'){
   if(!n||typeof n.type!=='string')return;
   if(n.type==='FunctionDeclaration'&&n.id){definitions.add(n.id.name);scope=n.id.name;}
   if(n.type==='VariableDeclarator'&&n.id.type==='Identifier'){definitions.add(n.id.name);if(/FunctionExpression$/.test(n.init?.type||''))scope=n.id.name;}
   if(n.type==='FunctionExpression'&&n.id)scope=n.id.name;
   if(n.type==='Literal'&&typeof n.value==='string')phrases.push({text:n.value,scope});
   if(n.type==='TemplateElement')phrases.push({text:n.value.cooked||'',scope});
   if(n.type==='CallExpression')calls.push({api:name(n.callee)?.replace(/^(?:globalThis|window)\./,''),scope});
   for(const value of Object.values(n)){if(Array.isArray(value))for(const child of value)walk(child,scope);else if(value&&typeof value==='object')walk(value,scope);}
  }
  walk(ast);sources.set(path,{definitions,calls,phrases});
 }
 return sources;
}
export function uiConsumers(component,sources){
 const rows=[];
 for(const [path,{calls}] of sources){const counts=new Map();for(const call of calls)if(component.calls.includes(call.api))counts.set(call.scope,(counts.get(call.scope)||0)+1);
  for(const [scope,count] of counts)rows.push({path,scope,count});}
 return rows.sort((a,b)=>a.path.localeCompare(b.path)||a.scope.localeCompare(b.scope));
}
export function checkUiComponents(registry,manifest,read){
 if(registry.version!==1||!Array.isArray(registry.components)||!registry.components.length)throw Error('Missing shared UI component inventory');
 const sources=inspectUiSources(manifest,read),ids=new Set(),apis=new Set();
 for(const component of registry.components){
  if(!component.id||ids.has(component.id)||!component.name||!component.contract||!component.surfaces?.length||!component.checks?.length||!component.calls?.length||!component.owner?.symbol)throw Error('Incomplete/duplicate UI component '+component.id);
  ids.add(component.id);for(const api of component.calls){if(apis.has(api))throw Error('Duplicate managed UI API '+api);apis.add(api);}
  if(!sources.get(component.owner.path)?.definitions.has(component.owner.symbol))throw Error('Missing UI owner '+component.id);
  for(const file of component.checks){if(!/^(?:test-[^/]+\.mjs|tools\/[^/]+\.(?:mjs|cjs))$/.test(file)||!read(file).trim())throw Error('Missing UI check '+file);}
  if(component.vocabulary){
   const {terms,owners}=component.vocabulary;
   if(!terms?.length||!owners?.length)throw Error('Missing UI vocabulary contract '+component.id);
   for(const [path,{phrases}]of sources)for(const phrase of phrases)if(terms.some(t=>phrase.text.includes(t))&&!owners.some(o=>o.path===path&&o.scope===phrase.scope))
    throw Error('Unregistered UI wording '+component.id+' '+path+'#'+phrase.scope);
  }
  const declared=(component.consumers||[]).map(({path,scope,count})=>({path,scope,count})).sort((a,b)=>a.path.localeCompare(b.path)||a.scope.localeCompare(b.scope));
  const actual=uiConsumers(component,sources);if(!actual.length||JSON.stringify(actual)!==JSON.stringify(declared))throw Error('Stale UI consumers '+component.id+'\nactual: '+JSON.stringify(actual));
 }
 return {components:ids.size,bindings:registry.components.reduce((n,c)=>n+c.consumers.length,0),sourceFiles:sources.size};
}
