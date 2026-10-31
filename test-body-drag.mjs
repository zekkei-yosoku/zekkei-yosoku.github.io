import {sourceHtml} from './tools/test-source.mjs';
import {createRequire} from "node:module";
const require=createRequire(import.meta.url);
const fs=require('fs'),vm=require('vm'),assert=require('assert/strict');
const AL=require('./astronotes-align.js');
const html=sourceHtml();const a=html.indexOf('function aimLookPick('),b=html.indexOf('\n/**',a);const code=html.slice(a,b);
const element=()=>({hidden:false,disabled:false,textContent:'',attrs:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]}});
const els={};for(const key of ['pick','found','confirm','hint','controls','cancel','position'])els[`[data-look-${key}]`]=element();
const buttons=['-1,0','0,-1','0,1','1,0'].map(v=>Object.assign(element(),{dataset:{bodyNudge:v}}));
const original={key:'previous',points:[{latitude:1}],at:{at:123}};const spec={at:123,obs:{},pick:true};const host={_lookSeq:1,_pick:{base:spec,reverseBefore:original,ghost:null},querySelector:q=>els[q],querySelectorAll:()=>buttons};
const cv=Object.assign(element(),{getBoundingClientRect:()=>({left:10,top:20,width:200,height:150}),setPointerCapture(){}});
let renders=[],draws=0;// 逆算は 2026-10-20 に止めた（AIM_REVERSE_ENABLED=false）。処理は残しているので、戻したとき用に有効にして検査する
const c={AIM_REVERSE_ENABLED:true,AIM_PLACE_ENABLED:false,aimShift:{x:0,y:0},aim:{body:'moon',reverse:original},AstroNotesBodies:{definition:()=>({name:'月'})},AstroNotesAlign:AL,AimMap:{redraw(){}},aimLookRender:(h,s)=>renders.push(s),aimLookFound(){},requestAnimationFrame:f=>{f();return 1},Date,Math,Number,Array};vm.createContext(c);vm.runInContext(code+';this.pick=aimLookPick;',c);
function mount(W=400,H=300,k=100){c.pick(host,{spec,cv,draw:()=>draws++,W,H,k,win:{az0:270,alt0:5},az:270,topAngle:5,D:1,path:[],toPx:xy=>xy?[W/2+xy[0]*k,H/2-xy[1]*k]:null,pan:()=>[0,0],pathTap(){},bodyPosition:()=>[80,90]});}
const ev=(x,y,id=1)=>({clientX:x,clientY:y,pointerId:id,pointerType:'touch',button:0});
mount();cv.onpointerdown(ev(150,100));cv.onpointerup(ev(150,100));assert.equal(host._pick.ghost,null,'tap must not teleport');
cv.onpointerdown(ev(150,100));cv.onpointermove(ev(150,99));assert.equal(host._pick.ghost,null,'subthreshold move');cv.onpointermove(ev(170,80));assert.deepEqual([...host._pick.ghost],[120,50]);
cv.onpointermove(ev(190,100,2));assert.deepEqual([...host._pick.ghost],[120,50],'second pointer ignored');cv.onpointerup(ev(170,80));buttons[3].onclick();assert.deepEqual([...host._pick.ghost],[121,50]);
cv.onkeydown({key:'ArrowUp',shiftKey:true,preventDefault(){}});assert.deepEqual([...host._pick.ghost],[121,40]);
host._pick.busy=true;buttons[3].onclick();cv.onpointerdown(ev(150,100));cv.onpointermove(ev(200,150));assert.deepEqual([...host._pick.ghost],[121,40],'busy cannot change position');els['[data-look-cancel]'].onclick();assert.ok(host._pick,'busy cancel locked');host._pick.busy=false;
const angle=[...host._pick.ghostAngle];host._pick.busy=true;host._lookSeq++;mount(800,600,200);assert.equal(host._pick.busy,false,"resize invalidates old solve and unlocks controls");assert.equal(buttons[3].disabled,false);assert.ok(Math.abs(host._pick.ghost[0]-242)<1e-8 && Math.abs(host._pick.ghost[1]-80)<1e-8,'angle preserved across resize');assert.deepEqual([...host._pick.ghostAngle],angle);
els['[data-look-cancel]'].onclick();assert.equal(host._pick,null);assert.equal(c.aim.reverse,original);assert.equal(renders.at(-1),spec);assert.ok(draws>0);
console.log('PASS: no tap teleport; drag delta and scale; threshold; pointer isolation; 1px/Shift10px; busy guard; angle resize; cancel preserves previous result');

c.AIM_REVERSE_ENABLED=false;c.AIM_PLACE_ENABLED=true;c.AstroNotesBodies.definition=()=>({name:'月',limbs:true});
let placement=null,mapOpens=0;c.aimShiftFromPlacement=(x,y)=>{placement=[x,y]};c.aimLineSheetOpen=()=>mapOpens++;
host.id='aimLook';host._bodyRadius=.25;host._pick={base:spec,initialBase:spec,ghost:null};mount();
cv.onpointerdown(ev(80,80));cv.onpointermove(ev(100,60));cv.onpointerup(ev(100,60));
assert(host._pick.ghost);await els['[data-look-pick]'].onclick();
assert.equal(host._pick,null,'finish exits placement mode');assert(placement?.every(Number.isFinite),'finish preserves search placement');assert.equal(mapOpens,0,'finish does not unexpectedly open a map');assert.equal(renders.at(-1),spec);
host._pick={base:spec,initialBase:spec,ghost:null};placement=null;mount();await els['[data-look-pick]'].onclick();assert.equal(placement,null,'finish without movement does not change placement');
console.log('PASS: dormant placement mode preserves search position, finishes inline, and leaves an unchanged position alone');

c.AIM_REVERSE_ENABLED=false;c.AIM_PLACE_ENABLED=false;host._pick=null;mount();
assert.equal(els['[data-look-pick]'].hidden,true,'latest UI removes body position adjustment');
await els['[data-look-pick]'].onclick();assert.equal(host._pick,null,'disabled entry cannot activate placement even programmatically');
console.log('PASS: body placement and reverse lookup remain disabled under current flags');
