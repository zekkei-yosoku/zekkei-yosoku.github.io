/* Photo-inspired surface; phase geometry is computed, never baked into a generated image. */
(function(g){
'use strict';
const DEG=Math.PI/180, SIZE=512, tokens=new WeakMap();let sourcePromise=null;
function lightVector(f,angle){
 if(!Number.isFinite(f)||!Number.isFinite(angle)||f<0||f>1)throw Error('Invalid lunar phase');
 const z=2*f-1,s=Math.sqrt(Math.max(0,1-z*z)),a=angle*DEG;
 // Same sky convention as aimLimbDir: zenith=0, positive toward screen left.
 return {x:-Math.sin(a)*s,y:-Math.cos(a)*s,z};
}
function incidence(x,y,f,angle){const r=x*x+y*y;if(r>1)return null;const l=lightVector(f,angle);return x*l.x+y*l.y+Math.sqrt(Math.max(0,1-r))*l.z;}
function circularSurface(base,size){
 const out=new Uint8ClampedArray(base),r=size/2;
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const nx=x+.5-r,ny=y+.5-r,rr=Math.hypot(nx,ny),i=(y*size+x)*4;if(rr>r)continue;
  // Texture alpha is an artistic cutout, not a measured lunar limb. Extend edge colour inward-to-outward.
  if(base[i+3]<250){let found=false;for(let step=1;step<=r;step++){
   const scale=Math.max(0,rr-step)/Math.max(rr,1),sx=Math.min(size-1,Math.max(0,Math.floor(r+nx*scale))),sy=Math.min(size-1,Math.max(0,Math.floor(r+ny*scale))),j=(sy*size+sx)*4;
   if(base[j+3]>=250){for(let k=0;k<3;k++)out[i+k]=base[j+k];found=true;break;}
  }if(!found)for(let k=0;k<3;k++)out[i+k]=209;}
  out[i+3]=255;
 }return out;
}
function shade(base,size,f,angle){
 const output=new Uint8ClampedArray(base.length),r=size/2,l=lightVector(f,angle);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const nx=(x+.5-r)/r,ny=(y+.5-r)/r,rr=nx*nx+ny*ny,i=(y*size+x)*4;if(rr>1)continue;
  const mu=Math.sqrt(1-rr),dot=nx*l.x+ny*l.y+mu*l.z;
  // Lommel-Seeliger-like regolith shading: no spurious limb darkening at full Moon.
  const bright=dot>0?Math.pow(Math.min(1,2*dot/(dot+mu+.00001)),.65):0;
  // Earthshine-like night side (2026-10-19 user choice over pure black / flat grey): the disc stays opaque and the
  // surface pattern remains just visible, so the full Moon outline reads on both light and dark pages.
  const exposure=.11+.89*bright;
  for(let k=0;k<3;k++)output[i+k]=base[i+k]*exposure;
  output[i+3]=base[i+3]*Math.max(0,Math.min(1,(1-Math.sqrt(rr))*r));
 }
 return output;
}
// 2026-10-20 ユーザー「月の満ち欠けってこれ模様正確か?」「僕がとったデータから生成して向きを合わせるのにNASAのやつと合わせる」。
// 月面はユーザーの写真（2024-10-17 18:16:38 JST）から作った絵のまま。その瞬間の首振り（秤動）PHOTO.l/b を外して球に戻し、
// 描く日時の首振り（librationLongitude/Latitude）と自転軸の向き（axisPositionAngle）で貼り直す。
// 絵の月の北の向き PHOTO.theta は NASA SVS Dial-a-Moon の満月（2026-10-26 12:00 UTC）と照合して求めた（一致度 0.12→0.73）。NASA の画像は使っていない
const PHOTO=Object.freeze({l:0.8898,b:-1.9765,theta:35.25});
let globeKey=null,globeCanvas=null;
function globe(pixels,l,b,P){
 const out=new Uint8ClampedArray(SIZE*SIZE*4),r=SIZE/2,a=-P*DEG,ca=Math.cos(a),sa=Math.sin(a),cb=Math.cos(b*DEG),sb=Math.sin(b*DEG);
 const cb0=Math.cos(PHOTO.b*DEG),sb0=Math.sin(PHOTO.b*DEG),ct=Math.cos(PHOTO.theta*DEG),st=Math.sin(PHOTO.theta*DEG);
 for(let py=0;py<SIZE;py++)for(let px=0;px<SIZE;px++){
  const x=(px+.5-r)/r,y=-(py+.5-r)/r,rr=x*x+y*y;if(rr>=1)continue;
  const z=Math.sqrt(1-rr),xr=x*ca-y*sa,yr=x*sa+y*ca;
  const lat=Math.asin(Math.max(-1,Math.min(1,yr*cb+z*sb))),dl=(l-PHOTO.l)*DEG+Math.atan2(xr,z*cb-yr*sb);
  const cl=Math.cos(lat),sl=Math.sin(lat);let X=cl*Math.sin(dl),Y=sl*cb0-cl*Math.cos(dl)*sb0;
  // 写真に写っていない縁の外側（首振りで見える細い帯）は、写真の縁の色で埋める
  if(sl*sb0+cl*Math.cos(dl)*cb0<0){const h=Math.hypot(X,Y)||1;X*=.995/h;Y*=.995/h;}
  const u=X*ct-Y*st,v=X*st+Y*ct,fx=(u+1)/2*(SIZE-1),fy=(1-v)/2*(SIZE-1),x0=Math.floor(fx),y0=Math.floor(fy),tx=fx-x0,ty=fy-y0;
  const x1=Math.min(SIZE-1,x0+1),y1=Math.min(SIZE-1,y0+1),o=(py*SIZE+px)*4;
  for(let k=0;k<3;k++){const p00=pixels[(y0*SIZE+x0)*4+k],p10=pixels[(y0*SIZE+x1)*4+k],p01=pixels[(y1*SIZE+x0)*4+k],p11=pixels[(y1*SIZE+x1)*4+k];
   out[o+k]=(p00*(1-tx)+p10*tx)*(1-ty)+(p01*(1-tx)+p11*tx)*ty;}
  out[o+3]=255;
 }
 return out;
}
function globeFor(surface,state){
 const l=Number.isFinite(state.librationLongitude)?state.librationLongitude:PHOTO.l,b=Number.isFinite(state.librationLatitude)?state.librationLatitude:PHOTO.b,P=Number.isFinite(state.axisPositionAngle)?state.axisPositionAngle:0;
 const key=[l,b,P].map(v=>v.toFixed(1)).join(',');
 if(globeKey!==key||!globeCanvas){globeCanvas=globeCanvas||document.createElement('canvas');globeCanvas.width=SIZE;globeCanvas.height=SIZE;
  const c=globeCanvas.getContext('2d'),img=c.createImageData(SIZE,SIZE);img.data.set(globe(surface.pixels,l,b,P));c.putImageData(img,0,0);globeKey=key;}
 return globeCanvas;
}
function source(){
 if(sourcePromise)return sourcePromise;
 sourcePromise=new Promise((resolve,reject)=>{
  const image=new Image();let done=false;const timer=setTimeout(()=>{if(done)return;done=true;reject(Error('Lunar surface timeout'));},10000);image.decoding='async';image.onload=()=>{
   if(done)return;done=true;clearTimeout(timer);
   try{
    const full=document.createElement('canvas');full.width=image.naturalWidth;full.height=image.naturalHeight;const ctx=full.getContext('2d',{willReadFrequently:true});ctx.drawImage(image,0,0);
    const p=ctx.getImageData(0,0,full.width,full.height).data;let x0=full.width,y0=full.height,x1=0,y1=0;
    for(let y=0;y<full.height;y++)for(let x=0;x<full.width;x++)if(p[(y*full.width+x)*4+3]>200){x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}
    if(x1<=x0||y1<=y0)throw Error('Empty lunar surface');
    const flat=document.createElement('canvas');flat.width=SIZE;flat.height=SIZE;const fc=flat.getContext('2d',{willReadFrequently:true});fc.drawImage(image,x0,y0,x1-x0+1,y1-y0+1,0,0,SIZE,SIZE);
    resolve({image,x:x0,y:y0,width:x1-x0+1,height:y1-y0+1,pixels:circularSurface(fc.getImageData(0,0,SIZE,SIZE).data,SIZE)});
   }catch(e){reject(e);}
  };image.onerror=()=>{if(done)return;done=true;clearTimeout(timer);reject(Error('Lunar surface unavailable'));};image.src='almanac-moon-surface-v1.png';
 }).catch(e=>{sourcePromise=null;throw e;});return sourcePromise;
}
async function draw(canvas,state){
 const token={};tokens.set(canvas,token);canvas.width=SIZE;canvas.height=SIZE;
 let surface=null;try{surface=await source();}catch{/* A texture failure must not suppress the computed phase. */}
 if(tokens.get(canvas)!==token||canvas.isConnected===false)return {stale:true};
 const work=document.createElement('canvas');work.width=SIZE;work.height=SIZE;const ctx=work.getContext('2d',{willReadFrequently:true});
 ctx.save();ctx.translate(SIZE/2,SIZE/2);ctx.rotate((state.parallacticAngle||0)*DEG);
 if(surface)ctx.drawImage(globeFor(surface,state),-SIZE/2,-SIZE/2,SIZE,SIZE);
 else{ctx.fillStyle='#d1d0ca';ctx.beginPath();ctx.arc(0,0,SIZE/2,0,2*Math.PI);ctx.fill();}ctx.restore();
 const frame=ctx.getImageData(0,0,SIZE,SIZE);frame.data.set(shade(circularSurface(frame.data,SIZE),SIZE,state.illuminatedFraction,state.brightLimbZenithAngle));canvas.getContext('2d').putImageData(frame,0,0);
 canvas.setAttribute('aria-label',`月の満ち欠け・輝面 ${(state.illuminatedFraction*100).toFixed(1)}%`);return {texture:!!surface};
}
const api={lightVector,incidence,circularSurface,shade,globe,PHOTO,draw};g.SoramiMoonPortrait=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
