/* Trial picking on the existing drawing's convex volumes. This is approximate drawing geometry, not surveyed PLATEAU geometry. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesTrialSurface=api;})(globalThis,function(){
'use strict';
const rad=Math.PI/180,G=()=>globalThis.AstroNotesTerrain||(typeof require==='function'?require('../../astronotes-terrain.js'):null),hulls=globalThis.AstroNotesTrialSurfaceHulls||(typeof require==='function'?require('./scene-hulls.js'):null);
let cached=null;const modelChecks=new WeakMap();
const targetFrame=t=>JSON.stringify([t.id,t.latitude,t.longitude,t.groundM,t.parts[0].m]);
function compatible(c,t){return c.modelId===hulls.modelId&&c.targetFrame===targetFrame(t);}
function model(align,target){const m=(globalThis.AstroNotesTowerModels||align.TOWER_MODELS)?.[target.id];if(m?.geoVertices||m?.heightMode&&m.heightMode!=='scale'||target.id!=='skytree'||m?.id!==hulls?.modelId||m?.vertices?.length!==hulls.vertexCount||m?.faces?.length!==hulls.triangles.length)return null;if(!modelChecks.has(m)){const text=JSON.stringify({vertices:m.vertices,faces:m.faces,heightM:m.heightM});let h=2166136261;for(let i=0;i<text.length;i++)h=Math.imul(h^text.charCodeAt(i),16777619);modelChecks.set(m,(h>>>0)===hulls.signature);}return modelChecks.get(m)?m:null;}
function world(target,eastM,northM,heightM){return {...G().destination(target.latitude,target.longitude,Math.atan2(eastM,northM)/rad,Math.hypot(eastM,northM)/1000),heightM};}
function anchor(target,c){return world(target,c.eastM,c.northM,c.heightM);}
function geometry(obs,target,c,align){const p=anchor(target,c);return {anchor:p,...align.geometryFrom(obs,{...target,latitude:p.latitude,longitude:p.longitude},{eyeM:obs.eyeM??1.5,heightM:c.heightM})};}
function frame(obs,target,align){const m=model(align,target);if(!m)return null;const key=JSON.stringify([obs.latitude,obs.longitude,obs.elevation,obs.eyeM,target.latitude,target.longitude,target.groundM,target.parts[0].m,m.id,globalThis.AstroNotesAtmosphere?.targetK?.()]);if(cached?.key===key)return cached;
 const bearing=G().inverse(obs.latitude,obs.longitude,target.latitude,target.longitude).azimuth,project=align.viewProjector(bearing,0),ground=target.groundM??0,top=target.parts[0].m-ground,scale=top/m.heightM;
 const vertices=m.vertices.map(([e,n,z])=>{const h=ground+z*scale,p=world(target,e,n,h),g=align.geometryFrom(obs,{...target,...p},{eyeM:obs.eyeM??1.5,heightM:h}),xy=project(g.azimuth,g.angle),depth=g.distanceKm*1000*Math.cos((g.azimuth-bearing)*rad);return {e,n,h,xy,depth};});
 const solids=m.faces.map((f,i)=>{const pts=f.map(j=>vertices[j]);if(pts.some(v=>!v.xy||v.depth<=0))return null;return {triangles:hulls.triangles[i],box:[Math.min(...pts.map(v=>v.xy[0])),Math.min(...pts.map(v=>v.xy[1])),Math.max(...pts.map(v=>v.xy[0])),Math.max(...pts.map(v=>v.xy[1]))]};});
 return cached={key,vertices,solids,project,model:m,bearing,scale,ground};
}
function bary(a,b,c,p){const det=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);if(Math.abs(det)<1e-12)return null;const u=((b[1]-c[1])*(p[0]-c[0])+(c[0]-b[0])*(p[1]-c[1]))/det,v=((c[1]-a[1])*(p[0]-c[0])+(a[0]-c[0])*(p[1]-c[1]))/det;return [u,v,1-u-v].every(x=>x>=-1e-7)?[u,v,1-u-v]:null;}
function composition(f,obs,target,p,limb='center'){const bearing=G().inverse(target.latitude,target.longitude,obs.latitude,obs.longitude).azimuth*rad;return {basis:'scene-surface',modelId:f.model.id,targetFrame:targetFrame(target),eastM:p.e,northM:p.n,heightM:p.h,xM:-Math.cos(bearing)*p.e+Math.sin(bearing)*p.n,limb};}
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
function preset({obs,target,align,heightM,xM=0,limb='center'}){const m=model(align,target);if(!m||!Number.isFinite(heightM)||!Number.isFinite(xM))return null;const bearing=G().inverse(target.latitude,target.longitude,obs.latitude,obs.longitude).azimuth*rad,right=p=>-Math.cos(bearing)*p[0]+Math.sin(bearing)*p[1],front=p=>Math.sin(bearing)*p[0]+Math.cos(bearing)*p[1],ground=target.groundM??0,scale=(target.parts[0].m-ground)/m.heightM,z=(heightM-ground)/scale;let chosen=null,depth=-Infinity;
 for(const triangles of hulls.triangles)for(const ids of triangles){const verts=ids.map(i=>m.vertices[i]);if(z<Math.min(...verts.map(p=>p[2]))-1e-7||z>Math.max(...verts.map(p=>p[2]))+1e-7)continue;const cut=[];for(let i=0;i<3;i++){const a=verts[i],b=verts[(i+1)%3];if(Math.abs(a[2]-z)<1e-7)cut.push(a);if((a[2]<z&&b[2]>z)||(b[2]<z&&a[2]>z)){const t=(z-a[2])/(b[2]-a[2]);cut.push(a.map((x,j)=>x+t*(b[j]-x)));}}
  for(let i=0;i<cut.length;i++)for(let j=i+1;j<cut.length;j++){const a=cut[i],b=cut[j],ra=right(a),rb=right(b);if(xM<Math.min(ra,rb)-1e-7||xM>Math.max(ra,rb)+1e-7)continue;const t=Math.abs(rb-ra)<1e-9?(front(a)>front(b)?0:1):(xM-ra)/(rb-ra),p=a.map((x,k)=>x+t*(b[k]-x)),d=front(p);if(d>depth){chosen=p;depth=d;}}
 }
 return chosen?composition({model:m},obs,target,{e:chosen[0],n:chosen[1],h:heightM},limb):null;
}
function visible({obs,target,align,composition:c,toleranceM=.5}){if(!model(align,target)||!compatible(c,target))return {known:false,visible:false};const g=geometry(obs,target,c,align),first=pick({obs,target,align,azimuth:g.azimuth,altitude:g.angle});if(!first)return {known:false,visible:false};const distance=Math.hypot(first.eastM-c.eastM,first.northM-c.northM,first.heightM-c.heightM);return {known:true,visible:distance<=toleranceM,distanceM:distance};}
return {model,compatible,anchor,geometry,pick,preset,visible};
});
