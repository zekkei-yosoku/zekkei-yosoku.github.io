// Propose a cheap containing box. Each skipped legacy sample is checked
// against the exact DEM projection and zoom before its bound is used.
const RAD=Math.PI/180;
const METRES_PER_DEG=110500; // smaller than min meridional radius * pi/180
export function createMetricFanBounds(lat,lon,prepareDestination) {
  if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<20||lat>46||lon<122||lon>154)return null;
  const cached=new Map();
  return (azLo,azHi,dLo,dHi)=>{
    if(![azLo,azHi,dLo,dHi].every(Number.isFinite)||azHi<azLo||azHi-azLo>180||dLo<.15||dHi<dLo||dHi>220)return null;
    const azMid=(azLo+azHi)/2,dMid=(dLo+dHi)/2;
    let destination=cached.get(azMid);
    if(!destination){destination=prepareDestination(lat,lon,azMid);cached.set(azMid,destination);}
    const p=destination(dMid);
    const radius=1000*((dHi-dLo)/2+dHi*(azHi-azLo)*RAD/2)+2;
    const latitude=radius/METRES_PER_DEG;
    const absLat=Math.abs(p.latitude)+latitude;
    if(absLat>55)return null;
    const longitude=latitude/Math.cos(absLat*RAD);
    return {south:p.latitude-latitude,north:p.latitude+latitude,west:p.longitude-longitude,east:p.longitude+longitude};
  };
}
export function ridgeZoomRange(from,box,base) {
  if(!box||box.south<20||box.north>46||box.west<122||box.east>154)return null;
  const low=(v,a,b)=>v<a?a-v:v>b?v-b:0;
  const high=(v,a,b)=>Math.max(Math.abs(v-a),Math.abs(v-b));
  const x=111195*Math.cos(from.latitude*RAD), y=111195;
  const distLo=Math.max(0,Math.hypot(low(from.longitude,box.west,box.east)*x,low(from.latitude,box.south,box.north)*y)-.002);
  const distHi=Math.hypot(high(from.longitude,box.west,box.east)*x,high(from.latitude,box.south,box.north)*y)+.002;
  const scale=156543.03;
  const lo=scale*Math.cos(box.north*RAD)/Math.max(.01,distHi*.5*RAD);
  const hi=scale*Math.cos(box.south*RAD)/Math.max(.01,distLo*.5*RAD);
  const zoom=w=>Math.max(base,Math.min(17,Math.ceil(Math.log2(w))));
  return {min:zoom(lo*(1-1e-12)),max:zoom(hi*(1+1e-12))};
}
