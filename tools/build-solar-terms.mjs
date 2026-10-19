// sorami-solar-terms.js を作る（2026-10-19）。
// 二十四節気・七十二候の境目（太陽の視黄経が5°の倍数になる時刻）を astronomy-engine で前もって計算し、表として持たせる。
// アプリの低精度の太陽計算（AA 25、0.01°）では節気の時刻が最大14分ずれるため（暦要項2026と比較）、実行時には使わない。
// 候名・よみ：国立天文台 暦Wiki「季節/七十二候」の「宝暦暦以降」の列と「よみ」
//   https://eco.mtk.nao.ac.jp/koyomi/wiki/B5A8C0E12FBCB7BDBDC6F3B8F5.html （2025-11-28 更新版を 2026-10-19 に照合）
// 英語名は国立天文台の資料に無い、一般に使われる英訳。
// 使い方：node tools/build-solar-terms.mjs  → ルートの sorami-solar-terms.js を書き換える
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
const require = createRequire(import.meta.url);
const A = require('../vendor/astronomy-engine-2.1.19.min.js');

const SEKKI = [['立春','Beginning of Spring'],['雨水','Rain Water'],['啓蟄','Awakening of Insects'],['春分','Spring Equinox'],['清明','Pure Brightness'],['穀雨','Grain Rain'],['立夏','Beginning of Summer'],['小満','Grain Buds'],['芒種','Grain in Ear'],['夏至','Summer Solstice'],['小暑','Minor Heat'],['大暑','Major Heat'],['立秋','Beginning of Autumn'],['処暑','End of Heat'],['白露','White Dew'],['秋分','Autumnal Equinox'],['寒露','Cold Dew'],['霜降','Frost Descent'],['立冬','Beginning of Winter'],['小雪','Minor Snow'],['大雪','Major Snow'],['冬至','Winter Solstice'],['小寒','Minor Cold'],['大寒','Major Cold']];
const KOU = [['東風解凍','はるかぜこおりをとく'],['黄鶯睍睆','うぐいすなく'],['魚上氷','うおこおりをいずる'],
 ['土脉潤起','つちのしょううるおいおこる'],['霞始靆','かすみはじめてたなびく'],['草木萌動','そうもくめばえいずる'],
 ['蟄虫啓戸','すごもりむしとをひらく'],['桃始笑','ももはじめてさく'],['菜虫化蝶','なむしちょうとなる'],
 ['雀始巣','すずめはじめてすくう'],['桜始開','さくらはじめてひらく'],['雷乃発声','かみなりすなわちこえをはっす'],
 ['玄鳥至','つばめきたる'],['鴻雁北','こうがんかえる'],['虹始見','にじはじめてあらわる'],
 ['葭始生','あしはじめてしょうず'],['霜止出苗','しもやんでなえいずる'],['牡丹華','ぼたんはなさく'],
 ['蛙始鳴','かわずはじめてなく'],['蚯蚓出','みみずいずる'],['竹笋生','たけのこしょうず'],
 ['蚕起食桑','かいこおきてくわをはむ'],['紅花栄','べにばなさかう'],['麦秋至','むぎのときいたる'],
 ['蟷螂生','かまきりしょうず'],['腐草為蛍','くされたるくさほたるとなる'],['梅子黄','うめのみきばむ'],
 ['乃東枯','なつかれくさかるる'],['菖蒲華','あやめはなさく'],['半夏生','はんげしょうず'],
 ['温風至','あつかぜいたる'],['蓮始開','はすはじめてひらく'],['鷹乃学習','たかすなわちわざをならう'],
 ['桐始結花','きりはじめてはなをむすぶ'],['土潤溽暑','つちうるおうてむしあつし'],['大雨時行','たいうときどきにふる'],
 ['涼風至','すずかぜいたる'],['寒蝉鳴','ひぐらしなく'],['蒙霧升降','ふかききりまとう'],
 ['綿柎開','わたのはなしべひらく'],['天地始粛','てんちはじめてさむし'],['禾乃登','こくものすなわちみのる'],
 ['草露白','くさのつゆしろし'],['鶺鴒鳴','せきれいなく'],['玄鳥去','つばめさる'],
 ['雷乃収声','かみなりすなわちこえをおさむ'],['蟄虫坏戸','むしかくれてとをふさぐ'],['水始涸','みずはじめてかるる'],
 ['鴻雁来','こうがんきたる'],['菊花開','きくのはなひらく'],['蟋蟀在戸','きりぎりすとにあり'],
 ['霜始降','しもはじめてふる'],['霎時施','こさめときどきふる'],['楓蔦黄','もみじつたきばむ'],
 ['山茶始開','つばきはじめてひらく'],['地始凍','ちはじめてこおる'],['金盞香','きんせんかさく'],
 ['虹蔵不見','にじかくれてみえず'],['朔風払葉','きたかぜこのはをはらう'],['橘始黄','たちばなはじめてきばむ'],
 ['閉塞成冬','そらさむくふゆとなる'],['熊蟄穴','くまあなにこもる'],['鱖魚群','さけのうおむらがる'],
 ['乃東生','なつかれくさしょうず'],['麋角解','さわしかのつのおつる'],['雪下出麦','ゆきくだりてむぎのびる'],
 ['芹乃栄','せりすなわちさかう'],['水泉動','しみずあたたかをふくむ'],['雉始雊','きじはじめてなく'],
 ['款冬華','ふきのはなさく'],['水沢腹堅','さわみずこおりつめる'],['鶏始乳','にわとりはじめてとやにつく']];
