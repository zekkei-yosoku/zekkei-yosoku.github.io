// ホームの NOTES 見出し・空をたどる・天球図（2026-10-20 ユーザー「出オチじゃダメ。空を辿るとか出入りの方向とか時間とかもっとカッコよく」）
import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';import{createRequire}from'node:module';
process.env.TZ='Asia/Tokyo';const require=createRequire(import.meta.url),T=require('./sorami-home-time.js'),A=require('./sorami-astro.js');
function render(body,at){
 class Element{children=[];attrs={};dataset={};hidden=false;isConnected=true;constructor(tag){this.tag=tag;}append(...n){this.children.push(...n);}prepend(...n){this.children.unshift(...n);}replaceChildren(...n){this.children=n;}setAttribute(k,v){this.attrs[k]=String(v);}focus(){}contains(){return true;}querySelector(){return null;}}
 const all=e=>[e,...e.children.flatMap(all)],root=new Element('div'),now=Date.parse(at),store=new Map([['sorami.homeAutoBody','false']]);
 const context={Date:class extends Date{constructor(...a){super(...(a.length?a:[now]));}static now(){return now;}},SoramiHomeTime:T,SoramiMoonPortrait:{draw:async()=>({texture:true})},document:{hidden:false,addEventListener(){},createElement:t=>new Element(t),createElementNS:(_,t)=>new Element(t)},localStorage:{getItem:k=>store.get(k)??null,setItem(k,v){store.set(k,v);}},setInterval:()=>1,clearInterval(){},Promise};
 vm.createContext(context);vm.runInContext(fs.readFileSync(new URL('./sorami-almanac-dashboard.js',import.meta.url),'utf8'),context);
 const D=context.SoramiAlmanacDashboard,p={latitude:35.68,longitude:139.76},day=T.start(now);
 const events=b=>b==='sun'?[{kind:'rise',at:Date.parse('2026-10-20T05:51:00+09:00'),azimuth:102},{kind:'set',at:Date.parse('2026-10-20T17:00:00+09:00'),azimuth:257.8}]:[];
 D.setAuto(false);D.render(root,day,p,events,A,{});if(root.dataset.body!==body){all(root).find(e=>e.dataset.body===body).onclick();}
 return{root,all:()=>all(root),texts:()=>all(root).map(e=>e.textContent).filter(Boolean)};
}
test('NOTES の見出しと各欄の英字ラベルが太陽・月の両方に出る',()=>{
 for(const[body,kicker]of [['sun','SOLAR NOTES'],['moon','LUNAR NOTES']]){const r=render(body,'2026-10-20T12:00:00+09:00'),t=r.texts();
  const k=r.all().find(e=>e.className==='alm-eyebrow');assert.equal(k.textContent,kicker);assert.equal(k.hidden,false);
  for(const en of ['SKY PATH','NEXT 7 DAYS'])assert.ok(r.all().some(e=>e.className==='alm-panel-kicker'&&e.textContent===en),en);
  for(const ja of ['空をたどる','これから7日間'])assert.ok(t.includes(ja),ja);
  // 2026-10-20 高さと方向は「空をたどる」1つのまとまり（出入りの方向の欄は無い）
  assert.ok(!r.all().some(e=>e.className==='alm-panel-kicker'&&e.textContent==='HORIZON'),'HORIZON の欄は無い');}
});
test('出入りは矢印と16方位（上の欄だけ）。グラフ・天球図・光の時間に同じ時刻と方位を重ねて書かない。最も高い時刻を示す',()=>{
 const r=render('sun','2026-10-20T12:00:00+09:00'),t=r.texts();
 assert.ok(t.includes('↑ 日の出')&&t.includes('↓ 日の入り'));assert.ok(t.includes('東南東 102.0°')&&t.includes('西南西 257.8°'));
 // 2026-10-20 ユーザー「この観点でしっかり見直して」：同じ時刻・方位が上の欄・グラフ・天球図・光の時間の4か所に出ていた
 const svgTimes=r.all().filter(e=>e.tag==='text'&&/05:51|17:00|102\.0°|257\.8°/.test(e.textContent||''));assert.equal(svgTimes.length,0,'グラフ・天球図に出入りの時刻と方位を書かない '+JSON.stringify(svgTimes.map(e=>e.textContent)));
 assert.ok(!r.all().some(e=>e.className==='alm-tw-time'),'光の時間の帯に時刻を書かない');
 assert.equal(t.filter(s=>s==='東南東 102.0°').length,1,'方位は上の欄の1か所だけ');
 assert.ok(t.some(s=>/^最も高い 11:\d\d  4\d\.\d°$/.test(s)),'南中のころの高さ');
});
test('天球図の今の位置は地平線より上だけ点を出し、下では隠す',()=>{
 const dome=t=>{const r=render('sun',t),svg=r.all().find(e=>e.attrs?.class==='alm-compass');const dots=svg.children.filter(e=>e.tag==='circle'&&e.attrs.r==='5'&&e.attrs.fill==='var(--alm-active)');return dots.at(-1).attrs;};
 const noon=dome('2026-10-20T12:00:00+09:00'),night=dome('2026-10-20T02:00:00+09:00');
 assert.equal(noon.opacity,'1');assert.equal(night.opacity,'0');
 // 正午の太陽は南（下側）・天頂寄り
 assert.ok(Number(noon.cy)>150&&Number(noon.cy)<150+112*0.6);
});
test('16方位の境目',()=>{
 const s=fs.readFileSync(new URL('./sorami-almanac-dashboard.js',import.meta.url),'utf8'),c={};vm.createContext(c);vm.runInContext(s.match(/const DIR16=[^\n]+/)[0].replace('const DIR16','globalThis.DIR16').replace(',dir16=',';globalThis.dir16='),c);
 assert.deepEqual([0,11.2,11.3,90,102,180,257.8,348.7,348.8,359.9,-10].map(c.dir16),['北','北','北北東','東','東南東','南','西南西','北北西','北','北','北']);
});
test('ホームに道具へのボタン（予測・構図・地図・記録）は置かない（2026-10-20 ユーザー「リンクを置くだけならいらない」）',()=>{
 for(const body of ['sun','moon']){const r=render(body,'2026-10-20T12:00:00+09:00');assert.ok(!r.all().some(e=>e.className==='alm-actions'),body);}
 assert.doesNotMatch(fs.readFileSync(new URL('./index.html',import.meta.url),'utf8'),/\{label:"構図",available:screenAllowed\("framing"\)/);
});
test('不要な説明文（NOTEBOOK・撮影地点の冒頭、構図の未選択時）は出さない（2026-10-20 ユーザー「消しといて」）',()=>{
 const h=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8'),m=fs.readFileSync(new URL('./sorami-myplaces.js',import.meta.url),'utf8');
 assert.doesNotMatch(h,/天体・対象・日付を選び、この日の候補から撮影地点を選べます/);assert.doesNotMatch(m,/どこから何が見えたかを残し、構図や地図で次の撮影につなげます/);
});

test('空をたどる：時刻は下のバーで動かし、パネルにつまみと読み取りの文字を置かない。時刻・高度はグラフ、方位は天球図の中に書く',()=>{
 const r=render('sun','2026-10-20T12:00:00+09:00'),all=r.all();
 const metrics=all.filter(e=>e.className==='alm-metric');assert.equal(metrics.length,1,'太陽の上の欄は昼の長さだけ');
 assert.equal(all.find(e=>e.className==='alm-moment').textContent,'','上の欄に時刻を書かない');
 const sky=all.find(e=>e.className==='alm-panel'&&e.children.some(c=>c.textContent==='空をたどる'));
 const kids=sky.children.map(e=>e.className||e.tag);
 const i=k=>kids.findIndex(c=>String(c).includes(k));
 // 2026-10-20 ユーザー「説明もなんか浮いてる」「せっかく下に日付があるんだから時間に切り替えられるようにしたらいいじゃん」
 assert.ok(i('alm-sky')>=0&&i('alm-tw-legend')>i('alm-sky'),'グラフと天球図 → 光の時間の2行 '+JSON.stringify(kids));
 assert.ok(!all.some(e=>e.type==='range'||/alm-readout|alm-range/.test(e.className||'')),'パネルの中につまみと読み取りを置かない');
 const texts=all.filter(e=>e.tag==='text').map(e=>e.textContent);
 assert.ok(texts.includes('12:00'),'グラフの縦線の上に時刻 '+JSON.stringify(texts));assert.ok(texts.some(t=>/^\d+\.\d°$/.test(t)),'グラフの点の横に高度');assert.ok(texts.some(t=>/^南+.* \d+°$|^[東西南北]+ \d+°$/.test(t)),'天球図の点の横に方位');
 const m=render('moon','2026-10-20T12:00:00+09:00').all();assert.ok(!m.some(e=>e.className==='alm-tw-legend'),'月には光の時間の2行を出さない');
});
