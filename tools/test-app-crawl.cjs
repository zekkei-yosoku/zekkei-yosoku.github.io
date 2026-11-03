require('./no-open-meteo.cjs');  // テストのブラウザから Open-Meteo へ出さない
// アプリ全体の総当たり。全画面 × ログイン状態 × 幅と明暗で、見えている釦を1つずつ押し、壊れないことを確かめる。
// APIはすべて偽の応答に差し替える（本番のデータに触れない）。削除や退会などの釦は押さない。
//   APP_CRAWL_BASE=http://127.0.0.1:8979/ APP_CRAWL_SHARD=0/4 node tools/test-app-crawl.cjs [chrome|webkit]
const {chromium,webkit}=require('playwright'),fs=require('fs');
const base=process.env.APP_CRAWL_BASE||'http://127.0.0.1:8897/',engine=process.argv[2]||'chrome',SHARD=(process.env.APP_CRAWL_SHARD||'0/1').split('/').map(Number),limit=Number(process.env.APP_CRAWL_MS||540000),fixture=process.env.APP_CRAWL_FORECAST;
const ROUTES=['#/almanac','#/','#/forecast/results','#/sunset','#/explore','#/aim/tower','#/skymap','#/plane','#/iss','#/records','#/answers','#/admin','#/settings','#/bogus'];
const FULL=['diamond','pearl','tower','skymap','framing','plane','iss','records','multiscene'];
const USERS={guest:null,none:{tools:[],role:'user'},full:{tools:FULL,role:'user'},admin:{tools:FULL,role:'admin'}};
const LOOKS=[[390,844,'dark'],[390,844,'light'],[320,568,'dark'],[1280,800,'light']];
// 押すと元に戻せない、または外へ出ていく釦
const DANGER=/削除|退会|ログアウト|サインアウト|パスキー|パスワード|再発行|復旧コード|発行|消去|初期化|取り下げ|アカウントを|ログイン|新規登録|現在地|写真を選|ファイル|読み込む|書き出|ダウンロード|共有する/;
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
const ready=()=>{try{return typeof PAGE_DIALOGS==='object';}catch{return false;}};
const FAV={id:'crawl-1',name:'検査の地点',latitude:35.68,longitude:139.76,elevation:40,eyeHeightAGL:1.5,phenomena:['sunrise','sunset','moon']};
const describeAll=()=>{
 const scope=[...document.querySelectorAll('dialog[open]')].pop()||document.body,seen=[];
 for(const e of scope.querySelectorAll('button,summary,[role=tab],[role=switch],[role=menuitem],[role=checkbox],a[href^="#"],select,input[type=checkbox],input[type=radio]')){
  const r=e.getBoundingClientRect(),s=getComputedStyle(e);
  if(!r.width||!r.height||s.visibility==='hidden'||s.display==='none'||e.disabled||e.closest('[hidden]'))continue;
  seen.push(e);
 }
 globalThis.__crawlList=seen;
 return seen.map(e=>({label:(e.getAttribute('aria-label')||e.innerText||e.id||e.className||e.tagName).toString().replace(/\s+/g,' ').trim().slice(0,40),id:e.id||''}));
};
const health=()=>{
 const open=[...document.querySelectorAll('dialog[open]')].map(d=>d.id||'dialog'),main=document.querySelector('main'),shown=[...(main?.children||[])].filter(e=>e.getClientRects().length&&getComputedStyle(e).display!=='none'),text=(main?.innerText||'').trim().length;
 return {hash:location.hash,open,overflow:document.documentElement.scrollWidth>innerWidth+1,blank:!open.length&&(!shown.length||text===0),bodyLocked:getComputedStyle(document.body).overflow==='hidden'&&!open.length&&!document.querySelector('.map-ws,.sky-map-wide')};
};
const closeTop=()=>{const d=[...document.querySelectorAll('dialog[open]')].pop();if(!d)return 'none';const b=[...d.querySelectorAll('button')].find(e=>e.getClientRects().length&&/^(閉じる|戻る|キャンセル|完了|とじる|×|✕)/.test((e.getAttribute('aria-label')||e.innerText||'').trim())||e.classList.contains('page-back'));if(b){b.click();return 'button';}return 'nobutton';};
(async()=>{
 const visited=new Set(),started=Date.now(),seen=new Map();let clicks=0,skipped=0,timedOut=false;
 const note=(msg,where)=>{const k=msg.replace(/\d+(\.\d+)?/g,'N');if(!seen.has(k))seen.set(k,{n:0,where});seen.get(k).n++;};
 const b=await (engine==='webkit'?webkit:chromium).launch(engine==='webkit'?{headless:true}:{channel:'chrome',headless:true});
 const combos=[];for(const route of ROUTES)for(const user of Object.keys(USERS))combos.push({route,user});
 const forecast=fixture&&fs.existsSync(fixture)?JSON.parse(fs.readFileSync(fixture,'utf8')):null;
 outer:for(const [index,{route,user}] of combos.entries()){
  if(index%SHARD[1]!==SHARD[0])continue;
  const [w,h,scheme]=LOOKS[index%LOOKS.length],u=USERS[user];
  const c=await b.newContext({viewport:{width:w,height:h},colorScheme:scheme,permissions:[]});
  if(u)await c.addInitScript(({u})=>{sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-crawl',loginId:'crawl',role:u.role,tools:u.tools}));},{u});
  await c.addInitScript(()=>{window.open=()=>null;if(navigator.share)navigator.share=async()=>{};Object.defineProperty(navigator,'share',{value:async()=>{},configurable:true});HTMLAnchorElement.prototype.click=(f=>function(){if(this.download)return;return f.call(this);})(HTMLAnchorElement.prototype.click);});
  await c.route('**/*',async r=>{const url=new URL(r.request().url());if(url.origin===new URL(base).origin)return r.continue();
   if(/zekkei-api|localhost:8787/.test(url.href)){const P=url.pathname,method=r.request().method();if(P==='/prediction'&&forecast)return r.fulfill({status:200,headers,json:forecast});if(P.startsWith('/prediction'))return r.fulfill({status:503,headers,json:{error:'unavailable'}});if(!u&&method==='GET')return r.fulfill({status:401,headers,json:{error:'unauthorized'}});
    return r.fulfill({status:200,headers,json:{allowed:!!u&&u.tools.length>0,tool:'skymap',loginId:'crawl',role:u?.role||'user',tools:u?.tools||[],credentials:[],hasPassword:true,recoveryCodes:10,favorites:[{id:FAV.id,body:JSON.stringify(FAV),rev:1,updated_at:Date.parse('2026-10-01T12:00:00+09:00'),deleted:0}],sightings:[],records:[],rev:1,more:false,users:[],items:[],ok:true}});}
   return r.abort();});
  const p=await c.newPage();let errors=[];p.on('pageerror',e=>errors.push(e.message));p.on('console',m=>{if(m.type()==='error'&&!/Failed to load|ERR_|net::|503|401|CORS|Content Security|Refused|status of/.test(m.text()))errors.push('console: '+m.text().slice(0,120));});p.on('dialog',d=>d.dismiss().catch(()=>{}));p.setDefaultTimeout(2500);
  const where=`${route} ${user} ${w}${scheme==='dark'?'暗':'明'}`;
  const open=async()=>{await p.evaluate(r=>{try{closeTools();}catch{}for(const d of document.querySelectorAll('dialog[open]'))d.close();for(const m of document.querySelectorAll('.map-layer-menu:not([hidden]),#mapWsMenu:not([hidden])'))m.hidden=true;for(const s of document.querySelectorAll('.map-ws-conditions'))s.classList.remove('map-ws-conditions');const back=document.getElementById('mapWsBack');if(back&&back.getClientRects().length)back.click();if(location.hash!==r)location.hash=r;},route);await p.waitForTimeout(220);};
  try{
   await p.goto(base+'index.html'+route);await p.waitForFunction(ready,null,{timeout:15000});await p.waitForTimeout(700);
   let first=await p.evaluate(health);for(const e of errors)note('開くとエラー '+e.slice(0,120),where);errors=[];if(first.overflow)note('開くと横にはみ出す '+route,where);if(first.blank&&route!=='#/bogus')note('開くと画面が空 '+route+' '+user,where);
   const labels=await p.evaluate(describeAll);
   const shownView=await p.evaluate(()=>[...document.querySelectorAll('main>*')].filter(e=>e.getClientRects().length&&e.id).map(e=>e.id).slice(0,4).join(','));console.log(`COVER ${where} -> ${first.hash||'(なし)'} ${shownView} 釦${labels.length}`);
   if(process.env.APP_CRAWL_PROBE&&index===SHARD[0]){await p.evaluate(()=>{setTimeout(()=>{throw Error('検出の確認');},0);});await p.waitForTimeout(100);for(const e of errors)note('PROBE '+e.slice(0,60),where);errors=[];}
   for(let i=0;i<labels.length;i++){
    if(Date.now()-started>limit){timedOut=true;break;}
    if(DANGER.test(labels[i].label)){skipped++;continue;}
    await open();errors=[];const now=await p.evaluate(describeAll);const target=now[i];
    if(!target||target.label!==labels[i].label){if(process.env.APP_CRAWL_DEBUG)console.log('MOVED',labels[i].label,'->',target?.label);skipped++;continue;}
    const handle=await p.evaluateHandle(n=>globalThis.__crawlList[n],i);
    try{await handle.asElement().click({timeout:900});clicks++;}catch(e){if(process.env.APP_CRAWL_DEBUG)console.log('SKIP',labels[i].label,e.message.split('\n').slice(0,8).join(' / ').slice(0,420));skipped++;await handle.dispose();continue;}
    await p.waitForTimeout(240);
    const after=await p.evaluate(health),name=`[${labels[i].label}]`;
    for(const e of errors)note(`押すとエラー ${e.slice(0,110)}`,where+' '+name);
    if(after.overflow)note(`押すと横にはみ出す ${name}`,where);
    if(after.blank)note(`押すと画面が空 ${name} ${after.hash}`,where);
    if(after.open.length&&!visited.has(user+after.open.at(-1))&&!process.env.APP_CRAWL_SHALLOW){
     const dialogId=after.open.at(-1);visited.add(user+dialogId);const inner=await p.evaluate(describeAll);
     for(let j=0;j<inner.length;j++){
      if(Date.now()-started>limit){timedOut=true;break;}
      if(DANGER.test(inner[j].label)||/^(閉じる|戻る|キャンセル)/.test(inner[j].label)){skipped++;continue;}
      await open();errors=[];const again=await p.evaluate(describeAll);if(again[i]?.label!==labels[i].label){skipped++;continue;}
      const h1=await p.evaluateHandle(n=>globalThis.__crawlList[n],i);try{await h1.asElement().click({timeout:900});}catch{skipped++;await h1.dispose();continue;}await h1.dispose();await p.waitForTimeout(200);
      const inside=await p.evaluate(describeAll);if(inside[j]?.label!==inner[j].label){skipped++;continue;}
      const h2=await p.evaluateHandle(n=>globalThis.__crawlList[n],j);try{await h2.asElement().click({timeout:900});clicks++;}catch{skipped++;await h2.dispose();continue;}await h2.dispose();await p.waitForTimeout(220);
      const after2=await p.evaluate(health),name2=`[${labels[i].label}>${inner[j].label}]`;
      for(const e of errors)note(`押すとエラー ${e.slice(0,110)}`,where+' '+name2);if(after2.overflow)note(`押すと横にはみ出す ${name2}`,where);if(after2.blank)note(`押すと画面が空 ${name2} ${after2.hash}`,where);
     }
     await open();errors=[];
    }else if(after.open.length){const how=await p.evaluate(closeTop);await p.waitForTimeout(160);const still=await p.evaluate(()=>[...document.querySelectorAll('dialog[open]')].length);if(how==='nobutton')note(`開いた画面に閉じる釦がない ${after.open.at(-1)} ${name}`,where);else if(how==='button'&&still>=after.open.length)note(`閉じる釦で閉じない ${after.open.at(-1)} ${name}`,where);for(const e of errors)note(`閉じるとエラー ${e.slice(0,110)}`,where+' '+name);}
    await handle.dispose();
   }
  }catch(e){note('操作で失敗 '+e.message.split('\n')[0].slice(0,110),where);}
  await c.close();
  if(timedOut)break outer;
 }
 await b.close();
 console.log(`${engine} shard ${SHARD.join('/')} clicks ${clicks} skipped ${skipped} problems ${seen.size} ${Math.round((Date.now()-started)/1000)}s${timedOut?' TIME LIMIT':''}`);
 for(const [k,v] of [...seen].sort((x,y)=>y[1].n-x[1].n))console.log(`${v.n}回 ${k}  例:${v.where.slice(0,90)}`);
 process.exit(seen.size?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
