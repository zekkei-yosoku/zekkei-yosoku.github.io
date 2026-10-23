/* Shared name search for the bundled photographic places (OSM / GSI).
 * Nearby river names are search context, never a claim about a crossing or access. */
(function(root){
 'use strict';
 const norm=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[ァ-ヶ]/g,c=>String.fromCharCode(c.charCodeAt(0)-96)).replace(/[\s　・,，、。]/g,'');
 const finitePoint=p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=9000000&&Math.abs(p[1])<=18000000;
 function path(data,r){
  const points=[],g=r.g;
  if(Array.isArray(g)&&g.length%2===0)for(let i=0;i<g.length;i+=2){const p=data.gRelative?[r.p[0]+g[i],r.p[1]+g[i+1]]:[g[i],g[i+1]];if(finitePoint(p))points.push([p[0]/1e5,p[1]/1e5]);}
  return points.length?points:[[r.p[0]/1e5,r.p[1]/1e5]];
 }
 const box=points=>({minLat:Math.min(...points.map(p=>p[0])),maxLat:Math.max(...points.map(p=>p[0])),minLon:Math.min(...points.map(p=>p[1])),maxLon:Math.max(...points.map(p=>p[1]))});
 function pointSegment(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy||1)));return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);}
 const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
 function segmentDistance(a,b,c,d){
  const overlaps=Math.max(Math.min(a[0],b[0]),Math.min(c[0],d[0]))<=Math.min(Math.max(a[0],b[0]),Math.max(c[0],d[0]))&&Math.max(Math.min(a[1],b[1]),Math.min(c[1],d[1]))<=Math.min(Math.max(a[1],b[1]),Math.max(c[1],d[1]));
  if(overlaps&&cross(a,b,c)*cross(a,b,d)<=0&&cross(c,d,a)*cross(c,d,b)<=0)return 0;
  return Math.min(pointSegment(a,c,d),pointSegment(b,c,d),pointSegment(c,a,b),pointSegment(d,a,b));
 }
 function open(data){
  const rows=(data?.places||[]).filter(r=>r&&typeof r.n==='string'&&finitePoint(r.p)).map(r=>({name:r.n,address:r.a||'',kind:data.kinds?.[r.k]||'',latitude:r.p[0]/1e5,longitude:r.p[1]/1e5,elevation:Number.isFinite(r.e)&&r.e>=-500&&r.e<=9000?r.e:null,deckM:Number.isFinite(r.d)&&r.d>=0&&r.d<=700?r.d:null,code:r.k,raw:r}));
  const waters=rows.filter(r=>r.code==='w').map(r=>{const points=path(data,r.raw);return{name:r.name,points,...box(points)};});
  for(const row of rows){
   row.context=[];if(row.code!=='b')continue;
   const bridge=path(data,row.raw),bounds=box(bridge),cy=Math.cos(row.latitude*Math.PI/180),latMargin=50/111320,lonMargin=latMargin/Math.max(.01,cy);
   const project=p=>[(p[1]-row.longitude)*111320*cy,(p[0]-row.latitude)*111320],bp=bridge.map(project);
   for(const w of waters){
    if(bounds.maxLat<w.minLat-latMargin||bounds.minLat>w.maxLat+latMargin||bounds.maxLon<w.minLon-lonMargin||bounds.minLon>w.maxLon+lonMargin)continue;
    const wp=w.points.map(project);let distance=Infinity;
    for(let i=0;i<Math.max(1,bp.length-1);i++)for(let j=0;j<Math.max(1,wp.length-1);j++)distance=Math.min(distance,segmentDistance(bp[i],bp[i+1]||bp[i],wp[j],wp[j+1]||wp[j]));
    if(distance<=50&&!row.context.includes(w.name))row.context.push(w.name);
   }
  }
  return rows.map(({raw,code,...r})=>({...r,nameN:norm(r.name),addressN:norm(r.address),contextN:norm(r.context.join(' '))}));
 }
 // Every term must match. At least one term must identify the place name;
 // address-only searches remain the responsibility of the address services.
 function match(query,row){
  const terms=String(query||'').normalize('NFKC').trim().split(/\s+/).map(norm).filter(Boolean);
  if(!terms.length)return false;
  const name=row.nameN||norm(row.name),names=[name,...(row.aliases||[]).map(norm)],address=row.addressN||norm(row.address),context=row.contextN||norm((row.context||[]).join(' '));
  let named=false;
  const found=terms.every(term=>{
   if(names.some(n=>n.includes(term))){named=true;return true;}
   if(term.includes(name)&&name.length>=2&&!/^(展望台|展望地|公園|大橋|川岸|桟橋)$/.test(name)){named=true;const rest=term.replace(name,'');return !rest||(rest.length>=2&&(address.includes(rest)||context.includes(rest)));}
   return address.includes(term)||context.includes(term);
  });
  return found&&named;
 }
 function search(rows,query){return rows.filter(r=>match(query,r)).map(r=>({...r,scope:'point',source:'photo',detail:[r.address,r.context.length?'近くの川：'+r.context.join('・'):null].filter(Boolean).join(' ・ ')}));}
 const api={open,search,match,norm};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.AstroNotesPlaceSearch=api;
})(typeof globalThis!=='undefined'?globalThis:this);

/* Legacy global names remain aliases for cached integrations. */
if(typeof AstroNotesPlaceSearch!=='undefined')globalThis.SoramiPlaceSearch=AstroNotesPlaceSearch;
