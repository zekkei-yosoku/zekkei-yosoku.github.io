/*
 * レイアウトの回帰テスト。
 * 一度踏んだ構造上のバグを、CSS を触るたびに再発させないため。
 */
import fs from "node:fs";
const html = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");

let pass = 0, fail = 0;
const ok = (cond, label, detail = "") => {
  if (cond) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}${detail ? "  " + detail : ""}`); }
};

// 判定に使う正本を先に読む。あとから宣言すると、上のほうの検査から見えない。
const { createRequire } = await import("node:module");
const req = createRequire(import.meta.url);
const coreMod = req("./sorami-core.js");
const coreSrc = fs.readFileSync(new URL("./sorami-core.js", import.meta.url), "utf8");

// コメント内の文言を拾わないよう、判定前に /* */ を落とす。
const code = html.replace(/\/\*[\s\S]*?\*\//g, "");

console.log("== sticky が別の要素へ被らない ==");
// 2026-09-07: 「sticky を一切使わない」から「使ってよいが被らせない」へ変更。
// 14日マトリクスは横スクロールするので、現象名の列を残すには sticky が要る。
//
// 元の禁止は、右ペインを sticky にしたとき包含ブロックが記録カードの行まで伸び、
// スクロールで週間の行が記録カードの上に描画された事故（551点中361点が被覆）から来ている。
// 守るべきはその事故であって、sticky という手段そのものではない。
// 同じ事故が起きない条件を直接検査する。
const stickyUses = [...code.matchAll(/([.#][\w-]+)[^{]*\{[^}]*position:\s*sticky/g)].map((m) => m[1]);
ok(stickyUses.every((sel) => sel === ".mxrail"),
  "sticky を使うのはマトリクスの現象名の列だけ", stickyUses.join(" "));
// 記録画面では一覧ごと隠すので、sticky な要素が記録カードへ被る経路が無い。
ok(/\$\("listView"\)\.hidden = inDetail \|\| inRecords/.test(html),
  "記録画面では一覧（sticky を含む）を隠す");

console.log("== 日付の軸は1本、現象ごとに枠を持つ ==");
// 2026-09-07: 「現象ごとのカード」から「1本の日付軸のマトリクス」へ変更。
//
// 元の形は、7現象×7日をひとつの表にして 49個の数字を凡例と照らし合わせて読ませ、
// 「見に行くか」を決める道具になっていなかったことへの反省だった。
// ただし現象ごとにカードを分けると横スクロールが7本に割れ、
// 日付の列が揃わないので「土曜はどれも良い」が読めなくなっていた。
//
// 今の形は両方を満たす: 日付の軸は1本、行は現象ごとに枠を持ち、
// 良し悪しは数字ではなく地の色で示す（凡例と照合させない）。
ok(/function renderMatrix/.test(html), "1本の日付軸で描く");
ok(!/function renderPhenomenonCards/.test(html), "現象ごとの独立した横スクロールは無い");
ok(/id="cards"/.test(html), "#cards がある");
ok((html.match(/class="mxhead"/g) || []).length === 1, "日付の見出しは1本だけ");
// 2026-09-07: 行を枠で囲う形は一度やって外した。大枠の中に小さい箱が並んで見える。
// 区切りは線1本で、現象名の列の下まで伸ばす（セルの側だけに線が出ると、
// ラベルの列が切れ目のない帯に見えて行がどこで区切れるか読めない）。
ok(/class="mxrow"/.test(html), "現象ごとに行を分ける");
ok(/\.mxrow \{ border-top: 1px solid var\(--line\)/.test(html), "行の区切りは線1本");
ok(/\.mxrow \.mxrail::before[\s\S]{0,220}border-top: 1px solid var\(--line\)/.test(html),
  "その線を現象名の列の下まで伸ばす");
// 色や数字を覚えなくても、どの日がいいかが地の色で分かる。
ok(/function cellTint/.test(html), "日の良し悪しを地の色で示す");
ok(/const CELL_RAMP/.test(html), "色は評価4段ではなく点数の連続で決める");
// 2026-09-06: 共通描画へ移し、一覧はdata-cell、詳細はdata-dayを使う。
// ボタンであることは生成したHTMLで検証する。
const { runInNewContext } = await import("node:vm");
const daysSource = html.slice(html.indexOf("function renderDays("), html.indexOf("// その日の光の時間。"));
const sampleNow = Date.UTC(2026, 8, 6, 3);
const sampleDays = Array.from({ length: 14 }, (_, i) => ({
  dayMs: sampleNow + i * 86400000,
  evaluation: { score: 20 + i * 5, rank: coreMod.rankOf(20 + i * 5),
    window: [sampleNow + i * 86400000 - 7200000, sampleNow + i * 86400000 - 3600000],
    confidence: { key: "high" }, models: 8 }
}));
const drawDays = runInNewContext(daysSource + ";renderDays", {
  S: coreMod, RANK_COLOR: {poor:"gray", fair:"yellow",good:"orange",spectacular:"red"},
  upcoming: (entries) => entries[1], esc: (s) => String(s)
});
const listDays = drawDays("sunset", sampleDays, sampleNow);
const detailDays = drawDays("sunset", sampleDays, sampleNow, sampleDays[13].dayMs);
ok((listDays.match(/<button /g) || []).length === 14, "一覧の14日がボタン");
ok((detailDays.match(/<button /g) || []).length === 14, "詳細の14日が同形式のボタン");
ok((detailDays.match(/aria-pressed="true"/g) || []).length === 1 && detailDays.includes(`data-day="${sampleDays[13].dayMs}" aria-pressed="true"`), "最終日だけが選択済み");
ok(!detailDays.includes(" next"), "直近枠と選択枠を混同しない");
// 終了済みの薄表示より選択状態を優先する（PC実描画で発見）。
ok(html.indexOf('.day[aria-pressed="true"] {') > html.lastIndexOf(".day.past {"), "過去日でも選択中は薄くならない");
const bodies = (markup) => [...markup.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1]);
ok(JSON.stringify(bodies(listDays)) === JSON.stringify(bodies(detailDays)), "一覧と詳細の点数・棒・日付・信頼度が一致");
const unavailableDays = [{...sampleDays[0], evaluation: { unavailable: { message: "取得不能" } }}];
ok(!drawDays("sunset", unavailableDays, sampleNow, sampleDays[0].dayMs).includes("<button"), "取得不能の日は押せる見た目にしない");
// 20時に「今日の夕焼け 79点」がいちばん高い棒として左端に出ていた。
ok(/\.day\.past \{[^}]*opacity/.test(html), "終わった回は薄くする");
ok(/isPast = ev\.window\[1\] <= now/.test(html), "終わったかどうかを窓の終わりで判定する");

console.log("== 押せるものだけが押せる見た目 ==");
// 情報カードごと押せると、読んでいるつもりの場所で画面が変わる。
ok(/function renderBestNote/.test(html), "いちばんの狙いめは案内のみ");
const noteFn = html.slice(html.indexOf("function renderBestNote"), html.indexOf("function renderBestNote") + 900);
ok(!/onclick/.test(noteFn), "いちばんの狙いめを押しても移動しない");
ok(/\.day \{[^}]*border: 1px solid/.test(html), "日のボタンに枠がある");
ok(/\.day:active/.test(html), "押したときの見た目がある");
// 7日すべて対象外なら開いても同じ文が出るだけの行き止まり。押せる場所を作らない。
const cardsFn = html.slice(html.indexOf("function renderPhenomenonCards"), html.indexOf("/// 選択中の現象の詳細"));
const outBlock = cardsFn.slice(cardsFn.indexOf("if (allOut)"), cardsFn.indexOf("if (allOut)") + 300);
ok(!/data-cell|<button/.test(outBlock), "対象外の現象に行き止まりのボタンを作らない");

console.log("== 詳細にプルダウンを置かない ==");
// 画面を分けたので、別の現象は一覧へ戻って選ぶ。行き先が分かる。
ok(!/phSelect/.test(html), "現象を選ぶ select が無い");
ok(!/renderPhenomenonSelect/.test(html), "プルダウンの描画が残っていない");

console.log("== 点数より評価を大きく出す ==");
// 実測誤差は ±9.5 点。以前は数字 38.4px に対し「±8点」が 11px と 3.5 倍の差があった。
const verdict = html.match(/\.highlight \.verdict \{[^}]*font-size:\s*([\d.]+)rem/);
const big = html.match(/\.highlight \.big \{[^}]*font-size:\s*([\d.]+)rem/);
ok(verdict && big, "verdict と big の指定がある");
ok(verdict && big && Number(verdict[1]) > Number(big[1]),
  "評価の言葉が点数より大きい", verdict && big ? `${verdict[1]}rem vs ${big[1]}rem` : "");
ok(/function renderVerdict/.test(html) && /±\$\{err\}/.test(html),
  "点数に誤差が並記されている");
ok(/class="band"/.test(html), "バーに動きうる幅の帯がある");

console.log("== 一覧と詳細は別画面 ==");
// 同じページにスクロールで並べていたが、表と詳細が混ざって読みにくかった。
ok(/id="listView"/.test(html) && /id="detailView"/.test(html), "2つの画面がある");
ok(/function routeFromHash/.test(html), "URLのハッシュで場所を持つ（戻るが効く）");
ok(/addEventListener\("hashchange"/.test(html), "hashchange を見ている");
ok(/id="backBtn"/.test(html), "詳細に戻るボタンがある");
ok(!/この先7日/.test(html), "戻り先を日数で呼ばない（詳細にも同じ7日間がある）");
ok(/id="backBtn"[^>]*>← 一覧にもどる/.test(html), "戻り先は一覧だと書く");

// 記録はホームに置いていた。判断に使わないものを、判断する画面に混ぜない。
ok(/location\.hash === "#\/records"/.test(html), "記録は自前のURLを持つ");
ok(/id="recordsView"/.test(html), "記録は別画面");
ok(/id="recordsBack"/.test(html), "記録から戻るボタンがある");
ok(/\$\("recordsView"\)\.hidden = !inRecords/.test(html), "3画面を出し分ける");
ok(/\$\("placeRow"\)\.hidden = inRecords/.test(html), "記録を読むときは地点と実況を出さない");
// .place-row の display:flex が [hidden] の display:none に勝ち、地点カードが消えなかった。
ok(/\[hidden\] \{ display: none !important; \}/.test(code), "hidden が display 指定に負けないようにする");
ok(/listScrollY/.test(html), "一覧へ戻ったとき元の位置に戻す");
// 詳細の中で現象を替えるたびに履歴を積むと、戻るのに何度も押させることになる。
ok(/location\.replace/.test(html), "詳細内の切り替えは履歴を積まない");

console.log("== 詳細の見出し ==");
// 390px では見出しと評価を1行に並べると重なった（実機で確認）。
const headBlock = html.slice(html.indexOf('const head = `<div class="card highlight"'),
                             html.indexOf('const head = `<div class="card highlight"') + 400);
