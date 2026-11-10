/* Bundled OpenStreetMap places (tools/build-osm-places.mjs): the parks, squares, viewpoints, riverbank paths, water,
   rivers, small woods, trees and bridges that new places need, per 2nd-order mesh, so a search does not wait on Overpass. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesOsmPlaces=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
const RAD=Math.PI/180;
function mesh(lat,lon){const my=Math.floor(lat*120),mx=Math.floor(lon*80);return ''+Math.floor(my/80)+(Math.floor(mx/80)-100)+Math.floor(my%80/10)+Math.floor(mx%80/10);}
function meshesIn([w,s,e,n]){const out=new Set();for(let y=Math.floor(s*12)/12;y<=n+1/24;y+=1/12)for(let x=Math.floor(w*8)/8;x<=e+1/16;x+=1/8){const la=Math.min(n,Math.max(s,y+1e-9)),lo=Math.min(e,Math.max(w,x+1e-9));out.add(mesh(la,lo));}out.add(mesh(s,w));out.add(mesh(n,e));out.add(mesh(s,e));out.add(mesh(n,w));return [...out];}
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
  if(!parts.has(code))parts.set(code,(async()=>{const r=await fetchImpl(base+code+'.json.gz?v='+entry[0]);if(!r.ok)throw Error('osm-part');
   const bytes=await r.arrayBuffer();if(!(await sha(bytes)).startsWith(entry[0]))throw Error('osm-part-version');
   const rows=JSON.parse(await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).text());for(const row of rows){decode(row);row.b=bbox(row);}return rows;})().catch(e=>{parts.delete(code);throw e;}));
  if(parts.size>48)parts.delete(parts.keys().next().value);
  return parts.get(code);
 }
 async function rowsIn(box){const seen=new Set(),out=[];for(const code of meshesIn(box))for(const row of await part(code)){const key=row.t+row.i+'/'+(row.s??'');if(seen.has(key)||!overlaps(row.b,box))continue;seen.add(key);out.push(row);}return out;}
 // Elements for a place-provider tile.
 async function elementsIn(box){return (await rowsIn(box)).map(element);}
 // Trees and elevated structures near the ground track from a to b (lat/lon), as rings [[lat,lon]], lines or points.
 async function obstaclesAlong(a,b){
  const pad=40/110540,box=[Math.min(a.longitude,b.longitude)-pad/Math.cos(a.latitude*RAD),Math.min(a.latitude,b.latitude)-pad,Math.max(a.longitude,b.longitude)+pad/Math.cos(a.latitude*RAD),Math.max(a.latitude,b.latitude)+pad];
  const out=[];for(const row of await rowsIn(box)){const o=obstacle(row);if(!o)continue;
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
