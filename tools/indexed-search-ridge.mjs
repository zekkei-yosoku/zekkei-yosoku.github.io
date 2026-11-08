// Reuse the exact legacy terrain sampling and cap cuts. The index is an
// optional upper bound on the same immutable source data.
export function createIndexedSearchRidge({terrain,align,atmosphere,angle,capOf,index,makeBounds,zoomRange,
  azChunk=24,radialChunk=24}) {
  return async function indexedSearchRidge(obs,eye,target) {
    if(!index||target?.id!=='fuji'||!Number.isFinite(eye))return null;
    const {km:D,azimuth:az0}=terrain.inverse(obs.latitude,obs.longitude,target.latitude,target.longitude);
    const s=18, cols=240, n=120, count=(cols+1)*(n+1), k=atmosphere.targetK();
    if(!Number.isFinite(D)||D<=.15||D>200||!Number.isFinite(k))return null;
    const tops=target.parts?.map(p=>p.m).filter(Number.isFinite);
    if(!tops?.length||!Number.isFinite(target.parts[0].m))return null;
    const base=angle(D,eye,Math.max(...tops)-300);
    const summit=angle(D,eye,target.parts[0].m);
    if(!(summit>base)||!Number.isFinite(base))return null;
    const spanAz=Math.atan2(s,Math.max(.15,D))*180/Math.PI;
    const zoom=D>40?12:13;
    const az=Array.from({length:cols+1},(_,i)=>az0-spanAz+(2*spanAz*i)/cols);
    const distances=Array.from({length:n+1},(_,j)=>Math.max(.15,D-s+(2*s*j)/n));
    const angles=distances.map(d=>terrain.prepareRidgeElevation(d,eye,{k}));
    const destinations=new Array(cols+1);
    const rim=align.rimOutline({...obs,elevation:eye},target);
    const best=new Float64Array(cols+1).fill(-90);
    const resolved=new Uint8Array(cols+1),skipped=new Uint8Array(cols+1);
    const sampled=new Uint8Array(count),selected=new Uint8Array(count),forced=new Uint8Array(cols+1);
    const maxDepth=8;
    const bounds=makeBounds(obs.latitude,obs.longitude,terrain.prepareRidgeDestination);
    if(!bounds)return null;
    function column(i) {
      return destinations[i]??=terrain.prepareRidgeDestination(obs.latitude,obs.longitude,az[i]);
    }
    function position(i,j) {
      return column(i)(distances[j]);
    }
    function coversSamples(box,range,i0,i1,j0,j1) {
      const covers=terrain.ridgeSampleCoverage(obs,box,range,zoom);
      for(let i=i0;i<=i1;i++) {
        const destination=column(i);
        for(let j=j0;j<=j1;j++)if(!covers(destination(distances[j])))return false;
      }
      return true;
    }
    function prune(i0,i1,j0,j1,depth) {
      const box=bounds(az[i0],az[i1],distances[j0],distances[j1]);
      const range=box&&zoomRange(obs,box,zoom);
      const h=range&&index.upper(box,range.min,range.max);
      if(Number.isFinite(h)) {
        // The indexed bound and the renderer use the same positive-distance
        // altitude map. Its derivative with respect to height is positive.
        // Leave a strict guard at the optical boundary.
        let upper=-Infinity;
        for(let j=j0;j<=j1;j++)upper=Math.max(upper,angles[j](h));
        if(upper<base-1e-6&&coversSamples(box,range,i0,i1,j0,j1)) {
          index.commitUpper();
          for(let i=i0;i<=i1;i++)skipped[i]=resolved[i]=1;
          return;
        }
      }
      // Split in the longer index dimension. The terminal cells still use
      // the exact old coordinates and source ordering.
      if(depth<maxDepth&&(i1-i0+1)*(j1-j0+1)>96) {
        if(i1-i0>j1-j0) {
          const m=(i0+i1)>>1;
          prune(i0,m,j0,j1,depth+1);prune(m+1,i1,j0,j1,depth+1);
        } else {
          const m=(j0+j1)>>1;
          prune(i0,i1,j0,m,depth+1);prune(i0,i1,m+1,j1,depth+1);
        }
        return;
      }
      for(let i=i0;i<=i1;i++)selected.fill(1,i*(n+1)+j0,i*(n+1)+j1+1);
    }
    for(let i=0;i<=cols;i+=azChunk)for(let j=0;j<=n;j+=radialChunk) {
      prune(i,Math.min(cols,i+azChunk-1),j,Math.min(n,j+radialChunk-1),0);
    }
    async function evaluate() {
      const points=[], ids=[];
      for(let id=0;id<count;id++)if(selected[id]&&!sampled[id]) {
        const i=Math.floor(id/(n+1)),j=id%(n+1);
        points.push(position(i,j));ids.push(id);
      }
      if(!points.length)return true;
      const values=await terrain.elevations(points,{zoom,from:obs,indexedExactBatch:true});
      if(!Array.isArray(values)||values.length!==ids.length||k!==atmosphere.targetK())return false;
      for(let p=0;p<ids.length;p++) {
        const id=ids[p],i=Math.floor(id/(n+1)),j=id%(n+1),h=values[p];
        sampled[id]=1;
        if(Number.isFinite(h)) {
          resolved[i]=1;
          best[i]=Math.max(best[i],angles[j](h));
        }
      }
      for(let i=0;i<=cols;i++)if(forced[i])skipped[i]=0;
      return true;
    }
    if(!await evaluate())return null;
    for(let i=0;i<=cols;i++) {
      const rel=((az[i]-az0+540)%360)-180;
      if(rim) {
        const a=rim.at(((az[i]-rim.azimuth+540)%360)-180);
        if(a!==null){resolved[i]=1;best[i]=Math.max(best[i],a);}
      }
      if(Math.abs(rel)<=spanAz/cols){resolved[i]=1;best[i]=Math.max(best[i],summit);}
      if(!resolved[i])return null;
    }
    const vertices=az.map((a,i)=>({az:a,lo:i,hi:i}));
    if(rim) {
      for(let i=0;i<=120;i++) {
        const rel=rim.min+(rim.max-rim.min)*i/120,h=rim.at(rel);
        if(h===null)continue;
        const a=rim.azimuth+rel;
        const x=((((a-az0+540)%360)-180)+spanAz)/(2*spanAz)*cols;
        if(x<0||x>cols)continue;
        const lo=Math.min(cols-1,Math.floor(x));
        vertices.push({az:a,lo,hi:lo+1,f:x-lo,h});
      }
      vertices.sort((a,b)=>((a.az-az0+540)%360)-((b.az-az0+540)%360));
    }
    const exact=i=>!skipped[i]||best[i]>base;
    const value=(v,upper)=>{
      const a=upper&&!exact(v.lo)?base:best[v.lo];
      if(v.lo===v.hi)return a;
      const b=upper&&!exact(v.hi)?base:best[v.hi];
      return Math.max(v.h,a*(1-v.f)+b*v.f);
    };
    const mark=i=>{
      if(exact(i)||forced[i])return;
      selected.fill(1,i*(n+1),(i+1)*(n+1));
      forced[i]=1;
    };
    // Rim interpolation can add vertices above the cut. Resolve both
    // source columns whenever that is still possible.
    for(const v of vertices)if(v.lo!==v.hi&&value(v,true)>base-1e-9){mark(v.lo);mark(v.hi);}
    if(!await evaluate())return null;
    let peak=-1, peakAlt=base;
    for(let i=0;i<vertices.length;i++) {
      const v=vertices[i];
      const upper=value(v,true);
      if(upper>peakAlt){peak=i;peakAlt=upper;}
    }
    if(peak<0)return null;
    let lo=peak,hi=peak;
    while(lo>0&&value(vertices[lo-1],true)>base)lo--;
    while(hi<vertices.length-1&&value(vertices[hi+1],true)>base)hi++;
    // The old cut interpolates with the first low neighbour on each side.
    for(const i of [lo-1,hi+1])if(i>=0&&i<vertices.length) {
      mark(vertices[i].lo);mark(vertices[i].hi);
    }
    if(!await evaluate())return null;
    const out=vertices.map(v=>[v.az,value(v,true)]);
    const cap=capOf(out,obs,eye,target);
    if(!cap)return null;
    return index.stillCurrent()?cap:null;
  };
}
