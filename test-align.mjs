// 「ねらう」の計算（`sorami-align.js`）。**通信しない。**
//
// 線: その日に重なって見える観測点の並び。
//   目標までの距離が決まれば見上げ角が決まり、その高度を天体が通る時刻と方位が決まる。
//   観測者は目標から見てその方位の**反対側**にいる。
// 答え合わせは既知の名所で行う（高尾山の冬至のダイヤモンド富士）。
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const TR = require("./sorami-terrain.js");
const AL = require("./sorami-align.js");

let pass = 0, fail = 0;
const ok = (c, name, extra = "") => { c ? pass++ : fail++; console.log(`  ${c ? "ok  " : "FAIL"} ${name}`, extra); };
const jst = (ms) => new Date(ms + 9 * 3600000).toISOString().slice(0, 16).replace("T", " ");

const fuji = AL.targetById("fuji");
const skytree = AL.targetById("skytree");
const TAKAO = { latitude: 35.6252, longitude: 139.2436, elevation: 599 };

console.log("== 線が既知の名所を通る ==");
{
  // 2026-12-22 の日の入側の線は、高尾山（山頂 599m）を通る
  const day = Date.parse("2026-12-22T00:00:00+09:00");
  const lines = await AL.line(fuji, "sun", day, { sides: ["set"], minKm: 40, maxKm: 70, stepKm: 5, partId: "summit" });
  ok(lines.length === 1 && lines[0].points.length >= 5, "日の入側の線が引ける",
    `${lines[0] ? lines[0].points.length : 0}点`);
  const near = lines[0].points.reduce((a, b) =>
    (TR.distanceKm(TAKAO.latitude, TAKAO.longitude, b.latitude, b.longitude)
      < TR.distanceKm(TAKAO.latitude, TAKAO.longitude, a.latitude, a.longitude) ? b : a));
  const off = TR.distanceKm(TAKAO.latitude, TAKAO.longitude, near.latitude, near.longitude);
  ok(off < 1, "高尾山から1km以内を通る", `${off.toFixed(2)}km / ${jst(near.at)}`);
  ok(jst(near.at).slice(11) > "15:30" && jst(near.at).slice(11) < "16:40", "時刻も日の入ごろ", jst(near.at));
}

console.log("== 観測者は天体の反対側 ==");
{
  // 日の入のダイヤモンド富士は、富士山の**東**から見る（太陽は西へ沈む）
  const day = Date.parse("2026-12-22T00:00:00+09:00");
  const lines = await AL.line(fuji, "sun", day, { sides: ["set"], minKm: 30, maxKm: 60, stepKm: 10, partId: "summit" });
  ok(lines[0].points.every((p) => p.longitude > fuji.longitude), "日の入側の線は富士山の東側",
    lines[0].points.map((p) => p.longitude.toFixed(2)).join(" / "));
  const rise = await AL.line(fuji, "sun", day, { sides: ["rise"], minKm: 30, maxKm: 60, stepKm: 10, partId: "summit" });
  ok(rise.length === 0 || rise[0].points.every((p) => p.longitude < fuji.longitude), "日の出側は西側");
}

console.log("== どこに重ねるかで場所が変わる ==");
{
  const day = Date.parse("2026-12-22T00:00:00+09:00");
  const at = (partId, limb) => AL.solvePoint(skytree, "moon", day, 10, "set", { partId, limb });
  const tipTop = await at("tip", "onTop");
  const tipCenter = await at("tip", "center");
  const tipBehind = await at("tip", "behind");
  const gallery = await at("gallery", "center");
  const d = (a, b) => TR.distanceKm(a.latitude, a.longitude, b.latitude, b.longitude) * 1000;
  ok(tipTop && tipCenter && tipBehind && gallery, "先端と天望回廊、3つの合わせ方すべてで解ける");
  ok(d(tipTop, tipCenter) > 10 && d(tipTop, tipCenter) < 200,
    "「てっぺんに乗せる」と「中心を重ねる」は数十m違う", `${Math.round(d(tipTop, tipCenter))}m`);
  const behind = AL.limbById("behind");
  ok(AL.limbById("onTop").name === "てっぺんに乗せる" && AL.limbById("center").name === "中心を重ねる",
    "名前は撮る人がすること（乗せる・重ねる。2026-10-02 ユーザー「乗る、とかじゃなくて乗せる」）");
  ok(behind.name === "上の縁がてっぺん" && behind.mountainName === "沈む・昇る瞬間" && !AL.LIMBS.some((l) => /裏に隠れる/.test(l.name)),
    "3つ目の名前は、塔は「上の縁がてっぺん」、山は「沈む・昇る瞬間」（2026-10-02 ユーザー選択）");
  ok(d(tipCenter, gallery) > 100, "先端と天望回廊（第二展望台）は100m以上違う",
    `${Math.round(d(tipCenter, gallery))}m`);
  ok(tipTop.altitude > tipCenter.altitude && tipCenter.altitude > tipBehind.altitude,
    "乗る→中心→隠れる の順に、天体の高度が下がる");
}

