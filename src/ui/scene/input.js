import {AimMap,aim,aimElevation} from '../../features/framing/controller.js';
import {aimDateLabel} from '../../features/satellites/controller.js';
import {aimSideName} from '../../features/framing/candidates.js';
import {aimLookRender} from './render.js';
import {aimReverseCurve} from './reverse.js';
import {aimLookFound,aimLookKey,aimReverseShow,aimShiftFromPlacement} from '../../features/framing/reverse-and-entry.js';
import {auth} from '../../features/account/session-and-access.js';
const AIM_REVERSE_ENABLED = false;
// 2026-10-20 ユーザー「天体動かすとかは前の操作の方がしやすかった」→「やって」：動かし方は前のまま（図の釦・相対ドラッグ・方向の釦）。
// 2026-10-22 最新指示: 天体の位置調整と配置からの逆算を撤去。計算コードは履歴復元用に保持し、入口/プログラム呼出しを停止。
const AIM_PLACE_ENABLED = false;
function aimLookPick(host, { spec, cv, draw, W, H, k, win, az, topAngle, D, path, toPx, pan = () => [0, 0], pathTap, bodyPosition }) {
  const btn = host.querySelector("[data-look-pick]"), found = host.querySelector("[data-look-found]");
  const placeMode = AIM_PLACE_ENABLED && !AIM_REVERSE_ENABLED && host.id === "aimLook";
  btn.hidden = !(AIM_REVERSE_ENABLED || placeMode) || (placeMode && !AstroNotesBodies.definition(aim.body).limbs);
  if (!AIM_REVERSE_ENABLED && !placeMode) host._pick = null;
  const ok = host.querySelector("[data-look-confirm]"), hint = host.querySelector("[data-look-hint]");
  const on = !!host._pick;
  const bodyName = AstroNotesBodies.definition(aim.body).name;
  const controls = host.querySelector("[data-look-controls]"), cancel = host.querySelector("[data-look-cancel]"), status = host.querySelector("[data-look-position]");
  const directions = [...host.querySelectorAll("[data-body-nudge]")];
  btn.setAttribute("aria-label", on ? `${bodyName}の調整を終了` : `${bodyName}を移動して撮れる場所を探す`);
  btn.title = on ? "調整を終了" : `${bodyName}を移動`;
  // 2026-10-20 ユーザー「動かすボタンを押したらそれが完了ボタンになればいいだけ。前の仕様だよね」：動かしている間は全画面の「完了」を隠し、完了は1つにする
  const fullClose = host.querySelector(".preview-full-close"); if (fullClose) fullClose.hidden = on;
  btn.setAttribute("aria-pressed", String(on));
  btn.classList.toggle("active", on);
  host._bodyMoveIcon ||= btn.innerHTML;
  btn.innerHTML=on?'<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4 10-10"/></svg><span>調整を終了</span>':host._bodyMoveIcon;
  const context=()=>JSON.stringify([typeof aimLookKey==='function'?aimLookKey():null,aim.from,aim.target,aim.matchMode,typeof auth==='undefined'?null:auth?.token]);
  controls.hidden = !on;ok.hidden = true;cancel.hidden=true;cv.classList.toggle("picking",on);hint.hidden=true;
  const leave = () => {
    const editing = host._pick;
    if (editing?.busy) return;
    host._pick = null; found.hidden = true;
    if (editing) { aim.reverse = (editing.initialBase?editing.initialReverse:editing.reverseBefore); AimMap.redraw(); aimLookRender(host, editing.initialBase||editing.base); }
  };
  // 置いた位置（画面）を、目標の先端からのずれ（直径）にする
  const placeFromGhost = (ghost) => {
    const [panX, panY] = pan(), px = ghost[0] - panX, py = ghost[1] - panY;
    const ang = AstroNotesAlign.viewUnprojector(win.az0, win.alt0)((px - W / 2) / k, (H / 2 - py) / k);
    const xy = ang && AstroNotesAlign.viewProjector(az, topAngle)(ang[0], ang[1]), d = 2 * (host._bodyRadius || 0);
    if (xy && d > 0) aimShiftFromPlacement(xy[0] / d, xy[1] / d);
  };
  btn.onclick = async () => {
    if (!AIM_REVERSE_ENABLED && !placeMode) return;
    if (host._pick && placeMode) {
      const editing = host._pick; host._pick = null;
      if (editing.ghost) placeFromGhost(editing.ghost);
      aimLookRender(host, editing.initialBase || editing.base);
      // Placement is a draft; open the location search only through its explicit action.
      return;
    }
    if (host._pick) {
      const editing=host._pick;if(editing.busy)return;
      if(editing.ghost){const success=await solve();if(!success||host._pick!==editing)return;}
      host._pick=null;found.hidden=true;aimLookRender(host,editing.base);return;
    }
    host._lensMoving = false;
    const before={...spec,at:host._uiTime?.current??host._lookAt??spec.at};
    host._pick = { base: before, initialBase:before, reverseBefore: aim.reverse, initialReverse:aim.reverse, ghost: null, ghostAngle: null };
    aimLookRender(host, { ...before, pick: true });
  };
  cancel.onclick = leave;
  if (!on) {
    btn.disabled = false; found.hidden = true;
    cv.onpointerdown = cv.onpointermove = cv.onpointerup = cv.onpointercancel = cv.onlostpointercapture = cv.onkeydown = null;
    cv.removeAttribute("tabindex"); cv.onclick = pathTap; return;
  }
  const st = host._pick;
  const mySeq = host._lookSeq;
  // 再描画で前の計算を無効化する。古い計算だけがbusyを解除するのを待たない。
  if (st.busy && st.viewSeq !== mySeq) { st.seq = (st.seq || 0) + 1; st.busy = false; }
  st.viewSeq = mySeq;
  const fresh = () => host._lookSeq === mySeq && host._pick === st;
  const lock = () => { for (const b of [btn, cancel, ...directions]) b.disabled = !!st.busy; ok.disabled = !!st.busy || !st.ghost; };
  lock();
  if (!st.result && !st.busy) found.hidden = true;
  const xyOf = ev => { const b = cv.getBoundingClientRect(); return [(ev.clientX - b.left) * W / b.width, (ev.clientY - b.top) * H / b.height]; };
  const initial = () => { if (placeMode && host._placeXY) return [...host._placeXY]; const p = bodyPosition?.(); return p && p.every(Number.isFinite) && p[0]>=0 && p[0]<=W && p[1]>=0 && p[1]<=H ? p : [W/2,H/2]; };
  if (st.ghostAngle) {
    const xy = AstroNotesAlign.viewProjector(win.az0, win.alt0)(...st.ghostAngle);
    st.ghost = xy ? toPx(xy) : null;
    draw(); lock();
  }
  let drag = null, frame = 0;
  const announce = () => { if(st.ghost) status.textContent = `${bodyName}の位置、左から${Math.round(st.ghost[0]/W*100)}%、上から${Math.round(st.ghost[1]/H*100)}%`; };
  const show = xy => {
    if (!fresh() || st.busy) return;
    st.ghost = [Math.max(0,Math.min(W,xy[0])),Math.max(0,Math.min(H,xy[1]))];
    const [panX,panY] = pan();
    st.ghostAngle = AstroNotesAlign.viewUnprojector(win.az0,win.alt0)((st.ghost[0]-panX-W/2)/k,(H/2-st.ghost[1]+panY)/k);
    ok.disabled = false;
    if (st.result) { found.hidden = false; found.textContent = "位置を変更中（未確定）"; }
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (fresh()) draw(); });
  };
  const nudge = (dx,dy) => { const p = st.ghost || initial(); show([p[0]+dx,p[1]+dy]); announce(); };
  for (const button of directions) button.onclick = () => { const [dx,dy]=button.dataset.bodyNudge.split(",").map(Number); nudge(dx,dy); };
  cv.tabIndex = 0;
  cv.onkeydown = ev => {
    const arrows={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    if (ev.key === "Escape") { ev.preventDefault(); leave(); return; }
    if (!arrows[ev.key] || st.busy) return;
    ev.preventDefault(); const step=ev.shiftKey?10:1; nudge(arrows[ev.key][0]*step,arrows[ev.key][1]*step);
  };
  const solve = async () => {
    if (!st.ghost) return false;
    // 置いた位置を、目標の先端からのずれ（先端を真ん中にした図の上の度）に直す
    const [screenX, screenY] = st.ghost, [panX, panY] = pan();
    const px = screenX - panX, py = screenY - panY;
    const [pAz, pAlt] = AstroNotesAlign.viewUnprojector(win.az0, win.alt0)((px - W / 2) / k, (H / 2 - py) / k);
    const [dx, dy] = AstroNotesAlign.viewProjector(az, topAngle)(pAz, pAlt);
    // 時刻の手がかり: 置いた所にいちばん近い道の点
    let at0 = spec.at, bd = Infinity;
    for (const q of path) {
      const xy = q.x === null ? null : toPx([q.x, q.y]);
      if (!xy) continue;
      const d = Math.hypot(xy[0] - screenX, xy[1] - screenY);
      if (d < bd) { bd = d; at0 = q.at; }
    }
    const seq = (st.seq = (st.seq || 0) + 1);
    // 解いている間に日付・天体・目標・合わせ方を替えた／図を描き直した（画面の幅が変わった）ら、結果は捨てる（Codex の点検）
    const key = aimLookKey(), editingContext=context();
    const stale = () => seq !== st.seq || host._pick !== st || host._lookSeq !== mySeq || aimLookKey() !== key || context()!==editingContext;
    st.busy = true; lock();
    found.hidden = false;
    found.innerHTML = `<p class="tiny">探しています…</p>`;
    let r = null;
    try {
      // 立つ点は地面（展望台から開いた図でも、計算上の地点は展望台ではない）
      r = await AstroNotesAlign.solveComposition(aim.target, aim.body, { around: spec.obs, distanceKm: D, at0, dx, dy,
        eyeM: 1.5, groundM: spec.obs.elevation ?? 0, elevationAt: aimElevation, dayMs: aim.dayMs });
    } catch { r = null; }
    if (stale()) return false;
    if (!r) {
      st.busy = false; lock();
      found.innerHTML = `<p class="tiny">この日・この距離では、そこには来ません</p>`;
      ok.disabled = false;
      return false;
    }
    // 同じ見え方になる場所は、距離を変えると線になる。その線を地図に出す
    const dist = AstroNotesAlign.lineDistances(Math.max(0.3, D / 6), Math.min(150, D * 4), 13).concat([D]).sort((a, b) => a - b);
    const along = await aimReverseCurve(r, { dx, dy, D, dist, stale });
    if (stale()) return false;
    let water = null;
    try { [water] = await AstroNotesTerrain.waterAt([{ latitude: r.latitude, longitude: r.longitude }]); } catch { water = null; }
    if (stale()) return false;
    st.busy = false;
    st.result = { ...r, water: water === true };
    st.ghost = null; st.ghostAngle = null;
    aim.reverse = { key, points: along, at: r };
    aimReverseShow(r, along);
    const resultSpec = { obs: { latitude: r.latitude, longitude: r.longitude, elevation: r.groundM }, eyeM: 1.5, at: r.at,
      title: "撮れる場所から（計算上の位置）", sub: `${aimDateLabel(r.at)} ${aimSideName(r.side)}`, atName: "置いた", pick: true };
    st.base = resultSpec; st.reverseBefore = aim.reverse;
    aimLookRender(host, resultSpec);
    return true;
  };
  cv.onpointerdown = ev => {
    if (!fresh() || st.busy || drag || (ev.pointerType === "mouse" && ev.button !== 0)) return;
    drag = { id: ev.pointerId, start: xyOf(ev), base: [...(st.ghost || initial())], moved: false };
    try { cv.setPointerCapture(ev.pointerId); } catch { /* pointerの移動は受け続ける */ }
  };
  const movePointer = ev => {
    if (!drag || ev.pointerId !== drag.id || !fresh() || st.busy) return;
    const p=xyOf(ev),dx=p[0]-drag.start[0],dy=p[1]-drag.start[1];
    if (!drag.moved && Math.hypot(dx,dy)<3) return;
    drag.moved=true; show([drag.base[0]+dx,drag.base[1]+dy]);
  };
  cv.onpointermove = movePointer;
  cv.onpointerup = ev => { if(!drag || ev.pointerId!==drag.id)return; movePointer(ev); drag=null; announce(); };
  cv.onpointercancel = cv.onlostpointercapture = () => { drag=null; };
  // タップの位置へ飛ばさない。pointerを受けない入力は方向ボタン/矢印キーで操作できる。
  cv.onclick = () => {};
  ok.onclick = () => { if (st.ghost && !st.busy) return solve(); };
  if (st.result) aimLookFound(found, st.result, D);
}

/**
 * 確定した見え方になる場所は、目標までの距離を変えると線になる（同じ日・同じ円盤の位置で、近いほど時刻と立つ点が変わる）。
 * 確定した点から距離を変えながら解き、地図に引く線にする（2026-10-03 ユーザー「確定してその軌道を通る位置を地図で見れないの？」）
 */
export {AIM_PLACE_ENABLED,aimLookPick};
