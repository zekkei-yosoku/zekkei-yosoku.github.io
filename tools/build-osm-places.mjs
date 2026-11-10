// 2026-11-11 Trial only. 探すの「新しい地点」の材料を、OpenStreetMapの日本の抽出（Geofabrik japan-latest.osm.pbf）から作る。
//   node --max-old-space-size=8192 tools/build-osm-places.mjs PBF OUT_DIR
// 公開のOverpassは混む時間帯に1区画30秒以上かかり探索が進まない（2026-11-10夜）。同じ材料を前もって2次メッシュ（約10km）ごとに
// 持てば、探索はOverpassに頼らない。取り出すもの:
//   候補の場所 … 公園・庭園・広場（leisure=park|garden|recreation_ground、place=square、歩行者用の広場）、展望地点・展望台
//   立てる道   … 候補の場所の中か縁から15m、または川の線から300m・水面から150m以内の園路（footway|path|pedestrian|steps）の、その区間だけ
//   判定の材料 … 水面（natural=water、waterway=riverbank）と川（候補か川の近く300m）
//   視線の障害 … 候補の場所から500m以内の林・並木・木（natural=wood は点が500以下の小さな林、tree_row、tree。山の森林は持たない）、
//                1km以内の橋・高架（道・鉄道の bridge、layer>=1、man_made=bridge）
// 外部パッケージは使わない。点の座標は必要なものだけ持つため、関係→道→点の順に読む。
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import path from 'node:path';

class Reader{
 constructor(b,s=0,e=b.length){this.b=b;this.p=s;this.end=e;}
 eof(){return this.p>=this.end;}
 varint(){let r=0,m=1,x;do{x=this.b[this.p++];r+=(x&127)*m;m*=128;}while(x&128);return r;}
 bytes(){const n=this.varint(),s=this.p;this.p+=n;return [s,this.p];}
 skip(w){if(w===0)this.varint();else if(w===1)this.p+=8;else if(w===2){const n=this.varint();this.p+=n;}else if(w===5)this.p+=4;else throw Error('wire '+w);}
}
const zig=n=>n%2===0?n/2:-(n+1)/2;
function* packed(b,[s,e]){const r=new Reader(b,s,e);while(!r.eof())yield r.varint();}

const KEEP=new Set(['name','name:ja','leisure','place','tourism','tower:type','highway','area','area:highway','natural','water','waterway','building','landuse','bridge','layer','railway','man_made','access','foot','location','indoor','tunnel','covered','level','ele','height','floor:height','source:floor:height','embankment','type']);
const candidateArea=t=>['park','garden','recreation_ground'].includes(t.leisure)||t.place==='square'||t.tourism==='viewpoint'||t['tower:type']==='observation'||t.highway==='pedestrian'&&t.area==='yes'||['footway','pedestrian'].includes(t['area:highway']);
const walk=t=>['footway','path','pedestrian','steps'].includes(t.highway);
const water=t=>t.natural==='water'||t.waterway==='riverbank';
const river=t=>['river','canal'].includes(t.waterway);
// Buildings are judged by PLATEAU heights and GSI footprints, not kept here.
const tree=t=>['wood','tree_row','tree'].includes(t.natural);
const elevated=t=>(t.highway||t.railway)&&(t.bridge&&t.bridge!=='no'||Number(t.layer)>=1)||t.man_made==='bridge';
const wanted=t=>candidateArea(t)||walk(t)||water(t)||river(t)||tree(t)||elevated(t);

