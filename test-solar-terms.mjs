// 二十四節気・七十二候と太陽の絵（2026-10-19）
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
const require = createRequire(import.meta.url);
const T = require('./sorami-solar-terms.js'), sun = require('./sorami-sun-portrait.js');

// 国立天文台 令和8年(2026)暦要項 二十四節気（中央標準時）https://eco.mtk.nao.ac.jp/koyomi/yoko/2026/rekiyou262.html
const NAO_2026 = [[285,'01-05T17:23'],[300,'01-20T10:45'],[315,'02-04T05:02'],[330,'02-19T00:52'],[345,'03-05T22:59'],[0,'03-20T23:46'],[15,'04-05T03:40'],[30,'04-20T10:39'],[45,'05-05T20:49'],[60,'05-21T09:37'],[75,'06-06T00:48'],[90,'06-21T17:25'],[105,'07-07T10:57'],[120,'07-23T04:13'],[135,'08-07T20:43'],[150,'08-23T11:19'],[165,'09-07T23:41'],[180,'09-23T09:05'],[195,'10-08T15:29'],[210,'10-23T18:38'],[225,'11-07T18:52'],[240,'11-22T16:23'],[255,'12-07T11:53'],[270,'12-22T05:50']];
test('二十四節気の時刻が国立天文台の暦要項2026と1分以内で一致する', () => {
  const b = T.boundaries();
  for (const [lon, md] of NAO_2026) {
    const t = Date.parse(`2026-${md}:00+09:00`), hit = b.find((x) => x.longitude === lon && Math.abs(x.at - t) < 86400000);
    assert.ok(hit, `${lon}°`); assert.ok(Math.abs(hit.at - t) <= 60000, `${lon}° ${(hit.at - t) / 60000} min`);
  }
});

// 国立天文台 暦Wiki「季節/七十二候」の「宝暦暦以降」（2026-10-19 照合）。立春初候から順に
const NAO_KOU = '東風解凍 黄鶯睍睆 魚上氷 土脉潤起 霞始靆 草木萌動 蟄虫啓戸 桃始笑 菜虫化蝶 雀始巣 桜始開 雷乃発声 玄鳥至 鴻雁北 虹始見 葭始生 霜止出苗 牡丹華 蛙始鳴 蚯蚓出 竹笋生 蚕起食桑 紅花栄 麦秋至 蟷螂生 腐草為蛍 梅子黄 乃東枯 菖蒲華 半夏生 温風至 蓮始開 鷹乃学習 桐始結花 土潤溽暑 大雨時行 涼風至 寒蝉鳴 蒙霧升降 綿柎開 天地始粛 禾乃登 草露白 鶺鴒鳴 玄鳥去 雷乃収声 蟄虫坏戸 水始涸 鴻雁来 菊花開 蟋蟀在戸 霜始降 霎時施 楓蔦黄 山茶始開 地始凍 金盞香 虹蔵不見 朔風払葉 橘始黄 閉塞成冬 熊蟄穴 鱖魚群 乃東生 麋角解 雪下出麦 芹乃栄 水泉動 雉始雊 款冬華 水沢腹堅 鶏始乳'.split(' ');
test('七十二候の名前と順番が国立天文台の表と一致し、見本で誤っていた4か所が直っている', () => {
  assert.deepEqual(T.KOU.map((k) => k[0]), NAO_KOU);
  assert.equal(T.SEKKI.length, 24);
  const kana = Object.fromEntries(T.KOU);
  assert.equal(kana['桜始開'], 'さくらはじめてひらく'); assert.equal(kana['大雨時行'], 'たいうときどきにふる'); assert.equal(kana['雪下出麦'], 'ゆきくだりてむぎのびる');
});

test('2026/10/19 は寒露・末候「蟋蟀在戸」、次の節気は霜降 10/23 18:38', () => {
  const d = T.describe(Date.parse('2026-10-19T12:00:00+09:00'));
  assert.equal(d.sekki.ja, '寒露'); assert.equal(d.kou.pos, '末候'); assert.equal(d.kou.ja, '蟋蟀在戸'); assert.equal(d.kou.kana, 'きりぎりすとにあり');
  assert.equal(d.next.ja, '霜降'); assert.ok(Math.abs(d.next.at - Date.parse('2026-10-23T18:38:00+09:00')) <= 60000);
  // 節気の境目の前後で切り替わる
  const shoko = Date.parse('2026-10-23T18:38:00+09:00');
  assert.equal(T.describe(shoko - 120000).sekki.ja, '寒露'); assert.equal(T.describe(shoko + 120000).sekki.ja, '霜降'); assert.equal(T.describe(shoko + 120000).kou.pos, '初候');
});

test('境目は5°ずつ途切れず並び、対応期間（2020〜2030年）の外は出さない', () => {
  const b = T.boundaries();
  for (let i = 1; i < b.length; i++) { assert.equal((b[i].longitude - b[i - 1].longitude + 360) % 360, 5); assert.ok(b[i].at > b[i - 1].at); }
  assert.ok(T.describe(Date.parse('2020-01-01T00:00:00+09:00'))); assert.ok(T.describe(Date.parse('2030-12-31T23:59:00+09:00')));
  assert.equal(T.describe(Date.parse('2010-01-01T00:00:00Z')), null); assert.equal(T.describe(Date.parse('2040-01-01T00:00:00Z')), null); assert.equal(T.describe(NaN), null);
});

test('太陽の絵：黄〜橙の円盤、縁が明るく、外は透明、毎回同じ', () => {
  // 2026-10-19 ユーザーが選んだイラスト風（A 黄色系）。高度・時刻を入力に取らない
  const n = 160, s = sun.surface(n), r = n * sun.DISC, px = (x, y) => Array.from(s.slice((y * n + x) * 4, (y * n + x) * 4 + 4));
  let warm = 0, total = 0, lumIn = 0, lumRim = 0, cIn = 0, cRim = 0;
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const d = Math.hypot(x + 0.5 - n / 2, y + 0.5 - n / 2) / r, p = px(x, y); if (d >= 0.99) continue;
    total++; if (p[0] >= p[1] && p[1] >= p[2] && p[0] > 200) warm++;
    const l = p[0] + p[1] + p[2]; if (d < 0.6) { lumIn += l; cIn++; } else if (d > 0.96) { lumRim += l; cRim++; }
  }
  assert.ok(warm / total > 0.97, `warm ${warm}/${total}`);
  assert.ok(lumRim / cRim > lumIn / cIn, '縁が内側より明るい');
  assert.equal(px(2, 2)[3], 0); assert.equal(px(n / 2, n / 2)[3], 255);
  assert.deepEqual(Array.from(sun.surface(n)), Array.from(s), '同じ入力から毎回同じ画素');
});

test('ホームは太陽の絵と節気を使い、高度で絵を変えない', () => {
  const d = fs.readFileSync(new URL('./sorami-almanac-dashboard.js', import.meta.url), 'utf8'), h = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
  assert.match(d, /SoramiSunPortrait\.draw\(sunCanvas\)/); assert.match(d, /SoramiSolarTerms\?\.describe\(at\(\)\)/);
  assert.doesNotMatch(d, /SoramiSunPortrait\.draw\([^)]*Altitude/);
  const order = ['sorami-solar-terms.js', 'sorami-sun-portrait.js', 'sorami-almanac-dashboard.js'].map((f) => h.indexOf(f));
  assert.ok(order.every((i) => i > 0) && order[0] < order[2] && order[1] < order[2]);
});
