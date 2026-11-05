/* Trial picking on the existing drawing's convex volumes. This is approximate drawing geometry, not surveyed PLATEAU geometry. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesTrialSurface=api;})(globalThis,function(){
'use strict';
const rad=Math.PI/180,G=()=>globalThis.AstroNotesTerrain||(typeof require==='function'?require('../../astronotes-terrain.js'):null),hulls=globalThis.AstroNotesTrialSurfaceHulls||(typeof require==='function'?require('./scene-hulls.js'):null);
let cached=null;const modelChecks=new WeakMap(),compiled=new WeakMap();
const targetFrame=t=>JSON.stringify([t.id,t.latitude,t.longitude,t.groundM,t.parts]);
const hash=value=>{const text=JSON.stringify(value);let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);return h>>>0;};
const validPoint=p=>Array.isArray(p)&&p.length>=3&&p.slice(0,3).every(Number.isFinite),sub=(a,b)=>a.map((x,i)=>x-b[i]),cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a.reduce((n,x,i)=>n+x*b[i],0);
// Existing drawing solids are convex volumes, not ordered polygon boundaries.
// Incremental hulls keep that contract; explicit triangle meshes are never
// convexified, preserving concavities and openings in their supplied geometry.
function convexTriangles(vertices,indices){
 const ids=[...new Set(indices)].filter((id,i,a)=>!a.slice(0,i).some(j=>vertices[j].every((x,k)=>Math.abs(x-vertices[id][k])<1e-9)));
 if(ids.length<3)return [];
 const a=ids[0],b=ids.reduce((j,k)=>dot(sub(vertices[k],vertices[a]),sub(vertices[k],vertices[a]))>dot(sub(vertices[j],vertices[a]),sub(vertices[j],vertices[a]))?k:j,a),ab=sub(vertices[b],vertices[a]);
 const c=ids.reduce((j,k)=>dot(cross(ab,sub(vertices[k],vertices[a])),cross(ab,sub(vertices[k],vertices[a])))>dot(cross(ab,sub(vertices[j],vertices[a])),cross(ab,sub(vertices[j],vertices[a])))?k:j,a),normal=cross(ab,sub(vertices[c],vertices[a])),norm=Math.hypot(...normal);
 if(norm<1e-10)return [];
 const scale=Math.max(1,...ids.map(i=>Math.hypot(...sub(vertices[i],vertices[a])))),eps=scale*1e-8,d=ids.reduce((j,k)=>Math.abs(dot(normal,sub(vertices[k],vertices[a])))>Math.abs(dot(normal,sub(vertices[j],vertices[a])))?k:j,a);
 if(Math.abs(dot(normal,sub(vertices[d],vertices[a])))/norm<=eps){
  const axis=normal.map(Math.abs).indexOf(Math.max(...normal.map(Math.abs))),xy=id=>vertices[id].filter((_,i)=>i!==axis),turn=(a,b,c)=>{const p=xy(a),q=xy(b),r=xy(c);return(q[0]-p[0])*(r[1]-p[1])-(q[1]-p[1])*(r[0]-p[0]);},sorted=ids.slice().sort((a,b)=>xy(a)[0]-xy(b)[0]||xy(a)[1]-xy(b)[1]),low=[],high=[];
  for(const i of sorted){while(low.length>=2&&turn(low.at(-2),low.at(-1),i)<=0)low.pop();low.push(i);}for(const i of sorted.reverse()){while(high.length>=2&&turn(high.at(-2),high.at(-1),i)<=0)high.pop();high.push(i);}const ring=low.slice(0,-1).concat(high.slice(0,-1));return ring.slice(1,-1).map((id,i)=>[ring[0],id,ring[i+2]]);
 }
 const center=[0,1,2].map(k=>(vertices[a][k]+vertices[b][k]+vertices[c][k]+vertices[d][k])/4),face=(i,j,k)=>{const n=cross(sub(vertices[j],vertices[i]),sub(vertices[k],vertices[i]));return dot(n,sub(center,vertices[i]))>0?[i,k,j]:[i,j,k];};
 let faces=[face(a,b,c),face(a,d,b),face(a,c,d),face(b,d,c)];
 for(const id of ids){if([a,b,c,d].includes(id))continue;const visible=f=>{const n=cross(sub(vertices[f[1]],vertices[f[0]]),sub(vertices[f[2]],vertices[f[0]]));return dot(n,sub(vertices[id],vertices[f[0]]))>eps*Math.hypot(...n);},removed=faces.filter(visible);if(!removed.length)continue;const edges=new Map();for(const f of removed)for(let i=0;i<3;i++){const u=f[i],v=f[(i+1)%3],key=u<v?u+','+v:v+','+u;if(edges.has(key))edges.delete(key);else edges.set(key,[u,v]);}faces=faces.filter(f=>!visible(f));for(const [u,v]of edges.values())faces.push(face(u,v,id));}
 return faces;
}
function sourceModel(align,target){
 const has=m=>!!m&&(Array.isArray(m.vertices)||Array.isArray(m.solids));
 if(has(target.model))return target.model;
 const direct=(globalThis.AstroNotesTowerModels||align.TOWER_MODELS)?.[target.id]||(globalThis.AstroNotesCityModels||align.CITY_MODELS)?.[target.id];if(has(direct))return direct;
 // Built-in drawings outside the registries expose their model ID through the
 // actual outline. Resolve by capability/identity, without a target-name list.
 let id;try{id=align.towerOutline?.({...G().destination(target.latitude,target.longitude,180,1),elevation:target.groundM??0},target)?.modelId;}catch{return null;}
 return id?Object.values(align).find(m=>has(m)&&m.id===id)||null:null;
}
function model(align,target){
 if(!align||!target?.parts?.length)return null;const raw=sourceModel(align,target);if(!raw)return null;
 const frameKey=targetFrame(target);let byFrame=compiled.get(raw);if(byFrame?.has(frameKey))return byFrame.get(frameKey);
 if(!(raw.heightM>0)||raw.heightMode&&!['scale','translate-top'].includes(raw.heightMode))return null;
 if(raw.id===hulls?.modelId){if(!modelChecks.has(raw))modelChecks.set(raw,raw.vertices?.length===hulls.vertexCount&&raw.faces?.length===hulls.triangles.length&&hash({vertices:raw.vertices,faces:raw.faces,heightM:raw.heightM})===hulls.signature);if(!modelChecks.get(raw))return null;}
 const ground=target.groundM??0,top=(target.parts.find(p=>p.id==='tip')||target.parts[0]).m-ground;if(!Number.isFinite(ground)||!(top>0))return null;
 const ref=raw.calibration?.observer,bearing=ref?G().inverse(target.latitude,target.longitude,ref.latitude,ref.longitude).azimuth:raw.referenceBearing??0,axis=(bearing-90)*rad,depth=(bearing+180)*rad;
 let original,groups;
 if(raw.vertices){original=raw.vertices;if(!original.every(validPoint))return null;groups=raw.triangles?raw.triangles.map(t=>[t]):raw.faces;if(!Array.isArray(groups))return null;}
 else {original=[];groups=[];for(const solid of raw.solids||[]){if(!Array.isArray(solid)||!solid.every(validPoint))return null;groups.push(solid.map(p=>{original.push(p);return original.length-1;}));}}
 const vertices=original.map(([x,y,z],i)=>{let east=raw.vertices?x:x*Math.sin(axis)+y*Math.sin(depth),north=raw.vertices?y:x*Math.cos(axis)+y*Math.cos(depth);
  if(raw.geoVertices){const p=raw.geoVertices[i];if(!Array.isArray(p)||!p.slice(0,2).every(Number.isFinite))return null;const g=G().inverse(target.latitude,target.longitude,p[0],p[1]);east=g.km*1000*Math.sin(g.azimuth*rad);north=g.km*1000*Math.cos(g.azimuth*rad);}
  const height=ground+(raw.heightMode==='translate-top'?(raw.groundAnchored&&z===0?0:z+top-raw.heightM):z*top/raw.heightM);return [east,north,height];});if(vertices.some(p=>!p))return null;
 const indexValid=i=>Number.isInteger(i)&&i>=0&&i<vertices.length;
 let triangles;if(raw.triangles){if(!raw.triangles.every(t=>t.length===3&&t.every(indexValid)))return null;triangles=raw.triangles.map(t=>[t]);}
 else{if(!groups.every(f=>Array.isArray(f)&&f.every(indexValid)))return null;triangles=raw.id===hulls?.modelId?hulls.triangles:groups.map(f=>convexTriangles(vertices,f));}
 if(!triangles.some(t=>t.length))return null;
 const signature=hash({vertices,triangles}),m={...raw,id:raw.id||'registered-shape-'+signature,vertices,faces:triangles.map(ts=>[...new Set(ts.flat())]),surfaceTriangles:triangles,signature,approximate:true};
 if(!byFrame){byFrame=new Map();compiled.set(raw,byFrame);}if(byFrame.size>=8)byFrame.clear();byFrame.set(frameKey,m);return m;
}
function compatible(c,t,align=globalThis.AstroNotesAlign||(typeof require==='function'?require('../../astronotes-align.js'):null)){const m=model(align,t);return !!m&&c.modelId===m.id&&c.modelSignature===m.signature&&c.targetFrame===targetFrame(t);}
function bounds({target,align=globalThis.AstroNotesAlign||(typeof require==='function'?require('../../astronotes-align.js'):null),obs}){
 const m=model(align,target);if(!m)return null;const bearing=obs?G().inverse(target.latitude,target.longitude,obs.latitude,obs.longitude).azimuth*rad:0,b={heightMinM:Infinity,heightMaxM:-Infinity,eastMinM:Infinity,eastMaxM:-Infinity,northMinM:Infinity,northMaxM:-Infinity,xMinM:Infinity,xMaxM:-Infinity};
 for(const [east,north,height]of m.vertices){const x=-Math.cos(bearing)*east+Math.sin(bearing)*north;b.heightMinM=Math.min(b.heightMinM,height);b.heightMaxM=Math.max(b.heightMaxM,height);b.eastMinM=Math.min(b.eastMinM,east);b.eastMaxM=Math.max(b.eastMaxM,east);b.northMinM=Math.min(b.northMinM,north);b.northMaxM=Math.max(b.northMaxM,north);b.xMinM=Math.min(b.xMinM,x);b.xMaxM=Math.max(b.xMaxM,x);}return b;
}
function world(target,eastM,northM,heightM){return {...G().destination(target.latitude,target.longitude,Math.atan2(eastM,northM)/rad,Math.hypot(eastM,northM)/1000),heightM};}
function anchor(target,c){return world(target,c.eastM,c.northM,c.heightM);}
function geometry(obs,target,c,align){const p=anchor(target,c);return {anchor:p,...align.geometryFrom(obs,{...target,latitude:p.latitude,longitude:p.longitude,parts:[{id:'__surface',m:c.heightM}]},{eyeM:obs.eyeM??1.5,heightM:c.heightM})};}
function frame(obs,target,align){const m=model(align,target);if(!m)return null;const key=JSON.stringify([obs.latitude,obs.longitude,obs.elevation,obs.eyeM,targetFrame(target),m.signature,globalThis.AstroNotesAtmosphere?.targetK?.()]);if(cached?.key===key)return cached;
 const bearing=G().inverse(obs.latitude,obs.longitude,target.latitude,target.longitude).azimuth,project=align.viewProjector(bearing,0);
 const vertices=m.vertices.map(([e,n,h])=>{const p=world(target,e,n,h),g=align.geometryFrom(obs,{...target,...p,parts:[{id:'__surface',m:h}]},{eyeM:obs.eyeM??1.5,heightM:h}),xy=project(g.azimuth,g.angle),depth=g.distanceKm*1000*Math.cos((g.azimuth-bearing)*rad);return {e,n,h,xy,depth};});
 const solids=m.faces.map((f,i)=>{const pts=f.map(j=>vertices[j]);if(!pts.length||pts.some(v=>!v.xy||v.depth<=0))return null;return {triangles:m.surfaceTriangles[i],box:[Math.min(...pts.map(v=>v.xy[0])),Math.min(...pts.map(v=>v.xy[1])),Math.max(...pts.map(v=>v.xy[0])),Math.max(...pts.map(v=>v.xy[1]))]};});
 return cached={key,vertices,solids,project,model:m,bearing};
}
function bary(a,b,c,p){const det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(det)<1e-12)return null;const u=((b[1]-c[1])*(p[0]-c[0])+(c[0]-b[0])*(p[1]-c[1]))/det,v=((c[1]-a[1])*(p[0]-c[0])+(a[0]-c[0])*(p[1]-c[1]))/det;return [u,v,1-u-v].every(x=>x>=-1e-7)?[u,v,1-u-v]:null;}
function composition(f,obs,target,p,limb='center'){const bearing=G().inverse(target.latitude,target.longitude,obs.latitude,obs.longitude).azimuth*rad;return {basis:'scene-surface',modelId:f.model.id,modelSignature:f.model.signature,targetFrame:targetFrame(target),eastM:p.e,northM:p.n,heightM:p.h,xM:-Math.cos(bearing)*p.e+Math.sin(bearing)*p.n,limb,approximate:true};}
function pick({obs,target,align,azimuth,altitude,limb='center'}){const f=frame(obs,target,align),q=f?.project(azimuth,altitude);if(!q)return null;let best=null;
 for(const solid of f.solids){if(!solid)continue;const b=solid.box;if(q[0]<b[0]-1e-8||q[0]>b[2]+1e-8||q[1]<b[1]-1e-8||q[1]>b[3]+1e-8)continue;
  for(const ids of solid.triangles){const v=ids.map(i=>f.vertices[i]),weights=bary(...v.map(p=>p.xy),q);if(!weights)continue;const inv=weights.reduce((s,x,i)=>s+x/v[i].depth,0),depth=1/inv;if(!(depth>0)||best&&depth>=best.depth)continue;const mu=weights.map((x,i)=>x/v[i].depth/inv);best={v,mu,depth};}
 }
 if(!best)return null;
 // Refine in the selected triangle using the exact same geographic projection as the scene.
 let [u,v]=best.mu;const pts=best.v,point=(u,v)=>({e:pts[0].e*u+pts[1].e*v+pts[2].e*(1-u-v),n:pts[0].n*u+pts[1].n*v+pts[2].n*(1-u-v),h:pts[0].h*u+pts[1].h*v+pts[2].h*(1-u-v)}),at=(u,v)=>{const p=point(u,v),c=composition(f,obs,target,p),g=geometry(obs,target,c,align);return f.project(g.azimuth,g.angle);};
 for(let i=0;i<5;i++){const p=at(u,v);if(!p)return null;const x=p[0]-q[0],y=p[1]-q[1];if(Math.hypot(x,y)<1e-8)break;const d=1e-4,a=at(u+d,v),b=at(u,v+d);if(!a||!b)return null;const j00=(a[0]-p[0])/d,j10=(a[1]-p[1])/d,j01=(b[0]-p[0])/d,j11=(b[1]-p[1])/d,det=j00*j11-j01*j10;if(Math.abs(det)<1e-14)return null;u-=(j11*x-j01*y)/det;v-=(-j10*x+j00*y)/det;}
 if(u<-.002||v<-.002||u+v>1.002)return null;const p=point(u,v),back=at(u,v);if(!back||Math.hypot(back[0]-q[0],back[1]-q[1])>1e-5)return null;return composition(f,obs,target,p,limb);
}
function preset({obs,target,align,heightM,xM=0,limb='center'}){const m=model(align,target);if(!m||!Number.isFinite(heightM)||!Number.isFinite(xM))return null;const bearing=G().inverse(target.latitude,target.longitude,obs.latitude,obs.longitude).azimuth*rad,right=p=>-Math.cos(bearing)*p[0]+Math.sin(bearing)*p[1],front=p=>Math.sin(bearing)*p[0]+Math.cos(bearing)*p[1],z=heightM;let chosen=null,depth=-Infinity;
 for(const triangles of m.surfaceTriangles)for(const ids of triangles){const verts=ids.map(i=>m.vertices[i]);if(z<Math.min(...verts.map(p=>p[2]))-1e-7||z>Math.max(...verts.map(p=>p[2]))+1e-7)continue;const cut=[];for(let i=0;i<3;i++){const a=verts[i],b=verts[(i+1)%3];if(Math.abs(a[2]-z)<1e-7)cut.push(a);if((a[2]<z&&b[2]>z)||(a[2]>z&&b[2]<z)){const t=(z-a[2])/(b[2]-a[2]);cut.push(a.map((x,j)=>x+t*(b[j]-x)));}}
  for(let i=0;i<cut.length;i++)for(let j=i+1;j<cut.length;j++){const a=cut[i],b=cut[j],ra=right(a),rb=right(b);if(xM<Math.min(ra,rb)-1e-7||xM>Math.max(ra,rb)+1e-7)continue;const t=Math.abs(rb-ra)<1e-9?(front(a)>front(b)?0:1):(xM-ra)/(rb-ra),p=a.map((x,k)=>x+t*(b[k]-x)),d=front(p);if(d>depth){chosen=p;depth=d;}}
 }
 return chosen?composition({model:m},obs,target,{e:chosen[0],n:chosen[1],h:heightM},limb):null;
}
function visible({obs,target,align,composition:c,toleranceM=.5}){if(!model(align,target)||!compatible(c,target,align))return {known:false,visible:false};const g=geometry(obs,target,c,align),first=pick({obs,target,align,azimuth:g.azimuth,altitude:g.angle});if(!first)return {known:false,visible:false};const distance=Math.hypot(first.eastM-c.eastM,first.northM-c.northM,first.heightM-c.heightM);return {known:true,visible:distance<=toleranceM,distanceM:distance};}
return {model,bounds,compatible,anchor,geometry,pick,preset,visible};
});
