// 2026-11-11 Trial only. 探すは同じ地理院の建物タイルを線ごとに何千回も読む。その度にタイルの全建物を緯度経度へ
// 変換していたのが、電話での探索時間の約3割だった。タイルごとに一度だけ変換して外枠を持ち、線の範囲（両端の箱）に
// 掛からない建物は飛ばす。線と交わる建物も立つ点を含む建物も必ず箱に掛かるので、返す建物は今までと同じ。
const patch=(s,a,b)=>{if(s.split(a).length!==2)throw Error('GSI buildings boundary changed: '+a.slice(0,100));return s.replace(a,b);};
export function patchGsiBuildingsCache(source){
 let s=patch(source,`    const n = 2 ** WATER_Z, out = [];
    for (const [tx, ty, tile] of tiles) {
      tile.polys.forEach((rings, i) => {
        const minHeightM = GSI_BUILDING_MIN_M[tile.codes[i]];
        if (!minHeightM) return;
        const ring = rings[0].map(([px, py]) => {
          const fx = (tx + px / tile.extent) / n, fy = (ty + py / tile.extent) / n;
          return [Math.atan(Math.sinh(Math.PI * (1 - 2 * fy))) * 180 / Math.PI, fx * 360 - 180];
        });
        const pts = ring.map(([la, lo]) => xy(la, lo));`,`    const n = 2 ** WATER_Z, out = [];
    const south = Math.min(from.latitude, to.latitude), north = Math.max(from.latitude, to.latitude), west = Math.min(from.longitude, to.longitude), east = Math.max(from.longitude, to.longitude);
    for (const [tx, ty, tile] of tiles) {
      const geo = tile.geo || (tile.geo = tile.polys.map((rings) => {
        const ring = rings[0].map(([px, py]) => {
          const fx = (tx + px / tile.extent) / n, fy = (ty + py / tile.extent) / n;
          return [Math.atan(Math.sinh(Math.PI * (1 - 2 * fy))) * 180 / Math.PI, fx * 360 - 180];
        });
        let s = Infinity, w = Infinity, nn = -Infinity, e = -Infinity;
        for (const [la, lo] of ring) { if (la < s) s = la; if (la > nn) nn = la; if (lo < w) w = lo; if (lo > e) e = lo; }
        return { ring, s, w, n: nn, e };
      }));
      tile.polys.forEach((rings, i) => {
        const minHeightM = GSI_BUILDING_MIN_M[tile.codes[i]];
        if (!minHeightM) return;
        const g = geo[i];
        if (g.n < south || g.s > north || g.e < west || g.w > east) return;
        // All four corners of the box on one side of the line, or all before its start or after its end: no edge can
        // cross the segment and the start point is not inside.
        const c = [xy(g.s, g.w), xy(g.s, g.e), xy(g.n, g.w), xy(g.n, g.e)];
        let left = 0, right = 0, tMin = Infinity, tMax = -Infinity;
        for (const [x, y] of c) { const side = x * uy - y * ux, t = x * ux + y * uy; if (side > 1e-6) left++; else if (side < -1e-6) right++; else { left++; right++; } if (t < tMin) tMin = t; if (t > tMax) tMax = t; }
        if (!left || !right || tMax < -1e-6 || tMin > totalM + 1e-6) return;
        const ring = g.ring;
        const pts = ring.map(([la, lo]) => xy(la, lo));`);
 return s;
}
