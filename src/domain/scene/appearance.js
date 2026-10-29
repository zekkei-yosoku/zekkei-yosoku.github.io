(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesSceneAppearance=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
// ---------------------------------------------------------------- 見え方（2026-10-02）
//
// ユーザー「その目標物に対して月、太陽がどのような軌道で動くのかを見たいなっていうのがこの機能を実装した最大の思いだった」。
// 立つ場所から目標のまわり数度だけを拡大し、太陽・月の道と円盤を描く（外した「空の見え方」の全周の図では目標が小さすぎた）。
// Codex と相談して決めた形: 目標を中心に接平面へ写す（方位と高度をそのまま並べると円盤がゆがむ）、形の出どころを書き分ける、
// 月の欠けは空での向きで描く、20秒刻みで重なる瞬間を必ず含める、320px では選んだ時刻だけを字で出す。
// 形は、既定の4つ（スカイツリー・東京タワー・シンデレラ城・ティンカーベル）は作り込んだ形、他の建物は高さと推定の幅の模式図、
// 山は標高データの稜線（富士山は火口の縁のデータも足す）。手前の建物は描かない（隠れるなら見通しで「見えません」と出る）
const AIM_LOOK_SKY = [
  // 太陽の高度と、そのときの空の色（上・下）
  [-18, [11, 19, 36], [26, 37, 64]],
  [-12, [16, 28, 58], [48, 62, 104]],
  [-6, [33, 56, 104], [150, 106, 116]],
  [-2, [58, 96, 150], [230, 156, 112]],
  [2, [96, 150, 205], [244, 194, 132]],
  [8, [110, 170, 225], [200, 228, 246]],
];
function aimLookSky(sunAlt) {
  const k = AIM_LOOK_SKY;
  if (!(sunAlt > k[0][0])) return [k[0][1], k[0][2]];
  for (let i = 1; i < k.length; i++) {
    if (sunAlt > k[i][0]) continue;
    const f = (sunAlt - k[i - 1][0]) / (k[i][0] - k[i - 1][0]);
    const mix = (a, b) => a.map((v, j) => Math.round(v + (b[j] - v) * f));
    return [mix(k[i - 1][1], k[i][1]), mix(k[i - 1][2], k[i][2])];
  }
  return [k[k.length - 1][1], k[k.length - 1][2]];
}
/// 月の明るい縁の、図の上での向き（canvas の角度。右が0で時計回り）。
/// brightLimbZenithAngle は天頂の向きから左回りの角度。2024-11-30 05:54:55 のユーザーの写真（葛西臨海公園からティンカーベル）で、
/// 計算 138.3° と写真の三日月の向き 138.1° が合うことを確かめた
function aimLimbDir(zenithAngleDeg) {
  const th = zenithAngleDeg * Math.PI / 180;
  return Math.atan2(-Math.cos(th), -Math.sin(th));
}
function aimLookDisc(ctx, x, y, r, body, p) {
  ctx.save();
  if (body === "sun") {
    const g = ctx.createRadialGradient(x, y, r * 0.6, x, y, r * 2.2);
    g.addColorStop(0, "rgba(255,190,80,0.55)"); g.addColorStop(1, "rgba(255,190,80,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r * 2.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ffcf5a"; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  } else if (body !== "moon") {
    // Visual minimum is separate from physical radius used for intersections.
    const marker = Math.max(2.5, r);
    ctx.fillStyle = body === "mars" ? "#ffa878" : "#f4efd8";
    ctx.beginPath(); ctx.arc(x, y, marker, 0, Math.PI * 2); ctx.fill();
  } else {
    const k = Math.max(0, Math.min(1, p.illuminated ?? 1));
    ctx.fillStyle = "rgba(70,80,105,0.5)";
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    const phi = aimLimbDir(p.brightLimbZenithAngle ?? 0);
    ctx.beginPath();
    ctx.arc(x, y, r, phi - Math.PI / 2, phi + Math.PI / 2);
    ctx.ellipse(x, y, r * Math.abs(1 - 2 * k), r, phi, Math.PI / 2, -Math.PI / 2, k < 0.5);
    ctx.closePath();
    ctx.fillStyle = "#f4efd8"; ctx.fill();
    // 細い月は図では1px に満たないので、明るい縁を線でなぞって見えるようにする
    if (k < 0.15) {
      ctx.strokeStyle = "#f4efd8"; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(x, y, r - 0.8, phi - Math.PI / 2 * Math.min(1, 0.55 + k * 3), phi + Math.PI / 2 * Math.min(1, 0.55 + k * 3)); ctx.stroke();
    }
  }
  ctx.restore();
}

return {AIM_LOOK_SKY,aimLookSky,aimLimbDir,aimLookDisc};
});
