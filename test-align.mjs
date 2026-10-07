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
    "「下の縁」と「真ん中」は数十m違う", `${Math.round(d(tipTop, tipCenter))}m`);
  ok(AL.LIMBS.map((l) => l.name).join("・") === "下の縁・真ん中・上の縁",
    "名前は天体のどの縁を合わせるかだけを短く（意味は画面の図。2026-10-02 ユーザー「もっと簡潔でわかりやすいのが」）");
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
  ok(tink.maxKm <= 8 && tink.minKm < 1, "60mの目標は数km以内", JSON.stringify(tink));
  // 城の 3.7km 先の候補地が線の先に浮いていた（2026-10-02 まで 3km で切れていた）。ユーザーの写真も見上げ 0.98°（2.85km）から
  ok(AL.lineRange(54).maxKm >= 5, "シンデレラ城の線は 3.7km の候補地より先まで", JSON.stringify(AL.lineRange(54)));
  // 候補地は線の届く範囲に立つものだけ（広い公園の端が掛かると、立つ点が線の先に出ていた。ユーザー「地図上の線が届いてないね」）
  {
    const cin = AL.targetById("cinderella");
    const lines = await AL.line(cin, "sun", Date.parse("2026-10-02T00:00:00+09:00"), { partId: "tip", limb: "onTop", sides: ["set"] });
    const far = lines[0].points[lines[0].points.length - 1].distanceKm;
    const end = lines[0].points[lines[0].points.length - 1];
    const brg = TR.bearing(cin.latitude, cin.longitude, end.latitude, end.longitude);
    const at = (km) => ({ ...TR.destination(cin.latitude, cin.longitude, brg, km), shape: "point", kind: "公園", elevationM: 3 });
    // 線の端（6km）の少し先（6.25km。範囲の 5% の余裕の中）と、端の少し手前（5.9km）
    const got = await AL.candidates(lines, [{ id: "beyond", name: "先", ...at(far + 0.25) }, { id: "inside", name: "手前", ...at(far - 0.1) }],
      cin, "sun", { partId: "tip", limb: "onTop" });
    ok(got.some((c) => c.place.id === "inside"), "線の上の候補は出す");
    ok(got.every((c) => c.distanceKm <= far * 1.02), "線の先に立つ候補は出さない", `${got.map((c) => c.distanceKm.toFixed(2)).join(",") || "なし"} / 線 ${far.toFixed(2)}km`);
  }
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
  // 公式施設案内に基づく地上150m/250m。地面の標高は別に加算。
  ok(above("tokyotower", "main") === 150, "メインデッキは地上150m", above("tokyotower", "main"));
  ok(above("tokyotower", "top") === 250, "トップデッキは地上250m", above("tokyotower", "top"));
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

