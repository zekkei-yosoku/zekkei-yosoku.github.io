// Regenerates every unit's import/export lines and the moduleGraph ledger from the code. Run after moving a declaration.
// Ambient and cross-unit-write changes show up in the manifest diff for review; the build gate still rejects anything inconsistent.
const fs=require('fs'),path=require('path');const {parse,scan}=require('./module-scan.cjs');
const root=path.resolve(__dirname,'..');process.chdir(root);
const manifestPath='src/source-manifest.json',m=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
const units=m.architecture.units.filter(u=>u.scope==='classic-composition'&&u.path.endsWith('.js')).map(u=>u.path);
const strip=s=>{let out=s;const I=/^import \{[^}\n]*\} from '[^'\n]+';\n/,E=/(^|\n)export \{[^}\n]*\};\n?$/;while(I.test(out))out=out.replace(I,'');return out.replace(E,(x,lead)=>x.endsWith('\n')?lead:'');};
const code=Object.fromEntries(units.map(p=>[p,strip(fs.readFileSync(p,'utf8'))]));
const info=Object.fromEntries(units.map(p=>[p,scan(parse(code[p],'script'))]));
const owner=new Map();for(const p of units)for(const n of info[p].top){if(owner.has(n))throw Error('Duplicate top-level name '+n+' in '+p+' and '+owner.get(n));owner.set(n,p);}
const imports={},exported=Object.fromEntries(units.map(p=>[p,new Set()]));
for(const p of units){imports[p]={};for(const n of [...info[p].free].sort()){const q=owner.get(n);if(q&&q!==p){(imports[p][q]=imports[p][q]||[]).push(n);exported[q].add(n);}}}
const rel=(a,b)=>{const r=path.relative(path.dirname(a),b);return r.startsWith('.')?r:'./'+r;};
for(const p of units){const head=units.filter(q=>imports[p][q]).map(q=>`import {${imports[p][q].join(',')}} from '${rel(p,q)}';\n`).join('');const names=[...exported[p]].sort();const body=code[p];let tail='';if(names.length){const line=`export {${names.join(',')}};`;tail=body.endsWith('\n')||!body?line+'\n':'\n'+line;}fs.writeFileSync(p,head+body+tail);}
const ambient=new Set(),writes=[];for(const p of units){for(const n of info[p].free)if(!owner.has(n))ambient.add(n);for(const n of info[p].writes)if(owner.has(n)&&owner.get(n)!==p)writes.push({name:n,writer:p,owner:owner.get(n)});}
writes.sort((a,b)=>a.name.localeCompare(b.name)||a.writer.localeCompare(b.writer));
m.architecture.moduleGraph={ambient:[...ambient].sort(),crossUnitWrites:writes};fs.writeFileSync(manifestPath,JSON.stringify(m,null,2)+'\n');
console.log(JSON.stringify({units:units.length,crossUnitWrites:writes.length,ambient:ambient.size}));
