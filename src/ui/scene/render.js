async function aimLookRender(host, spec) {
  if (!host) return;
  globalThis.AstroNotesCameraUI?.invalidate(host);
  const seq = (host._lookSeq = (host._lookSeq || 0) + 1);
  const t = aim.target, body = aim.body;
  const restoredContext = JSON.stringify([aimLookKey(),spec.obs,spec.eyeM,t?.latitude,t?.longitude,t?.parts]);
  if(host._restoredPlanContext!==restoredContext)host._restoredPlanContext=null;
  const sameLookSpec = host._lookSpec === spec || host._restoredPlanContext === restoredContext;
  if (!sameLookSpec) { host._lensGesture = null; host._lookAt = null; }
  host._lookSpec = spec;
  host._planKey = null;
  const planRenderKey = aimLookKey();
  host._planObserverName = spec.observerName || spec.title || "撮影地点";
  host._uiTime = null; host._blendP = null;
  aimLookHosts.add(host);
  // 逆引き（撮れる場所を探す）は、逆引きの結果から描くときだけ続ける。日付・合わせ方・候補地を替えたら終わる
  if (!spec.pick) { host._pick = null; aimReverseClear(); }
  if (!t || !(t.parts || []).length || !spec || !Number.isFinite(spec.at)) { host.hidden = true; return; }
  host.hidden = false;
  if (!host.querySelector("canvas")) {
    host.innerHTML = `<div class="aim-look-h"><span>見え方</span></div>
      <p class="aim-look-cap"><strong data-look-title></strong><span class="sub-line" data-look-sub></span><span class="sub-line" data-look-light></span><span class="sub-line" data-look-extra></span></p>
      <div class="aim-look-figure"><canvas data-look-canvas role="img"></canvas><button type="button" data-look-pick class="aim-body-move" aria-pressed="false"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3v18M3 12h18M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/></svg></button>
      <div class="aim-body-controls" data-look-controls hidden><div class="aim-body-directions" role="group" aria-label="天体の位置を微調整"><button type="button" data-body-nudge="-1,0" aria-label="天体を左へ">←</button><button type="button" data-body-nudge="0,-1" aria-label="天体を上へ">↑</button><button type="button" data-body-nudge="0,1" aria-label="天体を下へ">↓</button><button type="button" data-body-nudge="1,0" aria-label="天体を右へ">→</button></div><span class="sr-only" role="status" aria-live="polite" data-look-position></span></div></div><div class="aim-figure-share"><button type="button" class="plan-trigger" aria-label="撮影計画を共有" title="共有" data-plan-action="share" data-plan-source="aim"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2.8v12M8.4 6.3 12 2.8l3.6 3.5M8.6 9.5H7.2A2.2 2.2 0 0 0 5 11.7v7.1A2.2 2.2 0 0 0 7.2 21h9.6a2.2 2.2 0 0 0 2.2-2.2v-7.1a2.2 2.2 0 0 0-2.2-2.2h-1.4"/></svg></button></div>
      <button type="button" data-look-confirm hidden disabled aria-hidden="true" tabindex="-1"></button><button type="button" data-look-cancel hidden aria-hidden="true" tabindex="-1"></button>
      <div class="aim-frame-info"><div class="tiny aim-frame-times" data-look-frame-times hidden></div></div>
      <div class="aim-time-controls"></div><div class="aim-lens">
        <div class="aim-lens-row"><label>焦点距離 <input type="number" min="8" max="2000" step="any" required data-lens-focal aria-label="レンズの実焦点距離（mm）"> mm</label><button type="button" class="chip" data-lens-apply>反映</button></div>
        <div class="aim-lens-row"><select data-lens-sensor aria-label="センサーサイズ"><option value="full">フルサイズ</option><option value="aps">APS-C</option><option value="canon">APS-C（Canon）</option><option value="m43">マイクロフォーサーズ</option></select><button type="button" class="chip" data-lens-portrait aria-pressed="false">縦位置</button></div>
        <div class="aim-lens-toggles"><button type="button" class="chip" data-lens-on aria-pressed="false">画角枠</button><div class="aim-grid-control"><span>グリッド</span><select data-lens-grid aria-label="構図のグリッド"><option value="none">なし</option><option value="thirds">9分割</option><option value="diagonal">9分割＋対角</option></select></div></div>
      </div>
      <div class="tiny" data-lens-info></div><p class="tiny" data-look-outside hidden></p>
      <div class="aim-look-time"><div class="aim-time-heading"><span>時刻</span><output data-look-at></output></div><input type="range" min="0" max="0" step="any" value="0" data-look-range aria-label="時刻を動かす">
        </div>
      <div class="aim-look-pick"><button type="button" class="chip" data-lens-move aria-pressed="false">構図を動かす</button><button type="button" class="chip" data-lens-center>対象を中央に</button></div>
      <p class="tiny aim-look-hint" data-look-hint hidden></p>
      <div class="aim-look-found" data-look-found hidden></div>
      <p class="tiny aim-look-note" data-look-note hidden></p>`;
  }
  if(host.id==="aimLook")host.querySelector(".aim-time-controls").append($("aimAir"));
  const cv = host.querySelector("[data-look-canvas]"), range = host.querySelector("[data-look-range]");
  const out = host.querySelector("[data-look-at]"), note = host.querySelector("[data-look-note]");
  host.querySelector("[data-look-title]").textContent = spec.title || "";
  host.querySelector("[data-look-sub]").textContent = spec.sub || "";
  for (const k of ["light", "extra"]) {
    const el = host.querySelector(`[data-look-${k}]`);
    el.textContent = spec[k] || ""; el.hidden = !spec[k];
    if (k === "light") el._moonCaption = null;
  }
  const lensOn = host.querySelector("[data-lens-on]"), lensFocal = host.querySelector("[data-lens-focal]"), lensSensor = host.querySelector("[data-lens-sensor]"), lensPortrait = host.querySelector("[data-lens-portrait]");
  lensOn.setAttribute("aria-pressed", String(aimLens.on)); lensPortrait.setAttribute("aria-pressed", String(aimLens.portrait));
  lensSensor.value = aimLens.sensor;
  const lensGrid = host.querySelector("[data-lens-grid]");
  lensGrid.value = aimLens.grid;
  const saveLens = () => { try { localStorage.setItem("sorami.lens", JSON.stringify(aimLens)); } catch {} aimLookRender(host, spec); };
  lensGrid.onchange = () => { aimLens.grid = lensGrid.value; if (aimLens.grid !== "none") aimLens.on = true; saveLens(); };
  lensOn.onclick = () => { aimLens.on = !aimLens.on; saveLens(); };
  lensPortrait.onclick = () => { aimLens.portrait = !aimLens.portrait; aimLens.on = true; saveLens(); };
  lensSensor.onchange = () => { aimLens.sensor = lensSensor.value; aimLens.on = true; saveLens(); };
  lensFocal.onchange = () => {
    if (!lensFocal.value.trim() || !lensFocal.checkValidity() || !Number.isFinite(+lensFocal.value) || +lensFocal.value < 8 || +lensFocal.value > 2000) { lensFocal.reportValidity(); return; }
    aimLens.focal = +lensFocal.value; aimLens.mode = "manual"; aimLens.on = true; saveLens();
  };
  host.querySelector("[data-lens-apply]").onclick = lensFocal.onchange;
  lensFocal.onkeydown = (event) => { if (event.key === "Enter") { event.preventDefault(); lensFocal.onchange(); } };
  const ground = spec.obs.elevation ?? 0, eye = ground + spec.eyeM;
  const eyeObs = { latitude: spec.obs.latitude, longitude: spec.obs.longitude, elevation: eye };
  const st = AstroNotesBodies.state(body, spec.at, eyeObs);
  const radius = st.angularRadius;
  const pickGeo = AstroNotesAlign.geometryFrom(spec.obs,t,{eyeM:spec.eyeM,partId:host.id==="aimLook"?aim.partId:null});
  const D = AstroNotesTerrain.distanceKm(spec.obs.latitude, spec.obs.longitude, t.latitude, t.longitude);
  const az = AstroNotesTerrain.bearing(spec.obs.latitude, spec.obs.longitude, t.latitude, t.longitude);
  const outline = aimIsMountain(t) ? null : AstroNotesAlign.towerOutline(spec.obs, t, { eyeM: spec.eyeM });
  const mountain = !outline;
  const topAngle = outline ? outline.topAngle : aimAirAngle(D, eye, t.parts[0].m);
  const baseAngle = outline ? outline.baseAngle : topAngle - 5 * Math.max(radius, 0.27);
  // 図の下の端。ティンカーベルはホテル全体でなくドームと像のまわり
  const viewBase = outline ? outline.viewBaseAngle : baseAngle;
  const W = Math.max(200, Math.round(cv.clientWidth || host.clientWidth || 320));
  host._lookW = W;
  // 塔は縦長の図、山は横長の図（2026-10-03 ユーザー「もう少し拡大した図にして欲しい」。塔は横幅より高さが要る）
  // 全画面のときは下の日時の欄の上までを使う（2026-10-20 試用版）
  const H = host._full && host._fullH ? Math.round(host._fullH) : Math.round(Math.min(W >= 640 ? 620 : 440, W * (mountain ? 0.66 : 0.9)));
  const win = AstroNotesAlign.viewWindow({ azimuth: az, baseAngle: viewBase, topAngle, radiusDeg: radius, aspect: W / H,
    include: st.apparentAltitude >= 0 && Math.abs(st.apparentAltitude - topAngle) <= Math.max(topAngle - viewBase, 5 * radius) ? [st.apparentAltitude] : [] });
  const sensor = AIM_SENSOR[aimLens.sensor];
  const sw = aimLens.portrait ? sensor[1] : sensor[0], sh = aimLens.portrait ? sensor[0] : sensor[1];
  // 従来の図の範囲を保ち、その中に余白12%で収まる枠の実焦点距離を逆算する。
  const autoFocal = Math.max(sh / (2 * win.halfH * Math.PI / 180), sw / (2 * win.halfW * Math.PI / 180)) * 1.12;
  const focal = aimLens.mode === "auto" ? autoFocal : aimLens.focal;
  lensFocal.value = String(Math.round(focal * 10) / 10);
  lensFocal.step = "any";
  const frame = aimLens.on ? AstroNotesAlign.cameraFrame(focal, ...sensor, aimLens.portrait) : null;
  if (aimLens.mode === "manual") {
    const viewFrame = frame || AstroNotesAlign.cameraFrame(focal, ...sensor, aimLens.portrait);
    win.halfH = Math.max(viewFrame.halfH, viewFrame.halfW / (W / H)) * 1.12;
    win.halfW = win.halfH * W / H;
  }
  host.querySelector("[data-lens-info]").textContent = `${aimLens.mode === "auto" ? "約" : ""}${(Math.round(focal * 10) / 10)}mm${frame ? ` ・ 画角 ${frame.horizontalDeg.toFixed(1)}° × ${frame.verticalDeg.toFixed(1)}°` : "（画角枠なし）"}（歪曲なしの目安）`;
  const proj = AstroNotesAlign.viewProjector(win.az0, win.alt0);
  const comparison=aimAirCompare&&aimAirCompare.day===S.JstCal.startOfDay(spec.at)&&aimAirCompare.latitude===spec.obs.latitude&&aimAirCompare.longitude===spec.obs.longitude?aimAirCompare.at:null;
  const pendingPlan = host.id === "aimLook" ? aim.pendingPlan : null;
  if (pendingPlan) { host._timelapseConfig=pendingPlan.timelapse?{...pendingPlan.timelapse}:null; host._restoredPlanContext=restoredContext; host._lensOffset = [...pendingPlan.pan]; aim.pendingPlan = null; }
  const transfer=host.id==='aimLook'?aim.plannerTransfer:null;
  const plannerAt=transfer&&transfer.body===body&&transfer.day===S.JstCal.startOfDay(spec.at)&&transfer.latitude===spec.obs.latitude&&transfer.longitude===spec.obs.longitude?transfer.at:null;
  if(transfer&&(!Number.isFinite(plannerAt)))aim.plannerTransfer=null;
  const selectedAt = Number.isFinite(plannerAt)?plannerAt:pendingPlan ? pendingPlan.at : Number.isFinite(comparison)?comparison:sameLookSpec && Number.isFinite(host._lookAt) ? host._lookAt : spec.at;
  const path = AstroNotesAlign.viewPath(body, eyeObs, spec.at, proj, win, { includeAt: selectedAt, dayMs: S.JstCal.startOfDay(spec.at) });
  const frameDay = S.JstCal.startOfDay(spec.at);
  // 2026-10-20 ユーザー「日付を跨ぐ際に線が途切れる問題に対処して」：画角内の時刻は前日18時〜翌日6時で求め、図の線は前日の終わりと翌日のはじめ（3時間）をつなげて描く。時刻のバーは当日のまま
  const framePoints = frame ? AstroNotesAlign.frameDayPath(body, eyeObs, frameDay, proj, { startMs: frameDay - 6 * 3600000, endMs: frameDay + 30 * 3600000 }) : null;
  const pathEdge = (at, keep) => { try { return AstroNotesAlign.viewPath(body, eyeObs, at, proj, win, { stepS: 60, maxMin: 180 }).filter(keep); } catch { return []; } };
  const pathBefore = pathEdge(frameDay, (q) => q.at < frameDay), pathAfter = pathEdge(frameDay + 86400000, (q) => q.at >= frameDay + 86400000);
  // 1日の中には前の晩と次の晩の通り道が両方入ることがある。地平線より上にいる間ごとに1本の通り道として区切り、
  // 描くのは見ている時刻を含む1本だけ（日付をまたいで端から端まで）。時刻のバーで別の晩へ動かせば、その晩の線に替わる
  const fullPath = [...pathBefore, ...path, ...pathAfter];
  const pathRuns = [];
  for (let i = 0, start = -1; i <= fullPath.length; i++) {
    const up = i < fullPath.length && Number.isFinite(fullPath[i].altitude) && fullPath[i].altitude > -1;
    if (up && start < 0) start = i;
    if (!up && start >= 0) { pathRuns.push([start, i - 1]); start = -1; }
  }
  const runAt = (t) => { let best = null, gap = Infinity; for (const r of pathRuns) { const a = fullPath[r[0]].at, b = fullPath[r[1]].at, d = t < a ? a - t : t > b ? t - b : 0; if (d < gap) { gap = d; best = r; } } return best; };
  let frameTimesKey = null;
  const i0 = path.reduce((best, p, i) => Math.abs(p.at - selectedAt) < Math.abs(path[best].at - selectedAt) ? i : best, 0);
  const k = (H / 2) / win.halfH;
  const toPx = (xy) => (xy ? [W / 2 + xy[0] * k, H / 2 - xy[1] * k] : null);
  const scene = AstroNotesAlign.sceneTargets(spec.obs, [t, ...aimTargetList()], { eyeM: spec.eyeM });
  const sceneCenters = scene.map(item => proj(item.azimuth, item.topAngle)).filter(p => p && Math.abs(p[0]) < 330);
  const panLimit = Math.max(1, ...sceneCenters.map(p => Math.abs(p[0]) / (2 * win.halfW) + .5));
  let sceneVersion=0;
  let shape = null, ridgePending = null, front = null;
  const frontPending = outline ? aimTerrainFront(spec.obs, eye, t) : null;
  if (outline) shape = outline.points.map(([a, h]) => toPx(proj(a, h))).filter(Boolean);
  else {
    // 稜線を待つ間も新しい目標の図を先に描く。前の建物や時刻を残さない。
    ridgePending = aimLookRidge(spec.obs, eye, t, { ...win, panLimit });
  }
  for (const item of scene) {
    if (item.outline?.polygons) item.polygons=item.outline.polygons.map(poly=>poly.map(([a,h])=>toPx(proj(a,h))).filter(Boolean)).filter(poly=>poly.length>=3&&poly.every(p=>p.every(Number.isFinite)));
    item.basePoints=(item.outline?.basePoints||[]).map(([a,h])=>toPx(proj(a,h))).filter(Boolean);
    if (item.target.id === t.id) continue;
    if (item.outline) item.shape = item.outline.points.map(([a, h]) => toPx(proj(a, h))).filter(Boolean);
    else {
      const center = proj(item.azimuth, item.topAngle);
      // 背面の山は描かない。地形取得は山自身の方位・距離で行う。
      if (!center) continue;
      const rw = { ...win, az0: item.azimuth, panLimit };
      aimLookRidge(spec.obs, eye, item.target, rw).then(ridge => {
        if (seq !== host._lookSeq) return;
        sceneVersion++;
        item.shape = ridge ? ridge.map(([a, h]) => toPx(proj(a, h))).filter(Boolean) : null;
        item.failed = !ridge;
        const missing = scene.filter(x => x.failed).map(x => `${x.target.name}の稜線を読み込めませんでした`);
        note.textContent = [note.dataset.primary || "", note.dataset.terrain || "", ...missing].filter(Boolean).join(" / "); note.hidden = !note.textContent;
        draw(cur);
      });
    }
  }
  const part = AstroNotesAlign.partOf(t, aim.partId);
  const top = (t.parts || [])[0];
  const partY = !mountain && part && top && part.m < top.m - 0.5
    ? toPx(proj(az, aimAirAngle(D, eye, part.m)))[1] : null;
  const baseY = toPx(proj(az, baseAngle))[1];
  const hiddenY = outline && outline.hiddenAngle !== null ? toPx(proj(az, outline.hiddenAngle))[1] : null;
  // 山は仮の表示下端でなく水平0度、建物は地上の基準へ吸着する。
  const groundEdge = mountain ? toPx(proj(az, 0))[1] : (hiddenY !== null ? Math.min(hiddenY, baseY) : baseY);
  // 時刻の目盛り。道のりの長さに合わせて1〜60分ごとに、多くても10個
  const span = (path[path.length - 1].at - path[0].at) / 60000;
  const every = [1, 2, 5, 10, 15, 30, 60].find((m) => span / m <= 10) || 60;
  const ticks = [];
  for (let m = Math.ceil(fullPath[0].at / (every * 60000)) * every * 60000; m <= fullPath[fullPath.length - 1].at; m += every * 60000) {
    const s = AstroNotesBodies.state(body, m, eyeObs);
    const p = toPx(proj(s.azimuth, s.apparentAltitude));
    if (p) ticks.push([p[0], p[1], m]);
  }
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr);
  cv.style.height = `${H}px`;
  const displayCtx = cv.getContext("2d");
  const makeLayer=()=>{const canvas=document.createElement('canvas');canvas.width=cv.width;canvas.height=cv.height;return {canvas,ctx:canvas.getContext('2d')};};
  const oldSky=host._lookLayers?.sky;
  const keepSky=oldSky&&oldSky.width===cv.width&&oldSky.height===cv.height;
  const skyLayer=keepSky?{canvas:oldSky,ctx:oldSky.getContext('2d')}:makeLayer(),bodyLayer=makeLayer(),buildingLayer=makeLayer();
  const layerStats={frames:0,sky:0,body:0,buildings:0,ms:0};
  host._lookLayers={sky:skyLayer.canvas,body:bodyLayer.canvas,buildings:buildingLayer.canvas,stats:layerStats};
  let ctx=displayCtx,skyKey=keepSky?host._lookSkyKey:null,buildingCache=null;
  const resetLayer=(context,canvas)=>{if(typeof context.reset==='function')context.reset();else canvas.width=canvas.width;context.setTransform(dpr,0,0,dpr,0,0);};
  const clipWorld=(context,panX,panY,bottom)=>{context.save();context.translate(panX,panY);context.beginPath();context.rect(-panX,-panY,W,bottom);context.clip();};
  // 図の下の説明（形の出どころ・大気の屈折・縮尺）は出さない（2026-10-03 ユーザー「この説明文いらないわ」「いらない説明文結構ない？」）。
  // 出すのは稜線を読めなかったときだけ
  note.textContent = ridgePending ? "稜線を読み込んでいます…" : "";
  note.dataset.primary = note.textContent; note.dataset.terrain = "";
  note.hidden = !note.textContent;
  range.max = String(path.length - 1);
  const pack = (ms, st) => {
    const xy = proj(st.azimuth, st.apparentAltitude);
    return { at: ms, azimuth: st.azimuth, altitude: st.apparentAltitude, radius: st.angularRadius, upperRadius: st.upperRadius, lowerRadius: st.lowerRadius,
      illuminated: body === 'moon' ? st.illuminatedFraction : null,
      brightLimbZenithAngle: body === 'moon' ? st.brightLimbZenithAngle : null,
      x: xy ? xy[0] : null, y: xy ? xy[1] : null };
  };
  const at = v => {
    const i = Math.max(0, Math.min(path.length - 2, Math.floor(v))), j = i + 1, f = v-i;
    const ms = path[i].at + (path[j].at - path[i].at) * f;
    return pack(ms, AstroNotesBodies.state(body, ms, eyeObs));
  };
  const draw = (v, exactAt = null) => {
    const started=typeof performance==='undefined'?Date.now():performance.now();
    const p = host._blendP || (Number.isFinite(exactAt) ? pack(exactAt, AstroNotesBodies.state(body, exactAt, eyeObs)) : at(v));
    host._lookAt = p.at;
    globalThis.TrialExplore?.sceneDraw(host,p.at);
    // 引き継ぐ時刻を書き戻すのは、その時刻で描いたこの図だけ（2026-10-21 ユーザー「月の軌道がズレるようになった」：
    // 置いた位置の点線円のための再描画（aimShiftSync）が前の日の図を描き直し、押した候補日の時刻を前の時刻で上書きしていた）
    if(host.id==='aimLook'&&transfer&&aim.plannerTransfer===transfer)transfer.at=p.at;
    host._planKey = planRenderKey;
    if(host.id==='aimLook'){
      aim.mapTime={at:p.at,day:S.JstCal.startOfDay(p.at),body,target:t.id};
      if(!host._mapTimeFrame)host._mapTimeFrame=requestAnimationFrame(()=>{host._mapTimeFrame=null;AimMap.redraw();});
    }
    // 比べる時刻も、同じ日・同じ地点の図だけが書き戻す（別の日の図の時刻を持ち帰らない）
    if(aimAirCompare&&aimAirCompare.day===S.JstCal.startOfDay(spec.at)&&aimAirCompare.latitude===spec.obs.latitude&&aimAirCompare.longitude===spec.obs.longitude)aimAirCompare.at=p.at;
    aimAirDescribe(p.at,eyeObs);
    if (host._uiTime) {
      host._uiTime.current = p.at;
      if (S.JstCal.startOfDay(p.at)===host._uiTime.day && (p.at < host._uiTime.day + +range.min*1000 || p.at > host._uiTime.day + +range.max*1000)) { host._uiAllDay = true; host._uiTime.window(); }
      range.value = String((p.at-host._uiTime.day)/1000); range.setAttribute('aria-valuetext', aimLookHMS(p.at));
      const input = document.getElementById('previewTime');
      if (input && document.activeElement !== input) input.value = S.JstCal.hhmm(p.at).padStart(5,'0');
    }
    const sunAlt = AstroNotesAstro.sun(p.at, eyeObs).apparentAltitude;
    // Captions follow the displayed time; rise/set summaries run once after scrubbing settles.
    if(host.id==='aimLook'){
      const light=host.querySelector('[data-look-light]');
      const moonPrefix=body==='moon'?`${moonGlyphAt(p.at, eyeObs)} 輝面 ${Math.round((p.illuminated??0)*100)}%`:'';
      const sky=AstroNotesBodies.sky(AstroNotesAstro.sun(p.at,eyeObs).geometricAltitude);
      const msg=body==='moon'?[moonPrefix,sky].join(' ・ '):!AstroNotesBodies.definition(body).limbs?sky:'';
      // 2026-10-14 ユーザー「見え方の図が動いてズレるのが気に食わない」。月の説明を動かしている間だけ短い文へ替えると
      // 行数が変わり、下の図が上下していた。月も常に出入りまでの文で出し、計算は120msに1回へ間引く。
      // 同じ天体・目標・幅のあいだは説明の高さを縮めない（文の長さで図が上がらないように）
      const hold=()=>{const cap=light?.parentElement;if(!cap)return;const key=`${body}|${t.id}|${cv.clientWidth}`;if(host._capKey!==key){host._capKey=key;host._capMin=0;cap.style.minHeight='';}const h=cap.offsetHeight;if(h>host._capMin){host._capMin=h;cap.style.minHeight=h+'px';}};
      if(light&&body!=='moon'){if(light.textContent!==msg)light.textContent=msg;light.hidden=!msg;hold();}
      if(light&&body==='moon'){
        host._captionNext={at:p.at,prefix:moonPrefix};
        const write=()=>{host._captionTimer=0;const c=host._captionNext;if(host._lookSeq!==seq||!c)return;host._captionDone=Date.now();const text=[c.prefix,esc(lightTimingText(c.at,eyeObs))].filter(Boolean).join(' ・ ');if(light._moonCaption!==text){light._moonCaption=text;light.innerHTML=text;}light.hidden=!text;hold();};
        if(!host._captionTimer){const wait=120-(Date.now()-(host._captionDone||0));if(wait<=0)write();else host._captionTimer=setTimeout(write,wait);}
      }
    }

    const [skyTop, skyLow] = aimLookSky(sunAlt);
    const bright = (skyTop[0] * 0.3 + skyTop[1] * 0.59 + skyTop[2] * 0.11) > 120;
    const ink = bright ? "rgba(20,30,50,0.78)" : "rgba(255,255,255,0.82)";
    const nextSkyKey=skyTop.join(',')+'|'+skyLow.join(',');
    if(skyKey!==nextSkyKey){
      ctx=skyLayer.ctx;resetLayer(ctx,skyLayer.canvas);
      const g=ctx.createLinearGradient(0,0,0,H);g.addColorStop(0,`rgb(${skyTop})`);g.addColorStop(1,`rgb(${skyLow})`);
      ctx.fillStyle=g;ctx.fillRect(0,0,W,H);skyKey=host._lookSkyKey=nextSkyKey;layerStats.sky++;
    }
    const pan = host._lensOffset || [0, 0], panX = pan[0] * W, panY = pan[1] * H;
    const times = host.querySelector("[data-look-frame-times]");
    times.hidden = !frame;
    if(!frame&&host._uiTime)host._uiTime.frameSpans=[];
    const timesKey = `${panX},${panY}`;
    if(frame && timesKey!==frameTimesKey){
      frameTimesKey=timesKey;
      const dayEnd=frameDay+86400000,spans=AstroNotesAlign.framePassages(framePoints,frame,{x:panX/k,y:-panY/k}).filter(row=>row.end>=frameDay&&row.start<dayEnd);
      if(host._uiTime){host._uiTime.frameSpans=spans;host._uiTime.window();}
      const when=ms=>`${ms<frameDay?'前日 ':ms>=dayEnd?'翌日 ':''}${aimLookHMS(ms)}`;
      times.textContent=spans.length?'画角内（天体の一部が入る目安）：'+spans.map(row=>`${row.openStart?when(row.start)+'時点で枠内':when(row.start)+'に入る'}〜${row.openEnd?when(row.end)+'まで枠内':when(row.end)+'に外れる'}`).join(' / '):'画角内：この日は入りません';
    }

    // 地下を無限に補完しない。山の稜線自体は切らず、その下に小さい余白だけを残す。
    const ridgeBottom = mountain && shape?.length ? Math.max(...shape.map(p => p[1])) : groundEdge;
    const sceneBottom = Math.max(groundEdge, ridgeBottom) + Math.max(12, Math.min(24, H * 0.04));
    const clipBottom = Math.max(0, Math.min(H, sceneBottom + panY));
    host._lookSceneBottom = clipBottom;
    ctx=bodyLayer.ctx;resetLayer(ctx,bodyLayer.canvas);layerStats.body++;
    clipWorld(ctx,panX,panY,clipBottom);
    // 道と時刻の目盛り
    ctx.strokeStyle = ink; ctx.globalAlpha = 0.55; ctx.lineWidth = 1.5; ctx.setLineDash([]);
    ctx.beginPath();
    let pen = false;
    const run = runAt(p.at), runFrom = run ? fullPath[run[0]].at : -Infinity, runTo = run ? fullPath[run[1]].at : Infinity;
    for (const q of run ? fullPath.slice(run[0], run[1] + 1) : path) {
      const xy = toPx(q.x === null ? null : [q.x, q.y]);
      if (!xy) { pen = false; continue; }
      if (pen) ctx.lineTo(xy[0], xy[1]); else ctx.moveTo(xy[0], xy[1]);
      pen = true;
    }
    ctx.stroke();
    ctx.fillStyle = ink;
    for (const [x, y, t] of ticks) { if (t < runFrom || t > runTo) continue; ctx.beginPath(); ctx.arc(x, y, 2.2, 0, Math.PI * 2); ctx.fill(); }
    ctx.globalAlpha = 1;
    const rPx = Math.max(1.5, p.radius * k);
    // 移動中は元の円盤を置き換える。操作位置は画面座標なので構図の移動分を戻す。
    const movedBody = host._pick?.ghost;
    const c = movedBody ? [movedBody[0] - panX, movedBody[1] - panY] : p.x === null ? null : toPx([p.x, p.y]);
    // 円盤は形の後ろ（形で隠れる）。隠れた所も点線の輪で分かるようにする
    const upperPx=Math.max(1,(p.upperRadius??p.radius)*k),lowerPx=Math.max(1,(p.lowerRadius??p.radius)*k),diskY=(upperPx+lowerPx)/(2*rPx),diskCenter=c?c[1]+(lowerPx-upperPx)/2:0;
    globalThis.AstroNotesCameraUI?.drawRange?.(host,ctx,{at:p.at,seq,k,toPx,pack:ms=>pack(ms,AstroNotesBodies.state(body,ms,eyeObs)),disc:(x,y,r,state)=>aimLookDisc(ctx,x,y,r,body,state)});
    if (c){ctx.save();ctx.translate(c[0],diskCenter);ctx.scale(1,diskY);aimLookDisc(ctx,0,0,rPx,body,p);ctx.restore();}
    host._bodyRadius = p.radius;
    host._placeXY = null;
    ctx.restore(); // End the independently updated body layer.
    const nextBuildingKey=[panX,panY,clipBottom,sceneVersion].join(',');
    if(!buildingCache||buildingCache.key!==nextBuildingKey){
      ctx=buildingLayer.ctx;resetLayer(ctx,buildingLayer.canvas);
      if(clipBottom<H){ctx.fillStyle='#252a33';ctx.fillRect(0,clipBottom,W,H-clipBottom);}
      clipWorld(ctx,panX,panY,clipBottom);
    // 形は空より暗く塗り、暗い空では縁を明るい線でなぞる（ユーザー「シルエットが背景と色が被って見えづらくなってる」。夜空と同じ紺だった）
    ctx.fillStyle = "#020306";
    const rim = "rgba(200,212,240,0.28)";
    const groundY = groundEdge;
    const visibleTargets = [];
    for (const item of scene) {
      const selected = item.target.id === t.id, points = selected ? shape : item.shape;
      if (!points || points.length < 2) continue;
      const isMountain = !item.outline;
      // Dense meshes can exceed the JavaScript argument limit; scan bounds without spreading vertices.
      let minX=Infinity,maxX=-Infinity;
      for(const point of points){minX=Math.min(minX,point[0]);maxX=Math.max(maxX,point[0]);}
      minX+=panX;maxX+=panX;
      if (!selected && (maxX < 0 || minX > W)) continue;
      ctx.fillStyle = "#020306";
      if(item.polygons?.length){
        // 形は時刻/天体と独立。再生・ドラッグのたびに穴埋めを再計算しない。
        let mask=item.solidSilhouette;
        if(!mask||mask.source!==item.polygons){mask=aimLookSolidSilhouette(item.polygons,{closeBase:item.target.id==="skytree",basePoints:item.basePoints});if(!mask)continue;mask.source=item.polygons;item.solidSilhouette=mask;}
        ctx.save();
        // マスクに色を付けた別バッファを使い、空や月をsource-inで消さない。
        if(mask.ink!==ctx.fillStyle){const tinted=document.createElement('canvas');tinted.width=mask.canvas.width;tinted.height=mask.canvas.height;const c=tinted.getContext('2d');c.drawImage(mask.canvas,0,0);c.globalCompositeOperation='source-in';c.fillStyle=ctx.fillStyle;c.fillRect(0,0,tinted.width,tinted.height);mask.tinted=tinted;mask.ink=ctx.fillStyle;}
        // Outline the filled union, never individual model edges or internal mesh lines.
        if(!mask.rimCanvas){const edge=document.createElement('canvas');edge.width=mask.canvas.width;edge.height=mask.canvas.height;const c=edge.getContext('2d');c.drawImage(mask.canvas,0,0);c.globalCompositeOperation='source-in';c.fillStyle=rim;c.fillRect(0,0,edge.width,edge.height);mask.rimCanvas=edge;}
        for(const [dx,dy] of [[-.6,0],[.6,0],[0,-.6],[0,.6]])ctx.drawImage(mask.rimCanvas,mask.x+dx,mask.y+dy,mask.width,mask.height);
        ctx.drawImage(mask.tinted,mask.x,mask.y,mask.width,mask.height);ctx.restore();
        // 2026-10-20 選んでいない建物は、足元から地上の線まで下ろす（ユーザー「シルエットが浮いてたりして見栄えが悪い」）。
        // 地上の線は選んだ目標の足元なので、それより近い建物の足元は線より上に来る。実際は手前の街並みに隠れる所
        if(!selected){
          let bottom=-Infinity;for(const poly of item.polygons)for(const q of poly)if(q[1]>bottom)bottom=q[1];
          if(bottom<groundY-0.5){
            let l=Infinity,r=-Infinity;for(const poly of item.polygons)for(const q of poly)if(q[1]>=bottom-1.5){l=Math.min(l,q[0]);r=Math.max(r,q[0]);}
            if(r>l){ctx.fillRect(l,bottom-0.5,r-l,groundY-bottom+0.5);ctx.strokeStyle=rim;ctx.lineWidth=1;ctx.beginPath();ctx.moveTo(l,bottom);ctx.lineTo(l,groundY);ctx.moveTo(r,bottom);ctx.lineTo(r,groundY);ctx.stroke();}
          }
        }
      } else {
      ctx.beginPath();
      if (isMountain) ctx.moveTo(points[0][0], sceneBottom);
      else ctx.moveTo(points[0][0], points[0][1]);
      for (const [x, y] of points) ctx.lineTo(x, y);
      if (isMountain) ctx.lineTo(points[points.length - 1][0], sceneBottom);
      ctx.closePath(); ctx.fill();
      if (rim) {
        ctx.strokeStyle = rim; ctx.lineWidth = selected ? 1.2 : 1; ctx.lineJoin = "round";
        ctx.beginPath(); ctx.moveTo(points[0][0], points[0][1]);
        for (const [x, y] of points) ctx.lineTo(x, y);
        ctx.stroke();
      }
      }
      if (selected && !mountain) {
        ctx.fillStyle = "#020306";
        ctx.fillRect(-panX, groundY, W, Math.max(0, sceneBottom - groundY));
        if (rim) { ctx.strokeStyle = rim; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(-panX, groundY); ctx.lineTo(W - panX, groundY); ctx.stroke(); }
      }
      const anchor = toPx(proj(item.azimuth, item.topAngle));
      if (anchor && !(item.distanceKm > D && !mountain && anchor[1] >= groundY) && anchor[0] + panX >= 0 && anchor[0] + panX <= W && anchor[1] + panY >= 0 && anchor[1] + panY <= clipBottom)
        visibleTargets.push({ item, anchor });
    }
    // 手前の地形（塔・建物のとき）。目標より手前にあるので、建物の上に重ねて描く。地上の線より上に出る所があるときだけ
    if (front?.length >= 2 && front.some((q) => q[1] < groundY - 0.5)) {
      ctx.fillStyle = "#020306";
      ctx.beginPath(); ctx.moveTo(front[0][0], sceneBottom);
      for (const [x, y] of front) ctx.lineTo(x, Math.min(y, sceneBottom));
      ctx.lineTo(front[front.length - 1][0], sceneBottom); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = rim; ctx.lineWidth = 1; ctx.lineJoin = "round";
      ctx.beginPath(); front.forEach(([x, y], i) => i ? ctx.lineTo(x, Math.min(y, sceneBottom)) : ctx.moveTo(x, Math.min(y, sceneBottom))); ctx.stroke();
    }
    // 地上と余白の境界を昼夜とも見分けられるようにする。
    let groundText = null;
    if (groundY + panY >= 12 && groundY + panY <= H - 4) {
      ctx.strokeStyle = "#b8c8dd"; ctx.lineWidth = 1.5;
      ctx.setLineDash(mountain ? [5, 4] : []);
      ctx.beginPath(); ctx.moveTo(-panX, groundY); ctx.lineTo(W - panX, groundY); ctx.stroke(); ctx.setLineDash([]);
      groundText = { str: mountain ? "水平（0°）" : "地上", y: groundY - 4 + panY };
    }
    // 図中に目標名は重ねない。visibleTargetsは読み上げに使用する。
      ctx.restore();buildingCache={key:nextBuildingKey,visibleTargets,groundText};layerStats.buildings++;
    }
    const {visibleTargets,groundText}=buildingCache;
    ctx=displayCtx;resetLayer(ctx,cv);
    ctx.drawImage(skyLayer.canvas,0,0,W,H);ctx.drawImage(bodyLayer.canvas,0,0,W,H);ctx.drawImage(buildingLayer.canvas,0,0,W,H);
    clipWorld(ctx,panX,panY,clipBottom);
    // 円盤の縁にはガイドを重ねず、天体と地形の自然な輪郭を表示する。
    // 字は空にも形にも重なるので、縁取りして読めるようにする
    const halo = bright ? "rgba(255,255,255,0.75)" : "rgba(0,0,0,0.6)";
    const text = (str, x, y, align) => {
      const width = ctx.measureText(str).width;
      x = align === "right" ? Math.max(width + 6 - panX, Math.min(W - 6 - panX, x)) : Math.max(6 - panX, Math.min(W - width - 6 - panX, x));
      y = Math.max(10 - panY, Math.min(H - 10 - panY, y));
      ctx.textAlign = align; ctx.textBaseline = "middle"; ctx.lineJoin = "round";
      ctx.strokeStyle = halo; ctx.lineWidth = 3; ctx.strokeText(str, x, y);
      ctx.fillStyle = ink; ctx.fillText(str, x, y);
    };
    // 時刻は図の下のoutputだけに表示し、画面外の天体で文字が見切れるのを防ぐ。
    const right = c ? c[0] > W / 2 : true;
    // 展望台などに重ねるときは、その高さに印。名前は時刻の字と反対の側に
    if (partY !== null && partY + panY >= 10 && partY + panY <= H - 10 && shape) {
      const near = shape.filter(([, y]) => Math.abs(y - partY) < 6);
      const half = near.length ? Math.max(...near.map(([x]) => Math.abs(x - W / 2))) : 8;
      ctx.strokeStyle = ink; ctx.lineWidth = 1.2; ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.moveTo(W / 2 - half - 6, partY); ctx.lineTo(W / 2 + half + 6, partY); ctx.stroke(); ctx.setLineDash([]);
      ctx.font = `600 ${Math.max(11, Math.min(16, W / 40))}px system-ui, sans-serif`;
      const room = ctx.measureText(part.name).width + 6;
      if (right && W / 2 - half - 10 > room) text(part.name, W / 2 - half - 10, partY, "right");
      else text(part.name, Math.min(W - room, W / 2 + half + 10), partY, "left");
    }
    ctx.restore(); // ここからの円盤操作・画角枠は画面の座標。枠は中央固定。
    if (frame) {
      const fw = frame.halfW * 2 * k, fh = frame.halfH * 2 * k;
      ctx.setLineDash([]); ctx.strokeStyle = "#000"; ctx.lineWidth = 4;
      const fx = (W - fw) / 2, fy = (H - fh) / 2;
      ctx.strokeRect(fx, fy, fw, fh);
      aimDrawGrid(ctx, fx, fy, fw, fh, aimLens.grid);
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(fx, fy, fw, fh);
    }
    // 地上の字は画角枠より後に描く。先に描くと枠の縦線が字を横切った（2026-10-05 総点検、200mmで「水平（0°）」の「平」が欠けた）
    if (groundText) {
      ctx.font = `600 ${Math.max(11, Math.min(16, W / 40))}px system-ui, sans-serif`; ctx.textAlign = "left"; ctx.textBaseline = "bottom"; ctx.lineJoin = "round";
      ctx.lineWidth = 3; ctx.strokeStyle = "rgba(0,0,0,0.65)"; ctx.strokeText(groundText.str, 8, groundText.y);
      ctx.fillStyle = "#fff"; ctx.fillText(groundText.str, 8, groundText.y);
    }
    const outside = host.querySelector("[data-look-outside]");
    outside.hidden = !!c && c[0] + panX >= 0 && c[0] + panX <= W && c[1] + panY >= 0 && c[1] + panY <= clipBottom;
    outside.textContent = outside.hidden ? "" : `${AstroNotesBodies.definition(body).name}は図の外です。時刻を動かすと通り方を確認できます`;
    cur = v;
    out.innerHTML = `${S.JstCal.sameDay(p.at,spec.at) ? "" : p.at < spec.at ? "前日 " : "翌日 "}${aimLookHMS(p.at)}<span class="sub-line">${esc(aimLookRel(p.at - spec.at, spec.atName))}</span>`;
    cv.setAttribute("aria-label", `${spec.title || "ここから"}見た${visibleTargets.map(x => x.item.target.name).join("、") || t.name}と${AstroNotesBodies.definition(body).name}の動き。`
      + `${aimLookHMS(spec.at)}に${spec.atName || "重なる"}。いまの図は${aimLookHMS(p.at)}`);
    layerStats.frames++;layerStats.ms+=(typeof performance==='undefined'?Date.now():performance.now())-started;
  };
  let cur = i0;
  range.value = String(i0);
  // 描き直しは画面の更新1回につき1度にまとめる（指で速く動かすと input が描くより速く来る）
  let pending = null;
  range.oninput = () => {
    const first = pending === null;
    pending = Number(range.value);
    if (first) requestAnimationFrame(() => { const v = pending; pending = null; if (host._lookSeq === seq) draw(v); });
  };
  // UIの時間軸だけを変える。位置は既存の天体計算で、その時刻を直接評価する。
  const timeIndex = ms => {
    if(ms < path[0].at)return (ms-path[0].at)/(path[1].at-path[0].at);
    if(ms > path[path.length-1].at)return path.length-1+(ms-path[path.length-1].at)/(path[path.length-1].at-path[path.length-2].at);
    let lo = 0, hi = path.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (path[mid].at <= ms) lo = mid; else hi = mid; }
    return lo + (ms - path[lo].at) / Math.max(1, path[hi].at - path[lo].at);
  };
  const uiDay = S.JstCal.startOfDay(spec.at), uiEnd = uiDay + 86400000 - 1;
  const uiState = host._uiTime = {
    day: uiDay, reference: spec.at, name: spec.atName || '重なる', current: selectedAt,
    set(ms) { if (host._lookSeq !== seq || !Number.isFinite(ms)) return; host._blendP = null; draw(timeIndex(ms), ms); },
    blend(b) {
      if (host._lookSeq !== seq) return;
      if (!b) { if (!host._blendP) return; host._blendP = null; draw(timeIndex(this.current), this.current); return; }
      const near = b.f < 0.5 ? b.from : b.to;
      host._blendP = pack(near, blendBodyState(AstroNotesBodies.state(body, b.from, eyeObs), AstroNotesBodies.state(body, b.to, eyeObs), b.f));
      draw(timeIndex(near));
    },
    window(includeAt=null) {
      const center=spec.at;
      const all = host._uiAllDay;
      const a = AstroNotesBodies.state(body, center - 1000, eyeObs), b = AstroNotesBodies.state(body, center + 1000, eyeObs);
      const pa = proj(a.azimuth, a.apparentAltitude), pb = proj(b.azimuth, b.apparentAltitude);
      const speed = pa && pb ? Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) / 2 : 0;
      // 一往復は図の幅程度。望遠ほど時間幅を小さくし、速すぎる移動を避ける。
      let halfMs = this.frameSpans?.length ? Math.max(30000,...this.frameSpans.flatMap(s=>[Math.abs(s.start-center),Math.abs(s.end-center)])) : Math.max(30000, Math.min(1800000, speed > 0 ? Math.min(win.halfW, win.halfH) / speed * 1000 : 300000));
      halfMs=Math.max(halfMs,Math.abs((host._lookAt ?? selectedAt)-center),Number.isFinite(includeAt)?Math.abs(includeAt-center):0);
      range.min = String(((all ? uiDay : center - halfMs)-uiDay)/1000);
      range.max = String(((all ? uiEnd : center + halfMs)-uiDay)/1000);
      range.step = 'any'; range.value = String(Math.max(+range.min, Math.min(+range.max, ((host._lookAt ?? selectedAt)-uiDay)/1000)));
      this.minSeconds=Number(range.min);this.maxSeconds=Number(range.max);
      range.setAttribute('aria-label', all ? '一日の時刻を動かす' : '時刻を細かく調整');
      range.setAttribute('aria-valuetext', aimLookHMS(host._lookAt ?? selectedAt));
    }
  };
  uiState.window();
  let uiPending = null;
  range.oninput = () => {
    const first = uiPending === null; uiPending = uiDay + Number(range.value)*1000;
    if (first) requestAnimationFrame(() => { const ms = uiPending; uiPending = null; if (host._lookSeq === seq && ms !== null) uiState.set(ms); });
  };
  range.onchange = () => { const ms = uiDay + Number(range.value)*1000; uiPending = null; uiState.set(ms);  };
  range.onkeydown = e => {
    if (!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)) return;
    e.preventDefault(); const delta = (e.shiftKey ? 10000 : 1000) * (['ArrowLeft','ArrowDown'].includes(e.key) ? -1 : 1);
    uiState.set(Math.max(uiDay + +range.min*1000, Math.min(uiDay + +range.max*1000, host._lookAt + delta)));
  };
  // 道をさわって時刻を選ぶ（いちばん近い点。36px より遠ければ何もしない）。
  // pointerdown では iPhone の指のタップで動かなかった（2026-10-02 シミュレーターで確認。マウスでは動く）ので click で受ける
  cv.onclick = (ev) => {
    const b = cv.getBoundingClientRect(), off = host._lensOffset || [0, 0], x = ev.clientX - b.left - off[0] * W, y = ev.clientY - b.top - off[1] * H;
    const bottom = host._lookSceneBottom ?? H, screenY = ev.clientY - b.top;
    if (screenY < 0 || screenY > bottom) return;
    let best = -1, bd = 36;
    path.forEach((q, i) => {
      const xy = q.x === null ? null : toPx([q.x, q.y]);
      if (!xy || xy[1] + off[1] * H < 0 || xy[1] + off[1] * H > bottom) return;
      const d = Math.hypot(xy[0] - x, xy[1] - y);
      if (d < bd) { bd = d; best = i; }
    });
    if (best >= 0) { range.value = String(best); draw(best); }
  };
  host._redrawLook = () => { if (host._lookSeq === seq) draw(cur); };
  aimLookPick(host, { spec, cv, draw: () => draw(cur), bodyPosition: () => { const p = at(cur); if (p.x === null) return null; const xy = toPx([p.x, p.y]), off = host._lensOffset || [0, 0]; return [xy[0] + off[0] * W, xy[1] + off[1] * H]; }, W, H, k, win, az:pickGeo?.azimuth??az, topAngle:pickGeo?.angle??topAngle, D:pickGeo?.distanceKm??D, path, toPx: xy => { const p = toPx(xy), off = host._lensOffset || [0, 0]; return p ? [p[0] + off[0] * W, p[1] + off[1] * H] : null; }, pan: () => { const off = host._lensOffset || [0, 0]; return [off[0] * W, off[1] * H]; }, pathTap: cv.onclick });
  const move = host.querySelector("[data-lens-move]");
  const center = host.querySelector("[data-lens-center]");
  move.disabled = true; center.disabled = false;
  host._lensMoving = false;
  move.setAttribute("aria-pressed", String(!!host._lensMoving));
  move.textContent = host._lensMoving ? "構図を確定" : "構図を動かす";
  move.onclick = () => {
    host._lensMoving=!host._lensMoving;
    host._pick=null;aimReverseClear();
    aimLookRender(host,spec);
  };
  center.onclick = () => { host._lensKeyOffset = null;const bottom=frame?H/2+frame.halfH*k:H-12,y=(bottom-groundEdge)/H;host._lensSnap={ground:!!frame&&Math.abs(y)<=1,center:true};host._lensOffset=[0,Math.max(-1,Math.min(1,y))];draw(cur); };
  if (!host._pick) { cv.onkeydown = null; cv.tabIndex = 0; }
  if (!host._pick) {
    host.querySelector("[data-look-hint]").hidden = true;
    host.querySelector("[data-look-hint]").textContent = "";
    cv.style.touchAction = host._full ? "none" : "pan-y";
    if(!cv._twoTouchScroll){const block=e=>{if((host._full||e.touches.length>=2)&&e.cancelable)e.preventDefault();};cv.addEventListener('touchstart',block,{passive:false});cv.addEventListener('touchmove',block,{passive:false});cv._twoTouchScroll=true;}
    const gesture = host._lensGesture || (host._lensGesture = { points: new Map(), drag: null, pinch: null, raf: 0 });
    host._lensKeyOffset = null;
    // Match the drawn ground line (mountains: horizontal 0 degrees). Preserve hysteresis across pinch redraws.
    const snapLineY=groundEdge,snapBottom=frame?H/2+frame.halfH*k:NaN;
    const adoptSnap=result=>{host._lensSnap={ground:result.ground,center:result.center};if(result.entered){try{navigator.vibrate?.(12);}catch{}}host._lensOffset=result.offset;};
    const shift = (dx, dy, { horizontal = true, vertical = true } = {}) => {
      adoptSnap(AstroNotesCameraUI.snapPan(dx,dy,{width:W,height:H,bottom:snapBottom,line:snapLineY,limit:panLimit,state:host._lensSnap,horizontal,vertical}));draw(cur);
    };
    const point = ev => [ev.clientX, ev.clientY];
    const beginGesture = () => {
      const pts = [...gesture.points.values()], off = host._lensOffset || [0, 0];
      gesture.drag = gesture.pinch = null;
      if (pts.length === 1 && (!gesture.touch || host._full)) gesture.drag = [...pts[0], ...off];
      if (pts.length >= 2) {
        gesture.suppressClick = true;
        const [a, b] = pts, distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
        if (distance > 0) {
          const rect = cv.getBoundingClientRect();
          gesture.pinch = { distance, focal, halfH: win.halfH, k, lineY:snapLineY, hasFrame:!!frame, off: [...off], x: ((a[0] + b[0]) / 2 - rect.left - W / 2) / W, y: ((a[1] + b[1]) / 2 - rect.top - H / 2) / H };
        }
      }
    };
    const pathTap = cv.onclick;
    cv.onpointerdown = ev => {
      if (ev.button !== undefined && ev.button !== 0) return;
      if (!gesture.points.size) {gesture.suppressClick = false;gesture.touchStart=ev.pointerType==='touch'?point(ev):null;}
      host._lensKeyOffset = null;
      if (gesture.points.size >= 2) return;
      gesture.touch=ev.pointerType==='touch';
      gesture.points.set(ev.pointerId, point(ev)); beginGesture();
      try { cv.setPointerCapture(ev.pointerId); } catch {}
    };
    cv.onpointermove = ev => {
      if (!gesture.points.has(ev.pointerId)) return;
      gesture.points.set(ev.pointerId, point(ev));
      if(gesture.touchStart&&Math.hypot(ev.clientX-gesture.touchStart[0],ev.clientY-gesture.touchStart[1])>6)gesture.suppressClick=true;
      if (gesture.pinch) {
        if (gesture.raf) return;
        gesture.flush = () => {
          gesture.raf = 0; gesture.flush = null;
          if (host._pick || host._lensGesture !== gesture || !gesture.pinch) return;
          const [a, b] = [...gesture.points.values()], start = gesture.pinch;
          if (!a || !b) return;
          const distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
          if (!(distance > 0)) return;
          const nextFocal = Math.max(8, Math.min(2000, start.focal * distance / start.distance));
          // 自動表示から手動への切替時にも12%の枠余白を維持し、指の中央を拡大の支点にする。
          const nextHalfH = Math.max(sh / (2 * nextFocal * Math.PI / 180), sw / (2 * nextFocal * Math.PI / 180) / (W / H)) * 1.12;
          const ratio = start.halfH / nextHalfH, rect = cv.getBoundingClientRect();
          const midX = ((a[0] + b[0]) / 2 - rect.left - W / 2) / W;
          const midY = ((a[1] + b[1]) / 2 - rect.top - H / 2) / H;
          const nextBottom=start.hasFrame?H/2+sh/(2*nextFocal*Math.PI/180)*start.k*ratio:NaN,nextLine=H/2+(start.lineY-H/2)*ratio;
          adoptSnap(AstroNotesCameraUI.snapPan(ratio*start.off[0]+midX-ratio*start.x,ratio*start.off[1]+midY-ratio*start.y,{width:W,height:H,bottom:nextBottom,line:nextLine,limit:panLimit,state:host._lensSnap}));
          aimLens.focal = nextFocal; aimLens.mode = "manual";
          try { localStorage.setItem("sorami.lens", JSON.stringify(aimLens)); } catch {}
          aimLookRender(host, spec);
        };
        gesture.raf = requestAnimationFrame(gesture.flush);
      } else if (gesture.drag) {
        const drag = gesture.drag;
        if (!gesture.suppressClick && Math.hypot(ev.clientX-drag[0],ev.clientY-drag[1]) < 3) return;
        gesture.suppressClick = true;
        shift(drag[2] + (ev.clientX - drag[0]) / W, drag[3] + (ev.clientY - drag[1]) / H, { horizontal: Math.abs(ev.clientX-drag[0])>=3, vertical: Math.abs(ev.clientY-drag[1])>=3 });
      }
    };
    const endGesture = ev => {
      if (ev?.pointerId !== undefined && !gesture.points.has(ev.pointerId)) return;
      // 指を離すのが次の描画より早くても、最後のピンチ距離を取りこぼさない。
      if (gesture.raf) { cancelAnimationFrame(gesture.raf); gesture.raf = 0; gesture.flush?.(); }
      if (ev?.pointerId !== undefined) gesture.points.delete(ev.pointerId); else gesture.points.clear();
      beginGesture();
      if (!gesture.points.size) cv.dispatchEvent?.(new Event("change", { bubbles: true }));
    };
    cv.onpointerup = cv.onpointercancel = cv.onlostpointercapture = endGesture;
    cv.onclick = ev => { if (gesture.suppressClick) { gesture.suppressClick = false; return; } pathTap?.(ev); };
    cv.onkeydown = (ev) => { const d = { ArrowLeft: [-.01, 0], ArrowRight: [.01, 0], ArrowUp: [0, -.01], ArrowDown: [0, .01] }[ev.key]; if (!d) return; ev.preventDefault(); const off = host._lensKeyOffset || host._lensOffset || [0, 0]; host._lensKeyOffset = [Math.max(-panLimit, Math.min(panLimit, off[0] + d[0])), Math.max(-1, Math.min(1, off[1] + d[1]))]; shift(...host._lensKeyOffset, { horizontal: !!d[0], vertical: !!d[1] }); cv.dispatchEvent?.(new Event("change", { bubbles: true })); };
  } else {
    if (host._lensGesture?.raf) cancelAnimationFrame(host._lensGesture.raf);
    host._lensGesture = null; cv.onlostpointercapture = null;
    cv.style.touchAction = host._pick ? "none" : "";
  }
  const cameraOwner=typeof auth==='undefined'?null:auth?.token;
  host._cameraPreview={frame,current:()=>host._lookSeq===seq&&(typeof auth==='undefined'?null:auth?.token)===cameraOwner&&!host.hidden&&host.getClientRects().length>0,
    key:()=>JSON.stringify([seq,host._lensOffset,aimLens]),
    pauseRealtime:()=>{for(const b of document.querySelectorAll('.tool-datetime-play[data-playing="true"]'))b.click();},
    snapshot:()=>{const off=host._lensOffset||[0,0],offset={x:off[0]*W/k,y:-off[1]*H/k};return {start:host._lookAt??selectedAt,key:host._cameraPreview.key(),margin:ms=>{const state=AstroNotesBodies.state(body,ms,eyeObs),xy=proj(state.azimuth,state.apparentAltitude);return !xy?-180:Math.min(state.apparentAltitude-state.angularRadius,AstroNotesTimelapse.margin({x:xy[0],y:xy[1],radius:state.angularRadius},frame,offset));}};},
    draw:ms=>{if(host._lookSeq===seq){host._blendP=null;draw(timeIndex(ms),ms);}}};
  cur = timeIndex(selectedAt); draw(cur);
  if (ridgePending) ridgePending.then((ridge) => {
    if (seq !== host._lookSeq) return;
    if (ridge) { shape = ridge.map(([a, h]) => toPx(proj(a, h))).filter(Boolean);sceneVersion++; }
    note.textContent = shape ? "" : "稜線を読み込めませんでした";
    note.dataset.primary = note.textContent;
    note.textContent = [note.dataset.primary, note.dataset.terrain || "", ...scene.filter(x => x.failed).map(x => `${x.target.name}の稜線を読み込めませんでした`)].filter(Boolean).join(" / ");
    note.hidden = !note.textContent;
    draw(cur);
  });
  if (frontPending) frontPending.then((r) => {
    if (seq !== host._lookSeq || !r) return;
    front = r.ridge.map(([a, h]) => toPx(proj(a, h))).filter(Boolean); sceneVersion++;
    // 目標の方位で、手前の地形が目標の先端より高ければ見えない。下の部分だけ隠れるときもそう書く
    const b = r.block, low = outline.hiddenAngle ?? outline.baseAngle;
    note.dataset.terrain = !b ? "" : b.angle >= topAngle ? `${t.name}は約${Math.round(b.km)}km先の地形に隠れて見えません`
      : b.angle > low + 0.01 ? `${t.name}の下の部分は約${Math.round(b.km)}km先の地形に隠れます` : "";
    note.textContent = [note.dataset.primary || "", note.dataset.terrain, ...scene.filter(x => x.failed).map(x => `${x.target.name}の稜線を読み込めませんでした`)].filter(Boolean).join(" / ");
    note.hidden = !note.textContent;
    draw(cur);
  });
}

/**
 * 天体の位置から撮影場所を逆算する。図内アイコンで移動モードを開く。
 * 空の任意の位置から相対ドラッグ／方向ボタンで調整し、確定時に既存solveCompositionを実行。
 * タップでは移動せず、キャンセルは最後に確定した結果を維持する。
 */
// 2026-10-20 ユーザー「天体を動かして撮れる場所を逆算する機能、外してしまおう。戻すって言った時に戻しやすいようにはしておいて」：
// 旧自動逆算は停止したまま保持する。再開には旧地図アダプターを含む再接続と別途検証が必要。
