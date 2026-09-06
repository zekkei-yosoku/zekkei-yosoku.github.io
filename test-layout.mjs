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

console.log("== sticky を使わない ==");
// 右ペインを sticky にしていたとき、包含ブロックが記録カードの行まで伸び、
// スクロールすると週間の行が記録カードの上に描画された（551点中361点が被覆）。
ok(!/position:\s*sticky/.test(code), "レイアウトに position: sticky が無い");

console.log("== 現象ごとにカードを分ける ==");
// 7現象×7日をひとつの表にしていたが、49個の数字を凡例と照らし合わせて読む形で、
// 「見に行くか」を決める道具になっていなかった。
ok(!/renderMatrix/.test(html), "ひとつの表にまとめていない");
ok(/function renderPhenomenonCards/.test(html), "現象ごとのカードを描く");
ok(/id="cards"/.test(html), "#cards がある");
// 色や数字を覚えなくても、どの日がいいかが棒の高さで分かる。
ok(/30 \* ev\.score \/ 100/.test(html), "日の良し悪しを棒の高さで示す");
ok(/class="day\$\{isNext\}\$\{isPast\}" data-cell=/.test(html), "日がボタンになっている");
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
ok(/\$\("placeButton"\)\.hidden = inRecords/.test(html), "記録を読むときは地点と実況を出さない");
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
ok(/renderLightTimes\(sel\.dayMs, now\)/.test(html), "選んだ日の光の時間を出す");
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
ok(/id="favToggle"[^>]*class="[^"]*\btap\b/.test(html), "☆ に .tap が付いている");
ok(/#favToggle::after/.test(html), "☆ の当たり判定を右側へ寄せる指定がある");

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
ok(/place\.longitude, 15, place\)/.test(html), "15日ぶん取る（最終日の窓が翌日へまたぐ）");
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
ok(/数字は点数、/.test(html), "一覧の先頭に凡例がある");
ok(/g-inline/.test(html), "凡例でも日のボタンと同じ見た目を見せる");
ok((html.match(/数字は点数、/g) || []).length === 1, "凡例はカードごとに繰り返さない");
ok(/class="grade"/.test(html), "詳細の見出しにも等級を出す");
ok(/A・B・C<\/strong> は信頼度/.test(html), "等級の意味を画面で説明している");

console.log("== ホーム画面のアイコン ==");
// これが無いと OS がアプリ名の先頭文字で代用し、「絶」の一文字が出る。
ok(/rel="apple-touch-icon"/.test(html), "iOS 用のアイコンを指定している");
ok(/rel="manifest"/.test(html), "マニフェストを読ませている");
ok(/rel="icon"[^>]*32x32/.test(html), "タブ用のファビコンがある");
const mani = JSON.parse(fs.readFileSync(new URL("./manifest.json", import.meta.url), "utf8"));
ok(mani.name === "絶景予測" && mani.short_name === "絶景予測", "マニフェストの名前が現在の名称");
ok(mani.icons.some((i) => i.sizes === "512x512" && i.purpose === "maskable"),
  "Android が円で抜く用（maskable）を持つ");
for (const i of mani.icons) {
  ok(fs.existsSync(new URL("./" + i.src, import.meta.url)), `${i.src} が存在する`);
}
ok(fs.existsSync(new URL("./icon-180.png", import.meta.url)), "icon-180.png が存在する");
// 画像は生成物。作り直せる形で残っているか。
ok(fs.existsSync(new URL("./make-icon.mjs", import.meta.url)), "アイコンの生成元がある");

console.log("== 絶景スポットは現象でまとめる ==");
// 33件を素のまま並べても、何を探せばいいのか分からない。
ok(/class="spot-cat"/.test(html), "カテゴリの見出しがある");
ok(/S\.PHENOMENA\[a\]\.order - S\.PHENOMENA\[b\]\.order/.test(html), "カテゴリの順は一覧と同じ");
// 陸別はダイヤモンドダストと星空の両方を持つ。全部の見出しに出すと件数が合わなくなる。
ok(/s\.phenomena\[0\] === p/.test(html), "主カテゴリで1回だけ出す（重複しない）");
ok(/const northToSouth = \(a, b\) => b\.latitude - a\.latitude/.test(html), "同じカテゴリの中は北から南へ");
ok(/if \(filter\) \{[\s\S]{0,400}phenomena\.includes\(filter\)/.test(html),
  "絞り込み中は副次的な用途のスポットも拾う");
// 全スポットがどれかのカテゴリに入るか（主現象が PHENOMENA に無いと画面から消える）
req("./spots.js");
const spots = globalThis.SORAMI_SPOTS.spots;
const orphan = spots.filter((s) => !coreMod.PHENOMENA[s.phenomena[0]]);
ok(orphan.length === 0, "全スポットの主現象が定義済み", orphan.map((s) => s.name).join(","));
// 主カテゴリで1回だけ出すので、合計が全件と一致しなければどこかで消えている。
const grouped = [...new Set(spots.map((s) => s.phenomena[0]))]
  .reduce((n, p) => n + spots.filter((s) => s.phenomena[0] === p).length, 0);
ok(grouped === spots.length, "カテゴリ分けで欠落も重複もない", `${grouped} / ${spots.length}`);

console.log("== 行の並びが日をまたいでも動かない ==");
// 「直近に起きる順」だと、7日ぶんを一度に見る表では意味が無いうえ、
// 日をまたぐたびに行が入れ替わって目で追えなくなる。
const sortBlock = html.slice(html.indexOf("const order = Object.keys(weeks).sort"),
                             html.indexOf("const order = Object.keys(weeks).sort") + 600);
ok(!/\.peak/.test(sortBlock), "並びが発生時刻に依存していない");
ok(/PHENOMENA\[a\]\.order - S\.PHENOMENA\[b\]\.order/.test(sortBlock), "固定順を使っている");
ok(/unavailable/.test(sortBlock), "対象外は最後へ回す");

console.log("== 画面をまたいで現象の並びが揃う ==");
// spots.js の出現順のままだと、一覧のカードと地点シートのチップで順序が違った。
ok(/phenomenaWithSpots[\s\S]{0,160}PHENOMENA\[a\]\.order/.test(html),
  "スポットの絞り込みも同じ並び順");

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
ok(/端末に保存されます/.test(recCard), "保存先が端末であることを書く");

console.log(`\n${fail === 0 ? "LAYOUT OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