console.log("== 見え方の図（2026-10-02） ==");
{
  const A = require("./sorami-astro.js");
  // 目標を真ん中にした接平面。右が方位の増える向き、上が高い向き
  const P = AL.viewProjector(90, 10);
  const c0 = P(90, 10), r1 = P(91, 10), u1 = P(90, 11);
  ok(Math.abs(c0[0]) < 1e-9 && Math.abs(c0[1]) < 1e-9, "真ん中は (0,0)");
  ok(r1[0] > 0.98 && r1[0] < 0.99 && Math.abs(r1[1]) < 0.01, "方位が1°増えると右へ cos10° ぶん", r1.map((v) => v.toFixed(4)).join(","));
  ok(Math.abs(u1[0]) < 1e-9 && u1[1] > 0.99 && u1[1] < 1.01, "高度が1°増えると上へ1°");
  // 方位と高度をそのまま並べると、高い所の円盤が横に伸びる（高度60°で2倍）。接平面なら角度のまま
  const P60 = AL.viewProjector(180, 60);
  const wide = P60(180 + 0.5 / Math.cos(60 * Math.PI / 180), 60)[0];
  ok(Math.abs(wide - 0.5) < 0.01, "高度60°でも 0.5° は 0.5° の幅", wide.toFixed(4));

  // ユーザーの写真で確かめる: 2024-11-30 05:54:55、葛西臨海公園（692.9m 先）から、月の上にティンカーベルの杖の先が重なる
  const at = Date.UTC(2024, 10, 29, 20, 54, 55);
  const obs = { latitude: 35.64030793865526, longitude: 139.87155449624044, elevation: 2.8 };
  const eyeObs = { ...obs, elevation: 4.3 };
  const tb = AL.targetById("tinkerbell");
  const o = AL.towerOutline(obs, tb);
  const m = A.moon(at, eyeObs);
  // 写真では杖の先は月の中心の 0.069° 下（月の直径を物差しに測った）。時計か撮影地の1〜2mのずれで ±0.07° 動く
  ok(Math.abs((m.apparentAltitude - o.topAngle) - 0.069) < 0.07, "杖の先は月の中心の少し下（写真と合う）",
    `${(m.apparentAltitude - o.topAngle).toFixed(3)}°`);
  ok(Math.abs(m.brightLimbZenithAngle - 138.1) < 3, "明るい縁の向きが写真の三日月（138.1°）と合う", m.brightLimbZenithAngle.toFixed(1));
  ok(m.illuminatedFraction < 0.03, "写真と同じ細い月", `${(m.illuminatedFraction * 100).toFixed(1)}%`);
  ok(o.known && !o.schematic, "ティンカーベルは作り込んだ形");
  // 2026-10-03 ユーザーのシルエット（ドーム・小塔・手すり）に入れ替え。縮尺は 11/29 の写真の月で測った（絵の 59.5px＝1m）
  const tOut = AL.TOWER_SHAPES.tinkerbell.outline;
  const depth = Math.max(...tOut.map(([, d]) => d));
  ok(Math.abs(depth - 13.95) < 0.1, "絵の下の端（左右の屋根）は杖の先から約14m 下", depth);
  const roofAngle = A.targetElevationAngle(o.distanceKm, 4.3, tb.parts[0].m - depth);
  ok(o.points.some((p) => Math.abs(p[1] - roofAngle) < 1e-6), "絵の下の端から下はホテルの幅で埋める");
  const tinkTop = tOut.reduce((a, p) => (p[1] < a[1] ? p : a));
  ok(tinkTop[1] === 0 && Math.abs(tinkTop[0] + 0.3) < 1e-9, "杖の先はドームの軸の 0.3m 左（写真）", JSON.stringify(tinkTop));
  // 写真で測った所: 像の下の玉の真ん中は杖の先から 2.84m 下
  const ball = tOut.filter((p) => Math.abs(p[1] - 2.84) < 0.3);
  ok(ball.length > 0 && Math.max(...ball.map((p) => Math.abs(p[0]))) < 0.8, "玉は先端から 2.84m 下で幅 1m 足らず", JSON.stringify(ball.slice(0, 4)));
  const tSpan = Math.max(...tOut.map(([x]) => x)) - Math.min(...tOut.map(([x]) => x));
  ok(tSpan > 25 && tSpan < 27, "左右は絵の幅（約26m：ドームと左右の小塔）", tSpan.toFixed(1));
  ok(AL.TOWER_SHAPES.tinkerbell.viewFromTopM === 14 && o.viewBaseAngle > o.baseAngle && o.viewBaseAngle < A.targetElevationAngle(o.distanceKm, 4.3, tb.parts[0].m - 13),
    "図はシルエットの下の端（先端から14m）まで");

  // 2枚目の写真: 2024-11-29 04:52:23。月の位置から撮影地を逆算すると、11/30 の撮影地から 74m（ティンカーベルまで 694m）
  // 2026-10-05: 方位を楕円体で解くように直したので、同じ逆算で撮影地が視線に直角に 2.06m 動いた（35.639731, 139.871155 から）。
  // 球の方位は 0.10° 小さく、その誤りを撮影地の座標が吸っていた
  {
    const at2 = Date.UTC(2024, 10, 28, 19, 52, 23);
    const obs2 = { latitude: 35.6397478, longitude: 139.8711648, elevation: 2.8 };
    const o2 = AL.towerOutline(obs2, tb);
    const m2 = A.moon(at2, { ...obs2, elevation: 4.3 });
    ok(Math.abs(o2.distanceKm - 0.694) < 0.005, "撮影地からティンカーベルまで 694m", o2.distanceKm.toFixed(4));
    // 写真では月の直径 183px（半径 91.6px）、杖の先は月の中心の 17.7px 下・8px 左
    const pxDeg = m2.angularRadius / 91.56;
    ok(Math.abs((m2.apparentAltitude - o2.topAngle) - 17.7 * pxDeg) < 0.03, "杖の先は月の中心の 0.048° 下（写真と合う）",
      `${(m2.apparentAltitude - o2.topAngle).toFixed(3)}°`);
    ok(Math.abs(((m2.azimuth - o2.azimuth + 540) % 360) - 180 - 0.0216) < 0.02, "方位も写真どおり（月の中心が杖の先の 0.02° 右）",
      `${(((m2.azimuth - o2.azimuth + 540) % 360) - 180).toFixed(3)}°`);
    ok(m2.illuminatedFraction > 0.04 && m2.illuminatedFraction < 0.07, "写真と同じ細い月（5%）", `${(m2.illuminatedFraction * 100).toFixed(1)}%`);
    // 縮尺: 694m 先の 1m は 0.0826°。写真の 1m は 30.6px
    const mPx = (Math.atan(1 / 694) * 180 / Math.PI) / pxDeg;
    ok(Math.abs(mPx - 30.6) < 0.3, "写真の 1m は 30.6px（月の直径を物差しに）", mPx.toFixed(2));
  }

  // 逆引き（2026-10-03）: 写真の構図（月の中心が杖の先の 0.022° 右・0.048° 上）を置くと、逆算した撮影地と時刻が出る
  {
    const around = { latitude: 35.639731, longitude: 139.871155 };
    const at2 = Date.UTC(2024, 10, 28, 19, 52, 23);
    const r = await AL.solveComposition(tb, "moon", { around, distanceKm: 0.694, at0: at2 + 600000, dx: 0.022, dy: 0.048, groundM: 2.8 });
    ok(r && TR.distanceKm(around.latitude, around.longitude, r.latitude, r.longitude) * 1000 < 3, "逆引き: 写真の撮影地（3m 以内）",
      r && `${(TR.distanceKm(around.latitude, around.longitude, r.latitude, r.longitude) * 1000).toFixed(1)}m`);
    ok(r && Math.abs(r.at - at2) < 20000 && r.side === "rise", "逆引き: 写真の時刻（20秒以内）・月の出側", r && new Date(r.at).toISOString());
    // 解いた点から見ると、本当に置いた位置に来る
    const eye = { latitude: r.latitude, longitude: r.longitude, elevation: r.groundM + 1.5 };
    const g = AL.geometryFrom({ ...eye, elevation: r.groundM }, tb, { partId: tb.parts[0].id });
    const mm = A.moon(r.at, eye);
    const xy = AL.viewProjector(g.azimuth, g.angle)(mm.azimuth, mm.apparentAltitude);
    ok(Math.abs(xy[0] - 0.022) < 0.002 && Math.abs(xy[1] - 0.048) < 0.002, "逆引き: その点・時刻で円盤は置いた位置", xy.map((v) => v.toFixed(4)).join(", "));
    // 置き方を変えると立つ点が動く（上の縁を先端に＝月の中心を半径ぶん下へ）
    const r2 = await AL.solveComposition(tb, "moon", { around, distanceKm: 0.694, at0: at2, dx: 0, dy: -mm.angularRadius, groundM: 2.8 });
    // 694m 先では 3m 横へ動くと目標の方角が 0.25°（月の半径）変わる
    ok(r2 && TR.distanceKm(r.latitude, r.longitude, r2.latitude, r2.longitude) * 1000 > 1.5, "逆引き: 置く位置を変えると立つ点が動く（694m 先では数m）",
      r2 && `${(TR.distanceKm(r.latitude, r.longitude, r2.latitude, r2.longitude) * 1000).toFixed(0)}m`);
    // 道から遠すぎる所（同じ日・同じ距離では来ない所）は null
    const r3 = await AL.solveComposition(tb, "moon", { around, distanceKm: 0.694, at0: at2, dx: 0, dy: 40, groundM: 2.8, maxShiftMs: 3600000 });
    ok(r3 === null, "逆引き: 来ない所は null");
    // その日の中の解だけ（日付の境目で前後の日へ進まない）。11/29 の解を 11/28 の日として頼むと null
    const day29 = Date.UTC(2024, 10, 28, 15, 0, 0);   // 11/29 0:00 JST
    const ok29 = await AL.solveComposition(tb, "moon", { around, distanceKm: 0.694, at0: at2, dx: 0.022, dy: 0.048, groundM: 2.8, dayMs: day29 });
    const ng28 = await AL.solveComposition(tb, "moon", { around, distanceKm: 0.694, at0: at2, dx: 0.022, dy: 0.048, groundM: 2.8, dayMs: day29 - 86400000 });
    ok(ok29 && ng28 === null, "逆引き: その日の中の解だけ");
    // 確定した見え方になる場所は、距離を変えると線になる（地図に出す。2026-10-03）。確定点から距離を変えて解き継ぐと、
    // どの距離でも同じ側・その日の中で、円盤は置いた位置に来る
    {
      let prev = r;
      const chain = [];
      for (const d of [0.8, 1, 1.4, 2, 3]) {
        const q = await AL.solveComposition(tb, "moon", { around: prev, distanceKm: d, at0: prev.at, dx: 0.022, dy: 0.048, groundM: prev.groundM, dayMs: Date.UTC(2024, 10, 28, 15, 0, 0) });
        if (q) { chain.push(q); prev = q; }
      }
      ok(chain.length === 5 && chain.every((q) => q.side === r.side), "逆引きの線: 距離を変えても5点とも解け、同じ側", `${chain.length}点`);
      const worst = Math.max(...chain.map((q) => {
        const e = { latitude: q.latitude, longitude: q.longitude, elevation: q.groundM + 1.5 };
        const g2 = AL.geometryFrom({ ...e, elevation: q.groundM }, tb, { partId: tb.parts[0].id });
        const m2 = A.moon(q.at, e);
        const p2 = AL.viewProjector(g2.azimuth, g2.angle)(m2.azimuth, m2.apparentAltitude);
        return Math.hypot(p2[0] - 0.022, p2[1] - 0.048);
      }));
      ok(worst < 0.003, "逆引きの線: どの距離の点でも円盤は置いた位置（0.003° 以内）", worst.toFixed(5));
      ok(chain.every((q, i) => Math.abs(q.distanceKm - [0.8, 1, 1.4, 2, 3][i]) < 1e-9)
        && chain.some((q) => TR.distanceKm(r.latitude, r.longitude, q.latitude, q.longitude) > 0.1), "逆引きの線: 距離ごとに立つ点が動く（線になる）");
    }
    const U = AL.viewUnprojector(120, 4), P = AL.viewProjector(120, 4), q = U(0.3, -0.2), back = P(q[0], q[1]);
    ok(Math.abs(back[0] - 0.3) < 1e-9 && Math.abs(back[1] + 0.2) < 1e-9, "図の座標→方位・高さ→図の座標で戻る");
  }

  // 4つの形と、他の建物・山
  const st = AL.towerOutline(TAKAO, skytree, { eyeM: 1.5 });
  const topSt = A.targetElevationAngle(st.distanceKm, TAKAO.elevation + 1.5, 636);
  ok(Math.abs(st.topAngle - topSt) < 1e-9, "スカイツリーの上端は先端の見上げ角");
  const baseW = (Math.max(...st.points.map((p) => p[0])) - Math.min(...st.points.map((p) => p[0])));
  const want = Math.atan(68 / (st.distanceKm * 1000)) * 180 / Math.PI;
  const sw = AL.TOWER_SHAPES.skytree.outline;
  const wAt = (h0, h1) => { const q = sw.filter((p) => p[1] >= h0 && p[1] <= h1); return Math.max(...q.map((p) => p[0])) - Math.min(...q.map((p) => p[0])); };
  ok(Math.abs(sw[sw.length - 1][0] - sw[0][0] - 68) < 0.5, "足もとの幅は一辺68m", (sw[sw.length - 1][0] - sw[0][0]).toFixed(1));
  ok(Math.abs(wAt(341, 372) - 62.5) < 5, "天望デッキの幅は写真の実測（62.5m。縁の張り出しを含めて ±5m）", wAt(341, 372).toFixed(1));
  ok(wAt(440, 458) > 33 && wAt(440, 458) < 41, "天望回廊の幅は写真の実測（37m）", wAt(440, 458).toFixed(1));
  ok(Math.max(...sw.map((p) => p[1])) === 634, "先端は 634m");
  // ユーザーの写真（35.707668, 139.798313 から 1,150m）: 天望回廊の高さの位置が写真と合う（先端とデッキから決めた縮尺で予測 617px、写真 612px）
  ok(baseW > want * 0.9, "足もとの見かけの幅", baseW.toFixed(4));
  const tt = AL.towerOutline(TAKAO, AL.targetById("tokyotower"));
  ok(tt.known && tt.points.length > 30, "東京タワーは作り込んだ形", `${tt.points.length}点`);
  {
    const tw = AL.TOWER_SHAPES.tokyotower.outline;
    const wAt = (h0, h1) => { const q = tw.filter((p) => p[1] >= h0 && p[1] <= h1); return Math.max(...q.map((p) => p[0])) - Math.min(...q.map((p) => p[0])); };
    ok(Math.max(...tw.map((p) => p[1])) === 333, "東京タワーの先は 333m");
    // ユーザーの写真（真南 424m）で測った: メインデッキ 地上112〜131m・幅 44m（斜めに見える）
    ok(Math.abs(wAt(112, 131) - 44) < 5, "メインデッキの幅は写真の実測（44m）", wAt(112, 131).toFixed(1));
    ok(wAt(135, 220) < wAt(112, 131), "メインデッキは上の塔より張り出す");
  }
  const cin = AL.towerOutline(TAKAO, AL.targetById("cinderella"));
  ok(cin.known && cin.points.length > 40, "シンデレラ城は左右の小塔まで描く", `${cin.points.length}点`);
  ok(Math.abs(Math.max(...cin.points.map((p) => p[1])) - cin.topAngle) < 1e-9, "シンデレラ城の上端は尖塔");
  // 城の位置は OpenStreetMap の建物の中心（2026-10-02 まで 95m 北西にずれていた）。形はユーザーの写真（2024-08-20 19:02、西北西 3.7km）から
  const ct = AL.targetById("cinderella");
  ok(TR.distanceKm(ct.latitude, ct.longitude, 35.6320784, 139.8808364) * 1000 < 10, "シンデレラ城は建物の中心に置く");
  const cw = AL.TOWER_SHAPES.cinderella.outline;
  ok(Math.max(...cw.map((p) => p[1])) === 51 && cw[0][1] === 0 && cw[cw.length - 1][1] === 0, "写真の輪郭: 尖塔の先が51m、両端は地面まで");
  const span = cw[cw.length - 1][0] - cw[0][0];
  // シルエットをそのまま、尖塔の先 51m・絵の下の端を地面に（2026-10-03。写真の縮尺に合わせると下の端が地上18m に浮いて「形へんてこりん」だった）
  ok(span > 27 && span < 33, "幅はシルエットの絵のまま（30m 前後）", `${span.toFixed(1)}m`);
  ok(AL.TOWER_SHAPES.cinderella.hiddenBelowM === undefined, "城の下の段（角の小塔・城壁）も描く（木の線で切らない）");
  // 観測地点ごとに比が合う（ユーザー「この比率って観測地点によってちゃんと合うように計算で出せるよね？」）: 形はメートルで持ち、
  // 見かけの大きさは距離で割る。2倍離れると形の見かけの幅は半分、月の見かけの大きさはそのまま
  for (const id of ["skytree", "tokyotower", "cinderella", "tinkerbell"]) {
    const t = AL.targetById(id);
    const near = TR.destination(t.latitude, t.longitude, 270, 3), far = TR.destination(t.latitude, t.longitude, 270, 6);
    const wOf = (o) => Math.max(...o.points.map((p) => p[0])) - Math.min(...o.points.map((p) => p[0]));
    const r = wOf(AL.towerOutline({ ...near, elevation: 3 }, t)) / wOf(AL.towerOutline({ ...far, elevation: 3 }, t));
    ok(Math.abs(r - 2) < 0.02, `${t.name}: 3km と 6km で見かけの幅は2倍`, r.toFixed(3));
  }
  // 写真の場面を再現する: 2024-08-20 19:02:04、城の西北西 2.85km から。尖塔の先は月の中心より 0.26° 上（写真: 上の縁のさらに 0.026° 上）
  {
    const spot = TR.destination(ct.latitude, ct.longitude, 284.99, 2.85);
    const mo = A.moon(Date.UTC(2024, 7, 20, 10, 2, 4), { ...spot, elevation: 2 + 1.5 });
    const co = AL.towerOutline({ ...spot, elevation: 2 }, ct);
    ok(Math.abs((co.topAngle - mo.apparentAltitude) - 0.267) < 0.05, "写真どおり尖塔の先が月の上の縁より上に出る", `${(co.topAngle - mo.apparentAltitude).toFixed(3)}°`);
    ok(Math.abs(((mo.azimuth - co.azimuth + 540) % 360) - 180 - 0.0185) < 0.06, "月の中心は尖塔のすぐ右（写真で 0.019°）", `${(((mo.azimuth - co.azimuth + 540) % 360) - 180).toFixed(3)}°`);
  }
  const bld = { id: "custom", name: "ビル", latitude: 35.68, longitude: 139.70, groundM: 30, parts: [{ id: "tip", m: 130 }] };
  const sc = AL.towerOutline(TAKAO, bld);
  ok(sc.schematic && !sc.known, "他の建物は模式図");
  ok(sc.points.length === 4, "模式図は四角（幅は高さから推定）");
  ok(AL.towerOutline(TAKAO, fuji) === null, "山は形を持たない（標高データの稜線で描く）");

  // 図の範囲: 円盤6つぶんの高さは取り、広げるのは上へ
  const w = AL.viewWindow({ azimuth: 100, baseAngle: 0, topAngle: 0.5, radiusDeg: 0.25, aspect: 1.4 });
  // 目標の大きさをそろえる（図の高さの6割）。円盤は本当の比で、直径が図の高さの4割を超えるときだけ範囲を広げる（2026-10-03）
  ok(2 * w.halfH >= 5 * 0.25 - 1e-9 && w.alt0 - w.halfH < 0 && w.alt0 - w.halfH > -0.05, "小さく見える目標: 円盤の直径は図の高さの4割まで。下は根元のすぐ下", JSON.stringify(w));
  const big = AL.viewWindow({ azimuth: 100, baseAngle: 0, topAngle: 3, radiusDeg: 0.25, aspect: 1.4 });
  ok(Math.abs(3 / (2 * big.halfH) - 0.62) < 0.01, "大きく見える目標は図の高さの6割", (3 / (2 * big.halfH)).toFixed(3));
  ok(Math.abs(w.halfW - w.halfH * 1.4) < 1e-9, "横は図の縦横比");
  // 近い塔（見上げ 29°）: 写したあとの上の端まで入る。重なる時刻の円盤（先端より上）も入れる
  {
    const big = AL.viewWindow({ azimuth: 76.6, baseAngle: -0.1, topAngle: 28.8, radiusDeg: 0.27, aspect: 1.39, include: [29.6] });
    const P = AL.viewProjector(big.az0, big.alt0);
    ok(P(76.6, 29.6 + 0.27)[1] <= big.halfH, "円盤の上の縁まで図に入る", `${P(76.6, 29.87)[1].toFixed(2)} <= ${big.halfH.toFixed(2)}`);
    ok(P(76.6, -0.1)[1] >= -big.halfH, "根元も図に入る");
  }
  // 割合は写したあとの長さで測る（Codex: 角度で割ると、見上げの大きい塔で6割にならない）
  for (const [base, top, r, inc] of [[0, 3, 0.25, []], [-0.1, 28.8, 0.27, []], [-0.1, 28.8, 0.27, [28.9]], [2.0, 4.3, 0.247, [4.31]]]) {
    const v = AL.viewWindow({ azimuth: 90, baseAngle: base, topAngle: top, radiusDeg: r, aspect: 1.2, include: inc });
    const P = AL.viewProjector(v.az0, v.alt0);
    const frac = (P(90, top)[1] - P(90, base)[1]) / (2 * v.halfH);
    const disc = inc.length ? (P(90, inc[0] + r)[1] - P(90, inc[0] - r)[1]) / (2 * v.halfH) : 0;
    ok(Math.abs(frac - 0.62) < 0.012, `目標は写したあと図の高さの6割（見上げ ${top}°）`, frac.toFixed(3));
    ok(disc <= 0.405, `円盤の直径は図の高さの4割まで（見上げ ${top}°）`, disc.toFixed(3));
    ok(inc.every((a) => P(90, a + 1.2 * r)[1] <= v.halfH && P(90, a - 1.2 * r)[1] >= -v.halfH), `円盤は図に入る（見上げ ${top}°）`);
  }

  // 道: 重なる時刻を必ず含み、20秒刻みで図の外まで
  const win = AL.viewWindow({ azimuth: o.azimuth, baseAngle: o.viewBaseAngle, topAngle: o.topAngle, radiusDeg: m.angularRadius, aspect: 1.39 });
  const proj = AL.viewProjector(win.az0, win.alt0);
  const path = AL.viewPath("moon", eyeObs, at, proj, win);
  ok(path.some((p) => p.at === at), "重なる時刻の点がある");
  ok(path.every((p, i) => i === 0 || p.at - path[i - 1].at === 20000), "20秒刻み");
  const out = (p) => Math.abs(p.x) > win.halfW || Math.abs(p.y) > win.halfH;
  ok(out(path[0]) && out(path[path.length - 1]), "両端は図の外まで", `${path.length}点`);
  ok(path.every((p) => Number.isFinite(p.brightLimbZenithAngle) && Number.isFinite(p.illuminated)), "月の点は欠けの向きと割合を持つ");
}

