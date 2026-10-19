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
function shade(base,size,f,angle){
 const output=new Uint8ClampedArray(base.length),r=size/2,l=lightVector(f,angle);
 for(let y=0;y<size;y++)for(let x=0;x<size;x++){
  const nx=(x+.5-r)/r,ny=(y+.5-r)/r,rr=nx*nx+ny*ny,i=(y*size+x)*4;if(rr>1)continue;
  const mu=Math.sqrt(1-rr),dot=nx*l.x+ny*l.y+mu*l.z;
  // Lommel-Seeliger-like regolith shading: no spurious limb darkening at full Moon.
  const bright=dot>0?Math.pow(Math.min(1,2*dot/(dot+mu+.00001)),.65):0;
  const exposure=.008+.992*bright;
  for(let k=0;k<3;k++)output[i+k]=base[i+k]*exposure;
  output[i+3]=base[i+3]*Math.max(0,Math.min(1,(1-Math.sqrt(rr))*r));
 }
 return output;
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
    if(x1<=x0||y1<=y0)throw Error('Empty lunar surface');resolve({image,x:x0,y:y0,width:x1-x0+1,height:y1-y0+1});
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
 if(surface)ctx.drawImage(surface.image,surface.x,surface.y,surface.width,surface.height,-SIZE/2,-SIZE/2,SIZE,SIZE);
 else{ctx.fillStyle='#d1d0ca';ctx.beginPath();ctx.arc(0,0,SIZE/2,0,2*Math.PI);ctx.fill();}ctx.restore();
 const frame=ctx.getImageData(0,0,SIZE,SIZE);frame.data.set(shade(frame.data,SIZE,state.illuminatedFraction,state.brightLimbZenithAngle));canvas.getContext('2d').putImageData(frame,0,0);
 canvas.setAttribute('aria-label',`月の満ち欠け・照明率 ${(state.illuminatedFraction*100).toFixed(1)}%`);return {texture:!!surface};
}
const api={lightVector,incidence,shade,draw};g.SoramiMoonPortrait=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
