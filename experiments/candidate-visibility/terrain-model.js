/* Native GSI DEM samples: terrain diagnostics, never standing surface/visibility proof. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateTerrain=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const R=6371008.8,rad=Math.PI/180,MISSING=-2147483648;
async function decode(data){
 const packed=Uint8Array.from(atob(data.heightsGzipBase64),c=>c.charCodeAt(0)),stream=new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip')),buffer=await new Response(stream).arrayBuffer(),view=new DataView(buffer),tiles=new Map(data.tiles.map(t=>[t.x+','+t.y,t]));
 const world=256*2**data.zoom;
 function pixel(lat,lon){return [(lon+180)/360*world,(1-Math.asinh(Math.tan(lat*rad))/Math.PI)/2*world];}
 function atPixel(x,y){const px=Math.floor(x),py=Math.floor(y),tile=tiles.get(Math.floor(px/256)+','+Math.floor(py/256));if(!tile)return null;const i=tile.offset+(py%256+256)%256*256+(px%256+256)%256;if(!Number.isInteger(i)||i<0||i*4+4>buffer.byteLength)return null;const cm=view.getInt32(i*4,true);return cm===MISSING?null:cm/100;}
 function at(p){const xy=pixel(p.latitude,p.longitude);return atPixel(...xy);}
 function trace(observer,{azimuth,altitude,maxM}){
  if(!Number.isFinite(observer.elevation)||!Number.isFinite(azimuth)||!Number.isFinite(altitude)||Math.abs(altitude)>=89||!Number.isFinite(maxM)||maxM<=0||maxM>20000)return {status:'unknown',recommend:false,reason:'invalid-terrain-ray'};
  const end={latitude:observer.latitude+Math.cos(azimuth*rad)*maxM/111195,longitude:observer.longitude+Math.sin(azimuth*rad)*maxM/(111195*Math.cos(observer.latitude*rad))},start=pixel(observer.latitude,observer.longitude),finish=pixel(end.latitude,end.longitude),dx=finish[0]-start[0],dy=finish[1]-start[1];
  // Walk raster boundaries (not sparse profile samples); source holes stay missing.
  const crossings=[0,1];for(const [a,b] of [[start[0],finish[0]],[start[1],finish[1]]])if(a!==b)for(let n=Math.floor(Math.min(a,b))+1;n<Math.max(a,b);n++)crossings.push((n-a)/(b-a));crossings.sort((a,b)=>a-b);
  let checked=0,missing=0,ignoredCells=0,hit=null,minMarginM=Infinity;const eye=observer.elevation+(observer.eyeM??1.5);
  for(let i=1;i<crossings.length;i++){const lo=crossings[i-1],hi=crossings[i];if(hi-lo<1e-14)continue;const t=(lo+hi)/2,z=atPixel(start[0]+t*dx,start[1]+t*dy);checked++;if(z===null)missing++;if(hi*maxM<=5){ignoredCells++;continue;}if(z===null)continue;const a=Math.max(5,lo*maxM),b=hi*maxM,vertex=-R*Math.tan(altitude*rad),distances=[a,b];if(vertex>a&&vertex<b)distances.push(vertex);const heights=distances.map(d=>eye+d*Math.tan(altitude*rad)+d*d/(2*R)),ray=Math.min(...heights),d=distances[heights.indexOf(ray)],margin=ray-z;minMarginM=Math.min(minMarginM,margin);if(margin<=0&&!hit)hit={distanceM:d,terrainM:z,rayM:ray};}
  return {status:hit?'model-blocked':'unknown',recommend:false,checked,missing,ignoredNearObserverM:5,ignoredCells,hit,minMarginM:Number.isFinite(minMarginM)?minMarginM:null,reason:hit?'conditional-dem-intersection':'no-terrain-visibility-certification'};
 }
 return {at,trace,source:data.source};
}
return {decode};
});
