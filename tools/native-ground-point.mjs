// Point-API-compatible sampling at each GSI source's native resolution.
// readTile distinguishes confirmed absence from an unavailable download. An
// unavailable better source must return control to the ordinary point API.
export function createNativeGroundPoint({readTile,clock=()=>Date.now()}){
 const layers=[['dem1a_png',17,'1m（レーザ）',10],['dem5a_png',15,'5m（レーザ）',10],['dem5b_png',15,'5m（写真測量）',10],['dem5c_png',15,'5m（写真測量5C）',10],['dem_png',14,'10m',100]];
 let retryAfter=0;
 const unavailable=()=>{retryAfter=clock()+30000;return null;};
 return async (latitude,longitude)=>{
  if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||clock()<retryAfter)return null;
  // Match the existing point request, not the unrounded caller coordinate.
  const lat=Number(latitude.toFixed(6)),lon=Number(longitude.toFixed(6));
  const positions=new Map();
  for(const [layer,z,hsrc,quantumCm] of layers){
   let p=positions.get(z);
   if(!p){
    // Keep the official client's operation order, including floor at tile edges.
    const R=128/Math.PI,x=R*(lon*Math.PI/180+Math.PI)*Math.pow(2,z),r=lat*Math.PI/180,y=(-R/2*Math.log((1+Math.sin(r))/(1-Math.sin(r)))+128)*Math.pow(2,z);
    const tx=Math.floor(x/256),ty=Math.floor(y/256);
    p={x:tx,y:ty,px:Math.floor(x-tx*256),py:Math.floor(y-ty*256)};positions.set(z,p);
   }
   let result;try{result=await readTile(z,p.x,p.y,layer);}catch{return unavailable();}
   if(result?.missing===true)continue;
   const image=result?.image;
   if(!image||image.width!==256||image.height!==256||p.px<0||p.px>=256||p.py<0||p.py>=256)return unavailable();
   const offset=(p.py*256+p.px)*4,a=image.data?.[offset],b=image.data?.[offset+1],c=image.data?.[offset+2];
   if(![a,b,c].every(n=>Number.isInteger(n)&&n>=0&&n<=255))return unavailable();
   const encoded=a*65536+b*256+c;
   if(encoded===8388608)continue;
   const cm=encoded<8388608?encoded:encoded-16777216;
   // Round integer centimetres before dividing: binary *.01 + toFixed differs
   // at exact halves. The point API reports decimetres, or metres for 10m DEM.
   const rounded=Math.floor((Math.abs(cm)+quantumCm/2)/quantumCm)/(100/quantumCm);
   // Preserve the API's negative zero for a negative centimetre value rounding
   // to zero; JSON serialization of the existing disk cache still normalizes it.
   return {elevation:cm<0?-rounded:rounded,hsrc};
  }
  // Only all five confirmed absent/nodata sources establish the API's no-data.
  return {elevation:'-----',hsrc:''};
 };
}
