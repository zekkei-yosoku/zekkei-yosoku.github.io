/* 撮影計画: ICS (RFC 5545), PNG, versioned fragment links. No upload. */
const AstroNotesPlan = (() => {
  const num = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const text = (s, max = 100) => typeof s === 'string' && s.length <= max && !/[\u0000-\u001f]/u.test(s);
  const point = p => Array.isArray(p) && p.length === 6 && text(p[0]) && num(p[1], -90, 90) && num(p[2], -180, 180)
    && (p[3] === null || num(p[3], -500, 9000)) && num(p[4], 0, 700) && (p[5] === null || ['summit','basinRim','basinFloor','plain','coast'].includes(p[5]));
  const valid = p => {
    if (!p || p.v !== 1 || !point(p.o) || !num(p.at, Date.UTC(2000,0), Date.UTC(2101,0))) return false;
    if (p.kind === 'detail') return text(p.id, 32) && num(p.day, Date.UTC(2000,0), Date.UTC(2101,0));
    if (p.kind !== 'aim' || !text(p.body, 32) || !text(p.part, 40) || !['onTop','center','behind'].includes(p.limb)) return false;
    if(p.matchMode!==undefined&&!['overlap','limb'].includes(p.matchMode))return false;
    if(p.timelapse!==undefined){const q=p.timelapse;if(!q||!num(q.interval,.1,3600)||!Number.isInteger(q.count)||!num(q.count,2,10000)||![24,25,30,60].includes(q.fps)||(q.count-1)*q.interval>129600)return false;}
    const t = p.t, l = p.l;
    return t && text(t.id, 80) && text(t.name) && num(t.latitude,-90,90) && num(t.longitude,-180,180)
      && num(t.groundM,-500,9000) && Array.isArray(t.parts) && t.parts.length > 0 && t.parts.length <= 16
      && t.parts.every(q => q && text(q.id,40) && text(q.name) && num(q.m,-500,10000)
        && (q.latitude===undefined&&q.longitude===undefined || num(q.latitude,-90,90)&&num(q.longitude,-180,180)))
      && [null,undefined,'mountain','tower'].includes(t.kind) && (t.widthM === undefined || num(t.widthM,0,100000))
      && l && ['auto','manual'].includes(l.mode) && ['full','aps','canon','m43'].includes(l.sensor)
      && num(l.focal,0.01,100000) && typeof l.on === 'boolean' && typeof l.portrait === 'boolean'
      && ['none','thirds','diagonal'].includes(l.grid) && Array.isArray(p.pan) && p.pan.length === 2
      && p.pan.every(x=>num(x,-100,100)) && ['auto','standard','none'].includes(p.air);
  };
  function encode(p) {
    if (!valid(p)) throw new Error('撮影条件を確認できませんでした。画面の計算が終わってから開き直してください。');
    const bytes = new TextEncoder().encode(JSON.stringify(p));
    return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  }
  function decode(s) {
    if (!s || s.length > 8000 || typeof s !== 'string') return null;
    if(s.startsWith('3/'))return decodeCompact(s);
    if(!/^[\w-]+$/.test(s))return null;
    try {
      let p = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))));
      if(Array.isArray(p)&&p.length===11&&p[0]===2){
        const [version,o,at,t,body,part,limb,air,l,pan,extra]=p;
        const fields=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).every(k=>keys.includes(k));
        if(!Array.isArray(t)||t.length!==7||!Array.isArray(l)||l.length!==6||!fields(extra,['matchMode','timelapse'])||!fields(t[6],['kind','widthM'])||!Array.isArray(t[5])||!t[5].every(q=>Array.isArray(q)&&(q.length===3||q.length===4&&fields(q[3],['latitude','longitude']))))return null;
        p={v:1,kind:'aim',o,at,t:{id:t[0],name:t[1],latitude:t[2],longitude:t[3],groundM:t[4],parts:t[5].map(q=>({id:q[0],name:q[1],m:q[2],...(q[3]||{})})),...t[6]},body,part,limb,air,l:{on:l[0],mode:l[1],focal:l[2],sensor:l[3],portrait:l[4],grid:l[5]},pan,...extra};
      }
      return valid(p) ? p : null;
    } catch { return null; }
  }
  const onlyLinkFields=(v,keys)=>v&&typeof v==='object'&&Object.keys(v).every(k=>keys.includes(k));
  const compactable=p=>valid(p)&&p.kind==='aim'&&onlyLinkFields(p,['v','kind','o','at','t','body','part','limb','air','l','pan','matchMode','timelapse'])&&onlyLinkFields(p.t,['id','name','latitude','longitude','groundM','parts','kind','widthM'])&&p.t.parts.every(q=>onlyLinkFields(q,['id','name','m','latitude','longitude']))&&onlyLinkFields(p.l,['on','mode','focal','sensor','portrait','grid']);
  function encodeTuple(p){
    // A lossless tuple removes repeated field names. Unknown future extensions keep the v1 codec.
    if(!compactable(p))return encode(p);
    const optional=(v,keys)=>Object.fromEntries(keys.filter(k=>v[k]!==undefined).map(k=>[k,v[k]])),t=p.t,l=p.l;
    const packed=[2,p.o,p.at,[t.id,t.name,t.latitude,t.longitude,t.groundM,t.parts.map(q=>[q.id,q.name,q.m,...(q.latitude!==undefined||q.longitude!==undefined?[optional(q,['latitude','longitude'])]:[])]),optional(t,['kind','widthM'])],p.body,p.part,p.limb,p.air,[l.on,l.mode,l.focal,l.sensor,l.portrait,l.grid],p.pan,optional(p,['matchMode','timelapse'])];
    const bytes=new TextEncoder().encode(JSON.stringify(packed));
    return btoa(Array.from(bytes,b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  }
  // Immutable v3 catalog: keep these definitions when adding a later codec version.
  const LINK_CATALOG_3 = {"fuji":{"id":"fuji","name":"富士山","latitude":35.360555,"longitude":138.727363,"groundM":3776,"parts":[{"id":"summit","name":"山頂","m":3776}]},"skytree":{"id":"skytree","name":"東京スカイツリー","latitude":35.710063,"longitude":139.8107,"groundM":2,"parts":[{"id":"tip","name":"先端","m":636},{"id":"gallery","name":"天望回廊（第二展望台）","m":452},{"id":"deck","name":"天望デッキ","m":352}]},"tokyotower":{"id":"tokyotower","name":"東京タワー","latitude":35.65859131567304,"longitude":139.74544420093412,"groundM":18,"parts":[{"id":"tip","name":"先端","m":351},{"id":"top","name":"トップデッキの上端","m":247.55},{"id":"main","name":"メインデッキの上端","m":148.389}]},"tocho-building":{"id":"tocho-building","name":"東京都庁 第一本庁舎","latitude":35.6895,"longitude":139.691694,"groundM":34.63,"parts":[{"id":"north","name":"北塔の頂部","m":277.68,"latitude":35.68978611899479,"longitude":139.69164621437966},{"id":"south","name":"南塔の頂部","m":277.68,"latitude":35.68921795263166,"longitude":139.6917781156376}]},"shibuya-sky":{"id":"shibuya-sky","name":"渋谷スカイ","latitude":35.65838377760082,"longitude":139.70226592899252,"groundM":14.61,"parts":[{"id":"tip","name":"屋上（SKY STAGE）","m":243.637,"latitude":35.65838377760082,"longitude":139.70226592899252}]},"azabudai-hills":{"id":"azabudai-hills","name":"麻布台ヒルズ 森JPタワー","latitude":35.6608543555483,"longitude":139.7406558121773,"groundM":18.74,"parts":[{"id":"tip","name":"頂部","m":349.558,"latitude":35.6608543555483,"longitude":139.7406558121773}]},"kabukicho-tower":{"id":"kabukicho-tower","name":"東急歌舞伎町タワー","latitude":35.69610448807164,"longitude":139.70068955167807,"groundM":29.999,"parts":[{"id":"tip","name":"頂部","m":249.772,"latitude":35.69610448807164,"longitude":139.70068955167807}]},"tower-terror":{"id":"tower-terror","name":"タワー・オブ・テラー","latitude":35.6240957,"longitude":139.8882684,"groundM":4.8,"parts":[{"id":"tip","name":"頂部","m":63.8}]},"cinderella":{"id":"cinderella","name":"シンデレラ城","latitude":35.632104,"longitude":139.880834,"groundM":3,"parts":[{"id":"tip","name":"てっぺん","m":54}]},"tinkerbell":{"id":"tinkerbell","name":"ティンカーベル","latitude":35.637031,"longitude":139.878077,"groundM":3,"parts":[{"id":"tip","name":"杖の先","m":56}]}};
  const freezeCatalog=v=>{for(const x of Object.values(v))if(x&&typeof x==='object')freezeCatalog(x);return Object.freeze(v);};
  freezeCatalog(LINK_CATALOG_3);
  // Version 3: body / target / observer coordinates / UTC milliseconds / optional deltas.
  // Catalog definitions are frozen in this codec, never taken from the recipient's saved targets.
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const LENS_DEFAULT=[true,'manual',50,'full',false,'none'];
  const OBS_DEFAULT=['撮影地点',null,1.5,null];
  const trimDefaults=(a,d)=>{a=a.map((x,i)=>same(x,d[i])?null:x);while(a.length&&a.at(-1)===null)a.pop();return a.length?a:null;};
  const packJson=v=>btoa(Array.from(new TextEncoder().encode(JSON.stringify(v)),b=>String.fromCharCode(b)).join('')).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  const unpackJson=s=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))));
  function encodeLink(p){
    const fallback=encodeTuple(p);
    // Unknown extensions remain lossless in v1 rather than being silently discarded.
    if(!compactable(p)||!/^[-\w]{1,32}$/.test(p.body))return fallback;
    const known=Object.hasOwn(LINK_CATALOG_3,p.t.id),base=known?LINK_CATALOG_3[p.t.id]:null;
    const target=base?Object.fromEntries(Object.entries(p.t).filter(([k,v])=>!same(v,base[k]))):p.t;
    const l=p.l,o=p.o;
    const delta=[trimDefaults([o[0],o[3],o[4],o[5]],OBS_DEFAULT),p.part==='__whole'?null:p.part,p.limb==='center'?null:p.limb,p.air==='auto'?null:p.air,
      trimDefaults([l.on,l.mode,l.focal,l.sensor,l.portrait,l.grid],LENS_DEFAULT),same(p.pan,[0,0])?null:p.pan,p.matchMode??null,p.timelapse??null,Object.keys(target).length?target:null];
    while(delta.length&&delta.at(-1)===null)delta.pop();
    const token=['3',p.body,known?p.t.id:'_',`${o[1]},${o[2]}`,String(p.at),...(delta.length?[packJson(delta)]:[])].join('/');
    return token.length<fallback.length?token:fallback;
  }
  function decodeCompact(s){
    try{
      const a=s.split('/');if(a.length<5||a.length>6||a[0]!=='3'||!/^[-\w]{1,32}$/.test(a[1]))return null;
      const numeric=x=>/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(x)?Number(x):NaN;
      const xy=a[3].split(',');if(xy.length!==2)return null;
      if(a[5]!==undefined&&!/^[\w-]+$/.test(a[5]))return null;
      const d=a[5]?unpackJson(a[5]):[];if(!Array.isArray(d)||d.length>9)return null;
      const arr=(v,n)=>v==null||Array.isArray(v)&&v.length<=n;
      if(!arr(d[0],4)||!arr(d[4],6))return null;
      const obj=v=>v&&typeof v==='object'&&!Array.isArray(v);
      if(d[8]!=null&&(!obj(d[8])||Object.keys(d[8]).some(k=>!['id','name','latitude','longitude','groundM','parts','kind','widthM'].includes(k))))return null;
      const base=Object.hasOwn(LINK_CATALOG_3,a[2])?LINK_CATALOG_3[a[2]]:null;
      if(!base&&a[2]!=='_')return null;
      const t=base?{...JSON.parse(JSON.stringify(base)),...(d[8]||{})}:d[8];
      if(base&&t.id!==a[2])return null;
      const o=OBS_DEFAULT.map((v,i)=>d[0]?.[i]??v),l=LENS_DEFAULT.map((v,i)=>d[4]?.[i]??v);
      const p={v:1,kind:'aim',body:a[1],t,o:[o[0],numeric(xy[0]),numeric(xy[1]),o[1],o[2],o[3]],at:numeric(a[4]),part:d[1]??'__whole',limb:d[2]??'center',air:d[3]??'auto',
        l:{on:l[0],mode:l[1],focal:l[2],sensor:l[3],portrait:l[4],grid:l[5]},pan:d[5]??[0,0],...(d[6]!=null?{matchMode:d[6]}:{}),...(d[7]!=null?{timelapse:d[7]}:{})};
      return valid(p)?p:null;
    }catch{return null;}
  }
  const compactPoint = (o,eye=1.5) => [String(o.name || '撮影地点').slice(0,100),o.latitude,o.longitude,Number.isFinite(o.elevation)?o.elevation:null,eye,o.terrain || null];
  const expandPoint = p => ({id:`shared:${p[1]},${p[2]}`,name:p[0],subtitle:'共有された撮影地点',latitude:p[1],longitude:p[2],elevation:p[3],eyeHeightAGL:p[4],terrain:p[5],locationScope:'point',decks:null});
  const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const escapeIcs = s => String(s).replaceAll('\\','\\\\').replace(/\r\n|\r|\n/g,'\\n').replaceAll(';','\\;').replaceAll(',','\\,');
  function fold(line) {
    let out='',row='',n=0;
    for (const ch of line) { const k=new TextEncoder().encode(ch).length; if(n+k>75){out+=row+'\r\n';row=' ';n=1;} row+=ch;n+=k; }
    return out+row;
  }
  // Locale and timezone are fixed; reuse the formatter across notebook rows.
  let dateTimeFormatter;
  const dateTime = ms => (dateTimeFormatter ||= new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'})).format(ms);
  const localInput = ms => new Date(ms+32400000).toISOString().slice(0,19);
  const inputMs = s => {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(s)) return NaN;
    const normalized = s + (s.length === 16 ? ':00' : ''), ms = Date.parse(normalized + '+09:00');
    return Number.isFinite(ms) && localInput(ms) === normalized ? ms : NaN;
  };
  function event(s, edits) {
    const start=inputMs(edits.start),end=inputMs(edits.end),title=edits.title.trim();
    if (!title || title.length>200 || !Number.isFinite(start) || !Number.isFinite(end) || end<=start) throw new Error('件名と日時を確認してください。終了は開始より後にしてください。');
    return {title,start,end,reminder:[0,15,30,60].includes(+edits.reminder)?+edits.reminder:0,
      location:`${s.observer.name} (${s.observer.latitude.toFixed(6)}, ${s.observer.longitude.toFixed(6)})`,
      description:[s.title,...s.rows.map(r=>r.join('：')),s.note,`地図：${s.mapUrl}`,`同じ条件：${s.url}`].filter(Boolean).join('\n')};
  }
  function ics(e,now=Date.now()) {
    // Stable identity for the same event; changing notification settings does not duplicate its UID.
    const key=[e.title,e.start,e.location].join('|');let hash=2166136261;
    for(const c of key)hash=Math.imul(hash^c.codePointAt(0),16777619)>>>0;
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//AstroNotes//Shooting Plan//JA','CALSCALE:GREGORIAN','BEGIN:VEVENT',
      `UID:${e.start}-${hash.toString(16)}@zekkei-yosoku.github.io`,`DTSTAMP:${stamp(now)}`,`DTSTART:${stamp(e.start)}`,`DTEND:${stamp(e.end)}`,
      `SUMMARY:${escapeIcs(e.title)}`,`LOCATION:${escapeIcs(e.location)}`,`DESCRIPTION:${escapeIcs(e.description)}`];
    if(e.reminder)lines.push('BEGIN:VALARM',`TRIGGER:-PT${e.reminder}M`,'ACTION:DISPLAY',`DESCRIPTION:${escapeIcs(e.title)}`,'END:VALARM');
    lines.push('END:VEVENT','END:VCALENDAR');return lines.map(fold).join('\r\n')+'\r\n';
  }
  function google(e) {
    const u=new URL('https://calendar.google.com/calendar/render');
    u.search=new URLSearchParams({action:'TEMPLATE',text:e.title,dates:`${stamp(e.start)}/${stamp(e.end)}`,details:e.description,location:e.location,ctz:'Asia/Tokyo'});
    return u.href;
  }
  function link(p) { return p.kind==='aim'?`https://zekkei-yosoku.github.io/#p=${encodeLink(p)}`:`https://zekkei-yosoku.github.io/#/${p.id}/${p.day}?plan=${encode(p)}`; }
  const mapLink = o => `https://www.google.com/maps/search/?api=1&query=${o.latitude},${o.longitude}`;
  function image(s) {
    const cv=document.createElement('canvas'),ctx=cv.getContext('2d'),W=1080,P=48,inner=W-2*P;
    const wrap=(str,width,font)=>{ctx.font=font;let row='',out=[];for(const ch of String(str)){if(ctx.measureText(row+ch).width>width&&row){out.push(row);row='';}row+=ch;}if(row)out.push(row);return out;};
    const title=wrap(s.title,inner,'700 42px sans-serif');
    const rows=[['撮影地点',s.observer.name],['観測日時',dateTime(s.at)]];
    if(Number.isFinite(s.fullFrameMm)&&s.fullFrameMm>0)rows.push(['フルサイズ換算',`${Math.round(s.fullFrameMm)}mm`]);
    const body=rows.map(([label,value])=>({label,lines:wrap(value,inner,'500 34px sans-serif')}));
    const scale=s.scene?Math.min(inner/s.scene.width,760/s.scene.height):0;
    const sceneW=s.scene?s.scene.width*scale:0,sceneH=s.scene?s.scene.height*scale:0;
    cv.width=W;cv.height=Math.ceil(P+title.length*56+24+(sceneH?sceneH+28:0)+body.reduce((n,r)=>n+30+r.lines.length*46+20,0)+28+P);
    ctx.fillStyle='#fff';ctx.fillRect(0,0,W,cv.height);ctx.textBaseline='top';let y=P;
    ctx.fillStyle='#1c1c1e';ctx.font='700 42px -apple-system, sans-serif';for(const t of title){ctx.fillText(t,P,y);y+=56;}y+=24;
    if(s.scene){ctx.drawImage(s.scene,(W-sceneW)/2,y,sceneW,sceneH);y+=sceneH+28;}
    for(const r of body){ctx.fillStyle='#6b6b71';ctx.font='400 24px -apple-system, sans-serif';ctx.fillText(r.label,P,y);y+=30;ctx.fillStyle='#1c1c1e';ctx.font='500 34px -apple-system, sans-serif';for(const t of r.lines){ctx.fillText(t,P,y);y+=46;}y+=20;}
    ctx.fillStyle='#8e8e93';ctx.font='400 22px -apple-system, sans-serif';ctx.fillText('AstroNotes',P,y+6);return cv;
  }
  function mount({snapshot,show,keep=null,canKeep=()=>true,openNotebook=null,quickSave=null}) {
    const d=document.createElement('dialog');d.id='planSheet';d.className='sheet';d.tabIndex=-1;d.setAttribute('aria-labelledby','planTitle');
    d.innerHTML=`<div class="sheet-head"><strong id="planTitle">共有</strong><button type="button" id="planClose" aria-label="閉じる"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><div class="sheet-body"><p id="planSummary"></p>
      <section id="planCalendar" aria-label="予定の登録"><label for="planEventTitle">予定の件名</label><input type="text" id="planEventTitle" maxlength="200">
      <label for="planStart">開始（日本時間）</label><input type="datetime-local" step="1" id="planStart"><label for="planEnd">終了（日本時間）</label><input type="datetime-local" step="1" id="planEnd">
      <div class="plan-actions"><button type="button" class="chip primary" id="planKeep" hidden>記録の予定に保存</button></div>
      <div id="planExport"><h3 class="my-title">カレンダーに追加</h3>
      <div class="plan-actions"><a id="planGoogle" class="chip" target="_blank" rel="noopener noreferrer">Googleカレンダーで登録</a><button type="button" class="chip" id="planIcs">予定ファイルを保存</button></div>
      <p class="tiny">予定ファイルはAppleカレンダー・Outlookなどで開けます。</p></div></section>
      <section id="planImage" aria-label="画像とリンクの共有" hidden><div class="plan-preview-frame" tabindex="0" aria-label="共有画像を確認"><img id="planPreview" alt="撮影計画の共有画像"></div><div class="plan-actions"><button type="button" class="chip primary" id="planShare" aria-label="画像を共有" disabled>共有</button><button type="button" class="chip" id="planSave" aria-label="画像を保存" disabled>保存</button><button type="button" class="chip" id="planCopy" disabled>リンクをコピー</button></div></section><p id="planStatus" class="tiny" role="status" aria-live="polite"></p><button type="button" id="planOpenNotebook" class="chip" hidden>予定を見る</button></div>`;
    document.body.append(d);const $=id=>document.getElementById(id);let current=null,file=null,url=null,seq=0,back=null,localSave=false,saved=null,requested='share';
    const retry=document.createElement('button');retry.id='planRetry';retry.type='button';retry.className='chip';retry.textContent='再試行';retry.hidden=true;retry.onclick=()=>open(requested,back,!!current);$('planStatus').after(retry);
    const waiting=document.createElement('div');waiting.id='planWaiting';waiting.className='note-wait';waiting.hidden=true;waiting.innerHTML='<span class="note-wait-character" aria-hidden="true"></span><span class="note-wait-message" id="planWaitingMessage" role="status" aria-live="polite"></span>';$('planStatus').before(waiting);
    const tabs=document.createElement('div');tabs.id='planSharingTabs';tabs.className='forecast-tabs';tabs.setAttribute('role','tablist');tabs.setAttribute('aria-label','共有する内容');tabs.innerHTML='<button type="button" id="planImageTab" role="tab" aria-controls="planImage">画像・リンク</button><button type="button" id="planCalendarTab" role="tab" aria-controls="planCalendar">カレンダーに追加</button>';$('planSummary').before(tabs);
    for(const [tab,panel,kind]of[['planImageTab','planImage','share'],['planCalendarTab','planCalendar','export']]){$(panel).setAttribute('role','tabpanel');$(panel).setAttribute('aria-labelledby',tab);$(tab).onclick=()=>open(kind,back,true);$(tab).onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'planImageTab':e.key==='End'?'planCalendarTab':tab==='planImageTab'?'planCalendarTab':'planImageTab';$(next).click();$(next).focus();}};}
    const status=t=>{waiting.hidden=true;d.removeAttribute('aria-busy');$('planStatus').textContent=t;};
    const busy=t=>{status('');waiting.hidden=false;$('planWaitingMessage').textContent=t;d.setAttribute('aria-busy','true');};
    const clearSaved=()=>{saved=null;$('planOpenNotebook').hidden=true;};
    $('planOpenNotebook').onclick=()=>{if(!saved)return;const pending=saved;d.addEventListener('close',()=>{setTimeout(()=>{if(!openNotebook?.(pending))alert('アカウントまたは予定が変わりました。記録の予定一覧を開き直してください。');},0);},{once:true});d.close();};
    const edits=()=>({title:$('planEventTitle').value,start:$('planStart').value,end:$('planEnd').value,reminder:0});
    const refreshKeep=()=>{$('planKeep').hidden=!localSave||!keep||!canKeep()||current?.payload?.kind!=='aim';};
    const validate=()=>{refreshKeep();try{if(!current)throw Error('共有する撮影条件を準備しています。');const e=event(current,edits());$('planGoogle').href=google(e);$('planGoogle').removeAttribute('aria-disabled');$('planIcs').disabled=false;$('planKeep').disabled=false;status(!$('planKeep').hidden?'記録に保存するか、カレンダーへ追加できます。記録の予定はログイン中に同期します。':'予定ファイルを開いて、カレンダーへの登録を確定してください。');return e;}catch(e){$('planGoogle').removeAttribute('href');$('planGoogle').setAttribute('aria-disabled','true');$('planIcs').disabled=true;$('planKeep').disabled=true;status(e.message);return null;}};
    const download=(blob,name)=>{const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);};
    for(const id of ['planEventTitle','planStart','planEnd'])$(id).oninput=validate;
    $('planClose').onclick=()=>d.close();d.addEventListener('close',()=>{if(d.open)return;seq++;clearSaved();if(url)URL.revokeObjectURL(url);url=null;file=null;current=null;back?.focus({preventScroll:true});});
    $('planGoogle').onclick=e=>{if(!validate())e.preventDefault();};
    $('planIcs').onclick=()=>{const e=validate();if(!e)return;download(new Blob([ics(e)],{type:'text/calendar;charset=utf-8'}),'AstroNotes_撮影予定.ics');status('予定ファイルを保存しました。カレンダーで開き、登録を確認してください。');};
    // 2026-10-20 構図の重なりは AstroNotes の NOTEBOOK の予定にも残せる（件名・日時はこの欄の値）
    $('planKeep').style.minHeight='44px';
    $('planKeep').onclick=()=>{clearSaved();const e=validate();if(!e||!keep||!canKeep()||!current)return;const r=keep(current,e);if(r?.ok&&openNotebook){saved=r;$('planOpenNotebook').hidden=false;}status(r&&r.ok?(r.updated?'予定を更新しました。':'予定を保存しました。記録の「予定」で見られます。'):r?.error||'予定を保存できませんでした。ブラウザの保存設定や空き容量を確認してください。');};
    $('planSave').onclick=()=>{if(file){download(file,file.name);status('画像の保存を開始しました。保存先から共有できます。');}};
    $('planCopy').onclick=async()=>{const copiedUrl=current?.url;if(!copiedUrl)return;try{await navigator.clipboard.writeText(copiedUrl);status('同じ撮影条件のリンクをコピーしました。');}catch{status('コピーできませんでした。下のリンクを選んでコピーしてください。');const a=document.createElement('a');a.href=copiedUrl;a.textContent=copiedUrl;$('planStatus').append(document.createElement('br'),a);}};
    $('planShare').onclick=async()=>{if(!file)return;const data={files:[file],title:current.title};try{if(!navigator.canShare?.({files:[file]})||!navigator.share){status('この端末では画像共有を使えません。「保存」から共有してください。');return;}await navigator.share(data);status('共有画面を閉じました。');}catch(e){status(e.name==='AbortError'?'共有を取り消しました。': '共有できませんでした。「保存」から共有してください。');}};
    async function open(kind,source,reuse=false){requested=kind;localSave=kind==='keep'||kind==='calendar';kind=localSave||kind==='export'?'calendar':'image';back=source;seq++;const token=seq;retry.hidden=true;clearSaved();file=null;if(url)URL.revokeObjectURL(url);url=null;$('planPreview').removeAttribute('src');for(const id of ['planSave','planShare','planCopy'])$(id).disabled=true;
      tabs.hidden=localSave;for(const [id,selected]of[['planImageTab',kind==='image'],['planCalendarTab',kind==='calendar']]){$(id).setAttribute('aria-selected',String(selected));$(id).tabIndex=selected?0:-1;}
      $('planTitle').textContent=localSave?'予定':'共有';$('planExport').hidden=false;$('planKeep').textContent='記録の予定に保存';$('planSummary').hidden=kind!=='calendar';$('planCalendar').hidden=kind!=='calendar';$('planImage').hidden=kind!=='image';
      const fresh=!reuse||!current;
      if(fresh){current=null;$('planCalendar').hidden=true;$('planImage').hidden=true;$('planSummary').textContent='';busy('共有する内容を準備しています…');}
      try{if(!d.open)show(d);if(fresh){const next=await snapshot(source,{current:()=>token===seq&&d.open});if(token!==seq||!d.open)return;current=next;}if(!current?.payload||!current.observer){current=null;throw Error('共有する撮影条件を確認できませんでした。「再試行」を押してください。');}$('planKeep').hidden=!localSave||!keep||!canKeep()||current.payload.kind!=='aim';$('planSummary').textContent=current.observer.name;status('');$('planCalendar').hidden=kind!=='calendar';$('planImage').hidden=kind!=='image';
        if(fresh){$('planEventTitle').value=current.title;$('planStart').value=localInput(current.start);$('planEnd').value=localInput(Math.ceil(Math.max(current.end,current.start+1000)/1000)*1000);}if(kind==='calendar'){validate();return;}
        const captured=current;
        busy('共有する画像を作っています…');await document.fonts.ready;if(token!==seq||!d.open)return;
        const cv=image(captured),blob=await new Promise((resolve,reject)=>cv.toBlob(b=>b?resolve(b):reject(new Error('画像を作れませんでした。画面を開き直してください。')),'image/png'));
        if(token!==seq||!d.open)return;file=new File([blob],'AstroNotes_撮影計画.png',{type:'image/png'});url=URL.createObjectURL(file);$('planPreview').src=url;for(const id of ['planSave','planCopy'])$(id).disabled=false;
        const can=navigator.canShare?.({files:[file]})&&navigator.share;$('planShare').disabled=!can;status(can?'':'画像を保存して、好きなアプリで共有できます。');
      }catch(e){if(token!==seq||!d.open)return;$('planCalendar').hidden=true;$('planImage').hidden=true;$('planSummary').textContent='';status(e instanceof TypeError?'共有する撮影条件を準備できませんでした。「再試行」を押してください。':e.message||'撮影計画を作れませんでした。「再試行」を押してください。');retry.hidden=false;}}
    document.addEventListener('click',e=>{const quick=e.target.closest('[data-quick-save]');if(quick){if(!quick.disabled)quickSave?.(quick.dataset.quickSave,quick);return;}const b=e.target.closest('[data-plan-action]');if(b)open(b.dataset.planAction,b);});
    return {open,refreshPermissions:()=>{if(d.open&&current&&localSave){const hidden=$('planKeep').hidden;refreshKeep();if(hidden!==$('planKeep').hidden){if($('planKeep').hidden)clearSaved();validate();}}}};
  }
  return {valid,encode,encodeLink,decode,compactPoint,expandPoint,stamp,escapeIcs,fold,dateTime,event,ics,google,link,mapLink,image,mount};
})();

/* Legacy global names remain aliases for cached integrations. */
if(typeof AstroNotesPlan!=='undefined')globalThis.SoramiPlan=AstroNotesPlan;