function blobs(file,fn){
 const fd=fs.openSync(file,'r'),size=fs.fstatSync(fd).size,len=Buffer.alloc(4);let pos=0;
 try{while(pos<size){fs.readSync(fd,len,0,4,pos);pos+=4;const hl=len.readUInt32BE(0),hb=Buffer.alloc(hl);fs.readSync(fd,hb,0,hl,pos);pos+=hl;
  let type='',ds=0;for(const r=new Reader(hb);!r.eof();){const t=r.varint(),f=t>>>3,w=t&7;if(f===1&&w===2){const [s,e]=r.bytes();type=hb.toString('utf8',s,e);}else if(f===3&&w===0)ds=r.varint();else r.skip(w);}
  const at=pos;pos+=ds;if(type!=='OSMData')continue;fn(at,ds,fd);}}finally{fs.closeSync(fd);}
}
function inflate(fd,at,ds){const b=Buffer.alloc(ds);fs.readSync(fd,b,0,ds,at);for(const r=new Reader(b);!r.eof();){const t=r.varint(),f=t>>>3,w=t&7;if(f===1&&w===2){const [s,e]=r.bytes();return b.subarray(s,e);}if(f===3&&w===2){const [s,e]=r.bytes();return zlib.inflateSync(b.subarray(s,e));}r.skip(w);}throw Error('blob');}
function block(buf){
 let st=null,gran=100,latOff=0,lonOff=0;const groups=[];
 for(const r=new Reader(buf);!r.eof();){const t=r.varint(),f=t>>>3,w=t&7;if(f===1&&w===2)st=r.bytes();else if(f===2&&w===2)groups.push(r.bytes());else if(f===17&&w===0)gran=r.varint();else if(f===19&&w===0)latOff=zig(r.varint());else if(f===20&&w===0)lonOff=zig(r.varint());else r.skip(w);}
 const strs=[];if(st)for(const r=new Reader(buf,st[0],st[1]);!r.eof();){const t=r.varint(),f=t>>>3,w=t&7;if(f===1&&w===2)strs.push(r.bytes());else r.skip(w);}
 const cache=new Map(),str=i=>{let v=cache.get(i);if(v===undefined){v=buf.toString('utf8',strs[i][0],strs[i][1]);cache.set(i,v);}return v;};
 return {buf,groups,str,gran,latOff,lonOff};
}
function kindOf(b){for(const [gs,ge] of b.groups)for(const r=new Reader(b.buf,gs,ge);!r.eof();){const t=r.varint(),f=t>>>3,w=t&7;if(f===1||f===2)return 'n';if(f===3)return 'w';if(f===4)return 'r';r.skip(w);}return '';}
function tagsOf(b,keys,vals){const t={};let any=false;for(let i=0;i<keys.length;i++){const k=b.str(keys[i]);if(KEEP.has(k)){t[k]=b.str(vals[i]);any=true;}}return any?t:null;}

// Growable Float64 list (OSM ids exceed 2^32).
class List{constructor(n=1<<20){this.a=new Float64Array(n);this.n=0;}push(v){if(this.n===this.a.length){const b=new Float64Array(this.a.length*2);b.set(this.a);this.a=b;}this.a[this.n++]=v;}view(){return this.a.subarray(0,this.n);}}
function sortedUnique(view){const a=Float64Array.from(view).sort();let n=0;for(let i=0;i<a.length;i++)if(i===0||a[i]!==a[i-1])a[n++]=a[i];return a.subarray(0,n);}
function find(sorted,v){let lo=0,hi=sorted.length-1;while(lo<=hi){const m=(lo+hi)>>1;if(sorted[m]<v)lo=m+1;else if(sorted[m]>v)hi=m-1;else return m;}return -1;}

