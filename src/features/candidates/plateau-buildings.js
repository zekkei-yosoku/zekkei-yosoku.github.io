/* PLATEAU building shapes (tools/build-plateau-models.py) for targets the user adds. A saved target that stands
   on a PLATEAU building of about its height takes that building's shape on this page (見え方 and new places);
   calculation workers keep their own models. */
(function(root,factory){const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesPlateauBuildings=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
'use strict';
const RAD=Math.PI/180;
// Files are per 2nd-order mesh (6 digits, about 10 km).
function part(lat,lon){const my=Math.floor(lat*120),mx=Math.floor(lon*80);return ''+Math.floor(my/80)+(Math.floor(mx/80)-100)+Math.floor(my%80/10)+Math.floor(mx%80/10);}
function inside(ring,x,y){let on=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++)if((ring[i][1]>y)!==(ring[j][1]>y)&&x<(ring[j][0]-ring[i][0])*(y-ring[i][1])/(ring[j][1]-ring[i][1])+ring[i][0])on=!on;return on;}
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
// A row: [id, name, aim latitude, aim longitude, ground m, height m, LOD, columns]; a column: [top dm, east/north dm pairs].
function shape(row){
 const [id,name,lat,lon,groundM,heightM,lod,cols]=row,kx=111320*Math.cos(lat*RAD),ky=110540;
 const rings=cols.map(([top,flat])=>{const r=[];for(let i=0;i<flat.length;i+=2)r.push([flat[i]/10,flat[i+1]/10]);return {top:top/10,ring:r};}),geo=p=>[lat+p[1]/ky,lon+p[0]/kx];
 const aim=aimPoint(rings);
 return {id,name,latitude:aim?+geo(aim)[0].toFixed(7):lat,longitude:aim?+geo(aim)[1].toFixed(7):lon,originLatitude:lat,originLongitude:lon,groundM,heightM,lod,rings,geo};
}
// The packed aim point is the middle of every roof within 1.5 m of the top. Twin towers of one height put that in the
// gap between them (都庁第一本庁舎), so aim at the middle of the tower that holds the highest roof instead.
function aimPoint(rings){
 if(!rings.length)return null;
 const box=r=>{let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;for(const [x,y] of r.ring){a=Math.min(a,x);b=Math.min(b,y);c=Math.max(c,x);d=Math.max(d,y);}return [a,b,c,d];};
 const top=Math.max(...rings.map(r=>r.top)),high=rings.filter(r=>r.top>=top-1.5).map(r=>({r,b:box(r)}));
 const first=high.reduce((a,c)=>c.r.top>a.r.top?c:a),group=[first],rest=high.filter(x=>x!==first),near=(p,q)=>p[0]<=q[2]+3&&q[0]<=p[2]+3&&p[1]<=q[3]+3&&q[1]<=p[3]+3;
 for(let grew=true;grew;){grew=false;for(let i=rest.length-1;i>=0;i--)if(group.some(g=>near(g.b,rest[i].b))){group.push(...rest.splice(i,1));grew=true;}}
 if(!rest.length)return null;
 const a=Math.min(...group.map(g=>g.b[0])),b=Math.min(...group.map(g=>g.b[1])),c=Math.max(...group.map(g=>g.b[2])),d=Math.max(...group.map(g=>g.b[3]));
 return [(a+c)/2,(b+d)/2];
}
// The app's city-model form: every column is one face of its ground and roof corners, placed by absolute position.
function cityModel(b){
 const vertices=[],geoVertices=[],faces=[];
 for(const {top,ring} of b.rings){const face=[];for(const z of [0,top])for(const p of ring){face.push(vertices.length);vertices.push([p[0],p[1],z]);geoVertices.push(b.geo(p));}faces.push(face);}
 return {id:'plateau-'+b.id,buildingId:b.id,heightM:b.heightM,groundM:b.groundM,vertices,geoVertices,faces,approximate:true,
  sourceLabel:'PLATEAU（加工）・LOD'+b.lod,sourceUrl:'https://www.mlit.go.jp/plateau/site-policy/'};
}
function create({load=null,fetchImpl=(typeof fetch==='function'?fetch.bind(root):null),base='data/building-shapes/'}={}){
 let indexPromise=null;const parts=new Map(),ready=new Map(),attached=new Map();
 const index=()=>indexPromise||(indexPromise=(load?load('building-shapes/index.json'):fetchImpl(base+'index.json').then(r=>{if(!r.ok)throw Error('shape-index');return r.json();})).catch(e=>{indexPromise=null;throw e;}));
 async function partAt(lat,lon){
  const data=await index(),p=part(lat,lon),entry=data.parts?.[p];if(!entry)return [];
  if(!parts.has(p))parts.set(p,(async()=>{const r=await fetchImpl(base+p+'.json.gz?v='+entry[0],{signal:globalThis.AbortSignal?.timeout?.(20000)});if(!r.ok)throw Error('shape-part');
   const bytes=await r.arrayBuffer();if(!(await sha(bytes)).startsWith(entry[0]))throw Error('shape-part-version');
   const json=JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());
   const list=json.buildings.map(shape);ready.set(p,list);return list;})().catch(e=>{parts.delete(p);throw e;}));
  const wanted=parts.get(p);if(parts.size>24){const old=parts.keys().next().value;parts.delete(old);ready.delete(old);}
  return wanted;
 }
 const metres=(b,lat,lon)=>{const kx=111320*Math.cos(lat*RAD),ky=110540;return [(lon-b.originLongitude)*kx,(lat-b.originLatitude)*ky];};
 const onFootprint=(b,lat,lon)=>{const [x,y]=metres(b,lat,lon);return b.rings.some(({ring})=>inside(ring,x,y));};
 const distance=(b,lat,lon)=>{if(onFootprint(b,lat,lon))return 0;const [x,y]=metres(b,lat,lon);let best=Infinity;for(const {ring} of b.rings)for(let i=0,j=ring.length-1;i<ring.length;
 j=i++){const [x1,y1]=ring[j],[x2,y2]=ring[i],dx=x2-x1,dy=y2-y1,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,((x-x1)*dx+(y-y1)*dy)/l)):0;best=Math.min(best,Math.hypot(x-x1-t*dx,y-y1-t*dy));}return best;};
 // Buildings within radiusM of a point, nearest first (a point on a footprint is at 0 m).
 async function near(lat,lon,{radiusM=300,limit=8,minHeightM=0}={}){
  const list=await partAt(lat,lon);
  return list.filter(b=>b.heightM>=minHeightM).map(b=>({b,d:distance(b,lat,lon)})).filter(x=>x.d<=radiusM).sort((a,c)=>a.d-c.d||c.b.heightM-a.b.heightM).slice(0,limit)
   .map(({b,d})=>({id:b.id,name:b.name,latitude:b.latitude,longitude:b.longitude,groundM:b.groundM,heightM:b.heightM,lod:b.lod,distanceM:Math.round(d)}));
 }
 // A saved target (id "fav:…") on a PLATEAU building whose height is within 15% (5 m) of the target's takes its shape.
 function match(target){
  if(!target||!String(target.id||'').startsWith('fav:')||target.rim)return null;
  const top=(target.parts?.find(p=>p.id==='tip')||target.parts?.[0])?.m,h=Number.isFinite(top)?top-(target.groundM??0):NaN;if(!(h>0))return null;
  const list=ready.get(part(target.latitude,target.longitude));if(!list)return null;
  let best=null;for(const b of list){if(Math.abs(b.heightM-h)>Math.max(5,b.heightM*.15))continue;const d=distance(b,target.latitude,target.longitude);if(d<=3&&(!best||d<best.d))best={b,d};}
  return best?.b||null;
 }
 // Register shapes for saved targets on this page. Returns the ids that changed.
 async function prepare(targets){
  const changed=[],models=root.AstroNotesCityModels||(root.AstroNotesCityModels={});
  for(const t of targets||[]){if(!String(t?.id||'').startsWith('fav:'))continue;try{await partAt(t.latitude,t.longitude);}catch{continue;}
   const b=match(t),prev=attached.get(t.id);
   if(b&&prev?.id!==b.id){models[t.id]=cityModel(b);attached.set(t.id,b);changed.push(t.id);}
   else if(!b&&prev){delete models[t.id];attached.delete(t.id);changed.push(t.id);}}
  return changed;
 }
 // Footprint of the building a target stands on (lat/lon rings), for leaving it out of its own sight lines.
 function footprint(targetId){const b=attached.get(targetId);return b?b.rings.map(({ring})=>ring.map(p=>b.geo(p))):null;}
 return {near,prepare,match,footprint,attachedTo:id=>attached.get(id)||null};
}
return {create,part,shape,cityModel,aimPoint};
});
