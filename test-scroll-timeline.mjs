import test from 'node:test';import assert from 'node:assert/strict';import vm from 'node:vm';import {readFileSync} from 'node:fs';
const src=readFileSync(new URL('./sorami-scroll-timeline.js',import.meta.url),'utf8'),DAY=86400000;
function setup(width=240,options={}){let next=0,simTime=0;const frames=new Map(),timers=new Map(),changes=[],state={at:Date.parse('2028-11-05T16:04:37.250+09:00'),mode:'date',enabled:true};
 const make=()=>({style:{setProperty(){}},dataset:{},children:[],listeners:{},scrollLeft:0,clientWidth:width,attrs:{},setAttribute(k,v){this.attrs[k]=v},replaceChildren(...c){this.children=c},addEventListener(k,f){this.listeners[k]=f}}),root=make();
 const c={performance:{now:()=>simTime},document:{createElement:make},requestAnimationFrame:f=>{frames.set(++next,f);return next},cancelAnimationFrame:i=>frames.delete(i),setTimeout:f=>{timers.set(++next,f);return next},clearTimeout:i=>timers.delete(i)};vm.createContext(c);vm.runInContext(src,c);
 const controller=c.SoramiScrollTimeline.mount({root,getAt:()=>state.at,getMode:()=>state.mode,enabled:()=>state.enabled,onChange:at=>{state.at=at;changes.push(at);controller.sync(at,state.mode)},format:at=>new Date(at).toISOString(),...options});controller.sync(state.at,state.mode);
 const flush=()=>{simTime+=16;for(const [id,f] of [...frames]){frames.delete(id);f();}};const settle=()=>{flush();for(const [id,f] of [...timers]){timers.delete(id);f();}};
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
 const f=setup();f.root.listeners.touchstart();f.root.scrollLeft+=6;f.controller.sync(f.state.at,'date');assert.equal(f.root.scrollLeft,4102);f.root.listeners.scroll();f.flush();f.root.listeners.touchend();for(let i=0;i<12;i++)f.flush();f.settle();assert.equal(f.root.scrollLeft,4096);
});
test('素早く離すと慣性スクロールを残し、指を止めて離すと精密な位置で止める',()=>{
 const f=setup();f.state.mode='time';f.controller.sync(f.state.at,'time');const at=f.state.at;
 f.root.listeners.touchstart({timeStamp:100});f.root.listeners.touchmove({timeStamp:120});f.root.scrollLeft+=24;f.root.listeners.scroll();f.flush();f.root.listeners.touchend({timeStamp:130});assert.equal(f.root.scrollLeft,4120);f.root.scrollLeft+=16;f.root.listeners.scroll();f.flush();assert.equal(f.state.at,at+10*60000);f.settle();assert.equal(f.root.scrollLeft,4096);
 f.root.listeners.touchstart({timeStamp:200});f.root.listeners.touchmove({timeStamp:220});f.root.scrollLeft+=8;f.root.listeners.scroll();f.flush();f.root.listeners.touchend({timeStamp:500});assert.equal(f.root.scrollLeft,4096);assert.equal(f.state.at,at+12*60000);
});
test('無効化中の指離し・慣性・非表示を経て再開しても元の日付から固定量だけ動く',()=>{
 const f=setup(),at=f.state.at;f.root.listeners.touchstart({timeStamp:100});f.root.scrollLeft+=24;f.root.listeners.scroll();f.flush();f.state.enabled=false;f.root.listeners.touchend({timeStamp:200});f.root.scrollLeft=0;f.root.listeners.scroll();f.settle();f.state.enabled=true;f.controller.sync(f.state.at,'date');f.scroll(24);assert.equal(f.state.at,at+2*DAY);
});
test('指を離さず有限バッファの何十倍を送っても、前後とも固定尺度で続く',()=>{
 for(const mode of ['time','date']){const f=setup();f.state.mode=mode;f.controller.sync(f.state.at,mode);const at=f.state.at,pixels=mode==='time'?4:24,step=mode==='time'?60000:DAY;f.root.listeners.touchstart({timeStamp:1});
 for(let i=1;i<=120;i++){f.root.scrollLeft+=pixels*100;f.root.listeners.scroll();f.flush();assert.equal(f.state.at,at+i*100*step);assert.ok(f.root.scrollLeft>2000&&f.root.scrollLeft<6200);}
 for(let i=119;i>=-120;i--){f.root.scrollLeft-=pixels*100;f.root.listeners.scroll();f.flush();assert.equal(f.state.at,at+i*100*step);}
 f.root.listeners.touchend({timeStamp:500});f.settle();assert.equal(f.root.scrollLeft,4096);assert.equal(f.state.at,at-12000*step);}
});
test('空色は高度に連続で補間し、夜・blue hour・golden hour・昼の青を経て文字は4.5以上のcontrast',()=>{
 const {skyColor,skyInk}=setup().c.SoramiScrollTimeline,o={latitude:35,longitude:139};let prev;
 for(let h=-25;h<=80;h+=.1){const rgb=skyColor(0,o,()=>({geometricAltitude:h}));assert.equal(rgb.length,3);assert.ok(rgb.every(v=>v>=0&&v<=255));if(prev)assert.ok(Math.max(...rgb.map((v,i)=>Math.abs(v-prev[i])))<=5);prev=rgb;
 const l=rgb.map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4}).reduce((n,v,i)=>n+v*[.2126,.7152,.0722][i],0),ink=skyInk(rgb),ratio=ink==='#fff'?1.05/(l+.05):(l+.05)/.05;assert.ok(ratio>=4.5);}
 const golden=skyColor(0,o,()=>({geometricAltitude:2})),night=skyColor(0,o,()=>({geometricAltitude:-20}));assert.ok(golden[0]>golden[2]);assert.ok(night[2]>night[0]);
});
test('地点変更でグラデーションを再生成し、日本語captionや色の箱を作らない',()=>{
 let o={latitude:35,longitude:139},calls=0;const f=setup(240,{getObserver:()=>o,sun:(at,p)=>{calls++;return{geometricAltitude:p.latitude>0?2:-18}}});f.state.mode='time';f.controller.sync(f.state.at,'time');const tape=f.root.children[0],before=tape.style.backgroundImage,count=calls;assert.match(before,/linear-gradient/);assert.ok(tape.children.every(e=>e.className==='sky-timeline-label'));f.controller.sync(f.state.at,'time');assert.equal(calls,count);o={latitude:-35,longitude:139};f.controller.sync(f.state.at,'time');assert.notEqual(tape.style.backgroundImage,before);assert.ok(calls>count);
});
test('日付/分の線とラベルの原点を幅によらず一致させ、同じ時刻の空色はrebase/settleで跳ばない',()=>{
 const rgbAt=(image,x)=>{const stops=[...image.matchAll(/rgb\((\d+),(\d+),(\d+)\) (-?[\d.]+)px/g)].map(m=>({rgb:m.slice(1,4).map(Number),x:+m[4]}));for(let i=1;i<stops.length;i++)if(x<=stops[i].x){const a=stops[i-1],b=stops[i],t=(x-a.x)/(b.x-a.x);return a.rgb.map((v,j)=>v+(b.rgb[j]-v)*t);}throw Error('outside gradient');};
 for(const width of [160,223,240,340,780]){const f=setup(width,{getObserver:()=>({latitude:35}),sun:at=>({geometricAltitude:Math.sin(at/20000000)*15})});assert.equal(f.root.children[0].style.backgroundPosition,(4096+width/2)+'px 5px');f.state.mode='time';f.controller.sync(f.state.at,'time');const tape=f.root.children[0],initial=tape.style.backgroundImage;
 f.root.listeners.touchstart({timeStamp:1});f.root.scrollLeft+=2048;const before=rgbAt(initial,f.root.scrollLeft+width/2);f.root.listeners.scroll();f.flush();const after=rgbAt(tape.style.backgroundImage,f.root.scrollLeft+width/2);assert.ok(before.every((v,i)=>Math.abs(v-after[i])<.01));assert.equal(tape.style.backgroundPosition,(4096+width/2)+'px 5px,0 0');f.root.listeners.touchend({timeStamp:500});const settled=rgbAt(tape.style.backgroundImage,4096+width/2);assert.ok(after.every((v,i)=>Math.abs(v-settled[i])<.01));}
});
test('慣性中の境界rebaseは速度を引き継ぎ、触り直すと代行慣性を即座に止める',()=>{
 const f=setup();f.state.mode='time';f.controller.sync(f.state.at,'time');f.root.listeners.touchstart({timeStamp:1});f.root.listeners.touchmove({timeStamp:10});f.root.scrollLeft+=2000;f.root.listeners.scroll();f.flush();f.root.listeners.touchend({timeStamp:20});f.flush();f.root.scrollLeft+=80;f.root.listeners.scroll();f.flush();const at=f.state.at;assert.equal(f.root.scrollLeft,4096);f.flush();assert.ok(f.root.scrollLeft>4096);f.root.listeners.scroll();f.flush();assert.ok(f.state.at>at);f.root.listeners.touchstart({timeStamp:100});f.flush();const left=f.root.scrollLeft;for(let i=0;i<10;i++)f.flush();assert.equal(f.root.scrollLeft,left);f.root.listeners.touchcancel({timeStamp:500});for(let i=0;i<12;i++)f.flush();f.settle();assert.equal(f.root.scrollLeft,4096);
});
test('時刻モードは動かしている間を連続の時刻で描き、止めたら近い1分へ滑らかに寄せる',()=>{
 const f=setup();f.state.mode='time';f.controller.sync(f.state.at,'time');const at=f.state.at;let settled=null;
 f.root.listeners.touchstart({timeStamp:1});for(let i=1;i<=6;i++){f.root.scrollLeft+=1;f.root.listeners.scroll();f.flush();assert.equal(f.state.at,at+i*15000);}
 f.root.listeners.touchmove({timeStamp:2});f.root.listeners.touchend({timeStamp:500});const steps=[];for(let i=0;i<12;i++){f.flush();steps.push(f.state.at);}
 assert.equal(f.state.at,at+2*60000);assert.equal(f.root.scrollLeft,4096);assert.ok(steps.every((v,i)=>i===0||v>=steps[i-1]));assert.ok(new Set(steps).size>3,'寄せる間も途中の時刻を渡す');
 f.root.listeners.touchstart({timeStamp:600});f.root.scrollLeft+=5;f.root.listeners.scroll();f.flush();f.root.listeners.touchend({timeStamp:900});f.flush();f.root.listeners.touchstart({timeStamp:901});assert.equal(f.state.at,at+3*60000,'寄せている途中で触ると寄せ先で止めてから続ける');assert.equal(f.root.scrollLeft,4096);
});
test('日付モードは従来どおり1日単位で、同じ時刻を保つ',()=>{
 const f=setup(),at=f.state.at;f.root.listeners.touchstart({timeStamp:1});f.root.scrollLeft+=10;f.root.listeners.scroll();f.flush();assert.equal(f.state.at,at);f.root.scrollLeft+=4;f.root.listeners.scroll();f.flush();assert.equal(f.state.at,at+DAY);
});
test('日付モードは目盛りの間を前後の日の同じ時刻の割合で渡し、離すと正確な日へ寄せて割合を消す',()=>{
 const blends=[];const f=setup(240,{onBlend:b=>blends.push(b)}),at=f.state.at;
 f.root.listeners.touchstart({timeStamp:1});f.root.scrollLeft+=6;f.root.listeners.scroll();f.flush();
 assert.deepEqual({...blends.at(-1)},{from:at,to:at+DAY,f:.25});assert.equal(f.state.at,at,'時刻は正確な日のまま');
 f.root.scrollLeft+=12;f.root.listeners.scroll();f.flush();assert.deepEqual({...blends.at(-1)},{from:at,to:at+DAY,f:.75});assert.equal(f.state.at,at+DAY,'近い日へ切り替える');
 f.root.scrollLeft-=24;f.root.listeners.scroll();f.flush();assert.deepEqual({...blends.at(-1)},{from:at-DAY,to:at,f:.75});
 f.root.listeners.touchmove({timeStamp:2});f.root.listeners.touchend({timeStamp:500});const mid=[];for(let i=0;i<12;i++){f.flush();mid.push(blends.at(-1)?.f??null);}
 assert.equal(blends.at(-1),null);assert.equal(f.state.at,at);assert.equal(f.root.scrollLeft,4096);assert.ok(mid.some(v=>v!==null&&v>.75),'寄せる間も割合が連続で変わる');
 assert.ok(blends.every(b=>b===null||(b.to-b.from===DAY&&(b.from-at)%DAY===0)),'結ぶのは同じ時刻の前後の日だけ');
});
test('外部の日時変更や停止で補間を残さない',()=>{
 const blends=[];const f=setup(240,{onBlend:b=>blends.push(b)}),at=f.state.at;f.root.listeners.touchstart({timeStamp:1});f.root.scrollLeft+=6;f.root.listeners.scroll();f.flush();assert.ok(blends.at(-1));
 f.state.at=at+30*DAY;f.controller.sync(f.state.at,'date');assert.equal(blends.at(-1),null);
});