console.log("== 一覧（この地点で次に重なる日）==");
{
  const from = Date.parse("2026-09-25T00:00:00+09:00");
  const rows = AL.upcoming(TAKAO, fuji, "sun", { from, days: 400, limit: 3, partId: "summit" });
  ok(rows.length >= 1, "高尾山から富士山×太陽の回が見つかる", rows.map((r) => jst(r.at)).join(" / "));
  ok(jst(rows[0].at).slice(0, 10) === "2026-12-22", "冬至ごろ", jst(rows[0].at));
  ok(rows[0].side === "set", "日の入側");
  const moon = AL.upcoming({ latitude: 35.67, longitude: 139.91, elevation: 3 }, skytree, "moon",
    { from, days: 400, limit: 3, partId: "tip", limb: "onTop" });
  ok(moon.length >= 1 && moon.every((m) => m.illuminated !== null), "スカイツリー×月も出て、輝面を持つ",
    moon.map((m) => `${jst(m.at)} ${Math.round(m.illuminated * 100)}%`).join(" / "));
}

console.log("== 線の長さは目標の高さで決まる ==");
{
  // 60mの避雷針を120km先から見上げても地平線の下。距離の幅を高さから決める
  const fuji = AL.lineRange(3776), tink = AL.lineRange(60);
  ok(fuji.maxKm > 100 && fuji.minKm > 5, "富士山は数kmより外〜100km超", JSON.stringify(fuji));
  ok(tink.maxKm <= 5 && tink.minKm < 1, "60mの目標は数km以内", JSON.stringify(tink));
  const day = Date.parse("2026-10-06T00:00:00+09:00");
  const tb = AL.targetById("tinkerbell");
  const lines = await AL.line(tb, "moon", day, { partId: "tip", limb: "onTop" });
  ok(lines.length === 2, "距離を渡さなくても線が引ける", `${lines.length}本`);
  ok(lines.every((l) => l.points.every((p) => p.altitude > 0)), "どの点も地平線より上");
  const set = lines.find((l) => l.side === "set");
  ok(set.points.every((p) => p.longitude > tb.longitude), "月の入側は目標の東");
}

console.log("== 塔の高さは地上で言う（2026-10-01） ==");
// ユーザー「スカイツリーの先端が634mだと思うんだけど636になってるのはなんで」。計算は海面から、画面は地上から
{
  const above = (id, part) => { const t = AL.targetById(id); return t.parts.find((p) => p.id === part).m - (t.groundM || 0); };
  ok(above("skytree", "tip") === 634, "スカイツリーの先端は地上634m", above("skytree", "tip"));
  ok(above("skytree", "deck") === 350, "天望デッキは地上350m", above("skytree", "deck"));
  ok(above("tokyotower", "tip") === 333, "東京タワーの先端は地上333m", above("tokyotower", "tip"));
  ok(above("tokyotower", "main") === 150, "メインデッキは地上150m", above("tokyotower", "main"));
  ok(above("cinderella", "tip") === 51, "シンデレラ城は地上51m", above("cinderella", "tip"));
  ok(above("fuji", "summit") === 3776, "富士山は標高のまま3776m", above("fuji", "summit"));
  ok(AL.targetById("skytree").parts[0].m === 636, "計算に使う値は海面から（634＋地面2m）");
}

