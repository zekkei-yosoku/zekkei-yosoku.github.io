import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('./sorami-scroll-timeline.js',import.meta.url),'utf8'),DAY=86400000;
function setup(width=240){let next=0;const frames=new Map(),timers=new Map(),changes=[],state={at:Date.parse('2028-11-05T16:04:37.250+09:00'),mode:'date',enabled:true};
 const make=()=>({style:{setProperty(){}},dataset:{},children:[],listeners:{},scrollLeft:0,clientWidth:width,attrs:{},setAttribute(k,v){this.attrs[k]=v},replaceChildren(...c){this.children=c},addEventListener(k,f){this.listeners[k]=f}}),root=make();
 const c={document:{createElement:make},requestAnimationFrame:f=>{frames.set(++next,f);return next},cancelAnimationFrame:i=>frames.delete(i),setTimeout:f=>{timers.set(++next,f);return next},clearTimeout:i=>timers.delete(i)};vm.createContext(c);vm.runInContext(src,c);
 const controller=c.SoramiScrollTimeline.mount({root,getAt:()=>state.at,getMode:()=>state.mode,enabled:()=>state.enabled,onChange:at=>{state.at=at;changes.push(at);controller.sync(at,state.mode)},format:at=>new Date(at).toISOString()});controller.sync(state.at,state.mode);
 const flush=()=>{for(const [id,f] of [...frames]){frames.delete(id);f();}};const settle=()=>{flush();for(const [id,f] of [...timers]){timers.delete(id);f();}};
 return {c,root,state,controller,changes,flush,settle,scroll(dx){root.listeners.wheel({deltaX:dx,deltaY:0});root.scrollLeft+=dx;root.listeners.scroll();flush();}};
}
test('固定目盛りは画面幅によらず24px=1日、4px=1分で左右対称、日付は秒まで保持する',()=>{
 for(const width of [160,240,340,780]){const f=setup(width),before=f.state.at;f.scroll(24);assert.equal(f.state.at,before+DAY);f.scroll(-48);assert.equal(f.state.at,before-DAY);assert.equal((f.state.at+32400000)%DAY,(before+32400000)%DAY);f.settle();assert.equal(f.root.scrollLeft,4096);
 f.state.mode='time';f.controller.sync(f.state.at,'time');const at=f.state.at;f.scroll(4);assert.equal(f.state.at,at+60000);f.scroll(-8);assert.equal(f.state.at,at-60000);}
});
test('タップだけでは跳ばず、止まった後の再操作を何度繰り返しても端に達しない',()=>{
 const f=setup(),at=f.state.at;f.root.listeners.pointerdown();f.root.listeners.pointerup();assert.equal(f.state.at,at);assert.equal(f.changes.length,0);
 for(let i=1;i<=250;i++){f.scroll(72);assert.equal(f.state.at,at+i*3*DAY);f.settle();assert.equal(f.root.scrollLeft,4096);assert.equal(f.root.children[0].style.width,'8432px');}
});
test('1pxの揺れで日付が動かず、同フレーム入力を集約、離脱やモード変更後の古い仕事を止める',()=>{
 const f=setup(),at=f.state.at;f.scroll(1);assert.equal(f.state.at,at);assert.equal(f.changes.length,0);f.root.listeners.wheel({deltaX:24,deltaY:0});f.root.scrollLeft=4096+24;for(let i=0;i<10;i++)f.root.listeners.scroll();f.flush();assert.equal(f.changes.length,1);
 f.root.scrollLeft+=24;f.root.listeners.scroll();f.controller.stop();f.state.enabled=false;f.flush();f.settle();assert.equal(f.state.at,at+DAY);
 f.state.enabled=true;f.state.mode='time';f.controller.sync(f.state.at,'time');f.root.listeners.keydown({key:'PageDown',preventDefault(){}});assert.equal(f.state.at,at+DAY+15*60000);assert.equal(f.root.dataset.mode,'time');
});
test('時刻目盛りは午前0時を自然に越え、外部の日時変更と幅変更へ同期する',()=>{
 const f=setup();f.state.at=Date.parse('2028-11-05T23:59:37.250+09:00');f.state.mode='time';f.controller.sync(f.state.at,'time');f.scroll(8);assert.equal(new Date(f.state.at+32400000).toISOString().slice(0,19),'2028-11-06T00:01:37');f.settle();
 f.state.at+=10*DAY;f.controller.sync(f.state.at,'time');assert.equal(f.root.scrollLeft,4096);f.root.clientWidth=160;f.controller.sync(f.state.at,'time');assert.equal(f.root.children[0].style.width,'8352px');
});

