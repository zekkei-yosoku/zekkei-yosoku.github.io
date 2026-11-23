/* Trial: acquire actual walking surfaces around inverse-search regions.
 * OSM geometry describes a mapped surface, never certifies visibility or current access.
 * No target catalog or geographic search radius is imposed here. Resource budgets
 * produce partial coverage and a resumable tile queue, not an empty-result claim.
 */
(function(root,factory){
 const D=root.AstroNotesCandidateDiscovery||(typeof require==='function'?require('./search.js'):null);
 if(!D)throw Error('candidate search.js must be loaded first');
 D.createPlaceProvider=factory();
 if(typeof module==='object'&&module.exports)module.exports=D.createPlaceProvider;
})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const RAD=Math.PI/180,M=111195,TILE=.005;
const credits=[{name:'© OpenStreetMap contributors',url:'https://www.openstreetmap.org/copyright',license:'ODbL'},{name:'国土地理院 標高・地理院地図',url:'https://maps.gsi.go.jp/development/ichiran.html'}];
const finite=x=>typeof x==='number'&&Number.isFinite(x);
const key=p=>p.longitude.toFixed(7)+','+p.latitude.toFixed(7);
const bboxPoint=(p,b)=>p.longitude>=b[0]&&p.longitude<=b[2]&&p.latitude>=b[1]&&p.latitude<=b[3];
const forbidden=t=>['private','no'].includes(t?.access)||['private','no'].includes(t?.foot);
const nonGround=t=>!!t&&(t.location==='roof'||t.location==='rooftop'||t.location==='underground'||t.indoor==='yes'||t.bridge&&t.bridge!=='no'||t.tunnel&&t.tunnel!=='no'||t.covered==='yes'||t.level!=null&&String(t.level)!=='0'||finite(Number(t.layer))&&Number(t.layer)!==0);
function hash(s){let x=2166136261;for(let i=0;i<s.length;i++){x^=s.charCodeAt(i);x=Math.imul(x,16777619);}return (x>>>0).toString(16);}
function distance(a,b){return Math.hypot((a[0]-b[0])*Math.cos((a[1]+b[1])*RAD/2),a[1]-b[1])*M;}
function inside(r,p){let yes=false;for(let i=0,j=r.length-1;i<r.length;j=i++)if((r[i][1]>p.latitude)!==(r[j][1]>p.latitude)&&p.longitude<(r[j][0]-r[i][0])*(p.latitude-r[i][1])/(r[j][1]-r[i][1])+r[i][0])yes=!yes;return yes;}
const contains=(f,p)=>(!f.bbox||bboxPoint(p,f.bbox))&&f.polygons.some(poly=>inside(poly[0],p)&&!poly.slice(1).some(r=>inside(r,p)));
const boxesMeet=(a,b)=>!a||!b||a[0]<=b[2]&&b[0]<=a[2]&&a[1]<=b[3]&&b[1]<=a[3];
const walkingSquare=f=>f.tags.highway==='pedestrian'&&(f.tags.area==='yes'||f.tags['area:highway']);
function edgeDistance(line,p,c,closest=null){let d=Infinity;for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],x=(b[0]-a[0])*c,y=b[1]-a[1],u=Math.max(0,Math.min(1,((p.longitude-a[0])*c*x+(p.latitude-a[1])*y)/(x*x+y*y||1)));
 const m=Math.hypot((p.longitude-a[0])*c-u*x,p.latitude-a[1]-u*y)*M;
 if(m<d){d=m;if(closest){closest.longitude=a[0]+(b[0]-a[0])*u;closest.latitude=a[1]+y*u;closest.axis=[a,b];}}
 }return d;}
function edgeBoxInReach(feature,p,metres,c){
 const b=feature.bbox,limit=metres/M+1e-10;
 // Use the same local projection as edgeDistance, with room for rounding at the threshold.
 return !(b?.every(finite)&&b[0]<=b[2]&&b[1]<=b[3]&&
   (Math.max(b[0]-p.longitude,p.longitude-b[2])*Math.abs(c)>limit||Math.max(b[1]-p.latitude,p.latitude-b[3])>limit));
}
function nearEdges(feature,p,metres,c){
 return edgeBoxInReach(feature,p,metres,c)&&feature.lines.some(line=>edgeDistance(line,p,c)<=metres);
}
// Look for the name of the water beside the sampled walking point. A centerline
// must actually pass through that water; proximity alone can pick a different
// river across a levee, or a river running alongside a pond.
function riverNameAt(point,waters,rivers){
 const c=Math.cos(point.latitude*RAD),nearby=[];
 let nearest=150;
 for(const water of waters){
  if(!water.polygons.length||!edgeBoxInReach(water,point,nearest+8,c))continue;
  let distance=contains(water,point)?0:Infinity;
  for(const line of water.lines)distance=Math.min(distance,edgeDistance(line,point,c));
  if(distance>150)continue;
  nearby.push({water,distance});nearest=Math.min(nearest,distance);
 }
 let name=null;
 for(const {water,distance} of nearby){
  // Nearby banks within the map's walking-width uncertainty must agree.
  if(distance>nearest+8)continue;
  if(water.geometryIncomplete)return null;
  const {water:kind,waterway}=water.tags;
  if(kind&&!['river','canal','stream'].includes(kind))return null;
  const typed=!!kind||['river','canal','stream','riverbank'].includes(waterway);
  const mapped=water.name.trim(),names=new Set();
  if(typed&&mapped)names.add(mapped);
  let namedDistance=Infinity,unnamedDistance=Infinity;
  for(const river of rivers){
   if(!edgeBoxInReach(river,point,300,c))continue;
   const closest={};let best=Infinity,contact=null;
   for(const line of river.lines){
    const metres=edgeDistance(line,point,c,closest);
    if(metres<best){best=metres;contact={...closest};}
   }
   if(best>300||!contact||!contains(water,contact))continue;
   const lineName=river.name.trim();
   if(lineName){names.add(lineName);namedDistance=Math.min(namedDistance,best);}
   else unnamedDistance=Math.min(unnamedDistance,best);
  }
  if(!mapped&&Number.isFinite(unnamedDistance)&&unnamedDistance<=namedDistance+8)return null;
  if(names.size!==1)return null;
  const found=names.values().next().value;
  if(mapped&&found!==mapped||name&&found!==name)return null;
  name=found;
 }
 return name;
}
// Retain the local river axis for grouping. Consumers compare both points
// against one axis, so reversing or bending the digitised line cannot flip a bank.
function riverBankAt(point,waters,rivers,name){
 const c=Math.cos(point.latitude*RAD);let best=null;
 for(const river of rivers){if(river.name.trim()!==name||!edgeBoxInReach(river,point,500,c))continue;
  for(const line of river.lines){const q={},d=edgeDistance(line,point,c,q);if(d>500||best&&d>=best.d||!q.axis||!waters.some(w=>contains(w,q)))continue;
   const [a,b]=q.axis,cross=(b[0]-a[0])*c*(point.latitude-a[1])-(b[1]-a[1])*(point.longitude-a[0])*c;
   best={d,side:Math.sign(cross),axis:q.axis};
  }
 }
 return best?.side?{river:name,side:best.side,axis:best.axis}:null;
}
const xy=g=>(g||[]).filter(p=>p&&finite(p.lon)&&finite(p.lat)&&Math.abs(p.lon)<=180&&Math.abs(p.lat)<=90).map(p=>[p.lon,p.lat]);
const closed=r=>r.length>=4&&distance(r[0],r[r.length-1])<.01;
// Multipolygon member fragments are joined only by equal endpoints. An unclosed
// ring is unavailable geometry, not an invitation to fill the relation's bbox.
function joinRings(lines){const todo=lines.map(x=>x.slice()),rings=[];while(todo.length){let r=todo.shift(),changed=true;while(!closed(r)&&changed){changed=false;for(let i=0;i<todo.length;i++){let b=todo[i];if(distance(r[r.length-1],b[0])<.01)r.push(...b.slice(1));
else if(distance(r[r.length-1],b[b.length-1])<.01)r.push(...b.slice(0,-1).reverse());else if(distance(r[0],b[b.length-1])<.01)r.unshift(...b.slice(0,-1));else if(distance(r[0],b[0])<.01)r.unshift(...b.slice(1).reverse());else continue;todo.splice(i,1);changed=true;break;}}if(closed(r))rings.push(r);
}return rings;}
function parseElements(elements){
 const rows=[];
 for(const e of elements){
  if(!e.tags||!['node','way','relation'].includes(e.type))continue;
  const tags={...e.tags},id=e.type+'/'+e.id,lines=[],polygons=[];let position=null,geometryIncomplete=false;
  if(e.type==='node'&&finite(e.lat)&&finite(e.lon))position={latitude:e.lat,longitude:e.lon};
  if(e.type==='way'){const r=xy(e.geometry);if(r.length>1)lines.push(r);if(closed(r))polygons.push([r]);}
  if(e.type==='relation'){
   const members=(e.members||[]).filter(m=>m.type==='way'),outer=members.filter(m=>m.role!=='inner').map(m=>xy(m.geometry)).filter(r=>r.length>1),inner=members.filter(m=>m.role==='inner').map(m=>xy(m.geometry)).filter(r=>r.length>1),outers=joinRings(outer),inners=joinRings(inner);
   geometryIncomplete=members.some(m=>!m.geometry)||outer.length>0&&!outers.length||inner.length>0&&!inners.length;
   for(const r of outers)polygons.push([r,...inners.filter(h=>inside(r,{longitude:h[0][0],latitude:h[0][1]}))]);
   lines.push(...outers);
  }
  const viewpoint=tags.tourism==='viewpoint'||tags['tower:type']==='observation';
  const kind=viewpoint?'viewpoint':tags.place==='square'?'plaza':['park','garden','recreation_ground'].includes(tags.leisure)?'park':null;
  const walking=['footway','path','pedestrian','steps'].includes(tags.highway)||['footway','pedestrian'].includes(tags['area:highway']);
  const water=tags.natural==='water'||tags.waterway==='riverbank';
  const building=!!tags.building&&tags.building!=='no';
  if(!kind&&!walking&&!water&&!building&&!['river','stream','canal'].includes(tags.waterway))continue;
  let bbox=null;for(const line of lines)for(const [lon,lat] of line){if(!bbox)bbox=[lon,lat,lon,lat];else{bbox[0]=Math.min(bbox[0],lon);bbox[1]=Math.min(bbox[1],lat);bbox[2]=Math.max(bbox[2],lon);bbox[3]=Math.max(bbox[3],lat);}}
  rows.push({id,sourceId:'osm/'+id,tags,name:tags['name:ja']||tags.name||'',kind,walking,water,building,position,polygons,lines,bbox,geometryIncomplete});
 }
 return rows;
}
function query(b){const box=[b[1],b[0],b[3],b[2]].map(x=>x.toFixed(6)).join(',');return '[out:json][timeout:18];('+[
 'nwr[leisure~"^(park|garden|recreation_ground)$"]','nwr[place=square]','nwr[tourism=viewpoint]','nwr["tower:type"=observation]',
 'way[highway~"^(footway|path|pedestrian|steps)$"]','way["area:highway"~"^(footway|pedestrian)$"]',
 'way[natural=water]','relation[natural=water]','way[waterway~"^(riverbank|river|stream|canal)$"]','way[building]','relation[building]'
 ].map(s=>s+'('+box+');').join('')+');out geom;out count;';}
