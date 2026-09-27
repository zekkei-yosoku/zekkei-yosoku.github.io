/*
 * 霧氷とダイヤモンドダストの「寒さ」の扱い。**通信しない。**
 *
 * どちらも、氷点下であること自体が現象の必要条件。加点項目ではない。
 * 2026-09-24 まで気温は加点でしかなく、国師ヶ岳（2592m・9月下旬）で
 *   霧氷 +4.9℃・湿度99%・微風 → 59点
 *   ダイヤモンドダスト −3℃ 前後・晴れ・微風 → 9〜18点
 * が出ていた（ユーザー指摘）。寒さが足りない日は出ない、を固定する。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");

let pass = 0, fail = 0;
const ok = (c, label, detail = "") => {
  if (c) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  " + detail : ""}`); }
};

const day = Date.UTC(2026, 8, 26) - 9 * 3600000;      // JST 2026-09-26 00:00
const times = Array.from({ length: 72 }, (_, i) => day + i * 3600000);
const series = ({ temp, humidity = 99, wind = 0.8, cloud = 5 }) => new S.Series(times, {
  temperature_2m: times.map(() => temp),
  relative_humidity_2m: times.map(() => humidity),
  wind_speed_10m: times.map(() => wind),
  cloud_cover: times.map(() => cloud),
  precipitation: times.map(() => 0),
});
const run = (id, opts, { elevation = 2592, terrain = "summit" } = {}) => {
  const input = { home: series(opts), offsets: {}, lat: 35.8967, lon: 138.7139,
    terrain, elevation, lightPollution: null, air: null };
  const w = S.SCORERS[id].window(day + 24 * 3600000, input);
  return S.SCORERS[id].score(w, input);
};

console.log("== 霧氷: 氷点下にならない日は対象外 ==");
{
  const warm = run("rime", { temp: 4.9 });
  ok(!!warm.unavailable, "+4.9℃・湿度99%・微風でも採点しない", JSON.stringify(warm.score));
  ok(warm.unavailable && /氷点下/.test(warm.unavailable.message), "理由に氷点下と書く",
    warm.unavailable && warm.unavailable.message);
  const zero = run("rime", { temp: 0.2 });
  ok(!!zero.unavailable, "+0.2℃でも対象外（0℃を超えたら着かない）");
}

console.log("== 霧氷: 寒さで頭を押さえる ==");
{
  const near = run("rime", { temp: -1 });           // 氷点下だが −5℃ に届かない
  const cold = run("rime", { temp: -8 });           // 育つ寒さ
  ok(!near.unavailable && !cold.unavailable, "どちらも採点する");
  ok(near.score < 45, "0℃ぎりぎりは高くならない", `${Math.round(near.score)}点`);
  ok(cold.score > near.score + 25, "−8℃のほうがはっきり高い",
    `${Math.round(cold.score)} / ${Math.round(near.score)}`);
  ok(near.factors.some((f) => /では、ここまで/.test(f.label)), "頭を押さえた理由を内訳に出す");
  // 気温の満点は −12℃。−8℃では 35点満点中 15点ぶんなので 90点には届かない（仕様どおり）
  ok(cold.score >= 70, "条件が揃った日はこれまでどおり高い", `${Math.round(cold.score)}点`);
  const colder = run("rime", { temp: -13 });
  // 風速 0.8m/s は最適帯（1〜5）のわずかに外なので、満点からは少し下がる
  ok(colder.score >= 90, "−12℃以下は気温も満点に近づく", `${Math.round(colder.score)}点`);
}

console.log("== 霧氷: 山でなければ対象外（従来どおり）==");
{
  const plain = run("rime", { temp: -8 }, { terrain: "plain" });
  ok(!!plain.unavailable, "平地は対象外");
  const low = run("rime", { temp: -8 }, { elevation: 100, terrain: "basinRim" });
  ok(!!low.unavailable, "標高500m未満は対象外");
}

console.log("== 霧氷: 氷点下でも、霧に包まれなければ着かない ==");
{
  // 2026-09-27 ユーザー指摘「国師ヶ岳で霧氷が出る。絶対にないよね」。
  // 本番の実測: 10/07 湿度84%・風速0.6m/s・気温-0.6℃ で **28点**、
  // 10/10 湿度48%・気温2.5℃（最低は氷点下）で **25点**。
  // 上限25点が実質「下限25点」として働き、乾いた日にも点が並んでいた。
  const dry = run("rime", { temp: -0.6, humidity: 84, wind: 0.6 });
  ok(!!dry.unavailable, "−0.6℃でも湿度84%なら採点しない", JSON.stringify(dry.score));
  ok(dry.unavailable && /霧/.test(dry.unavailable.message), "理由に霧と書く",
    dry.unavailable && dry.unavailable.message);
  ok(dry.unavailable && /84/.test(dry.unavailable.message), "いちばん湿ったときの値を出す",
    dry.unavailable && dry.unavailable.message);

  const veryDry = run("rime", { temp: -3, humidity: 48 });
  ok(!!veryDry.unavailable, "湿度48%は論外");

  // 霧の中（95%以上）で氷点下なら、これまでどおり採点する
  const foggy = run("rime", { temp: -3, humidity: 97, wind: 2 });
  ok(!foggy.unavailable && foggy.score > 0, "氷点下＋霧なら採点する", JSON.stringify(foggy.score));
  ok((foggy.factors || []).some((f) => /氷点下の霧/.test(f.label)), "内訳に氷点下の霧の時間を出す",
    (foggy.factors || []).map((f) => f.label).join(" / "));
}

console.log("== 霧氷: 霧の時間が短い日は頭打ち ==");
{
  // 窓は 0〜9時。そのうち氷点下＋霧が2時間だけの日を作る
  const t = Array.from({ length: 72 }, (_, i) => day + i * 3600000);
  const hourJst = (ms) => new Date(ms + 9 * 3600000).getUTCHours();
  const input = {
    home: new S.Series(t, {
      temperature_2m: t.map(() => -3),
      // 2時間だけ霧。あとは乾いている
      relative_humidity_2m: t.map((ms) => ([3, 4].includes(hourJst(ms)) ? 98 : 70)),
      wind_speed_10m: t.map(() => 2),
      cloud_cover: t.map(() => 5),
      precipitation: t.map(() => 0),
    }),
    offsets: {}, lat: 35.8967, lon: 138.7139,
    terrain: "summit", elevation: 2592, lightPollution: null, air: null,
  };
  const w = S.SCORERS.rime.window(day + 24 * 3600000, input);
  const short = S.SCORERS.rime.score(w, input);
  ok(!short.unavailable, "2時間でも採点はする");
  ok(short.score <= 63, "4時間に満たないぶん頭を押さえる", JSON.stringify(short.score));

  // 霧の時間が長い日のほうが高い
  const longer = { ...input, home: new S.Series(t, {
    temperature_2m: t.map(() => -3),
    relative_humidity_2m: t.map((ms) => (hourJst(ms) >= 1 && hourJst(ms) <= 8 ? 98 : 70)),
    wind_speed_10m: t.map(() => 2),
    cloud_cover: t.map(() => 5),
    precipitation: t.map(() => 0),
  }) };
  const wide = S.SCORERS.rime.score(S.SCORERS.rime.window(day + 24 * 3600000, longer), longer);
  ok(wide.score > short.score, "霧が長いほど高い",
    `${Math.round(short.score)} → ${Math.round(wide.score)}`);
  // 上限がかかるときは、理由を内訳に出す（かからない日は出さない）
  const capped = (wide.factors || []).some((f) => /ここまで/.test(f.label || ""));
  ok(wide.score <= 100 && (!capped || /霧|気温/.test((wide.factors || []).find((f) => /ここまで/.test(f.label || "")).label)),
    "上限がかかるときは理由を書く", (wide.factors || []).map((f) => f.label).join(" / "));
}

console.log("== ダイヤモンドダスト: −10℃に届かなければ 0点 ==");
{
  const mild = run("diamondDust", { temp: -3, cloud: 0, wind: 0.5 });
  ok(!mild.unavailable, "採点はする（欠測ではない）");
  ok(Math.round(mild.score) === 0, "晴れて無風でも 0点", `${Math.round(mild.score)}点`);
  ok(mild.factors.every((f) => f.c === 0), "加点を1つも付けない");
  const warm = run("diamondDust", { temp: 3 });
  ok(!!warm.unavailable, "氷点下にならない日は対象外（従来どおり）");
}

console.log("== ダイヤモンドダスト: 出典の帯はこれまでどおり ==");
{
  const extreme = run("diamondDust", { temp: -16, cloud: 0, wind: 0.5 });
  ok(extreme.score >= 84, "−15℃以下は観測どおり高い", `${Math.round(extreme.score)}点`);
  const between = run("diamondDust", { temp: -12, humidity: 95, cloud: 0, wind: 0.5 });
  ok(between.score > 0 && between.score < extreme.score, "−15〜−10℃はその下",
    `${Math.round(between.score)}点`);
}

console.log("== 「起きない」と言ったモデルも母数に入れる ==");
{
  // 2026-09-27 国師ヶ岳 10/05 の実測: ECMWF 2本が +3℃（＝着かない）、GFS/JMA が −5〜−6℃。
  // 「着かない」の2本が母数から黙って抜け、残る2本だけで **64点・信頼度B** と出ていた。
  const t = Array.from({ length: 72 }, (_, i) => day + i * 3600000);
  const mk = (temp, humidity) => new S.Series(t, {
    temperature_2m: t.map(() => temp),
    relative_humidity_2m: t.map(() => humidity),
    wind_speed_10m: t.map(() => 2),
    cloud_cover: t.map(() => 5),
    precipitation: t.map(() => 0),
  });
  const byModel = {};
  const warm = ["ecmwf_ifs025", "ecmwf_aifs025_single"];
  const cold = ["gfs_seamless", "jma_gsm"];
  for (const m of warm) byModel[m] = mk(3, 97);
  for (const m of cold) byModel[m] = mk(-6, 97);
  const place = { latitude: 35.8967, longitude: 138.7139, elevation: 2592, terrain: "summit" };
  const bundle = { home: { grid: { elevation: 2592 }, byModel }, sunsetOffsets: null,
    sunriseOffsets: null, air: null, ensemble: null, utcOffsetSeconds: 32400 };
  const ev = S.evaluate("rime", day + 24 * 3600000, bundle, place, { asOf: day });
  ok(ev && !ev.unavailable, "採点する");
  ok(ev.models === 4, "4モデルすべてを数える", `${ev.models}モデル`);
  ok(Math.min(...ev.spread) === 0, "「着かない」は0点として入る", JSON.stringify(ev.spread.map(Math.round)));
  // 全部が「着く」と言う日と比べて、はっきり下がる（中央値なので半分に近い）
  const allCold = { ...bundle, home: { grid: { elevation: 2592 },
    byModel: Object.fromEntries([...warm, ...cold].map((m) => [m, mk(-6, 97)])) } };
  const unanimous = S.evaluate("rime", day + 24 * 3600000, allCold, place, { asOf: day });
  ok(ev.score < unanimous.score * 0.6, "半分が着かないと言う日は、揃った日の6割未満",
    `${Math.round(ev.score)}点 ← 全部が着くなら ${Math.round(unanimous.score)}点`);

  // 全モデルが「着かない」なら、これまでどおり行ごと畳む（夏に霧氷の行を出さない）
  const allWarm = { ...bundle, home: { grid: { elevation: 2592 },
    byModel: Object.fromEntries([...warm, ...cold].map((m) => [m, mk(12, 60)])) } };
  const summer = S.evaluate("rime", day + 24 * 3600000, allWarm, place, { asOf: day });
  ok(!!summer.unavailable, "全モデルが着かないなら判定対象外のまま",
    summer.unavailable && summer.unavailable.message);
}

console.log(`\n${fail === 0 ? "COLD OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