if (SEKKI.length !== 24 || KOU.length !== 72) throw Error('table size');

// アプリの対応期間（2020〜2030年）を前後に少し広げて、5°ごとの境目をすべて求める
const BASE = Date.UTC(2019, 11, 1), END = Date.UTC(2031, 0, 31);
let t = new Date(BASE), lon = Math.ceil(A.SunPosition(t).elon / 5) * 5 % 360;
const firstLon = lon, minutes = [];
while (true) {
  const hit = A.SearchSunLongitude(lon, t, 30);
  if (!hit) throw Error('search failed at ' + lon);
  if (hit.date.getTime() > END) break;
  minutes.push(Math.round((hit.date.getTime() - BASE) / 60000));
  t = new Date(hit.date.getTime() + 86400000); lon = (lon + 5) % 360;
}

const src = `/* 二十四節気・七十二候（生成物。直接編集しない。生成元：tools/build-solar-terms.mjs）
   境目＝太陽の視黄経が5°の倍数になる時刻を astronomy-engine で前もって計算した表（2019-12〜2031-01）。
   候名・よみ：国立天文台 暦Wiki「季節/七十二候」の「宝暦暦以降」。英語名は一般的な英訳（国立天文台の資料には無い）。 */
(function (g) {
'use strict';
const SEKKI = ${JSON.stringify(SEKKI)};
const KOU = ${JSON.stringify(KOU)};
const BASE = ${BASE}, FIRST_LON = ${firstLon};
const MINUTES = [${minutes.join(',')}];
const POS = ['初候', '次候', '末候'];
const atOf = (i) => BASE + MINUTES[i] * 60000;
const lonOf = (i) => (FIRST_LON + 5 * i) % 360;
// 立春（315°）を0番とした候の番号
const kouIndex = (lon) => Math.round(((lon - 315) % 360 + 360) % 360 / 5) % 72;
function describe(ms) {
  if (!Number.isFinite(ms) || ms < atOf(0) || ms >= atOf(MINUTES.length - 1)) return null;
  let lo = 0, hi = MINUTES.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (atOf(mid) <= ms) lo = mid; else hi = mid; }
  const k = kouIndex(lonOf(lo)), s = Math.floor(k / 3);
  let next = null;
  for (let j = lo + 1; j < MINUTES.length; j++) if (kouIndex(lonOf(j)) % 3 === 0) { next = { ja: SEKKI[kouIndex(lonOf(j)) / 3][0], at: atOf(j) }; break; }
  return { sekki: { ja: SEKKI[s][0], en: SEKKI[s][1], since: atOf(lo - (k % 3)) }, kou: { ja: KOU[k][0], kana: KOU[k][1], pos: POS[k % 3], since: atOf(lo) }, next, longitude: lonOf(lo) };
}
// 検査用：境目の時刻（黄経と時刻）
const boundaries = () => MINUTES.map((m, i) => ({ longitude: lonOf(i), at: atOf(i) }));
const api = Object.freeze({ describe, boundaries, SEKKI, KOU });
g.SoramiSolarTerms = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
`;
writeFileSync(new URL('../sorami-solar-terms.js', import.meta.url), src);
console.log(`sorami-solar-terms.js: ${minutes.length} boundaries from ${firstLon}°`);