console.log("== 地形の凹凸で線を蛇行させない ==");
{
  // 富士山の西は谷と尾根で標高が 1500m 違う。生の標高で1点ずつ解くと方位が行き来する
  const day = Date.parse("2026-09-25T00:00:00+09:00");
  const profile = [900, 850, 830, 820, 790, 890, 790, 1350, 1500, 1190, 790, 490, 250, 560,
    1050, 1270, 1270, 840, 1010, 1930, 1200, 2140, 1970, 820, 810, 1210, 690, 710, 830,
    1070, 1230, 920, 530, 460, 220, 140];
  // **呼ばれた順ではなく場所で決める。** 解くのは同時並行なので、順番に頼ると結果が揺れる
  const fake = (lat, lon) => {
    const d = TR.distanceKm(fuji.latitude, fuji.longitude, lat, lon);
    const r = AL.lineRange(3776);
    const t = (Math.log(d / r.minKm) / Math.log(r.maxKm / r.minKm)) * (profile.length - 1);
    return profile[Math.max(0, Math.min(profile.length - 1, Math.round(t)))];
  };
  const swings = (line) => {
    const b = line.points.map((p) => TR.bearing(fuji.latitude, fuji.longitude, p.latitude, p.longitude));
    let n = 0;
    for (let k = 2; k < b.length; k++) if ((b[k] - b[k - 1]) * (b[k - 1] - b[k - 2]) < 0) n++;
    return n;
  };
  const rough = await AL.line(fuji, "sun", day, { sides: ["rise"], partId: "summit",
    elevationAt: fake, smooth: false });
  const smooth = await AL.line(fuji, "sun", day, { sides: ["rise"], partId: "summit",
    elevationAt: fake });
  ok(rough.length === 1 && smooth.length === 1, "どちらも線になる");
  ok(swings(rough[0]) >= 4, "ならさないと方位が何度も折り返す", `${swings(rough[0])}回`);
  ok(swings(smooth[0]) < swings(rough[0]), "ならすと折り返しが減る",
    `${swings(smooth[0])}回 ← ${swings(rough[0])}回`);
  ok(smooth[0].points.every((p) => Number.isFinite(p.groundM)),
    "ならしても、その場所の生の標高は持っている");
}

console.log("== 目標の高さが無ければ計算しない ==");
{
  const day = Date.parse("2026-12-22T00:00:00+09:00");
  const bad = { id: "x", name: "高さ未設定", latitude: 35.6, longitude: 139.7, parts: [] };
  ok((await AL.line(bad, "sun", day, { minKm: 10, maxKm: 20, stepKm: 5 })).length === 0, "線は引けない");
  ok(AL.upcoming(TAKAO, bad, "sun", { from: day, days: 5 }).length === 0, "一覧も空");
}

console.log("== 線の上に立つと、本当に目標の方向に天体がある（2026-09-30） ==");
{
  // 以前は「目標から見て天体の反対の方位」に観測点を置いていた。球の上では行きと帰りの方位が
  // 子午線の収束ぶんずれるので、観測者から見た目標の方位は天体の方位にならなかった
  // （富士山から80kmで 0.44°＝太陽の半径より大きく、線が横に 0.6km、120kmで 1.4km ずれていた）。
  const A = require("./sorami-astro.js");
  const d0 = Date.parse("2026-12-22T00:00:00+09:00");
  for (const [target, body, dists] of [[fuji, "sun", [20, 50, 80, 120]], [fuji, "moon", [60, 100]], [skytree, "sun", [3, 8]]]) {
    for (const d of dists) {
      for (const side of ["set", "rise"]) {
        const p = await AL.solvePoint(target, body, d0, d, side, {});
        if (!p || p.altitude < 0) continue;
        const brg = TR.bearing(p.latitude, p.longitude, target.latitude, target.longitude);
        const st = (body === "moon" ? A.moon : A.sun)(p.at, { latitude: p.latitude, longitude: p.longitude, elevation: 1.5 });
        const miss = ((st.azimuth - brg + 540) % 360) - 180;
        ok(Math.abs(miss) < 0.002, `${target.name}×${body === "sun" ? "太陽" : "月"} ${d}km（${side === "set" ? "沈む" : "昇る"}側）: 目標の方向に天体がある`,
          `ずれ ${miss.toFixed(4)}°（天体の半径 ${st.angularRadius.toFixed(3)}°）`);
        break;
      }
    }
  }
}

