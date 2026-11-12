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
function edgeDistance(line,p){let d=Infinity;const c=Math.cos(p.latitude*RAD);for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],x=(b[0]-a[0])*c,y=b[1]-a[1],u=Math.max(0,Math.min(1,((p.longitude-a[0])*c*x+(p.latitude-a[1])*y)/(x*x+y*y||1)));
d=Math.min(d,Math.hypot((p.longitude-a[0])*c-u*x,p.latitude-a[1]-u*y)*M);}return d;}
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
 if(!/<osm\b/.test(xml)||!/<\/osm>/.test(xml)||/<(?:error|remark)\b/.test(xml))throw Error('incomplete-osm-map-response');
 const decode=s=>s.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi,(_,x)=>x[0]==='#'?String.fromCodePoint(x[1].toLowerCase()==='x'?parseInt(x.slice(2),16):Number(x.slice(1))):({amp:'&',quot:'"',apos:"'",lt:'<',gt:'>'}[x]||_));
 const attrs=s=>Object.fromEntries([...s.matchAll(/([\w:]+)\s*=\s*"([^"]*)"/g)].map(m=>[m[1],decode(m[2])])),rows=[],nodes=new Map(),ways=new Map();
 const re=/<(node|way|relation)\b([^>]*?)(?:\/\s*>|>([\s\S]*?)<\/\1\s*>)/g;let m;
 while((m=re.exec(xml))){const a=attrs(m[2]),body=m[3]||'',tags={};for(const t of body.matchAll(/<tag\b([^>]*?)\/\s*>/g)){const p=attrs(t[1]);if(p.k!=null)tags[p.k]=p.v;}
  const e={type:m[1],id:Number(a.id),tags};if(e.type==='node'){e.lat=Number(a.lat);e.lon=Number(a.lon);nodes.set(a.id,e);}else if(e.type==='way'){e.refs=[...body.matchAll(/<nd\b([^>]*?)\/\s*>/g)].map(t=>attrs(t[1]).ref);ways.set(a.id,e);}else e.members=[...body.matchAll(/<member\b([^>]*?)\/\s*>/g)].map(t=>attrs(t[1]));rows.push(e);
 }
 for(const e of ways.values()){e.geometry=e.refs.map(r=>nodes.get(r)).filter(Boolean).map(n=>({lat:n.lat,lon:n.lon}));if(e.geometry.length!==e.refs.length)e.geometry=[];delete e.refs;}
 for(const e of rows)if(e.type==='relation')e.members=e.members.map(m=>({...m,ref:Number(m.ref),geometry:m.type==='way'?ways.get(m.ref)?.geometry:undefined}));
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
function sampleFeatures(features,regions,{spacingM=30,maxPoints=480,skipPoints=0}={}){
 const generationBudget=maxPoints+skipPoints;
 const areas=features.filter(f=>f.kind&&f.polygons.length),waters=features.filter(f=>f.water),rivers=features.filter(f=>['river','canal'].includes(f.tags.waterway)),buildings=features.filter(f=>f.building),groups=[],unknownGeometry=features.filter(f=>f.geometryIncomplete).map(f=>f.id);
 let generationLimited=false;
 const inRegion=p=>regions.some(r=>bboxPoint(p,r.bbox));
 for(const f of features){
  if(forbidden(f.tags)||(!f.walking&&f.kind!=='viewpoint'))continue;
  if(f.geometryIncomplete)continue;
  const candidates=[];
  if(f.kind==='viewpoint'&&f.position)candidates.push(f.position);
  // A viewpoint polygon provides no known camera location; walkable geometry
  // inside it is handled below, but its arbitrary centroid is never a deck.
  if(f.walking){
   const filled=f.tags.area==='yes'||!!f.tags['area:highway'];
   if(filled){for(const poly of f.polygons){const r=poly[0],xs=r.map(p=>p[0]),ys=r.map(p=>p[1]),a=Math.min(...ys),b=Math.max(...ys),lo=Math.min(...xs),hi=Math.max(...xs),dy=spacingM/M,dx=dy/Math.max(.01,Math.cos((a+b)*RAD/2));let count=0;
    for(const region of regions){const box=region.bbox,fromLat=Math.max(a,box[1]),toLat=Math.min(b,box[3]),fromLon=Math.max(lo,box[0]),toLon=Math.min(hi,box[2]);for(let lat=fromLat+dy/2;lat<toLat&&count<generationBudget*4;lat+=dy)for(let lon=fromLon+dx/2;lon<toLon&&count<generationBudget*4;
    lon+=dx){const p={latitude:lat,longitude:lon};if(inside(r,p)&&!poly.slice(1).some(h=>inside(h,p))){candidates.push(p);count++;}}}if(count>=generationBudget*4)generationLimited=true;
    // Small pedestrian squares may be smaller than one grid cell.
    const p={latitude:(a+b)/2,longitude:(lo+hi)/2};if(inside(r,p)&&!poly.slice(1).some(h=>inside(h,p)))candidates.push(p);
   }}else for(const line of f.lines){for(let i=1;i<line.length;i++){const a=line[i-1],b=line[i],n=Math.max(1,Math.ceil(distance(a,b)/spacingM));for(let j=0;j<n;j++){const p={longitude:a[0]+(b[0]-a[0])*j/n,latitude:a[1]+(b[1]-a[1])*j/n};if(!inRegion(p))continue;
   if(candidates.length>=generationBudget*8){generationLimited=true;break;}candidates.push(p);}}const last=line[line.length-1];if(last)candidates.push({longitude:last[0],latitude:last[1]});}
  }
  const points=[];
  for(const p of candidates){
   if(!inRegion(p))continue;
   const containers=areas.filter(a=>contains(a,p));if(containers.some(a=>forbidden(a.tags)))continue;
   const water=waters.find(a=>contains(a,p));if(water&&!nonGround(f.tags))continue;
   const roofArea=containers.find(a=>nonGround(a.tags)),building=buildings.find(a=>contains(a,p)),viewpoint=containers.find(a=>a.kind==='viewpoint');
   const square=containers.find(a=>a.kind==='plaza'),park=containers.find(a=>a.kind==='park');
   const river=rivers.find(a=>a.lines.some(line=>edgeDistance(line,p)<=80));
   const riverArea=containers.find(a=>/河川敷|川テラス|川緑道|riverbank|riverside/i.test(a.name));
   const riverPath=/河川敷|川.*テラス|riverside|riverbank/i.test(f.name)&&waters.some(a=>a.lines.some(line=>edgeDistance(line,p)<=80));
   // A levee-top path stands well back from a wide river's centre line: within 150 m of its water and
   // 300 m of the centre line it is the riverbank, while streets behind the levee are not.
   const wideRiver=rivers.find(a=>a.tags.waterway==='river'&&a.lines.some(line=>edgeDistance(line,p)<=300))&&waters.some(a=>a.lines.some(line=>edgeDistance(line,p)<=150));
   const riverside=riverArea||riverPath||river&&waters.some(a=>a.lines.some(line=>edgeDistance(line,p)<=80))||wideRiver;
   const area=viewpoint||square||riverArea||park;
   const placeKind=f.kind==='viewpoint'||viewpoint?'viewpoint':square||f.tags.highway==='pedestrian'&&(f.tags.area==='yes'||f.tags['area:highway'])?'plaza':riverside?'riverbank':park?'park':'sidewalk';
   const elevated=nonGround(f.tags)||!!roofArea||!!building;
   const surface=area&&nonGround(area.tags)?area:f;
   // ele = absolute feature elevation, height = structure top, level = floor
   // index. None identifies the physical standing floor on its own.
   const floor=Number(surface.tags['floor:height']),floorSource=surface.tags['source:floor:height'];
   const knownFloor=surface.tags['floor:height']!=null&&finite(floor)&&floor>=0&&floorSource;
   const accessKnown=!![f,...containers].find(a=>['yes','public','permissive','designated'].includes(a.tags.foot)||['yes','public','permissive'].includes(a.tags.access));
   const structuralUnknown=f.kind==='viewpoint'||!!viewpoint||elevated;
   points.push({...p,lat:p.latitude,lon:p.longitude,placeId:'osm/'+(area||f).id,name:(area||f).name||f.name||({park:'公園の園路',plaza:'歩行広場',riverbank:'河川沿いの歩道',sidewalk:'歩道',viewpoint:'展望地点'}[placeKind]),placeKind,
    sourceId:f.sourceId,surfaceId:f.sourceId,polygonId:f.id,region:regions.find(r=>bboxPoint(p,r.bbox))?.id,
    surfaceGeometry:{polygons:f.walking&&(f.tags.area==='yes'||f.tags['area:highway'])?f.polygons:[],lines:f.walking&&f.tags.area!=='yes'&&!f.tags['area:highway']?f.lines:[],...(f.position?{position:f.position}:{})},
    groundM:null,groundKnown:false,surfaceAglM:knownFloor?floor:structuralUnknown?null:0,surfaceHeightM:knownFloor?floor:structuralUnknown?null:0,surfaceElevationM:null,eyeM:1.5,
    standingSurfaceKnown:false,accessKnown,structureClassificationKnown:!structuralUnknown||!!knownFloor,nonTerrainStructure:!!elevated||!!knownFloor&&floor>0,
    sourceEvidence:{kind:'osm-mapped-walking-surface',heightBasis:'surfaceAglM/surfaceHeightM:height-above-local-ground; surfaceElevationM:groundM+surfaceAglM; eyeM:height-above-surface',osmId:f.id,placeOsmId:(area||f).id,tags:{...f.tags},areaTags:area?{...area.tags}:null,
    classification:riverArea?'named-riverside-area':riverPath?'named-riverside-walkway':riverside?'mapped-river-proximity':'mapped-feature',floor:knownFloor?{heightM:floor,source:floorSource}:null,buildingContaining:building?.id||null,access:'mapped-only',vegetation:'unknown',
    actualVisibilityGuaranteed:false}
   });
  }
  if(points.length){const preferred=points.filter(p=>p.placeKind!=='sidewalk'),support=points.filter(p=>p.placeKind==='sidewalk');if(preferred.length)groups.push(preferred);if(support.length)groups.push(support);}
 }
 // Round-robin surfaces within each priority group; one long path cannot consume
 // the entire budget before a small park or a viewpoint is considered.
 groups.sort((a,b)=>(a[0].placeKind==='sidewalk')-(b[0].placeKind==='sidewalk'));
 const rows=[],seen=new Set();let remaining=0,visited=0;
 for(const priority of [false,true]){const g=groups.filter(a=>(a[0].placeKind==='sidewalk')===priority);for(let i=0;g.some(a=>i<a.length);i++)for(const a of g)if(i<a.length){const p=a[i],k=key(p)+'/'+p.surfaceId;if(seen.has(k))continue;seen.add(k);if(visited++<skipPoints)continue;
 if(rows.length<maxPoints)rows.push(p);else remaining++;}}
 return {rows,limited:remaining>0||generationLimited,omittedPoints:remaining,generationLimited,unknownGeometry};
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
return function createPlaceProvider({terrain,fetchImpl=globalThis.fetch,loadViewpoints,isCurrent:providerCurrent=()=>true,maxTiles=12,maxPoints=480,timeoutMs=25000,maxDurationMs=55000,spacingM=30,endpoints,places=null}={}){
 if(!terrain)throw Error('terrain provider is required');
 const servers=endpoints||terrain.OVERPASS||[],cache=new Map(),heightCache=new Map();
 let endpointCursor=0,overpassRetryAfter=0,overpassNextRequest=0;
 async function load(plan,{regions=plan?.regions||plan?.searchRegions||[],isCurrent=()=>true,onProgress=()=>{},signal,maxTiles:tileBudget=maxTiles,maxPoints:pointBudget=maxPoints,cursor,offset=0,retryFailed=true}={}){
  offset=Math.max(0,Number(cursor?.offset??cursor??offset)||0);const retryTiles=Array.isArray(cursor?.retryTiles)?cursor.retryTiles:[],batchTiles=Array.isArray(cursor?.batchTiles)?cursor.batchTiles:null,pointOffset=Math.max(0,Number(cursor?.pointOffset)||0);
  const requested=regionsFor(regions),started=Date.now(),current=()=>!signal?.aborted&&providerCurrent()&&isCurrent(),controller=new AbortController();
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
   if(places)try{const value={features:parseElements(await places.elementsIn(b)),at:Date.now(),timestamp:null,endpoint:'bundled-osm',version:'bundled',local:true};cache.set(tile.id,value);while(cache.size>120)cache.delete(cache.keys().next().value);return value;}catch{/* Overpass below. */}
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
    :sampleFeatures(features,selectionRegions,{spacingM,maxPoints:Math.max(1,pointBudget),skipPoints:pointOffset}),points=sampled.rows;
   if(sampled.limited&&points.length)coverage.nextCursor={offset,pointOffset:pointOffset+points.length,batchTiles:coverage.fetchedRegions.map(r=>({id:r.id,bbox:r.bbox,regionId:r.regionId})),afterCursor:coverage.nextCursor};
   else if(batchTiles&&retryFailed&&coverage.failedRegions.length)coverage.nextCursor={...cursor};
   coverage.samplingComplete=!sampled.limited;coverage.omittedPoints=sampled.omittedPoints;coverage.incompleteGeometry=sampled.unknownGeometry;
   if(sampled.limited)coverage.missing.push('point-budget');if(hasPending)coverage.missing.push('tile-budget-or-timeout');if(sampled.unknownGeometry.length)coverage.missing.push('incomplete-osm-geometry');
   // A small documented viewpoint supplement is independent of OSM availability.
   // Add once at the beginning; continuation pages only advance dynamic geometry.
   coverage.documentedViewpoints=0;
   if(!cursor&&offset===0&&typeof loadViewpoints==='function'&&current()&&!controller.signal.aborted)try{const supplement=publishedViewpoints(await bounded(loadViewpoints(plan,{signal:controller.signal,isCurrent:current}),timeoutMs),requested);points.unshift(...supplement);
   coverage.documentedViewpoints=supplement.length;}catch{coverage.missing.push('documented-viewpoints-unavailable');}
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
 return {load,clear(){cache.clear();heightCache.clear();}};
};
});
