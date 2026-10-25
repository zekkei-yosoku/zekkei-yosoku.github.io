import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const html=fs.readFileSync(new URL('./trial/index.html',import.meta.url),'utf8');
test('1本のtouchは通常スクロール、拡大中のみ構図パン、cancelで解除',()=>{
 const start=html.indexOf('    const gesture = host._lensGesture'),end=html.indexOf('\n  } else {',start),code=html.slice(start,end);
 for(const full of [false,true]){let draws=0;const host={_full:full,_lensOffset:[0,0],_pick:null},cv={getBoundingClientRect:()=>({left:0,top:0}),setPointerCapture(){},dispatchEvent(){}},c={host,cv,W:400,H:300,k:10,frame:{halfH:10},groundEdge:200,panLimit:2,draw(){draws++;},cur:{},navigator:{},Event:class{},Math,Map};vm.createContext(c);vm.runInContext(code,c);const e=(x,y)=>({pointerId:1,pointerType:'touch',clientX:x,clientY:y,button:0});cv.onpointerdown(e(100,100));cv.onpointermove(e(140,130));assert.equal(draws,full?1:0);if(full)assert.deepEqual([...host._lensOffset],[.1,.1]);cv.onpointercancel(e(140,130));assert.equal(host._lensGesture.points.size,0);}
});
test('中央復帰は真の水平線0度を枠の下端へ、枠なしは図下余白へ',()=>{
 const start=html.indexOf('  center.onclick = () => { host._lensKeyOffset'),end=html.indexOf('\n',start),code=html.slice(start,end);
 for(const frame of [{halfH:10},null]){let draws=0;const c={center:{},host:{},toPx:()=>[200,180],proj:()=>[0,0],az:0,H:300,k:10,frame,draw(){draws++;},cur:{},Math};vm.createContext(c);vm.runInContext(code,c);c.center.onclick();const bottom=frame?250:288;assert.equal(180+c.host._lensOffset[1]*300,bottom);assert.equal(c.host._lensOffset[0],0);assert.equal(draws,1);}
});