const [pbf,out]=process.argv.slice(2);if(!pbf||!out)throw Error('usage: PBF OUT_DIR');
const t0=Date.now(),log=s=>console.log(`${((Date.now()-t0)/1000).toFixed(0)}s ${s}`);
const kinds=[];
// Pass 1: classify blocks; keep the multipolygon relations of wanted kinds and their member ways.
const relations=[],memberWays=new List();
blobs(pbf,(at,ds,fd)=>{const b=block(inflate(fd,at,ds)),k=kindOf(b);kinds.push([at,ds,k]);if(k!=='r')return;
 for(const [gs,ge] of b.groups)for(const r=new Reader(b.buf,gs,ge);!r.eof();){const t=r.varint(),f=t>>>3,w=t&7;if(f!==4||w!==2){r.skip(w);continue;}
  const [s,e]=r.bytes();let id=0,keys=[],vals=[],roles=[],mem=[],types=[];
  for(const x=new Reader(b.buf,s,e);!x.eof();){const t2=x.varint(),f2=t2>>>3,w2=t2&7;if(f2===1&&w2===0)id=x.varint();else if(f2===2&&w2===2)keys=[...packed(b.buf,x.bytes())];else if(f2===3&&w2===2)vals=[...packed(b.buf,x.bytes())];else if(f2===8&&w2===2)roles=[...packed(b.buf,x.bytes())];else if(f2===9&&w2===2)mem=[...packed(b.buf,x.bytes())];else if(f2===10&&w2===2)types=[...packed(b.buf,x.bytes())];else x.skip(w2);}
  const tags=tagsOf(b,keys,vals);if(!tags||tags.type!=='multipolygon'||!wanted(tags)||tree(tags))continue;
  let ref=0;const members=[];for(let i=0;i<mem.length;i++){ref+=zig(mem[i]);if(types[i]===1){members.push([ref,b.str(roles[i])]);memberWays.push(ref);}}
  relations.push({id,tags,members});}
});
const memberSet=sortedUnique(memberWays.view());log(`blocks ${kinds.length}, relations ${relations.length}, member ways ${memberSet.length}`);
// Pass 2: ways that are wanted themselves or members of those relations; collect the nodes they use.
const ways=new Map(),needed=new List(1<<24);
for(const [at,ds,k] of kinds){if(k!=='w')continue;const fd=fs.openSync(pbf,'r');let b;try{b=block(inflate(fd,at,ds));}finally{fs.closeSync(fd);}
 for(const [gs,ge] of b.groups)for(const r=new Reader(b.buf,gs,ge);!r.eof();){const t=r.varint(),f=t>>>3,w=t&7;if(f!==3||w!==2){r.skip(w);continue;}
  const [s,e]=r.bytes();let id=0,keys=[],vals=[],refs=null;
  for(const x=new Reader(b.buf,s,e);!x.eof();){const t2=x.varint(),f2=t2>>>3,w2=t2&7;if(f2===1&&w2===0)id=x.varint();else if(f2===2&&w2===2)keys=[...packed(b.buf,x.bytes())];else if(f2===3&&w2===2)vals=[...packed(b.buf,x.bytes())];else if(f2===8&&w2===2)refs=x.bytes();else x.skip(w2);}
  const tags=keys.length?tagsOf(b,keys,vals):null,member=find(memberSet,id)>=0;if(!member&&!(tags&&wanted(tags)))continue;
  const list=[];let ref=0;for(const v of packed(b.buf,refs))list.push(ref+=zig(v));
  if(!member&&tags.natural==='wood'&&list.length>500)continue;
  for(const v of list)needed.push(v);
  ways.set(id,{tags:tags&&wanted(tags)?tags:null,refs:Float64Array.from(list)});}
}
const nodeIds=sortedUnique(needed.view());log(`ways ${ways.size}, nodes needed ${nodeIds.length}`);
// Pass 3: coordinates of those nodes (ids ascend in the file) and the wanted tagged nodes.
const lat=new Int32Array(nodeIds.length),lon=new Int32Array(nodeIds.length),have=new Uint8Array(nodeIds.length),points=[];let ptr=0,lastId=0;
for(const [at,ds,k] of kinds){if(k!=='n')continue;const fd=fs.openSync(pbf,'r');let b;try{b=block(inflate(fd,at,ds));}finally{fs.closeSync(fd);}
 const scale=v=>Math.round((b.latOff+b.gran*v)/100),scaleLon=v=>Math.round((b.lonOff+b.gran*v)/100);
 for(const [gs,ge] of b.groups)for(const r=new Reader(b.buf,gs,ge);!r.eof();){const t=r.varint(),f=t>>>3,w=t&7;if(f!==2||w!==2){r.skip(w);continue;}
  const [ds2,de2]=r.bytes();let ids=null,la=null,lo=null,kv=null;
  for(const d=new Reader(b.buf,ds2,de2);!d.eof();){const t2=d.varint(),f2=t2>>>3,w2=t2&7;if(f2===1&&w2===2)ids=d.bytes();else if(f2===8&&w2===2)la=d.bytes();else if(f2===9&&w2===2)lo=d.bytes();else if(f2===10&&w2===2)kv=d.bytes();else d.skip(w2);}
  const I=[...packed(b.buf,ids)],A=[...packed(b.buf,la)],O=[...packed(b.buf,lo)],KV=kv?[...packed(b.buf,kv)]:[];let id=0,a=0,o=0,q=0;
  for(let i=0;i<I.length;i++){id+=zig(I[i]);a+=zig(A[i]);o+=zig(O[i]);
   let keys=[],vals=[];if(KV.length){while(q<KV.length&&KV[q]!==0){keys.push(KV[q]);vals.push(KV[q+1]);q+=2;}q++;}
   // Node ids ascend through the file: walk the needed ids alongside, falling back to a search if they do not.
   if(id<lastId)ptr=Math.max(0,find(nodeIds,id));lastId=id;
   while(ptr<nodeIds.length&&nodeIds[ptr]<id)ptr++;
   if(ptr<nodeIds.length&&nodeIds[ptr]===id){lat[ptr]=scale(a);lon[ptr]=scaleLon(o);have[ptr]=1;}
   if(keys.length){const tags=tagsOf(b,keys,vals);if(tags&&(candidateArea(tags)||tree(tags)))points.push({id,tags,lat:scale(a),lon:scaleLon(o)});}}
 }
}
log(`points ${points.length}, coordinates ${have.reduce((s,v)=>s+v,0)}/${nodeIds.length}`);
// Geometry, then keep by distance to the candidate places.
const geom=refs=>{const g=[];for(const v of refs){const i=find(nodeIds,v);if(i<0||!have[i])return null;g.push(lat[i],lon[i]);}return g;};
const items=[];
for(const [id,w] of ways)if(w.tags){const g=geom(w.refs);if(g&&g.length>=4)items.push({t:'w',i:id,k:w.tags,g});}
for(const rel of relations){const m=[];let ok=true;for(const [wid,role] of rel.members){const w=ways.get(wid),g=w&&geom(w.refs);if(!g){ok=false;break;}m.push({r:role,g});}if(ok&&m.length)items.push({t:'r',i:rel.id,k:rel.tags,m});}
for(const p of points)items.push({t:'n',i:p.id,k:p.tags,a:p.lat,o:p.lon});
const bboxOf=it=>{let s=Infinity,w=Infinity,n=-Infinity,e=-Infinity;const add=g=>{for(let i=0;i<g.length;i+=2){s=Math.min(s,g[i]);n=Math.max(n,g[i]);w=Math.min(w,g[i+1]);e=Math.max(e,g[i+1]);}};
 if(it.t==='n')add([it.a,it.o]);else if(it.t==='w')add(it.g);else for(const m of it.m)add(m.g);return [w/1e7,s/1e7,e/1e7,n/1e7];};