console.log("== その日の候補地（線に掛かる立てる場所）（2026-09-30） ==");
{
  const day = Date.parse("2026-10-20T00:00:00+09:00");
  const lines = await AL.line(skytree, "sun", day, { sides: ["set"], partId: "tip", limb: "center" });
  const l = lines[0];
  const p = l.points.find((q) => q.distanceKm > 9);
  const flat = { elevationAt: async () => 0, partId: "tip", limb: "center" };
  const toLL = (lat0, lon0, dx, dy) => ({ latitude: lat0 + dy / 110574, longitude: lon0 + dx / (Math.cos(lat0 * Math.PI / 180) * 111320) });
  const g = (pts) => pts.flatMap((q) => [Math.round(q.latitude * 1e5), Math.round(q.longitude * 1e5)]);
  // 線の向きに直交する向き（目標から見た方位 + 90°）
  const brg = TR.bearing(skytree.latitude, skytree.longitude, p.latitude, p.longitude);
  const side = (m) => TR.destination(p.latitude, p.longitude, brg + 90, m / 1000);
  const places = [
    { id: "on", name: "線の上の点", kind: "展望地", shape: "point", latitude: p.latitude, longitude: p.longitude, elevationM: 0 },
    { id: "off", name: "1km 離れた点", kind: "展望地", shape: "point", ...side(1000), elevationM: 0 },
    { id: "bridge", name: "線を横切る橋", kind: "橋", shape: "line", latitude: p.latitude, longitude: p.longitude,
      g: g([side(-180), side(220)]), reachM: 220, bridgeM: 0 },
    { id: "park", name: "線が通る公園", kind: "公園", shape: "area", latitude: p.latitude, longitude: p.longitude,
      g: g([toLL(p.latitude, p.longitude, -150, -150), toLL(p.latitude, p.longitude, 150, -150),
            toLL(p.latitude, p.longitude, 150, 150), toLL(p.latitude, p.longitude, -150, 150)]), reachM: 220 },
  ];
  const c = await AL.candidates(lines, places, skytree, "sun", flat);
  const by = (id) => c.find((x) => x.place.id === id);
  ok(by("on") && by("on").rank === "center", "線の上の点は「ど真ん中」", by("on") && `${jst(by("on").at)} ずれ ${by("on").gap.toFixed(3)}°`);
  ok(by("on") && Math.abs(by("on").at - p.at) < 90000, "時刻も線の点と同じ（1.5分以内）", by("on") && `${jst(by("on").at)} / 線 ${jst(p.at)}`);
  ok(!by("off"), "1km 離れた点は拾わない（重ならない）");
  const b = by("bridge");
  const dist = (x) => TR.distanceKm(x.stand.latitude, x.stand.longitude, p.latitude, p.longitude) * 1000;
  ok(b && b.rank === "center" && dist(b) < 15, "橋は、線と交わる点に立つ", b && `${b.rank} 線の点から ${dist(b).toFixed(1)}m`);
  const k = by("park");
  const inPark = (x) => Math.abs((x.stand.latitude - p.latitude) * 110574) <= 150
    && Math.abs((x.stand.longitude - p.longitude) * Math.cos(p.latitude * Math.PI / 180) * 111320) <= 150;
  ok(k && k.rank === "center" && inPark(k), "公園は、園内で線が通るところに立つ", k && `${k.rank} 線の点から ${dist(k).toFixed(1)}m`);

  // 周りより高い場所（丘の上の展望地）は、ならした線から横にずれた所で重なる。解き直して拾う
  const hillTrue = await AL.solvePoint(skytree, "sun", day, 12, "set", { partId: "tip", elevationAt: async () => 60 });
  const hill = { id: "hill", name: "丘の展望地", kind: "展望地", shape: "point", latitude: hillTrue.latitude, longitude: hillTrue.longitude, elevationM: 60 };
  const h = (await AL.candidates(lines, [hill], skytree, "sun", flat))[0];
  const lp = l.points.reduce((a, q) => (Math.abs(q.distanceKm - 12) < Math.abs(a.distanceKm - 12) ? q : a));
  ok(h && (h.rank === "center" || h.rank === "overlap"), "標高60mの丘は、線から横にずれていても重なると分かる",
    h && `${h.rank} ずれ ${h.gap.toFixed(3)}° ・ 線から ${(TR.distanceKm(hill.latitude, hill.longitude, lp.latitude, lp.longitude) * 1000).toFixed(0)}m`);
  // 一覧（upcoming）と同じ判定になる
  const up = AL.upcoming({ latitude: hill.latitude, longitude: hill.longitude, elevation: 60 }, skytree, "sun",
    { from: day, days: 1, limit: 1, partId: "tip" });
  ok(up[0] && h && Math.abs(up[0].at - h.at) < 60000 && up[0].rank === h.rank, "一覧（次に重なる日）と同じ時刻・同じ判定",
    up[0] && `${jst(up[0].at)} ${up[0].rank}`);
}

