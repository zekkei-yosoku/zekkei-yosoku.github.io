import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const code=html.slice(html.indexOf('function aimLookSolidSilhouette('),html.indexOf('async function aimLookRender('));
function run(size,pattern){let raw,out,width,height;
 const canvas={getContext(){return {setTransform(){},resetTransform(){},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},getImageData(){width=canvas.width;height=canvas.height;raw=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++)raw[(y*width+x)*4+3]=pattern(x,y,width,height);return {data:raw.slice()};},putImageData(i){out=i.data;}};}};
 const ctx=vm.createContext({document:{createElement:()=>canvas}});vm.runInContext(code,ctx);
 ctx.polys=[[[0,0],[size,0],[size,size],[0,size]]];vm.runInContext('aimLookSolidSilhouette(polys)',ctx);
 // 独立した単純な4近傍探索を期待値にする。モデルの走査順・ラン方式には依存しない。
 const outside=new Set(),stack=[];const visit=i=>{if(!outside.has(i)&&raw[i*4+3]===0){outside.add(i);stack.push(i);}};
 for(let x=0;x<width;x++){visit(x);visit((height-1)*width+x);}for(let y=0;y<height;y++){visit(y*width);visit(y*width+width-1);}
 while(stack.length){const i=stack.pop(),x=i%width;if(x)visit(i-1);if(x<width-1)visit(i+1);if(i>=width)visit(i-width);if(i<width*(height-1))visit(i+width);}
 for(let i=0;i<width*height;i++){const x=i%width,edge=(x&&outside.has(i-1))||(x<width-1&&outside.has(i+1))||(i>=width&&outside.has(i-width))||(i<width*(height-1)&&outside.has(i+width));const expected=!outside.has(i)&&!edge?255:raw[i*4+3];assert.equal(out[i*4+3],expected,'alpha at '+i);}
}
test('輪郭マスクはラン探索でも閉穴・開口・半透明境界を独立探索と一致させる',()=>{
 run(60,(x,y,w,h)=>x===2||y===2||x===w-3||y===h-3?255:0);
 run(60,(x,y,w,h)=>x===2||x===w-3||y===h-3?255:0);
 // 複数の細い透明ランが連結する迷路。キューの拡張と重複防止も確認。
 run(200,(x,y,w,h)=>x%2&&y>1&&y<h-2&&y!==(x%4?3:h-4)?255:0);
 let seed=74031;for(let c=0;c<30;c++)run(24,()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%7===0?80:seed%3===0?255:0;});
});