test('非表示でscrollLeftが0に戻っても再開で中心を復元し、外部の日時選択を残った慣性で上書きしない',()=>{
 const f=setup(),at=f.state.at;f.controller.stop();f.root.scrollLeft=0;f.root.listeners.scroll();f.flush();assert.equal(f.state.at,at);f.controller.sync(at,'date');assert.equal(f.root.scrollLeft,4096);
 f.scroll(48);f.state.at=at+30*DAY;f.controller.sync(f.state.at,'date');f.root.scrollLeft+=72;f.root.listeners.scroll();f.flush();assert.equal(f.state.at,at+30*DAY);f.controller.sync(f.state.at,'date');f.scroll(24);assert.equal(f.state.at,at+31*DAY);
});
test('iOSのpointercancel後もtouchendまでは中央へ戻さず、停止中の指で日付を二重加算しない',()=>{
 const f=setup(),at=f.state.at;f.root.listeners.touchstart();f.root.listeners.pointercancel();f.root.scrollLeft=4120;f.root.listeners.scroll();f.flush();f.settle();assert.equal(f.root.scrollLeft,4120);assert.equal(f.state.at,at+DAY);f.root.listeners.touchend();f.settle();assert.equal(f.root.scrollLeft,4096);assert.equal(f.state.at,at+DAY);
});

test('マウスのドラッグも同じ尺度で動き、日付モードは1日、時刻モードは1分のキー操作を持つ',()=>{
 const f=setup(),at=f.state.at;f.root.listeners.pointerdown({pointerType:'mouse',pointerId:1,clientX:100,preventDefault(){}});f.root.listeners.pointermove({clientX:76});f.root.listeners.scroll();f.flush();f.root.listeners.pointerup();f.settle();assert.equal(f.state.at,at+DAY);f.root.listeners.keydown({key:'ArrowLeft',preventDefault(){}});assert.equal(f.state.at,at);f.state.mode='time';f.controller.sync(at,'time');f.root.listeners.keydown({key:'ArrowRight',preventDefault(){}});assert.equal(f.state.at,at+60000);
});
test('朝焼け・日中・夕焼け・夜は観測地点の太陽高度で区別し、白夜・極夜にも対応',()=>{
 const f=setup(),phase=f.c.SoramiScrollTimeline.solarPhase,o={latitude:35,longitude:139};
 assert.equal(phase(0,o,()=>({geometricAltitude:-10})),'night');assert.equal(phase(0,o,()=>({geometricAltitude:30})),'day');
 assert.equal(phase(0,o,t=>({geometricAltitude:t/60000})),'morning');assert.equal(phase(0,o,t=>({geometricAltitude:-t/60000})),'evening');
 assert.equal(phase(0,null,()=>{throw Error('unexpected')}),null);assert.equal(phase(0,o,()=>({geometricAltitude:NaN})),null);
});
test('スクロールが始まる前の指の遊び中に非同期描画が来ても目盛りを戻さない',()=>{
 const f=setup();f.root.listeners.touchstart();f.root.scrollLeft+=6;f.controller.sync(f.state.at,'date');assert.equal(f.root.scrollLeft,4102);f.root.listeners.scroll();f.flush();f.root.listeners.touchend();f.settle();assert.equal(f.root.scrollLeft,4096);
});
test('素早く離すと慣性スクロールを残し、指を止めて離すと精密な位置で止める',()=>{
 const f=setup();f.state.mode='time';f.controller.sync(f.state.at,'time');const at=f.state.at;
 f.root.listeners.touchstart({timeStamp:100});f.root.listeners.touchmove({timeStamp:120});f.root.scrollLeft+=24;f.root.listeners.scroll();f.flush();f.root.listeners.touchend({timeStamp:130});assert.equal(f.root.scrollLeft,4120);f.root.scrollLeft+=16;f.root.listeners.scroll();f.flush();assert.equal(f.state.at,at+10*60000);f.settle();assert.equal(f.root.scrollLeft,4096);
 f.root.listeners.touchstart({timeStamp:200});f.root.listeners.touchmove({timeStamp:220});f.root.scrollLeft+=8;f.root.listeners.scroll();f.flush();f.root.listeners.touchend({timeStamp:500});assert.equal(f.root.scrollLeft,4096);assert.equal(f.state.at,at+12*60000);
});
test('無効化中の指離し・慣性・非表示を経て再開しても元の日付から固定量だけ動く',()=>{
 const f=setup(),at=f.state.at;f.root.listeners.touchstart({timeStamp:100});f.root.scrollLeft+=24;f.root.listeners.scroll();f.flush();f.state.enabled=false;f.root.listeners.touchend({timeStamp:200});f.root.scrollLeft=0;f.root.listeners.scroll();f.settle();f.state.enabled=true;f.controller.sync(f.state.at,'date');f.scroll(24);assert.equal(f.state.at,at+2*DAY);
});
