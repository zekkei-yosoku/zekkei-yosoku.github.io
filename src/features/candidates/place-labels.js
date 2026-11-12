/* Display labels only: never move a candidate or change its visibility evidence. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateLabels=api;})(globalThis,function(){
'use strict';
const cache=new WeakMap(),rad=Math.PI/180;
const point=p=>p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)&&Math.abs(p.latitude)<=90&&Math.abs(p.longitude)<=180;
const within=(p,b)=>p.longitude>=b[0]&&p.longitude<=b[2]&&p.latitude>=b[1]&&p.latitude<=b[3];
function inside(r,p){let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>p.latitude)!==(r[j][1]>p.latitude)&&p.longitude<(r[j][0]-r[i][0])*(p.latitude-r[i][1])/(r[j][1]-r[i][1])+r[i][0])yes=!yes;return yes;}
function edgeDistance(r,p){const k=Math.cos(p.latitude*rad);let distance=Infinity;for(let i=1;i<r.length;i++){const a=r[i-1],b=r[i],x=(b[0]-a[0])*k,y=b[1]-a[1],u=Math.max(0,Math.min(1,((p.longitude-a[0])*k*x+(p.latitude-a[1])*y)/(x*x+y*y||1)));
distance=Math.min(distance,Math.hypot((p.longitude-a[0])*k-u*x,p.latitude-a[1]-u*y)*111195);}return distance;}
function prepared(data,kind){
 if(!data||typeof data!=='object')return null;const previous=cache.get(data);if(previous?.kind===kind)return previous.result;
 const ring=r=>Array.isArray(r)&&r.length>=4&&r.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)&&Math.abs(p[0])<=180&&Math.abs(p[1])<=90)&&r[0][0]===r.at(-1)[0]&&r[0][1]===r.at(-1)[1];
 const box=b=>Array.isArray(b)&&b.length===4&&b.every(Number.isFinite)&&b[0]<b[2]&&b[1]<b[3];
 const valid=data.version===1&&data.kind===kind&&Array.isArray(data.coverageBboxes)&&data.coverageBboxes.every(box)&&Array.isArray(data.features)&&data.features.every(f=>typeof f.id==='string'&&typeof f.name==='string'&&f.name.trim()&&f.name.length<=300&&box(f.bbox)&&Array.isArray(f.polygons)&&
 f.polygons.length&&f.polygons.every(p=>Array.isArray(p)&&p.length&&p.every(ring)));
 const result=valid?data:null;cache.set(data,{kind,result});return result;
}
function resolve(data,p,kind){
 data=prepared(data,kind);if(!data||!point(p))return {status:'unavailable',names:[],sourceIds:[]};if(!data.coverageBboxes.some(b=>within(p,b)))return {status:'outside-coverage',names:[],sourceIds:[]};
 const matches=[];let boundary=false;
 for(const f of data.features){if(!within(p,f.bbox))continue;for(const poly of f.polygons){if(!inside(poly[0],p)||poly.slice(1).some(r=>inside(r,p)))continue;if(poly.some(r=>edgeDistance(r,p)<1)){boundary=true;continue;}matches.push(f);break;}}
 const names=[...new Set(matches.map(f=>f.name.trim()))];
 if(boundary&&(kind==='census-town-areas'||!names.length))return {status:'boundary',names:[],sourceIds:[]};
 if(!names.length)return {status:'no-area-match',names:[],sourceIds:[]};
 // An overlapping census area is ambiguous, not a reason to choose the nearest name.
 if(kind==='census-town-areas'&&names.length!==1)return {status:'ambiguous',names:[],sourceIds:[]};
 return {status:'matched',names,sourceIds:matches.map(f=>f.id)};
}
function enrich(row,{addresses=null,facilities=null}={}){
 const p=row.place,address=resolve(addresses,p,'census-town-areas'),facility=resolve(facilities,p,'osm-named-areas'),area=address.status==='matched'?address.names[0]:null,name=facility.status==='matched'?facility.names.join('／'):area;
 return {...row,place:{...p,...(name?{name:name+'（モデル候補）'}:{}),subtitle:area||'住所未確認'},labels:{address,facility,coordinate:point(p)?p.latitude.toFixed(5)+', '+p.longitude.toFixed(5):'',addressYear:addresses?.year??null,facilityDataDate:facilities?.dataDate??null}};
}
return {resolve,enrich,edgeDistance};
});
