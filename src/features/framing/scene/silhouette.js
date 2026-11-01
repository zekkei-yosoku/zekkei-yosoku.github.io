function aimLookSolidSilhouette(polygons,{closeBase=false,basePoints=[]}={}) {
  polygons=polygons.filter(poly=>poly.length>=3&&poly.every(p=>p.every(Number.isFinite)));
  if(!polygons.length)return null;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const poly of polygons)for(const [x,y]of poly){minX=Math.min(minX,x);minY=Math.min(minY,y);maxX=Math.max(maxX,x);maxY=Math.max(maxY,y);}
  const scaleX=Math.min(2,2040/Math.max(1,maxX-minX)),scaleY=Math.min(2,2040/Math.max(1,maxY-minY));
  const x=minX-2/scaleX,y=minY-2/scaleY,w=Math.ceil((maxX-minX)*scaleX)+4,h=Math.ceil((maxY-minY)*scaleY)+4;
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
  const c=canvas.getContext('2d',{willReadFrequently:true});c.setTransform(scaleX,0,0,scaleY,-x*scaleX,-y*scaleY);c.fillStyle='#000';
  // 向きが逆の部品が重なっても相殺しない。1つのcompound pathにしない。
  for(const original of polygons){
    // ほぼ同じ連続点があるとcanvasの塗りで大きな三角欠けが出ることがある。
    // マスクの0.1画素未満だけ整理する。細い3点部品は元の点を維持。
    const clean=[],distance=(a,b)=>Math.hypot((a[0]-b[0])*scaleX,(a[1]-b[1])*scaleY);
    for(const p of original){const last=clean.at(-1);if(!last||distance(p,last)>=.1)clean.push(p);}
    if(clean.length>1&&distance(clean.at(-1),clean[0])<.1)clean.pop();
    const poly=clean.length>=3?clean:original;
    c.beginPath();c.moveTo(...poly[0]);for(const p of poly)c.lineTo(...p);c.closePath();c.fill();
  }
  // 足元を塗りつぶす目標だけ、基部の横幅と投影高さの帯で地面へ開く空白を閉じる。凸包にはしない。
  if(closeBase&&basePoints.length>=2){
    const feet=basePoints.filter(p=>p.every(Number.isFinite));
    if(feet.length>=2){
      const left=Math.min(...feet.map(p=>p[0])),right=Math.max(...feet.map(p=>p[0]));
      const upper=Math.min(...feet.map(p=>p[1])),lower=Math.max(...feet.map(p=>p[1]));
      c.fillRect(left,upper-1/scaleY,right-left,lower-upper+1/scaleY);
    }
  }
  c.resetTransform();const image=c.getImageData(0,0,w,h),data=image.data,n=w*h;
  // 横の透明ランを一度だけ登録する。画素数ぶんのキューを確保せず、必要時に拡張。
  const outside=new Uint8Array(n);let queue=new Int32Array(Math.min(n*2,Math.max(w,h)*4)),head=0,tail=0,filled=0;
  const empty=i=>!outside[i]&&data[i*4+3]===0;
  const visit=i=>{
    if(!empty(i))return;
    const row=Math.floor(i/w)*w;let left=i,right=i;
    while(left>row&&empty(left-1))left--;
    while(right<row+w-1&&empty(right+1))right++;
    outside.fill(1,left,right+1);
    if(tail+2>queue.length){const next=new Int32Array(Math.min(n*2,queue.length*2));next.set(queue);queue=next;}
    queue[tail++]=left;queue[tail++]=right;return right;
  };
  for(let i=0;i<w;i++){visit(i);visit((h-1)*w+i);}for(let j=1;j<h-1;j++){visit(j*w);visit(j*w+w-1);}
  while(head<tail){
    const left=queue[head++],right=queue[head++];
    for(const offset of [-w,w]){
      if(left+offset<0||right+offset>=n)continue;
      for(let i=left+offset;i<=right+offset;i++){if(empty(i))i=visit(i);}
    }
  }
  for(let i=0;i<n;i++)if(!outside[i]){
    const col=i%w,edge=(col&&outside[i-1])||(col<w-1&&outside[i+1])||(i>=w&&outside[i-w])||(i<n-w&&outside[i+w]);
    if(!edge){if(data[i*4+3]===0)filled++;data[i*4+3]=255;}
  }
  c.putImageData(image,0,0);return {canvas,x,y,width:w/scaleX,height:h/scaleY,filled};
}

export {aimLookSolidSilhouette};