console.log("== 写真と合う: 2026-10-03 鷺沼北公園の撮影地→スカイツリーと月（2026-10-05） ==");
// ユーザーの連写（500mm・1秒ごと19コマ、時計はスマホと合わせてある）を測った値: 月の中心が塔の軸を横切るとき、中心は先端の 13.75′ 下、
// 時刻は 22:22:36。撮影地はユーザー指定（35.584055, 139.568552）、地面は国土地理院1mメッシュの 86.9m。
// 方位を球で解いていた頃は 20.4′ 下・66秒早いと予測していた（月が予測より約7′上を通った）
{
  const obs = { latitude: 35.584055, longitude: 139.568552, elevation: 86.9 }, eye = { ...obs, elevation: 88.4 };
  const A = require("./sorami-astro.js"), sky = AL.targetById("skytree"), g = AL.geometryFrom(obs, sky, { eyeM: 1.5 });
  const rel = (t) => { const m = A.moon(t, eye); return ((m.azimuth - g.azimuth + 540) % 360) - 180; };
  let lo = Date.parse("2026-10-03T22:21:30+09:00"), hi = Date.parse("2026-10-03T22:23:30+09:00");
  for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; if (rel(mid) < 0) lo = mid; else hi = mid; }
  const cross = (lo + hi) / 2, below = (A.moon(cross, eye).apparentAltitude - g.angle) * 60;
  ok(Math.abs(below + 13.75) < 1, "月の中心が塔の軸を横切る高さは写真どおり（先端の 13.75′ 下）", `${below.toFixed(2)}′`);
  const dt = (cross - Date.parse("2026-10-03T22:22:36.1+09:00")) / 1000;
  ok(Math.abs(dt) < 30, "横切る時刻も写真と30秒以内（撮影地の指定が十数mずれると十数秒動く）", `${dt.toFixed(1)}秒`);
}

