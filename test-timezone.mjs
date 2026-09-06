/*
 * 暦は「見ている地点の時差」で動くこと。
 *
 * 日本固定にしていたが、地点検索は OpenStreetMap で世界中を引ける。
 * 海外を選ぶと「今日／明日」の区切りが日本時間のままずれていた。
 */
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const S = require("./sorami-core.js");

let pass = 0, fail = 0;
const ok = (c, label, detail = "") => {
  if (c) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  " + detail : ""}`); }
};
const iso = (ms) => new Date(ms).toISOString();

// 日本の 8/28 00:30 ＝ 世界標準時 8/27 15:30
const t = Date.UTC(2026, 7, 27, 15, 30);

console.log("== 時差で日の区切りが変わる ==");
S.setTimezoneOffset(9 * 3600);
const jp = S.Cal.startOfDay(t);
ok(iso(jp) === "2026-08-27T15:00:00.000Z", "日本(+9)では 8/28 の始まり", iso(jp));
ok(S.Cal.monthDay(t) === "08/28", "日本では 08/28（mm/dd で0埋め）", S.Cal.monthDay(t));

S.setTimezoneOffset(-3 * 3600);
const ar = S.Cal.startOfDay(t);
ok(iso(ar) === "2026-08-27T03:00:00.000Z", "アルゼンチン(-3)では 8/27 の始まり", iso(ar));
ok(S.Cal.monthDay(t) === "08/27", "同じ瞬間でも 08/27", S.Cal.monthDay(t));
ok(jp !== ar, "同じ瞬間でも日の区切りが違う");

console.log("== 時刻の表示も地点の時間 ==");
S.setTimezoneOffset(9 * 3600);
const jpTime = S.Cal.hhmm(t);
S.setTimezoneOffset(0);
const utcTime = S.Cal.hhmm(t);
ok(jpTime === "0:30", "日本では 0:30", jpTime);
ok(utcTime === "15:30", "UTC では 15:30", utcTime);

console.log("== 曜日も地点の暦 ==");
S.setTimezoneOffset(9 * 3600);
const jpDow = S.Cal.weekday(t);
S.setTimezoneOffset(-3 * 3600);
const arDow = S.Cal.weekday(t);
ok(jpDow === "金" && arDow === "木", "日本は金曜、アルゼンチンは木曜", `${jpDow}/${arDow}`);

console.log("== おかしな値では変えない ==");
S.setTimezoneOffset(9 * 3600);
const before = S.Cal.startOfDay(t);
S.setTimezoneOffset(null); S.setTimezoneOffset(undefined); S.setTimezoneOffset(NaN); S.setTimezoneOffset("x");
ok(S.Cal.startOfDay(t) === before, "null/NaN/文字列では時差を変えない");

console.log("== 呼び出し側の互換 ==");
ok(S.JstCal === S.Cal, "旧名 JstCal も同じものを指す");

S.setTimezoneOffset(9 * 3600);
console.log(`\n${fail === 0 ? "TIMEZONE OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
