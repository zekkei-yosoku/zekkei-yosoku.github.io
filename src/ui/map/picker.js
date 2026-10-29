// ---------------------------------------------------------------- 地図で選ぶ
//
// **ライブラリは使わない。** このアプリは依存パッケージを持たない方針で、
// 地図に必要なのはタイルを並べることと、画面の座標と緯度経度の変換だけ。
// タイルは国土地理院（標高タイルと同じ配信元。出典表示が条件）。
//
// ダイヤモンド富士は**立つ場所が数百m違うと日付が変わる**ので、
// 文字の地点検索（市区町村の代表点）では精度が足りない。その穴を埋めるための画面。
/// 地図の種類（国土地理院のタイル）。キーは保存してあるので変えない（map・photo）
const MAP_LAYERS = {
  map: { key: "pale", ext: "png", maxZ: 18, label: "標準" },
  photo: { key: "seamlessphoto", ext: "jpg", maxZ: 18, label: "航空写真" },
  // 陰影起伏図は z16 まで。淡色地図に掛け合わせる
  terrain: { key: "pale", ext: "png", maxZ: 16, label: "地形", shade: { key: "hillshademap", ext: "png" } },
};
const MAP_ICON_LAYERS = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 2.5 8 12 13l9.5-5L12 3Z"/><path d="m2.5 12.5 9.5 5 9.5-5"/><path d="m2.5 16.5 9.5 5 9.5-5" opacity=".55"/></svg>`;
const MAP_ICON_LOCATE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" aria-hidden="true"><path d="m21 3-7 18-3-8-8-3Z"/></svg>`;
/// 現在地（どの地図でも共通）。{ latitude, longitude, accuracyM }
let myPos = null;
const MAP_VIEWS = new Set();          // 現在地が変わったら描き直す地図
function locateMe({ quiet = false } = {}) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) { resolve(null); return; }
    navigator.geolocation.getCurrentPosition((pos) => {
      myPos = { latitude: pos.coords.latitude, longitude: pos.coords.longitude, accuracyM: pos.coords.accuracy, at: Date.now() };
      for (const redraw of MAP_VIEWS) redraw();
      resolve(myPos);
    }, () => resolve(null), { enableHighAccuracy: !quiet, timeout: 10000, maximumAge: 60000 });
  });
}
async function locateIfAllowed() {
  // 2分より古ければ取り直す（歩いて場所を探していると、点が置いていかれる）
  if (myPos && Date.now() - myPos.at < 120000) return;
  try {
    const st = navigator.permissions && await navigator.permissions.query({ name: "geolocation" });
    if (st && st.state === "granted") locateMe({ quiet: true });
  } catch { /* 許可を確かめられなければ出さない */ }
}
/// 現在地の点（地図アプリと同じ青い点。誤差が大きければ薄い円も）
function drawMyPos(ctx, project, view) {
  if (!myPos) return;
  const [x, y] = project(myPos.latitude, myPos.longitude);
  const mPerPx = 156543.03 * Math.cos(myPos.latitude * Math.PI / 180) / 2 ** view.zoom;
  const r = myPos.accuracyM / mPerPx;
  if (r > 10 && r < 400) {
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(26,115,232,.15)"; ctx.fill();
  }
  ctx.beginPath(); ctx.arc(x, y, 8, 0, Math.PI * 2); ctx.fillStyle = "#fff"; ctx.fill();
  ctx.beginPath(); ctx.arc(x, y, 6, 0, Math.PI * 2); ctx.fillStyle = "#1a73e8"; ctx.fill();
}
function wireMapKeyboard(wrap,expand,isWide,leave,trap=true){
  window.addEventListener('keydown',e=>{
    if(!isWide()||e.isComposing||e.keyCode===229)return;
    const activeDialog=document.activeElement?.closest('dialog[open]');if(activeDialog&&activeDialog!==wrap.closest('dialog'))return;
    if(document.activeElement===document.body&&[...document.querySelectorAll('dialog[open]')].some(d=>d!==wrap.closest('dialog')))return;
    if(e.key==='Tab'&&trap){
      const controls=[...wrap.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),summary,a[href]')].filter(n=>n.getClientRects().length);
      const i=controls.indexOf(document.activeElement);if(controls.length&&(i<0||(!e.shiftKey&&i===controls.length-1)||(e.shiftKey&&i===0))){e.preventDefault();controls[e.shiftKey?controls.length-1:0].focus({preventScroll:true});}return;
    }
    if(e.key!=='Escape')return;
    const modeMenu=wrap.querySelector('[data-shape-menu]:not([hidden])');
    if(modeMenu){e.preventDefault();e.stopImmediatePropagation();modeMenu.hidden=true;const button=modeMenu.previousElementSibling;button.setAttribute('aria-expanded','false');button.focus({preventScroll:true});return;}
    const menu=wrap.querySelector('.map-layer-menu:not([data-shape-menu])');
    e.preventDefault();e.stopImmediatePropagation();
    if(menu&&!menu.hidden){menu.hidden=true;const button=wrap.querySelector('.map-layers-btn');button.setAttribute('aria-expanded','false');button.focus({preventScroll:true});return;}
    leave();expand.focus({preventScroll:true});
  },true);
}
// All geographic maps share Explore's preview, controls and fullscreen surface.
function mountMapShell(wrap, ids, redraw) {
  wrap.classList.add('astro-map-wrap');
  const center=wrap.querySelector('.mappin,.map-cross,#shapeFixedPin');
  if(center&&ids.canvas!=='skyMapCanvas'){
    center.classList.add('shared-map-center');
    if(center instanceof SVGElement){center.setAttribute('viewBox','0 0 24 24');center.innerHTML='<path d="M12 3v7m0 4v7M3 12h7m4 0h7" fill="none" stroke="var(--text)" stroke-width="1.8"/>';}
    else center.textContent='';
  }

  if(ids.canvas==='skyMapCanvas'){const button=wrap.querySelector('.sky-map-expand');wireMapKeyboard(wrap,button,()=>wrap.classList.contains('sky-map-wide'),()=>button.click(),false);return;}
  const expand=document.createElement('button');expand.type='button';expand.className='map-ctl sky-map-expand';
  expand.innerHTML=document.getElementById('skyMapExpand').innerHTML;wrap.append(expand);
  const selectionOnly=['mapCanvas','shapeCanvas'].includes(ids.canvas);
  if(selectionOnly){expand.hidden=true;wrap.dataset.selectionOnly='';}
  const leaveSelection=()=>wrap.closest('dialog')?.querySelector('.page-back')?.click();
  let moved=[],footer=null,search=null,observer=null,wide=false;
  const relocate=(node,host)=>{if(!node||node===wrap||wrap.contains(node))return;const marker=document.createComment('map-control-home');node.before(marker);host.append(node);moved.push({node,marker});};
  const setWide=on=>{
    if(wide===on)return;wide=on;
    wrap.classList.toggle('sky-map-wide',on);
    expand.setAttribute('aria-pressed',String(on));expand.setAttribute('aria-label',on?'全画面表示を終了':'地図を全画面表示');expand.title=expand.getAttribute('aria-label');
    if(on){
      search=document.createElement('div');search.className='shared-map-search';footer=document.createElement('div');footer.className='shared-map-footer';wrap.append(search,footer);
      const dialog=wrap.closest('dialog');
      if(ids.canvas==='mapCanvas'){
        relocate(dialog.querySelector('.search-row'),search);relocate(document.getElementById('mapSearchResults'),search);
        relocate(dialog.querySelector('.maprow'),footer);relocate(document.getElementById('mapPick'),footer);
      }else if(ids.canvas==='shapeCanvas'){
        relocate(document.getElementById('shapeLocationPanel'),search);
        const note=document.getElementById('shapeApply').nextElementSibling;
        for(const id of ['shapeHelp','shapeVertexTools','shapeStatus','shapeApply'])relocate(document.getElementById(id),footer);relocate(note,footer);
      }else if(ids.canvas==='targetEditorCanvas'){
        const editor=wrap.closest('[data-target-editor]');relocate(editor.querySelector('.target-location-search'),search);relocate(document.getElementById('targetPlaceResults'),search);
        const done=document.createElement('button');done.type='button';done.className='fav-btn primary';done.textContent='この位置にする';done.onclick=()=>setWide(false);footer.append(done);
      }
      if(['mapCanvas','shapeCanvas'].includes(ids.canvas)){const cancel=document.createElement('button');cancel.type='button';cancel.className='chip shared-map-cancel';cancel.textContent='戻る';cancel.onclick=()=>dialog.querySelector('.page-back')?.click();footer.append(cancel);}
      search.hidden=!search.children.length;footer.hidden=!footer.children.length;
      observer=new ResizeObserver(()=>{wrap.style.setProperty('--sky-footer-h',(footer.hidden?0:footer.getBoundingClientRect().height)+'px');redraw();});observer.observe(footer);
    }else{
      observer?.disconnect();observer=null;
      for(const {node,marker}of moved){marker.replaceWith(node);}moved=[];search?.remove();footer?.remove();search=footer=null;wrap.style.removeProperty('--sky-footer-h');
      const modeMenu=wrap.querySelector('[data-shape-menu]');if(modeMenu){modeMenu.hidden=true;modeMenu.previousElementSibling?.setAttribute('aria-expanded','false');}
      const menu=wrap.querySelector('.map-layer-menu:not([data-shape-menu])');if(menu)menu.hidden=true;wrap.querySelector('.map-layers-btn')?.setAttribute('aria-expanded','false');
    }
    if(!on&&(!wrap.closest('dialog')||wrap.closest('dialog').open))expand.focus({preventScroll:true});
    requestAnimationFrame(redraw);
  };
  expand.setAttribute('aria-pressed','false');expand.setAttribute('aria-label','地図を全画面表示');expand.title='地図を全画面表示';expand.onclick=()=>setWide(!wide);
  const dialog=wrap.closest('dialog');dialog?.addEventListener('close',()=>setWide(false));
  // Leaving a route must not leave a fixed map above the next page.
  window.addEventListener('hashchange',()=>{if(!dialog||!dialog.open)setWide(false);});
  wireMapKeyboard(wrap,expand,()=>wide,()=>selectionOnly?leaveSelection():setWide(false));
  wrap._mapShell={setWide,isWide:()=>wide};
  if(['mapCanvas','shapeCanvas','targetEditorCanvas','aimLineCanvas'].includes(ids.canvas))setWide(true);
}

