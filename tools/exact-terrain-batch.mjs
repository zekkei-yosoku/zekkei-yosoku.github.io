// Keep every requested coordinate, zoom, pixel and DEM fallback. Await once per
// tile, rather than creating several promises for each of its sampled pixels.
export function createExactTerrainBatch({inJapan,tileXf,tileYf,loadTile,pixelToElevation}) {
 return async function sampleTiles(points,zooms) {
  const out=new Array(points.length).fill(undefined),ten=new Array(points.length);
  let pending=[];
  for(let i=0;i<points.length;i++)if(inJapan(points[i].latitude,points[i].longitude))pending.push(i);
  for(const [layer,maxZ] of [['dem1a_png',17],['dem5a_png',15],['dem_png',14],['dem5b_png',15],['dem5c_png',15]]) {
   if(!pending.length)break;
   const groups=new Map(),values=new Array(points.length);
   for(const i of pending) {
    const p=points[i],z=Math.min(zooms[i],maxZ),fx=tileXf(p.longitude,z),fy=tileYf(p.latitude,z),x=Math.floor(fx),y=Math.floor(fy),key=z+'/'+x+'/'+y;
    let group=groups.get(key);if(!group){group={z,x,y,points:[]};groups.set(key,group);}
    group.points.push(i,fx,fy);
   }
   await Promise.all([...groups.values()].map(async group=>{
    const img=await loadTile(group.z,group.x,group.y,layer);
    if(!img)return;
    for(let at=0;at<group.points.length;at+=3){
     const i=group.points[at],fx=group.points[at+1],fy=group.points[at+2];
     const px=Math.min(img.width-1,Math.floor((fx%1)*img.width));
     const py=Math.min(img.height-1,Math.floor((fy%1)*img.height));
     const n=(py*img.width+px)*4;
     values[i]=pixelToElevation(img.data[n],img.data[n+1],img.data[n+2]);
    }
   }));
   const next=[];
   for(const i of pending){
    const v=values[i];
    if(layer==='dem_png'){
     if(!Number.isFinite(v)){out[i]=v;continue;}
     ten[i]=v;next.push(i);
    }else if(Number.isFinite(v))out[i]=v;
    else if(layer==='dem5c_png')out[i]=ten[i];
    else next.push(i);
   }
   pending=next;
  }
  return out;
 };
}
