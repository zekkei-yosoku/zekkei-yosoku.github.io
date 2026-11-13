/* Tree tops along a sight line (2026-11-13, user: 新宿御苑's trees were not judged; "必要ならば全部やって"). The Meta/WRI
   canopy height map v2 (CC BY 4.0) is read where a line needs it: Cloud Optimized GeoTIFFs on Source Cooperative, one
   file per zoom-10 quadkey (Web Mercator), 512 px DEFLATE blocks of uint8 metres above the ground. The 2.39 m overview is
   the mean of 2x2 full pixels and keeps crown tops within a metre (checked over 新宿御苑). */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesTreeHeights=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const R=6371008.8,RM=6378137,RAD=Math.PI/180,ZOOM=10,HEAD_BYTES=131072;
// Trees nearer than NEAR_M (30 m, the building grid's near zone) are stepped around; past RANGE_M a 25 m crown is under 0.3 degrees and the terrain decides.
// The last END_M before the target is its own ground (a summit's slope, a tower's park). Crowns under MIN_M are shrubs.
const NEAR_M=30,RANGE_M=5000,END_M=300,MIN_M=3,MARGIN_M=2,TALLEST_M=45,GROUND_BIN_M=25;
// The map puts crown tops 2-3 m low: against Tokyo's 2023 airborne laser survey over 新宿御苑 (two 1/500 sheets, 23,000
// pixels outside buildings) the highest laser return within 1.5 m was 1.03 x map + 2.3 m. Crowns are raised by 2 m.
const CROWN_ADD_M=2;
// A step of one 2.4 m pixel near the stand point, wider where a crown spans several steps anyway.
const stepAt=d=>d<500?2:d<2000?4:8;
const BASE='https://data.source.coop/tge-labs/meta-chm-v2/chm/';
function quadkey(x,y,z=ZOOM){let q='';for(let i=z;i>0;i--){const m=1<<(i-1);q+=((x&m)?1:0)+((y&m)?2:0);}return q;}
function tileOf(lat,lon){const n=2**ZOOM;return {x:Math.floor((lon+180)/360*n),y:Math.floor((1-Math.asinh(Math.tan(lat*RAD))/Math.PI)/2*n)};}
const merc=(lat,lon)=>[RM*lon*RAD,RM*Math.log(Math.tan(Math.PI/4+lat*RAD/2))];
function destination(lat,lon,az,m){const d=m/R,a=lat*RAD,t=az*RAD,b=Math.asin(Math.sin(a)*Math.cos(d)+Math.cos(a)*Math.sin(d)*Math.cos(t));
 return {latitude:b/RAD,longitude:lon+Math.atan2(Math.sin(t)*Math.sin(d)*Math.cos(a),Math.cos(d)-Math.sin(a)*Math.sin(b))/RAD};}
function bearingM(a,b){const p=a.latitude*RAD,q=b.latitude*RAD,dl=(b.longitude-a.longitude)*RAD;
 const az=(Math.atan2(Math.sin(dl)*Math.cos(q),Math.cos(p)*Math.sin(q)-Math.sin(p)*Math.cos(q)*Math.cos(dl))/RAD+360)%360;
 const h=Math.sin((q-p)/2)**2+Math.cos(p)*Math.cos(q)*Math.sin(dl/2)**2;return {azimuth:az,m:2*R*Math.asin(Math.min(1,Math.sqrt(h)))};}