for(const it of items)it.b=bboxOf(it);
// Spatial index of anchors: candidate areas (and viewpoints) and rivers, on 0.01 deg cells.
const CELL=.01,cellKey=(x,y)=>Math.floor(x/CELL)+','+Math.floor(y/CELL),index=(list)=>{const m=new Map();for(const it of list){for(let x=Math.floor(it.b[0]/CELL);x<=Math.floor(it.b[2]/CELL);x++)for(let y=Math.floor(it.b[1]/CELL);y<=Math.floor(it.b[3]/CELL);y++){const k=x+','+y;if(!m.has(k))m.set(k,[]);m.get(k).push(it);}}return m;};
const areas=items.filter(it=>candidateArea(it.k)),rivers=items.filter(it=>river(it.k)),areaIdx=index(areas),riverIdx=index(rivers);
const near=(idx,b,m)=>{const mx=m/(111320*Math.cos((b[1]+b[3])/2*Math.PI/180)),my=m/110540;for(let x=Math.floor((b[0]-mx)/CELL);x<=Math.floor((b[2]+mx)/CELL);x++)for(let y=Math.floor((b[1]-my)/CELL);y<=Math.floor((b[3]+my)/CELL);y++)for(const a of idx.get(x+','+y)||[])if(a.b[0]-mx<=b[2]&&a.b[2]+mx>=b[0]&&a.b[1]-my<=b[3]&&a.b[3]+my>=b[1])return true;return false;};
// 2026-11-11 A walk is kept only where 探す can stand on it as a new place (place-provider.js): inside a candidate area or
// within 15 m of its edge, or by a river (300 m of a river's line and 150 m of water). The rest of a long sidewalk is cut
// off (about 6 in 10 of the bytes were sidewalks no search could use). Bridges and elevated lines within 1 km of a place.
const waters=items.filter(it=>water(it.k)),KY=110540,KX=y=>111320*Math.cos(y*Math.PI/180);
const linesOf=it=>it.t==='w'?[it.g]:it.t==='r'?it.m.map(m=>m.g):[];
// Segments on 0.002 deg cells (about 200 m) with the item they belong to: a river or lake outline can have tens of
// thousands of points, so distances and inside tests look only at the segments near the point.
const SEG=.002;
function segments(list){
 const cells=new Map(),segs=new List(1<<22);let n=0;
 list.forEach((it,no)=>{for(const g of linesOf(it))for(let i=2;i<g.length;i+=2){const y1=g[i-2]/1e7,x1=g[i-1]/1e7,y2=g[i]/1e7,x2=g[i+1]/1e7,id=n++;segs.push(y1);segs.push(x1);segs.push(y2);segs.push(x2);segs.push(no);
  for(let cx=Math.floor(Math.min(x1,x2)/SEG);cx<=Math.floor(Math.max(x1,x2)/SEG);cx++)for(let cy=Math.floor(Math.min(y1,y2)/SEG);cy<=Math.floor(Math.max(y1,y2)/SEG);cy++){const k=cx*1e5+cy;let c=cells.get(k);if(!c)cells.set(k,c=[]);c.push(id);}}});
 return {cells,segs:segs.view(),list};
}
function within(ix,y,x,m){const my=m/KY,kx=KX(y),mx=m/kx,S=ix.segs;
 for(let cx=Math.floor((x-mx)/SEG);cx<=Math.floor((x+mx)/SEG);cx++)for(let cy=Math.floor((y-my)/SEG);cy<=Math.floor((y+my)/SEG);cy++)for(const id of ix.cells.get(cx*1e5+cy)||[]){const o=id*5;
  const ax=(S[o+1]-x)*kx,ay=(S[o]-y)*KY,dx=(S[o+3]-S[o+1])*kx,dy=(S[o+2]-S[o])*KY,l=dx*dx+dy*dy,t=l?Math.max(0,Math.min(1,-(ax*dx+ay*dy)/l)):0;if(Math.hypot(ax+t*dx,ay+t*dy)<=m)return true;}
 return false;}
