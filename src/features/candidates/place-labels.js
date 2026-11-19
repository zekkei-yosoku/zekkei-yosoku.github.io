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
 const p=row.place,address=resolve(addresses,p,'census-town-areas'),facility=resolve(facilities,p,'osm-named-areas');
 const area=address.status==='matched'?address.names[0]:'',fallback=facility.status==='matched'?facility.names.join('／'):area;
 const riverName=row.placeKind==='riverbank'&&typeof row.sourceEvidence?.riverName==='string'?row.sourceEvidence.riverName.trim():'';
 let name=p.name;
 if(riverName&&(!name||name==='河川沿いの歩道'||/^(?:撮影候補|モデル候補)/.test(name)))name=riverName+'沿いの歩道';
 else if(fallback&&(!name||/^(?:撮影候補|モデル候補)/.test(name)))name=fallback+'（モデル候補）';
 return {...row,place:{...p,name,subtitle:area,...(riverName?{riverName}:{})},labels:{address,facility,coordinate:point(p)?p.latitude.toFixed(5)+', '+p.longitude.toFixed(5):'',addressYear:addresses?.year??null,facilityDataDate:facilities?.dataDate??null}};
}
function townFiles(index,p){
 if(index?.version!==1||!Array.isArray(index.wards)||!point(p))return [];
 return index.wards.filter(ward=>/^\d{5}\.json$/.test(ward?.file)&&/^[0-9a-f]{64}$/.test(ward.sha256)&&
  Array.isArray(ward.bbox)&&ward.bbox.length===4&&ward.bbox.every(Number.isFinite)&&within(p,ward.bbox));
}
function townAddress(layers,p){
 const matches=layers.map(layer=>resolve(layer,p,'census-town-areas'));
 if(matches.some(r=>['boundary','ambiguous','unavailable'].includes(r.status)))return null;
 const found=matches.filter(r=>r.status==='matched');
 if(new Set(found.flatMap(r=>r.names)).size!==1)return null;
 return {status:'matched',names:found[0].names,sourceIds:found.flatMap(r=>r.sourceIds)};
}
// Roads are display context, not permission to stand or evidence of visibility.
// Decode just the two line layers. The calculation bundle and its cache key stay unchanged.
function roadLines(bytes){
 const u=new Uint8Array(bytes),text=new TextDecoder();let p=0;
 const vi=()=>{let n=0,s=0;for(let i=0;i<10&&p<u.length;i++){const b=u[p++];n+=(b&127)*2**s;if(b<128)return n;s+=7;}throw Error('road-varint');};
 const end=()=>{const n=vi(),e=p+n;if(e>u.length)throw Error('road-length');return e;};
 const skip=w=>{if(w===0)vi();else if(w===1)p+=8;else if(w===2)p=end();else if(w===5)p+=4;else throw Error('road-wire');if(p>u.length)throw Error('road-truncated');};
 const str=()=>{const e=end(),s=text.decode(u.subarray(p,e));p=e;return s;},zz=n=>(n>>>1)^-(n&1),out={};
 while(p<u.length){const t=vi();if(t!==26){skip(t&7);continue;}const le=end(),rows=[],keys=[],values=[];let name='',extent=4096;
  while(p<le){const t=vi(),f=t>>3,w=t&7;
   if(f===1&&w===2)name=str();
   else if(f===5&&w===0)extent=vi();
   else if(f===3&&w===2)keys.push(str());
   else if(f===4&&w===2){const ve=end();let v=null;while(p<ve){const t=vi(),f=t>>3,w=t&7;if(f===1&&w===2)v=str();else if([4,5,6,7].includes(f)&&w===0){v=vi();if(f===6)v=zz(v);}else skip(w);}values.push(v);}
   else if(f===2&&w===2){const fe=end(),tags=[],geom=[];let type=0;
    while(p<fe){const t=vi(),f=t>>3,w=t&7;if(f===3&&w===0)type=vi();else if((f===2||f===4)&&w===2){const e=end(),a=f===2?tags:geom;while(p<e)a.push(vi());}else skip(w);}
    if(type===2)rows.push({tags,geom});
   }else skip(w);
  }
  if(name!=='RdCL'&&name!=='RdEdg')continue;
  if(!(extent>0&&extent<=65536))throw Error('road-extent');
  out[name]={extent,features:rows.map(({tags,geom})=>{const attrs={};for(let i=0;i<tags.length;i+=2)attrs[keys[tags[i]]]=values[tags[i+1]];
   const lines=[];let x=0,y=0,line=null;for(let i=0;i<geom.length;){const c=geom[i++],id=c&7,count=c>>3;if(![1,2].includes(id)||count>geom.length)throw Error('road-command');
    for(let j=0;j<count;j++){if(i+1>=geom.length)throw Error('road-geometry');x+=zz(geom[i++]);y+=zz(geom[i++]);if(id===1){line=[];lines.push(line);}if(!line)throw Error('road-line');line.push([x/extent,y/extent]);}}
   return {attrs,lines};})};
 }
 return out;
}
const tileXY=p=>[(p.longitude+180)/360*65536,(1-Math.asinh(Math.tan(p.latitude*rad))/Math.PI)/2*65536];
function roadMatch(p,tiles){
 if(!point(p)||!tiles.length||tiles.some(t=>!t))return null;
 const [x,y]=tileXY(p),scale=Math.cos(p.latitude*rad)*40075016.686/65536,lines=[],edges=[];
 for(const t of tiles){
  const px=x-t.x,py=y-t.y;
  // Never turn a roof or water polygon into a ground road.
  if(inTileArea(t.water,px,py)||inTileArea(t.buildings,px,py))return null;
  for(const [layer,out]of [[t.roads.RdCL,lines],[t.roads.RdEdg,edges]])for(const f of layer?.features||[]){
   if(f.attrs.vt_lvorder!=null&&f.attrs.vt_lvorder!==0)continue;
   if(out===lines&&f.attrs.vt_code!==2701)continue; // normal ground roads only; no bridges or tunnels
   for(const l of f.lines)out.push({attrs:f.attrs,points:l.map(q=>[(q[0]+t.x-x)*scale,(q[1]+t.y-y)*scale])});
  }
 }
 // The map's vt_width is a drawing width, not a measured safe corridor. Require
 // real road edges on both sides of the centreline and the point between them.
 const nearest=points=>{let best=null;for(let i=1;i<points.length;i++){const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],d=dx*dx+dy*dy;if(!d)continue;
  const t=Math.max(0,Math.min(1,-(a[0]*dx+a[1]*dy)/d)),q=[a[0]+t*dx,a[1]+t*dy],distance=Math.hypot(...q);
  if(!best||distance<best.distance)best={q,distance,interior:t>0&&t<1,direction:[dx/Math.sqrt(d),dy/Math.sqrt(d)],normal:distance>1e-6?[-q[0]/distance,-q[1]/distance]:[-dy/Math.sqrt(d),dx/Math.sqrt(d)]};}return best;};
 const candidates=lines.map(l=>({...l,near:nearest(l.points)})).filter(l=>l.near?.interior&&l.near.distance<30).sort((a,b)=>a.near.distance-b.near.distance);
 const widths={'3m未満':[0,3],'3m-5.5m未満':[3,5.5],'5.5m-13m未満':[5.5,13],'13m-19.5m未満':[13,19.5],'19.5m以上':[19.5,60]};
 for(const l of candidates){const {q,normal:v,distance,direction}=l.near,range=widths[l.attrs.vt_rnkwidth];if(!range)continue;let left=-Infinity,right=Infinity;
  for(const edge of edges)for(let i=1;i<edge.points.length;i++){const a=edge.points[i-1],b=edge.points[i],dx=b[0]-a[0],dy=b[1]-a[1],den=v[0]*dy-v[1]*dx;if(Math.abs(den)<1e-8)continue;
   if(Math.abs(direction[0]*dx+direction[1]*dy)<Math.hypot(dx,dy)*Math.cos(Math.PI/6))continue;
   const ax=a[0]-q[0],ay=a[1]-q[1],t=(ax*dy-ay*dx)/den,u=(ax*v[1]-ay*v[0])/den;
   if(u<0||u>1||Math.abs(t)>30)continue;if(t>=0)right=Math.min(right,t);else left=Math.max(left,t);
  }
  const width=right-left;
  if(Number.isFinite(width)&&width>=range[0]&&width<=range[1]&&Math.abs(right+left)<=Math.max(2,.35*width)&&
   left<-.5&&right>.5&&distance<=right-.3)return {kind:'road',source:'gsi-road-edges',distanceM:distance};
 }
 return null;
}
function inTileArea(area,x,y){
 if(!area)return false;const px=x*area.extent,py=y*area.extent;
 return area.polys.some(rings=>{let inside=false;for(const ring of rings)for(let i=0,j=ring.length-1;i<ring.length;j=i++){
  const a=ring[i],b=ring[j];if((a[1]>py)!==(b[1]>py)&&px<(b[0]-a[0])*(py-a[1])/(b[1]-a[1])+a[0])inside=!inside;
 }return inside;});
}
// Facility context uses the same complete OSM geometry as candidate discovery.
// A nearby park name or viewpoint is not proof that the observer is inside it.
function facilityMatch(p,features){
 if(!point(p))return null;const kinds=new Set(),sourceIds=[];
 for(const f of features||[]){
  if(f.geometryIncomplete)continue;
  const t=f.tags||{},kind=t.tourism==='viewpoint'||t['tower:type']==='observation'?'viewpoint':t.place==='square'?'plaza':t.leisure==='garden'?'garden':['park','recreation_ground'].includes(t.leisure)?'park':null;
  if(!kind)continue;
  const area=f.polygons?.some(poly=>inside(poly[0],p)&&!poly.slice(1).some(r=>inside(r,p))&&poly.every(r=>edgeDistance(r,p)>=1));
  const exact=f.position&&Math.hypot((p.longitude-f.position.longitude)*Math.cos(p.latitude*rad),p.latitude-f.position.latitude)*111195<=1;
  if(area||exact){kinds.add(kind);sourceIds.push(f.id);}
 }
 return kinds.size?{kind:[...kinds][0],kinds:[...kinds],source:'osm-facility-geometry',sourceIds}:null;
}
function createRoadContext({fetchImpl=fetch,decodeAreas,loadFacilities=null,now=Date.now,base='https://cyberjapandata.gsi.go.jp/xyz/optimal_bvmap-v1/16/'}={}){
 const tiles=new Map(),points=new Map(),jobs=new Map(),failedUntil=new Map(),key=p=>p.latitude+','+p.longitude;
 const ground=p=>point(p)&&!p.nonTerrainStructure&&(p.standAglM??p.eyeHeightAGL??p.eyeM??1.5)>=0&&(p.standAglM??p.eyeHeightAGL??p.eyeM??1.5)<=3&&Math.abs(p.latitude)<85;
 async function tile(x,y){
  const k=x+'/'+y;if(tiles.has(k))return tiles.get(k);if((failedUntil.get(k)||0)>now())throw Error('road-retry-later');
  const job=(async()=>{const r=await fetchImpl(base+k+'.pbf',{priority:'low',signal:globalThis.AbortSignal?.timeout?.(8000)});if(!r.ok)throw Error('road-tile');
   const b=await r.arrayBuffer();if(b.byteLength>2000000)throw Error('road-size');return {x,y,roads:roadLines(b),water:decodeAreas(new Uint8Array(b),'WA'),buildings:decodeAreas(new Uint8Array(b),'BldA')};})();
  tiles.set(k,job);if(tiles.size>48)tiles.delete(tiles.keys().next().value);
  try{const value=await job;failedUntil.delete(k);return value;}catch(e){if(tiles.get(k)===job)tiles.delete(k);failedUntil.set(k,now()+5000);if(failedUntil.size>48)failedUntil.delete(failedUntil.keys().next().value);throw e;}
 }
 function peek(p){return ground(p)?points.get(key(p))||null:null;}
 async function read(p){
  if(!ground(p))return null;const k=key(p);if(points.has(k))return points.get(k);if(jobs.has(k))return jobs.get(k);
  const job=(async()=>{
   // A failed facility read must not block existing roads or permanently cache a
   // weaker road/null result. Reuse tile reads and retry the facility after cooldown.
   let facilityFailed=false;const fk='facility/'+k;
   if(loadFacilities){
    if((failedUntil.get(fk)||0)>now())facilityFailed=true;
    else try{const value=facilityMatch(p,await loadFacilities(p));failedUntil.delete(fk);if(value){points.set(k,value);if(points.size>512)points.delete(points.keys().next().value);return value;}}
    catch{facilityFailed=true;failedUntil.set(fk,now()+5000);if(failedUntil.size>48)failedUntil.delete(failedUntil.keys().next().value);}
   }
   const [x,y]=tileXY(p),pad=65/(Math.cos(p.latitude*rad)*40075016.686/65536),pending=[];
   for(let ix=Math.floor(x-pad);ix<=Math.floor(x+pad);ix++)for(let iy=Math.floor(y-pad);iy<=Math.floor(y+pad);iy++)pending.push(tile(ix,iy));
   const data=await Promise.all(pending),value=roadMatch(p,data);if(!facilityFailed){points.set(k,value);if(points.size>512)points.delete(points.keys().next().value);}return value;
  })();jobs.set(k,job);try{return await job;}catch{return null;}finally{jobs.delete(k);}
 }
 return {read,peek};
}
return {resolve,enrich,edgeDistance,townFiles,townAddress,roadLines,roadMatch,facilityMatch,createRoadContext};
});
