/* Native GSI DEM samples: terrain diagnostics, never standing surface/visibility proof. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateTerrain=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const R=6371008.8,rad=Math.PI/180,MISSING=-2147483648,Geo=()=>globalThis.AstroNotesTerrain||(typeof require==='function'?require('../../../astronotes-terrain.js'):null);
async function decode(data){
 const unpack=async encoded=>new Response(new Blob([Uint8Array.from(atob(encoded),c=>c.charCodeAt(0))]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
 const buffer=await unpack(data.heightsGzipBase64),view=new DataView(buffer),sources=data.sourceCodesGzipBase64?new Uint8Array(await unpack(data.sourceCodesGzipBase64)):null,tiles=new Map(data.tiles.map(t=>[t.x+','+t.y,t]));
 if(buffer.byteLength!==data.tiles.length*256*256*4||sources&&sources.length*4!==buffer.byteLength)throw Error('invalid-terrain-size');
 const world=256*2**data.zoom;
 function pixel(lat,lon){return [(lon+180)/360*world,(1-Math.asinh(Math.tan(lat*rad))/Math.PI)/2*world];}
 function lookup(x,y){const px=Math.floor(x),py=Math.floor(y),tile=tiles.get(Math.floor(px/256)+','+Math.floor(py/256));if(!tile)return {height:null,sourceCode:0};const i=tile.offset+(py%256+256)%256*256+(px%256+256)%256;
 if(!Number.isInteger(i)||i<0||i*4+4>buffer.byteLength)return {height:null,sourceCode:0};const cm=view.getInt32(i*4,true);return {height:cm===MISSING?null:cm/100,sourceCode:cm===MISSING?0:sources?.[i]??1};}
 function sample(p){return lookup(...pixel(p.latitude,p.longitude));}
 function at(p){return sample(p).height;}
 function trace(observer,{azimuth,altitude,maxM,endpoint=null,refractionK=1}){
  if(!Number.isFinite(observer.elevation)||!Number.isFinite(azimuth)||!Number.isFinite(altitude)||Math.abs(altitude)>=89||!Number.isFinite(maxM)||maxM<=0)return {status:'unknown',recommend:false,reason:'invalid-terrain-ray'};
  const segments=[];let lastPoint=null,previous={xy:pixel(observer.latitude,observer.longitude),d:0};
  for(let d=Math.min(100,maxM);;d=Math.min(d+100,maxM)){const p=d===maxM&&endpoint?endpoint:Geo().destination(observer.latitude,observer.longitude,azimuth,d/1000),next={xy:pixel(p.latitude,p.longitude),d};segments.push([previous,next]);previous=next;lastPoint=p;if(d===maxM)break;}
  let checked=0,missing=0,lowerResolutionCells=0,ignoredCells=0,hit=null,minMarginM=Infinity;const eye=observer.elevation+(observer.eyeM??1.5);
  for(const [from,to] of segments){const start=from.xy,finish=to.xy,dx=finish[0]-start[0],dy=finish[1]-start[1],length=to.d-from.d,crossings=[0,1];for(const [a,b] of [[start[0],finish[0]],[start[1],finish[1]]])if(a!==b)for(let n=Math.floor(Math.min(a,b))+1;n<Math.max(a,b);
  n++)crossings.push((n-a)/(b-a));crossings.sort((a,b)=>a-b);
  for(let i=1;i<crossings.length;i++){const lo=crossings[i-1],hi=crossings[i];if(hi-lo<1e-14)continue;const t=(lo+hi)/2,value=lookup(start[0]+t*dx,start[1]+t*dy),z=value.height;checked++;if(value.sourceCode===2)lowerResolutionCells++;if(z===null)missing++;if(z===null)continue;
  const a=Math.max(0,from.d+lo*length),b=from.d+hi*length,vertex=-R*refractionK*Math.tan(altitude*rad),distances=[a,b];if(vertex>a&&vertex<b)distances.push(vertex);
  const heights=distances.map(d=>eye+d*Math.tan(altitude*rad)+d*d/(2*R*refractionK)),ray=Math.min(...heights),d=distances[heights.indexOf(ray)],margin=ray-z;minMarginM=Math.min(minMarginM,margin);if(margin<=0&&!hit)hit={distanceM:d,terrainM:z,rayM:ray};}}

  return {status:hit?'model-blocked':'unknown',recommend:false,checked,missing,lowerResolutionCells,end:lastPoint,ignoredNearObserverM:0,ignoredCells,hit,minMarginM:Number.isFinite(minMarginM)?minMarginM:null,reason:hit?'conditional-dem-intersection':'no-terrain-visibility-certification'};
 }
 return {at,sample,trace,source:data.source};
}
return {decode};
});
