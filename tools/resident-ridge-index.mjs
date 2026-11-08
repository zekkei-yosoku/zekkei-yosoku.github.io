// Bounds over the decoded tiles currently shared with the exact sampler.
const HEIGHT_INDEX_LAYERS = Object.freeze([
  ['dem1a_png',17], ['dem5a_png',15], ['dem_png',14], ['dem5b_png',15], ['dem5c_png',15],
].map(Object.freeze));
const HEIGHT_INDEX_NO_DATA = -2147483648;
const BLOCKS=16, TILE_SIZE=256, LEVELS=5;
const LOG=Array.from({length:BLOCKS+1},(_,n)=>n?Math.floor(Math.log2(n)):0);

// Rectangular maxima use four overlapping power-of-two rectangles. Validity
// comes from a prefix sum of blocks containing at least one NoData pixel.
function indexTile(data) {
  const maxima=new Int32Array(256).fill(HEIGHT_INDEX_NO_DATA);
  const missing=new Uint8Array(256);
  for(let y=0;y<TILE_SIZE;y++)for(let x=0;x<TILE_SIZE;x++) {
    const p=(y*TILE_SIZE+x)*4,block=(y>>4)*BLOCKS+(x>>4);
    const rgb=data[p]*65536+data[p+1]*256+data[p+2];
    if(rgb===8388608)missing[block]=1;
    else maxima[block]=Math.max(maxima[block],rgb<8388608?rgb:rgb-16777216);
  }
  const prefix=new Uint16Array(17*17);
  for(let y=0;y<BLOCKS;y++)for(let x=0;x<BLOCKS;x++) {
    const id=(y+1)*17+x+1;
    prefix[id]=missing[y*BLOCKS+x]+prefix[id-1]+prefix[id-17]-prefix[id-18];
  }
  const tables=[maxima];
  for(let y=0;y<LEVELS;y++)for(let x=0;x<LEVELS;x++) {
    if(!x&&!y)continue;
    const prev=tables[x?y*LEVELS+x-1:(y-1)*LEVELS],step=x?2**(x-1):2**(y-1)*BLOCKS;
    const width=BLOCKS-(2**x)+1,height=BLOCKS-(2**y)+1;
    const table=new Int32Array(256);
    for(let by=0;by<height;by++)for(let bx=0;bx<width;bx++) {
      const id=by*BLOCKS+bx;
      table[id]=Math.max(prev[id],prev[id+step]);
    }
    tables.push(table);
  }
  return {tables,prefix};
}

function rectangleMax(tile,left,right,top,bottom) {
  const a=LOG[right-left+1],b=LOG[bottom-top+1];
  const table=tile.tables[b*LEVELS+a],x=right-(2**a)+1,y=bottom-(2**b)+1;
  return Math.max(table[top*BLOCKS+left],table[top*BLOCKS+x],
    table[y*BLOCKS+left],table[y*BLOCKS+x]);
}

function rectangleHasNoData({prefix},left,right,top,bottom) {
  const a=top*17,b=(bottom+1)*17;
  return prefix[b+right+1]-prefix[a+right+1]-prefix[b+left]+prefix[a+left]>0;
}