// The official OSM map API is a bounded read-only fallback. It returns XML,
// including node coordinates for way references. Parse only these data tags;
// never interpret markup or resolve external entities.
function mapElements(xml){
 let rows=[];
 if(typeof xml!=='string'){
  if(!Array.isArray(xml?.elements)||xml.remark||xml.error)throw Error('incomplete-osm-map-response');
  rows=xml.elements.filter(e=>['node','way','relation'].includes(e.type)).map(e=>({type:e.type,id:e.id,tags:e.tags||{},lat:e.lat,lon:e.lon,
   ...(e.type==='way'?{refs:(e.nodes||[]).map(String)}:e.type==='relation'?{members:e.members||[]}:{})}));
 }else{
 if(!/<osm\b/.test(xml)||!/<\/osm>/.test(xml)||/<(?:error|remark)\b/.test(xml))throw Error('incomplete-osm-map-response');
 const decode=s=>s.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi,(_,x)=>x[0]==='#'?String.fromCodePoint(x[1].toLowerCase()==='x'?parseInt(x.slice(2),16):Number(x.slice(1))):({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[x]||_));
 const attrs=s=>Object.fromEntries([...s.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)].map(m=>[m[1],decode(m[2])]));
 const re=/<(node|way|relation)\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/\1\s*>)/g;let m;
 while((m=re.exec(xml))){const a=attrs(m[2]),body=m[3]||'',tags={};for(const t of body.matchAll(/<tag\b([^>]*?)\/\s*>/g)){const p=attrs(t[1]);if(p.k!=null)tags[p.k]=p.v;}
  const e={type:m[1],id:Number(a.id),tags};if(e.type==='node'){e.lat=Number(a.lat);e.lon=Number(a.lon);}else if(e.type==='way'){e.refs=[...body.matchAll(/<nd\b([^>]*?)\/\s*>/g)].map(t=>attrs(t[1]).ref);}else e.members=[...body.matchAll(/<member\b([^>]*?)\/\s*>/g)].map(t=>attrs(t[1]));rows.push(e);
 }
 }
 const nodes=new Map(rows.filter(e=>e.type==='node').map(e=>[String(e.id),e])),ways=new Map(rows.filter(e=>e.type==='way').map(e=>[String(e.id),e]));
 for(const e of ways.values()){e.geometry=e.refs.map(r=>nodes.get(r)).filter(Boolean).map(n=>({lat:n.lat,lon:n.lon}));if(e.geometry.length!==e.refs.length)e.geometry=[];delete e.refs;}
 for(const e of rows)if(e.type==='relation')e.members=e.members.map(m=>({...m,ref:Number(m.ref),geometry:m.type==='way'?ways.get(String(m.ref))?.geometry:undefined}));
 return rows;
}
function regionsFor(regions){
 const out=[];for(const [i,r] of (regions||[]).entries()){
  const b=Array.isArray(r)?r:r.bbox;if(!Array.isArray(b)||b.length!==4||!b.every(finite)||b[1]>=b[3]||b[1]<-90||b[3]>90||b[0]<-180||b[0]>180||b[2]<-180||b[2]>180||b[0]===b[2])continue;
  const meta={id:r.id||'region-'+i,priority:finite(r.priority)?r.priority:i,source:r.source||'inverse-geometry'};
  if(b[0]<b[2])out.push({...meta,bbox:b.slice()});else {out.push({...meta,bbox:[b[0],b[1],180,b[3]]},{...meta,id:meta.id+'-west',bbox:[-180,b[1],b[2],b[3]]});}
 }return out.sort((a,b)=>a.priority-b.priority);
}
function* tileQueue(regions){const seen=new Set();for(const r of regions){const b=r.bbox;for(let y=Math.floor(b[1]/TILE);y<=Math.floor((b[3]-1e-10)/TILE);y++)for(let x=Math.floor(b[0]/TILE);x<=Math.floor((b[2]-1e-10)/TILE);x++){
 const id=x+':'+y;if(seen.has(id))continue;seen.add(id);
 yield {id,bbox:[Math.max(-180,x*TILE),Math.max(-90,y*TILE),Math.min(180,(x+1)*TILE),Math.min(90,(y+1)*TILE)],regionId:r.id};
 }}}