{
  // 本物の例: 2026-12-22 のダイヤモンド富士。線は海面の高さで引いても、高尾山（598m）は拾えて 16:10 ごろ
  const day = Date.parse("2026-12-22T00:00:00+09:00");
  const lines = await AL.line(fuji, "sun", day, { sides: ["set"], partId: "summit" });
  const sp = AL.FUJI_SPOTS.find((x) => x.id === "takao");
  const place = { id: sp.id, name: sp.name, kind: "定番", shape: "point", latitude: sp.latitude, longitude: sp.longitude, elevationM: sp.groundM };
  const c = (await AL.candidates(lines, [place], fuji, "sun", { partId: "summit" }))[0];
  ok(c && c.rank !== "graze" && jst(c.at).slice(11) >= "16:05" && jst(c.at).slice(11) <= "16:15",
    "2026-12-22 の候補地に高尾山が入る（16:10ごろ）", c && `${jst(c.at)} ${c.rank}`);
  const other = await AL.candidates(await AL.line(fuji, "sun", day + 20 * 86400000, { sides: ["set"], partId: "summit" }),
    [place], fuji, "sun", { partId: "summit" });
  ok(other.length === 0, "20日後の線では高尾山は候補にならない");
}

console.log("== 富士山の頂は輪（火口の縁）（2026-09-30） ==");
{
  // 剣ヶ峰1点で見ていたときは、高尾山の冬至が「縁がかすめる」で、定番一覧から落ちていた
  const spot = (id) => AL.spotObserver(AL.FUJI_SPOTS.find((x) => x.id === id));
  const from = Date.parse("2026-10-01T00:00:00+09:00");
  const up = (id) => AL.upcoming(spot(id), fuji, "sun", { from, days: 366, limit: 3, partId: "summit", stepMs: 1800000 });
  const takao = up("takao")[0];
  ok(takao && takao.rank === "center" && jst(takao.at).startsWith("2026-12-22"),
    "高尾山: 冬至 12/22 に頂へ沈む（縁がかすめる、ではない）", takao && `${jst(takao.at)} ${takao.rank}`);
  const tanuki = up("tanuki");
  const md = (e) => jst(e.at).slice(5, 10);
  ok(tanuki.length >= 2 && tanuki.some((e) => md(e) >= "04-15" && md(e) <= "04-28") && tanuki.some((e) => md(e) >= "08-13" && md(e) <= "08-26"),
    "田貫湖: 4月20日前後と8月20日前後の日の出", tanuki.map((e) => jst(e.at)).join(" / "));
  const ryu = up("ryugatake")[0];
  ok(ryu && ryu.from <= Date.parse("2027-01-01T00:00:00+09:00") && ryu.to >= Date.parse("2027-01-02T00:00:00+09:00"),
    "竜ヶ岳: 元日をはさむ（年末年始のダイヤモンド富士）", ryu && `${jst(ryu.from)}〜${jst(ryu.to)}`);
  // 塔は輪を持たないので、これまでどおり先端の1点
  ok(!skytree.rim && fuji.rim, "輪を持つのは富士山だけ");
}