function createMapView(ids) {
  const TILE = 256;
  let layer = "map";
  const URL = (src, z, x, y) => `https://cyberjapandata.gsi.go.jp/xyz/${src.key}/${z}/${x}/${y}.${src.ext}`;
  const MIN_Z = 5;
  // タイルの配信上限より2段階先まで拡大できるようにする。
  // z19・20 は z18 タイルを拡大表示するため、細部は増えないが地点を合わせやすくなる。
  const maxZoom = () => MAP_LAYERS[layer].maxZ;
  const maxViewZoom = () => maxZoom() + 2;
  const tiles = new Map();          // "layer/z/x/y" → Image（読み込み済みだけ描く）
  let cv = null, ctx = null, view = { lat: 35.36, lon: 138.73, zoom: 14 };
  let drag = null, pinch = null, raf = 0;
  // 重ね描き（ライン）と、動かしたときの通知。どちらも無くても地図は動く
  let overlay = null, onChange = null, onPick = null, onDoubleTap = null, lastTap = null;
  /// 緯度経度 → 画面のピクセル。重ね描きから使う
  function project(lat, lon) {
    const z = Math.max(MIN_Z, Math.min(maxZoom(), Math.round(view.zoom)));
    const scale = 2 ** (view.zoom - z);
    const w = cv.clientWidth, h = cv.clientHeight;
    return [lonToX(lon, z) * scale - lonToX(view.lon, z) * scale + w / 2,
            latToY(lat, z) * scale - latToY(view.lat, z) * scale + h / 2];
  }

  // Web メルカトル。世界を 256×2^z ピクセルの正方形に写す
  const lonToX = (lon, z) => (lon + 180) / 360 * TILE * 2 ** z;
  const latToY = (lat, z) => {
    const r = lat * Math.PI / 180;
    return (1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * TILE * 2 ** z;
  };
  const xToLon = (x, z) => x / (TILE * 2 ** z) * 360 - 180;
  const yToLat = (y, z) => {
    const n = Math.PI - 2 * Math.PI * y / (TILE * 2 ** z);
    return 180 / Math.PI * Math.atan(Math.sinh(n));
  };

  function tileImage(src, z, x, y) {
    const key = `${src.key}/${z}/${x}/${y}`;
    if (tiles.has(key)) return tiles.get(key);
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => draw();
    img.onerror = () => { img.failed = true; };     // 海など無い区画。黙って空けておく
    img.src = URL(src, z, x, y);
    tiles.set(key, img);
    return img;
  }

  function draw() {
    if (!cv || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    // 整数ズームのタイルを、端数ぶんだけ拡大して描く（拡大中もなめらかに見せる）
    const z = Math.max(MIN_Z, Math.min(maxZoom(), Math.round(view.zoom)));
    const scale = 2 ** (view.zoom - z);
    const size = TILE * scale;
    const cx = lonToX(view.lon, z) * scale, cy = latToY(view.lat, z) * scale;
    const x0 = Math.floor((cx - w / 2) / size), x1 = Math.floor((cx + w / 2) / size);
    const y0 = Math.floor((cy - h / 2) / size), y1 = Math.floor((cy + h / 2) / size);
    const max = 2 ** z;
    for (let ty = y0; ty <= y1; ty++) {
      if (ty < 0 || ty >= max) continue;
      for (let tx = x0; tx <= x1; tx++) {
        const wrapped = ((tx % max) + max) % max;
        const L = MAP_LAYERS[layer];
        const img = tileImage(L, z, wrapped, ty);
        if (!img.complete || img.failed || !img.naturalWidth) continue;
        const px = Math.round(tx * size - cx + w / 2), py = Math.round(ty * size - cy + h / 2);
        ctx.drawImage(img, px, py, Math.ceil(size), Math.ceil(size));
        // 地形: 淡色地図に陰影起伏図を掛け合わせる（斜面が影になり、尾根と谷が見える。陰影だけだと地名も道も無い）
        if (L.shade) {
          const sh = tileImage(L.shade, z, wrapped, ty);
          if (sh.complete && !sh.failed && sh.naturalWidth) {
            ctx.globalCompositeOperation = "multiply"; ctx.globalAlpha = 0.6;
            ctx.drawImage(sh, px, py, Math.ceil(size), Math.ceil(size));
            ctx.globalCompositeOperation = "source-over"; ctx.globalAlpha = 1;
          }
        }
      }
    }
    if (ids.coord) $(ids.coord).textContent = `${view.lat.toFixed(5)}, ${view.lon.toFixed(5)}`;
    if (overlay) { try { overlay(ctx, { project, view, width: w, height: h }); } catch { /* 重ね描きで落とさない */ } }
    drawMyPos(ctx, project, view);
    if (onChange) onChange({ latitude: view.lat, longitude: view.lon, zoom: view.zoom });
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; draw(); }); };

  function panBy(dx, dy) {
    const z = Math.max(MIN_Z, Math.min(maxZoom(), Math.round(view.zoom)));
    const scale = 2 ** (view.zoom - z);
    view.lon = xToLon(lonToX(view.lon, z) - dx / scale, z);
    view.lat = yToLat(latToY(view.lat, z) - dy / scale, z);
    view.lat = Math.max(-85, Math.min(85, view.lat));
    schedule();
  }
  const zoomBy = (d) => { view.zoom = Math.max(MIN_Z, Math.min(maxViewZoom(), view.zoom + d)); schedule(); };

  function coordinateAt(x,y) {
    if (!cv) return null;
    const z=Math.max(MIN_Z,Math.min(maxZoom(),Math.round(view.zoom))),scale=2**(view.zoom-z);
    const lon=xToLon(lonToX(view.lon,z)+(x-cv.clientWidth/2)/scale,z);
    const lat=yToLat(latToY(view.lat,z)+(y-cv.clientHeight/2)/scale,z);
    return {latitude:Math.max(-85,Math.min(85,lat)),longitude:((lon+180)%360+360)%360-180};
  }
  function attach() {
    cv = $(ids.canvas); ctx = cv.getContext("2d");
    const scrollMap=()=>!cv.closest('.sky-map-wide');
    const twoTouch=e=>{if(scrollMap()&&e.touches.length>=2&&e.cancelable)e.preventDefault();};
    cv.addEventListener('touchstart',twoTouch,{passive:false});cv.addEventListener('touchmove',twoTouch,{passive:false});
    cv.onpointerdown = (e) => {
      cv.setPointerCapture(e.pointerId);
      if (pinch) { pinch.points.set(e.pointerId, e); return; }
      if (drag) {       // 2本目の指。つまむ操作へ切り替える
        pinch = { points: new Map([[drag.id, drag.last], [e.pointerId, e]]), base: null };
        const [a,b]=[...pinch.points.values()];pinch.mid=[(a.clientX+b.clientX)/2,(a.clientY+b.clientY)/2];
        pinch.base=Math.hypot(a.clientX-b.clientX,a.clientY-b.clientY);pinch.baseZoom=view.zoom;
        drag = null;
        return;
      }
      drag = { id: e.pointerId, last: e, startX:e.clientX, startY:e.clientY, moved:false };
    };
    cv.onpointermove = (e) => {
      if (pinch && pinch.points.has(e.pointerId)) {
        pinch.points.set(e.pointerId, e);
        const [a, b] = [...pinch.points.values()];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        const mid=[(a.clientX+b.clientX)/2,(a.clientY+b.clientY)/2];if(pinch.mid)panBy(mid[0]-pinch.mid[0],mid[1]-pinch.mid[1]);pinch.mid=mid;
        if (pinch.base === null) { pinch.base = dist; pinch.baseZoom = view.zoom; return; }
        if (dist > 0 && pinch.base > 0) {
          view.zoom = Math.max(MIN_Z, Math.min(maxViewZoom(), pinch.baseZoom + Math.log2(dist / pinch.base)));
          schedule();
        }
        return;
      }
      if (!drag || e.pointerId !== drag.id) return;
      if(Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)>6)drag.moved=true;
      if(!(scrollMap()&&e.pointerType==='touch'))panBy(e.clientX - drag.last.clientX, e.clientY - drag.last.clientY);
      drag.last = e;
    };
    const release = (e) => {
      const tap=e.type==='pointerup'&&drag&&e.pointerId===drag.id&&!drag.moved&&Math.hypot(e.clientX-drag.startX,e.clientY-drag.startY)<=6;
      if (pinch) { pinch.points.delete(e.pointerId); if (pinch.points.size < 2) pinch = null; }
      if (drag && e.pointerId === drag.id) drag = null;
      if(tap&&['shapeCanvas','targetEditorCanvas','aimLineCanvas'].includes(ids.canvas)&&scrollMap()){cv.closest('.mapwrap')._mapShell?.setWide(true);return;}
      if(tap&&onPick){const double=lastTap&&Number.isFinite(e.timeStamp)&&e.timeStamp-lastTap.at>=0&&e.timeStamp-lastTap.at<500&&Math.hypot(e.clientX-lastTap.x,e.clientY-lastTap.y)<=6;lastTap=double?null:{at:e.timeStamp,x:e.clientX,y:e.clientY};if(!double){const r=cv.getBoundingClientRect();onPick(coordinateAt(e.clientX-r.left,e.clientY-r.top),{x:e.clientX-r.left,y:e.clientY-r.top});}}
    };
    cv.onpointerup = release;
    cv.onpointercancel = release;
    cv.onlostpointercapture = release;
    cv.onwheel = (e) => { if(scrollMap()&&!e.ctrlKey&&!e.metaKey)return;e.preventDefault(); zoomBy(e.deltaY > 0 ? -0.5 : 0.5); };
    cv.ondblclick = (e) => { e.preventDefault(); if(onDoubleTap)onDoubleTap();zoomBy(1); };
    if (ids.zoomIn) $(ids.zoomIn).onclick = () => zoomBy(1);
    if (ids.zoomOut) $(ids.zoomOut).onclick = () => zoomBy(-1);
    // 地図の上に、種類の切り替え（右上）と現在地（右下、＋の上）を置く。どの地図も同じ部品（2026-10-02 ユーザー「地図、写真ってどっちも地図じゃん。
    // こういうボタンを用意して地図モードを変えられるように」「現在地マークをおいといた方が良い」）
    const wrap = cv.closest(".mapwrap");
    wrap.insertAdjacentHTML("beforeend", `<button class="map-ctl map-layers-btn" aria-label="地図の種類" aria-haspopup="true" aria-expanded="false">${MAP_ICON_LAYERS}</button>
      <div class="map-layer-menu" role="menu" aria-label="地図の種類" hidden>${Object.entries(MAP_LAYERS).map(([k, l]) =>
        `<button role="menuitemradio" data-layer="${k}" aria-checked="false">${esc(l.label)}</button>`).join("")}</div>
      <p class="map-msg" role="status" hidden></p>`);
    wrap.querySelector(".mapzoom").insertAdjacentHTML("afterbegin", `<button class="map-locate" aria-label="現在地">${MAP_ICON_LOCATE}</button>`);
    const menu = wrap.querySelector(".map-layer-menu:not([data-shape-menu])"), menuBtn = wrap.querySelector(".map-layers-btn");
    const showMenu = (on) => { menu.hidden = !on; menuBtn.setAttribute("aria-expanded", String(on)); };
    menuBtn.onclick = (e) => { e.stopPropagation(); showMenu(menu.hidden); };
    for (const b of menu.querySelectorAll("[data-layer]")) b.onclick = () => { setLayer(b.dataset.layer, true); showMenu(false); };
    document.addEventListener("pointerdown", (e) => { if (!menu.hidden && !e.target.closest(".map-layer-menu, .map-layers-btn")) showMenu(false); });
    const msg = wrap.querySelector(".map-msg"), locate = wrap.querySelector(".map-locate");
    locate.onclick = async () => {
      locate.classList.add("busy");
      const got = await locateMe();
      locate.classList.remove("busy");
      if (!got) {
        msg.textContent = "現在地を取得できませんでした";
        msg.hidden = false;
        clearTimeout(msg.timer);
        msg.timer = setTimeout(() => { msg.hidden = true; }, 3000);
        return;
      }
      view.lat = got.latitude; view.lon = got.longitude;
      view.zoom = Math.max(view.zoom, Math.min(15, maxZoom()));
      schedule();
    };
    if(!wrap.querySelector('.mapattr'))wrap.insertAdjacentHTML('beforeend','<div class="mapattr">国土地理院</div>');
    mountMapShell(wrap,ids,schedule);
    MAP_VIEWS.add(schedule);
    window.addEventListener("resize", schedule);
  }
  /// 種類を替える。選んだ種類はどの地図でも次から使う（写真で置く人は次も写真で置く）
  function setLayer(next, remember = false) {
    if (!MAP_LAYERS[next]) next = "map";
    layer = next;
    if (remember) store.set("sorami.mapLayer", next);
    view.zoom = Math.min(view.zoom, maxViewZoom());
    const wrap = cv && cv.closest(".mapwrap");
    if (wrap) for (const b of wrap.querySelectorAll("[data-layer]")) b.setAttribute("aria-checked", String(b.dataset.layer === next));
    schedule();
  }

  function open(from, zoom = 15) {
    if (!cv) attach();
    // 位置情報が許されていれば、開いたときから現在地の点を出す（地図は動かさない）。許されていなければ聞かない（現在地の釦を押したときだけ聞く）
    locateIfAllowed();
    view = { lat: from.latitude, lon: from.longitude, zoom };
    setLayer(store.get("sorami.mapLayer", "map"));
    if (ids.sheet) showSheet($(ids.sheet));
    if(['mapCanvas','shapeCanvas','targetEditorCanvas','aimLineCanvas'].includes(ids.canvas))cv.closest('.mapwrap')._mapShell?.setWide(true);
    // dialog が開いてから測る（閉じている間は幅が 0）
    requestAnimationFrame(() => { draw(); requestAnimationFrame(draw); });
  }
  return { open, attach, redraw: schedule, project, coordinateAt, onPick:fn=>{onPick=fn;},onDoubleTap:fn=>{onDoubleTap=fn;},
           center: () => ({ latitude: view.lat, longitude: view.lon }),
           zoom: () => view.zoom,
           setOverlay: (fn) => { overlay = fn; schedule(); },
           onMove: (fn) => { onChange = fn; },
           setCenter: (lat, lon) => { view.lat = lat; view.lon = lon; schedule(); },
           setView: (lat, lon, zoom) => {
             view.lat = lat; view.lon = lon;
             if (Number.isFinite(zoom)) view.zoom = Math.max(MIN_Z, Math.min(maxViewZoom(), zoom));
             schedule();
           } };
}

const MapPick = createMapView({ canvas: "mapCanvas", coord: "mapCoord", sheet: "mapSheet",
  zoomIn: "mapIn", zoomOut: "mapOut" });
