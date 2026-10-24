import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const ctx=vm.createContext({TextEncoder,TextDecoder,URL,URLSearchParams,btoa,atob,Date,Uint8Array});
vm.runInContext(fs.readFileSync(new URL('./astronotes-plan.js',import.meta.url),'utf8')+';globalThis.P=AstroNotesPlan;',ctx);const P=ctx.P;
const payload={v:1,kind:'detail',id:'sunset',at:Date.parse('2026-10-31T23:59:00+09:00'),day:Date.parse('2026-10-31T00:00:00+09:00'),o:['日本語の山頂🌄',35.6,139.7,600,1.5,'summit']};
const snapshot={title:'月, 富士; \\ 撮影',observer:{name:'場所\nBEGIN:VEVENT',latitude:35.6,longitude:139.7},rows:[['条件','a,b;c\\d\n次の行']],note:'予測',mapUrl:'https://example.org/map',url:'https://example.org/#/aim'};
const edits={title:'月, 富士; \\ 撮影',start:'2026-10-31T23:59',end:'2026-11-01T01:00',reminder:30};
test('日本語・絵文字・地形・絶対日時の共有URL往復',()=>assert.equal(JSON.stringify(P.decode(P.encode(payload))),JSON.stringify(payload)));
test('共有schemaの境界を拒否する',()=>{for(const change of [{v:2},{at:NaN},{o:['地点',91,139,0,1.5,null]},{o:['地点',35,139,0,-1,null]},{o:['地点\nX',35,139,0,1.5,null]}])assert.equal(P.valid({...payload,...change}),false);for(const x of ['x','<script>','A'.repeat(8001),'eyJ2IjoyfQ'])assert.equal(P.decode(x),null);});
test('UTCの予定時刻が日本時間の月跨ぎと一致する',()=>{const e=P.event(snapshot,edits),s=P.ics(e,Date.parse('2026-10-07T00:00Z'));assert.ok(s.includes('DTSTART:20261031T145900Z\r\n'));assert.ok(s.includes('DTEND:20261031T160000Z\r\n'));assert.ok(s.includes('DTSTAMP:20261007T000000Z'));assert.ok(s.includes('TRIGGER:-PT30M'));});
test('改行・区切り・バックスラッシュをICS injectionから守る',()=>{const s=P.ics(P.event(snapshot,edits));const unfolded=s.replace(/\r\n /g,'');assert.equal((unfolded.match(/BEGIN:VEVENT/g)||[]).length,2);assert.equal((unfolded.match(/^BEGIN:VEVENT$/gm)||[]).length,1);assert.ok(unfolded.includes('SUMMARY:月\\, 富士\\; \\\\ 撮影'));assert.ok(unfolded.includes('場所\\nBEGIN:VEVENT'));});
test('UTF8の75octet foldingは文字を壊さず復元できる',()=>{const line='DESCRIPTION:'+'日本語🌅'.repeat(80);const folded=P.fold(line);for(const s of folded.split('\r\n'))assert.ok(Buffer.byteLength(s)<=75);assert.equal(folded.replace(/\r\n /g,''),line);});
test('終了<=開始・空件名・無効日時を拒否する',()=>{for(const x of [{end:edits.start},{title:' '},{start:'2026-99-01T23:00'}])assert.throws(()=>P.event(snapshot,{...edits,...x}));});
test('通知なしはVALARMを作らず、同一予定UIDは安定',()=>{const e=P.event(snapshot,{...edits,reminder:0}),a=P.ics(e,0),b=P.ics(e,1000);assert.ok(!a.includes('VALARM'));assert.equal(a.match(/UID:.*\r/)[0],b.match(/UID:.*\r/)[0]);});
test('Googleの予定リンクは件名とUTCの日時を同じ値で保持',()=>{const e=P.event(snapshot,edits),u=new URL(P.google(e));assert.equal(u.hostname,'calendar.google.com');assert.equal(u.searchParams.get('text'),e.title);assert.equal(u.searchParams.get('dates'),'20261031T145900Z/20261031T160000Z');assert.equal(u.searchParams.get('details'),e.description);});
test('天体共有の全条件を往復し危険な入力を拒否',()=>{const p={v:1,kind:'aim',at:payload.at,o:payload.o,body:'moon',part:'tip',limb:'onTop',t:{id:'custom',name:'自分の目標',latitude:35,longitude:139,groundM:10,parts:[{id:'tip',name:'先端',m:636}]},l:{on:true,mode:'manual',focal:400,sensor:'aps',portrait:true,grid:'thirds'},pan:[.1,.2],air:'none'};assert.equal(JSON.stringify(P.decode(P.encode(p))),JSON.stringify(p));for(const matchMode of ['overlap','limb'])assert.equal(P.decode(P.encode({...p,matchMode})).matchMode,matchMode);assert.equal(P.valid({...p,matchMode:'bad'}),false);for(const x of [{pan:[Infinity,0]},{l:{...p.l,sensor:'evil'}},{t:{...p.t,parts:[{id:'bad',name:'bad',m:Infinity}]}},{air:'evil'}])assert.equal(P.valid({...p,...x}),false);});