console.log("== 建物で塔が隠れるか（2026-09-30） ==");
{
  const obs = { latitude: 35.7101, longitude: 139.9210, elevation: 3 };   // スカイツリーの東 10km
  const brg = TR.bearing(obs.latitude, obs.longitude, skytree.latitude, skytree.longitude);
  // 目標の方向 100m 先に 20m 四方の建物
  const box = (dist, side, h) => {
    const c = TR.destination(obs.latitude, obs.longitude, brg, dist / 1000);
    const at = (dx, dy) => TR.destination(TR.destination(c.latitude, c.longitude, brg, dy / 1000).latitude,
      TR.destination(c.latitude, c.longitude, brg, dy / 1000).longitude, brg + 90, (dx + side) / 1000);
    const p = [at(-10, -10), at(10, -10), at(10, 10), at(-10, 10)];
    return { ring: p.map((q) => [q.latitude, q.longitude]), heightM: h };
  };
  const tall = AL.buildingBlock(obs, skytree, [box(100, 0, 30)], { partId: "tip" });
  ok(tall && tall.blocked, "目の前 100m の 30m の建物は先端を隠す", tall && `余裕 ${tall.marginDeg.toFixed(1)}° ・ ${tall.by.distanceM}m`);
  const low = AL.buildingBlock(obs, skytree, [box(100, 0, 5)], { partId: "tip" });
  ok(low && !low.blocked, "5m の建物なら隠さない（先端は 3.6° 上）", low && `余裕 ${low.marginDeg.toFixed(1)}°`);
  const side = AL.buildingBlock(obs, skytree, [box(100, 60, 60)], { partId: "tip" });
  ok(side && !side.blocked, "横に 60m ずれた建物は数えない");
  // 円で持った建物（同梱の高い建物）
  const c100 = TR.destination(obs.latitude, obs.longitude, brg, 0.1);
  const circ = AL.buildingBlock(obs, skytree, [{ latitude: c100.latitude, longitude: c100.longitude, radiusM: 10, heightM: 30 }], { partId: "tip" });
  ok(circ && circ.blocked && Math.abs(circ.by.distanceM - 90) <= 1, "円の建物も、入る距離（100m−半径10m）で判定する", circ && `${circ.by.distanceM}m`);
  const cside = TR.destination(c100.latitude, c100.longitude, brg + 90, 0.03);
  ok(!AL.buildingBlock(obs, skytree, [{ latitude: cside.latitude, longitude: cside.longitude, radiusM: 10, heightM: 300 }], { partId: "tip" }).blocked,
    "横に 30m ずれた円（半径10m）は線に掛からない");
  const far = AL.buildingBlock(obs, skytree, [box(1200, 0, 60)], { partId: "tip" });
  ok(far && !far.blocked === (Math.atan2(58.5, 1190) / Math.PI * 180 < 3.6), "1.2km 先の 60m は見上げ角で比べる", far && `余裕 ${far.marginDeg.toFixed(2)}°`);
}

console.log("== 地形で見通せるか（2026-09-30） ==");
{
  const obs = { latitude: 35.62523, longitude: 139.24369, elevation: 598 };   // 高尾山
  const flat = await AL.lineOfSight(obs, fuji, { partId: "summit", elevations: async (pts) => pts.map(() => 300) });
  ok(flat && flat.clear, "間に高い山が無ければ見通せる", flat && `余裕 ${flat.marginDeg.toFixed(2)}°`);
  const wall = await AL.lineOfSight(obs, fuji, { partId: "summit",
    elevations: async (pts) => pts.map((q) => (TR.distanceKm(obs.latitude, obs.longitude, q.latitude, q.longitude) > 20
      && TR.distanceKm(obs.latitude, obs.longitude, q.latitude, q.longitude) < 22 ? 2500 : 300)) });
  ok(wall && !wall.clear, "途中に2500mの尾根があれば隠れる", wall && `${wall.blockKm.toFixed(1)}km 先`);
}

console.log(`\n${fail === 0 ? "ALIGN OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