// Match the legacy operations, rather than inverting pixel-centre axes.
const tileXf=(lon,z)=>(lon+180)/360*2**z;
const DEG=Math.PI/180;
const tileYf=(lat,z)=>{const r=lat*DEG;return (1-Math.log(Math.tan(r)+1/Math.cos(r))/Math.PI)/2*2**z;};
const insideJapan=b=>b.south>=20&&b.north<=46&&b.west>=122&&b.east<=154;
const validBox=b=>b&&[b.south,b.north,b.west,b.east].every(Number.isFinite)&&b.south<=b.north&&b.west<=b.east;
function createHeightLookup(tileAt,maxCoverageTiles) {
  function layerBounds(box,layer,z,work) {
    const a=tileXf(box.west,z),b=tileXf(box.east,z),c=tileYf(box.north,z),d=tileYf(box.south,z);
    if(![a,b,c,d].every(Number.isFinite)||a>b||c>d)return {reason:'projection-unproved'};
    const x0=Math.floor(a),x1=Math.floor(b),y0=Math.floor(c),y1=Math.floor(d);
    const count=(x1-x0+1)*(y1-y0+1);
    if(!Number.isSafeInteger(count)||count<1||count>maxCoverageTiles-work.tiles)return {reason:'query-tile-budget'};
    let max=HEIGHT_INDEX_NO_DATA,allValid=true,anyNoData=false,has404=false;
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){
      work.tiles++;
      const tile=tileAt(layer,z,x,y);
      if(tile===undefined)return {reason:'tile-unrecorded'};
      if(tile===null){has404=true;allValid=false;continue;}
      const left=x===x0?Math.floor((a%1)*BLOCKS):0,right=x===x1?Math.floor((b%1)*BLOCKS):15;
      const top=y===y0?Math.floor((c%1)*BLOCKS):0,bottom=y===y1?Math.floor((d%1)*BLOCKS):15;
      max=Math.max(max,rectangleMax(tile,left,right,top,bottom));
      if(rectangleHasNoData(tile,left,right,top,bottom)) {
        allValid=false;
        anyNoData=true;
      }
    }
    return {max,allValid,anyNoData,has404};
  }
  function oneZoom(box,requested,work) {
    let upper=HEIGHT_INDEX_NO_DATA;
    for(let layer=0;layer<5;layer++){
      const result=layerBounds(box,layer,Math.min(requested,HEIGHT_INDEX_LAYERS[layer][1]),work);
      if(result.reason)return result;
      upper=Math.max(upper,result.max);
      if(layer===2){
        // DEM10 undefined invokes the unbounded API fallback. A recorded 404
        // is known absence, unlike an unrecorded tile, but neither is sea level.
        if(result.has404)return {reason:'dem10-unavailable-api-fallback'};
        if(result.anyNoData)upper=Math.max(upper,0);
        // If all DEM10 pixels are null, legacy stops before DEM5B/5C.
        if(result.max===HEIGHT_INDEX_NO_DATA)return {cm:Math.max(upper,0)};
      } else if(result.allValid)return {cm:upper};
    }
    return upper===HEIGHT_INDEX_NO_DATA?{reason:'unresolved-height'}:{cm:upper};
  }
  function upper(box,zoomLo,zoomHi=zoomLo) {
    if(!validBox(box)||!insideJapan(box))return null;
    if(!Number.isInteger(zoomLo)||!Number.isInteger(zoomHi)||zoomLo<0||zoomHi>17||zoomLo>zoomHi)return null;
    let cm=HEIGHT_INDEX_NO_DATA;const work={tiles:0};
    for(let zoom=zoomLo;zoom<=zoomHi;zoom++){
      const result=oneZoom(box,zoom,work);if(result.reason)return null;cm=Math.max(cm,result.cm);
    }
    if(cm===HEIGHT_INDEX_NO_DATA)return null;
    // The original pixelToElevation uses this multiplication, not division.
    return cm*.01;
  }
  return upper;
}

export function createResidentHeightIndex(currentTile) {
  // Only a successfully decoded image or a confirmed absence is evidence.
  // An identity lookup must read the same cache that serves exact sampling.
  const blocks=new WeakMap();
  const get=(layer,z,x,y)=>currentTile(HEIGHT_INDEX_LAYERS[layer][0],z,x,y);
  function begin() {
    const used=new Map(),observed=new Map();
    let consistent=true;
    function tileAt(layer,z,x,y) {
      const tile=get(layer,z,x,y);
      if(!tile||!tile.image&&tile.missing!==true)return undefined;
      let packed=null;
      if(tile.image) {
        const {width,height,data}=tile.image;
        if(width!==256||height!==256||data?.length!==4*65536)return undefined;
        packed=blocks.get(tile.image);
        if(!packed) {
          packed=indexTile(data);
          blocks.set(tile.image,packed);
        }
      }
      const key=layer+'/'+z+'/'+x+'/'+y;
      if(!observed.has(key))observed.set(key,{layer,z,x,y,tile});
      return packed;
    }
    const lookup=createHeightLookup(tileAt,4096);
    return {
      upper(...args) {
        observed.clear();
        return lookup(...args);
      },
      commitUpper() {
        for(const [key,record] of observed) {
          const previous=used.get(key);
          if(!previous)used.set(key,record);
          else if(previous.tile!==record.tile)consistent=false;
        }
      },
      stillCurrent() {
        if(!consistent)return false;
        for(const {layer,z,x,y,tile} of used.values()) {
          if(get(layer,z,x,y)!==tile)return false;
        }
        return true;
      }
    };
  }
  return {begin};
}