function sampleFeatures(features,regions,{spacingM=30,maxPoints=480,skipPoints=0,pointKinds}={}){
 const generationBudget=maxPoints+skipPoints;
 const areas=features.filter(f=>f.kind&&f.polygons.length),waters=features.filter(f=>f.water),rivers=features.filter(f=>['river','canal'].includes(f.tags.waterway)),buildings=features.filter(f=>f.building),groups=[],unknownGeometry=features.filter(f=>f.geometryIncomplete).map(f=>f.id);
 let generationLimited=false,excludedPoints=0,excludedFeatures=0;
 const surfaces=new Map(),excluded=features.filter(f=>(f.water||f.building||forbidden(f.tags)||nonGround(f.tags))&&f.polygons.length);
 const surfaceFor=(f,area,p)=>{
  const direct={polygons:f.walking&&(f.tags.area==='yes'||f.tags['area:highway'])?f.polygons:[],lines:f.walking&&f.tags.area!=='yes'&&!f.tags['area:highway']?f.lines:[],...(f.position?{position:f.position}:{})};
  if(!f.walking||!area||!area.polygons.length||area===f)return direct;
  const id=f.id+'/'+area.id;if(surfaces.has(id))return surfaces.get(id);
  // Reuse the movement boundary intersections, on this source only. Never
  // extend a park seed onto connected roads outside its actual place.
  const constraints=[area,...excluded.filter(x=>x!==f&&x!==area)].map(x=>({...x,walking:false}));
  const domain=movementDomain({...p,placeId:area.sourceId,surfaceId:f.sourceId},[f,...constraints],{radiusM:Infinity,allComponents:true});
  const shape=domain?.geometry||{polygons:[],lines:[]};surfaces.set(id,shape);return shape;
 };
 const inRegion=p=>regions.some(r=>bboxPoint(p,r.bbox));
 for(const f of features){
  if(forbidden(f.tags)||(!f.walking&&f.kind!=='viewpoint'))continue;
  if(f.geometryIncomplete)continue;
  const intrinsic=f.kind==='viewpoint'?'viewpoint':walkingSquare(f)?'plaza':null;
  if(pointKinds&&!pointKinds.has('sidewalk')&&!pointKinds.has('riverbank')&&!pointKinds.has(intrinsic)&&
   !areas.some(a=>pointKinds.has(a.kind)&&boxesMeet(a.bbox,f.bbox))){excludedFeatures++;continue;}
  const candidates=[];
  const addCandidate=p=>{
   if(!inRegion(p))return;
   const containers=areas.filter(a=>contains(a,p));if(containers.some(a=>forbidden(a.tags)))return;
   const water=waters.find(a=>contains(a,p));if(water&&!nonGround(f.tags))return;
   const roofArea=containers.find(a=>nonGround(a.tags)),building=buildings.find(a=>contains(a,p)),viewpoint=containers.find(a=>a.kind==='viewpoint');
   const square=containers.find(a=>a.kind==='plaza'),park=containers.find(a=>a.kind==='park');
   const longitudeScale=Math.cos(p.latitude*RAD);
   const river=!viewpoint&&!square&&!park&&rivers.find(a=>nearEdges(a,p,80,longitudeScale));
   const riverArea=!park&&containers.find(a=>/河川敷|川テラス|川緑道|riverbank|riverside/i.test(a.name));
   const riverPath=!park&&/河川敷|川.*テラス|riverside|riverbank/i.test(f.name)&&waters.some(a=>nearEdges(a,p,80,longitudeScale));
   // A levee-top path stands well back from a wide river's centre line: within 150 m of its water and
   // 300 m of the centre line it is the riverbank, while streets behind the levee are not.
   const wideRiver=!park&&rivers.find(a=>a.tags.waterway==='river'&&nearEdges(a,p,300,longitudeScale))&&waters.some(a=>nearEdges(a,p,150,longitudeScale));
   const riverside=riverArea||riverPath||river&&waters.some(a=>nearEdges(a,p,80,longitudeScale))||wideRiver;
   const area=viewpoint||square||(walkingSquare(f)?f:park)||riverArea;
   const placeKind=f.kind==='viewpoint'||viewpoint?'viewpoint':square||walkingSquare(f)?'plaza':park?'park':riverside?'riverbank':'sidewalk';
   if(pointKinds&&!pointKinds.has(placeKind)){excludedPoints++;return;}
   const elevated=nonGround(f.tags)||!!roofArea||!!building;
   const surface=area&&nonGround(area.tags)?area:f;
   // ele = absolute feature elevation, height = structure top, level = floor
   // index. None identifies the physical standing floor on its own.
   const floor=Number(surface.tags['floor:height']),floorSource=surface.tags['source:floor:height'];
   const knownFloor=surface.tags['floor:height']!=null&&finite(floor)&&floor>=0&&floorSource;
   const accessKnown=!![f,...containers].find(a=>['yes','public','permissive','designated'].includes(a.tags.foot)||['yes','public','permissive'].includes(a.tags.access));
   const structuralUnknown=f.kind==='viewpoint'||!!viewpoint||elevated;
   candidates.push({...p,lat:p.latitude,lon:p.longitude,placeId:'osm/'+(area||f).id,name:(area||f).name||f.name||({park:'公園の園路',plaza:'歩行広場',riverbank:'河川沿いの歩道',sidewalk:'歩道',viewpoint:'展望地点'}[placeKind]),placeKind,
    sourceId:f.sourceId,surfaceId:f.sourceId,polygonId:f.id,region:regions.find(r=>bboxPoint(p,r.bbox))?.id,
    surfaceGeometry:surfaceFor(f,area,p),
    groundM:null,groundKnown:false,surfaceAglM:knownFloor?floor:structuralUnknown?null:0,surfaceHeightM:knownFloor?floor:structuralUnknown?null:0,surfaceElevationM:null,eyeM:1.5,
    standingSurfaceKnown:false,accessKnown,structureClassificationKnown:!structuralUnknown||!!knownFloor,nonTerrainStructure:!!elevated||!!knownFloor&&floor>0,
    sourceEvidence:{kind:'osm-mapped-walking-surface',heightBasis:'surfaceAglM/surfaceHeightM:height-above-local-ground; surfaceElevationM:groundM+surfaceAglM; eyeM:height-above-surface',osmId:f.id,placeOsmId:(area||f).id,tags:{...f.tags},areaTags:area?{...area.tags}:null,
    classification:riverArea?'named-riverside-area':riverPath?'named-riverside-walkway':riverside?'mapped-river-proximity':'mapped-feature',floor:knownFloor?{heightM:floor,source:floorSource}:null,buildingContaining:building?.id||null,access:'mapped-only',vegetation:'unknown',
    actualVisibilityGuaranteed:false}
   });
  };
  if(f.kind==='viewpoint'&&f.position)addCandidate(f.position);
  // A viewpoint polygon provides no known camera location; walkable geometry
  // inside it is handled below, but its arbitrary centroid is never a deck.
  if(f.walking){
   const filled=f.tags.area==='yes'||!!f.tags['area:highway'];
   if(filled){for(const poly of f.polygons){const r=poly[0],xs=r.map(p=>p[0]),ys=r.map(p=>p[1]),a=Math.min(...ys),b=Math.max(...ys),lo=Math.min(...xs),hi=Math.max(...xs),dy=spacingM/M,dx=dy/Math.max(.01,Math.cos((a+b)*RAD/2));let count=0;
    for(const region of regions){const box=region.bbox,fromLat=Math.max(a,box[1]),toLat=Math.min(b,box[3]),fromLon=Math.max(lo,box[0]),toLon=Math.min(hi,box[2]);for(let lat=fromLat+dy/2;lat<toLat&&count<generationBudget*4;lat+=dy)for(let lon=fromLon+dx/2;lon<toLon&&count<generationBudget*4;
    lon+=dx){const p={latitude:lat,longitude:lon};if(inside(r,p)&&!poly.slice(1).some(h=>inside(h,p))){const before=candidates.length;addCandidate(p);count+=candidates.length-before;}}}if(count>=generationBudget*4)generationLimited=true;
    // Small pedestrian squares may be smaller than one grid cell.
    const p={latitude:(a+b)/2,longitude:(lo+hi)/2};if(inside(r,p)&&!poly.slice(1).some(h=>inside(h,p)))addCandidate(p);
   }}else for(const line of f.lines){for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],n=Math.max(1,Math.ceil(distance(a,b)/spacingM));for(let j=0;j<n;j++){const p={longitude:a[0]+(b[0]-a[0])*j/n,latitude:a[1]+(b[1]-a[1])*j/n};if(!inRegion(p))continue;
   if(candidates.length>=generationBudget*8){generationLimited=true;break;}addCandidate(p);}}const last=line[line.length-1];if(last)addCandidate({longitude:last[0],latitude:last[1]});}
  }
  const points=candidates;
  if(points.length){const preferred=points.filter(p=>p.placeKind!=='sidewalk'),support=points.filter(p=>p.placeKind==='sidewalk');if(preferred.length)groups.push(preferred);if(support.length)groups.push(support);}
 }
 // Round-robin surfaces within each priority group; one long path cannot consume
 // the entire budget before a small park or a viewpoint is considered.
 groups.sort((a,b)=>(a[0].placeKind==='sidewalk')-(b[0].placeKind==='sidewalk'));
 const rows=[],seen=new Set();let remaining=0,remainingWanted=0,visited=0;
 for(const priority of [false,true]){const g=groups.filter(a=>(a[0].placeKind==='sidewalk')===priority);for(let i=0;g.some(a=>i<a.length);i++)for(const a of g)if(i<a.length){const p=a[i],k=key(p)+'/'+p.surfaceId;if(seen.has(k))continue;seen.add(k);if(visited++<skipPoints)continue;
 if(rows.length<maxPoints)rows.push(p);else{remaining++;remainingWanted++;}}}
 // Enrich only the rows returned by this page. Classification, ordering and
 // height/visibility checks stay driven by the same original walking points.
 for(const p of rows)if(p.placeKind==='riverbank'&&(!pointKinds||pointKinds.has('riverbank'))){
  const name=riverNameAt(p,waters,rivers);if(name){p.sourceEvidence.riverName=name;const bank=riverBankAt(p,waters,rivers,name);if(bank)p.sourceEvidence.riverBank=bank;}
 }
 return {rows,limited:remaining>0||generationLimited,omittedPoints:remaining,remainingWanted,generationLimited,unknownGeometry,excludedPoints,excludedFeatures};
}
// Keep movement on the selected walking place. A bridge or a nearby opposite
// bank is not a continuation merely because its coordinates are close.
function movementDomain(seed,features,{radiusM=600,allComponents=false}={}){
 const origin={latitude:seed.latitude,longitude:seed.longitude},c=Math.cos(origin.latitude*RAD);
 const usable=f=>f.walking&&!f.geometryIncomplete&&!forbidden(f.tags)&&!nonGround(f.tags);
 const area=features.find(f=>f.sourceId===seed.placeId&&f.polygons.length&&(f.kind||f.tags.area==='yes'||f.tags['area:highway']))||features.find(f=>f.kind==='park'&&contains(f,origin));
 const excluded=features.filter(f=>(f.water||f.building||forbidden(f.tags)||nonGround(f.tags))&&f.polygons.length);
 const riverbank=seed.placeKind==='riverbank'&&!area,waters=features.filter(f=>f.water),rivers=features.filter(f=>['river','canal'].includes(f.tags.waterway));
 const nearbySegments=rows=>rows.flatMap(f=>f.lines.flatMap(l=>l.slice(1).map((b,i)=>[l[i],b]))).filter(l=>edgeBoxInReach({bbox:[Math.min(l[0][0],l[1][0]),Math.min(l[0][1],l[1][1]),Math.max(l[0][0],l[1][0]),Math.max(l[0][1],l[1][1])]},origin,radiusM+300,c));
 const shores=riverbank?nearbySegments(waters):[],axes=riverbank?nearbySegments(rivers):[];
 const alongRiver=p=>!riverbank||shores.some(l=>edgeDistance(l,p,c)<=150)&&axes.some(l=>edgeDistance(l,p,c)<=300);
 const valid=p=>distance([origin.longitude,origin.latitude],[p.longitude,p.latitude])<=radiusM+.01&&(!area||contains(area,p))&&alongRiver(p)&&!excluded.some(f=>contains(f,p));
 const walks=features.filter(usable),nearest={};let best=Infinity,source=null;
 for(const f of walks){let d=Infinity;for(const line of f.lines)d=Math.min(d,edgeDistance(line,origin,c,nearest));
  if(f.sourceId===seed.surfaceId||f.sourceId===seed.sourceId){source=f;break;}if(d<best){best=d;source=f;}}
 if(!source||!area&&best>12&&source.sourceId!==seed.surfaceId&&source.sourceId!==seed.sourceId)return null;
 if(source.tags.area==='yes'||source.tags['area:highway']){
  const polygons=source.polygons.map(poly=>[...poly,...excluded.filter(f=>!source.bbox||!f.bbox||f.bbox[0]<=source.bbox[2]&&f.bbox[2]>=source.bbox[0]&&f.bbox[1]<=source.bbox[3]&&f.bbox[3]>=source.bbox[1]).flatMap(f=>f.polygons.map(p=>p[0]))]);
  return {origin,radiusM,label:area?.name||seed.name||'この付近の広場',kind:'plaza',sourceIds:[source.sourceId],boundary:area?.polygons||source.polygons,
   geometry:{polygons,lines:[],...(area&&area!==source?{within:area.polygons}:{})}};
 }
 const vertices=f=>f.lines.flat().filter(([lon,lat])=>distance([origin.longitude,origin.latitude],[lon,lat])<=radiusM+10);
 const key=([lon,lat])=>lon.toFixed(7)+','+lat.toFixed(7),byVertex=new Map();
 for(const f of walks)for(const p of vertices(f)){const k=key(p);if(!byVertex.has(k))byVertex.set(k,[]);byVertex.get(k).push(f);}
 const connected=new Set([source]),queue=[source];
 while(queue.length){const f=queue.shift();for(const p of vertices(f))for(const next of byVertex.get(key(p))||[]){
  if(connected.has(next))continue;connected.add(next);queue.push(next);
 }}
 // Split at every real boundary (including holes), then test the open interval.
 // This preserves concave parks and never draws a shortcut across water.
 const rings=[...(area?.polygons||[]).flat(),...excluded.flatMap(f=>f.polygons.flat())].map(r=>({r,b:r.reduce((b,p)=>[Math.min(b[0],p[0]),Math.min(b[1],p[1]),Math.max(b[2],p[0]),Math.max(b[3],p[1])],[Infinity,Infinity,-Infinity,-Infinity])})),lines=[];
 const cross=(a,b)=>a[0]*b[1]-a[1]*b[0];
 for(const f of connected)for(const line of f.lines)for(let i=1;i<line.length;i++){
  const a=line[i-1],b=line[i],v=[b[0]-a[0],b[1]-a[1]],ts=[0,1];
  for(const {r:ring,b:box} of rings){
   if(box[0]>Math.max(a[0],b[0])||box[2]<Math.min(a[0],b[0])||box[1]>Math.max(a[1],b[1])||box[3]<Math.min(a[1],b[1]))continue;
   for(let j=1;j<ring.length;j++){
   const u=ring[j-1],w=[ring[j][0]-u[0],ring[j][1]-u[1]],den=cross(v,w);if(Math.abs(den)<1e-20)continue;
   const d=[u[0]-a[0],u[1]-a[1]],t=cross(d,w)/den,r=cross(d,v)/den;if(t>0&&t<1&&r>=0&&r<=1)ts.push(t);
  }}
  const x=(a[0]-origin.longitude)*c*M,y=(a[1]-origin.latitude)*M,dx=v[0]*c*M,dy=v[1]*M,A=dx*dx+dy*dy,B=2*(x*dx+y*dy),C=x*x+y*y-radiusM*radiusM,disc=B*B-4*A*C;
  if(A>0&&disc>=0)for(const t of [(-B-Math.sqrt(disc))/(2*A),(-B+Math.sqrt(disc))/(2*A)])if(t>0&&t<1)ts.push(t);
  if(riverbank){const n=Math.ceil(distance(a,b)/20);for(let j=1;j<n;j++)ts.push(j/n);}
  const at=t=>[a[0]+v[0]*t,a[1]+v[1]*t];ts.sort((a,b)=>a-b);
  for(let j=1;j<ts.length;j++){const m=at((ts[j-1]+ts[j])/2);if(ts[j]-ts[j-1]>1e-10&&valid({longitude:m[0],latitude:m[1]}))lines.push([at(ts[j-1]),at(ts[j])]);}
 }
 if(!lines.length)return null;
 const vertex=p=>p[0].toFixed(7)+','+p[1].toFixed(7),touching=new Map();let first=0,nearestDistance=Infinity;
 lines.forEach((line,i)=>{const d=edgeDistance(line,origin,c);if(d<nearestDistance){first=i;nearestDistance=d;}for(const p of line){const k=vertex(p);if(!touching.has(k))touching.set(k,[]);touching.get(k).push(i);}});
 const reached=new Set([first]),pending=[first];while(pending.length){const i=pending.shift();for(const p of lines[i])for(const j of touching.get(vertex(p))||[])if(!reached.has(j)){reached.add(j);pending.push(j);}}
 if(!allComponents){const retained=lines.filter((_,i)=>reached.has(i));lines.splice(0,lines.length,...retained);}
 const ends=new Map(),used=new Set(),joined=[];
 lines.forEach((line,i)=>{for(const p of line){const k=vertex(p);if(!ends.has(k))ends.set(k,[]);ends.get(k).push(i);}});
 function chain(i,start){const path=[start];let at=start;
  while(!used.has(i)){used.add(i);const edge=lines[i],next=vertex(at)===vertex(edge[0])?edge[1]:edge[0];path.push(next);at=next;
   const following=ends.get(vertex(at));if(following.length!==2)break;const j=following.find(j=>!used.has(j));if(j===undefined)break;i=j;
  }joined.push(path);}
 lines.forEach((line,i)=>{if(used.has(i))return;const end=line.find(p=>ends.get(vertex(p)).length!==2);if(end)chain(i,end);});
 lines.forEach((line,i)=>{if(!used.has(i))chain(i,line[0]);});lines.splice(0,lines.length,...joined);
 lines.sort((a,b)=>edgeDistance(a,origin,c)-edgeDistance(b,origin,c));
 return {origin,radiusM,label:area?.name||seed.name||'この付近の歩道',kind:area?.kind||seed.placeKind||'sidewalk',
  sourceIds:[...connected].map(f=>f.sourceId),boundary:area?.polygons||[],geometry:{lines,polygons:[],...(area?{within:area.polygons}:{})}};
}
function movementPoint(domain,p,maxDistanceM=20){
 if(!domain||!p||![p.latitude,p.longitude].every(finite))return null;
 if(distance([domain.origin.longitude,domain.origin.latitude],[p.longitude,p.latitude])>domain.radiusM+maxDistanceM)return null;
 const within=domain.geometry.within;
 if(distance([domain.origin.longitude,domain.origin.latitude],[p.longitude,p.latitude])<=domain.radiusM&&(!within||within.some(poly=>inside(poly[0],p)&&!poly.slice(1).some(r=>inside(r,p))))&&
  (domain.geometry.polygons||[]).some(poly=>inside(poly[0],p)&&!poly.slice(1).some(r=>inside(r,p))))return {...p,distanceM:0};
 const nearest={},c=Math.cos(p.latitude*RAD);let best=Infinity,point=null;
 for(const line of domain.geometry.lines){const d=edgeDistance(line,p,c,nearest);if(d<best){best=d;point={...nearest};}}
 return best<=maxDistanceM?{...point,distanceM:best}:null;
}
function publishedViewpoints(data,regions){
 const points=[];
 for(const p of data?.places||[]){
  const source=p.source||p.sightline?.source,basis=p.heightBasis,published=basis==='published-viewpoint',floor=['floor','standing-floor','published-floor','survey-floor'].includes(basis);
  if(p.kind!=='展望台'||!p.heightKnown||!finite(p.latitude)||!finite(p.longitude)||!finite(p.deckM)||p.deckM<0||!source||(!published&&!floor)||!regions.some(r=>bboxPoint(p,r.bbox))||['no','private'].includes(p.access?.type))continue;
  // targetIds and historical target-specific sightline evidence do not restrict
  // input, and do not prove windows/visibility for a new arbitrary target.
  points.push({latitude:p.latitude,longitude:p.longitude,lat:p.latitude,lon:p.longitude,placeId:'viewpoint/'+p.id,name:p.name,placeKind:'viewpoint',sourceId:'viewpoint/'+p.id,surfaceId:'viewpoint/'+p.id,polygonId:p.id,region:regions.find(r=>bboxPoint(p,r.bbox))?.id,
   surfaceGeometry:{polygons:[],lines:[],position:{latitude:p.latitude,longitude:p.longitude}},
   groundM:null,groundKnown:false,surfaceAglM:p.deckM,surfaceHeightM:p.deckM,surfaceElevationM:null,eyeM:published?0:1.5,standingSurfaceKnown:false,accessKnown:false,structureClassificationKnown:true,nonTerrainStructure:true,heightBasis:basis,
   quality:published?'published-viewpoint-point-model':'documented-floor-point-model',
   sourceEvidence:{kind:'documented-viewpoint-point-model',source,checkedAt:p.sightline?.checkedAt||null,heightBasis:basis,heightM:p.deckM,reference:'height-above-local-ground',eyeHeightIncluded:published,positionBasis:'existing-point-model',physicalFloorMeasured:!published&&basis==='survey-floor',
   windowOpening:'unknown',targetVisibility:'unknown',buildingLOS:'unknown',vegetation:'unknown',actualVisibilityGuaranteed:false}
  });
 }return points;
}
// Surveyed places (data/candidate-surveyed-viewpoints.json, tools/build-surveyed-viewpoints.mjs): places looked up as seeing
// the target, with the height one stands at. 2026-11-14 ユーザー「調査済み159地点をアプリに組み込み、新しい撮影地点にも出してもいい」。
// They are offered for the targets they were surveyed for only, wherever the search's regions lie (a far mountain pass or
// an observation room is not on the line the regions follow), and the survey stands for the sight line to the target.
function surveyedViewpoints(data,targetId){
 const points=[];
 for(const p of data?.places||[]){
  if(!targetId||!p.targets?.includes(targetId)||![p.latitude,p.longitude,p.groundM,p.eyeM].every(finite)||p.eyeM<0)continue;
  const id='surveyed/'+p.id;
  const placeKind=['viewpoint','park','plaza','sidewalk','riverbank','road','unknown'].includes(p.placeKind)?p.placeKind:'unknown',e=p.categoryEvidence;
  const categoryEvidence=e&&['research-kind','research-description','mapped-category','official-description','unclassified'].includes(e.basis)&&typeof e.detail==='string'&&Array.isArray(e.sourceUrls)&&e.sourceUrls.every(u=>typeof u==='string')?
   {...e,sourceUrls:e.sourceUrls.slice()}:null;
  points.push({latitude:p.latitude,longitude:p.longitude,lat:p.latitude,lon:p.longitude,placeId:id,name:p.name,placeKind,sourceId:id,surfaceId:id,polygonId:p.id,
   surfaceGeometry:{polygons:[],lines:[],position:{latitude:p.latitude,longitude:p.longitude}},
   // The surveyed height is the lens above the stated ground or floor, so the floor is that ground itself (surfaceAglM 0):
   // a place off the terrain without a floor height is refused as standing-height-unknown (generic-evaluator.js).
   groundM:p.groundM,groundKnown:true,surfaceAglM:0,eyeM:p.eyeM,standingSurfaceKnown:true,accessKnown:false,structureClassificationKnown:true,nonTerrainStructure:p.eyeM>3||!!p.groundManual,surveyedTargets:p.targets.slice(),
   quality:'surveyed-viewpoint',
   sourceEvidence:{kind:'surveyed-viewpoint',sourceId:p.id,heightM:p.eyeM,reference:p.groundManual?'height-above-stated-floor':'height-above-local-ground',positionBasis:'representative-point',shape:p.shape,
   ...(categoryEvidence?{categoryEvidence}:{}),targetVisibility:'surveyed',actualVisibilityGuaranteed:false}
  });
 }return points;
}
function createPlaceProvider({terrain,fetchImpl=globalThis.fetch,loadViewpoints,loadSurveyed,isCurrent:providerCurrent=()=>true,maxTiles=12,maxPoints=480,timeoutMs=25000,maxDurationMs=55000,spacingM=30,endpoints,places=null}={}){
 if(!terrain)throw Error('terrain provider is required');
 const servers=endpoints||terrain.OVERPASS||[],cache=new Map(),heightCache=new Map(),nearbyCache=new Map();
 let endpointCursor=0,overpassRetryAfter=0,overpassNextRequest=0;
 async function load(plan,{regions=plan?.regions||plan?.searchRegions||[],isCurrent=()=>true,onProgress=()=>{},signal,deadline=Infinity,maxTiles:tileBudget=maxTiles,maxPoints:pointBudget=maxPoints,pointKinds,cursor,offset=0,retryFailed=true}={}){
  const wanted=pointKinds==null?null:new Set(pointKinds),pointKindsKey=wanted?JSON.stringify([...wanted].sort()):null;
  if(cursor&&typeof cursor==='object'&&'pointKindsKey'in cursor&&cursor.pointKindsKey!==pointKindsKey){cursor=null;offset=0;}
  offset=Math.max(0,Number(cursor?.offset??cursor??offset)||0);const retryTiles=Array.isArray(cursor?.retryTiles)?cursor.retryTiles:[],batchTiles=Array.isArray(cursor?.batchTiles)?cursor.batchTiles:null,pointOffset=Math.max(0,Number(cursor?.pointOffset)||0);
  const requested=regionsFor(regions),started=Date.now(),current=()=>!signal?.aborted&&Date.now()<deadline&&providerCurrent()&&isCurrent(),controller=new AbortController();
  let timedOut=false;const cancel=()=>controller.abort(),timer=setInterval(()=>{if(!current())cancel();if(Date.now()-started>maxDurationMs){timedOut=true;cancel();}},100);signal?.addEventListener('abort',cancel,{once:true});
  const coverage={status:'partial',requestedRegions:requested,fetchedRegions:[],failedRegions:[],pendingRegions:[],missing:[],osmComplete:false,samplingComplete:false,heightComplete:false,visibilityAssessed:false,actualVisibilityGuaranteed:false,queryTileDegrees:TILE};
  const merged=new Map();let nextOffset=offset,hasPending=false;
  async function bounded(promise,ms){let t,abort;return Promise.race([promise,new Promise((_,reject)=>{t=setTimeout(()=>reject(Error('timeout')),ms);}),new Promise((_,reject)=>{abort=()=>reject(Error('cancelled'));if(controller.signal.aborted)abort();
  else controller.signal.addEventListener('abort',abort,{once:true});})]).finally(()=>{clearTimeout(t);controller.signal.removeEventListener('abort',abort);});}
  async function request(url,opts={}){
   if(!current()||controller.signal.aborted)throw Error('cancelled');
   const own=new AbortController(),abort=()=>own.abort(),t=setTimeout(abort,timeoutMs);controller.signal.addEventListener('abort',abort,{once:true});opts.signal?.addEventListener('abort',abort,{once:true});
   try{return await bounded(fetchImpl(url,{...opts,signal:own.signal}),timeoutMs+50);}finally{clearTimeout(t);controller.signal.removeEventListener('abort',abort);opts.signal?.removeEventListener('abort',abort);}
  }
  async function acquire(tile){
   const previous=cache.get(tile.id);if(previous&&Date.now()-previous.at<86400000)return {...previous,cached:true};
   // Expand for containing parks/river edges, but select only inside requested
   // regions. out geom without an output bbox preserves full returned rings.
   const b=tile.bbox.map((v,i)=>v+(i<2?-.0003:.0003));b[0]=Math.max(-180,b[0]);b[1]=Math.max(-90,b[1]);b[2]=Math.min(180,b[2]);b[3]=Math.min(90,b[3]);
   // Bundled OSM places first (no Overpass round trip); Overpass only if they cannot be read.
   if(places)try{const value={features:parseElements(await bounded(places.elementsIn(b),timeoutMs)),at:Date.now(),timestamp:null,endpoint:'bundled-osm',version:'bundled',local:true};
    cache.set(tile.id,value);while(cache.size>120)cache.delete(cache.keys().next().value);return value;}catch{/* Overpass below. */}
   let reason=Date.now()<overpassRetryAfter?'overpass-cooldown':'no-overpass-endpoint',overpassAttempted=false;
   for(let attempt=0;attempt<Math.min(2,servers.length)&&current()&&!controller.signal.aborted&&(tile.retry||Date.now()>=overpassRetryAfter);attempt++){
    overpassAttempted=true;
    const endpoint=servers[(endpointCursor+attempt)%servers.length];
    try{
     if(!retryFailed){
      const delay=overpassNextRequest-Date.now();if(delay>0){let wait;try{await bounded(new Promise(resolve=>{wait=setTimeout(resolve,delay);}),delay+250);}finally{clearTimeout(wait);}}
      if(!current()||controller.signal.aborted)throw Error('cancelled');
      overpassNextRequest=Date.now()+1000;
     }
     const res=await request(endpoint,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:'data='+encodeURIComponent(query(b))});if(!res.ok)throw Error('HTTP '+res.status);const data=await bounded(res.json(),timeoutMs);
     if(data.remark||!Array.isArray(data.elements)||!data.elements.some(e=>e.type==='count'))throw Error(data.remark||'incomplete-overpass-response');
     const value={features:parseElements(data.elements),at:Date.now(),timestamp:data.osm3s?.timestamp_osm_base||null,endpoint,version:hash(JSON.stringify(data.elements))};cache.set(tile.id,value);while(cache.size>120)cache.delete(cache.keys().next().value);endpointCursor=(endpointCursor+attempt)%Math.max(1,servers.length);overpassRetryAfter=0;return value;
    }catch(e){reason=String(e.message||e);if(!retryFailed&&reason==='HTTP 429')break;}
   }if(!current()||controller.signal.aborted)throw Error('cancelled');
   // A refusal (429) waits a minute; a slow answer only briefly, as a dense Tokyo tile can take Overpass 10-20 s.
   endpointCursor=(endpointCursor+1)%Math.max(1,servers.length);if(overpassAttempted)overpassRetryAfter=Date.now()+(/429/.test(reason)?60000:20000);
   if(retryFailed&&current()&&!controller.signal.aborted)try{const endpoint='https://api.openstreetmap.org/api/0.6/map',res=await request(endpoint+'?bbox='+b.join(','));if(!res.ok)throw Error('HTTP '+res.status);
   const xml=await bounded(res.text(),timeoutMs),elements=mapElements(xml),value={features:parseElements(elements),at:Date.now(),timestamp:null,endpoint,version:hash(xml),fallback:true};cache.set(tile.id,value);return value;}catch(e){reason+='; map '+String(e.message||e);}
   throw Error(reason);
  }
  try{
   if(!requested.length)coverage.missing.push('no-search-regions');
   let visited=0,used=0;const deferredRetries=[];
   function* queue(){if(batchTiles){for(const tile of batchTiles)yield {...tile,page:true};return;}for(const tile of retryTiles)yield {...tile,retry:true};for(const tile of tileQueue(requested)){if(visited++<offset)continue;yield tile;}}
   for(const tile of queue()){
    if(!current()||controller.signal.aborted||used>=Math.max(1,tileBudget,batchTiles?.length||0)||used>0&&Date.now()-started>maxDurationMs*.55){coverage.pendingRegions.push(tile);hasPending=true;break;}
    // While Overpass is cooling down, a tile is left for the next page instead of failing, so one slow
    // answer does not turn the rest of a drained search into failed regions.
    if(!retryFailed&&!tile.retry&&!tile.page&&servers.length&&Date.now()<overpassRetryAfter&&!(cache.get(tile.id)&&Date.now()-cache.get(tile.id).at<86400000)){coverage.pendingRegions.push(tile);hasPending=true;coverage.retryAfterMs=overpassRetryAfter-Date.now();break;}
    used++;if(!tile.retry&&!tile.page)nextOffset=visited;
    try{const data=await acquire(tile);if(!current())break;coverage.fetchedRegions.push({...tile,timestamp:data.timestamp,endpoint:data.endpoint,cached:!!data.cached,version:data.version,fallback:!!data.fallback});for(const f of data.features)merged.set(f.id,f);}
    catch(e){coverage.failedRegions.push({...tile,reason:String(e.message||e)});}
    onProgress({phase:'places',fetched:coverage.fetchedRegions.length,failed:coverage.failedRegions.length,points:0});
   }
   const attemptedIds=new Set([...coverage.fetchedRegions,...coverage.failedRegions].map(r=>r.id));for(const tile of retryTiles)if(!attemptedIds.has(tile.id))deferredRetries.push(tile);
   coverage.evaluatedRegionIds=coverage.fetchedRegions.map(r=>r.id);coverage.nextCursor=batchTiles?cursor.afterCursor||null:hasPending||retryFailed&&coverage.failedRegions.length?{offset:nextOffset,retryTiles:retryFailed?[...deferredRetries,...coverage.failedRegions]:[]}:null;
   coverage.osmComplete=requested.length>0&&!hasPending&&!coverage.failedRegions.length&&offset===0&&current()&&!timedOut;
   const selectionRegions=[];for(const r of requested)for(const tile of coverage.fetchedRegions){const b=[Math.max(r.bbox[0],tile.bbox[0]),Math.max(r.bbox[1],tile.bbox[1]),Math.min(r.bbox[2],tile.bbox[2]),Math.min(r.bbox[3],tile.bbox[3])];if(b[0]<b[2]&&b[1]<b[3])selectionRegions.push({...r,bbox:b});}
   const features=[...merged.values()],sampled=batchTiles&&coverage.failedRegions.length
    // A point offset is only valid for the same complete set of tiles.
    ?{rows:[],limited:true,omittedPoints:0,unknownGeometry:[]}
    :sampleFeatures(features,selectionRegions,{spacingM,maxPoints:Math.max(1,pointBudget),skipPoints:pointOffset,pointKinds:wanted});
   let points=sampled.rows;
   // Both the generation and page budgets count only eligible place kinds.
   const limited=sampled.limited;
   if(limited&&points.length)coverage.nextCursor={offset,pointOffset:pointOffset+points.length,batchTiles:coverage.fetchedRegions.map(r=>({id:r.id,bbox:r.bbox,regionId:r.regionId})),afterCursor:coverage.nextCursor};
   else if(batchTiles&&retryFailed&&coverage.failedRegions.length)coverage.nextCursor={...cursor};
   if(coverage.nextCursor)coverage.nextCursor={...coverage.nextCursor,pointKindsKey};
   coverage.samplingComplete=!limited;coverage.omittedPoints=sampled.omittedPoints;coverage.incompleteGeometry=sampled.unknownGeometry;
   coverage.pointsExcludedByKind=sampled.excludedPoints||0;coverage.featuresExcludedByKind=sampled.excludedFeatures||0;
   if(limited)coverage.missing.push('point-budget');if(hasPending)coverage.missing.push('tile-budget-or-timeout');if(sampled.unknownGeometry.length)coverage.missing.push('incomplete-osm-geometry');
   // A small documented viewpoint supplement is independent of OSM availability.
   // Add once at the beginning; continuation pages only advance dynamic geometry.
   coverage.documentedViewpoints=0;
   if(!cursor&&offset===0&&typeof loadViewpoints==='function'&&current()&&!controller.signal.aborted)try{const supplement=publishedViewpoints(await bounded(loadViewpoints(plan,{signal:controller.signal,isCurrent:current}),timeoutMs),requested);points.unshift(...supplement);
   coverage.documentedViewpoints=supplement.length;}catch{coverage.missing.push('documented-viewpoints-unavailable');}
   // Supplements are independent of the dynamic point cursor. Apply the same
   // requested kinds before their height/water reads too.
   if(wanted){
    const sampleCount=points.length;
    points=points.filter(p=>wanted.has(p.placeKind));
    coverage.pointsExcludedByKind+=sampleCount-points.length;
   }
   // Query ground only for the sampled surfaces. GSI failures and sea sentinels
   // stay null; tileElevations() is deliberately not used (it maps failures to 0).
   terrain.resetBudget?.();
   let index=0;
   await Promise.all(Array.from({length:Math.min(4,points.length)},async()=>{while(index<points.length&&current()&&!controller.signal.aborted){const p=points[index++],k=key(p);let g=heightCache.get(k)||null;
    try{if(!g&&typeof terrain.groundElevation==='function')g=await bounded(terrain.groundElevation(p.latitude,p.longitude,{withSource:true,fetchImpl:request}),timeoutMs+250);if(g&&finite(g.elevation)&&g.source&&g.source!=='海'){heightCache.set(k,g);
    if(heightCache.size>20000)heightCache.delete(heightCache.keys().next().value);}else g=null;}catch{g=null;}
    if(!current())break;if(g){p.groundM=g.elevation;p.groundKnown=true;p.surfaceElevationM=finite(p.surfaceAglM)?g.elevation+p.surfaceAglM:null;p.standingSurfaceKnown=p.structureClassificationKnown&&finite(p.surfaceAglM);p.sourceEvidence.ground={source:g.source,heightM:g.elevation,kind:'dem'};}
   }}));
   // Worldwide data remains usable as a coarse model, with its resolution
   // explicit. Missing GSI within Japan is not quietly replaced by coarse DEM.
   const world=points.filter(p=>!p.groundKnown&&typeof terrain.inJapan==='function'&&!terrain.inJapan(p.latitude,p.longitude));
   if(world.length&&current()&&!controller.signal.aborted&&typeof terrain.fetchElevations==='function')try{const h=await bounded(terrain.fetchElevations(world,{fetchImpl:request,timeoutMs}),timeoutMs+250);world.forEach((p,i)=>{if(finite(h[i])){p.groundM=h[i];p.groundKnown=true;
   p.surfaceElevationM=finite(p.surfaceAglM)?h[i]+p.surfaceAglM:null;p.standingSurfaceKnown=p.structureClassificationKnown&&finite(p.surfaceAglM);p.sourceEvidence.ground={source:'Open-Meteo Copernicus DEM',heightM:h[i],resolutionM:90,kind:'coarse-dem'};}});
   if(!credits.some(c=>c.name==='Open-Meteo'))credits.push({name:'Open-Meteo',url:'https://open-meteo.com/en/docs/elevation-api'});}catch{/* 通信できない時は粗い標高なしで続ける */}
   // Water polygons in OSM already remove obvious water points. GSI supplies
   // additional evidence; unknown tiles do not turn into land or a global veto.
   if(points.length&&current()&&!controller.signal.aborted&&typeof terrain.waterAt==='function')try{const water=await bounded(terrain.waterAt(points,{fetchImpl:request,useDem:false}),timeoutMs+250);
   points.forEach((p,i)=>{p.sourceEvidence.water=water[i]===true?'water':water[i]===false?'land':'unknown';if(water[i]===true&&!p.nonTerrainStructure){p.excludedReason='water';p.standingSurfaceKnown=false;}});}catch{points.forEach(p=>{p.sourceEvidence.water='unknown';});}
   const kept=points.filter(p=>p.excludedReason!=='water');coverage.heightComplete=kept.every(p=>p.groundKnown&&p.standingSurfaceKnown);coverage.unknownSurfacePoints=kept.filter(p=>!p.standingSurfaceKnown).length;
   if(coverage.unknownSurfacePoints)coverage.missing.push('standing-surface-height');if(timedOut)coverage.missing.push('time-budget');if(!current())coverage.missing.push('cancelled');
   coverage.status=coverage.osmComplete&&coverage.samplingComplete&&coverage.heightComplete&&!coverage.incompleteGeometry.length&&!coverage.missing.length?'loaded':'partial';
   const version='dynamic-places-v1/'+hash(JSON.stringify([coverage.fetchedRegions.map(r=>[r.id,r.version]),kept.map(p=>[key(p),p.surfaceId,p.groundM,p.surfaceHeightM]),coverage.missing]));
   onProgress({phase:'places',fetched:coverage.fetchedRegions.length,failed:coverage.failedRegions.length,points:kept.length,partial:coverage.status!=='loaded'});
   return {version,points:kept,features,coverage,partial:coverage.status!=='loaded',cancelled:!current(),credits:credits.slice(),continuation:coverage.nextCursor?{...coverage.nextCursor,regions:requested}:null,visibilityCertified:false};
  }finally{clearInterval(timer);signal?.removeEventListener('abort',cancel);controller.abort();}
 }
 // The surveyed places of the plan's target; none when the data cannot be read (the search goes on without them).
 async function surveyed(plan){if(typeof loadSurveyed!=='function'||!plan?.target?.id)return [];try{return surveyedViewpoints(await loadSurveyed(plan),plan.target.id);}catch{return [];}}
 async function nearby(seed,{isCurrent=()=>true,radiusM=600,refresh=false}={}){
  if(![seed?.latitude,seed?.longitude].every(finite)||!isCurrent())return null;
  const lat=Number(seed.latitude.toFixed(3)),lon=Number(seed.longitude.toFixed(3)),reach=Math.min(radiusM,250),id=lat+','+lon+','+reach,pad=(reach+80)/M;
  const domainKey=JSON.stringify([seed.latitude,seed.longitude,radiusM,seed.placeKind,seed.placeId,seed.surfaceId,seed.sourceId,seed.name]);
  if(refresh)nearbyCache.delete(id);
  const cached=nearbyCache.get(id);if(cached?.until>Date.now()&&cached.domains.has(domainKey))return cached.domains.get(domainKey);
  const dy=(radiusM+30)/M,dx=dy/Math.max(.1,Math.cos(seed.latitude*RAD));
  let features=[];
  if(places)try{features=parseElements(await places.elementsIn([seed.longitude-dx,seed.latitude-dy,seed.longitude+dx,seed.latitude+dy]));}catch{/* Try the bounded live map below. */}
  if(!isCurrent())return null;
  const local=movementDomain(seed,features,{radiusM});if(local)return local;
  // The bundled extract omits sidewalks outside candidate parks. Supplement only
  // on opening a missing movement domain, never on pan or with celestial/DEM work.
  const box=[lon-pad/Math.max(.1,Math.cos(lat*RAD)),lat-pad,lon+pad/Math.max(.1,Math.cos(lat*RAD)),lat+pad];
  let entry=nearbyCache.get(id);
  if(!entry||entry.until<Date.now()){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),timeoutMs);
   entry={until:Date.now()+3600000,promise:null,domains:new Map()};
   entry.promise=(async()=>{
    const res=await fetchImpl('https://api.openstreetmap.org/api/0.6/map.json?bbox='+box.join(','),{signal:controller.signal,priority:'low'});
    if(!res.ok)throw Error('movement-map-http-'+res.status);
    const text=await res.text();if(text.length>6000000)throw Error('movement-map-size');
    return parseElements(mapElements(JSON.parse(text)));
   })().catch(e=>{if(nearbyCache.get(id)===entry)nearbyCache.delete(id);throw e;}).finally(()=>clearTimeout(timer));
   nearbyCache.set(id,entry);while(nearbyCache.size>12)nearbyCache.delete(nearbyCache.keys().next().value);
  }
  const extra=await entry.promise;if(!isCurrent())return null;
  const merged=[...new Map([...features,...extra].map(f=>[f.sourceId,f])).values()];
  const domain=movementDomain(seed,merged,{radiusM:reach});if(domain){entry.domains.set(domainKey,domain);if(entry.domains.size>4)entry.domains.delete(entry.domains.keys().next().value);}return domain;
 }
 return {load,surveyed,nearby,clear(){cache.clear();heightCache.clear();nearbyCache.clear();}};
}
createPlaceProvider.parseElements=parseElements;
createPlaceProvider.movementDomain=movementDomain;createPlaceProvider.movementPoint=movementPoint;
return createPlaceProvider;
});
