/* 撮影計画: ICS (RFC 5545), PNG, versioned fragment links. No upload. */
const SoramiPlan = (() => {
  const num = (n, lo, hi) => Number.isFinite(n) && n >= lo && n <= hi;
  const text = (s, max = 100) => typeof s === 'string' && s.length <= max && !/[\u0000-\u001f]/u.test(s);
  const point = p => Array.isArray(p) && p.length === 6 && text(p[0]) && num(p[1], -90, 90) && num(p[2], -180, 180)
    && (p[3] === null || num(p[3], -500, 9000)) && num(p[4], 0, 700) && (p[5] === null || ['summit','basinRim','basinFloor','plain','coast'].includes(p[5]));
  const valid = p => {
    if (!p || p.v !== 1 || !point(p.o) || !num(p.at, Date.UTC(2000,0), Date.UTC(2101,0))) return false;
    if (p.kind === 'detail') return text(p.id, 32) && num(p.day, Date.UTC(2000,0), Date.UTC(2101,0));
    if (p.kind !== 'aim' || !text(p.body, 32) || !text(p.part, 40) || !['onTop','center','behind'].includes(p.limb)) return false;
    const t = p.t, l = p.l;
    return t && text(t.id, 80) && text(t.name) && num(t.latitude,-90,90) && num(t.longitude,-180,180)
      && num(t.groundM,-500,9000) && Array.isArray(t.parts) && t.parts.length > 0 && t.parts.length <= 16
      && t.parts.every(q => q && text(q.id,40) && text(q.name) && num(q.m,-500,10000))
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
    if (!s || s.length > 8000 || !/^[\w-]+$/.test(s)) return null;
    try {
      const p = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0))));
      return valid(p) ? p : null;
    } catch { return null; }
  }
  const compactPoint = (o,eye=1.5) => [String(o.name || '観測地点').slice(0,100),o.latitude,o.longitude,Number.isFinite(o.elevation)?o.elevation:null,eye,o.terrain || null];
  const expandPoint = p => ({id:`shared:${p[1]},${p[2]}`,name:p[0],subtitle:'共有された撮影地点',latitude:p[1],longitude:p[2],elevation:p[3],eyeHeightAGL:p[4],terrain:p[5],locationScope:'point',decks:null});
  const stamp = ms => new Date(ms).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  const escapeIcs = s => String(s).replaceAll('\\','\\\\').replace(/\r\n|\r|\n/g,'\\n').replaceAll(';','\\;').replaceAll(',','\\,');
  function fold(line) {
    let out='',row='',n=0;
    for (const ch of line) { const k=new TextEncoder().encode(ch).length; if(n+k>75){out+=row+'\r\n';row=' ';n=1;} row+=ch;n+=k; }
    return out+row;
  }
  const dateTime = ms => new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).format(ms);
  const localInput = ms => new Date(ms+32400000).toISOString().slice(0,19);
  const inputMs = s => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(s) ? Date.parse(s+(s.length===16?':00':'')+'+09:00') : NaN;
  function event(s, edits) {
    const start=inputMs(edits.start),end=inputMs(edits.end),title=edits.title.trim();
    if (!title || title.length>200 || !Number.isFinite(start) || !Number.isFinite(end) || end<=start) throw new Error('件名と日時を確認してください。終了は開始より後にしてください。');
    return {title,start,end,reminder:[0,15,30,60].includes(+edits.reminder)?+edits.reminder:0,
      location:`${s.observer.name} (${s.observer.latitude.toFixed(6)}, ${s.observer.longitude.toFixed(6)})`,
      description:[s.title,...s.rows.map(r=>r.join('：')),s.note,`地図: ${s.mapUrl}`,`同じ条件: ${s.url}`].filter(Boolean).join('\n')};
  }
  function ics(e,now=Date.now()) {
    // Stable identity for the same event; changing notification settings does not duplicate its UID.
    const key=[e.title,e.start,e.location].join('|');let hash=2166136261;
    for(const c of key)hash=Math.imul(hash^c.codePointAt(0),16777619)>>>0;
    const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Zekkei Yosoku//Shooting Plan//JA','CALSCALE:GREGORIAN','BEGIN:VEVENT',
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
  function link(p) { return `https://zekkei-yosoku.github.io/#/${p.kind==='aim'?'aim':`${p.id}/${p.day}`}?plan=${encode(p)}`; }
  const mapLink = o => `https://www.google.com/maps/search/?api=1&query=${o.latitude},${o.longitude}`;
  // Overview is drawn locally: no new location or tile request is made while sharing.
  function locationMap(s) {
    const cv=document.createElement('canvas');cv.width=952;cv.height=420;const ctx=cv.getContext('2d');
    ctx.fillStyle='#f2f3f5';ctx.fillRect(0,0,952,420);ctx.font='700 26px -apple-system, sans-serif';ctx.fillStyle='#4a4a4f';ctx.fillText('位置図（概略）・北が上',24,42);
    let a=[476,230],b=null;
    if(s.target){const dx=(s.target.longitude-s.observer.longitude)*Math.cos(s.observer.latitude*Math.PI/180),dy=-(s.target.latitude-s.observer.latitude),scale=230/Math.max(Math.abs(dx),Math.abs(dy),1e-8);a=[476-dx*scale/2,220-dy*scale/2];b=[476+dx*scale/2,220+dy*scale/2];
      ctx.strokeStyle='#a04f09';ctx.lineWidth=4;ctx.setLineDash([10,8]);ctx.beginPath();ctx.moveTo(...a);ctx.lineTo(...b);ctx.stroke();ctx.setLineDash([]);}
    const pin=(p,label,color)=>{ctx.fillStyle=color;ctx.beginPath();ctx.arc(...p,10,0,Math.PI*2);ctx.fill();ctx.textAlign='center';ctx.font='700 30px -apple-system, sans-serif';ctx.fillText(label,p[0],p[1]-22);};
    pin(a,'観測地点','#a04f09');if(b)pin(b,'目標','#1c1c1e');ctx.textAlign='left';ctx.fillStyle='#4a4a4f';ctx.font='400 24px -apple-system, sans-serif';ctx.fillText(`緯度 ${s.observer.latitude.toFixed(6)} / 経度 ${s.observer.longitude.toFixed(6)}`,24,380);
    ctx.fillText('N ↑',830,42);return cv;
  }

  function image(s) {
    const cv=document.createElement('canvas'),ctx=cv.getContext('2d'),W=1080,P=64;
    const lines=[];
    const wrap=(str,width,font)=>{ctx.font=font;let row='',out=[];for(const ch of String(str)){if(ctx.measureText(row+ch).width>width&&row){out.push(row);row='';}row+=ch;}if(row)out.push(row);return out;};
    const add=(str,size=30,color='#1c1c1e',weight=400)=>{for(const t of wrap(str,W-2*P,`${weight} ${size}px -apple-system, BlinkMacSystemFont, sans-serif`))lines.push({t,size,color,weight});};
    add('絶景予測  /  撮影計画',26,'#a04f09',700);add(s.title,48,'#1c1c1e',700);add(`${dateTime(s.at)}（日本時間）`,36,'#1c1c1e',700);
    const top=64+lines.reduce((a,l)=>a+l.size*1.5,0)+24;
    const mapH=s.mapScene?420:0;
    const sceneH=s.scene ? Math.min(660,Math.round((W-2*P)*s.scene.height/s.scene.width)) : 0;
    const body=[];for(const r of s.rows){const label=wrap(r[0],W-2*P,'700 26px sans-serif');const value=wrap(r[1],W-2*P,'400 32px sans-serif');body.push({label,value});}
    const noteLines=wrap(s.note,W-2*P,'400 26px sans-serif');
    const qr=qrcodegen.QrCode.encodeText(s.url,qrcodegen.QrCode.Ecc.LOW),cell=Math.max(4,Math.floor(440/(qr.size+8))),qW=(qr.size+8)*cell;
    const bodyH=body.reduce((a,r)=>a+r.label.length*38+r.value.length*46+24,0);
    cv.width=W;cv.height=Math.ceil(top+sceneH+(sceneH?32:0)+mapH+(mapH?32:0)+bodyH+noteLines.length*38+qW+200);
    ctx.fillStyle='#ffffff';ctx.fillRect(0,0,W,cv.height);let y=P;
    ctx.textBaseline='top';for(const l of lines){ctx.font=`${l.weight} ${l.size}px -apple-system, BlinkMacSystemFont, sans-serif`;ctx.fillStyle=l.color;ctx.fillText(l.t,P,y);y+=l.size*1.5;}y+=24;
    if(s.scene){ctx.drawImage(s.scene,P,y,W-2*P,sceneH);y+=sceneH+32;}
    if(s.mapScene){ctx.drawImage(s.mapScene,P,y,W-2*P,mapH);y+=mapH+32;}
    for(const r of body){ctx.fillStyle='#6b6b71';ctx.font='700 26px -apple-system, sans-serif';for(const t of r.label){ctx.fillText(t,P,y);y+=38;}ctx.fillStyle='#1c1c1e';ctx.font='400 32px -apple-system, sans-serif';for(const t of r.value){ctx.fillText(t,P,y);y+=46;}y+=24;}
    ctx.font='400 26px -apple-system, sans-serif';ctx.fillStyle='#4a4a4f';for(const t of noteLines){ctx.fillText(t,P,y);y+=38;}y+=32;
    const qx=Math.round((W-qW)/2);ctx.fillStyle='#000';for(let r=0;r<qr.size;r++)for(let c=0;c<qr.size;c++)if(qr.getModule(c,r))ctx.fillRect(qx+(c+4)*cell,y+(r+4)*cell,cell,cell);
    y+=qW+24;ctx.textAlign='center';ctx.font='700 28px -apple-system, sans-serif';ctx.fillText('同じ撮影条件を開く',W/2,y);y+=42;ctx.fillStyle='#6b6b71';ctx.font='400 24px -apple-system, sans-serif';ctx.fillText('zekkei-yosoku.github.io',W/2,y);return cv;
  }
  function mount({snapshot,show}) {
    const d=document.createElement('dialog');d.id='planSheet';d.className='sheet';d.tabIndex=-1;d.setAttribute('aria-labelledby','planTitle');
    d.innerHTML=`<div class="sheet-head"><strong id="planTitle" class="sr-only">共有</strong><div id="planModes" class="preview-tabs" role="tablist" aria-label="共有方法"><button type="button" id="planImageTab" role="tab" aria-selected="true" aria-controls="planImage">画像</button><button type="button" id="planCalendarTab" role="tab" aria-selected="false" aria-controls="planCalendar" tabindex="-1">カレンダー</button></div><button type="button" id="planClose" aria-label="閉じる"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg></button></div><div class="sheet-body"><p id="planSummary"></p>
      <section id="planCalendar" role="tabpanel" aria-labelledby="planCalendarTab"><label for="planEventTitle">予定の件名</label><input type="text" id="planEventTitle" maxlength="200">
      <label for="planStart">開始（日本時間）</label><input type="datetime-local" step="1" id="planStart"><label for="planEnd">終了（日本時間）</label><input type="datetime-local" step="1" id="planEnd">
      <label for="planReminder">予定ファイルの通知</label><select id="planReminder"><option value="0">なし</option><option value="15">15分前</option><option value="30">30分前</option><option value="60">1時間前</option></select>
      <div class="plan-actions"><a id="planGoogle" class="chip" target="_blank" rel="noopener noreferrer">Googleカレンダーで登録</a><button type="button" class="chip" id="planIcs">予定ファイルを保存</button></div>
      <p class="tiny">予定ファイルはAppleカレンダー・Outlookなどで開けます。Googleの通知は登録画面で設定してください。</p></section>
      <section id="planImage" role="tabpanel" aria-labelledby="planImageTab" hidden><div class="plan-preview-frame" tabindex="0" aria-label="共有画像を確認"><img id="planPreview" alt="撮影計画の共有画像"></div><div class="plan-actions"><button type="button" class="chip primary" id="planShare" aria-label="画像を共有" disabled>共有</button><button type="button" class="chip" id="planSave" aria-label="画像を保存" disabled>保存</button><button type="button" class="chip" id="planCopy" disabled>リンクをコピー</button></div></section><p id="planStatus" class="tiny" role="status" aria-live="polite"></p></div>`;
    document.body.append(d);const $=id=>document.getElementById(id);let current=null,file=null,url=null,seq=0,back=null;
    const status=t=>$('planStatus').textContent=t;
    const edits=()=>({title:$('planEventTitle').value,start:$('planStart').value,end:$('planEnd').value,reminder:$('planReminder').value});
    const validate=()=>{try{const e=event(current,edits());$('planGoogle').href=google(e);$('planGoogle').removeAttribute('aria-disabled');$('planIcs').disabled=false;status('保存後、カレンダーで開いて登録を確定してください。');return e;}catch(e){$('planGoogle').removeAttribute('href');$('planGoogle').setAttribute('aria-disabled','true');$('planIcs').disabled=true;status(e.message);return null;}};
    const download=(blob,name)=>{const u=URL.createObjectURL(blob),a=document.createElement('a');a.href=u;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(u),60000);};
    for(const id of ['planEventTitle','planStart','planEnd','planReminder'])$(id).oninput=validate;
    $('planClose').onclick=()=>d.close();d.addEventListener('close',()=>{seq++;if(url)URL.revokeObjectURL(url);url=null;file=null;current=null;back?.focus({preventScroll:true});});
    $('planGoogle').onclick=e=>{if(!validate())e.preventDefault();};
    $('planIcs').onclick=()=>{const e=validate();if(!e)return;download(new Blob([ics(e)],{type:'text/calendar;charset=utf-8'}),'絶景予測_撮影予定.ics');status('予定ファイルを保存しました。カレンダーで開き、登録を確認してください。');};
    $('planSave').onclick=()=>{if(file){download(file,file.name);status('画像の保存を開始しました。保存先から共有できます。');}};
    $('planCopy').onclick=async()=>{const copiedUrl=current?.url;if(!copiedUrl)return;try{await navigator.clipboard.writeText(copiedUrl);status('同じ撮影条件のリンクをコピーしました。');}catch{status('コピーできませんでした。下のリンクを選んでコピーしてください。');const a=document.createElement('a');a.href=copiedUrl;a.textContent=copiedUrl;$('planStatus').append(document.createElement('br'),a);}};
    $('planShare').onclick=async()=>{if(!file)return;const data={files:[file],title:current.title};try{if(!navigator.canShare?.({files:[file]})||!navigator.share){status('この端末では画像共有を使えません。「保存」から共有してください。');return;}await navigator.share(data);status('共有画面を閉じました。');}catch(e){status(e.name==='AbortError'?'共有を取り消しました。': '共有できませんでした。「保存」から共有してください。');}};
    async function open(kind,source,reuse=false){if(kind==='share')kind='image';back=source;seq++;const token=seq;file=null;if(url)URL.revokeObjectURL(url);url=null;$('planPreview').removeAttribute('src');for(const id of ['planSave','planShare','planCopy'])$(id).disabled=true;
      $('planTitle').textContent='共有';for(const [id,mode] of [['planImageTab','image'],['planCalendarTab','calendar']]){$(id).setAttribute('aria-selected',String(kind===mode));$(id).tabIndex=kind===mode?0:-1;}$('planSummary').hidden=kind!=='calendar';$('planCalendar').hidden=kind!=='calendar';$('planImage').hidden=kind!=='image';
      if(!reuse)current=null;try{if(!reuse)current=snapshot(source);$('planSummary').textContent=current.observer.name;status('');if(!d.open)show(d);
        if(!reuse){$('planEventTitle').value=current.title;$('planStart').value=localInput(current.start);$('planEnd').value=localInput(Math.ceil(Math.max(current.end,current.start+1000)/1000)*1000);$('planReminder').value='0';}if(kind==='calendar'){validate();return;}
        status('画像を作っています…');await document.fonts.ready;if(token!==seq||!d.open)return;
        current.mapScene=locationMap(current);
        const cv=image(current),blob=await new Promise((resolve,reject)=>cv.toBlob(b=>b?resolve(b):reject(new Error('画像を作れませんでした。画面を開き直してください。')),'image/png'));
        if(token!==seq||!d.open)return;file=new File([blob],'絶景予測_撮影計画.png',{type:'image/png'});url=URL.createObjectURL(file);$('planPreview').src=url;for(const id of ['planSave','planCopy'])$(id).disabled=false;
        const can=navigator.canShare?.({files:[file]})&&navigator.share;$('planShare').disabled=!can;status(can?'':'画像を保存して、好きなアプリで共有できます。');
      }catch(e){$('planCalendar').hidden=true;$('planImage').hidden=true;$('planSummary').textContent='';status(e.message||'撮影計画を作れませんでした。画面を開き直してください。');if(!d.open)show(d);}}
    for(const [id,mode] of [['planImageTab','image'],['planCalendarTab','calendar']]){$(id).onclick=()=>open(mode,back,true);$(id).onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'planImageTab':e.key==='End'?'planCalendarTab':id==='planImageTab'?'planCalendarTab':'planImageTab';$(next).click();$(next).focus();}};}
    document.addEventListener('click',e=>{const b=e.target.closest('[data-plan-action]');if(b)open(b.dataset.planAction,b);});
    return {open};
  }
  return {valid,encode,decode,compactPoint,expandPoint,stamp,escapeIcs,fold,dateTime,event,ics,google,link,mapLink,locationMap,image,mount};
})();
