import {aim,aimElevation} from '../../features/framing/controller.js';
async function aimReverseCurve(r, { dx, dy, D, dist, stale }) {
  const out = [{ ...r, distanceKm: D }];
  const run = async (list) => {
    let prev = r;
    for (const d of list) {
      if (stale()) return;
      let q = null;
      try {
        q = await AstroNotesAlign.solveComposition(aim.target, aim.body, { around: prev, distanceKm: d, at0: prev.at, dx, dy,
          eyeM: 1.5, groundM: prev.groundM, elevationAt: aimElevation, dayMs: aim.dayMs });
      } catch { q = null; }
      // 日の出側と日の入側は別の線。同じ側だけをつなぐ
      if (q && q.side === r.side) { out.push(q); prev = q; }
    }
  };
  await run(dist.filter((d) => d > D + 1e-6));
  await run(dist.filter((d) => d < D - 1e-6).reverse());
  return out.sort((a, b) => a.distanceKm - b.distanceKm);
}
export {aimReverseCurve};