// The TIFF directories a COG needs (classic TIFF, either byte order). An array that lies past the bytes read is returned
// as {at,count,size} for the caller to fetch.
function directories(buf){
 const v=new DataView(buf),le=v.getUint16(0)===0x4949,u16=o=>v.getUint16(o,le),u32=o=>v.getUint32(o,le);
 if(u16(2)!==42)throw Error('canopy-not-classic-tiff');
 const SIZE={1:1,3:2,4:4,5:8,12:8,16:8},out=[];let off=u32(4);
 for(let guard=0;off&&off+2<=buf.byteLength&&guard<64;guard++){
  const n=u16(off),d={};
  for(let i=0;i<n;i++){
   const e=off+2+i*12,tag=u16(e),type=u16(e+2),count=u32(e+4),size=(SIZE[type]||1)*count,at=size<=4?e+8:u32(e+8);
   const read=k=>type===3?u16(at+2*k):type===12?v.getFloat64(at+8*k,le):u32(at+4*k);
   if(at+size>buf.byteLength){d[tag]={at,count,size:SIZE[type]||1};continue;}
   d[tag]=count===1?read(0):Array.from({length:count},(_,k)=>read(k));
  }
  out.push(d);off=u32(off+2+n*12);
 }
 return out;
}
function create({fetchImpl=(typeof fetch==='function'?fetch.bind(globalThis):null),base=BASE,groundAt=null,level=1,maxBlocks=96}={}){
 const heads=new Map(),blocks=new Map(),infos=new Map(),ready=new Map();
 const range=async(url,a,b)=>{const r=await fetchImpl(url,{headers:{Range:`bytes=${a}-${b}`},signal:globalThis.AbortSignal?.timeout?.(20000)});
  if(r.status===404)return null;if(!r.ok)throw Error('canopy-fetch');return r.arrayBuffer();};
 // One file per quadkey: its directory once. A missing file (open sea) holds no trees.
 function head(q){
  if(!heads.has(q))heads.set(q,(async()=>{
   const url=base+q+'.tif',buf=await range(url,0,HEAD_BYTES-1);if(!buf)return null;
   const dirs=directories(buf).filter(d=>d[258]===8&&Number.isFinite(d[256])).sort((a,b)=>b[256]-a[256]),full=dirs[0];
   const pick=dirs[Math.min(level,dirs.length-1)];if(!full||!pick||pick[259]!==8||pick[322]!==512)throw Error('canopy-format');
   for(const tag of [324,325])if(typeof pick[tag]==='number')pick[tag]=[pick[tag]];else if(!Array.isArray(pick[tag])){const p=pick[tag],more=await range(url,p.at,p.at+p.count*p.size-1),dv=new DataView(more),le=new DataView(buf).getUint16(0)===0x4949;
    pick[tag]=Array.from({length:p.count},(_,k)=>p.size===2?dv.getUint16(2*k,le):dv.getUint32(4*k,le));}
   const scale=full[33550][0]*full[256]/pick[256];
   const info={url,x0:full[33922][3],y0:full[33922][4],scale,across:Math.ceil(pick[256]/512),offsets:pick[324],counts:pick[325]};infos.set(q,info);return info;
  })().catch(e=>{heads.delete(q);throw e;}));
  return heads.get(q);
 }
 async function block(info,bx,by){
  const key=info.url+'#'+bx+','+by;if(blocks.has(key)){const b=blocks.get(key);blocks.delete(key);blocks.set(key,b);return b;}
  const p=(async()=>{const i=by*info.across+bx,raw=await range(info.url,info.offsets[i],info.offsets[i]+info.counts[i]-1);
   const out=new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate'))).arrayBuffer());
   if(out.length!==512*512)throw Error('canopy-block-size');ready.set(key,out);return out;})().catch(e=>{blocks.delete(key);throw e;});
  blocks.set(key,p);while(blocks.size>maxBlocks){const old=blocks.keys().next().value;blocks.delete(old);ready.delete(old);}return p;
 }
 // Without waiting when the file's directory and the block are already read (most steps of a walk).
 let lastTile=null,lastBlock=null;
 function canopyNow(lat,lon){
  const t=tileOf(lat,lon);let info;
  if(lastTile&&lastTile.x===t.x&&lastTile.y===t.y)info=lastTile.info;else{info=infos.get(quadkey(t.x,t.y));if(!info)return undefined;lastTile={x:t.x,y:t.y,info};}
  const [X,Y]=merc(lat,lon),col=Math.floor((X-info.x0)/info.scale),row=Math.floor((info.y0-Y)/info.scale);
  if(col<0||row<0||col>=info.across*512||row>=info.across*512)return 0;
  const bx=col>>9,by=row>>9;let b;
  if(lastBlock&&lastBlock.info===info&&lastBlock.bx===bx&&lastBlock.by===by)b=lastBlock.b;else{b=ready.get(info.url+'#'+bx+','+by);if(!b)return undefined;lastBlock={info,bx,by,b};}
  return b[(row&511)*512+(col&511)];
 }
 async function canopy(lat,lon){
  const t=tileOf(lat,lon),info=await head(quadkey(t.x,t.y));if(!info)return 0;
  const [X,Y]=merc(lat,lon),col=Math.floor((X-info.x0)/info.scale),row=Math.floor((info.y0-Y)/info.scale);
  if(col<0||row<0||col>=info.across*512||row>=info.across*512)return 0;
  const b=await block(info,col>>9,row>>9);return b[(row&511)*512+(col&511)];
 }
 // One walk gives the line's verdict and how high up the target the crowns hide it. The ray is the parabola the building
 // grid uses (eye + b d + d^2 / (2 R k)); crowns stand on the DEM ground. `footM` bounds the walk for the hidden part.
 async function sight(observer,ray,{isCurrent=()=>true}={}){
  if(!groundAt||![observer.latitude,observer.longitude,observer.elevation,ray.maxM].every(Number.isFinite))return {status:'unread',reason:'no-ground'};
  const eye=observer.elevation+(observer.eyeM??1.5),c=1/(2*R*(ray.refractionK||1)),D=ray.maxM;
  const b=ray.endpoint?(ray.endpoint.elevation-eye)/D-D*c:Math.tan(ray.altitude*RAD),h=d=>eye+b*d+c*d*d;
  const foot=ray.endpoint&&Number.isFinite(ray.footM)?(ray.footM-eye)/D-D*c:null,low=d=>foot===null?h(d):Math.min(h(d),eye+foot*d+c*d*d);
  const az=ray.endpoint?bearingM(observer,ray.endpoint).azimuth:ray.azimuth,end=Math.min(RANGE_M,ray.endpoint?D-END_M:D),grounds=new Map();
  const hide=(top,s)=>eye+(top-eye-c*s*s)/s*D+c*D*D;
  let status='clear',hit=null,sky=null;
  try{
   for(let d=NEAR_M;d<=end;d+=stepAt(d)){
    if(!isCurrent())throw Error('candidate-cancelled');
    const bin=Math.floor(d/GROUND_BIN_M);if(!grounds.has(bin)){const q=destination(observer.latitude,observer.longitude,az,(bin+.5)*GROUND_BIN_M);grounds.set(bin,await groundAt(q));}
    const ground=grounds.get(bin);if(!Number.isFinite(ground))return {status:'unread',reason:'ground-unavailable'};
    if(low(d)-ground>TALLEST_M)continue;
    const p=destination(observer.latitude,observer.longitude,az,d),now=canopyNow(p.latitude,p.longitude),crown=now===undefined?await canopy(p.latitude,p.longitude):now;if(crown<MIN_M)continue;
    const top=ground+crown+CROWN_ADD_M,at=h(d);
    if(ray.endpoint){const m=hide(top,d);if(!sky||m>sky.toM)sky={toM:m,distanceM:d,topM:top,crownM:crown};}
    if(status==='blocked'||at>top+MARGIN_M)continue;
    if(at<top-MARGIN_M){status='blocked';hit={distanceM:d,topM:top,crownM:crown,rayM:at};if(!ray.endpoint)break;}
    else if(status==='clear'){status='unknown';hit={distanceM:d,topM:top,crownM:crown,rayM:at,reason:'trees-margin'};}
   }
  }catch(e){if(e?.message==='candidate-cancelled')throw e;return {status:'unread',reason:'canopy-unavailable'};}
  return {status,hit,skyline:sky,source:'meta-wri-chm-v2'};
 }
 return {sight,canopy,canopyNow};
}
return {create,directories,quadkey,tileOf,NEAR_M,RANGE_M,END_M,MARGIN_M,CROWN_ADD_M};
});
