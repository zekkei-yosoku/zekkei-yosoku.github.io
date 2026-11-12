/* Bundled OpenStreetMap places (tools/build-osm-places.mjs): the parks, squares, viewpoints, riverbank paths, water,
   rivers, small woods, trees and bridges that new places need, per 2nd-order mesh, so a search does not wait on Overpass. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesOsmPlaces=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const RAD=Math.PI/180;
function mesh(lat,lon){const my=Math.floor(lat*120),mx=Math.floor(lon*80);return ''+Math.floor(my/80)+(Math.floor(mx/80)-100)+Math.floor(my%80/10)+Math.floor(mx%80/10);}
function meshesIn([w,s,e,n]){const out=new Set();for(let y=Math.floor(s*12)/12;y<=n+1/24;y+=1/12)for(let x=Math.floor(w*8)/8;x<=e+1/16;x+=1/8){const la=Math.min(n,Math.max(s,y+1e-9)),lo=Math.min(e,Math.max(w,x+1e-9));out.add(mesh(la,lo));}out.add(mesh(s,w));out.add(mesh(n,e));out.add(mesh(s,e));
out.add(mesh(n,w));return [...out];}
const sha=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
const pts=g=>{const out=[];for(let i=0;i<g.length;i+=2)out.push({lat:g[i]/1e7,lon:g[i+1]/1e7});return out;};
// The Overpass "out geom" shape the place provider already parses.
function element(row){
 if(row.t==='n')return {type:'node',id:row.i,tags:row.k,lat:row.a/1e7,lon:row.o/1e7};
 if(row.t==='w')return {type:'way',id:row.i,tags:row.k,geometry:pts(row.g)};
 return {type:'relation',id:row.i,tags:row.k,members:row.m.map(m=>({type:'way',role:m.r,geometry:pts(m.g)}))};
}
function bbox(row){let s=Infinity,w=Infinity,n=-Infinity,e=-Infinity;const add=g=>{for(let i=0;i<g.length;i+=2){const a=g[i]/1e7,o=g[i+1]/1e7;if(a<s)s=a;if(a>n)n=a;if(o<w)w=o;if(o>e)e=o;}};
 if(row.t==='n')add([row.a,row.o]);else if(row.t==='w')add(row.g);else for(const m of row.m)add(m.g);return [w,s,e,n];}
// Lines are stored as the first pair and then differences from the previous pair.
const undelta=g=>{for(let i=2;i<g.length;i++)g[i]+=g[i-2];return g;};
function decode(row){if(row.t==='w')undelta(row.g);else if(row.t==='r')for(const m of row.m)undelta(m.g);return row;}
// Rows of a part on 0.01 deg cells (about 1 km), so a query reads only the cells it touches (2026-11-11: a sight line
// used to scan every row of its parts).
const CELL=.01,cellOf=v=>Math.floor(v/CELL);
function indexed(rows){const cells=new Map();for(const row of rows){const [w,s,e,n]=row.b;for(let x=cellOf(w);x<=cellOf(e);x++)for(let y=cellOf(s);y<=cellOf(n);y++){const k=x*100000+y;let c=cells.get(k);if(!c)cells.set(k,c=[]);c.push(row);}}rows.cells=cells;return rows;}
const overlaps=(a,b)=>a[0]<=b[2]&&a[2]>=b[0]&&a[1]<=b[3]&&a[3]>=b[1];
// Obstacles of unknown height: the line must pass this far above the ground at them to be clear.
function obstacle(row){
 const k=row.k;
 if(['wood','tree_row','tree'].includes(k.natural))return {kind:'tree',capM:25,halfWidthM:k.natural==='tree'?6:k.natural==='tree_row'?5:0};
 if(k.man_made==='bridge')return {kind:'bridge',capM:30,halfWidthM:0};
 if(k.railway&&(k.bridge&&k.bridge!=='no'||Number(k.layer)>=1))return {kind:'railway',capM:15,halfWidthM:8};
 if(k.highway&&(k.bridge&&k.bridge!=='no'||Number(k.layer)>=1))return {kind:'road',capM:20,halfWidthM:12};
 return null;
}
function create({load=null,fetchImpl=(typeof fetch==='function'?fetch.bind(globalThis):null),base='data/osm-places/'}={}){
 let indexPromise=null;const parts=new Map();
 const index=()=>indexPromise||(indexPromise=(load?load('osm-places/index.json'):fetchImpl(base+'index.json').then(r=>{if(!r.ok)throw Error('osm-index');return r.json();})).catch(e=>{indexPromise=null;throw e;}));
 async function part(code){
  const data=await index(),entry=data.parts?.[code];if(!entry)return [];
  if(!parts.has(code))parts.set(code,(async()=>{const r=await fetchImpl(base+code+'.json.gz?v='+entry[0],{signal:globalThis.AbortSignal?.timeout?.(20000)});if(!r.ok)throw Error('osm-part');
   const bytes=await r.arrayBuffer();if(!(await sha(bytes)).startsWith(entry[0]))throw Error('osm-part-version');
   const rows=JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());for(const row of rows){decode(row);row.b=bbox(row);}return indexed(rows);})().catch(e=>{parts.delete(code);throw e;}));
  if(parts.size>48)parts.delete(parts.keys().next().value);
  return parts.get(code);
 }
 async function rowsIn(box,cells=null){const seen=new Set(),out=[];
  const keys=cells||(()=>{const k=[];for(let x=cellOf(box[0]);x<=cellOf(box[2]);x++)for(let y=cellOf(box[1]);y<=cellOf(box[3]);y++)k.push(x*100000+y);return k;})();
  for(const code of meshesIn(box)){const rows=await part(code);for(const k of keys)for(const row of rows.cells?.get(k)||[]){const key=row.t+row.i+'/'+(row.s??'');if(seen.has(key)||!overlaps(row.b,box))continue;seen.add(key);out.push(row);}}
  return out;}
 // Elements for a place-provider tile.
 async function elementsIn(box){return (await rowsIn(box)).map(element);}
 // Trees and elevated structures near the ground track from a to b (lat/lon), as rings [[lat,lon]], lines or points.
 async function obstaclesAlong(a,b){
  const pad=40/110540,box=[Math.min(a.longitude,b.longitude)-pad/Math.cos(a.latitude*RAD),Math.min(a.latitude,b.latitude)-pad,Math.max(a.longitude,b.longitude)+pad/Math.cos(a.latitude*RAD),Math.max(a.latitude,b.latitude)+pad];
  // Only the cells the track passes through (and their neighbours, wider than the 40 m pad), not its whole box.
  const cells=new Set(),steps=Math.max(1,Math.ceil(Math.max(Math.abs(b.latitude-a.latitude),Math.abs(b.longitude-a.longitude))/(CELL/2)));
  for(let i=0;i<=steps;i++){const la=a.latitude+(b.latitude-a.latitude)*i/steps,lo=a.longitude+(b.longitude-a.longitude)*i/steps;for(let dx=-1;dx<=1;dx++)for(let dy=-1;dy<=1;dy++)cells.add((cellOf(lo)+dx)*100000+cellOf(la)+dy);}
  const out=[];for(const row of await rowsIn(box,[...cells])){const o=obstacle(row);if(!o)continue;
   if(row.t==='n')out.push({...o,id:'node/'+row.i,points:[[row.a/1e7,row.o/1e7]]});
   else if(row.t==='w'){const p=[];for(let i=0;i<row.g.length;i+=2)p.push([row.g[i]/1e7,row.g[i+1]/1e7]);const closed=p.length>3&&p[0][0]===p[p.length-1][0]&&p[0][1]===p[p.length-1][1];
    out.push({...o,id:'way/'+row.i,...(closed&&!o.halfWidthM?{rings:[p]}:{lines:[p],halfWidthM:o.halfWidthM||4})});}
   else out.push({...o,id:'relation/'+row.i,rings:row.m.filter(m=>m.r!=='inner').map(m=>{const p=[];for(let i=0;i<m.g.length;i+=2)p.push([m.g[i]/1e7,m.g[i+1]/1e7]);return p;})});}
  return out;
 }
 return {elementsIn,obstaclesAlong,index};
}
return {create,mesh,meshesIn,element,obstacle,decode};
});