test('秒単位の短い撮影機会を正しいUTCの予定へ変換',()=>{const e=P.event(snapshot,{...edits,start:'2026-10-31T23:59:57',end:'2026-11-01T00:00:04'}),s=P.ics(e);assert.ok(s.includes('DTSTART:20261031T145957Z'));assert.ok(s.includes('DTEND:20261031T150004Z'));assert.equal(e.end-e.start,7000);});

test('存在しない日付や24時を別の日時へ繰り上げず拒否する',()=>{
 for(const start of ['2026-02-29T12:00','2026-04-31T12:00','2026-10-31T24:00','2026-02-30T12:00:00'])
  assert.throws(()=>P.event(snapshot,{...edits,start,end:'2026-12-01T12:00'}));
 const e=P.event(snapshot,{...edits,start:'2028-02-29T12:00',end:'2028-02-29T12:01'});
 assert.equal(e.end-e.start,60000);
});

test('地図共有は現在の日時・天体・位置・高さ・重ね方を保持し、構図の状態に依存しない',()=>{
 const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8'),code=html.slice(html.indexOf('function planSnapshot(button)'),html.indexOf('let planRestoredFragment='));
 const at=Date.parse('2026-10-24T16:13:57+09:00'),state={body:'moon',at,observer:{name:'地図地点',latitude:35,longitude:139,groundManualM:30},ground:27.4,eyeM:5.5,target:{id:'tower',name:'目標',latitude:35.1,longitude:139.1,groundM:10,parts:[{id:'tip',name:'先端',m:330,latitude:35.1001,longitude:139.1001}]},partId:'tip',limb:'behind',matchMode:'limb'};
 let drawn=0;const run=new Function('SkyMapUI','$','AstroNotesPlan','AstroNotesBodies','aimAirSettings','document','aimM','AstroNotesAlign',code+';return planSnapshot;')({shareState:()=>state},()=>({width:600,height:400}),P,{state:()=>({azimuth:30,apparentAltitude:10}),definition:()=>({name:'月'})},{mode:'standard'},{createElement:()=>({getContext:()=>({drawImage:()=>drawn++})})},String,{limbById:()=>({name:'上の縁'})});
 const snap=run({dataset:{planSource:'skymap'}});assert.equal(drawn,1);assert.equal(snap.payload.at,at);assert.equal(snap.payload.o[3],30);assert.equal(snap.payload.o[4],5.5);assert.equal(snap.payload.t.parts[0].latitude,35.1001);assert.equal(snap.payload.body,'moon');assert.equal(snap.payload.limb,'behind');assert.equal(snap.payload.matchMode,'limb');assert.equal(P.decode(P.encode(snap.payload)).at,at);
});
test('タイムラプスは任意の互換拡張として予定/共有を往復し不正設定を拒否',()=>{
 const p={v:1,kind:'aim',at:payload.at,o:payload.o,body:'moon',part:'tip',limb:'center',t:{id:'custom',name:'目標',latitude:35,longitude:139,groundM:10,parts:[{id:'tip',name:'先端',m:636}]},l:{on:true,mode:'manual',focal:400,sensor:'aps',portrait:true,grid:'none'},pan:[.1,.2],air:'none'};
 assert(P.valid(p));const config={interval:5,count:360,fps:24};assert.equal(JSON.stringify(P.decode(P.encode({...p,timelapse:config})).timelapse),JSON.stringify(config));for(const x of [{...config,count:2.5},{...config,interval:0},{...config,fps:23},{...config,interval:3600}])assert.equal(P.valid({...p,timelapse:x}),false);
});
