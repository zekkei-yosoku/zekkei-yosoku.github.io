// Scope analysis for source units: top-level names, names resolved outside the unit, and writes to them.
const acorn=require('./vendor/acorn.cjs');
const parse=(code,sourceType)=>acorn.parse(code,{ecmaVersion:'latest',sourceType,allowReturnOutsideFunction:sourceType==='script',allowAwaitOutsideFunction:sourceType==='script'});
function scan(ast){
 const top=new Set(),free=new Set(),writes=new Set(),imports=new Map(),exports=new Set();
 const addPat=(p,s)=>{if(!p)return;switch(p.type){case'Identifier':s.add(p.name);break;case'ObjectPattern':p.properties.forEach(q=>addPat(q.value||q.argument,s));break;case'ArrayPattern':p.elements.forEach(q=>addPat(q,s));break;case'AssignmentPattern':addPat(p.left,s);break;case'RestElement':addPat(p.argument,s);}};
 const hoistVar=(n,s)=>{if(!n||typeof n.type!=='string'||/Function/.test(n.type))return;if(n.type==='VariableDeclaration'&&n.kind==='var')n.declarations.forEach(d=>addPat(d.id,s));for(const k in n){const v=n[k];if(Array.isArray(v))v.forEach(x=>x&&x.type&&hoistVar(x,s));else if(v&&v.type)hoistVar(v,s);}};
 const blockDecl=(body,s)=>{for(const st of body){if(st.type==='VariableDeclaration'&&st.kind!=='var')st.declarations.forEach(d=>addPat(d.id,s));if((st.type==='FunctionDeclaration'||st.type==='ClassDeclaration')&&st.id)s.add(st.id.name);}};
 const body=[];
 for(const st of ast.body){
  if(st.type==='ImportDeclaration'){for(const x of st.specifiers){if(x.type!=='ImportSpecifier'||x.imported.name!==x.local.name)throw Error('Only plain named imports are allowed');imports.set(x.local.name,st.source.value);}continue;}
  if(st.type==='ExportNamedDeclaration'){if(st.declaration||st.source)throw Error('Only export {names} is allowed');for(const x of st.specifiers){if(x.exported.name!==x.local.name)throw Error('Renamed exports are not allowed');exports.add(x.local.name);}continue;}
  if(st.type==='ExportDefaultDeclaration'||st.type==='ExportAllDeclaration')throw Error('Only export {names} is allowed');
  body.push(st);
 }
 body.forEach(st=>hoistVar(st,top));blockDecl(body,top);
 const look=(n,st)=>st.some(s=>s.has(n));
 const use=(n,st)=>{if(!look(n,st))free.add(n);};
 const assign=(n,st)=>{if(!look(n,st)){free.add(n);writes.add(n);}};
 function target(p,st,fn){if(!p)return;switch(p.type){case'Identifier':fn(p.name,st);break;case'MemberExpression':walk(p,st);break;case'ObjectPattern':p.properties.forEach(q=>{if(q.type==='RestElement')target(q.argument,st,fn);else{if(q.computed)walk(q.key,st);target(q.value,st,fn);}});break;case'ArrayPattern':p.elements.forEach(q=>target(q,st,fn));break;case'AssignmentPattern':walk(p.right,st);target(p.left,st,fn);break;case'RestElement':target(p.argument,st,fn);}}
 const noop=()=>{};
 function fn(n,st){const s=new Set(['arguments']);if(n.id&&n.type==='FunctionExpression')s.add(n.id.name);n.params.forEach(p=>addPat(p,s));hoistVar(n.body,s);if(n.body.type==='BlockStatement')blockDecl(n.body.body,s);const ns=[...st,s];n.params.forEach(p=>target(p,ns,noop));if(n.body.type==='BlockStatement')n.body.body.forEach(b=>walk(b,ns));else walk(n.body,ns);}
 function walk(n,st){if(!n||typeof n.type!=='string')return;switch(n.type){
  case'Identifier':use(n.name,st);return;
  case'FunctionDeclaration':case'FunctionExpression':case'ArrowFunctionExpression':fn(n,st);return;
  case'MemberExpression':walk(n.object,st);if(n.computed)walk(n.property,st);return;
  case'Property':if(n.computed)walk(n.key,st);walk(n.value,st);return;
  case'MethodDefinition':case'PropertyDefinition':if(n.computed)walk(n.key,st);walk(n.value,st);return;
  case'AssignmentExpression':target(n.left,st,assign);walk(n.right,st);return;
  case'UpdateExpression':if(n.argument.type==='Identifier')assign(n.argument.name,st);else walk(n.argument,st);return;
  case'ForInStatement':case'ForOfStatement':{const s=new Set();if(n.left.type==='VariableDeclaration'&&n.left.kind!=='var')n.left.declarations.forEach(q=>addPat(q.id,s));const ns=[...st,s];if(n.left.type==='VariableDeclaration')n.left.declarations.forEach(q=>target(q.id,ns,noop));else target(n.left,ns,assign);walk(n.right,ns);walk(n.body,ns);return;}
  case'LabeledStatement':walk(n.body,st);return;case'BreakStatement':case'ContinueStatement':return;
  case'BlockStatement':case'ForStatement':case'SwitchStatement':case'CatchClause':case'StaticBlock':{const s=new Set();if(Array.isArray(n.body))blockDecl(n.body,s);if(n.type==='SwitchStatement')n.cases.forEach(c=>blockDecl(c.consequent,s));if(n.init&&n.init.type==='VariableDeclaration'&&n.init.kind!=='var')n.init.declarations.forEach(q=>addPat(q.id,s));if(n.param)addPat(n.param,s);const ns=[...st,s];if(n.param)target(n.param,ns,noop);for(const k in n){if(k==='param'||k==='type')continue;const v=n[k];if(Array.isArray(v))v.forEach(x=>x&&x.type&&walk(x,ns));else if(v&&v.type)walk(v,ns);}return;}
  case'VariableDeclaration':n.declarations.forEach(q=>{target(q.id,st,noop);walk(q.init,st);});return;
  case'ClassDeclaration':case'ClassExpression':{walk(n.superClass,st);const s=new Set(n.id?[n.id.name]:[]);n.body.body.forEach(b=>walk(b,[...st,s]));return;}}
  for(const k in n){if(k==='type')continue;const v=n[k];if(Array.isArray(v))v.forEach(x=>x&&x.type&&walk(x,st));else if(v&&v.type)walk(v,st);}}
 body.forEach(b=>walk(b,[top]));
 return {top,free,writes,imports,exports};
}
module.exports={parse,scan};
