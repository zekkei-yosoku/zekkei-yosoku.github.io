import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const context=vm.createContext({TextEncoder,TextDecoder,URL,URLSearchParams,btoa,atob,Date,Uint8Array});
vm.runInContext(fs.readFileSync(new URL('./astronotes-plan.js',import.meta.url),'utf8')+';globalThis.P=AstroNotesPlan;',context);
const P=context.P,plain=x=>JSON.parse(JSON.stringify(x));
const target={id:'skytree',name:'東京スカイツリー',latitude:35.710063,longitude:139.8107,groundM:2,parts:[{id:'tip',name:'先端',m:636},{id:'gallery',name:'天望回廊（第二展望台）',m:452},{id:'deck',name:'天望デッキ',m:352}]};
const sample=()=>({v:1,kind:'aim',body:'moon',t:structuredClone(target),o:['撮影地点',35.64,139.87,null,1.5,null],at:Date.parse('2026-10-30T20:15:00+09:00'),part:'__whole',limb:'center',air:'auto',l:{on:true,mode:'manual',focal:50,sensor:'full',portrait:false,grid:'none'},pan:[0,0]});
const roundtrip=p=>{assert(P.valid(p));const token=P.encodeLink(p);assert.deepEqual(plain(P.decode(token)),p);assert.deepEqual(plain(P.decode(P.encode(p))),p);return token;};
test('固定済みのv3リンクはカタログの将来更新でも送信当時の定義で復元',()=>{
 const fixtures=JSON.parse(fs.readFileSync(new URL('./test-fixtures/plan-links-v3.json',import.meta.url),'utf8'));
 assert.equal(fixtures.length,11);for(const f of fixtures)assert.deepEqual(plain(P.decode(f.token)),f.payload,f.payload.t.id);
});
test('共有ルートはpercent encodingを含め復元し、不正escape/plus/長すぎるtokenを拒否',()=>{
 const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8'),code=html.slice(html.indexOf('function routeFromHash()'),html.indexOf('/// 詳細へ進む。'));
 const token=P.encodeLink(sample());
 for(const hash of ['#p='+token,'#p='+token.replaceAll(',','%2C').replaceAll('/','%2F'),'#/aim?plan='+P.encode(sample())]){
  const location={hash,pathname:'/trial/',search:''},history={state:null,replaceState:(state,unused,url)=>location.hash=new URL(url,'https://example.org').hash},c=vm.createContext({location,history,S:{PHENOMENA:{}}});vm.runInContext(code,c);assert.equal(c.routeFromHash().aim,true);assert(location.hash.startsWith('#/aim?plan='));assert.deepEqual(plain(P.decode(new URLSearchParams(location.hash.split('?')[1]).get('plan'))),sample());
 }
 for(const hash of ['#p=%ZZ','#p=3/moon/sky+tree/35,139/1793358900000','#p='+'a'.repeat(8001)]){const c=vm.createContext({location:{hash},history:{replaceState:()=>assert.fail('invalid token normalized')},S:{PHENOMENA:{}}});vm.runInContext(code,c);assert.equal(c.routeFromHash(),null);}
});
test('範囲外/片方だけ/文字列の部位座標は旧新codecとも拒否する',()=>{
 for(const coordinates of [{latitude:200,longitude:139},{latitude:35},{latitude:'35',longitude:139},{latitude:35,longitude:-181}]){
  const p=sample();Object.assign(p.t.parts[0],coordinates);assert.equal(P.valid(p),false);assert.throws(()=>P.encodeLink(p));assert.equal(P.decode(Buffer.from(JSON.stringify(p)).toString('base64url')),null);
 }
});
test('組込対象は天体/対象ID/撮影地点/絶対日時の短い自己完結URL',()=>{
 const p=sample(),token=roundtrip(p),url=P.link(p);assert(token.startsWith('3/moon/skytree/35.64,139.87/'));assert(url.length<110,url.length);assert(!token.includes('eyJ'));assert.equal(new URL(url).search,'');assert.equal(new URL(url).hash,'#p='+token);
 // The literal catalog remains independent of changes to global models or saved targets.
 context.AstroNotesAlign={targetById:()=>({...target,groundM:999})};assert.deepEqual(plain(P.decode(token)).t,target);
});
test('組込対象の日本語地点名・小数時刻・高さ変更・画角・部位座標を落とさない',()=>{
 const p=sample();p.o=['合成地点🌙',35.12345678912345,139.98765432112345,87.2,229,'coast'];p.at=1793358933842.3608;p.part='gallery';p.limb='behind';p.matchMode='limb';p.air='standard';p.pan=[-.000000123,.125];p.l={on:false,mode:'auto',focal:173.4,sensor:'canon',portrait:true,grid:'diagonal'};p.timelapse={interval:.5,count:300,fps:24};p.t.parts[0].m=637;p.t.parts[0].latitude=35.710000001;p.t.parts[0].longitude=139.810000001;roundtrip(p);
});
test('未登録の日本語独自対象は定義を内包し保存済対象なしでも復元',()=>{
 const p=sample();p.t={id:'利用者の塔',name:'桜の丘🌸 / 展望台',latitude:35.67890123456789,longitude:139.7890123456789,groundM:24.5,kind:'tower',widthM:40,parts:[{id:'上端',name:'屋根の上',m:70.5,latitude:35.6789,longitude:139.7891}]};p.part='上端';roundtrip(p);
 const q=vm.createContext({TextEncoder,TextDecoder,URL,URLSearchParams,btoa,atob,Date,Uint8Array});vm.runInContext(fs.readFileSync(new URL('./astronotes-plan.js',import.meta.url),'utf8')+';globalThis.P=AstroNotesPlan;',q);assert.deepEqual(plain(q.P.decode(P.encodeLink(p))),p);
});
test('旧v2も復元し、未知の拡張はv1で保持する',()=>{
 const p=sample(),t=p.t,l=p.l,tuple=[2,p.o,p.at,[t.id,t.name,t.latitude,t.longitude,t.groundM,t.parts.map(x=>[x.id,x.name,x.m]),{}],p.body,p.part,p.limb,p.air,[l.on,l.mode,l.focal,l.sensor,l.portrait,l.grid],p.pan,{}];
 assert.deepEqual(plain(P.decode(Buffer.from(JSON.stringify(tuple)).toString('base64url'))),p);
 for(const q of [{...p,future:{keep:'日本語'}},{...p,t:{...p.t,future:[1,2]}},{...p,l:{...p.l,future:true}}]){const token=roundtrip(q);assert(!token.startsWith('3/'));}
});
test('不正な版/対象ID/座標/時刻/余剰区間/異常deltaを拒否する',()=>{
 const pack=d=>Buffer.from(JSON.stringify(d)).toString('base64url');
 for(const token of ['3/moon/missing/35,139/1793358900000','3/moon/__proto__/35,139/1793358900000','3/moon/skytree/91,139/1793358900000','3/moon/skytree/35,Infinity/1793358900000','3/moon/skytree/35,139/not-a-time','3/moon/skytree/35,139/1793358900000/x/y',`3/moon/skytree/35,139/1793358900000/${pack({})}`,`3/moon/skytree/35,139/1793358900000/${pack([{},null])}`,`3/moon/skytree/35,139/1793358900000/${pack([null,null,null,null,null,null,null,null,{id:'other'}])}`,`3/moon/_/35,139/1793358900000`,P.encodeLink(sample())+' '.repeat(8000)])assert.equal(P.decode(token),null,token.slice(0,100));
});
test('各レンズ/方位/天体/任意設定の組合せを損失なく往復',()=>{
 for(let i=0;i<180;i++){
  const p=sample();p.body=['sun','moon','sirius','venus'][i%4];p.part=['__whole','tip','gallery'][i%3];p.limb=['center','onTop','behind'][i%3];p.air=['auto','standard','none'][i%3];p.o[0]=i%2?'地点🌸':'撮影地点';p.o[3]=i%5?null:19.6;p.o[4]=i%4?1.5:229;p.at+=i*.123456789;p.l.sensor=['full','aps','canon','m43'][i%4];p.l.mode=i%2?'auto':'manual';p.l.on=!!(i%2);p.l.focal=50+i*.1;p.l.portrait=!!(i%2);p.l.grid=['none','thirds','diagonal'][i%3];p.pan=i%2?[0,0]:[.12,-.4];if(i%3)p.matchMode=i%2?'overlap':'limb';if(i%7===0)p.t.parts[0].m+=.3;roundtrip(p);
 }
});
