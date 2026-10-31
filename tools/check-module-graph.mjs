// The import/export lines in classic-composition units must match what the code actually does. Scope-aware (acorn).
import {createRequire} from 'node:module';
import {dirname,join,normalize} from 'node:path';
const {parse,scan}=createRequire(import.meta.url)('./module-scan.cjs');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
export function checkModuleGraph(manifest,read){
 const graph=manifest.architecture.moduleGraph;if(!graph)throw Error('Missing moduleGraph contract');
 const paths=manifest.architecture.units.filter(u=>u.scope==='classic-composition'&&u.path.endsWith('.js')).map(u=>u.path),set=new Set(paths),info=new Map();
 for(const p of paths){let ast;try{ast=parse(read(p),'module');}catch(e){throw Error('Unit is not a valid module '+p+': '+e.message);}info.set(p,scan(ast));}
 const owner=new Map();for(const p of paths)for(const n of info.get(p).top){if(owner.has(n))throw Error('Duplicate top-level name '+n+' in '+p+' and '+owner.get(n));owner.set(n,p);}
 const used=new Map(paths.map(p=>[p,new Set()])),ambient=new Set(),writes=[];
 for(const p of paths){const u=info.get(p);
  for(const [name,from] of u.imports){const target=normalize(join(dirname(p),from));if(!set.has(target))throw Error('Import from unknown unit '+from+' in '+p);if(owner.get(name)!==target)throw Error('Import of '+name+' in '+p+' does not match its owner');if(!info.get(target).exports.has(name))throw Error('Import of '+name+' in '+p+' is not exported by '+target);if(!u.free.has(name))throw Error('Unused import '+name+' in '+p);used.get(target).add(name);}
  for(const name of u.exports)if(!u.top.has(name))throw Error('Export of undeclared '+name+' in '+p);
  for(const name of u.free){if(u.imports.has(name))continue;if(owner.has(name))throw Error('Undeclared dependency '+name+' in '+p+' (owner '+owner.get(name)+')');ambient.add(name);}
  for(const name of u.writes)if(u.imports.has(name))writes.push({name,writer:p,owner:u.imports.get(name)&&owner.get(name)});
 }
 for(const p of paths){const unused=[...info.get(p).exports].filter(n=>!used.get(p).has(n));if(unused.length)throw Error('Unused export '+unused.join(',')+' in '+p);}
 const names=[...ambient].sort();if(!same(names,graph.ambient))throw Error('Ambient names changed: '+[...names.filter(n=>!graph.ambient.includes(n)),...graph.ambient.filter(n=>!ambient.has(n))].join(','));
 writes.sort((a,b)=>a.name.localeCompare(b.name)||a.writer.localeCompare(b.writer));
 if(!same(writes,graph.crossUnitWrites))throw Error('Cross-unit writes changed; new writes need an owner function: '+writes.filter(w=>!graph.crossUnitWrites.some(x=>x.name===w.name&&x.writer===w.writer)).map(w=>w.name+' in '+w.writer).join(','));
 return {units:paths.length,imports:[...info.values()].reduce((a,u)=>a+u.imports.size,0),ambient:names.length,crossUnitWrites:writes.length};
}
