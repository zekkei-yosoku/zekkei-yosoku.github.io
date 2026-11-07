import {createNativeGroundPoint} from './native-ground-point.mjs';
const patch=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Native ground boundary changed: '+a.slice(0,100));return s.replace(a,b);};
export function patchNativeGroundPoint(source){
 let s=patch(source,'  const tiles = new Map();','  const tiles = new Map();\n  const tileAvailability = new WeakMap();');
 // Availability belongs to one tile promise. The historical demMissing set is
 // also used by water checks and can outlive a failed refresh, so do not use it.
 const start=s.indexOf('  function loadTile('),end=s.indexOf('  /// 古いものから消す。',start);
 if(start<0||end<start)throw Error('Native ground tile boundary changed');
 let tile=s.slice(start,end);
 tile=patch(tile,'function loadTile(z, x, y, layer = "dem_png")','function loadTile(z, x, y, layer = "dem_png", strict = false)');
 tile=patch(tile,'    const p = (async () => {',`    const availability={missing:false,verified:false};
    // Image success confirms this exact layer. Image failure never confirms 404.
    const verifiedImage=async(url)=>{const image=await loadTileByImage(url);if(image)availability.verified=true;return image;};
    const p = (async () => {`);
 tile=patch(tile,'if (hit.headers.get(DEM_MISSING)) { demMissing.add(key); return null; }','if (hit.headers.get(DEM_MISSING)) { availability.missing=true;demMissing.add(key); return null; }');
 tile=patch(tile,'            if (img) return img;','            if (img) { availability.verified=true;return img; }');
 tile=patch(tile,'if (!cache || typeof fetch !== "function")','if (typeof fetch !== "function" || (!cache && !strict))');
 tile=patch(tile,'return tileLimited(() => loadTileByImage(url));','return tileLimited(() => verifiedImage(url));');
 tile=patch(tile,'        return loadTileByImage(url);','        return verifiedImage(url);');
 tile=patch(tile,'        if (res.status === 404) {','        if (res.status === 404) {\n          availability.missing=true;');
 tile=patch(tile,'    tiles.set(key, p);','    tileAvailability.set(p,availability);\n    tiles.set(key, p);');
 tile=patch(tile,'      const img = await decodeTile(blob);\n      if (!img) return loadTileByImage(url);',`      let img = await decodeTile(blob);
      if(!img){
        if(!strict)return verifiedImage(url);
        // HTTP 200 is confirmed. Decode those exact bytes through a local blob
        // when ImageBitmap is unavailable; do not issue an unverified image GET.
        if(typeof global.URL?.createObjectURL==='function'){
          let local;
          try{local=global.URL.createObjectURL(blob);img=await loadTileByImage(local);}
          catch{/* Keep the legacy Image retry if local blob decoding is unavailable. */}
          finally{if(local)global.URL.revokeObjectURL(local);}
        }
        if(!img)return verifiedImage(url);
      }
      availability.verified=true;`);
 s=s.slice(0,start)+tile+s.slice(end);
 const entry='  async function groundElevation(lat, lon, { withSource = false, fetchImpl = global.fetch } = {}) {';
 const helper='  // Trial: share native-resolution PNGs for dense path/area samples. The 2026-10-05\n  // decision above is retained: isolated points can cost more initial tile requests.\n  // Confirmed source/pixel rounding matches the point API; unknown tiles use that API.\n  const nativeGroundPoint=('+createNativeGroundPoint.toString()+')({readTile:async(z,x,y,layer)=>{\n    const pending=loadTile(z,x,y,layer,true),image=await pending,availability=tileAvailability.get(pending);\n    return image&&availability?.verified?{image}:{missing:availability?.missing===true};\n  }});\n';
 s=patch(s,entry,helper+entry);
 const api='        try {\n          const res = typeof fetchImpl === "function" ? await pointLimited(async () => {';
 const native=`        // Preserve explicit injected point providers. Normal callers first share
        // native-resolution PNGs, and keep the same point URL/cache/source contract.
        if(typeof fetchImpl==='function'&&fetchImpl===global.fetch){
          const j=await nativeGroundPoint(lat,lon),v=j?parsePoint(j):null;
          if(v){
            if(cache){try{
              await cache.put(url,new Response(JSON.stringify(j),{status:200,headers:{"content-type":"application/json",[DEM_AT]:String(Date.now())}}));
              pruneDemCache(cache);
            }catch{/* A cache write failure must not discard a verified value. */}}
            return v;
          }
        }
`;
 s=patch(s,api,native+api);
 return s;
}