ok(/ph-head/.test(headBlock) && /head-row/.test(headBlock), "名前と評価を別の行に置く");
ok(/\.verdict-box \{[^}]*flex: none/.test(html), "評価の箱が縮まない");

console.log("== 日を指定しないURLは直近の回を指す ==");
ok(/delete selectedDay\[route\.id\]/.test(html),
  "#/sunset を開いたら前に見ていた日を持ち越さない");


console.log("== 内容がぜんぶ同じ軸に乗る ==");
// main を 1060px にして中身を 760px 左寄せにしていたため、
// 全幅で中央寄せしていた見出しだけが 136px ずれていた。
ok(!/main \{ max-width: 1060px/.test(html), "main と中身で別の幅を使わない");
ok(!/#listView, main > \.card \{ max-width/.test(html), "要素ごとに幅を上書きしない");
ok(!/\.place-row \{ max-width: 360px/.test(html), "地点だけ別の幅にしない");
// 同じ詳細度なら後勝ち。メディアクエリを基本ルールより前に置くと打ち消される。
const mediaAt = html.indexOf("@media (min-width: 900px)");
const h1At = html.indexOf("  h1 { font-size:");
ok(mediaAt > h1At, "メディアクエリを基本ルールより後ろに置く",
  `media@${mediaAt} h1@${h1At}`);

console.log("== 詳細も1本の列 ==");
ok(!/detail-wrap/.test(html), "詳細を2列に分けていない");

console.log("== 光の時間を出す ==");
// 写真を撮りに行くなら、点数より先に要る情報。
ok(/function renderLightTimes/.test(html), "renderLightTimes がある");
ok(/renderLightTimes\(sel\.dayMs, now, id\)/.test(html), "選んだ日と現象の光の時間を出す");
// 2026-09-07: 表から帯へ。朝夕2列×3行の数字を頭で1日に組み直す必要があった。
ok(/class="lt-band"/.test(html), "1日を1本の帯で描く");
ok(/TL_SPAN = 27 \* 3600000/.test(html),
  "軸は0〜27時（夜の見ごろは暦の上では翌日になるため）");
ok(/function moonEvents/.test(html) && /MOON_H0 = 0\.125/.test(html),
  "月の出・月の入りを出す（判定高度は大気差・地平視差・視半径の合成）");
ok(/lightWindows/.test(html), "太陽の高度から求めている");
const core2 = fs.readFileSync(new URL("./sorami-core.js", import.meta.url), "utf8");
// 写真分野の標準的な定義。ゴールデン −4°〜+6°、ブルー −6°〜−4°。
ok(/goldenDawn: \{ zenith: 84/.test(core2), "ゴールデンアワーの上端は太陽高度 +6°");
ok(/lowSunDawn: \{ zenith: 94/.test(core2), "ゴールデンアワーの下端は太陽高度 −4°");
ok(/civilDawn: \{ zenith: 96/.test(core2), "ブルーアワーの下端は太陽高度 −6°");

console.log("== 記録は0件のとき畳む ==");
ok(/id="recEmpty"/.test(html) && /id="recBody"/.test(html), "空表示と本体が分かれている");
ok(/\$\("recBody"\)\.hidden = empty/.test(html), "0件なら本体を隠す");

console.log("== 小さな操作に当たり判定がある ==");
// 2026-09-07: ☆ を地点ボタンの中から出した（button の中の button は不正で、
// 読み上げも click の伝播も壊れる）。兄弟になったので疑似要素で広げる必要がなくなり、
// 実寸 44px を確保する形に変えた。期待値もそれに合わせる。
ok(/#favToggle \{[^}]*min-width: 44px/.test(html) && /#favToggle \{[^}]*min-height: 44px/.test(html),
  "☆ が実寸で 44px の当たり判定を持つ");
ok(!/insertAdjacentHTML[\s\S]{0,80}favToggle/.test(html), "☆ を地点ボタンの中へ挿し込まない");
ok(/id="favToggle"[\s\S]{0,40}<\/div>/.test(html), "☆ は地点ボタンの兄弟");
ok(/setAttribute\("aria-label", isFav \? "お気に入りを編集"/.test(html), "★ が編集を開くことを読み上げで伝える");

console.log("== 見どころの見出しがランクに追従する ==");
// もともとは poor にも見出しを持たせていた（「めぼしい空はなさそうです」）。
// だが下に候補を並べていたため、見出しと中身が食い違っていた。
// poor は表から外し、renderBestNote で「候補を出さない」形にしてある。
ok(/HIGHLIGHT_HEAD\s*=\s*\{[\s\S]*?fair:/.test(html), "fair 用の見出しが定義されている");
ok(!/HIGHLIGHT_HEAD\s*=\s*\{[\s\S]*?poor:\s*"/.test(html),
  "poor は表に持たせない（候補を並べない扱いにするため）");

console.log("== 「±0」を出さない ==");
// 51通りが全部同じ値になることは珍しくない（上限や100点の頭打ちに張り付く）。
// そのとき「±0」と出すと、点数が正確だという意味に読める。実測誤差は当日でも12.6点ある。
ok(/const err = raw === 0 \? null : raw/.test(html), "誤差が0に丸まるときは付けない");
ok(/e < 1[\s\S]{0,120}あまり動きません/.test(html), "説明文も「±0点」と言わない");

console.log("== 言っていることと出しているものを合わせる ==");
// 「めぼしい空はなさそうです」と書いた下に候補を並べていた。見出しと中身が食い違う。
// 経緯はコメントに残してあるので、画面へ出る形（★ 付き）だけを見る。
ok(!/★ めぼしい空/.test(html), "「空」ではなく「絶景」で言う（霧氷もDDも空の話ではない）");
ok(/本日の絶景はなさそうです/.test(html), "見込みが無い日の文言がある");
ok(!/poor: "めぼしい/.test(html), "poor を見出しの表に残していない");
const bestNoteFn = html.slice(html.indexOf("function renderBestNote"),
                              html.indexOf("function renderBestNote") + 900);
ok(/ev\.rank\.key === "poor"/.test(bestNoteFn), "見込みが無い日を別扱いする");
// 期待薄のものを並べても行き先にならない。現象ごとのカードに全部出ている。
ok(!/highlightRow/.test(bestNoteFn.slice(0, bestNoteFn.indexOf("return;"))),
  "見込みが無い日は候補を1件も出さない");
ok(!/nextWorthwhile/.test(html), "代わりの候補を探す仕掛けも置かない");
ok(!/onclick/.test(bestNoteFn), "いちばんの狙いめを押しても移動しない");

console.log("== 14日ぶんを横に流す ==");
// 7日では「来週の連休どうか」が見られない。14日に伸ばしたぶん、1画面には入らない。
ok(/forPlace\.longitude, 15, forPlace\)/.test(html), "15日ぶん取る（最終日の窓が翌日へまたぐ）");
ok(/days = 14/.test(coreSrc), "14日ぶん採点する");
const daysCss = html.slice(html.indexOf(".days {"), html.indexOf(".days {") + 400);
ok(/overflow-x: auto/.test(daysCss), "横スクロールにする");
ok(/scroll-snap-type/.test(daysCss), "スクロールが列で止まる");
ok(!/grid-template-columns: repeat\(7/.test(html), "7列固定のグリッドは残っていない");

console.log("== 信頼度を1文字で出す ==");
// 14日並べると、どこから先を鵜呑みにしないかが分からない。
ok(/function reliabilityGrade/.test(coreSrc), "等級を出す関数がある");
ok(/GRADE_MIN_MODELS = 5/.test(coreSrc), "モデル数による頭打ちがある");
ok(/models: evaluated\.length/.test(coreSrc), "何モデルの中央値かを持ち回す");
const grades = ["A", "B", "C"];
for (const [err, models, want] of [[5, 8, "A"], [5, 4, "B"], [14, 8, "B"], [25, 8, "C"]]) {
  const g = coreMod.reliabilityGrade(coreMod.confidenceOfEnsemble(err, 0.9), models);
  ok(g.key === want, `誤差±${err}・${models}モデル → ${want}`, g.key);
}
ok(grades.every((k) => coreMod.reliabilityGrade({ key: "high" }, 8).key !== undefined), "等級が返る");
ok(/class="g"/.test(html), "日のボタンに等級を出す");
// 「78 C」と横に並べると数字の続きに見えて、何の記号か分からなかった。
const dayBtn = html.slice(html.indexOf('<button class="day${isNext}'),
                          html.indexOf('<button class="day${isNext}') + 700);
ok(dayBtn.indexOf('class="g"') > dayBtn.indexOf('class="d"'),
  "等級は点数と別の行に置く（日付より後ろ）");
ok(/\.day \.g \{[^}]*border:/.test(html), "枠で囲んでラベルの見た目にする");
// 「今日」「明日」だけ1行になって、その下の等級の位置が日ごとにずれていた。
// 全部の日を日付で書けば、細工なしで揃う。
ok(/S\.Cal\.monthDay\(e\.dayMs\)\}<br>\$\{S\.Cal\.weekday/.test(html),
  "日のボタンは全部の日を日付で書く");
ok(!/relativeDay\(e\.dayMs, now\)\.replace/.test(html), "今日／明日の書き分けは残っていない");
// 表記は mm/dd。1桁も0を付けて桁を揃える（ユーザーの指定）。
ok(coreMod.Cal.monthDay(Date.UTC(2026, 0, 3, 3)) === "01/03", "月日は0埋めの mm/dd",
  coreMod.Cal.monthDay(Date.UTC(2026, 0, 3, 3)));
ok(/padStart\(2, "0"\)\}\/\$\{String\(d\.getUTCDate\(\)\)\.padStart/.test(coreSrc),
  "monthDay 側で0埋めしている（表示ごとに書かない）");
// 記号の意味は、初めて目に入る場所で1度だけ言う。
// 2026-09-07: 凡例は「数字は点数、A/B/C は信頼度です。」の一文から、
// 期待薄→絶景の色帯へ変わった（色で良し悪しを示す形にしたため）。
ok(/class="mxlegend"/.test(html), "一覧に凡例がある");
ok((html.match(/class="mxlegend"/g) || []).length === 1, "凡例は行ごとに繰り返さない");
ok(/期待薄<\/b>.*絶景/s.test(html), "色帯の両端を言葉で示す");
// RANKS の汎用ラベル（絶景／良好／平凡／不向き）は事務的で点数の意味が伝わらないため
// 画面に出さない決まり。最下段は全7現象とも「期待薄」。
ok(!/不向き<\/b>|>不向き</.test(html), "汎用ラベル「不向き」を画面に出さない");
ok(/g-inline/.test(html), "凡例でも実物と同じ見た目を見せる");
ok(/class="grade"/.test(html), "詳細の見出しにも等級を出す");
ok(/A・B・C<\/strong> は信頼度/.test(html), "等級の意味を画面で説明している");

console.log("== ホーム画面のアイコン ==");
// これが無いと OS がアプリ名の先頭文字で代用し、「絶」の一文字が出る。
ok(/rel="apple-touch-icon"/.test(html), "iOS 用のアイコンを指定している");
ok(/rel="manifest"/.test(html), "マニフェストを読ませている");
ok(/rel="icon"[^>]*32x32/.test(html), "タブ用のファビコンがある");
const mani = JSON.parse(fs.readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
ok(mani.name === "絶景予報" && mani.short_name === "絶景予報", "マニフェストの名前が現在の名称");
ok(mani.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable"),
  "Android が円で抜く用（maskable）を持つ");
for (const i of mani.icons) {
  ok(fs.existsSync(new URL("./" + i.src, import.meta.url)), `${i.src} が存在する`);
}
ok(fs.existsSync(new URL("./icon-180.png", import.meta.url)), "icon-180.png が存在する");
// 画像は生成物。作り直せる形で残っているか。
ok(fs.existsSync(new URL("./make-icon.mjs", import.meta.url)), "アイコンの生成元がある");

console.log("== お気に入りを絶景スポットと同じ形で登録する ==");
// 2026-09-07: 内蔵の絶景スポット一覧（33件）を画面から外し、
// 「お気に入りを自分で登録する」形へ置き換えた。ここの期待値もそれに合わせて書き直した。
// 消したのは【一覧の表示】だけで、spots.js のデータは残している。
// 元の期待値（spot-cat の見出し／主カテゴリで1回だけ／北から南へ）は、
// 一覧そのものが無くなったので満たしようがない。データの健全性の検査だけ引き継ぐ。
ok(!/id="spotList"|id="spotChips"|SORAMI_SPOTS/.test(html), "内蔵スポットの一覧を画面に出していない");
ok(!/<script src="spots\.js/.test(html), "使わない spots.js を読み込まない");
// データは消さない。戻すときに要るし、下の健全性検査もこれを読む。
ok(fs.existsSync(new URL("./spots.js", import.meta.url)), "spots.js は残してある");

// 登録できる項目が、内蔵スポットと同じであること。名前だけの★では一覧の意味がない。
ok(/id="favSheet"/.test(html), "お気に入りの登録フォームがある");
for (const [id, label] of [["favName", "名前"], ["favPhenomena", "現象"],
                           ["favTerrain", "地形"], ["favNote", "メモ"]]) {
  ok(new RegExp(`id="${id}"`).test(html), `${label}を登録できる`);
}
ok(/openFavSheet\(favorites\.findIndex/.test(html), "☆ からも登録フォームへ入れる");
// 2026-09-07: 削除は「編集を開く→下まで行く→確認」の3タップだった。
// 一覧から1タップで消し、取り消しで戻せる形へ変えた。確認を挟まないぶん速く、
// 押し間違えても失わない。確認は「入力途中で閉じる」側へ移した（打った文字は戻せないため）。
ok(/data-delfav="\$\{i\}"/.test(html), "一覧から直接消せる");
ok(/function removeFavorite[\s\S]{0,320}favUndo\.push/.test(html), "消したものを控える");
ok(/data-undo="\$\{i\}"/.test(html) && /元に戻す/.test(html), "取り消しを出す");
ok(/const at = Math\.min\(u\.index, favorites\.length\);[\s\S]{0,60}favorites\.splice\(at, 0, u\.entry\)/.test(html),
  "元の位置へ戻す");
ok(!/setTimeout[\s\S]{0,120}favUndo/.test(html), "取り消しを時間で消さない（押す前に消えるため）");
ok(/addEventListener\("close", \(\) => \{ favUndo = \[\]/.test(html), "シートを閉じたら取り消しを確定する");
ok(/closeFavSheet[\s\S]{0,160}confirm\(/.test(html), "入力途中で閉じるときだけ確認する");
// 一覧の見え方をスポットと揃える（現象アイコン・都道府県/標高・メモ）。
ok(/const icons = \(f\.phenomena[\s\S]{0,120}PHENOMENA\[p\]\.icon/.test(html)
  && /data-fav="\$\{i\}"[\s\S]{0,120}\$\{icons\}/.test(html), "お気に入りに現象アイコンを出す");
ok(/標高\$\{Math\.round\(f\.elevation\)\}m/.test(html), "標高を出す");
ok(/f\.note \? " ー " \+ esc\(f\.note\)/.test(html), "メモを出す");
// 古い形（現象もメモも無い）のお気に入りが localStorage に残っていても壊れない。
ok(/\(f\.phenomena \|\| \[\]\)/.test(html), "現象を持たない古いお気に入りでも落ちない");

req("./spots.js");
const spots = globalThis.SORAMI_SPOTS.spots;
// 地形は飾りではない。sorami-core が雲海・霧氷の対象判定と鉛直分布の取得可否に使う。
// フォームの選択肢が、コアとデータが知っている地形を網羅していなければ、
// 表現できない地点が出る（山頂を選べなければ雲海が永遠に対象外になる）。
const terrainBlock = html.slice(html.indexOf("const TERRAINS = ["), html.indexOf("];", html.indexOf("const TERRAINS = [")));
const formTerrains = new Set([...terrainBlock.matchAll(/\["(\w*)",/g)].map((m) => m[1]));
const coreExcluded = ["basinFloor", "plain", "coast"];
ok(coreExcluded.every((t) => formTerrains.has(t)), "コアが除外に使う地形を全部選べる",
  coreExcluded.filter((t) => !formTerrains.has(t)).join(","));
// 説明文に閾値を写している。ずれると画面が嘘をつくので core と突き合わせる。
const minElev = Object.fromEntries([...html.matchAll(/(seaOfClouds|rime): (\d+)/g)].map((m) => [m[1], +m[2]]));
for (const [key, label] of [["seaOfClouds", "雲海"], ["rime", "霧氷"]]) {
  const m = coreSrc.match(new RegExp(key + ":[\\s\\S]{0,3000}?minElevation: (\\d+)"));
  ok(m && +m[1] === minElev[key], `${label}の標高しきい値が core と一致`, `画面 ${minElev[key]} / core ${m && m[1]}`);
}
// 霧氷の標高判定は地形に関係なく効く（core 1403）。「山頂なら霧氷も対象」は嘘になる。
ok(/const rime = \["plain", "coast"\][\s\S]{0,200}MIN_ELEV\.rime/.test(html),
  "霧氷の説明が地形だけで決まっていない");
const dataTerrains = [...new Set(spots.map((s) => s.terrain))].filter(Boolean);
ok(dataTerrains.every((t) => formTerrains.has(t)), "データにある地形を全部選べる",
  dataTerrains.filter((t) => !formTerrains.has(t)).join(","));
ok(formTerrains.has(""), "地形を選ばないという選択肢がある");
// 地形を変えると取りに行くデータ（鉛直分布）ごと変わる。取り直さないと古い点数が残る。
// 標高も needsProfile（鉛直分布を取るか）の判定に入る（core 532）。地形だけ見ていると
// 「地形は未選択のまま標高が埋まった」ときに取得データが変わったことを見落とす。
ok(/const refetch = \(place\.terrain[\s\S]{0,140}place\.elevation[\s\S]{0,300}if \(refetch\) \{[^}]*load\(true\)/.test(html),
  "地形か標高が変わったら予報を取り直す");

// spots.js は画面から外したが、戻すときに壊れていては困るのでデータの検査は続ける。
const orphan = spots.filter((s) => !coreMod.PHENOMENA[s.phenomena[0]]);
ok(orphan.length === 0, "全スポットの主現象が定義済み", orphan.map((s) => s.name).join(","));

console.log("== 行の並びが日をまたいでも動かない ==");
// 「直近に起きる順」だと、7日ぶんを一度に見る表では意味が無いうえ、
// 日をまたぐたびに行が入れ替わって目で追えなくなる。
const sortBlock = html.slice(html.indexOf("const order = Object.keys(weeks).sort"),
                             html.indexOf("const order = Object.keys(weeks).sort") + 600);
ok(!/\.peak/.test(sortBlock), "並びが発生時刻に依存していない");
ok(/PHENOMENA\[a\]\.order - S\.PHENOMENA\[b\]\.order/.test(sortBlock), "固定順を使っている");
ok(/unavailable/.test(sortBlock), "対象外は最後へ回す");

console.log("== 画面をまたいで現象の並びが揃う ==");
// 登録順のままだと、一覧のカードと地点シートのチップで現象の順序が食い違う。
ok(/const tagged = \[\.\.\.new Set\(favorites[\s\S]{0,200}PHENOMENA\[a\]\.order/.test(html),
  "お気に入りの絞り込みも同じ並び順");

console.log("== 現象の並びが似たもの同士で隣り合う ==");
const core = fs.readFileSync(new URL("./sorami-core.js", import.meta.url), "utf8");
const orderOf = (key) => {
  const m = core.match(new RegExp(key + ': \\{ name: "[^"]+", icon: "[^"]+", order: (\\d+)'));
  return m ? Number(m[1]) : null;
};
const seq = ["sunrise", "sunset", "starrySky", "rainbow", "seaOfClouds", "rime", "diamondDust"];
const got = seq.map(orderOf);
ok(got.every((v, i) => v === i),
  "朝焼け→夕焼け→星空→虹→雲海→霧氷→ダイヤモンドダスト の順",
  got.join(","));
// 同じ判定（SunsetWx特許）で対になる2つ。離すと見比べられない。
ok(orderOf("sunset") === orderOf("sunrise") + 1, "朝焼けの次が夕焼け");

console.log("== 訊き方を現象に合わせる ==");
// 点数の意味が現象で違う。日はほぼ毎日沈み多少は色づくので、
// 夕焼けに「見えたか」を訊くと何点でもほぼ100%になり、点数の甘辛が測れない。
ok(/RECORD_OUTCOMES/.test(coreSrc), "訊き方を現象ごとに持つ");
for (const id of ["sunrise", "sunset", "starrySky"]) {
  ok(new RegExp(id + ': \\{ name: "[^"]+", icon: "[^"]+", order: \\d+, record: "quality"').test(coreSrc),
    `${id} は質を訊く`);
}
for (const id of ["seaOfClouds", "rainbow", "rime", "diamondDust"]) {
  ok(new RegExp(id + ': \\{ name: "[^"]+", icon: "[^"]+", order: \\d+, record: "occurrence"').test(coreSrc),
    `${id} は出たかを訊く`);
}
ok(/期待以上[\s\S]{0,40}想定どおり[\s\S]{0,40}期待外れ/.test(coreSrc), "質は3段階で訊く");
// 同じ回に別々の答えが入らないよう、押す場所は1箇所で作る。
ok(/function outcomeButtons/.test(html), "選択肢を作る場所が1つ");
ok(html.match(/data-outcome="\$\{k\}"/g).length === 1, "選択肢を組み立てる箇所が1つだけ");
ok(/qualityCalibration/.test(html) && /occurrenceCalibration/.test(html),
  "較正のグラフも訊き方ごとに分ける");
ok(/inBand\(list, lo\)/.test(html), "どちらも同じ帯で集計する");
ok(!/DD・虹/.test(html), "内部の略称を画面に出さない");
ok(/background:var\(--good\)/.test(html) && !/fill" style="width:\$\{rate \* 100\}%;background:\$\{RANK_COLOR/.test(html),
  "出たかどうかの棒は単色（隣で色が答えを表すので意味を重ねない）");

console.log("== ホームで答えられる ==");
// 書き出し・読み込みが記録カードで唯一のボタンだったので、
// 「記録するには一度書き出さないといけない」と読めた。本来の操作は詳細ページにあり、
// 記録カードからは辿れなかった。
ok(/function renderPending/.test(html), "終わったのに未回答の回を出す");
ok(/id="recPending"/.test(html), "#recPending がある");
const pend = html.slice(html.indexOf("function renderPending"),
                        html.indexOf("function outcomeButtons"));
ok(/outcomeButtons\(id, ev\.peak/.test(pend), "ホームの一覧に押す場所が付く");
ok(/\$\("recPending"\)\.hidden = hidden \|\| !out\.length/.test(pend),
  "答える回が無ければホームに何も出さない");
ok(/ev\.window\[1\] > now\) continue/.test(pend), "終わった回だけ聞く");
ok(/3 \* 86400000/.test(pend), "古すぎる回は聞かない");
ok(/findSighting\(id, ev\.peak\)\) continue/.test(pend), "答えた回は二度聞かない");
ok(/out\.slice\(0, 4\)/.test(pend), "一度に出す件数を絞る");

// 描画より先に配線していたため、記録カードのボタンだけ無反応だった。
const wire = code.indexOf('querySelectorAll("[data-outcome]")');
const draw = code.indexOf("renderRecords(now,");
ok(draw > -1 && wire > draw, "描画をすべて終えてから押下を配線する");

// 主要な操作に見えないよう、控えの操作は説明文の中へ落とす。
const recCard = html.slice(html.indexOf('id="recordsView"'), html.indexOf('id="recordsView"') + 1600);
const headEnd = recCard.indexOf("</div>");
ok(recCard.indexOf('id="exportBtn"') > recCard.indexOf('id="recBody"'),
  "書き出し・読み込みが記録画面の末尾にある");
ok(!/exportBtn/.test(recCard.slice(0, headEnd)), "書き出しが見出しの隣に無い");
// 2026-09-07: 「端末に保存されます」だけでは、端末をまたいで共有されないことが伝わらない。
// お気に入りに手入力の内容を持たせたので、どこに保存され何が起きうるかを明示する形へ変えた。
ok(/この端末のブラウザにだけ/.test(recCard) && /端末をまたいでは共有されません/.test(recCard),
  "保存先が【この端末だけ】であることを書く");
ok(/記録とお気に入り/.test(recCard), "お気に入りも対象だと書く");

console.log("== 登録の途中と失敗を落とさない ==");
// localStorage は失敗する（プライベートブラウズ・容量超過）。黙って閉じると
// 保存できたように見える。成否を返して呼び出し側で伝える。
ok(/set\(key, value\) \{ try \{[\s\S]{0,90}return true; \} catch \{ return false; \} \}/.test(html),
  "保存の成否を返す");
ok(/function saveFavorites[\s\S]{0,220}querySelectorAll\("\.save-err"\)/.test(html), "保存できなければ画面で伝える");
// 登録シートは地点シートの上に重なる。片方だけに置くと、前面に出ていない側では見えない。
ok((html.match(/class="warn save-err"/g) || []).length === 2, "失敗の表示先が両方のシートにある");
ok(/if \(!saveFavorites\(\)\) \{ favorites\.splice\(index, 0, entry\); return false; \}/.test(html),
  "保存できなければ配列も戻す（表示だけ成功して見えるのを防ぐ）");
ok(/if \(!saveFavorites\(\)\) \{[\s\S]{0,200}return;   \/\/ 入力はそのまま残す/.test(html), "保存できなければ閉じない");

console.log("== 名前と記録の対応を切らない ==");
// findSighting は地点名で照合する。改名できるようにした以上、過去の記録を置き去りにしない。
ok(/s\.placeName === place\.name/.test(html), "記録の照合は地点名（前提の確認）");
ok(/function renameSightings/.test(html), "改名時に記録を移す仕組みがある");
ok(/near\(s\.latitude, lat\) && near\(s\.longitude, lon\)/.test(html),
  "座標が一致する記録だけ移す（別地点の同名を巻き込まない）");
ok(/placeName: place\.name, placeId: place\.id/.test(html), "新しい記録には地点IDも残す");

console.log("== 同じ地点を二重に登録しない ==");
// 現在地の id が "current" 固定だと、別の場所で ☆ を押したときに前の登録が開く。
ok(!/id: "current"/.test(html), "現在地の id を固定にしない");
ok(/id: `geo:\$\{pos\.coords\.latitude\.toFixed\(4\)\}/.test(html), "現在地は座標で識別する");

console.log("== 予報の応答が追い越しても混ざらない ==");
// 連続で地点や地形を変えると、応答の順序は要求の順序と一致しない。
ok(/let loadSeq = 0/.test(html) && /const seq = \+\+loadSeq/.test(html), "取得に連番を振る");
ok(/if \(seq !== loadSeq\) return;/.test(html), "追い越された応答を捨てる");
ok(/const forPlace = place;/.test(html) && /evaluateWeek\(id, bundle, forPlace\)/.test(html),
  "取得開始時の地点で評価する");

console.log("== 現象タグの選択が色だけになっていない ==");
ok(/aria-pressed="false">\$\{p\.icon\}/.test(html), "現象チップに aria-pressed がある");
ok(/function syncFavPhenomena[\s\S]{0,260}setAttribute\("aria-pressed"/.test(html), "状態を書き換える");
ok(!/\$\("favPhenomena"\)\.innerHTML = [\s\S]{0,200}onclick/.test(html),
  "押すたびにチップを作り直さない（フォーカスが飛ぶ）");
ok(/role="group" aria-labelledby="favPhLabel"/.test(html), "チップの集まりに名前がある");

console.log("== 登録フォームの押せるものが指の的として足りる ==");
// 実測（375px・ブラウザ）で 28px しかなく、7つ並ぶ現象チップは特に押しにくかった。
// 疑似要素で広げると、折り返した上下の行と重なって隣を押す。実寸で取る。
ok(/\.chips button \{[^}]*min-height: 36px/.test(html), "チップに最低の高さがある");
ok(/#favPhenomena button \{[^}]*min-height: 44px/.test(html), "現象チップは 44px（フォームの主役の入力）");
ok(/\.sheet-head button \{[^}]*min-height: 44px/.test(html), "シートの閉じるが 44px");
ok(/\.fav-row \.fav-del \{[^}]*min-width: 44px[\s\S]{0,40}min-height: 44px/.test(html), "削除が 44px");
ok(/\.fav-row \.fav-edit \{[^}]*min-height: 44px/.test(html), "編集が 44px");
ok(/id="favAdd"[^>]*min-height:44px/.test(html), "いまの地点を登録が 44px");

console.log("== ライトの塗りが点数の段として読める ==");
// 2026-09-07 ユーザー指摘「ライトモードの時の色がなんか見辛くない？」。
// 実測すると 24点(209,206,195) 39点(202,195,171) 62点(204,173,143) と、
// 赤成分が7しか動かず明度差もほとんど無かった。原因は【文字色を塗りに流用していた】こと。
// 文字色は「白地で 4.5:1」のために暗く濁らせてあり、薄めると全部ベージュになる。
ok(/--t-poor:/.test(html) && /--t-fair:/.test(html) && /--t-good:/.test(html) && /--t-spectacular:/.test(html),
  "塗りの色を文字色と別に持つ");
ok(/CELL_RAMP = \[\s*\[0,\s*"--t-poor"\]/.test(html), "セルは塗り用の色を使う");
ok(!/CELL_RAMP[\s\S]{0,200}"--poor"\]/.test(html), "セルに文字色を使っていない");
// 濃さの上限はモードで違う。同じ数値だとライトが薄すぎる。
ok(/--tint-span: 62/.test(html) && /--tint-span: 48/.test(html), "濃さの幅をモードごとに持つ");
ok(/TINT\.span \* Math\.pow\(v \/ 100, TINT\.exp\)/.test(html), "式が設定を読む");
ok(/matchMedia\("\(prefers-color-scheme: dark\)"\)\.addEventListener/.test(html),
  "モードを切り替えたら読み直す");
// 補助文の3段。tertiary を暗くしたときに secondary と同じ色になっていた。
const tone = (block, name) => (block.match(new RegExp("--" + name + ": (#[0-9a-f]{6})", "i")) || [])[1];
for (const [label, block] of [["ライト", html.slice(html.indexOf(":root {"), html.indexOf("@media (prefers-color-scheme: dark)"))],
                              ["ダーク", html.slice(html.indexOf("@media (prefers-color-scheme: dark)"), html.indexOf("* { box-sizing"))]]) {
  const [t, sec, ter] = ["text", "secondary", "tertiary"].map((n) => tone(block, n));
  const grey = (h) => parseInt(h.slice(1, 3), 16);
  ok(Math.abs(grey(sec) - grey(ter)) >= 20, `${label}の補助文と注記が別の色`, `${sec} / ${ter}`);
  ok(grey(t) !== grey(sec), `${label}の本文と補助文が別の色`, `${t} / ${sec}`);
}
// 評価語は4段が見分けられること（ライトで オリーブと焦茶 が潰れていた）
const lightBlock = html.slice(html.indexOf(":root {"), html.indexOf("@media (prefers-color-scheme: dark)"));
const ranks = ["poor", "fair", "good", "spectacular"].map((n) => tone(lightBlock, n));
ok(new Set(ranks).size === 4, "ライトの評価語4色が全部ちがう", ranks.join(" "));
const hue = (h) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); return [r, g, b]; };
const near = (a, b) => hue(a).every((v, i) => Math.abs(v - hue(b)[i]) < 24);
ok(!near(ranks[1], ranks[2]), "ほんのり と 良好 が似た色になっていない", `${ranks[1]} / ${ranks[2]}`);

console.log("== 手で入れたものを失わせない ==");
// 2026-09-07 ユーザー指摘「今、お気に入り登録したのが消える状態ならそもそもその機能はいらない」。
// 地形・メモ・現象タグを手入力させるようにした以上、消えたら打ち直しになる。
// iOS Safari は7日間サイトに触れないとスクリプトの保存領域を消す。霧氷やダイヤモンドダストは
// 冬しか出ないので、「冬に行く場所を秋のうちに登録する」というこの機能が想定した使い方でちょうど消える。
ok(/const payload = \{ exportedAt: [\s\S]{0,40}favorites, sightings \}/.test(html),
  "書き出しにお気に入りを含める");
ok(/sightings \}/.test(html), "sightings のキー名を変えない（前のファイルも読める）");
ok(/const incomingFav = Array\.isArray\(data\.favorites\)/.test(html), "読み込みでお気に入りを受ける");
ok(/Array\.isArray\(data\) \? data : data\.sightings/.test(html), "配列だけのファイルも記録として読む");
ok(/const merge = \(current, add\)[\s\S]{0,220}byId\.set/.test(html), "id で突き合わせて既存を失わせない");
ok(/if \(!okay\) throw new Error/.test(html), "読み込みの保存失敗を黙って飲まない");
// 保存領域の保護。申請しても承認されるとは限らないので、結果を画面に出す。
ok(/navigator\.storage\.persist\(\)/.test(html), "保存領域の保護を申請する");
ok(/navigator\.storage\.persisted\(\)/.test(html), "すでに保護されているかを先に見る");
ok(/id="storageNote"/.test(html), "申請の結果を出す場所がある");
ok(/ホーム画面に追加/.test(html), "iOS では消えにくくする方法を案内する");
ok(/display-mode: standalone/.test(html), "すでにホーム画面のアプリなら案内しない");
// 保存場所を隠さない
ok(/この端末のブラウザにだけ/.test(html), "どこに保存されるかを画面で言う");
ok((html.match(/この端末のブラウザにだけ|この端末のブラウザにだけ保存されます/g) || []).length >= 1,
  "地点シートにも保存場所を書く");

console.log("== 外から来た文字をそのまま HTML へ入れない ==");
// 2026-09-07 Codex の指摘で発覚し、実ブラウザで発火を確認した。
// 記録画面の `${LABEL[s.outcome] ?? s.outcome}` が素だったため、細工した JSON を
// 読み込ませると任意の HTML が動いた。記録は読み込みで外から入るし、
// これから同期でサーバー越しにも入る。
ok(!/\$\{LABEL\[s\.outcome\] \?\? s\.outcome\}/.test(html), "outcome を素で埋めていない");
ok(/\$\{esc\(LABEL\[s\.outcome\] \?\? s\.outcome\)\}/.test(html), "outcome をエスケープする");
// 知らない現象は `S.PHENOMENA[...]` が undefined になり、.icon で落ちる
ok(/const meta = S\.PHENOMENA\[s\.phenomenon\];\s*\n\s*if \(!meta\) return "";/.test(html),
  "知らない現象の記録は描かない");
// 描画のエスケープと取り込みの検査は両方要る。片方だけだと、
// 新しい描画箇所を足したときに素通りする。
ok(/function cleanSighting/.test(html) && /function cleanFavorite/.test(html), "取り込んだものを検査する");
ok(/if \(!S\.PHENOMENA\[r\.phenomenon\]\) return null/.test(html), "知らない現象の記録を受けない");
ok(/Number\.isFinite\(f\.latitude\)/.test(html), "座標の無いお気に入りを受けない");
ok(/phenomena: Array\.isArray\(f\.phenomena\) \? f\.phenomena\.filter\(\(p\) => S\.PHENOMENA\[p\]\)/.test(html),
  "お気に入りの現象タグも知らないものを落とす");
ok(/TERRAINS\.some\(\(\[v\]\) => v === f\.terrain\)/.test(html), "知らない地形を受けない");
ok(/形式が合わない \$\{dropped\}件は取り込みませんでした/.test(html),
  "落とした件数を黙って捨てない");

console.log("== 壊れた保存内容で画面を落とさない ==");
// localStorage は壊れる（取り込みの途中失敗、別タブとの競合、これから足す同期の不具合、
// 手で書き換え）。null が混ざった配列で描画が3箇所落ちることを実測した（2026-09-07）。
// 同期でサーバーの応答を書き込むようになると、ここは実際に踏む。
ok(/const cleanList = \(key, fn\)[\s\S]{0,140}Array\.isArray\(raw\) \? raw\.map\(fn\)\.filter\(Boolean\) : \[\]/.test(html),
  "読み込み時にも検査を通す");
ok(/let favorites = cleanList\("sorami\.favorites", cleanFavorite\)/.test(html), "お気に入りを検査して読む");
ok(/let sightings = cleanList\("sorami\.sightings", cleanSighting\)/.test(html), "記録を検査して読む");
// 座標が壊れていると予報を取りに行けない。既定へ戻す。
ok(/!Number\.isFinite\(p\.latitude\) \|\| !Number\.isFinite\(p\.longitude\)[\s\S]{0,60}DEFAULT_PLACE/.test(html),
  "座標が壊れた地点は既定へ戻す");
// 検査関数は使う場所より前に無ければならない（const の TERRAINS を参照するため）
ok(html.indexOf("const TERRAINS = [") < html.indexOf("function cleanFavorite"), "TERRAINS が検査関数より前");
ok(html.indexOf("function cleanFavorite") < html.indexOf("let favorites = cleanList"), "検査関数が読み込みより前");
// esc はシングルクォートも落とす。属性をシングルクォートで囲む日が来ても破れないように。
ok(/replace\(\/\[&<>"'\]\/g/.test(html), "esc がシングルクォートも対象にする");
// コメント行（説明としてこの書き方に触れている）は除いて数える
const codeLines = html.split("\n").filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l)).join("\n");
ok(!/='\$\{/.test(codeLines), "属性をシングルクォートで囲んでいない");

console.log("== ログインと同期 ==");
// ログインは任意。押さなくても予報は全部見られる。機能の門にしない。
ok(/id="authButton"/.test(html), "マストヘッドに入口がある");
ok(/let auth = null;/.test(html) && !/store\.set\("sorami\.token/.test(html),
  "トークンをメモリにだけ置く（保存しない）");
ok(/headers\.authorization = `Bearer \$\{auth\.token\}`/.test(html), "ヘッダで送る（Cookie を使わない）");
// 401 でデータを消さない。消すと、サーバーが一時的に落ちただけで手元が空になる。
ok(/if \(res\.status === 401 && auth\) \{ auth = null; renderAuthButton\(\); \}/.test(html),
  "401 ではログイン状態だけ落とす");
ok(!/401[\s\S]{0,120}favorites = \[\]/.test(html), "401 でデータを消さない");
// 同期の失敗を黙って飲まない
ok(/renderAuthButton[\s\S]{0,400}classList\.toggle\("warn", failing\)/.test(html), "同期の失敗をボタンに出す");
ok(/pushQueue/.test(html) && /store\.set\("sorami\.queue"/.test(html), "送れなかった変更を覚えておく");
// サーバーから来たものも外部データとして検査する
ok(/const cleaned = clean\(\{ \.\.\.body, id: row\.id \}\)/.test(html),
  "サーバーの応答も検査してから取り込む");
// 消したことも同期する。しないと別端末から復活する。
ok(/queuePush\("fav", entry\.id\);\s*\/\/ 消したことも同期する/.test(html), "削除も同期する");
ok(/queuePush\("sight", record\.id\)/.test(html), "記録も同期する");
// 初回ログインのマージを黙ってやらない
// 2026-09-08 ユーザー指摘「そもそも要らない」。
// 取り込んだ結果はそのまま画面に出るので、件数を数えて言い直すのは割り込みでしかない。
// 状態はアカウント画面に常時出す（同期できています／未送信がN件／失敗しています）。
ok(!/をアカウントへ入れました/.test(html), "ログイン直後に件数のアラートを出さない");
// 禁じたいのは「件数の報告」であって、警告そのものではない。
// 回復コードの残りが少ないことは、そのとき言わないと手遅れになる。
ok(!/件 をアカウントへ入れました|記録\$\{sightings\.length\}件/.test(html),
  "ログイン直後に件数を数えて知らせない");
ok(/同期できていません|未送信の変更が|同期できています/.test(html), "同期の状態はアカウント画面に出す");
// ログアウトで同期済みのローカルを消す（別アカウントで混ざるのを防ぐ）
ok(/\$\("logout"\)\.onclick[\s\S]{0,400}favorites = \[\]; sightings = \[\]/.test(html),
  "ログアウトでローカルを消す");
ok(/まだ送っていない変更が \$\{pushQueue\.length\}件/.test(html), "未送信があれば警告してから消す");
// 2026-09-08 ユーザー指摘「ログインしてないのにお気に入りの登録ができる」。
// お気に入りはアカウントに紐づくもの。端末にだけ溜めても、消えるか、あとで混ざる。
ok(/function requireLoginForFavorites[\s\S]{0,80}if \(auth\) return true;/.test(html),
  "未ログインでは登録させない");
ok(/function openFavSheet\(index\) \{\s*\n\s*if \(!requireLoginForFavorites\(\)\) return;/.test(html),
  "登録フォームを開く前に確かめる");
ok(/お気に入りの登録にはログインが要ります/.test(html), "理由を言ってログインへ案内する");
// 既に端末にあるものは消さない。見えるし選べる。
ok(/data-fav="\$\{i\}"/.test(html), "手元のお気に入りは引き続き選べる");
ok(!/maybeSuggestLogin/.test(html), "登録できてしまう前提の促しは残っていない");
// パスキー非対応のブラウザで、押せないボタンを出さない
ok(/const supported = !!window\.PublicKeyCredential/.test(html), "パスキーの対応を見る");

console.log("== はじめて使うときの登録 ==");
ok(/id="panelSignup"/.test(html) && /id="doSignup"/.test(html), "新規登録の口がある");
// 打ち間違えたパスワードで登録すると本人が入れなくなる。送る前に確かめる。
ok(/if \(pw !== \$\("newPw2"\)\.value\)/.test(html), "パスワードを2回確かめる");
ok(/pw\.length < 10/.test(html), "短いパスワードは送る前に弾く");
ok(/finally \{ \$\("newPw"\)\.value = ""; \$\("newPw2"\)\.value = ""; \}/.test(html),
  "入力欄にパスワードを残さない");
ok(/autocomplete="new-password"/.test(html), "パスワード管理アプリに新規だと伝える");

console.log("== 端末とパスワードの出し入れ ==");
ok(/data-delkey="\$\{esc\(c\.id\)\}"/.test(html), "登録した端末を消せる");
ok(/confirm\("この端末のパスキーを消します/.test(html), "消す前に確かめる");
// 断って終わりにしない。その場で直せる場所を開く。
ok(/最後の認証手段\/\.test\(e\.message\)[\s\S]{0,140}\$\("newAccPw"\)\.focus\(\)/.test(html),
  "締め出しを断ったら、パスワードの設定欄を開いて指を置く");
// パスワードは片道にしない
ok(/id="enablePwWay"/.test(html) && /id="enablePw"/.test(html), "パスワードを再び有効にできる");
ok(/\$\("enablePwWay"\)\.hidden = me\.hasPassword;/.test(html), "有効なときは設定欄を出さない");
ok(/\$\("disablePw"\)\.hidden = !me\.hasPassword \|\| !me\.credentials\.length;/.test(html),
  "パスキーが無いうちは無効化を出さない");

console.log("== 詰みうる状態に出口を用意する ==");
// 回復コードは使い捨て。使った瞬間に手段がゼロになるので、その場で次を渡して見せる。
// まとめて10個発行する形にしたので、1つ使っても手持ちは残る。
// 代わりに、残りが少なくなったら作り直しを促す。
ok(/res\.remaining <= 2/.test(html), "回復コードの残りが少なくなったら知らせる");
// 手段が1つだけの状態は、起きてから言っても遅い
ok(/me\.methods <= 1[\s\S]{0,120}入る手段がこれ1つだけです/.test(html), "手段が1つなら先に警告する");
// 同期が止まったときに、押せる手を出す
ok(/id="retrySync"/.test(html) && /retry\.onclick = async \(\) => \{ await syncNow\(\)/.test(html),
  "同期が失敗していたら再試行を出す");
// 消す前に控えを促す。取り消せない操作なので二段で確かめる
ok(/id="deleteAccount"/.test(html), "アカウントを削除できる");
ok(/書き出し」で控えを取ることをすすめます/.test(html), "消す前に控えを促す");
ok((html.match(/if \(!confirm\([\s\S]{0,200}?\)\) return;/g) || []).length >= 2
  && /最終確認です。すべて消えます。/.test(html), "取り消せない削除は二段で確かめる");
ok(/await apiCall\("DELETE", "\/me"\)[\s\S]{0,200}favorites = \[\]; sightings = \[\]/.test(html),
  "サーバーと手元の両方を消す");

console.log("== ログインは1画面に1つの目的 ==");
// 2026-09-08 ユーザー指摘「たたむんじゃなくて別の画面のほうがいい」。
// 同じシートに ログイン／新規登録／回復コード を畳んで並べていたが、
//   * 開くと画面の下端まで伸びる
//   * **ID欄が3つ同時に存在し**、パスワード管理アプリの自動入力が狂う
//   * 目的の違う3つの旅程を全部読ませることになる
// 同じダイアログの中で差し替える形へ。
const authSheet = html.slice(html.indexOf('id="authSheet"'), html.indexOf('id="accountSheet"'));
ok(!/<details/.test(authSheet), "ログインのシートに畳んだ枠が無い");
for (const p of ["panelLogin", "panelSignup", "panelRecovery"]) {
  ok(new RegExp(`id="${p}"`).test(authSheet), `${p} がある`);
}
ok(/function showAuthPanel[\s\S]{0,300}hidden = k !== which/.test(html), "一度に1つだけ出す");
ok((authSheet.match(/data-back/g) || []).length >= 2, "どの画面からも戻れる");
ok(/id="goSignup"/.test(authSheet) && /id="goRecovery"/.test(authSheet), "ログイン画面から入口がある");
// 最初の画面はログイン。新規登録や回復から始めない
ok(/showAuthPanel\("login"\);\s*\n\s*\$\("authSheet"\)\.showModal/.test(html), "開いたらログイン画面から");
// 見出しが画面に追従する
ok(/\$\("authTitle"\)\.textContent = AUTH_PANELS\[which\]/.test(html), "見出しが画面に追従する");
// IDは打ち直させない
ok(/for \(const id of \["newId", "codeId"\]\)/.test(html), "IDを画面をまたいで写す");
// 頻度の高い順（新規登録が先）
ok(authSheet.indexOf('id="goSignup"') < authSheet.indexOf('id="goRecovery"'),
  "新規登録を回復コードより先に置く");

console.log("== 回復コードはまとめて渡す ==");
// 1個ずつだと、使った瞬間に手持ちがゼロになる。まとめて発行して1つずつ使い捨てる。
ok(/const showCodes = \(codes\)/.test(html) && !/const showCode = \(code\)/.test(html),
  "一覧で見せる");
ok(/codes\.map\(\(c\) => esc\(c\)\)\.join\("<br>"\)/.test(html), "全部並べる");
// コピーする中身は codeBlock（IDを含む）へ変えた
ok(/id="copyCodes"/.test(html) && /navigator\.clipboard\.writeText\(codeBlock\(/.test(html),
  "まとめてコピーできる");
ok(/1つずつ使い捨てです。期限はありません/.test(html), "使い方を書く");
ok(/res\.remaining <= 2[\s\S]{0,160}発行し直して/.test(html), "残りが少なくなったら作り直しを促す");
ok(/はじめての方は 新規登録/.test(html), "入口のラベルが分かりやすい");

console.log("== 管理者の画面 ==");
ok(/id="adminView"/.test(html), "画面がある");
ok(/location\.hash === "#\/admin"/.test(html), "URLで開ける");
ok(/\$\("adminView"\)\.hidden = !inAdmin/.test(html), "他の画面と出し分ける");
ok(/\$\("toAdmin"\)\.hidden = me\.role !== "admin"/.test(html), "管理者にだけ入口を出す");
// 画面を隠すのは防御ではない。権限はサーバーが判定する。
ok(/権限の判定は\*\*サーバーがやる\*\*/.test(html), "画面側の隠蔽を防御と考えないと明記する");
// 他人のパスワードは扱わない
ok(!/admin[\s\S]{0,400}password.*=.*\$\("[^"]*Pw"\)\.value/.test(html.slice(html.indexOf("renderAdmin"))),
  "管理者画面でパスワードを入力させない");
ok(/他人のパスワードは扱わない/.test(html), "扱わない理由を書く");
// 一覧・許可リスト・記録
ok(/id="adminUsers"/.test(html) && /id="adminAllowed"/.test(html) && /id="adminLog"/.test(html),
  "利用者・許可リスト・操作の記録がある");
ok(/入る手段が \$\{methods\} しかありません/.test(html), "締め出されそうな人を目立たせる");
ok(/data-code=|data-role=|data-deluser=|data-disallow=/.test(html), "各操作の入口がある");
// 取り消せない操作は二段で確かめる
ok(/data-deluser[\s\S]{0,400}最終確認です。すべて消えます。/.test(html), "削除は二段で確かめる");
ok(/その人がいま持っているコードは、すべて使えなくなります/.test(html), "回復コードの再発行の副作用を言う");
ok(/本人が入り直すまで反映されません/.test(html), "権限がトークンに乗ることを言う");
ok(/取り消しても既存のアカウントは消えません/.test(html), "許可の取り消しの意味を言う");
ok(/気象業務法上の扱いが変わりえます/.test(html), "人を増やす前に法の話へ触れる");

console.log("== 画面の文字にマークダウンを混ぜない ==");
// 2026-09-08、許可リストの説明と confirm の文面に ** がそのまま出ていた。
// コメントには書いてよいが、利用者が読む文字列には入れない。
const visible = html.split("\n").filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l))
  .filter((l) => /confirm\(|alert\(|textContent =|>[^<]*\*\*/.test(l) && l.includes("**"));
ok(visible.length === 0, "画面へ出る文字列に ** が無い", visible.slice(0, 2).join(" / ").slice(0, 120));

console.log("== 回復コードはIDと一緒に保存させる ==");
// 回復コードで入るには ID が要る（回数制限をアカウント単位でかけるため）。
// コードだけ保存していると、IDを忘れたときに手詰まりになる。
ok(/const codeBlock = \(loginId, codes\)[\s\S]{0,120}ID: \$\{loginId\}/.test(html),
  "コピーする内容にIDを含める");
ok(/writeText\(codeBlock\(auth\?\.loginId/.test(html), "自分の分に効く");
ok(/writeText\(codeBlock\(adminCodesFor/.test(html), "管理者が他人へ出す分にも効く");
ok(/IDとコードの両方が要ります/.test(html), "入力時にIDが要ることを書く");
ok(/<strong>IDと一緒に<\/strong>パスワードマネージャへ保存/.test(html), "保存時にIDのことを書く");
ok(/絶景予報 \$\{location\.origin\}/.test(html), "どのサイトのものか分かるようにする");

console.log("== ログインの履歴 ==");
ok(/id="loginHistory"/.test(html) && /\/me\/logins/.test(html), "自分の履歴を見られる");
// 成功しか出さないと「知らない端末から入られた」に気づけない
ok(/e\.success \? "入れた" : "失敗"/.test(html), "成功と失敗を両方出す");
ok(/身に覚えのない成功があれば/.test(html), "何をすればいいか書く");
ok(/ontoggle = async/.test(html), "開いたときだけ取りに行く");

console.log("== 回復コードにはIDが要ることが見て分かる ==");
// 2026-09-08 ユーザー指摘「回復コードだけでログインできる仕様になってるよね」。
// APIはIDを要求していたが、**画面ではID欄が畳んだ枠の外にあり**、
// 「コードだけ入れる画面」に見えていた。同じ枠の中にID欄を置く。
ok(/id="codeId"/.test(html), "回復コードの枠にID欄がある");
ok(/IDとコードの両方が要ります/.test(html), "両方要ることを書く");
ok(/if \(!who\) \{ authFail\(\$\("authErr"\), "IDを入れてください"\)/.test(html),
  "IDが空なら、送る前に理由を言う");
// 画面が分かれたので、ID は入力時に写す方式へ変えた
ok(/\$\("authId"\)\.addEventListener\("input"[\s\S]{0,140}\["newId", "codeId"\]/.test(html),
  "IDを打ち直させない");
ok(/\$\("authId"\)\.addEventListener\("input"/.test(html), "上で打ったIDを写す");

console.log(`\n${fail === 0 ? "LAYOUT OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
