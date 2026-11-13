// 線上の木の高さ（2026-11-13 ユーザー「新宿御苑から東京タワーは見えないよ」→「必要ならば全部やって」）。
// Meta・WRIの樹高地図v2と同じ形（Web Mercator、512画素のDEFLATE区画、uint8のm）の小さなCOGを作って読む。
import test from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';import {deflateSync} from 'node:zlib';
const require=createRequire(import.meta.url),T=require('./src/features/candidates/tree-heights.js');
const RM=6378137,RAD=Math.PI/180,merc=(lat,lon)=>[RM*lon*RAD,RM*Math.log(Math.tan(Math.PI/4+lat*RAD/2))];
const observer={latitude:35.71,longitude:139.805,elevation:5,eyeM:1.5};
// 縮小版（2段目）が4m刻み・512画素の1区画。見る人は西端から約270m、北端から約330mの所。
function cog(paint){
 const [x0,y0]=merc(observer.latitude+.003,observer.longitude-.003),full=2,l1=new Uint8Array(512*512);
 const at=(north,east)=>{const [X,Y]=merc(observer.latitude+north/110540,observer.longitude+east/(111320*Math.cos(observer.latitude*RAD)));return [Math.floor((Y0-Y)/(full*2)),Math.floor((X-X0)/(full*2))];};
 const X0=x0,Y0=y0;paint((north,east,m)=>{const [r,c]=at(north,east);if(r>=0&&r<512&&c>=0&&c<512)l1[r*512+c]=m;});
 const blocks=[deflateSync(new Uint8Array(512*512)),deflateSync(new Uint8Array(512*512)),deflateSync(new Uint8Array(512*512)),deflateSync(new Uint8Array(512*512)),deflateSync(l1)];
 // IFD0: 1024 px（2x2区画）、IFD1: 512 px。目次は先頭、区画はその後ろ。
 const ifd=(n,extra)=>12*n+6,entries0=10,entries1=8,head=8,ifd0=head,ifd1=ifd0+ifd(entries0),data=ifd1+ifd(entries1);
 const arr0=data,doubles=arr0+32,blockStart=doubles+72;let p=blockStart;const offs=blocks.map(b=>{const o=p;p+=b.length;return o;});
 const buf=Buffer.alloc(p);buf.write('II',0);buf.writeUInt16LE(42,2);buf.writeUInt32LE(ifd0,4);
 const put=(base,list,next)=>{buf.writeUInt16LE(list.length,base);list.forEach(([tag,type,count,value],i)=>{const e=base+2+i*12;buf.writeUInt16LE(tag,e);buf.writeUInt16LE(type,e+2);buf.writeUInt32LE(count,e+4);
  if(type===3&&count===1)buf.writeUInt16LE(value,e+8);else buf.writeUInt32LE(value,e+8);});buf.writeUInt32LE(next,base+2+list.length*12);};
 put(ifd0,[[256,4,1,1024],[257,4,1,1024],[258,3,1,8],[259,3,1,8],[322,3,1,512],[323,3,1,512],[324,4,4,arr0],[325,4,4,arr0+16],[33550,12,3,doubles],[33922,12,6,doubles+24]],ifd1);
 put(ifd1,[[256,4,1,512],[257,4,1,512],[258,3,1,8],[259,3,1,8],[322,3,1,512],[323,3,1,512],[324,4,1,offs[4]],[325,4,1,blocks[4].length]],0);
 for(let i=0;i<4;i++){buf.writeUInt32LE(offs[i],arr0+4*i);buf.writeUInt32LE(blocks[i].length,arr0+16+4*i);}
 [full,full,0,0,0,0,x0,y0,0].forEach((v,i)=>buf.writeDoubleLE(v,doubles+8*i));
 blocks.forEach((b,i)=>b.copy(buf,offs[i]));return buf;
}
function world(paint,{fail=false}={}){
 const t=T.tileOf(observer.latitude,observer.longitude),name=T.quadkey(t.x,t.y)+'.tif',file=cog(paint),seen=[];
 const fetchImpl=async(url,{headers})=>{seen.push(url);if(fail)throw Error('offline');if(!url.endsWith(name))return new Response('',{status:404});
  const [,a,b]=headers.Range.match(/bytes=(\d+)-(\d+)/);return new Response(file.subarray(+a,Math.min(file.length,+b+1)),{status:206});};
 return {trees:T.create({fetchImpl,base:'https://example.test/chm/',groundAt:async()=>5}),seen};
}
const north=(altitude,maxM=1500)=>({azimuth:0,altitude,maxM,refractionK:7/6});
const grove=put=>{for(let n=100;n<=130;n+=2)for(let e=-12;e<=12;e+=2)put(n,e,20);};

test('木の先端（地面＋樹高）より下を通る線は木に遮られ、上を通る線は通る',async()=>{
 const {trees}=world(grove);
 assert.equal(await trees.canopy(observer.latitude+115/110540,observer.longitude),20);
 const low=await trees.sight(observer,north(5));assert.equal(low.status,'blocked');assert(Math.abs(low.hit.distanceM-100)<6,String(low.hit.distanceM));assert.equal(low.hit.topM,25);
 assert.equal((await trees.sight(observer,north(20))).status,'clear');
 // 先端の上2m以内は確かめられない
 const graze=await trees.sight(observer,north(Math.atan((25.5-6.5)/100)*180/Math.PI));assert.equal(graze.status,'unknown');
});
test('立つ所のすぐ脇の木と、対象の足元の木は線の判定に数えない',async()=>{
 const near=world(put=>{for(let n=-4;n<=6;n+=2)put(n,0,20);}).trees;assert.equal((await near.sight(observer,north(5))).status,'clear');
 const end=world(put=>{for(let n=1300;n<=1340;n+=2)put(n,0,30);}).trees,target={latitude:observer.latitude+1400/110540,longitude:observer.longitude,elevation:40};
 assert.equal((await end.sight(observer,{...north(0,1400),endpoint:target})).status,'clear');
});
test('対象への線では、木が対象のどの高さまで隠すかを返す',async()=>{
 const {trees}=world(grove),D=1000,target={latitude:observer.latitude+D/110540,longitude:observer.longitude,elevation:300};
 const r=await trees.sight(observer,{...north(0,D),endpoint:target,footM:5});assert.equal(r.status,'clear');
 const c=1/(2*6371008.8*7/6),s=r.skyline.distanceM,expect=6.5+(25-6.5-c*s*s)/s*D+c*D*D;
 assert(Math.abs(r.skyline.toM-expect)<1e-6);assert(r.skyline.toM>170&&r.skyline.toM<200,String(r.skyline.toM));
});
test('樹高地図が読めない、地面が読めないときは「読めない」で、遮るとも通るとも言わない。ファイルの無い所（海）は木が無い',async()=>{
 assert.equal((await world(grove,{fail:true}).trees.sight(observer,north(5))).status,'unread');
 const noGround=T.create({fetchImpl:async()=>{throw Error('x');},groundAt:async()=>null});assert.equal((await noGround.sight(observer,north(5))).status,'unread');
 const sea=T.create({fetchImpl:async()=>new Response('',{status:404}),groundAt:async()=>0});assert.equal((await sea.sight(observer,north(1))).status,'clear');
});
test('目次は実際のファイルと同じ形で読める（タグ・縮小版の並び）',()=>{
 const dirs=T.directories(cog(()=>{}).buffer.slice(0));assert.equal(dirs.length,2);assert.equal(dirs[0][256],1024);assert.equal(dirs[1][256],512);assert.equal(dirs[0][259],8);assert.equal(dirs[1][324].length===undefined?1:dirs[1][324].length,1);
});