console.log("== 候補地は選んだ合わせ方どおり（2026-10-02） ==");
// ユーザー「上の縁を選んでるのに上の縁が先端に重ならなかったりする」: 半径の2倍ずれた所まで「重なる」として出していた
{
  const fs = await import("node:fs");
  const A = require("./sorami-astro.js");
  const j = JSON.parse(fs.readFileSync(new URL("./data/aim-places.json", import.meta.url), "utf8"));
  const places = j.places.map((r, i) => ({ id: `p${i}`, name: r.n || "", kind: j.kinds[r.k] || "", shape: r.s === "a" ? "area" : r.s === "l" ? "line" : "point",
    latitude: r.p[0] / 1e5, longitude: r.p[1] / 1e5, elevationM: r.e, deckM: r.d || 0,
    g: r.g ? r.g.map((v, k) => (j.gRelative ? v + r.p[k % 2] : v)) : null, reachM: 300 }))
    .filter((p) => Math.abs(p.latitude - 35.7) < 0.35 && Math.abs(p.longitude - 139.8) < 0.45);
  const sign = { onTop: 1, center: 0, behind: -1 };
  let worst = 0, n = 0;
  for (const id of ["skytree", "tokyotower"]) for (const limb of ["onTop", "center", "behind"]) {
    const t = AL.targetById(id);
    const lines = await AL.line(t, "sun", Date.parse("2026-10-20T00:00:00+09:00"), { partId: "tip", limb });
    const cs = await AL.candidates(lines, places, t, "sun", { partId: "tip", limb });
    for (const c of cs) {
      const obs = { latitude: c.stand.latitude, longitude: c.stand.longitude, elevation: c.stand.elevationM };
      const eyeM = 1.5 + (c.place.deckM || 0);
      const st = A.sun(c.at, { ...obs, elevation: obs.elevation + eyeM });
      const top = AL.towerOutline(obs, t, { eyeM }).topAngle;
      worst = Math.max(worst, Math.abs(st.apparentAltitude - sign[limb] * st.angularRadius - top) / st.angularRadius);
      n++;
    }
  }
  ok(n > 50 && worst <= AL.LIMB_FIT + 1e-6, "選んだ縁と先端のずれは半径の2割以内（図でも縁が先端に触れて見える）", `${n}か所・最大 ${worst.toFixed(3)}`);
}

console.log(`\n${fail === 0 ? "ALIGN OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