// Even-odd inside any item of the set: a ray east along the point's cell row, each segment counted once per item.
function insideAny(ix,y,x){const cy=Math.floor(y/SEG),S=ix.segs,seen=new Set(),odd=new Map();
 for(let cx=Math.floor(x/SEG),end=Math.floor((ix.east(y,x))/SEG);cx<=end;cx++)for(const id of ix.cells.get(cx*1e5+cy)||[]){if(seen.has(id))continue;seen.add(id);const o=id*5,y1=S[o],x1=S[o+1],y2=S[o+2],x2=S[o+3];
  if((y1>y)!==(y2>y)&&x<(x2-x1)*(y-y1)/(y2-y1)+x1)odd.set(S[o+4],!odd.get(S[o+4]));}
 for(const v of odd.values())if(v)return true;return false;}
const areaSegs=segments(areas),waterSegs=segments(waters),riverSegs=segments(rivers);
// How far east a ray must go: the east edge of the candidate areas whose box holds the point.
areaSegs.east=(y,x)=>{let e=x;for(const a of areaIdx.get(cellKey(x,y))||[])if(a.b[0]<=x&&a.b[2]>=x&&a.b[1]<=y&&a.b[3]>=y)e=Math.max(e,a.b[2]);return e;};
const nearNode=(y,x,m)=>{for(const a of areaIdx.get(cellKey(x,y))||[])if(a.t==='n'&&Math.hypot((a.o/1e7-x)*KX(y),(a.a/1e7-y)*KY)<=m)return true;return false;};
const RIVERSIDE=/河川敷|川.*テラス|riverside|riverbank/i;
const standable=(it,y,x)=>within(areaSegs,y,x,15)||nearNode(y,x,15)||insideAny(areaSegs,y,x)||
 within(waterSegs,y,x,150)&&(within(riverSegs,y,x,300)||RIVERSIDE.test(it.k.name||it.k['name:ja']||''));
