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
// **出す画面は1つ**なので、記録を出せば一覧は自動で隠れる（VIEWS の表）。
ok(/for \(const v of VIEWS\) \$\(v\.el\)\.hidden = v\.id !== view/.test(html),
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
// 日付の軸は1本。**描く道は2つある**（本物と、予報待ちの骨組み）が、
// どちらも `#cards` を丸ごと差し替えるので、画面に同時には出ない。
ok((html.match(/class="mxhead"/g) || []).length === 2, "日付の見出しを作るのは2箇所だけ");
ok(/function renderSkeleton/.test(html), "予報待ちの骨組みがある");

// ---- 空の見え方（#/sky）。**稜線は月の判定が測ったものを使い回す**（通信を増やさない）
ok(/id="skyView"/.test(html), "空の見え方のページがある");
ok(/location\.hash === "#\/sky"/.test(html), "#/sky のルートがある");
ok(/const skyHorizon = \(\) => \(moonHorizon \|\| \(\(\) => 0\)\)/.test(html),
  "稜線は月の判定のものを使う（測り直さない）");
ok(!/measureHorizon/.test(html.split("function openSky")[1] || ""),
  "空の画面からは地平線を測りに行かない");
ok(/点線＝稜線の裏/.test(html), "点線の意味を凡例に出す（短く）");

// ---- 3D。**three.js は vendor から読む**（CDN を足すと CSP に外部が要り、落ちた日に画面が死ぬ）
ok(/import\("\.\/vendor\/three\/three\.module\.js"\)/.test(html), "three は同じ配信元から読む");
ok(!/cdn\.|unpkg|jsdelivr|skypack/.test(html), "CDN からは読まない");
ok(/script-src 'self'/.test(html), "CSP の script-src は self のまま");
// 読むのは3Dを開いたときだけ。他の画面は重くならない
ok(/async function sky3dLoad/.test(html) && /if \(mode === "3d"\)/.test(html),
  "3Dを開いたときだけ読む");
ok(/srgbToLinear/.test(html), "色は線形へ直してから渡す（そのままだと夜空が明るくなる）");

// ---- 画面の出し分け。**表に1行足すだけ**にする
ok(/const VIEWS = \[/.test(html), "画面の一覧が表になっている");
ok(/const view = VIEWS\.find\(\(v\) => v\.on\(\)\)\.id/.test(html), "出す画面は1つに決める");
ok(/for \(const v of VIEWS\) \$\(v\.el\)\.hidden = v\.id !== view/.test(html), "ほかは全部隠す");
{
  // 以前の書き方（条件を書き足す形）が残っていないこと
  const bad = /atSky && !inDetail && !inAdmin/.test(html) || /atPlane && !inDetail/.test(html);
  ok(!bad, "条件を書き足す形が残っていない");
  const views = html.slice(html.indexOf("const VIEWS = ["), html.indexOf("];", html.indexOf("const VIEWS = [")));
  for (const id of ["detail", "admin", "records", "aim", "sky", "plane", "list"]) {
    ok(views.includes(`id: "${id}"`), `${id} が表にある`);
  }
  ok(views.indexOf('id: "detail"') < views.indexOf('id: "list"'), "詳細のほうが一覧より強い");
  ok(views.indexOf('id: "list"') === views.lastIndexOf('id: "list"')
    && /id: "list",\s+el: "listView",\s+on: \(\) => true/.test(views), "一覧が最後の受け皿");
}

// ---- メニュー。隠し合言葉だけだったものを、押して開けるようにした
ok(/id="toolsButton"/.test(html) && /id="toolsMenu"/.test(html), "メニューがある");
// **誰に何を見せるかはサーバーが決める**（/me の tools）。画面で名簿を持たない
ok(!/TOOLS_FOR/.test(html), "画面側に名簿を持たない");
ok(/Array\.isArray\(auth\?\.tools\)/.test(html), "サーバーが返した並びを使う");
ok(!/ALWAYS_TOOLS/.test(html), "既定で出すものを画面側に持たない");
ok(/return Array\.isArray\(auth\?\.tools\) \? auth\.tools : \[\];/.test(html),
  "サーバーが返した並びだけを出す");
// **記録もお気に入りも、答える前にログインを求める。**
// 端末にだけ貯めると、しばらく開かないと消える（iOS は7日）
ok(/if \(!requireLogin\("記録"\)\) return;/.test(html), "答えるときにログインを求める");
ok(/if \(!requireLogin\("記録"\)\) \{ el\.value = ""; return; \}/.test(html),
  "写真を選んだときも求める（選択を戻す）");
ok(/const requireLoginForFavorites = \(\) => requireLogin\("お気に入りの登録"\)/.test(html),
  "お気に入りと同じ入口を使う");
// 文言が実態と食い違っていた（ログインすれば端末をまたいで共有される）
ok(!/この端末のブラウザにだけ/.test(html), "「この端末にだけ」と書かない");
ok(!/ログインし直せば戻ります/.test(html), "消える話も書かない");
ok(/アカウントに保存され、ログインした端末で共有されます/.test(html), "共有されると書く");
ok(/function toolPicker/.test(html), "管理画面で選べる");
ok(/"\/admin\/tools"/.test(html), "管理画面から決める経路を呼ぶ");
ok(/管理者はすべて使えます/.test(html), "管理者は選ばせない（役割で全部）");
// **どの画面でも出す。** 画面を移ったり、ログインの復帰が遅れたりしても消えない
ok(/renderTools\(\);\s*\n\s*renderDeckRow\(\)/.test(html), "描き直しのたびに見直す");
ok(/renderAuthButton\(\);\s*\n\s*try \{/.test(html), "/me を待たずに出す");
ok(/aria-haspopup="true"/.test(html) && /role="dialog" aria-modal="true"/.test(html),
  "開閉を読み上げへ伝える");
// 引き出しの作り（正本: 04_デザイン定義「4-4. 道具のメニュー（引き出し）」）
ok(/class="drawer-scrim"/.test(html), "暗幕を敷く");
ok(/\.drawer \{[^}]*position: fixed/.test(html), "ページの中へ差し込まない（重ねる）");
ok(/width: min\(320px, 86vw\)/.test(html), "幅は min(320px, 86vw)");
ok(/transform: translateX\(-100%\)/.test(html), "左から出す");
ok(/transition: transform \.22s/.test(html), "動かすのは transform だけ");
ok(/@media \(prefers-reduced-motion: reduce\) \{\s*\.drawer/.test(html), "動きを止める設定に従う");
ok(/min-height: 56px/.test(html), "行は56px以上");
ok(/aria-current="page"/.test(html), "いまいる画面に帯を付ける");
ok(/e\.key === "Escape"/.test(html), "Esc で閉じる");
ok(/restoreFocus: true/.test(html), "閉じたら元の釦へ焦点を戻す");
ok(/document\.body\.style\.overflow = "hidden"/.test(html), "開いているあいだ後ろを動かさない");
ok(/env\(safe-area-inset-top\) 0 env\(safe-area-inset-bottom\)/.test(html), "安全域を空ける");
// 画面が止まっていると requestAnimationFrame は呼ばれない。待たずにその場で開く
ok(/void \$\("toolsMenu"\)\.offsetWidth/.test(html), "次のフレームを待たずに開く");
{
  // **絵文字を使わない**（現象の識別にだけ使う）
  const drawer = html.slice(html.indexOf('id="toolsMenu"'), html.indexOf("</aside>"));
  ok(!/[\u{1F300}-\u{1FAFF}]/u.test(drawer), "メニューに絵文字を付けない");
}
{
  const menu = html.slice(html.indexOf('id="toolsMenu"'), html.indexOf("</aside>"));
  // 「ねらう」は中身で分けた（2026-09-28）。名前は狙うものそのものにする
  // 2026-10-01: ダイヤモンド富士・パール富士は「富士山に重ねる」1つにまとめた（ユーザー指定。名前もユーザーと決めた）
  for (const [href, name] of [["#/aim/fuji", "富士山に重ねる"],
    ["#/aim/tower", "塔に重ねる"], ["#/sky", "空の見え方"], ["#/plane", "月丼"], ["#/records", "記録"]]) {
    ok(menu.includes(`data-tool="${href}"`) && menu.includes(name), `${name} が入っている`);
  }
}
ok(/addEventListener\("hashchange", \(\) => \{\s+closeTools\(\);/.test(html) && /function pushRoute\(hash\) \{\s+closeTools\(\);/.test(html),
  "画面が変わったら閉じる（進めたときも、戻る・進むでも）");
// 検索欄に「ねらう」などを打って開く合言葉は**外した**（2026-09-30 ユーザー指摘「もういらないって言わなかったか」）。
// 道具はメニューから開く。合言葉は、使える道具を人ごとに決めた仕組みを素通りする入口でもあった。
// 「月丼」「そら」「パノラマ」は地名の検索語としても普通に打たれうる
ok(!/AIM_WORDS|SKY_WORDS|PLANE_WORDS/.test(html), "検索欄の合言葉で道具を開かない");

// ---- 展望台。**塔の先端の高さと、人が立つ展望台の高さは違う**
ok(/extratags: "1"/.test(html), "検索で extratags を取る（height / levels / tower:type）");
ok(/SoramiTerrain\.decksFor\(name\)/.test(html), "公表値の展望台を引く");
ok(/function lookoutTag/.test(html), "検索結果に高さの印を出す");
ok(/先端/.test(html) && /屋上/.test(html), "塔は先端・建物は屋上と書き分ける");
ok(/function eyeOptions/.test(html), "立つ高さの選択肢に展望台を足す");
ok(/eyeOptions\(favDraft\)\.find/.test(html), "選んだときも同じ一覧から読む");
{
  const T = req("./sorami-terrain.js");
  const tower = T.decksFor("東京タワー");
  ok(tower && tower.some((d) => d.aglM === 150) && tower.some((d) => d.aglM === 250),
    "東京タワーはメインデッキ150m・トップデッキ250m", JSON.stringify(tower));
  const st = T.structureHeight({ height: "333" });
  ok(st && st.m === 333, "OSM の height は構造物の高さ（先端）", JSON.stringify(st));
  ok(tower[0].aglM < st.m, "**展望台は先端より低い**", `${tower[0].aglM}m < ${st.m}m`);
  ok(T.decksFor("高尾山") === null, "展望台でない場所は null");
  // **施設名を含むだけの別物を弾く。** 部分一致だけだと交番が150mの展望台になる
  ok(T.decksFor("愛宕警察署東京タワー前交番") === null, "交番は展望台ではない");
  ok(T.decksFor("東京タワー前交番") === null, "頭から当たっても「前交番」なら別物");
  ok(T.decksFor("横浜ランドマークタワー郵便局") === null, "郵便局も別物");
  ok(T.decksFor("東京スカイツリータウン") === null, "足元の商業施設は展望台ではない");
  ok(T.decksFor("東京都庁舎") !== null, "少し長い言い方は同じ施設として通す");
  ok(T.decksFor("東京スカイツリー 天望デッキ") !== null, "展望台の名前つきも通す");
  ok(T.decksFor("東京タワー メインデッキ") !== null, "メインデッキも通す");
  // **地点の名前と同じ呼び名なら「展望台」と書く。** 名前が二度出ると読みにくい
  ok(T.deckLabel("渋谷スカイ", "渋谷スカイ") === "展望台", "同じ名前なら展望台");
  ok(T.deckLabel("メインデッキ", "東京タワー") === "メインデッキ", "固有の呼び名はそのまま");
  ok(T.deckLabel("天望回廊", "東京スカイツリー") === "天望回廊", "天望回廊もそのまま");
  ok(T.deckLabel("", "どこか") === "展望台", "呼び名が無ければ展望台");
  ok(T.decksFor("渋谷スカイ")[0].name === "展望台", "渋谷スカイの中身も展望台");
  ok(T.isLookout({ type: "tower", extratags: { "tower:type": "observation" } }) === "observation",
    "展望塔を見分ける");
  ok(T.isLookout({ type: "peak", extratags: {} }) === null, "ただの山は展望台ではない");
  ok(T.structureHeight({ "building:levels": "70" }).m === 231, "階数からも出す（1階3.3m）");
}

// ---- 展望台が複数ある場所は、地点カードから選べる
ok(/id="deckRow"/.test(html), "展望台の選択が地点カードにある");
ok(/function renderDeckRow/.test(html), "選択を描く");
ok(/decks\.length < 1/.test(html), "展望台が無い場所では出さない");
ok(/地面に立って 1\.5m/.test(html), "地面に戻す選択肢がある");
ok(/SoramiTerrain\.deckLabel\(d\.name, place\.name\)/.test(html),
  "呼び名は地点名と突き合わせて出す");
ok(/\$\("deckPick"\)\.onchange/.test(html), "選ぶと地点に反映する");

// ---- 月丼。**名前のある場所から選ぶ**（格子で探すと東京湾の真ん中が上位に来る）
ok(/id="planeView"/.test(html), "月丼のページがある");
ok(/location\.hash === "#\/plane"/.test(html), "#/plane のルートがある");
ok(/SoramiPlane\.rankSpots\(plane\.dayMs, paths, \[here, \.\.\.SoramiRoutes\.SPOTS\]/.test(html),
  "いまの地点＋定番の場所の中から選ぶ");
// 運用は**羽田の**風で、**時刻ごと**に決める（2026-09-28）。以前は地点の予報を流用し、
// 12〜21時の風向を数字で平均していたので、350°と10°の北風が180°＝南風運用に化けた。
ok(/function planeLoadWind/.test(html) && /latitude: R\.latitude/.test(html), "運用は羽田の風から決める");
ok(/function planeOpAt\(at\)/.test(html), "運用は時刻ごとに決める");
ok(!/mean\("wind_direction_10m"/.test(html + code), "風向を数字で平均しない（北風が南風に化ける）");
ok(/activeAt/.test(html), "その時刻に使われている経路だけで重なりを数える");
ok(/id="planePick"/.test(html), "「今日はここ」を先に出す");
// 展望台からも狙える。いま選んでいる地点（展望台かもしれない）も候補に入れる
ok(/id: "here", name: `いまの地点/.test(html), "いまの地点も候補に入れる");
// **観測点の作り方は1か所にまとめる。** 画面ごとに書くと、展望台を見る画面と
// 見ない画面ができる（2026-09-28 実際にそうなっていた）
ok(/function observerHere/.test(html), "観測点をまとめる関数がある");
ok(/place\.eyeHeightAGL \?\? 1\.5\)\s*\};/.test(html), "そこで展望台の高さを足す");
{
  const bad = (html.match(/elevation: place\.elevation \?\? 0/g) || []).length;
  ok(bad === 0, "展望台を無視する書き方が残っていない", `${bad}件`);
}
// ねらうの塔の一覧（いまの地点から次に重なる日）は、その日の候補地に置き換えた（2026-09-30）。
// 地点カードを出さない画面で「◯◯から」と言っても、どこのことか分からないため。
// 2026-10-01 ユーザー「観測地点から逆引きできない？曽谷から見てスカイツリーに重なるのはいつか」→
// **地点をねらうの画面の中で選び、どこからの結果かを名前で書く**形で戻した（地点カードの地点は黙って使わない）
{
  const fn = /async function aimRenderFrom\(\) \{[\s\S]*?\n\}/.exec(html)?.[0] || "";
  ok(/const obs = \{ latitude: f\.latitude, longitude: f\.longitude/.test(fn) && /SoramiAlign\.upcoming\(obs, aim\.target/.test(fn),
    "地点から探す: 選んだ地点（aim.from）で解く");
  ok(/<strong>\$\{esc\(f\.name\)\}<\/strong>[\s\S]{0,80}から見た/.test(fn), "地点から探す: どこからの結果かを名前で書く");
  ok(/id="aimFromSearch"/.test(html) && /wireSearchBox\("aimFromSearch", "aimFromResults"/.test(html), "地点から探す: 地点はこの画面の中で探す");
  // 「どこに重ねるか」と対で「どこから重ねるか」。最初は絶景予測の地点を引き継いで欄に入れる（ユーザー指定）
  // 道具ごとに位置が変わらないよう、題名のすぐ下（ユーザー指定）。塔の目標は題名の中で選ぶので、目標の行は無い
  { const t0 = html.indexOf('id="aimTitle"'), b = html.indexOf('for="aimFromSearch">どこから重ねるか'), a = html.indexOf('for="aimLimb">どこに重ねるか');
    ok(t0 > 0 && t0 < b && b < a && !/id="aimTargetBox"/.test(html), "「どこから重ねるか」は題名のすぐ下（目標の行は無い）"); }
  ok(/document\.activeElement === \$\("aimFromSearch"\) \|\| \$\("aimFromSearch"\)\.value\.trim\(\)\) return;/.test(html),
    "欄を空のまま離れたら観測地点の名前に戻す（打った字は残す）");
  // 地図から決めるのは地図を見ているとき。釦は上の欄ではなく地図のすぐ下（ユーザー「地図の中心ってここにいらない」）
  { const cv = html.indexOf('id="aimCanvas"'), pk = html.indexOf('id="aimPick"'), nr = html.indexOf('id="aimNear"'), fs = html.indexOf('id="aimFromSearch"');
    ok(fs < cv && cv < pk && pk < nr, "「ここから重ねる」は地図のすぐ下、その下に中心の説明（上の欄は名前で探すだけ）"); }
  // 重ならないなら言い切る（ユーザー「天体の動き的に絶対にないわけでしょ？」）。「この1年」と濁さない
  ok(/"ここからは重なりません。"/.test(html) && !/この1年、ここからは重なりません/.test(html), "重ならない地点は「ここからは重なりません」");
  ok(/重なるのは、月が明るい空にあるときだけです/.test(html) && /縁がかすめるだけで、重なりません/.test(html), "出さない理由があるときだけ、その理由を書く");
  ok(/aria-label="地図の中心（ピンの位置）から重ねる">ここから重ねる<\/button>/.test(html), "釦の名前は「ここから重ねる」");
  ok(/function aimFromPoint\(\) \{\s+if \(aim\.from\) return aim\.from;[\s\S]{0,500}inherited: true/.test(html),
    "替えていなければ絶景予測の地点を引き継ぐ");
  ok(/\$\("aimFromSearch"\)\.value = f \? f\.name : "";/.test(fn), "引き継いだ地点の名前を欄に入れておく");
  ok(/（絶景予測で選んでいる地点）/.test(fn), "引き継いだ地点なら、そう書く");
  ok(/subtitle: aimAreaOf\(\{ detail: place\.subtitle \|\| "" \}\)/.test(html), "引き継いだ地点の住所も都道府県＋市区町村まで");
  ok(!/id="aimFromHere"/.test(html), "引き継ぐための別の釦は置かない（欄に入れておく）");
  ok(/\$\("aimPick"\)\.onclick = async \(\) => \{[\s\S]{0,300}aimSetFrom\(/.test(html), "地図の中心も同じ観測地点にする（アプリ全体の地点は変えない）");
  ok(!/\$\("aimPick"\)\.hidden = aimIsFuji\(\)/.test(html), "富士山でも地図の中心で選べる");
  ok(/class="tiny aim-day" data-from-day=/.test(fn), "次に重なる日は日付の小さな釦で（押すとその日の線と候補地へ）");
  ok(/SoramiAlign\.lineOfSight\(obs, aim\.target/.test(fn) && /aimBuildingBlocks\(\[/.test(fn), "見通し（地形・塔は高い建物）を添える");
  ok((html.match(/SoramiAlign\.upcoming\(obs, aim\.target/g) || []).length === 1, "ほかの所で見えない地点からの一覧を出さない");
  // 地点の住所は都道府県＋市区町村まで（OSM の住所は長い）
  const src = /function aimAreaOf\(r\) \{[\s\S]*?\n\}/.exec(html)?.[0];
  const areaOf = src ? new Function(`${src}; return aimAreaOf;`)() : () => "";
  ok(areaOf({ detail: "曽谷, 市川柏線, 宮久保四丁目, 市川市, 千葉県, 272-0822, 日本" }) === "千葉県市川市", "OSM の住所を「千葉県市川市」へ縮める");
  ok(areaOf({ detail: "山 ・ 東京都八王子市 ・ 標高599m" }) === "東京都八王子市", "索引の説明から市区町村を取る");
  ok(areaOf({ detail: "本町, 甲府市, 山梨県, 日本" }) === "山梨県甲府市", "町名より市を先に取る");
  ok(areaOf({ detail: "国土地理院の地名情報" }) === "", "住所が無ければ書かない");
}
ok(/const skyObs = \(\) => \(moonObs \|\| observerHere\(\)\)/.test(html), "空の見え方も同じ");
ok(/deckM: agl/.test(html), "その地点の立つ高さを渡す");
// 雲海は**見下ろせるか**なので目の高さで判定する（霧氷・ダイヤは地面の標高のまま）
ok(/eyeElevation:/.test(coreSrc), "目の高さを採点へ渡す");
ok(/const eye = Number\.isFinite\(input\.eyeElevation\)/.test(coreSrc), "雲海は目の高さで見下ろす");
{
  // 霧氷の採点の中だけを見る（木に着く話なので、目の高さは関係ない）
  const body = coreSrc.slice(coreSrc.indexOf("const rimeScorer"), coreSrc.indexOf("const rainbowScorer"));
  ok(!/eyeElevation/.test(body), "霧氷は地面の標高のまま");
  const dd = coreSrc.slice(coreSrc.indexOf("const diamondDustScorer"), coreSrc.indexOf("const rimeScorer"));
  ok(!/eyeElevation/.test(dd), "ダイヤモンドダストも地面の標高のまま");
}
ok(coreMod.PHENOMENA && /wind_direction_10m/.test(coreSrc), "風向を取得している");
{
  const R = req("./sorami-routes.js");
  ok(R.SPOTS.length >= 15, "定番の場所を持っている", `${R.SPOTS.length}件`);
  ok(R.SPOTS.every((x) => x.name && Number.isFinite(x.latitude) && Number.isFinite(x.longitude)),
    "すべて名前と座標を持つ");
  ok(R.SPOTS.some((x) => /第1ターミナル/.test(x.name)) && R.SPOTS.some((x) => /多摩川/.test(x.name))
    && R.SPOTS.some((x) => /扇島|マリエン/.test(x.name)),
    "ターミナル・多摩川の橋・扇島が入っている");
}

// ---- 短縮リンク。**取り出しの規則は1か所**（サーバーは行き先を返すだけ）
ok(/resolve-map-link\?u=\$\{encodeURIComponent\(q\)\}/.test(html), "短縮リンクは API に問い合わせる");
ok(/SoramiTerrain\.parseMapLink\(body\.url\)/.test(html),
  "座標の取り出しは画面側の parseMapLink（規則を2か所に置かない）");
ok(!/\.aim-k\.moon \{[^}]*dashed/.test(html),
  "凡例の月は実線（点線は「稜線の裏」に取ってある）");
ok(/if \(!bundle\) \$\("cards"\)\.innerHTML = renderSkeleton/.test(html),
  "骨組みは最初の1回だけ（地点を変えたときは前の表を残す）");
// 2026-09-07: 行を枠で囲う形は一度やって外した。大枠の中に小さい箱が並んで見える。
// 区切りは線1本で、現象名の列の下まで伸ばす（セルの側だけに線が出ると、
// ラベルの列が切れ目のない帯に見えて行がどこで区切れるか読めない）。
ok(/class="mxrow"/.test(html), "現象ごとに行を分ける");
// 「ねらう」は戻れるページ。ポップアップだと戻るで閉じられず、URLでも開けない
ok(/id="aimView"/.test(html) && /location\.hash === "#\/aim"/.test(html), "ねらうはページ（#/aim）");
// 2026-09-24: 富士山の朝／夕を一覧で2段にしたが、**一覧はその日のトータル1つに戻した**
// （日中に見たい日が読めなくなるため。ユーザー選択）。朝・日中・夕は詳細の表で出す。
ok(!/class="mxrow tiers"|grid-template-rows:repeat/.test(html), "一覧の行は1段だけ");
ok(/bands\.map\(bandRow\)/.test(html), "富士山の詳細は朝・日中・夕の3段");
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

console.log("== 文字の大きさは段から選ぶ ==");
// 段を書いておいても、CSS を足すたびに 0.78・0.67・1.19 …と増えていた
// （2026-09-28 の総点検で38か所。段の外が全体の4割）。**検査で止める。**
{
  const SCALE = ["0.58", "0.63", "0.69", "0.72", "0.75", "0.81", "0.88", "0.94", "1", "1.1", "1.25", "1.44"];
  const used = [...html.matchAll(/font-size:\s*([0-9.]+)rem/g)].map((m) => m[1]);
  const off = [...new Set(used)].filter((v) => !SCALE.includes(v));
  ok(off.length === 0, "段にない大きさを使わない", off.join("・"));
  ok(used.length > 50, "検査が空振りしていない", `${used.length}か所`);
}

console.log("== 使われていない見た目の決まりを残さない ==");
// 画面を作り替えても CSS は残る。2026-09-28 の総点検で、無くなった
// 「重なる日」シートの決まりが43行、未使用の .notice / .spot-cat とともに残っていた。
{
  // 変数で組み立てる名前（`class="dhead ${cls}"` の today/sat など）は静的に追えない。
  const INTERPOLATED = ["today", "sat", "bands"];
  const blocks = [...html.matchAll(/<style>([\s\S]*?)<\/style>/g)];
  const css = blocks.map((b) => b[1]).join("");
  let rest = html;
  for (const b of [...blocks].reverse()) rest = rest.slice(0, b.index) + rest.slice(b.index + b[0].length);
  const classes = new Set([...css.matchAll(/\.([A-Za-z][A-Za-z0-9_-]+)/g)].map((m) => m[1]));
  const tokens = new Set(INTERPOLATED);
  for (const m of rest.matchAll(/class="([^"]*)"/g)) for (const t of m[1].split(/[\s${}()|?:+"'`]+/)) if (t) tokens.add(t);
  for (const m of rest.matchAll(/classList\.(?:add|remove|toggle|contains)\("([^"]+)"/g)) tokens.add(m[1]);
  for (const m of rest.matchAll(/querySelectorAll?\("\.([A-Za-z][\w-]+)/g)) tokens.add(m[1]);
  const dead = [...classes].filter((c) => !tokens.has(c)).sort();
  ok(dead.length === 0, "CSS に、どこからも使われていない class が無い", dead.join("・"));
}

console.log("== ダイヤモンド富士・パール富士は観測スポットの一覧を出す（2026-09-30） ==");
ok(/async function aimRenderSpots/.test(html), "主な観測スポットごとに次の日を出す");
ok(/SoramiAlign\.FUJI_SPOTS/.test(html), "スポットの一覧を使う");
ok(/e\.rank !== "graze" && \(!moon \|\| e\.sunAltitude < 0\)/.test(html), "パール富士は月が暗い空にあるときだけ");
ok(/function aimDateLabel/.test(html) && /y === now \? "" :/.test(html), "今年でない日は年も書く（400日先で同じ月日が2回出る）");
// 富士山に重ねるは目標が決まっているので、選ぶ欄の代わりに「富士山」と書く。太陽／月の切り替えは塔と同じ位置に残す
// 太陽／月の切り替えは題名の右（どちらの道具も同じ位置）。「富士山 × 太陽」の添え書きは出さない。
// 富士山に重ねるは目標の行を出さない（ユーザー「ここボタンにしたら」「目標が富士山って当たり前だからいらない」）
ok(/<div class="section-h aim-head"><h2 id="aimTitle">[\s\S]*?<\/h2>\s+<div class="aim-seg" role="group" aria-label="太陽か月">/.test(html),
  "太陽／月の切り替えは題名の右（塔も富士山も同じ位置）");
ok(!/id="aimSub"/.test(html) && !/富士山 × 太陽/.test(html), "「富士山 × 太陽」の添え書きを出さない");
ok(/<button id="aimSun" aria-pressed="true" aria-label="太陽" title="太陽">☀️<\/button>/.test(html) && /<button id="aimMoon" aria-pressed="false" aria-label="月" title="月">/.test(html),
  "切り替えは絵文字だけ（読み上げには太陽・月の名前）");
ok(/\.aim-head \{ align-items: center; flex-wrap: nowrap; \}/.test(code), "切り替えは折り返さない（道具ごとに下の位置が変わらない）");
// 塔は題名の「◯◯」が目標を選ぶ所（ユーザー「ここが目標切り替えになるのでは？」）。富士山は字だけ
ok(/<span id="aimTargetPick" hidden><span class="aim-pick"><span id="aimTargetLabel"><\/span><svg[^>]*>[\s\S]*?<\/svg><select id="aimTarget"/.test(html),
  "塔: 題名の◯◯に目標を選ぶ一覧を重ねる（字＋▾）");
ok(/\$\("aimTitleText"\)\.hidden = !fujiTool;\s+\$\("aimTargetPick"\)\.hidden = fujiTool;/.test(html), "富士山は字、塔は選ぶ所");
ok(/\.aim-pick select \{ position: absolute; inset: 0;[^}]*opacity: 0; font-size: 16px;/.test(code), "選ぶ一覧は字に重ねて透明に（幅は字の幅・iOS で拡大されない 16px）");
ok(/\$\("aimSun"\)\.hidden = anyOk && !sunOk;\s+\$\("aimMoon"\)\.hidden = anyOk && !moonOk;/.test(html),
  "富士山に重ねる: 太陽はダイヤモンド富士、月はパール富士の許可で出す（許可は2つのまま）");
ok(/TARGETS\.filter\(\(t\) => t\.id !== "fuji"\)/.test(html), "塔の目標の一覧に富士山を入れない（許可を素通りしない）");
// 重なる日は選ぶ行より下（太陽と月で日の数が違うので、上だと切り替えるたびに釦が動く。ユーザー「UIがすごく動くのが気になる」）
{ const lb = html.indexOf('for="aimLimb">どこに重ねるか'), fr = html.indexOf('<div id="aimFrom" class="aim-from">'), dt = html.indexOf('for="aimDate">日付'), sw = html.indexOf('id="aimSun"'), fs = html.indexOf('id="aimFromSearch"');
  ok(sw < fs && fs < lb && lb < fr && fr < dt, "並び: 題名と太陽／月 → どこから → どこに → 重なる日 → 日付"); }
ok(/\$\("aimPart"\)\.hidden = parts\.length < 2/.test(html), "選べる高さが1つなら選ぶ欄を出さない");
ok(!/目標に太陽や月が重なる日と、/.test(html), "説明の段落を出さない");
ok(!/線が弧を描くのは|番号は下の一覧と同じ|月が低い（2〜30°）あいだだけを見ています/.test(code), "地図の下の説明を出さない");

console.log("== 画面のスクリプトが文法として読める（2026-09-30） ==");
{
  // 同じ名前の const を2回書いて画面全体が動かなくなるところだった（配信前に手元で気づいた）。
  // 文字列の検査では文法の誤りを拾えないので、**実際に読ませる**
  const vm = await import("node:vm");
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)]
    .filter(([, attr]) => !/type="(application\/json|importmap|application\/ld\+json)"/.test(attr));
  let bad = [];
  for (const [, , code] of scripts) {
    try { new vm.Script(code, { filename: "index.html" }); } catch (e) { bad.push(e.message); }
  }
  ok(scripts.length >= 1 && bad.length === 0, "index.html の中のスクリプトに文法の誤りが無い", bad.join(" / "));
  const own = [...html.matchAll(/<script src="([a-z0-9-]+\.js)\?v=\d+"/g)].map((m) => m[1]);
  const badFiles = [];
  for (const f of own) {
    try { new vm.Script(fs.readFileSync(new URL(`./${f}`, import.meta.url), "utf8"), { filename: f }); }
    catch (e) { badFiles.push(`${f}: ${e.message}`); }
  }
  ok(own.length >= 5 && badFiles.length === 0, `読み込む自前の JS ${own.length} 本に文法の誤りが無い`, badFiles.join(" / "));
}

console.log("== ねらう: その日の候補地（2026-09-30） ==");
{
  ok(/<h2>この日の候補地<\/h2>/.test(html), "「この日の候補地」の見出しがある");
  ok(/aimFindCandidates\(\);\n  if \(!lines\.length\)/.test(html), "線を引いたら候補地を探す");
  ok(/fetch\("data\/aim-places\.json"\)/.test(html), "立てる場所は同梱のデータから（通信先を増やさない）");
  ok(fs.existsSync(new URL("./data/aim-places.json", import.meta.url)), "data/aim-places.json がある");
  {
    const gi = fs.readFileSync(new URL("./.gitignore", import.meta.url), "utf8");
    // `data/` だとフォルダごと除外され、`!` の例外が効かない。`data/*` でなければならない
    ok(/^data\/\*$/m.test(gi) && !/^data\/$/m.test(gi) && /^!data\/aim-places\.json$/m.test(gi),
      "配信から外さない（.gitignore は data/* と例外）");
  }
  ok(/SoramiAlign\.candidates\(lines, pool/.test(html), "線に掛かる場所を解き直して選ぶ");
  ok(/SoramiAlign\.lineOfSight\(/.test(html) && /if \(los && !los\.clear\) continue;/.test(html), "地形で隠れる場所は外す");
  ok(/if \(aim\.body === "moon"\) found = found\.filter\(\(c\) => c\.sunAltitude < 0\)/.test(html), "パールは暗い空の回だけ");
  ok(/aimIsFuji\(\) \? \[\.\.\.aimFujiPlaces\(\), \.\.\.places\]/.test(html), "富士山は定番スポットも候補に入れる");
  ok(/latitude: c\.stand\.latitude, longitude: c\.stand\.longitude, name:/.test(html), "地図の番号は立つ位置に打つ");
  ok(/\$\("aimListBox"\)\.hidden = !aimIsFuji\(\)/.test(html), "定番スポットの次の日は富士山だけ");
  ok(/const spread = Math\.max\(0\.3, lineKm \/ 40\)/.test(html), "上位が一か所に固まらないよう、近いものは1つに");
  ok(/async function aimBuildingBlocks/.test(html) && /if \(!aimIsFuji\(\) && pool24\.length\)/.test(html), "塔は建物で先端が隠れる場所も外す");
  ok(html.indexOf("aimRenderCands();\n  // 塔は街の中なので") > 0, "建物の確認を待たずに、先に候補を出す");
  // 画面から Overpass へ帯を問い合わせると 47〜64秒かかった（2026-10-01）。同梱の高い建物で手元で判定する
  ok(/fetch\("data\/tall-buildings\.json"\)/.test(html) && !/poly:"\$\{p\}"/.test(html), "塔の建物の判定は同梱データで（Overpass に問い合わせない）");
  {
    const redraw = (html.match(/async function aimRedrawLine\(\) \{[\s\S]*?const lines = await|async function aimRedrawLine\(\) \{[\s\S]*?lines = await/) || [""])[0];
    ok(/aim\.candSeq\+\+;/.test(redraw) && /\$\("aimCandList"\)\.innerHTML = ""/.test(redraw),
      "線を解き直すあいだ、前の画面の候補地を残さない");
  }
  {
    const gi2 = fs.readFileSync(new URL("./.gitignore", import.meta.url), "utf8");
    ok(fs.existsSync(new URL("./data/tall-buildings.json", import.meta.url)) && /^!data\/tall-buildings\.json$/m.test(gi2),
      "data/tall-buildings.json があり、配信から外さない");
  }
  ok(/建物で隠れるかは確かめられませんでした/.test(html), "建物を確かめられなかったときは、そう書く");
}

console.log("== 地点検索: 山・峠・展望地の索引（2026-09-30） ==");
{
  const gi = fs.readFileSync(new URL("./.gitignore", import.meta.url), "utf8");
  ok(fs.existsSync(new URL("./data/place-index.json", import.meta.url)) && /^!data\/place-index\.json$/m.test(gi),
    "data/place-index.json があり、配信から外さない");
  ok(/fetch\("data\/place-index\.json"\)/.test(html) && /SoramiTerrain\.searchPlaceIndex\(j, q/.test(html), "検索で同梱の索引も引く");
  ok(/const strong = local\.filter\(\(r\) => r\.indexScore >= 60\)/.test(html), "索引で強く当たったものを先に出す");
  const idx = JSON.parse(fs.readFileSync(new URL("./data/place-index.json", import.meta.url), "utf8"));
  const T = (await import("node:module")).createRequire(import.meta.url)("./sorami-terrain.js");
  const r = T.searchPlaceIndex(idx, "群馬県桐生市富士見町赤城山鳥居峠");
  ok(r[0] && r[0].name === "赤城山", "住所まじりの「…赤城山鳥居峠」で赤城山が1位（2026-09-28 ユーザー指摘の例）", r.slice(0, 3).map((x) => x.name).join(" / "));
  ok(!r.some((x) => x.name === "城山"), "「赤城山」の中の「城山」で全国の城山を並べない");
  ok(/r\.source === "index" \? r\.detail\.replace\(\/ ・ 標高\\d\+m\$\/, ""\)/.test(html), "索引から選んだ地点の小見出しに標高を二重に書かない");
  ok(/< \(m\.source === "index" \|\| r\.source === "index" \? 1\.5 : 0\.2\)/.test(html), "索引と地理院で同じ場所が二重に出ない（1.5km まで同じとみなす）");
}

console.log("== 地点検索の結果に「◯◯から ◯km」を出さない（2026-10-01） ==");
ok(!/\$\{esc\(place\.name\)\}から \$\{r\.awayKm\}km/.test(html) && !/awayKm/.test(html),
  "検索結果に、いまの地点からの距離を書かない（並びには使う）");

console.log("== 地点カードで探せると分かる（2026-10-01） ==");
{
  const card = (html.match(/<button class="place-pick" id="placeButton">[\s\S]*?<\/button>/) || [""])[0];
  ok(/<circle cx="10\.5" cy="10\.5" r="6\.5"\/>/.test(card) && !/▾/.test(card), "地点カードの右は虫眼鏡（▾ ではない）");
  ok(/\$\("placeSheet"\)\.showModal\(\);\n[^\n]*\n[^\n]*\n  \$\("searchBox"\)\.focus\(\);/.test(html), "地点カードを押したら、検索欄にすぐ打てる");
}

console.log("== 月を表すところは全部、その時の満ち欠け（2026-10-01） ==");
{
  ok(/const moonGlyphAt = \(atMs\) => iconFor\("moon", atMs\)/.test(html), "月の形は1つの関数（iconFor と同じ仕組み）");
  ok(!/MOON_FACES = \[/.test(html) && !/moonFace\(/.test(html), "光の帯も同じ仕組み（月齢の別の表を持たない）");
  ok(/phase: typeof SoramiMoon !== "undefined" \? SoramiMoon\.phaseOf\(mid\)/.test(html), "光の帯の月の形は SoramiMoon.phaseOf");
  // 画面に固定の 🌙 を書くのは、初期表示のボタンの文字だけ（開いたら満ち欠けに差し替える）
  const fixed = [...html.matchAll(/🌙/g)].length;
  ok(/\$\("aimMoon"\)\.textContent = `\$\{moonGlyphAt\(/.test(html) && /\$\("issMoon"\)\.textContent = `\$\{moonGlyphAt\(/.test(html),
    "ねらう・ISS の月の切り替えは、その日の月の形");
  ok(!/row\(e, i === 0 \? "パール富士" : "その次", "🌙"\)/.test(html), "富士山の詳細のパール富士の行も月の形");
  ok(/輝面 \$\{Math\.round\(c\.illuminated \* 100\)\}%/.test(html) && /\$\{moonGlyphAt\(c\.at\)\} 輝面/.test(html), "候補地の輝面に月の形");
  ok(/\$\{moonGlyphAt\(b\.at\)\} 月の輝面/.test(html) && /\$\{moonGlyphAt\(r\.at\)\} 輝面/.test(html), "月丼・ISS の輝面に月の形");
  ok(/skyBody\(g, 32, 32, 28/.test(html), "3D の月も満ち欠けの形（球にしない）");
  // 満ちていく月は右が光り、細い月は細く描く（2026-10-01 まで光る側も太さも逆だった）
  ok(/const lit = Math\.PI \/ 2 \* \(waxing \? -1 : 1\);/.test(html) && /lit \+ Math\.PI, lit, k < 0\.5\);/.test(html),
    "月の円盤: 満ちる月は右が光り、細い月は細く描く");
  ok(fixed <= 4, `固定の 🌙 が増えていない（${fixed}か所）`);
}

console.log("== 検索欄に「検索」釦（2026-10-01） ==");
// ユーザー「35°44'52.1"N 139°55'49.1"E を入れてエンター押しても検索できない。検索開始のボタンも出しておいた方がいい。名前は「検索」とか」
for (const id of ["searchBox", "mapSearch", "aimFromSearch"]) {
  ok(new RegExp(`<div class="search-row">\\s*<input type="search" id="${id}"[^>]*>\\s*<button id="${id}Go" class="fav-btn search-go">検索</button>`).test(html),
    `${id} の横に「検索」釦`);
}
ok(/const go = document\.getElementById\(`\$\{boxId\}Go`\);\s+if \(go\) go\.onclick = \(\) => \{ last = null; run\(\); \};/.test(html),
  "「検索」釦は押せば必ず始まる（同じ語でも）");
ok(/e\.key === "Enter" && !e\.isComposing/.test(html), "日本語の変換を確定する Enter では始めない");
// .fav-btn（幅100%）が後ろにあるので、釦の幅は二重の指定で上書きする。1段だと釦が幅いっぱいに広がり、欄が潰れた（ユーザー「検索ボタンデカすぎね」）
ok(/\.search-row \.search-go \{ flex: 0 0 auto; width: auto;/.test(code), "「検索」釦は字の幅（欄を潰さない）");
// 地点の検索欄に緯度経度を入れたら、候補を選ばずにそのまま地点にする（ユーザー「候補から選択しないと検索できないようになってるんでしょ」）
ok(/wireSearchBox\("searchBox", "searchResults"[\s\S]{0,1600}\}, async \(c\) => \{[\s\S]{0,400}await selectPointAt\(c\.latitude, c\.longitude/.test(html),
  "地点の検索: 緯度経度ならそのまま地点にする（地図をもう一度押させない）");
ok(/if \(\/\[°º˚度\]\/\.test\(q\)\) \{[\s\S]{0,120}緯度経度を読めませんでした/.test(html), "度があるのに読めなければ、地名として探さず書き方を言う");

console.log("== どこから重ねるかをお気に入りに（2026-10-01） ==");
// ユーザー「どこから重ねるかもお気に入りの登録をしたい。座標ピンポイントに名前つけたりしたいんだ」
ok(/<button id="aimFromSearchGo"[^>]*>検索<\/button>[\s\S]{0,400}<button id="aimFromFav" class="tap aim-from-fav" aria-label="お気に入りに登録">☆<\/button>/.test(html),
  "欄の横に ☆（地点カードと同じ形）");
ok(/function openFavSheet\(index, \{ point = null, fromAim = false \} = \{\}\)/.test(html), "登録の画面は、地点カード以外の点（座標）からも開ける");
ok(/openFavSheet\(-1, \{ fromAim: true, point: \{\s+id: `map:\$\{f\.latitude\.toFixed\(5\)\}/.test(html), "観測地点の座標を雛形にして名前を付けられる");
ok(/if \(i >= 0\) \{ openFavSheet\(i, \{ fromAim: true \}\); return; \}/.test(html), "登録済み（★）なら編集");
ok(/if \(favDraft\.fromAim\) aimAfterFavChange\(entry\);/.test(html), "保存したら、付けた名前で出し直す");
ok(/if \(favDraft\.fromAim\) \{ aimAfterFavChange\(null\); return; \}/.test(html), "ねらうから消したら、地点の一覧を開かずにねらうに残る");
ok(/addEventListener\("focus", \(\) => \{ if \(!\$\("aimFromResults"\)\.innerHTML\.trim\(\)\) aimShowFavChoices\(\); \}\)/.test(html),
  "欄を押すと、お気に入りを候補に並べる");
ok(/絶景予測の地点に戻す/.test(html), "別の点を選んでいるときは、絶景予測の地点へ戻る道も出す");

console.log("== 観測地点を水の上に置かない（2026-10-01） ==");
// ユーザー「観測地点は陸上に。ISS とか海の上になってなかった？」「他の観測地点も水の上にならないように」
ok(/const c = await aimOnLand\(k, lines, opts\);/.test(html), "ねらう: 候補ごとに水の上かを見る（見通しを確かめる前に）");
ok(/const AIM_STAND_ON_WATER_OK = new Set\(\["橋", "桟橋"\]\);/.test(html), "ねらう: 水の上でも残すのは橋・桟橋だけ（人が立てる構造物）");
ok(/return water === true \? aimMoveToLand\(c, lines, opts\) : c;/.test(html), "ねらう: 水の上なら陸へ動かす（動かせなければ外す）");
ok(/const hit = SoramiAlign\.crossingNear\(\{ latitude: pt\.latitude, longitude: pt\.longitude, elevation: ground \}/.test(html),
  "ねらう: 動かした点で重なりを解き直す");
ok(/const water = await SoramiTerrain\.waterAt\(picks\);\s+const onLand = picks\.filter\(\(n, i\) => water\[i\] !== true\);/.test(html),
  "ISS: 立つ場所は水の上を外す（橋も外す）");
ok(/iss\.result = rows\.filter\(\(r\) => r\.stand !== null\);/.test(html), "ISS: 帯が水の上だけを通る回は並べない");
ok(/帯が海や湖の上だけを通る回が\$\{iss\.overWater\}回あります/.test(html), "ISS: 外した回の数は書く");
ok(/if \(on && r\.stand\) \{\s+const \[sx, sy\] = project\(r\.stand\.latitude, r\.stand\.longitude\);/.test(html),
  "ISS: 地図の印は立つ場所に（中心線のいちばん近い点には付けない）");

console.log("== ISS の月面通過（2026-09-30） ==");
ok(/data-tool="#\/iss" data-id="iss"><b>ISSの月面通過<\/b>/.test(html), "メニューに ISSの月面通過 がある");
ok(/location\.hash === "#\/iss"/.test(html), "#/iss の道がある");
ok(/\{ id: "iss",\s+el: "issView"/.test(html), "画面の表に1行足した");
ok(/https:\/\/celestrak\.org/.test(html), "軌道要素は CelesTrak から（CSP に足した）");
ok(/import\("\.\/vendor\/satellite\/io\.js"\)/.test(html), "satellite.js は vendor から必要なときだけ読む");
ok(!/if \(iss\.body === "moon"\) rows = rows\.filter/.test(html), "昼の月の回も残す（高い昼の月は写る）");
ok(/r\.at - Date\.now\(\) > 72 \* 3600000/.test(html), "3日より先は「目安」と付ける");
ok(/太陽は必ず減光フィルターを付けて/.test(html), "太陽のときは減光フィルターの注意を出す");

console.log("== 道具の中身は、メニュー以外の画面でも許可で出し分ける（2026-10-01） ==");
// メニューだけ隠しても、誰でも開く富士山の詳細にダイヤモンド富士・パール富士が出ていた（ユーザー指摘）
ok(/function toolAllowed\(id\) \{\s+return allowedTools\(\)\.includes\(id\);/.test(html), "判定はメニューと同じ allowedTools");
ok(/const showSun = toolAllowed\("diamond"\), showMoon = toolAllowed\("pearl"\);\s+if \(!a \|\| \(!showSun && !showMoon\)\) return "";/.test(html),
  "富士山の詳細: どちらも許されていなければカードごと出さない");
ok(/const sun = showSun \? a\.sun \|\| \[\] : \[\], moon = showMoon \? a\.moon \|\| \[\] : \[\];/.test(html),
  "富士山の詳細: 太陽はダイヤモンド富士、月はパール富士の許可で出す");
ok(/showSun && !sun\.length \?/.test(html) && /showMoon && !moon\.length \?/.test(html), "許されていない側の「ありません」も出さない");
ok(/function startFujiAlign\(\) \{\s+if \(!toolAllowed\("diamond"\) && !toolAllowed\("pearl"\)\) return;/.test(html),
  "許されていなければ重なる日の計算もしない");
// ログインが loadExtras の途中に来ても取りこぼさない（loadExtras は走っているあいだ再入しない）
ok(/toolsDrawnKey = key; startFujiAlign\(\); redrawDayDetail\(\);/.test(html), "許されたら、その場で重なる日の計算を始める");
ok(/if \(fujiAlignKey !== key\) return;/.test(html), "計算の結果は地点で捨てる（同じ地点の取り直しで「計算しています…」のまま残らない）");
ok(/\$\{toolAllowed\("sky"\) \? `<button class="fav-btn" id="toSky"/.test(html), "月の詳細の「空の見え方を見る」も許可で出す");
{
  const mapSheet = /<dialog class="sheet" id="mapSheet">[\s\S]*?<\/dialog>/.exec(html)[0];
  ok(!/ダイヤモンド富士|パール富士|月丼|空の見え方/.test(mapSheet.replace(/<!--[\s\S]*?-->/g, "")), "地図で選ぶ画面に道具の名前を出さない");
}
ok(/function renderAuthButton\(\) \{\s+renderTools\(\);\s+redrawIfToolsChanged\(\);/.test(html), "ログイン・ログアウトで詳細の道具の中身も出し直す");
// 下半分を作り直すたびに釦をつなぐ。日を替えると「空の見え方を見る」が押せなくなっていた
ok(!/wireOutcomes\(\$\("dayDetail"\)\);/.test(html) && !/wireOutcomes\(host\);\s+wireAlignmentJump\(host\);\s+\}/.test(html.replace(/function wireDayDetail[\s\S]*?\n\}/, "")),
  "詳細の下半分は wireDayDetail でつなぐ");
ok([...html.matchAll(/wireDayDetail\(/g)].length >= 4, "最初の描画・日の切り替え・計算の到着のすべてでつなぐ");
ok(!/SoramiComposition/.test(html), "画面に出していない構図の計算をしない（1回 約0.6秒）");

console.log("== 道具の名前は1か所から取る ==");
// 管理画面に書き写していたため、ねらうを3つに分けた日に片方だけ古くなった。
ok(/const TOOL_NAMES = Object\.fromEntries\(\[\.\.\.document\.querySelectorAll\("#toolsMenu \[data-tool\]"\)\]/.test(html),
  "管理画面の名前はメニューから作る");
ok(!/TOOL_NAMES = \{/.test(html), "名前を書き写さない");
{
  // メニューの data-id と、Worker が許す道具（TOOLS）が一致していること。
  // 1つの項目が2つの許可を持つことがある（富士山に重ねる＝diamond と pearl）
  const menu = [...html.matchAll(/data-tool="[^"]+" data-id="([a-z ]+)"/g)].flatMap((m) => m[1].split(" "));
  ok(menu.length === 7, "メニューの許可は7つ（項目は6つ。富士山に重ねるが2つ持つ）", menu.join("・"));
  ok(/data-tool="#\/aim\/fuji" data-id="diamond pearl" data-names="ダイヤモンド富士 パール富士"/.test(html),
    "富士山に重ねるは2つの許可を持ち、管理画面ではそれぞれの名前で出す");
  ok(/el\.dataset\.id\.split\(" "\)\.some\(\(id\) => allowed\.includes\(id\)\)/.test(html), "どちらかの許可があればメニューに出す");
  const api = fs.readFileSync(new URL("../api/src/index.js", import.meta.url), "utf8");
  const tools = /const TOOLS = \[([^\]]+)\]/.exec(api)[1].match(/"([a-z]+)"/g).map((s) => s.replace(/"/g, ""));
  ok(JSON.stringify(menu.slice().sort()) === JSON.stringify(tools.slice().sort()),
    "メニューと Worker の道具の一覧が一致する", `${menu.join("・")} / ${tools.join("・")}`);
}

console.log("== 並び替えは表の左上に入れる ==");
// 独立した行に置くと、どのカードにも属さない帯が1本浮いた（2026-09-28 ユーザー指摘）。
ok(!/id="sortRow"/.test(html), "並び替えだけの行を作らない");
ok(/<div class="mxrail mxsort">\$\{sortFace\(\)\}/.test(html), "表の左上の空きに入れる");
ok(/function sortFace/.test(html), "いま何で並べているかを札で出す");
ok(/\.mxsort \{ min-height: 44px; \}/.test(html), "指の的を実寸で確保する");
ok(/\.mxsort select \{ position: absolute; inset: 0;[\s\S]*?opacity: 0;/.test(html),
  "select は透明にして札へ重ねる（閉じた幅が84pxの列に収まらない）");
// 開いたときの一覧と札で名前を変えると、選んだものと出ているものが食い違う。
for (const m of ["standard", "score", "grade", "time"]) {
  ok(new RegExp(`${m}: \\{ label: "[^"]{2,3}"`).test(html), `${m} の名前が列（84px）へ収まる`);
}
ok(!/short:/.test(html), "札用の別名を持たない（一覧と札で同じ名前を使う）");
// 表ごと作り直されるので、つなぎ直しの順番を間違えると並び替えが効かなくなる。
ok(html.indexOf('$("cards").innerHTML = renderMatrix(order, now);')
   < html.indexOf('const sel = $("sortSelect");'), "表を描いてから select をつなぐ");
// 描き直しは並べ替え以外（予報の到着・同期）でも走る。焦点はそこで戻す。
ok(/const sortHadFocus = document\.activeElement && document\.activeElement\.id === "sortSelect";/.test(html)
  && /if \(sortHadFocus\) sel\.focus\(\);/.test(html), "表を作り直しても select の焦点を戻す");

console.log("== 一覧と詳細は別画面 ==");
// 同じページにスクロールで並べていたが、表と詳細が混ざって読みにくかった。
ok(/id="listView"/.test(html) && /id="detailView"/.test(html), "2つの画面がある");
ok(/function routeFromHash/.test(html), "URLのハッシュで場所を持つ（戻るが効く）");
ok(/addEventListener\("hashchange"/.test(html), "hashchange を見ている");
// 画面ごとの「← 一覧にもどる」は帯として浮き、カードから離れて見えた（9/28 に外した）。
// 2026-10-01: 題名だけでは戻れると気づけない（ユーザー「一覧に戻るボタンはあった方がいい」）。
// 一覧以外の画面では、題名の帯のすぐ下に「← 戻る」を出す。どの画面でも同じ左上で、カードのあいだに浮かない。
ok(/id="homeLink"/.test(html), "一覧では題名が戻り道");
ok(/\$\("homeLink"\)\.onclick = \(\) => \{ closeTools\(\); goList\(\); \}/.test(html),
  "題名を押すと一覧へ戻る（引き出しも閉じる）");
{
  // 2026-10-01 ユーザー「☰ と絶景予測の下にいい感じに。ボタンみたいに囲わなくていい。←戻る でいい」
  const mast = /<div class="masthead">[\s\S]*?\n  <\/div>/.exec(html)[0];
  ok(!/id="backLink"/.test(mast), "題名の帯（☰・題名・ログイン）には足さない");
  ok(/<\/div>\n(?:  <!--[\s\S]*?-->\n)?  <div class="backbar" id="backBar" hidden>\n    <button id="backLink"/.test(html), "「← 戻る」は題名の帯のすぐ下");
  ok(/aria-hidden="true"><path d="M13 8H3\.5M7\.5 3\.5 3 8l4\.5 4\.5"[^>]*\/><\/svg>戻る<\/button>/.test(html), "文字は「← 戻る」");
  ok(!/#backLink \{[^}]*(background|border)/.test(code), "囲わない（地も枠も付けない）");
  ok(/\$\("backBar"\)\.hidden = view === "list";/.test(html), "一覧以外の画面で出す");
  ok(/\$\("backLink"\)\.onclick = \(\) => \{ closeTools\(\); goBack\(\); \}/.test(html), "ひとつ前の画面へ戻る");
  ok(/function goBack\(\) \{\s+if \(\(history\.state && history\.state\.depth\) > 0\) history\.back\(\);\s+else goList\(\);/.test(html),
    "前がアプリの中に無ければ（URL を直接開いた画面）一覧へ");
  ok(!/\.masthead h1"\)\.hidden/.test(html), "題名は隠さない");
}
ok(!/一覧にもどる<\/button>/.test(html), "画面ごとに戻るボタンを置かない（場所は題名の帯の下ひとつ）");
// 進めた回数を変数で数えると、ブラウザの戻る・進むでずれて、アプリの外まで戻ってしまう
ok(!/pushedCount/.test(html), "進めた回数を変数で数えない");
ok(/history\.pushState\(\{ depth \}, "", hash\)/.test(html), "履歴そのものに何画面目かを持たせる");
ok(/if \(depth > 0\) \{ toListAfterBack = true; history\.go\(-depth\); return; \}/.test(html), "何画面進んでいても一度で一覧へ戻る");
ok(!/location\.hash = /.test(html), "画面を進めるのは pushRoute だけ（深さを持たない履歴を作らない）");
ok(!/この先7日/.test(html), "戻り先を日数で呼ばない（詳細にも同じ7日間がある）");

// 記録はホームに置いていた。判断に使わないものを、判断する画面に混ぜない。
ok(/location\.hash === "#\/records"/.test(html), "記録は自前のURLを持つ");
ok(/id="recordsView"/.test(html), "記録は別画面");
ok(/\{ id: "records",\s+el: "recordsView"/.test(html), "3画面を出し分ける");
// 2026-09-30: 地点カードは「その地点が主語の画面」（一覧・詳細・空の見え方）だけに出す。
// ダイヤモンド富士や月丼の上に出ていて、何の地点か分からなかった（ユーザー指摘）
ok(/const placeCardShown = \(\) => \["list", "detail", "sky"\]\.includes\(currentView\)/.test(html),
  "地点カードを出す画面を決めている（一覧・詳細・空の見え方）");
ok(/\$\("placeRow"\)\.hidden = !placeCardShown\(\)/.test(html), "記録・管理・道具の画面では地点を出さない");
ok(/row\.hidden = decks\.length < 1 \|\| !placeCardShown\(\)/.test(html), "展望台の選択も同じ画面だけ");
// .place-row の display:flex が [hidden] の display:none に勝ち、地点カードが消えなかった。
ok(/\[hidden\] \{ display: none !important; \}/.test(code), "hidden が display 指定に負けないようにする");
ok(/listScrollY/.test(html), "一覧へ戻ったとき元の位置に戻す");
// 「詳細と記録だけ先頭」と並べて書いていたため、道具の画面が一覧の途中の位置で開いていた（2026-10-01）
ok(/window\.scrollTo\(0, currentView === "list" \? listScrollY : 0\);/.test(html), "一覧以外の画面は先頭から開く");
ok(/if \(currentView === "list"\) listScrollY = window\.scrollY;/.test(html), "一覧を離れるときに位置を憶える（メニューから開いたときも）");
// 詳細の中で現象を替えるたびに履歴を積むと、戻るのに何度も押させることになる。
ok(/history\.replaceState\(history\.state, "", `#\/\$\{picked\}\/\$\{dayMs\}`\)/.test(html),
  "詳細内の切り替えは履歴を積まない（何画面目かは残す）");

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
// 判定高度は以前 `MOON_H0 = 0.125` として index.html に直書きしていたが、
// 2026-09-14 に SoramiAstro へ寄せた。上端・大気差・地平視差は moonCrossings が持つ。
ok(/function moonEvents/.test(html) && /SoramiAstro\.moonEvents/.test(html),
  "月の出・月の入りを出す（補正は SoramiAstro が上端・大気差・地平視差で行う）");
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

console.log("== 入力欄は 16px（iOS の勝手な拡大を招かない）==");
// 2026-09-24: 「更新すると少しだけ拡大された状態になる」。本文は 15px で、入力欄が
// font: inherit で受け継いでいた。iOS は 16px 未満の入力欄に触れると画面を拡大し、
// その拡大は読み直しても戻らない。触れる入力はすべて 16px 以上にしておく。
for (const [sel, re] of [
  [".fav-in", /\.fav-in \{[^}]*font-size: 16px/],
  ["検索欄", /\.sheet input\[type=search\] \{[^}]*font-size: 16px/],
]) ok(re.test(html), `${sel} が 16px`);
const viewport = (html.match(/<meta name="viewport"[^>]*>/) || [""])[0];
ok(!/user-scalable\s*=\s*no|maximum-scale/.test(viewport),
  "viewport で拡大を禁止していない（自分で拡大したい人を止めない）", viewport);

console.log("== 見どころの見出しがランクに追従する ==");
// もともとは poor にも見出しを持たせていた（「めぼしい空はなさそうです」）。
// だが下に候補を並べていたため、見出しと中身が食い違っていた。
// poor は表から外し、renderBestNote で「候補を出さない」形にしてある。
ok(/HIGHLIGHT_HEAD\s*=\s*\{[\s\S]*?fair:/.test(html), "fair 用の見出しが定義されている");
ok(!/HIGHLIGHT_HEAD\s*=\s*\{[\s\S]*?poor:\s*"/.test(html),
  "poor は表に持たせない（候補を並べない扱いにするため）");

console.log("== 月の詳細に月の出・月の入りを出す ==");
// 月の行で知りたいのは点数より「何時に出て、そのとき見えるか」（2026-09-14 ユーザー）。
// timeline / markers は sorami-moon.js に前からあったが、画面へ繋いでいなかった。
ok(/function renderMoonTimes\(/.test(html), "renderMoonTimes がある");
ok(/id === "moon" \? renderMoonTimes\(sel\.dayMs\) : ""/.test(html), "月の詳細から呼んでいる");
ok(/SoramiAstro\.moonEvents\([\s\S]{0,120}horizonAt/.test(html),
  "平らな地平線ではなく、測った地平線で月の出入りを出す");
for (const label of ["暦の上では", "この場所では", "まるごと", "見え始め"]) {
  ok(html.includes(`"${label}"`) || html.includes(`["${label}"`),
    `「${label}」の段がある`);
}
ok(/class="lt"/.test(html.slice(html.indexOf("function renderMoonTimes"),
                                html.indexOf("function renderLightTimes"))),
  "既存の .lt を使い回す（新しい見た目を作らない）");
ok(/月は毎日およそ50分おそくなる/.test(html), "出ない日・入らない日を黙って空欄にしない");
// 高い場所では地平線が下がり、暦より**早く**出る（東京タワー150mで2分早い）。
// 「地形から」だと遮る意味にしか読めないので、上下どちらへも動く言い方にする。
ok(!/"地形から"/.test(html), "「地形から」という片方向の言い方を使っていない");
ok(/見え始め」の時刻は出ませんでした/.test(html), "見え始めが出ないとき、ダッシュだけで終わらせない");

console.log("== 同じ画面で月の出の時刻が食い違わない ==");
// 光の時間の帯は core の地心計算、詳細の表は SoramiAstro（地平視差・大気差・視半径）で
// 出していたため、同じ画面に 8:22 と 8:21 が並んでいた。表示は精密なほうへ揃える。
// core の Moon は星空の採点と Swift 版パリティで固定なので触らない。
ok(/function moonEvents\(startMs, spanMs\)[\s\S]{0,900}SoramiAstro\.moonEvents/.test(html),
  "光の時間の帯も SoramiAstro から時刻を取る");
ok(!/S\.Moon\.state\(/.test(html), "core の地心計算を月の出入りの表示に呼んでいない");
ok(!/MOON_H0/.test(html), "旧実装の判定高度（MOON_H0）を残していない");

console.log("== 笠雲 ==");
// 見どころには出さない（2026-09-17 ユーザー判断）。高い点でも実際に見えるのは十数回に1回で、
//「次の見どころ」の先頭に出すと誤誘導になる。表の行としては残す。
ok(coreMod.PHENOMENA.capCloud !== undefined, "現象として登録されている");
// **「笠雲」だけでは何の笠雲か分からない。** だが一覧の列は実質48pxしかなく、
// 「富士山の笠雲」は75pxで省略され「富士山の…」になる。すぐ上の「富士山」と
// 見分けがつかず、かえって悪い（2026-09-15に実測）。場所で使い分ける
ok(coreMod.PHENOMENA.capCloud.name === "笠雲", "一覧の列は短い名前");
ok(coreMod.PHENOMENA.capCloud.longName === "富士山の笠雲", "幅のある場所は長い名前");
ok(coreMod.longNameOf("capCloud") === "富士山の笠雲", "longNameOf が長いほうを返す");
ok(coreMod.longNameOf("sunset") === "夕焼け", "longName の無い現象は name をそのまま返す");
// 絵文字は富士山と同じ 🗻。**同じ絵文字であること自体が「同じ山の話」を伝える**。
// デザイン定義の「絵文字は現象の識別にだけ使う」の例外（名前が隣にあるので行は見分く）
ok(coreMod.PHENOMENA.capCloud.icon === coreMod.PHENOMENA.fuji.icon,
  "笠雲の絵文字は富士山と同じ");
ok(coreMod.PHENOMENA.capCloud.name !== coreMod.PHENOMENA.fuji.name,
  "名前は違う（絵文字が同じなので名前で見分ける）");
ok(/S\.longNameOf\(id\)/.test(html), "詳細の見出しと見どころで長い名前を使う");
ok(/class="nm">\$\{esc\(meta\.name\)\}/.test(html), "一覧の列は短い名前のまま");
ok(coreMod.PHENOMENA.capCloud.highlight === false, "見どころに出さない（当たる割合が低く、先頭に出すと誤誘導）");
ok(coreMod.PHENOMENA.capCloud.record === "occurrence", "「見えた/見えなかった」で記録する");
// 高い点でも実際に見えるのは十数回に1回（2026-09-17 日単位で測定）。ランク名も説明文も「かかる」と約束しない
ok(JSON.stringify(coreMod.PHENOMENA.capCloud.ranks) === JSON.stringify(["好条件", "出やすい", "わずかに", "望み薄"]),
  "笠雲のランク名は出やすさで言う（2026-09-17 ユーザー選択）");
ok(![...coreMod.PHENOMENA.capCloud.ranks, ...coreMod.PHENOMENA.capCloud.says].some((t) => /かか[りるっ]|みごと/.test(t)),
  "ランク名と説明文に「かかる」「みごと」を使わない");
ok(/sorami-capcloud\.js/.test(html), "採点を読み込んでいる");
ok(/SoramiCapCloud\.evaluateDay/.test(html), "1日ぶんを評価している");
// 富士山が地形で見えない地点では笠雲も出さない
ok(/delete weeks\.fuji; delete weeks\.capCloud/.test(html), "富士山が見えない地点では行ごと出さない");
// 上空の予報は富士山の上の話なので地点で変わらない
ok(/let capUpper = null;/.test(html), "上空の予報を地点ごとに取り直さない");
// **一覧と同じ日数を取る。** 3日固定にしていたので、他の行が14日あるのに
// 笠雲だけ3日で切れて「—」が並び、壊れて見えた（2026-09-15 ユーザー指摘）
// 2026-09-22: 取得を30分使い回すため fetchImpl を渡すようにした。日数の検査は引数が増えても通る形にする
ok(/fetchUpperAir\(\{ days: Math\.min\(16, days\.length\)[,\s}]/.test(html),
  "取得日数を一覧の日数に合わせる");
ok(/fetchUpperAir\(\{[^}]*fetchImpl: S\.cachedFetch/.test(html),
  "上空の予報も使い回しを通す（Open-Meteo の回数上限）");
ok(!/fetchUpperAir\(\{ days: 3 \}\)/.test(html), "3日固定が残っていない");
// 富士山の詳細からの導線
ok(/function renderCapLine/.test(html), "富士山の詳細から笠雲へ1行");
// 仕様書 §0 が最終出力に「発生予想時間帯・最盛予想時間帯・消滅予想時間帯」を挙げている。
// 閾値は**アプリのランク境界**を使う（別に作らない）ので、言葉と時刻が食い違わない
ok(/function renderCapTiming/.test(html), "出はじめ・いちばん濃い・弱まる を出す");
// **見に行くための道具なので、見えないものを高得点で出さない。**
// そのために富士山の評価が要るので、笠雲は富士山より後に置く
ok(/fujiDay: fujiBy\.get\(dayMs\)/.test(html), "笠雲へ富士山の評価を渡す");
ok(html.indexOf("SoramiFuji.evaluateDay") < html.indexOf("SoramiCapCloud.evaluateDay"),
  "笠雲を富士山より後に評価する");
// **「できはじめる時刻」を名乗らない。** スコアが測っているのは材料の有無で、
// 材料は総観規模でしか動かない。40点の出入りで出したら24時間になった（実データで発覚）
ok(/いちばん整う/.test(html), "いちばん整う時刻を出す");
// コメントではなく**画面に出る文字**を見る（lt-l のラベル）
ok(!/lt-l">出はじめ/.test(html) && !/lt-l">弱まる/.test(html),
  "「出はじめ」「弱まる」をラベルに使わない（できはじめる時刻ではない）");
ok(/雲ができはじめる時刻ではありません/.test(html), "何の時間帯かを画面に書く");
// 点数は人手ラベルで検証した（2026-09-16）。時間帯の出し方は検証していないので、それは書く
ok(/時間帯の出し方そのものは検証していません/.test(html), "時間帯が未検証であることを画面に出す");
ok(!/点数が未検証なので/.test(html), "点数は検証済みなので未検証と書かない");
// ほぼ一日なら「時間帯」と言わない
ok(/t\.allDay/.test(html), "ほぼ一日のときは別の言い方にする");
ok(/一日を通して/.test(html), "絞れていないことを絞れたように見せない");
ok(/前後の日へ続いている可能性があります/.test(html), "日をまたぐ場合を黙って切らない");
ok(/href="#\/capCloud"/.test(html), "押すと笠雲の詳細へ行く");

console.log("== 写真から時刻を読む ==");
// 3択より「いつ・どこで撮ったか」のほうが照合に使える。
// 採点は時間帯に対して出しているので、その中で撮られたかが分からないと測れない
// （雲海の正例162日のうち44日は窓の外で撮られていた）。
ok(/sorami-exif\.js/.test(html), "EXIF の読み取りを読み込んでいる");
ok(/SoramiExif\.readFile\(file\)/.test(html), "File から読む（先頭だけ）");
ok(/写真から時刻を読む/.test(html), "記録の画面に入口がある");
// **画像を送らない。** 送る設計にすると保存先も費用も要る
ok(!/FileReader\(\)[\s\S]{0,200}readAsDataURL/.test(html), "画像をデータURLにしていない");
ok(!/photoDataUrl|photoBase64|imageBlob/.test(html), "画像そのものを記録へ入れていない");
// 一眼は時差タグを付けない。**日本と決め打ちしない**
ok(/bundle\?\.utcOffsetSeconds/.test(html), "時差は取得済みの予報から取る");
ok(!/instantFrom\([^,]+, 540\)/.test(html), "JST を決め打ちしていない");
// 窓の外の写真も陰性にしない
ok(/photoOutsideWindow/.test(html), "採点の時間帯の外かどうかを持つ");
ok(/採点した時間帯の外/.test(html), "外なら画面に出す");
ok(/photoDistanceM/.test(html), "記録した地点からの距離を持つ");
// 距離は数字を出すだけでは判断材料にならない。**スマホの写真前提**（水平10m前後）で
// 300m以内は同じ場所、3km超は別の場所として言い方を変える
ok(/if \(d <= 300\) return "・この場所で撮影"/.test(html), "近ければ裏付けとして言う");
ok(/km 離れた場所で撮影<\/strong>/.test(html), "遠ければ強調して知らせる");
// 写真の GPSAltitude は標高（ジオイド補正済み）で、Geolocation API の楕円体高とは別物。
// 実測で DEM と 1.4m しか違わなかったので、地上高として使える
ok(/photoAglM/.test(html), "写真から地上何mかを出す");
ok(/function shotHeightNote/.test(html), "立つ高さと食い違ったら知らせる");
// **1枚での確認なので自動で書き換えない**
ok(!/place\.eyeHeightAGL = /.test(html), "写真から立つ高さを勝手に変えない");
// 取り込んだ値を信用しない（同期でサーバー越しにも入る）
ok(/photoLatitude: num\(r\.photoLatitude, -90, 90\)/.test(html), "緯度の範囲を検査する");
ok(/photoOutsideWindow: r\.photoOutsideWindow === true/.test(html), "真偽値を素通りさせない");

console.log("== 建物の地平線（urban 層）==");
// 新宿中央公園では月が地平線より上にいる時間の 31.3% が建物の裏（2026-09-14 実測）。
// 地形だけだと市街地の地平線はほぼ 0度で、見えない時間を見えると言ってしまう。
ok(/connect-src[^"]*https:\/\/overpass-api\.de/.test(html), "CSP に Overpass を通してある");
{
  // 問い合わせ先（SoramiTerrain.OVERPASS）は全部 CSP で通っていなければ、ブラウザが黙って止める
  const T = (await import("node:module")).createRequire(import.meta.url)("./sorami-terrain.js");
  const meta = (html.match(/http-equiv="Content-Security-Policy" content="([^"]*)"/) || [])[1] || "";
  const csp = (meta.match(/connect-src ([^;]*)/) || [])[1] || "";
  const missing = T.OVERPASS.map((u) => new URL(u).origin).filter((o) => !csp.split(/\s+/).includes(o));
  ok(missing.length === 0 && T.OVERPASS.length >= 3, "Overpass の問い合わせ先がすべて CSP で通っている", missing.join(" "));
  const terrainSrc = fs.readFileSync(new URL("./sorami-terrain.js", import.meta.url), "utf8");
  ok(/\[out:json\]\[timeout:\d+\]\[maxsize:\d+\]/.test(terrainSrc),
    "Overpass への問い合わせは使うメモリを宣言する（既定の 512MB は混むと 504）");
}
ok(/SoramiTerrain\.urbanHorizon\(/.test(html), "建物の地平線を取りに行く");
// 建物は非同期。まず地形だけで地平線を作り、届いたら重ねて作り直す。
// 取れなければ地形だけのまま（`.catch(() => {})` で黙って落ちない）
ok(/fn = SoramiTerrain\.combinedHorizon\(\{ terrain: prof \}\)/.test(html),
  "まず地形だけで地平線を作る");
ok(/moonHorizon = SoramiTerrain\.combinedHorizon\(\{[\s\S]{0,120}urban \}\)/.test(html),
  "建物が届いたら地平線を作り直す");
ok(/loadUrbanHorizon\(obs\)[\s\S]{0,1400}\.catch\(\(\) => \{\}\)/.test(html),
  "建物が取れなくても地形だけで続ける");
ok(/URBAN_CACHE_KEY/.test(html) && /URBAN_CACHE_VERSION/.test(html),
  "地点ごとにキャッシュする（毎回 410KB 引かない）");
ok(/radiusM: \[1000, 400\]/.test(html), "半径も段階で試す");
ok(/地図に高さが登録されていない建物は入りません/.test(html),
  "不完全なデータであることを画面に出す");
ok(/半径\$\{moonUrbanMeta\.radiusM\}mの建物 \$\{moonUrbanMeta\.buildings\} 棟/.test(html), "どの半径で何棟入れたかを出す");
// Overpass は混むと30秒返ってこない（実測）。待つと月の行がその間ずっと出ない。
ok(/loadUrbanHorizon\(obs\)\.then\(/.test(html), "建物は待たずに、届いたら差し替える");
ok(/moonUrbanTried = true;[\s\S]{0,200}loadUrbanHorizon/.test(html), "取得は地点ごとに1回だけ");
// 地形の測定は標高APIが混むと429で落ちる。市街地の地平線を決めているのは建物なので、
// 地形が取れないことを理由に建物まで諦めない
// 2026-09-17: 地域代表点だけ除外。具体地点はDEM失敗時も建物を取る。
ok(/if \(!moonUrbanTried && obs\.locationScope !== "area"\) \{/.test(html), "具体地点では地形が取れなくても建物は取りに行く");
// 建物層は「建物の無い方位＝−90（何も言わない）」なので、**単独で使うと壊れる**。
// 地形が測れていなければ平らな 0 を下敷きにする（実際に単独で使って、
// 芝公園の月の出が暦より343分早い 2:38 と出た）
ok(/terrain: moonTerrainProfile \|\| SoramiTerrain\.flatProfile\(\), urban/.test(html),
  "建物だけで地平線を作らず、平らな地形を下敷きにする");
// 地点が変わったら建物も捨てる。残すと引っ越しても前の場所の地平線のままになる
ok(/moonTerrainProfile = null; moonUrbanMeta = null; moonUrbanTried = false;/.test(html),
  "地点が変わったら建物の状態も捨てる");

console.log("== 地平線は全周を測る ==");
// 「今日の月の方位 ±8度」だけ測っていたが、月の出の方位は14日で45度以上動く
// （東京: 79.9〜125.3度）。測っていない方位は horizonFunction が線形補間で埋めるので、
// 表の後ろの日は実測していない地平線で判定していた。
ok(/for \(let a = 0; a < 360; a \+= 1\) azs\.push\(a\)/.test(html), "全周を1度刻みで測る");
ok(!/for \(let d = -8; d <= 8; d \+= 2\) azs\.push/.test(html), "月の方位まわりだけを測る旧実装が残っていない");

console.log("== 月・富士山・笠雲を「次の見どころ」に出さない ==");
// 晴れていればだいたい見えるので、放っておくと見どころの枠を占め続け、
// 雲海や虹のような「その日だけ」の現象を押し出す（2026-09-14 ユーザー指摘）。
// 表の行としては残すので、除外は見どころの選定だけに効かせる。
const pickHighlight = runInNewContext(
  html.slice(html.indexOf("const LEAD_PENALTY"), html.indexOf("function pickHighlight"))
  + html.slice(html.indexOf("function pickHighlight"),
               html.indexOf("\n}", html.indexOf("function pickHighlight")) + 2)
  + ";pickHighlight", { S: coreMod });

const mkEv = (score) => ({ score, peak: 1000, window: [0, 9e15], unavailable: false,
  confidence: { key: "high" }, models: 8 });
const weeksBoth = {
  moon:        [{ evaluation: mkEv(98) }],
  fuji:        [{ evaluation: mkEv(97) }],
  seaOfClouds: [{ evaluation: mkEv(40) }],
};
const gotBoth = pickHighlight(weeksBoth, 0);
ok(gotBoth && gotBoth.id === "seaOfClouds",
  `98点の月と97点の富士山があっても40点の雲海が見どころになる（実際: ${gotBoth && gotBoth.id}）`);

// 除外が効きすぎて何も出なくならないこと
const gotOnlyMoon = pickHighlight({ moon: [{ evaluation: mkEv(98) }] }, 0);
ok(gotOnlyMoon === null, "月しか無ければ見どころは出ない（月を見どころに昇格させない）");

// 通常の現象どうしの選定は変えていない
const gotNormal = pickHighlight({
  sunset: [{ evaluation: mkEv(70) }], rainbow: [{ evaluation: mkEv(85) }],
}, 0);
ok(gotNormal && gotNormal.id === "rainbow", "月・富士山以外の選び方は変わっていない");

// 笠雲は理由が違う（高い点でも実際に見えるのは十数回に1回。2026-09-17 ユーザー判断）
const gotCap = pickHighlight({ capCloud: [{ evaluation: mkEv(99) }], seaOfClouds: [{ evaluation: mkEv(40) }] }, 0);
ok(gotCap && gotCap.id === "seaOfClouds",
  `99点の笠雲があっても40点の雲海が見どころになる（実際: ${gotCap && gotCap.id}）`);

// フラグは PHENOMENA 側に持つ（id のベタ書きにしない）
ok(coreMod.PHENOMENA.moon.highlight === false, "PHENOMENA.moon.highlight が false");
ok(coreMod.PHENOMENA.fuji.highlight === false, "PHENOMENA.fuji.highlight が false");
ok(coreMod.PHENOMENA.capCloud.highlight === false, "PHENOMENA.capCloud.highlight が false");
ok(coreMod.PHENOMENA.seaOfClouds.highlight !== false, "雲海は見どころに出す");
ok(!/id === "moon"[\s\S]{0,40}continue/.test(html), "除外を id のベタ書きで書いていない");

console.log("== 「±0」を出さない ==");
// 51通りが全部同じ値になることは珍しくない（上限や100点の頭打ちに張り付く）。
// そのとき「±0」と出すと、点数が正確だという意味に読める。実測誤差は当日でも12.6点ある。
ok(/const err = raw === 0 \? null : raw/.test(html), "誤差が0に丸まるときは付けない");
const explainConfidence = runInNewContext(html.slice(html.indexOf("function confidenceText(ev)"),
  html.indexOf("// 51メンバーの散らばりを見せる。")) + ";confidenceText", { S: coreMod });
const zeroErrorText = explainConfidence({uncertainty:{basis:"ensemble",expectedError:0,ensembleMembers:51},confidence:{key:"high"},models:8});
ok(!zeroErrorText.includes("±0点") && zeroErrorText.includes("あまり動きません"), "説明文も「±0点」と言わない");

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
// 2026-09-24: 富士山だけ日のカードを3段にしたので、クラスは式で組み立てている
const dayBtn = html.slice(html.indexOf('<button class="day${attrs}'),
                          html.indexOf('<button class="day${attrs}') + 700);
ok(dayBtn.indexOf('class="g"') > dayBtn.indexOf('class="d"'),
  "等級は点数と別の行に置く（日付より後ろ）");
ok(/\.day \.g \{[^}]*border:/.test(html), "枠で囲んでラベルの見た目にする");
// 朝・日中・夕を持つ現象は、日のカードも3段にする（一日のトータル1つだと、
// どの時間帯の話か日ごとに比べられない。2026-09-24 ユーザー指摘）
ok(/class="bd"/.test(html) && /ev\.bands\.some/.test(html), "日のカードは bands があれば3段で出す");
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
// 2026-09-14 にユーザー判断で「絶景予報」→「絶景予測」へ戻した。
// 2026-09-06 に一度「絶景予測」にしてから「絶景予報」へ変えた経緯があるので、
// **どちらが現行かは記録を見る**（Vault ドメイン/開発/絶景日和/00_はじめに）。
// 気象業務法が定義している語は「予報」で、その語をそのまま名乗る利点が無い。
ok(mani.name === "絶景予測" && mani.short_name === "絶景予測", "マニフェストの名前が現在の名称");
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
// 2026-10-01 から iconFor（月はその時の満ち欠け）で描く
ok(/const icons = \(f\.phenomena[\s\S]{0,120}iconFor\(p\)/.test(html)
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
ok(/const refetch = \(place\.terrain[\s\S]{0,140}place\.elevation[\s\S]{0,500}if \(refetch\) \{[^}]*load\(true\)/.test(html),
  "地形か標高が変わったら予報を取り直す"); // 目高と地点種別の保存を追加した分だけ探索幅を拡大

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
// 寒さの2つは隣どうしで、いちばん下（2026-09-27 ユーザー指定）
{
  const byOrder = Object.entries(coreMod.PHENOMENA).sort((a, b) => a[1].order - b[1].order).map(([k]) => k);
  const i = byOrder.indexOf("rime"), j = byOrder.indexOf("diamondDust");
  ok(j === i + 1, "霧氷とダイヤモンドダストが隣", `${byOrder[i]} → ${byOrder[j]}`);
  ok(j === byOrder.length - 1, "その2つがいちばん下", byOrder.join(" / "));
}
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
// **連番であることは求めない。** 富士山(5)・笠雲(5.5) が雲海と霧氷のあいだに入り、
// 霧氷とダイヤモンドダストは 7・8 でいちばん下（2026-09-27 ユーザー指定）。
// 見るのは「この並びであること」。
const seq = ["sunrise", "sunset", "starrySky", "rainbow", "seaOfClouds", "rime", "diamondDust"];
const got = seq.map(orderOf);
ok(got.every((v, i) => v !== null && (i === 0 || v > got[i - 1])),
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
// 2026-09-20 ユーザー指定で中央の選択肢を「予測通り」に変更。保存キーは維持。
ok(/期待以上[\s\S]{0,40}予測通り[\s\S]{0,40}期待外れ/.test(coreSrc), "質は3段階で訊く");
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
// 2026-09-28: **保存先の説明をやめた**（ユーザー「この説明はいらない。説明する必要が
// ないものが多い」）。ログインして使うことは入口で分かるので、画面で言い直さない。
ok(!/アカウントに保存され、ログインした端末で共有されます/.test(recCard),
  "記録画面で保存先を説明しない");
ok(!/storageNote/.test(html), "保存領域の注意も出さない");
ok(/id="exportBtn"/.test(recCard) && /id="importBtn"/.test(recCard),
  "書き出し・読み込みは残す");

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
// 2026-09-08 まで地点名だけで照合していた。改名しても記録を置き去りにしないための形
// だったが、**同名の別地点で上書きが起きた**（調査 C-5）ので座標での照合へ変えた。
// 改名で記録を失わない、という元の目的は renameSightings が引き続き担う。
ok(/samePlaceAs\(s, place\)/.test(html), "記録の照合は座標（同名の別地点を分ける）");
ok(!/s\.placeName === place\.name/.test(html), "地点名だけの照合が残っていない");
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
ok(/aria-pressed="false">\$\{iconFor\(id\)\}/.test(html), "現象チップに aria-pressed がある");
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
// 保存領域の保護。**申請だけして結果は出さない**（消えても本体はアカウントにあり、
// 利用者にできることが無い。2026-09-28）
ok(/navigator\.storage\?\.persist\?\.\(\)/.test(html), "保存領域の保護を申請する");
// 結果は画面に出さない。**出しても利用者にできることが無い**（本体はアカウントにある）
ok(!/id="storageNote"/.test(html), "申請の結果は画面に出さない");
// 保存場所を隠さない
ok(/アカウントに保存され、ログインした端末で共有されます/.test(html), "どこに保存されるかを画面で言う");
ok((html.match(/アカウントに保存され/g) || []).length >= 1,
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
// 2026-09-08 まではメモリのみだった。読み込み直しで消えるので、
// 自動更新のたびに再ログインが要る状態になり、保存する形へ変えた。
// **Cookie は使わない。** 使うと CSRF を考えなければならなくなる。
ok(/headers\.authorization = `Bearer \$\{auth\.token\}`/.test(html), "ヘッダで送る（Cookie を使わない）");
ok(!/document\.cookie/.test(html), "Cookie に入れない");
// 401 でデータを消さない。消すと、サーバーが一時的に落ちただけで手元が空になる。
// 401 で落とすのは「ログイン状態」と「管理画面に出ていた他人の情報」だけ。
// **お気に入りと記録は残す**（サーバーが一時的に落ちただけで手元が空にならないように）
ok(/if \(res\.status === 401 && auth\) \{ clearAuth\(\); clearAdminView\(\); renderAuthButton\(\); \}/.test(html),
  "401 ではログイン状態と管理画面の中身だけ落とす");
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
ok(/function requireLogin\(what\) \{\s*\n\s*if \(auth\) return true;/.test(html),
  "未ログインでは登録させない");
ok(/function openFavSheet\(index[^)]*\) \{\s*\n\s*if \(!requireLoginForFavorites\(\)\) return;/.test(html),
  "登録フォームを開く前に確かめる");
ok(/\$\{what\}にはログインが要ります/.test(html) && /お気に入りの登録/.test(html),
  "理由を言ってログインへ案内する");
// 既に端末にあるものは消さない。見えるし選べる。
ok(/data-fav="\$\{i\}"/.test(html), "手元のお気に入りは引き続き選べる");
ok(!/maybeSuggestLogin/.test(html), "登録できてしまう前提の促しは残っていない");
// パスキー非対応のブラウザで、押せないボタンを出さない
ok(/const supported = !!window\.PublicKeyCredential/.test(html), "パスキーの対応を見る");

console.log("== はじめて使うときの登録 ==");
ok(/id="panelSignup"/.test(html) && /id="doSignup"/.test(html), "新規登録の口がある");
// 打ち間違えたパスワードで登録すると本人が入れなくなる。送る前に確かめる。
ok(/if \(pw !== \$\("newPw2"\)\.value\)/.test(html), "パスワードを2回確かめる");
ok(/const weak = checkPw\(pw/.test(html), "弱いパスワードは送る前に弾く");
ok(/finally \{ \$\("newPw"\)\.value = ""; \$\("newPw2"\)\.value = ""; \}/.test(html),
  "入力欄にパスワードを残さない");
ok(/autocomplete="new-password"/.test(html), "パスワード管理アプリに新規だと伝える");

// 2026-09-21 ユーザー「新規登録からパスキーを選択できるように。IDは必須。
// なるべくパスキーに誘導したい」。パスワードを作らせてから足す形だと、結局パスワードが残る。
const signupWays = html.slice(html.indexOf('id="panelSignup"'), html.indexOf('id="panelPasskey"'));
ok(/id="doSignupPasskey"/.test(signupWays), "新規登録の画面からパスキーを選べる");
ok(/id="newId"/.test(signupWays), "**IDは必須のまま**（回復も管理も名乗る名前が要る）");
ok(signupWays.indexOf('id="doSignupPasskey"') < signupWays.indexOf('id="newPw"'),
  "パスキーを先に出す（誘導）");
ok(/id="doSignupPasskey" class="fav-btn primary"/.test(signupWays), "パスキーが主ボタン");
ok(/id="showSignupPw" class="tap"/.test(signupWays), "パスワードは選べるが主役にしない");
ok(/function setSignupWays\(\)[\s\S]{0,300}\$\("signupPwWay"\)\.hidden = supported/.test(html),
  "対応端末ではパスワードの欄を最初から出さない");
ok(/\$\("signupPasskeyWay"\)\.hidden = !supported/.test(html),
  "非対応の端末ではパスキーの口を丸ごと隠す");
// パスキーだけのアカウントは、端末を失うと入る手段がゼロになる。
// 回復コードは一度しか出せないので、見せきる前に閉じない。
ok(/signupWithPasskey\([\s\S]{0,400}keepOpen: true/.test(html), "回復コードを見せる前に閉じない");
ok(/showCodes\(res\.codes\)/.test(html), "**回復コードをその場で見せる**");
ok(/\/signup\/passkey\/begin[\s\S]{0,400}\/signup\/passkey\/finish/.test(html),
  "登録は2手（challenge を受けてから署名を返す）");

// 2026-09-22 ユーザー指摘「ID入力欄の下に出した方がいいよね」。
// エラーはシートの最下部に1つだけ置いていたので、IDを入れずにパスキーを押すと
// 指の位置から遠い下端に理由が出ていた。**直す欄の下に出す。**
ok(signupWays.indexOf('id="newIdErr"') > signupWays.indexOf('id="newId"')
  && signupWays.indexOf('id="newIdErr"') < signupWays.indexOf('id="doSignupPasskey"'),
  "**IDの理由はID欄とパスキーのボタンの間に出す**");
ok(/id="newPwErr"[\s\S]{0,200}id="doSignup"/.test(signupWays), "パスワードの理由はその欄の下");
ok(/authFail\(\$\("newIdErr"\), ID_MSG\)/.test(html), "IDの形が違うときはID欄の下");
ok(/authFail\(\$\("newPwErr"\), "パスワードが一致しません"\)/.test(html),
  "パスワードの話はパスワード欄の下");
ok(/catch \(e\) \{[\s\S]{0,80}authFail\(\$\("newIdErr"\), e\.message\)/.test(html),
  "パスキーは送るのがIDだけなので、サーバーの断りもID欄の下");
ok(/\^\(このID\|IDは6\)/.test(html), "サーバーの断り文句も、直せる欄へ振り分ける");
// 消し忘れると、直した欄の下に古い理由が残る
ok(/const AUTH_ERRS = \["authErr", "newIdErr", "newPwErr"\]/.test(html)
  && /function showAuthPanel[\s\S]{0,80}clearAuthErrs\(\)/.test(html),
  "次に出すときは前の理由を全部消す");

// 2026-09-22 ユーザー指摘「普通に再試行ボタンを大きく出せばいい。取れなかったって簡単に書いといて」。
// 以前は API の英語の理由をそのまま括弧で出し、再試行は文末の小さな文字だった。
console.log("== 予報が取れなかったとき ==");
ok(!/予報を取得できませんでした（\$\{esc\(e\.message\)\}）/.test(html), "英語の理由をそのまま出さない");
ok(/id="retry" class="fav-btn primary">再試行</.test(html), "**再試行を主ボタンで大きく出す**");
ok(/予測に失敗しました/.test(html), "理由は短く1行");
// このアプリが出すものは「予測」。材料にしている気象庁やECMWFのものが「予報」。
ok(!/予報を取れませんでした|予報を取得できませんでした/.test(html), "自分の出力を「予報」と呼ばない");
ok(/console\.warn\("予測の取得に失敗:"/.test(html), "理由は console に残す（追えなくしない）");
ok(/navigator\.onLine === false \? "通信が切れているようです"/.test(html),
  "通信が切れているときだけは言い方を変える（押しても直らないため）");

console.log("== 端末とパスワードの出し入れ ==");
ok(/data-delkey="\$\{esc\(c\.id\)\}"/.test(html), "登録した端末を消せる");
ok(/confirm\("この端末のパスキーを消します/.test(html), "消す前に確かめる");
// 断って終わりにしない。その場で直せる場所を開く。
ok(/最後のパスキー\/\.test\(e\.message\)[\s\S]{0,140}\$\("newAccPw"\)\.focus\(\)/.test(html),
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
ok(/res\.remaining <= RECOVERY_LOW/.test(html), "回復コードの残りが少なくなったら知らせる");
// 入れなくなりそうな状態は、起きてから言っても遅い。**数ではなく中身で判定する**
// （2026-09-08 に置き換え。上の「締め出しの危なさ」の節が本体）
ok(/nextStep\(\{ passkeys: \(me\.credentials \|\| \[\]\)\.length/.test(html),
  "アカウント画面でも同じ判定を使う");
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
// 「選択肢のラベルは名詞だけにする」（技術構成のUI方針）。
// 「入れなくなったとき」は時を表す節で、隣の「新規登録」と形が揃っていなかった。
ok(/>新規登録<\/button>/.test(authSheet) && /アカウントの回復<\/button>/.test(authSheet),
  "入口のラベルが名詞で揃っている");
ok(!/とき<\/button>/.test(authSheet), "ボタンのラベルに節を使わない");
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
ok(/res\.remaining <= RECOVERY_LOW[\s\S]{0,160}発行し直して/.test(html), "残りが少なくなったら作り直しを促す");
// 使ったときの通知と、アカウント画面の案内で**同じしきい値**を使う。
// 別々の数だと「知らせは来たのに画面は何も言わない」という食い違いが起きる
ok((html.match(/RECOVERY_LOW/g) || []).length >= 3, "しきい値は1か所で決める",
  String((html.match(/RECOVERY_LOW/g) || []).length));
ok(/const RECOVERY_LOW = 3;/.test(html), "3以下で促す（3・2・1・0）");
ok(/>新規登録<\/button>/.test(html), "入口のラベルは「新規登録」");

console.log("== 管理者の画面 ==");
ok(/id="adminView"/.test(html), "画面がある");
ok(/location\.hash === "#\/admin"/.test(html), "URLで開ける");
ok(/\{ id: "admin",\s+el: "adminView"/.test(html), "他の画面と出し分ける");
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
ok(/step\.level === "warn" \|\| step\.level === "danger"/.test(html), "締め出されそうな人を目立たせる");
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
// `=>` の直後の累乗（2 ** z）に反応しないよう、矢印は除いて見る
const visible = html.split("\n").filter((l) => !/^\s*(\/\/|\*|<!--)/.test(l))
  .filter((l) => /confirm\(|alert\(|textContent =|[^=]>[^<]*\*\*/.test(l) && l.includes("**"));
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
ok(/絶景予測 \$\{location\.origin\}/.test(html), "どのサイトのものか分かるようにする");

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

console.log("== 利用者一覧で、何で入っているかが一目で分かる ==");
// 2026-09-08 ユーザー「誰がなんの認証方法か分かり易い方がいい」。
// 手段は出ていたが「パスワード ・ パスキー2 ・ 回復コード10 ・ 登録 …」と
// 一列に混ざっていて、**実際に何で入るのかが読み取りにくかった。**
{
  const start = html.indexOf("function authWays(");
  ok(start > 0, "手段の見せ方が関数として取り出せる");
  const src = html.slice(start);
  const authWays = new Function(`${src.slice(0, src.indexOf("\n}\n") + 3)}; return authWays;`)();

  ok(authWays({ has_password: true, passkeys: 0, codes: 0 }).labels.join() === "PW",
    "パスワードだけなら PW");
  ok(authWays({ has_password: false, passkeys: 1, codes: 0 }).labels.join() === "パスキー",
    "パスキー1台なら数を出さない");
  ok(authWays({ has_password: false, passkeys: 2, codes: 0 }).labels.join() === "パスキー2",
    "2台以上なら台数を印に入れる");
  ok(authWays({ has_password: true, passkeys: 1, codes: 0 }).labels.join() === "パスキー,PW",
    "両方あるなら両方");
  // 回復コードは「入る手段」だが、日常の入り方ではないので分けて数える
  ok(!authWays({ has_password: true, passkeys: 1, codes: 10 }).labels.includes("回復コード"),
    "回復コードは日常の入り方に混ぜない");
  ok(authWays({ has_password: false, passkeys: 0, codes: 5 }).labels.join() === "回復コードのみ",
    "回復コードしか無いなら、そう言い切る");
  ok(authWays({ has_password: false, passkeys: 0, codes: 0 }).labels.join() === "なし",
    "何も無ければ「なし」");

  // **印で言ったことを、下の行で繰り返さない**（2026-09-08 ユーザー指摘）
  const d = authWays({ has_password: true, passkeys: 2, codes: 7 }).detail;
  ok(!d.includes("パスワード"), "「パスワードあり」を繰り返さない", d);
  ok(!d.includes("パスキー"), "パスキーの台数も印に入っているので繰り返さない", d);
  ok(d === "回復コード7", "残すのは印に出ない回復コードの数だけ", d);

  // 締め出しの近さは、いまも数で見る
  ok(authWays({ has_password: true, passkeys: 1, codes: 10 }).methods === 3, "手段の数を数える");
  ok(authWays({ has_password: false, passkeys: 1, codes: 0 }).methods === 1, "1つだけなら1");
}
// 一覧では、印として並べる
ok(/class="way"/.test(html), "手段を印として出す");

console.log("== 管理者がパスキーを失効できる。ただし黙って締め出さない ==");
// 2026-09-08 の調査 D-2。API はあるのに画面に口が無く、急ぐ場面でコマンドを
// 探すことになっていた。盗まれた端末を切るのは急ぐ操作なので、画面に置く。
ok(/data-revoke=/.test(html), "失効の口がある");
ok(/apiCall\("POST", "\/admin\/revoke-credential"/.test(html), "失効の経路を叩く");
// **相手を締め出しうる操作。** 唯一の入り方なら、そう言ってから訊く
ok(/const locksOut = el\.dataset\.last === "1";/.test(html), "締め出しになるかを見る");
ok(/これがこの人の唯一の入り方です/.test(html), "締め出しになると言う");
ok(/先に回復コードを発行して渡してください/.test(html), "どうすればいいかを言う");
// 押した瞬間に相手のセッションも切れることを、押す前に伝える
ok(/いま開いている画面もすべて切れます/.test(html), "何が起きるかを言う");
// 端末の名前を出す。どれを切るのか分からないまま押させない
ok(/data-label="\$\{esc\(c\.label \|\| "この端末"\)\}"/.test(html), "どの端末かを出す");

console.log("== 日常の入り方を必ず1つ残す ==");
// 2026-09-08 ユーザー判断で仕様変更。認められる状態は3つだけ。
//   パスワードのみ / パスワードとパスキー / パスキーのみ
// **回復コードは補助であって、代わりにはならない。**
// 以前は「回復コードが残っていれば最後のパスキーも消せる」形で、
// 使い切った時点で入れなくなる状態を自分で作れてしまった。
ok(/最後のパスキー/.test(html), "断られたときの理由を見て、直せる場所を開く");
ok(!/最後の認証手段/.test(html), "古い言い回しが残っていない");
// 回復コードを逃げ道として案内しない
ok(!/回復コードを発行してください」/.test(html), "回復コードで代替できると言わない");

console.log("== 状態は短く言い切る ==");
// 2026-09-08 ユーザー「パスワード：無効にしてある なんで パスワード：無効 とかってできないの」。
// 状態の表示に説明を混ぜない。**何をしたかではなく、いまどうかを出す。**
ok(/パスワード: \$\{me\.hasPassword \? "有効" : "無効"\}/.test(html), "有効／無効で言い切る");
ok(!/無効にしてある/.test(html), "「無効にしてある」が残っていない");
ok(!/hasPassword \? "使える"/.test(html), "「使える」が残っていない");

console.log("== 次の一歩を示す ==");
// 2026-09-08 ユーザー: 「パスキーを使ってない人にはパスキーの薦め。
// パスキーを使ってる人にはPWの無効化の薦め。パスキーでPWの無効化が済んだ場合は
// 回復コードについて。もっとしっかり意味があるように」。
//
// 危なさを言うだけでは、次に何をすればいいか分からない。**一番好ましい形
// （パスキー＋パスワード無効＋回復コードを保管）へ向かう順序**として示す。
//
// 数で判定していた頃の問題も引き継いで直す: パスキー2台は「2」だが同じ
// キーチェーンなら実質1つ。台数は端末を失う話の答えにならない。
{
  // しきい値の定数も含めて取り出す（値だけ変えたときに壊れないよう、名前で切る）
  const start = html.indexOf("const RECOVERY_LOW =");
  ok(start > 0, "次の一歩の判定が関数として取り出せる");
  const src = html.slice(start);
  const nextStep = new Function(`${src.slice(0, src.indexOf("\n}\n") + 3)}; return nextStep;`)();
  const at = (pk, pw, codes) => nextStep({ passkeys: pk, has_password: pw, codes });

  // 1段目: パスキーを使っていない人には、パスキーを薦める
  ok(at(0, true, 10).level === "suggest", "パスキー未登録は「薦め」");
  ok(at(0, true, 10).message.includes("パスキー"), "パスキーを薦める", at(0, true, 10).message);

  // 2段目: パスキーが使えている人には、パスワードの無効化を薦める
  ok(at(1, true, 10).level === "suggest", "パスキーがあってPWも生きていれば「薦め」");
  ok(at(1, true, 10).message.includes("パスワード"), "パスワードの無効化を薦める", at(1, true, 10).message);

  // 3段目: 無効化まで済んだら、回復コードの話
  ok(at(1, false, 0).level === "warn", "パスキーのみで回復コード0は警告");
  ok(at(1, false, 0).message.includes("回復コード"), "回復コードを薦める", at(1, false, 0).message);
  ok(at(3, false, 0).level === "warn", "**台数では解決しない**");

  // 到達点: 何も言わない
  ok(at(1, false, 10).level === "ok" && at(1, false, 10).message === "",
    "パスキー＋PW無効＋回復コードなら、何も言わない");
  ok(at(3, false, 10).level === "ok", "台数が多くても同じく完了");

  // **残りが少なくなったら発行し直しを促す**（2026-09-08 ユーザー指定）。
  // パスキーのみの人にとって、回復コードは端末を失ったときの唯一の戻り道。
  // 10個渡るのはパスワードを無効にしたときで、そのあと使うたびに減る。
  ok(at(1, false, 4).level === "ok", "残り4はまだ言わない");
  ok(at(1, false, 3).level === "warn", "残り3で促す");
  ok(at(1, false, 1).level === "warn", "残り1でも促す");
  ok(at(1, false, 3).message.includes("残り3"), "残りの数を出す", at(1, false, 3).message);
  ok(at(1, false, 3).message.includes("発行"), "発行し直すよう言う", at(1, false, 3).message);
  // パスワードが生きている人には言わない。戻り道が別にある
  ok(at(1, true, 1).level === "suggest", "パスワードがあれば、残りが少なくても急かさない");

  // 危ない側
  ok(at(0, true, 0).level === "warn", "PWだけで回復コード0は警告");
  ok(at(0, true, 0).message.includes("忘れる"), "忘れたら戻れないと言う", at(0, true, 0).message);
  ok(at(0, false, 3).level === "warn", "回復コードだけは警告");
  ok(at(0, false, 0).level === "danger", "手段ゼロは危険");

  // **順序が飛ばない。** 薦めは1段ずつ
  ok(at(0, true, 10).message.includes("パスキー") && !at(0, true, 10).message.includes("無効"),
    "パスキー未登録の人に、いきなり無効化を薦めない");
}
// 管理画面には「薦め」を出さない。他人の設定を細かく急かす場所ではない
ok(/step\.level === "warn" \|\| step\.level === "danger"/.test(html),
  "管理画面では危ない人だけ目立たせる");
// 本人の画面には全部出す
ok(/nextStep\(\{ passkeys: \(me\.credentials \|\| \[\]\)\.length/.test(html),
  "アカウント画面でも同じ判定を使う");

console.log("== 管理画面の中身を、ログアウト後に残さない ==");
// 2026-09-08 の調査 E-2。ログアウトはお気に入り・記録・送信待ちを消すが、
// **管理画面に出した他人の回復コードを消していなかった。**
// 画面の切り替えは URL のハッシュだけで決まるので、未ログインでも `#/admin` を
// 開くと残った内容が見える。管理者発行分が無期限だったこと（E-1）と重なると、
// そのまま他人のアカウントに入れる。
ok(/function clearAdminView\(\)/.test(html), "管理画面を空にする処理がある");
// 消す対象: 表示中のコード・その持ち主・一覧・許可リスト・操作の記録
for (const id of ["adminCodes", "adminCodesList", "adminUsers", "adminAllowed", "adminLog"]) {
  const body = html.slice(html.indexOf("function clearAdminView()"),
                          html.indexOf("function clearAdminView()") + 600);
  ok(body.includes(id), `${id} を空にする`);
}
ok(/adminCodes = \[\]/.test(html), "手元に持っているコードも捨てる");
// 呼ぶ場所: ログアウト・退会・401・別の人のログイン
ok((html.match(/clearAdminView\(\)/g) || []).length >= 4,
  "ログアウト・退会・401・利用者の切替で呼ぶ",
  String((html.match(/clearAdminView\(\)/g) || []).length));
// **URLだけで中身を出さない。** 管理者と確認できたときだけ描く
ok(/if \(!auth \|\| auth\.role !== "admin"\)/.test(html), "管理者でなければ描かない");

console.log("== 手元のデータを、別のアカウントへ送らない ==");
// 2026-09-08 の調査 C-1。401でセッションが切れても手元のデータは残す（意図的：
// サーバー障害で手元が空になってはいけない）。しかし次のログインで
// `syncInfo?.loginId !== auth.loginId` を「初回」と読み、**残っていた全データを
// 新しいアカウントへ上げていた。** 共用ブラウザでAが切れたあとBが入ると、
// AのデータがBのアカウントへ複製される。
//
// 判断4（2026-09-08 ユーザー）: **一度もログインしていないときだけ**引き継ぐ。
{
  const start = html.indexOf("function migrationPlan(");
  ok(start > 0, "引き継ぎの判断が関数として取り出せる");
  const src = html.slice(start);
  const end = src.indexOf("\n}\n") + 3;
  const migrationPlan = new Function(`${src.slice(0, end)}; return migrationPlan;`)();

  // 持ち主が居ない = 一度もログインしていない端末
  ok(migrationPlan(null, "okayu0321", true) === "migrate", "初めて入る人は手元の記録を持ち込む");
  ok(migrationPlan(null, "okayu0321", false) === "keep", "手元に何も無ければ何もしない");
  // 同じ人が入り直しただけ
  ok(migrationPlan("okayu0321", "okayu0321", true) === "keep", "同じ人なら、そのまま続き");
  // **別の人。ここが本題**
  ok(migrationPlan("okayu0321", "someone", true) === "discard", "別の人が入ったら、手元のデータは渡さない");
  ok(migrationPlan("okayu0321", "someone", false) === "discard", "中身が無くても、持ち主が違えば捨てる");
  // 大文字小文字はサーバー側で正規化済みだが、念のため同一視する
  ok(migrationPlan("Okayu0321", "okayu0321", true) === "keep", "IDの大小差で別人にしない");
}

// 401では消さない。**サーバーが一時的に落ちただけで手元が空になってはいけない**
ok(!/401[\s\S]{0,160}favorites = \[\]/.test(html), "401でデータを消さない");
// 明示ログアウトでは消す
ok(/\$\("logout"\)\.onclick[\s\S]{0,400}favorites = \[\]; sightings = \[\]/.test(html),
  "ログアウトでは消す");
// 持ち主を覚えておかないと、誰のデータか分からない
ok(/sorami\.owner/.test(html), "手元のデータの持ち主を覚える");

console.log("== 同名の別地点で、記録が上書きされない ==");
// 2026-09-08 の調査 C-5。照合が「地点名・日付・現象」だけだった。
// 「現在地」は移動先でも同じ名前になるので、**別の場所の記録が置き換わる。**
{
  const start = html.indexOf("function samePlaceAs(");
  ok(start > 0, "地点の照合が関数として取り出せる");
  const src = html.slice(start);
  const samePlaceAs = new Function(`${src.slice(0, src.indexOf("\n}\n") + 3)}; return samePlaceAs;`)();

  const here = { name: "現在地", latitude: 35.68, longitude: 139.77 };
  ok(samePlaceAs({ placeName: "現在地", latitude: 35.68, longitude: 139.77 }, here), "同じ座標なら同じ地点");
  ok(samePlaceAs({ placeName: "別の名前", latitude: 35.6803, longitude: 139.7702 }, here),
    "名前が違っても、座標が同じなら同じ地点");
  ok(!samePlaceAs({ placeName: "現在地", latitude: 36.20, longitude: 138.30 }, here),
    "**同じ名前でも、座標が違えば別の地点**");
  // GPSの揺れで別扱いにしない
  ok(samePlaceAs({ placeName: "現在地", latitude: 35.6801, longitude: 139.7701 }, here),
    "わずかなずれは同じ地点");
  // 座標を持たない古い記録は、名前で照合する（移行で記録を失わない）
  ok(samePlaceAs({ placeName: "高ボッチ" }, { name: "高ボッチ", latitude: 36.1, longitude: 138.1 }),
    "座標の無い古い記録は名前で照合する");
  ok(!samePlaceAs({ placeName: "高ボッチ" }, { name: "美ヶ原", latitude: 36.1, longitude: 138.1 }),
    "古い記録でも、名前が違えば別");
}
// 位置ではなくIDで引く（同期で配列が組み直されると、位置は別のものを指す）
ok(!/favorites\[favDraft\.index\]/.test(html), "編集・削除で位置を直接使っていない");
ok(/favorites\.findIndex\(\(f\) => f\.id === favDraft\.id\)/.test(html), "IDで引き直す");

console.log("== 同期が取りこぼさない・黙って捨てない ==");
// C-2: サーバーは 500件で打ち切ったらカーソルもそこで返す。画面は続きを取りに行く
ok(/if \(!got\.more \|\| next <= since\) break;/.test(html), "打ち切られたら続きを取りに行く");
ok(/for \(let round = 0; round < 20; round\+\+\)/.test(html), "無限には回さない");
// **進まなくなったら止める。** 止め方が無いと、サーバーの不具合で画面が固まる
ok(/next <= since/.test(html), "カーソルが進まなければ止める");

// C-3: 送っただけで消さない。サーバーが受理したIDだけ外す
ok(/res\?\.accepted\?\.favorites/.test(html) && /res\?\.accepted\?\.sightings/.test(html),
  "受理されたIDを見る");
ok(!/await apiCall\("POST", "\/sync"[\s\S]{0,120}pushQueue = \[\];/.test(html),
  "送信のあとに無条件でキューを空にしていない");
ok(/pushQueue = pushQueue\.filter\(/.test(html), "受理された分だけ外す");
// 1回の上限は500件。超える分を捨てずに次へ回す
ok(/pushQueue\.slice\(0, 500\)/.test(html), "500件ずつ送る");

console.log("== 確認し直しを求められたら、その場で入り直せる ==");
// 判断1（2026-09-08）。長いセッション（30日）で、直前2時間より古いまま
// 認証手段を変えようとすると、サーバーが断る。
// **断って終わりにしない。** どうすればいいか分からなければ意味がない。
ok(/確認のため、もう一度ログイン/.test(html), "断られたことを見分ける");
ok(/function askReauth\(\)/.test(html), "確認し直しの導線がある");
// IDは分かっているので打ち直させない
// 401 の時点で auth は消えているので、直前のIDを覚えておく必要がある
ok(/askReauth[\s\S]{0,400}\$\("authId"\)\.value = auth\?\.loginId \?\? lastLoginId/.test(html),
  "IDを写す（打ち直させない）");
ok(/let lastLoginId = null;/.test(html), "誰だったかを覚えておく");
ok(/lastLoginId = null;[\s\S]{0,80}dataOwner = null;/.test(html),
  "明示ログアウトでは忘れる（別の人が使うかもしれない）");
// パスキーがあれば、その場で1回のFace IDで済む
ok(/askReauth[\s\S]{0,500}passkeyLogin/.test(html), "パスキーの口をその場に出す");
// 断られた操作は、アカウント画面の中で起きる。そこにエラーを出す
ok(/authFail\(\$\("accountErr"\)/.test(html), "アカウント画面にも理由を出す");

console.log("== CSP で、漏れたときの持ち出し先を塞ぐ ==");
// 2026-09-08 の調査 G-1。CSP が meta にも応答ヘッダにも無かった（実測）。
// **2026-09-07 に実際に動く XSS があった**（記録一覧の s.outcome）。再発したとき、
// いまは何も止めるものが無い。トークンは sessionStorage / localStorage にある。
//
// インライン script を多用しているので script-src は緩めざるを得ない。
// **効くのは connect-src。** 持ち出し先を、実際に使う相手だけに絞る。
{
  const m = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/);
  ok(!!m, "CSP の meta がある");
  const csp = m ? m[1] : "";
  const dir = Object.fromEntries(csp.split(";").map((x) => x.trim()).filter(Boolean)
    .map((x) => { const [k, ...v] = x.split(/\s+/); return [k, v]; }));

  // **通信先を全部数え上げる。1つ落とすと予報が壊れる。**
  const needed = [
    "https://api.open-meteo.com",            // 予報の本体
    "https://ensemble-api.open-meteo.com",   // ばらつき
    "https://air-quality-api.open-meteo.com", // 大気質
    "https://www.jma.go.jp",                 // アメダス実況
    "https://nominatim.openstreetmap.org",   // 地名の検索
    "https://djlorenz.github.io",            // 光害
    "https://zekkei-api.okayu-sorami.workers.dev", // 同期
  ];
  for (const host of needed) {
    ok((dir["connect-src"] || []).includes(host), `${host} へ通信できる`);
  }
  ok((dir["connect-src"] || []).includes("'self'"), "自分自身へも通信できる（更新の確認）");
  // 絞れていること。* だと意味が無い
  ok(!(dir["connect-src"] || []).includes("*"), "connect-src を * にしていない");

  ok((dir["object-src"] || []).includes("'none'"), "object-src を塞ぐ");
  ok((dir["base-uri"] || []).includes("'none'"), "base-uri を塞ぐ（相対URLの行き先を変えられない）");
  ok((dir["form-action"] || []).includes("'none'"), "form-action を塞ぐ");
  // 画像は data: を使う（アイコン）
  ok((dir["img-src"] || []).includes("data:"), "data: の画像は使える");
  // frame-ancestors は meta では効かない。JSで止める
  ok(!("frame-ancestors" in dir), "meta に frame-ancestors を書かない（効かないので）");
}

console.log("== 枠の中で開かれたら止める ==");
// GitHub Pages はヘッダを足せず、frame-ancestors は meta では効かない。
// 「アカウントを削除」「すべての端末からログアウト」など戻せない操作がある（調査 G-2）。
ok(/window\.top !== window\.self/.test(html), "枠の中かどうかを見る");
ok(/枠の中では開けません/.test(html), "理由を出す");

console.log("== 説明文が変なところで折れない ==");
// 2026-09-08 ユーザー「説明文は変なところで改行されないように綺麗にしてね」。
// 「半角英数と記号 [記号] で8〜128桁。」は、狭い画面で「で8〜128桁。」の
// 直前で折れ、**行頭が助詞で始まっていた。** 桁数を先に言い切る形へ変えた。
ok(/半角英数と記号で6〜32桁。/.test(html), "IDは桁数を先に言い切る");
ok(/半角英数と記号で8〜128桁。/.test(html), "PWも桁数を先に言い切る");
// 記号の一覧は「使える記号は …」ごと1かたまりで動かす。途中で割れると読めない
// ID側2つ（新規登録・管理画面の許可リスト）とPW側2つ（新規登録・アカウント画面）
ok((html.match(/<span class="nb">使える記号は/g) || []).length === 4,
  "記号の一覧を4か所すべてで割らせない",
  String((html.match(/<span class="nb">使える記号は/g) || []).length));
ok(/line-break: strict/.test(html), "。や、が行頭に来ないようにする");
// **改行は句読点だけ。** 日本語は既定でどこでも折れるので、両方そろって初めて効く
ok(/word-break: keep-all/.test(html), "自前の折り返しを止める");
ok(/createElement\("wbr"\)/.test(html), "句読点の後ろに折り返し候補を置く");
ok(/split\(\/\(\[。、・\]\)\/\)/.test(html), "区切りは 。 、 ・ の3つ");
ok(/overflow-wrap: anywhere/.test(html), "1文が幅に収まらないときの逃げ道がある");
ok(/querySelectorAll\("\.sheet \.hint, \.sheet \.tiny"\)/.test(html),
  "シートの中の説明文すべてに効かせる");
ok(/\.sheet \.hint, \.sheet \.tiny \{ line-break: strict/.test(html),
  "本文の .tiny には効かせない（シートの中だけ）");
ok(/\.nb \{ white-space: nowrap; \}/.test(html), "割らせない指定がある");
// 固有名詞と、強調している短い語句は割らない
// 「/」の前後の空白でも折れてしまうので、ひとまとまりで包む
// 「次から」の直後の空白でも折れる。**助詞や副詞だけが行末に取り残される。**
ok(/<span class="nb">次から Face ID \/ Touch ID<\/span>/.test(html),
  "「次から Face ID / Touch ID」をひとまとまりにする");
ok(/<span class="nb">Face ID \/ Touch ID<\/span> で入れます。/.test(html),
  "ログイン画面の方も割らない");
ok(!/<span class="nb">Face ID<\/span> \//.test(html), "「/」で割れる書き方が残っていない");
ok(/<strong class="nb">あとから変えられません。<\/strong>/.test(html), "強調した語句を割らない（登録）");

console.log("== シートを開いている間、後ろが動かない ==");
// 2026-09-08 ユーザー指摘「ログイン画面とかアカウント情報見てる時に後ろがスクロールできる」。
// **<dialog> は背面の「操作」は止めるが「スクロール」は止めない。**
// 指やホイールが背面に乗ると本文が流れ、閉じたときに別の場所を見ていることになる。
ok(/const scrollLock/.test(html), "本文のスクロールを止める仕掛けがある");
ok(/position: "fixed"/.test(html), "iOS でも止まるよう位置を固定する");
ok(/top: `\$\{-y\}px`/.test(html), "固定しても見ている位置がずれない");
ok(/window\.scrollTo\(0, y\)/.test(html), "閉じたら元の位置へ戻す");
ok(/if \(depth\+\+\) return;/.test(html), "入れ子で開いても二重に固定しない");
// 開閉の呼び出しは10か所以上ある。**書き足す形にすると必ず漏れる**
ok(/querySelectorAll\("dialog"\)[\s\S]{0,200}MutationObserver/.test(html),
  "個々の開閉ではなく dialog をまとめて見る");
ok(/attributeFilter: \["open"\]/.test(html), "open 属性の変化で判断する");
ok(/scrollbar-gutter: stable/.test(html), "止めた瞬間に横幅が変わらない");
// シートすべてが対象。1つでも漏れると、そこだけ後ろが動く
// 2026-09-24: 地図で選ぶシートを足して5つ（地点・お気に入り・記録・認証・地図）。
// 2026-09-28: 写真から記録するシートを足して6つ。
// 「ねらう」「空の見え方」「月丼」はポップアップではなく**ページ**にした
ok((html.match(/<dialog class="sheet"/g) || []).length === 6, "シートは6つ",
  String((html.match(/<dialog class="sheet"/g) || []).length));

console.log("== 登録した直後に、パスキーの登録へ進める ==");
// 2026-09-08 ユーザー「案内じゃなくてパスキーの登録を促したらどう？」。
// 「登録しておくと便利です」と書くだけでは、たいてい誰もやらない。
ok(!/登録したら、この端末にパスキーを登録しておくと/.test(html), "案内文だけの形をやめた");
ok(/id="panelPasskey"/.test(html), "登録のあとに出す画面がある");
ok(/id="signupPasskey"/.test(html) && /id="skipPasskey"/.test(html), "登録と見送りの両方がある");
// どちらも選べることが見えるように、両方ボタンで出す
ok(/id="signupPasskey" class="fav-btn primary"/.test(html), "登録は主ボタン");
ok(/id="skipPasskey" class="fav-btn"/.test(html), "見送りもボタン（小さなリンクにしない）");
ok(/showAuthPanel\("passkey"\)/.test(html), "登録できたらその画面へ移る");
ok(/keepOpen: !!window\.PublicKeyCredential/.test(html),
  "パスキー非対応の端末では、出さずに閉じる");

// **パスワードには触らない**（2026-09-08 ユーザー指定）。鍵が増えるだけで入り方は減らさない
{
  const panel = html.slice(html.indexOf('id="panelPasskey"'), html.indexOf('id="panelPasskey"') + 900);
  ok(!/disable/.test(panel), "画面にパスワード無効化の口が無い");
  // 「無効にはしません」の一文は消した（2026-09-08 ユーザー判断）。
  // **書かなくなったぶん、動きの側で守る。** 下の2件がその担保。
  ok(!/無効にはしません/.test(html), "打ち消しの一文を残していない");
}
{
  const fn = html.slice(html.indexOf('$("signupPasskey").onclick'), html.indexOf('$("skipPasskey").onclick'));
  ok(!/password\/disable/.test(fn), "登録の処理がパスワードを無効化しない");
  ok(/registerPasskey\("この端末"\)/.test(fn), "共通の登録処理を使う");
}
// 登録の中身は1か所。アカウント画面と新規登録で別々に書くとずれる
ok(/async function registerPasskey\(label\)/.test(html), "登録の処理が共通化されている");
ok((html.match(/registerPasskey\(/g) || []).length === 3, "定義1・利用2",
  String((html.match(/registerPasskey\(/g) || []).length));

console.log("== パスワードの規則が、サーバーと同じに動く ==");
// 2026-09-08 ユーザー判断で、構成の強制と弱いパターンの排除を両方入れた。
// **判定の正本はサーバー**（api/src/auth.js の checkPassword）。画面側の
// 同じ規則は往復させる前に理由を言うためだけにある。
// **ここが本体で、二重に書いていることが危ない。** 表を両方の検査に置いて、
// どちらかがずれたら片方が落ちるようにしてある。
{
  // 目印に値を含めない。数字を変えた瞬間に抽出が壊れて、何も検査しなくなる
  const start = html.indexOf("const PW_MIN =");
  ok(start > 0, "パスワードの規則を取り出せる");
  const src = html.slice(start);
  // 終わりは「最初に現れる `$(...)` の行」。特定のハンドラ名で切ると、
  // その手前に別のハンドラを足した瞬間に巻き込んで壊れる（実際に壊した）
  const end = src.indexOf("\n$(\"");
  ok(end > 0, "規則の終わりを見つけられる");
  const block = src.slice(0, end);
  const checkPw = new Function(`${block}; return checkPw;`)();

  const good = (p, id = "someone") =>
    ok(checkPw(p, id) === null, `通る: ${p}`, checkPw(p, id) ?? "");
  const bad = (p, part, id = "someone") => {
    const m = checkPw(p, id);
    ok(m !== null && m.includes(part), `弾く: ${p}`, m ?? "通ってしまった");
  };

  good("Tsukiyo-no-Kumo-Sagashi7");
  good("Correct-Horse-Battery-Staple1");
  good("Tsukiyo-135-Ab!");
  good("Abc-Tsukiyo-Kumo9!", "ab");            // 3文字未満のIDは見ない

  bad("Password1!", "password");        // 8文字許可でも、よくある言葉で弾く
  bad("tsukiyo-no-kumo-sagashi7", "大文字");
  bad("TSUKIYO-NO-KUMO-SAGASHI7", "小文字");
  bad("TsukiyoNoKumoSagashi7", "記号");
  bad("", "8文字以上");
  bad(null, "入れてください");
  bad("Okayu0321-Strong!", "IDと同じ", "okayu0321");
  bad("xxOKAYU0321xx-Aa!", "IDと同じ", "okayu0321");
  bad("Zekkei-Yosoku-2026!", "zekkei");
  bad("MyPassword-2026!", "password");
  // 画面で「半角英数と記号」と言い切っているので、全角や絵文字は通してはいけない
  bad("Ab1!空を見た", "半角");
  bad("Ab1!\u{1F305}abc", "半角");
  bad("Ａｂ１！ｃｄｅｆ", "半角");
  bad("ｏｋａｙｕ", "半角");          // 全角なら、長さより先に半角を言う
  // 上限の境目。IDは32で止めているので、こちらも止める
  const pw128 = "Ab1!" + "xyz".repeat(41) + "x";      // ちょうど128
  ok(pw128.length === 128, "検査用の値が128文字", String(pw128.length));
  ok(checkPw(pw128) === null, "128文字ちょうどは通る", checkPw(pw128) ?? "");
  bad(pw128 + "y", "128文字まで");                     // 129で弾く
  // 入力欄そのものにも上限を置く。**規則だけだと、打ち込めてから弾かれる**
  ok((html.match(/type="password"[^>]*maxlength="128"/g) || []).length === 3,
    "パスワードの入力欄3つに上限がある",
    String((html.match(/type="password"[^>]*maxlength="128"/g) || []).length));

  // 使える記号は決め打ち（2026-09-08 ユーザー判断）。**画面の一覧と規則を一致させる。**
  // 一覧に載っているのに弾かれる、載っていないのに通る、のどちらも困る。
  // PWの一覧だけを拾う（IDの一覧は3文字なので長さで分ける）
  const shown = (html.match(/使える記号は <b>([! #$%&*+\-.=?@_a-z;]{20,})<\/b>/) || [])[1] ?? "";
  const symbols = shown.replace(/&amp;/g, "&").split(" ").filter(Boolean);
  ok(symbols.length === 13, "記号が13種ある", String(symbols.length));
  for (const c of symbols) ok(checkPw(`Ab1${c}cdxy`) === null, `一覧の記号 ${c} は実際に使える`);
  for (const c of ['"', "'", "\\", "<", ">", "(", ")", "|", ";", " ", "`", "/", ":", "^", "~"]) {
    ok(checkPw(`Ab1${c}cdxy`) !== null, `一覧に無い ${JSON.stringify(c)} は使えない`);
  }

  bad("Aaaa-bbbb-Cccc!", "同じ文字を4つ");
  bad("Abcd-Tsukiyo-9!", "連番や並び順");
  bad("Tsukiyo-9876-Ab!", "連番や並び順");
}

// 送る前に見る。往復してから「使えません」と言われるのは遅い
ok(/const weak = checkPw\(pw, \$\("newId"\)\.value\)/.test(html), "登録は送る前に見る");
ok(/if \(!ID_RE\.test\(\$\("newId"\)\.value\.trim\(\)\.toLowerCase\(\)\)\)/.test(html),
  "IDの形も送る前に見る");
// 画面とサーバーで規則がずれたら、片方だけ通って往復してから弾かれる
ok(/const ID_RE = \/\^\[a-z0-9\]\[a-z0-9\._-\]\{5,31\}\$\//.test(html),
  "IDの規則がサーバーと同じ形（6〜32文字）");
ok(/const weakAcc = checkPw\(\$\("newAccPw"\)\.value/.test(html), "パスワードの設定も送る前に見る");
ok(!/pw\.length < 10/.test(html), "古い10文字の判定が残っていない");

// 画面にも規則を出す。弾かれてから理由を探させない
ok(/半角英数と記号で8〜128桁。<span class="nb">使える記号は <b>! # \$ % &amp; \* \+ - \. = \? @ _<\/b><\/span>/.test(html),
  "使える文字と長さを書く");
ok(/大文字・小文字・記号を1つずつ以上/.test(html), "要る文字種を書く");
ok(/IDと同じ文字・よくある言葉・連番は使えません/.test(html), "弾かれる形も書く");
// 例は出さない（2026-09-08 ユーザー判断）。出すと、そのまま使う人が出る
ok(!/例: <b>/.test(html), "パスワードの例を画面に出していない");
ok(!/10文字以上/.test(html) && !/12文字以上/.test(html) && !/8文字以上/.test(html),
  "古い長さの案内が残っていない");

console.log("== IDの規則を、実際の規則どおりに書く ==");
// 2026-09-08 ユーザー指摘「この文言だと記号がわからないね」。
// 「英数字3〜32文字」とだけ書いていたが、実際は . _ - も使え、大文字は
// 小文字になり、1文字目は英字か数字に限られる。**弾かれてから理由を探すことになる。**
// サーバー側の規則は /^[a-z0-9][a-z0-9._-]{2,31}$/。ここが食い違ったら直す。
ok(!/英数字3〜32文字/.test(html), "古い不正確な言い方が残っていない");
for (const [needle, why] of [
  ["6〜32桁", "長さを書く"],
  ["1文字目は英字か数字", "先頭の制限を書く"],
  ["大文字で入れても小文字になります", "正規化されることを書く"],
]) ok(html.includes(needle), why);
// 使える記号を1つずつ挙げる。「記号」とまとめると、どれが使えるか分からない
const signupPanel = html.slice(html.indexOf('id="panelSignup"'), html.indexOf('id="panelRecovery"'));
for (const c of [".", "_", "-"]) {
  ok(signupPanel.includes(`<b>${c}</b>`), `使える記号 ${c} を1つずつ挙げている`);
}
// 使えないものを挙げていないか。書いてあるのに弾かれるのが一番困る
for (const c of ["@", "+", "!", "#"]) {
  ok(!signupPanel.includes(`<b>${c}</b>`), `使えない記号 ${c} を挙げていない`);
}
// 変えられないことは、決める前に言わないと意味が無い
ok(/<strong class="nb">あとから変えられません。<\/strong>/.test(html), "IDを後から変えられないと書く");

// 同じ規則が要る場所は2つ。管理者が許可リストへ入れるIDも同じ規則で弾かれる
ok((html.match(/半角英数と記号で6〜32桁。/g) || []).length === 2,
  "IDの規則を、新規登録と管理画面の許可リストの両方に書く",
  String((html.match(/半角英数と記号で6〜32桁。/g) || []).length));
ok((html.match(/半角英数と記号で8〜128桁。/g) || []).length === 2,
  "パスワードの規則を、新規登録とアカウント画面の両方に書く",
  String((html.match(/半角英数と記号で8〜128桁。/g) || []).length));

console.log("== 管理画面に、ほかの画面のものを出さない ==");
// 2026-09-08 ユーザー指摘「管理画面に実際はどうでしたか？がある」。
// recPending は listView の**外**にある独立したカードなので、listView を
// 隠しても消えない。切り替えの条件に inAdmin を書き忘れていた。
// 2026-10-01: 隠す画面を並べて書いていたため、あとから足した道具の画面の下にも出ていた。一覧のときだけ出す
ok(/renderRecords\(now, view !== "list"\)/.test(html),
  "記録の問いかけは一覧のときだけ（管理・記録・道具の画面には出さない）");
// main 直下の画面は VIEWS の表で切り替える。画面ごとの条件は書かない
for (const el of ["listView", "detailView", "recordsView", "adminView", "aimView", "skyView", "planeView"]) {
  ok(new RegExp(`el: "${el}"`).test(html), `${el} が画面の表にある`);
}
// 画面ではないもの（地点カード・実況）は、これまでどおり個別に切り替える
for (const id of ["placeRow", "nowcast"]) {
  ok(html.includes(`$("${id}").hidden`), `${id} の表示を切り替えている`);
}
ok(/\$\("recPending"\)\.hidden/.test(html), "recPending の表示を切り替えている");
// 管理画面で隠すもの: 地点・実況・記録の問いかけ
ok(!["admin", "records"].some((v) => ["list", "detail", "sky"].includes(v)), "地点を管理画面で隠す");
// 実況は一覧と詳細だけ（道具・記録・管理では出さない）
ok(/\$\("nowcast"\)\.hidden = !\["list", "detail"\]\.includes\(view\)/.test(html), "実況を管理画面で隠す");

console.log("== ログインの保持 ==");
// 2026-09-08 ユーザー「更新するたびにログインはだるいよねって」。
// それまでトークンはメモリのみで、**読み込み直すたびに消えていた。**
// 自動更新の読み直しを入れたことで、配信のたびに再ログインが要る状態になっていた。
ok(/sessionStorage\.setItem\(TOKEN_KEY/.test(html), "読み込み直しで消えないよう sessionStorage へ置く");
ok(/localStorage\.setItem\(TOKEN_KEY/.test(html), "「保持する」を選んだら localStorage へ置く");
ok(/localStorage\.removeItem\(TOKEN_KEY/.test(html), "選んでいなければ localStorage から消す");
ok(/function clearAuth[\s\S]{0,220}sessionStorage\.removeItem[\s\S]{0,120}localStorage\.removeItem/.test(html),
  "ログアウトでは両方から消す");
// 片方だけ消すと、閉じて開き直したときに死んだトークンで入り直そうとする
ok(/if \(res\.status === 401 && auth\) \{ clearAuth\(\)/.test(html), "401 を受けたらトークンを捨てる");

ok(/<input type="checkbox" id="rememberMe"/.test(html), "保持するかを選べる");
// **既定は外す**（2026-09-08 ユーザー判断）。30日残る鍵を、頼まれずに置かない。
ok(!/id="rememberMe" checked/.test(html), "既定では保持しない");
ok(/store\.get\("sorami\.remember", false\)/.test(html), "覚えていないときも保持しない");
// 外していても読み込み直しでは切れない。**元の困りごとはこちらで解決している**
ok(/sessionStorage\.setItem\(TOKEN_KEY/.test(html), "外していても読み込み直しでは保つ");
ok(/共用の端末では外してください/.test(html), "外すべき場面を書く");
// チェックボックスは3画面共通。パネルの中に置くと3つ同時に存在する
ok(html.indexOf('id="rememberMe"') > html.indexOf('id="panelRecovery"'),
  "チェックボックスはパネルの外（ログイン・新規登録・回復のどれからでも効く）");
ok((html.match(/id="rememberMe"/g) || []).length === 1, "チェックボックスは1つだけ");

// サーバーへ伝えないと、選んでも12時間のトークンしか出ない
ok((html.match(/remember: wantsRemember\(\)/g) || []).length === 4,
  "ログインの4経路すべてでサーバーへ伝える",
  String((html.match(/remember: wantsRemember\(\)/g) || []).length));

ok(/restoreSession\(\)/.test(html), "開いたときに入り直す");
ok(/async function restoreSession[\s\S]{0,400}apiCall\("GET", "\/me"\)/.test(html),
  "通るかどうかはサーバーに訊く（手元で期限を判断しない）");
ok(/session\/refresh/.test(html), "折り返しを過ぎたら出し直す（30日目に必ず切れるのを防ぐ）");

console.log("== 取り消せること ==");
// トークンは署名だけで検証でき、サーバーに残らない。**進める以外に切る手が無い。**
ok(/id="logoutAll"/.test(html), "すべての端末からログアウトできる");
ok(/me\/logout-all/.test(html), "取り消しの経路を叩く");
ok(/この端末は入ったまま/.test(html), "押した人が締め出されないと書いてある");
// 認証手段を変える操作は新しいトークンを返す。受け取らないと自分が締め出される
ok(/adoptToken\(await apiCall\("POST", "\/passkey\/delete"/.test(html), "パスキー削除で新しいトークンを受け取る");
ok(/adoptToken\(await apiCall\("POST", "\/password\/enable"/.test(html), "パスワード有効化で受け取る");
ok(/const r = await apiCall\("POST", "\/password\/disable", \{\}\); adoptToken\(r\)/.test(html),
  "パスワード無効化で受け取る");

console.log("== 横スクロールの跳ね返りを止めてある ==");
// 2026-09-07: 14日マトリクスの左端で、貼り付けた現象名の列だけが右へ最大27px
// ずれて戻る現象。原因はゴムバンド（オーバースクロール）で、跳ね返っている間
// scrollLeft は 0 のままなので **JSでスクロール量を見ても検出できない**。
// `contain` は親への伝播を止めるだけで跳ね返り自体は残る。**`none` が要る。**
ok(/\.mxscroll\s*\{[^}]*overscroll-behavior-x:\s*none/.test(html),
  ".mxscroll は overscroll-behavior-x: none");
ok(!/\.mxscroll\s*\{[^}]*overscroll-behavior-x:\s*contain/.test(html),
  "contain へ戻していない");
ok(!/\.mxscroll\s*\{[^}]*will-change/.test(html),
  "誤った見立てで入れた will-change を復活させていない");

console.log("== 更新の自動確認が、読み直しの繰り返しにならない ==");
// 2026-09-08 ユーザー指摘「配信されてないよ」。GitHub Pages は HTML に
// max-age=600 を付けるので、push が通ってもブラウザは最大10分は古いHTMLを使う。
// checkForUpdate はそれを迂回して読み直させる仕掛け。
//
// 読み直し済みの印を「走っている版」で持っていたのが誤りだった。印が効くのは
// 読み直しが成功して新しい版に入れ替わったときだけで、**この仕掛けが要る状況
// （読み直してもまだ古いHTMLが返る）ではガードが一度も一致しない。**
// 読み込みのたびに読み直しを繰り返すことになる。印は「読み直した先の版」で持つ。
//
// 文字列一致では順序の誤りを捕まえられないので、実際に動かして確かめる。
{
  const src = html.slice(html.indexOf("async function checkForUpdate()"));
  let depth = 0, end = 0;
  for (let i = src.indexOf("{"); i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) { end = i + 1; break; }
  }
  const body = src.slice(0, end);

  // 配信された版を served、走っている版を running として動かし、読み直したか見る
  const run = async (running, served, store) => {
    let reloaded = 0;
    const sandbox = {
      document: { querySelector: () => ({ src: `sorami-core.js?v=${running}` }) },
      fetch: async () => ({ text: async () => `<script src="sorami-core.js?v=${served}">` }),
      sessionStorage: {
        getItem: (k) => (k in store ? store[k] : null),
        setItem: (k, v) => { store[k] = String(v); },
      },
      location: { pathname: "/", reload: () => { reloaded++; } },
    };
    const fn = new Function("document", "fetch", "sessionStorage", "location",
      `${body}; return checkForUpdate();`);
    await fn(sandbox.document, sandbox.fetch, sandbox.sessionStorage, sandbox.location);
    return reloaded;
  };

  const store = {};
  ok(await run("100", "100", store) === 0, "同じ版なら読み直さない");
  ok(await run("100", "200", store) === 1, "新しい版が出ていたら読み直す");
  ok(store["sorami.reloaded"] === "200", "印は読み直した先の版で持つ");
  // 読み直した直後。ブラウザがまだ古いHTMLを返してくることがある
  ok(await run("100", "200", store) === 0, "同じ版へ二度は読み直さない（無限ループを作らない）");
  // ここが壊れていた。同じセッション中に次の配信があったとき
  ok(await run("100", "300", store) === 1, "同じセッション中の2回目の配信も拾う");
  ok(await run("100", "", {}) === 0, "版が読めなければ何もしない");

  let threw = false;
  try {
    const fn = new Function("document", "fetch", "sessionStorage", "location",
      `${body}; return checkForUpdate();`);
    await fn({ querySelector: () => ({ src: "sorami-core.js?v=1" }) },
      async () => { throw new Error("網が無い"); },
      { getItem: () => null, setItem: () => {} }, { pathname: "/", reload: () => {} });
  } catch { threw = true; }
  ok(!threw, "取りに行けなくても落ちない");
}

console.log("== 月の代表地点・キャッシュ・保存経路 ==");
{
  const T = req("./sorami-terrain.js");
  const body = html.match(/async function loadUrbanHorizon\(obs\) \{([\s\S]*?)\n\}/)[1];
  let reads = 0;
  const load = new Function("SoramiTerrain", "store", "URBAN_CACHE_KEY", "URBAN_CACHE_VERSION", "URBAN_MAX_AGE_MS",
    `return async function(obs){${body}}`)(T, {get(){reads++;throw Error("must not read")}}, "test", 2, 1);
  ok(await load({locationScope:"area"}) === null && reads === 0, "代表地点では旧建物キャッシュも読み込まない");
  ok(html.includes('if (!moonUrbanTried && obs.locationScope !== "area")'), "代表地点は非同期の建物読込も開始しない");
  ok(html.includes('${SoramiTerrain.urbanCacheKey(obs)}:${obs.locationScope}'), "同じ座標でも地点種別の変更で遮蔽をリセット");
  // 2026-09-24: 地図の中でも検索できる（だいたいの場所へ飛んでからピンを寄せる）。
  // **地点シートと同じ検索**を使う。別々に書くと片方だけ直す事故になる
  ok(/wireSearchBox\("searchBox", "searchResults"/.test(html)
    && /wireSearchBox\("mapSearch", "mapSearchResults"/.test(html), "地点シートと地図で同じ検索を使う");
  ok(/MapPick\.setView\(r\.latitude, r\.longitude/.test(html), "地図の検索は地点を決めず、地図を動かすだけ");
  // iOS のキーボードの「検索」では keydown の Enter が届かないことがある（2026-09-24 ユーザー報告）
  ok(/addEventListener\("search", run\)/.test(html) && /addEventListener\("keydown", \(e\) => \{ if \(e\.key === "Enter" && !e\.isComposing\) run\(\); \}\)/.test(html),
    "確定は Enter と search の両方で拾う（変換を確定する Enter は除く）");
  // 2026-09-24: 検索は国土地理院とOSMの2本立てになった。種別はそれぞれの判定を通して持つ
  ok(html.includes("scope: SoramiTerrain.searchLocationScope(r)")
    && html.includes("scope: SoramiTerrain.gsiLocationScope(f.properties?.title)")
    && html.includes("locationScope: r.scope"), "検索元の種別を保存");
  ok(html.includes('locationScope: SoramiTerrain.locationScope(f)'), "既存のお気に入りは改名前に種別を確定");
  ok(html.includes('locationScope: favDraft.locationScope'), "お気に入り再保存で種別を落とさない");
  ok(html.includes('locationScope: entry.locationScope, eyeHeightAGL: entry.eyeHeightAGL'), "表示地点へ高さと種別を反映");
  ok(html.includes('地域の代表地点のため、近くの建物は含めていません。'), "地域の詳細で建物を含まない前提を示す");
}

console.log("== 写真から記録する ==");
// **原寸は送らない。** 端末で小さくした写しと、EXIF の「いつ・どこ」だけ
ok(/id="photoSheet"/.test(html), "写真のシートがある");
ok(/async function makeThumb\(file, max = 768/.test(html), "長辺768pxに縮めてから送る");
ok(/c\.toDataURL\("image\/jpeg", quality\)/.test(html), "JPEGにして送る");
ok(/SoramiExif\.readFile\(file\)/.test(html), "EXIFを読む");
// **写真から読めたものは初期値。入力欄が正本**なので、手で直したらそちらを使う
ok(/id="photoWhen"/.test(html) && /id="photoWhere"/.test(html), "日時と場所は手で入れられる");
ok(/takenAt: photoWhenMs\(\)/.test(html), "入力欄の日時を送る");
ok(/latitude: where \? where\.latitude : null/.test(html), "入力欄の座標を送る");
ok(/SoramiTerrain\.parseLatLon\(v\) \|\| SoramiTerrain\.parseMapLink\(v\)/.test(html),
  "緯度経度でも地図のURLでも受ける");
ok(/\$\("photoWhen"\)\.value = iso\(at \?\? Date\.now\(\)\)/.test(html),
  "写真から読めたら先に入れる（無ければ「いま」）");
// **過去に遡って入れられる。** 写真は任意で、日時は手で直せる
ok(/id="photoChoose"/.test(html), "写真はシートの中で選ぶ（任意）");
ok(/\$\("photoPick"\)\.onclick = \(\) => openPhotoSheet\(null\)/.test(html),
  "写真なしでも記録を作れる");
ok(/記録を足す/.test(html), "入口の名前は「記録を足す」");
ok(/altitude: r && Number\.isFinite\(r\.altitudeM\)/.test(html), "標高を送る");
ok(/100点満点で何点でしたか/.test(html), "点数を聞く");
ok(/何の写真ですか/.test(html), "現象を聞く");
ok(/if \(!requireLogin\("記録"\)\) return;/.test(html), "ログインして使う");
// 写真の現象は、一覧と同じ並びで出す（迷わせない）
ok(/\.sort\(\(a, b\) => \(a\[1\]\.order \?\? 99\) - \(b\[1\]\.order \?\? 99\)\)/.test(html),
  "現象は一覧と同じ並び");

console.log("== ねらうは中身で分ける ==");
// **見出しはいま選んでいるものから決める。** 目標や天体を変えたら見出しも変わる
ok(/const AIM_PRESETS = \{/.test(html), "メニューから来たときの初期値を持つ");
ok(/tower: \{ target: "skytree", body: "sun" \}/.test(html), "塔に重ねるはメニューから開くと太陽（前の画面の月を持ち越さない）");
ok(/fuji: \{ target: "fuji", body: "sun" \}/.test(html), "富士山に重ねるは太陽で開く");
ok(/diamond: \{ target: "fuji", body: "sun", as: "fuji" \}/.test(html) && /pearl: \{ target: "fuji", body: "moon", as: "fuji" \}/.test(html),
  "前の URL（#/aim/diamond・#/aim/pearl）も富士山に重ねるを太陽・月で開く");
ok(/function aimTitleFor/.test(html), "見出しを選択から決める");
ok(/\^#\\\/aim\\\/\(fuji\|diamond\|pearl\|tower\)\$/.test(html), "#/aim/<なに> の道がある（前の URL も）");
ok(/\$\("aimTitleText"\)\.textContent = aimTitleFor\(\)\.title;/.test(html) && /\$\("aimTargetLabel"\)\.textContent = aim\.target\.name/.test(html),
  "見出しを差し替える（富士山は題名、塔は目標の名前）");
// 画面は1つのまま（中身が同じなので、押した場所で初期値だけ変える）
ok((html.match(/id="aimView"/g) || []).length === 1, "画面は1つのまま");

console.log(`\n${fail === 0 ? "LAYOUT OK" : "FAILED"} — ${pass} 件成功 / ${fail} 件失敗`);
process.exit(fail === 0 ? 0 : 1);
