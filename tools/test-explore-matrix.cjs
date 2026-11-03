// 探す: 条件の組み合わせ × 操作の総当たり。どの組み合わせでも画面が崩れない、勝手に別の画面へ移らない、古い値が残らないことを確かめる。
//   EXPLORE_MATRIX_BASE=http://127.0.0.1:8979/ node tools/test-explore-matrix.cjs [chrome|webkit]
const {chromium,webkit}=require('playwright');
const base=process.env.EXPLORE_MATRIX_BASE||'http://127.0.0.1:8897/',engine=process.argv[2]||'chrome',W=Number(process.env.EXPLORE_MATRIX_WIDTH||390),H=W<340?568:844;
const tools=['records','tower','diamond','pearl','skymap','framing','multiscene'];
const headers={'access-control-allow-origin':'*','access-control-allow-headers':'*','access-control-allow-methods':'*'};
const ready=()=>{try{return typeof PAGE_DIALOGS==='object';}catch{return false;}};
const OBSERVER={name:'菅生ケ丘',latitude:35.5895,longitude:139.561,groundManualM:63,standAglM:1.5};
const observers=['none','set'],targets=['none','skytree','fuji','custom'],views=['scene','page','workspace','sceneFull'],SHARD=(process.env.EXPLORE_MATRIX_SHARD||'0/1').split('/').map(Number);
// 見えていない釦、別の部品の下にある釦は押せないので飛ばす
const click=id=>async p=>{const e=p.locator(id).first();if(!await e.isVisible())return 'skip';const front=await e.evaluate(n=>{n.scrollIntoView({block:'center'});const r=n.getBoundingClientRect(),hit=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!hit&&(hit===n||n.contains(hit)||hit.contains(n));});if(!front)return 'skip';await e.click({timeout:1500});};
const hiddenAndBack=async p=>{for(const v of [true,false]){await p.evaluate(v=>{Object.defineProperty(document,'hidden',{get:()=>v,configurable:true});document.dispatchEvent(new Event('visibilitychange'));},v);await p.waitForTimeout(v?60:350);}};
// keep: 画面（ページ内/全画面/見え方）を変えない操作
const ops=[
 ['地点を空にする',{keep:1},p=>p.evaluate(()=>PLACE_PICKERS.skymap.reset())],
 ['地点を入れる',{keep:1,slow:1},p=>p.evaluate(o=>SkyMapUI.setObserver(o),OBSERVER)],
 ['対象を空にする',{keep:1},p=>p.evaluate(()=>{const s=document.getElementById('skyMapTarget');s.value='';s.dispatchEvent(new Event('change',{bubbles:true}));})],
 ['対象を替える',{keep:1},p=>p.evaluate(()=>SkyMapUI.setTarget('tokyotower'))],
 ['別アプリから戻る',{keep:1,still:1},hiddenAndBack],
 ['前の日',{keep:1,still:1},click('#skyMapDatePrev,[data-datetime-slot=previous]')],
 ['次の日',{keep:1,still:1},click('#skyMapDateNext,[data-datetime-slot=next]')],
 ['現在時刻',{keep:1,still:1},click('.tool-datetime-now')],
 ['太陽の枠',{keep:1,still:1},click('#wsSun')],
 ['月の枠',{keep:1,still:1},click('#wsMoon')],
 ['拡大',{keep:1},click('#skyMapIn')],
 ['縮小',{keep:1},click('#skyMapOut')],
 ['三脚',{keep:1},click('#skyMapObserverTool')],
 ['ピン',{keep:1},click('#skyMapTargetTool')],
 ['元に戻す',{keep:1},click('#mapWsUndo')],
 ['天体メニュー',{keep:1},click('#mapWsBodies')],
 ['共有メニュー',{keep:1},click('#mapWsShare')],
 ['題名を押す',{keep:1},click('#mapWsTitle')],
 ['見え方へ',{},click('#exploreSceneTab')],
 ['地図へ',{},click('#exploreMapTab')],
 ['全画面の見え方',{},click('#mapWsScene')],
 ['全画面の地図',{},click('#mapWsMap')],
 ['拡大ボタン',{},click('#skyMapExpand')],
 ['戻るボタン',{},click('#mapWsBack')],
 ['端末の戻る',{back:1},async p=>{await p.goBack({timeout:2000}).catch(()=>{});}],
];
const inspect=()=>{
 const view=document.getElementById('skyMapView'),wrap=view?.querySelector('.sky-map-wrap'),top=document.getElementById('mapWsTop'),host=SkyMapUI.workspaceHost?.(),s=SkyMapUI.selectionState?.(),vis=e=>!!e&&getComputedStyle(e).display!=='none'&&e.getClientRects().length>0,rect=e=>{const r=e?.getBoundingClientRect();return r?{top:r.top,bottom:r.bottom,left:r.left,right:r.right}:null;},center=host?.map?.center?.();
 const open=[...document.querySelectorAll('dialog[open]')].map(d=>d.id);
 return {ws:view?.classList.contains('map-ws'),full:view?.classList.contains('map-ws-scene'),panel:view?.classList.contains('map-ws-conditions'),mode:view?.dataset.exploreMode,hash:location.hash,topShown:vis(top),wide:wrap?.classList.contains('sky-map-wide'),wrapRect:rect(wrap),footerRect:rect(view?.querySelector('.sky-map-footer')),topRect:rect(top),overflow:document.documentElement.scrollWidth>innerWidth,hit:(()=>{if(!wrap||!vis(wrap))return null;const r=wrap.getBoundingClientRect();return document.elementFromPoint(r.left+r.width/2,r.top+r.height/2)?.id;})(),title:document.getElementById('mapWsTitle')?.innerText||'',cond:document.getElementById('exploreConditionTitle')?.innerText||'',sun:document.querySelector('#wsSun b')?.innerText||'',observer:s?.observer?.name||null,target:s?.target?.name||null,center:center?[center.latitude,center.longitude]:null,zoom:host?.map?.zoom?.()??null,open,timeline:vis(document.getElementById('skyMapTimeline')),infoShown:vis(document.getElementById('mapWsInfo')),railShown:vis(document.getElementById('skyMapObserverTool')),hasHost:!!host};
};
function problems(a,b,op,opt){
 const out=[],screen=x=>x.full?'見え方全画面':x.ws?'地図全画面':x.mode==='map'?'ページの地図':'ページの見え方';
 if(b.overflow)out.push('横にはみ出す');
 if(!b.hasHost&&b.hash.includes('explore'))out.push('画面の中身が消えた');
 if(b.ws){
  if(!b.topShown)out.push('全画面なのに上部バーがない');if(!b.wide)out.push('全画面なのに地図が大きくない');if(!b.infoShown)out.push('全画面なのに情報欄がない');if(!b.railShown)out.push('全画面なのに右の操作がない');if(!b.timeline)out.push('全画面なのに時間バーがない');
  if(b.wrapRect&&b.topRect&&Math.abs(b.wrapRect.top-b.topRect.bottom)>2)out.push('地図が上部バーに揃わない');
  if(b.wrapRect&&b.footerRect&&W<900&&Math.abs(b.wrapRect.bottom-b.footerRect.top)>2)out.push('地図が下部に揃わない');
  if(!b.panel&&!b.open.length&&b.hit&&!/skyMap|mapWs|map-|^$/.test(b.hit))out.push('地図の前に別の部品 '+b.hit);
  if(!/撮影地点|菅生|地図で置いた|\d+m/.test(b.title.split('\n')[0]||''))out.push('題名に地点がない:'+b.title);
  if(b.observer&&!/撮影地点を選ぶ/.test(b.title)&&b.observer!=='地図で置いた地点'&&!b.title.includes(b.observer))out.push('題名の地点が古い:'+b.title+' / '+b.observer);
  if(!b.observer&&!/撮影地点を選ぶ/.test(b.title))out.push('地点なしの題名が古い:'+b.title);
  if(b.target&&!b.title.includes(b.target))out.push('題名の対象が古い:'+b.title+' / '+b.target);
  if(!b.target&&!b.title.includes('対象なし'))out.push('対象なしの題名が古い:'+b.title);
  if(!b.observer&&!/—/.test(b.sun))out.push('地点なしの情報欄に古い値:'+b.sun);
  if(b.observer&&!/°/.test(b.sun))out.push('地点ありの情報欄が空:'+b.sun);
 }else if(!b.full){
  if(b.topShown)out.push('全画面でないのに上部バーが残る');
  if(b.mode==='map'&&b.wide&&!b.open.length)out.push('作業画面なしで地図だけ大きい');
 }
 if(opt.keep&&screen(a)!==screen(b))out.push(`操作で画面が変わった ${screen(a)}→${screen(b)}`);
 if(opt.still&&a.center&&b.center&&(a.ws||a.mode==='map')&&(Math.abs(a.center[0]-b.center[0])>1e-6||Math.abs(a.zoom-b.zoom)>1e-6))out.push(`地図が動いた zoom ${a.zoom}→${b.zoom}`);
 return out;
}
// Open-Meteo は自宅回線の1日の上限を使う。テストからは出さず、出ようとした回数だけ数える（2026-11-03）
let outside=0;
(async()=>{
 const b=await (engine==='webkit'?webkit:chromium).launch(engine==='webkit'?{headless:true}:{channel:'chrome',headless:true});
 const c=await b.newContext({viewport:{width:W,height:H},colorScheme:'dark'});
 await c.addInitScript(t=>sessionStorage.setItem('sorami.token',JSON.stringify({token:'synthetic-ws',loginId:'matrix',tools:t})),tools);
 await c.route(/open-meteo\.com/,r=>{outside++;return r.abort();});await c.route(/(?:zekkei-api|localhost:8787)/,r=>r.fulfill({status:200,headers,json:{allowed:true,tool:'skymap',loginId:'matrix',tools,credentials:[],hasPassword:true,recoveryCodes:10,favorites:[],sightings:[],rev:1}}));
 await c.route(/cyberjapandata|openstreetmap|gsi\.go\.jp/,r=>r.abort());
 const p=await c.newPage();let errors=[];p.on('pageerror',e=>errors.push(e.message));p.setDefaultTimeout(4000);
 await p.goto(base);await p.waitForFunction(ready);await p.evaluate(async()=>{await startupSessionReady;await AstroNotesAssets.ensureModels();groundAt=async()=>63;AstroNotesTerrain.groundElevation=async()=>40;navigationHistory.pushRoute('#/explore');});await p.locator('#exploreMapTab').waitFor({state:'attached'});await p.waitForTimeout(500);
 const setup=async st=>{
  // 全画面を閉じてから条件を入れる
  for(let i=0;i<3;i++){const s=await p.evaluate(inspect);if(!s.ws&&!s.full)break;await p.locator('#mapWsBack').click({timeout:1500}).catch(()=>{});await p.waitForTimeout(120);}
  await p.evaluate(({st,o})=>{for(const d of document.querySelectorAll('dialog[open]'))d.close();store.set('sorami.sceneExtras:matrix',st.extras);const menu=document.getElementById('mapWsMenu');if(menu)menu.hidden=true;const sel=document.getElementById('skyMapTarget');if(st.observer==='set')SkyMapUI.setObserver(o);else PLACE_PICKERS.skymap.reset();if(st.target==='none'){sel.value='';sel.dispatchEvent(new Event('change',{bubbles:true}));}else if(st.target!=='custom')SkyMapUI.setTarget(st.target);},{st,o:OBSERVER});
  // 地図で置いた対象は全画面のピンで置く（ページの地図では入力画面が開く）
  if(st.target==='custom'){await p.locator('#exploreMapTab').click({timeout:2000}).catch(()=>{});await p.waitForTimeout(100);await p.locator('#skyMapExpand').click({timeout:2000});await p.waitForTimeout(200);await p.evaluate(()=>SkyMapUI.workspaceHost().map.setCenter(35.7,139.8));await p.locator('#skyMapTargetTool').click({timeout:2000});await p.waitForTimeout(200);await p.locator('#mapWsBack').click({timeout:2000});await p.waitForTimeout(120);}
  await p.waitForTimeout(120);
  await p.locator(st.view==='scene'?'#exploreSceneTab':'#exploreMapTab').click({timeout:2000}).catch(()=>{});await p.waitForTimeout(120);
  if(st.view==='workspace'||st.view==='sceneFull'){await p.locator('#skyMapExpand').click({timeout:2000});await p.waitForTimeout(220);}
  if(st.view==='sceneFull'){await p.locator('#mapWsScene').click({timeout:2000});await p.waitForTimeout(220);}
  const open=await p.locator('#exploreConditions').evaluate(e=>e.open).catch(()=>false);
  if(st.view==='workspace'){if(st.panel&&!(await p.evaluate(inspect)).panel){await p.locator('#mapWsTitle').click({timeout:1500});await p.waitForTimeout(80);}}
  else if(st.view!=='sceneFull'&&open!==st.panel)await p.locator('#exploreConditions').evaluate((e,v)=>{e.open=v;},st.panel);
  await p.waitForTimeout(80);
 };
 const seen=new Map();let cases=0,skipped=0;const note=(msg,st,op)=>{const k=op+' | '+msg.replace(/[\d.]+/g,'N');if(!seen.has(k))seen.set(k,{n:0,sample:{...st,msg}});seen.get(k).n++;};
 const started=Date.now(),limit=Number(process.env.EXPLORE_MATRIX_MS||540000);
 // 条件欄は全画面の地図だけ開いた形も見る。一緒に選んだ対象は主の対象が富士山のときに足す
 const states=[];for(const observer of observers)for(const target of targets)for(const view of views){states.push({observer,target,extras:[],view,panel:false});if(view==='workspace')states.push({observer,target,extras:[],view,panel:true});if(target==='fuji')states.push({observer,target,extras:['tokyotower','shibuya-sky'],view,panel:false});}
 outer:for(const [index,st] of states.entries()){
  if(index%SHARD[1]!==SHARD[0])continue;const view=st.view;
  try{await setup(st);}catch(e){note('準備で失敗 '+e.message.split('\n')[0].slice(0,90),st,'準備');continue;}
  for(const [name,opt,run] of ops){
   if(Date.now()-started>limit){console.log('TIME LIMIT');break outer;}
   try{await setup(st);errors=[];const a=await p.evaluate(inspect);if(a.ws===false&&a.full===false&&(view==='workspace'||view==='sceneFull')){note('準備で全画面にならない',st,'準備');continue;}
    const r=await run(p);if(r==='skip'){skipped++;continue;}cases++;await p.waitForTimeout(opt.slow?700:opt.back?240:140);
    const after=await p.evaluate(inspect);for(const m of problems(a,after,name,opt))note(m,st,name);for(const e of errors)note('画面エラー '+e.slice(0,100),st,name);
    if(opt.back&&!(await p.evaluate(()=>location.hash)).includes('explore')){await p.evaluate(()=>navigationHistory.pushRoute('#/explore'));await p.waitForTimeout(250);}
   }catch(e){note('操作で失敗 '+e.message.split('\n')[0].slice(0,100),st,name);}
  }
 }
 console.log(`${engine} ${W} cases ${cases} skipped ${skipped} problems ${seen.size} ${Math.round((Date.now()-started)/1000)}s open-meteo-blocked ${outside}`);
 for(const [k,v] of [...seen].sort((x,y)=>y[1].n-x[1].n))console.log(`${v.n}回 ${k}  例:${JSON.stringify({o:v.sample.observer,t:v.sample.target,e:v.sample.extras.length,v:v.sample.view,p:v.sample.panel})} ${v.sample.msg.slice(0,120)}`);
 await b.close();process.exit(seen.size?1:0);
})().catch(e=>{console.error(e);process.exit(1);});