// The stretches of a walk line worth keeping, each with one more point at both ends so a crossing segment stays whole.
function stretches(it){
 const g=it.g,n=g.length/2,on=new Uint8Array(n);
 for(let i=0;i<n;i++)if(standable(it,g[2*i]/1e7,g[2*i+1]/1e7))on[i]=1;
 for(let i=1;i<n;i++)if(!on[i-1]&&!on[i]&&standable(it,(g[2*i-2]+g[2*i])/2e7,(g[2*i-1]+g[2*i+1])/2e7))on[i-1]=on[i]=1;
 const runs=[];for(let i=0;i<n;){if(!on[i]){i++;continue;}let j=i;while(j+1<n&&on[j+1])j++;const a=Math.max(0,i-1),z=Math.min(n-1,j+1);if(z>a)runs.push(g.slice(2*a,2*z+2));i=j+1;}
 return runs;}
const kept=[];let cut=0;
for(const it of items){const t=it.k;
 if(candidateArea(t)||river(t)){kept.push(it);continue;}
 if(walk(t)){if(!(near(areaIdx,it.b,50)||near(riverIdx,it.b,300)))continue;
  if(it.t!=='w'||t.area==='yes'){if(linesOf(it).some(g=>{for(let i=0;i<g.length;i+=2)if(standable(it,g[i]/1e7,g[i+1]/1e7))return true;return false;}))kept.push(it);continue;}
  const runs=stretches(it);if(!runs.length)continue;if(runs.length===1&&runs[0].length===it.g.length){kept.push(it);continue;}
  cut++;runs.forEach((g,s)=>{const row={...it,g,s};row.b=bboxOf(row);kept.push(row);});continue;}
 if(water(t)){if(near(areaIdx,it.b,300)||near(riverIdx,it.b,300))kept.push(it);continue;}
 if(tree(t)){if(near(areaIdx,it.b,500))kept.push(it);continue;}
 if(elevated(t)&&near(areaIdx,it.b,1000))kept.push(it);}
log(`items ${items.length}, kept ${kept.length} (areas ${areas.length}, rivers ${rivers.length}, walks cut ${cut})`);
// One file per 2nd-order mesh; an item goes to every mesh its box reaches (with 0.003 deg margin).
const meshOf=(y,x)=>{const my=Math.floor(y*120),mx=Math.floor(x*80);return ''+Math.floor(my/80)+(Math.floor(mx/80)-100)+Math.floor(my%80/10)+Math.floor(mx%80/10);};
const parts=new Map();
// Lines as the first point then differences from the previous point (smaller numbers, about a third fewer bytes).
const delta=g=>{const d=g.slice();for(let i=g.length-1;i>=2;i--)d[i]=g[i]-g[i-2];return d;};
for(const it of kept){const b=it.b,M=.003,{b:_,...rest}=it,row=rest.t==='w'?{...rest,g:delta(rest.g)}:rest.t==='r'?{...rest,m:rest.m.map(m=>({...m,g:delta(m.g)}))}:rest;const seen=new Set();
 for(let y=Math.floor((b[1]-M)*15)/15;y<=b[3]+M;y+=1/15)for(let x=Math.floor((b[0]-M)*10)/10;x<=b[2]+M;x+=1/10){const code=meshOf(y+1e-9,x+1e-9);if(seen.has(code))continue;seen.add(code);if(!parts.has(code))parts.set(code,[]);parts.get(code).push(row);}}
fs.mkdirSync(out,{recursive:true});
const indexOut={format:'AstroNotes OSM places v2',built:new Date().toISOString().slice(0,10),source:path.basename(pbf),
 attribution:'© OpenStreetMap contributors (ODbL 1.0) https://www.openstreetmap.org/copyright',
 row:'t: n|w|r, i: OSM id, s: stretch of a cut walk (when a way is kept in pieces), k: kept tags, a/o: node lat/lon (1e-7 deg), g: way lat,lon pairs (1e-7 deg; the first pair, then differences from the previous pair), m: relation ways [{r: role, g}]',parts:{}};
let total=0;
for(const [code,rows] of [...parts].sort()){const data=zlib.gzipSync(Buffer.from(JSON.stringify(rows)),{level:9});fs.writeFileSync(path.join(out,code+'.json.gz'),data);
 indexOut.parts[code]=[crypto.createHash('sha256').update(data).digest('hex').slice(0,16),rows.length,data.length];total+=data.length;}
fs.writeFileSync(path.join(out,'index.json'),JSON.stringify(indexOut));
log(`parts ${parts.size}, bytes ${total}`);
