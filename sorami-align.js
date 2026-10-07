/*
 * Sorami — ダイヤモンド／パールの「どこから見えるか」
 *
 * 富士山の詳細に出している `SoramiFuji.alignments()` は「この地点でいつか」。
 * こちらは逆で、**日付を決めて、その日に重なる観測点の並び（線）**を出す。
 *
 * 考え方は1つだけ。
 *   目標までの距離が決まれば、目標の先端を見上げる角度が決まる。
 *   その高度を天体が通る時刻が決まり、そのときの天体の方位が決まる。
 *   観測者は、目標から見てその方位の**反対側**にいる。
 * 距離を変えながらこれを解くと、観測点が並んで線になる。
 *
 * 観測者の標高で見上げ角が変わるので、標高タイルを読んで解き直す（2回）。
 * 天体の位置は観測者の場所でわずかに変わるので、そこも解き直す。
 *
 * 答え合わせ: 2026-12-22 の富士山の線は**高尾山から 0.2km**（16:09）を通る。
 * 高尾山の冬至のダイヤモンド富士と一致する。
 */
(function (global) {
  "use strict";

  const A = global.SoramiAstro || (typeof require !== "undefined" ? require("./sorami-astro.js") : null);
  const TM = global.SoramiTowerModels || (typeof require !== "undefined" ? require("./sorami-tower-models.js") : null);
  const TR = global.SoramiTerrain || (typeof require !== "undefined" ? require("./sorami-terrain.js") : null);
  if (!A || !TR) throw new Error("astro / terrain が先に要ります");

  /**
   * 目標。parts の `m` は**海面からの高さ**（先端の標高）で、計算はこれを使う。
   * 塔は「地上◯m」で語られるので、`groundM`（地面の標高）を持ち、**画面には地上の高さ（m − groundM）を出す**
   * （2026-10-01 ユーザー「スカイツリーの先端が634mだと思うんだけど636になってるのはなんで」。海面からの値をそのまま出していた）。
   */
  const TARGETS = [
    { id: "fuji", name: "富士山", latitude: 35.360555, longitude: 138.727363,
      note: "山頂（剣ヶ峰）3776m",
      parts: [{ id: "summit", name: "山頂", m: 3776 }],
      // **山頂は点ではなく、火口の縁という輪（直径およそ800m）。** 剣ヶ峰だけを的にすると、
      // 高尾山の冬至（よく知られたダイヤモンド富士）が「縁がかすめる」になって一覧から落ちていた（2026-09-30）。
      // 縁の高さは 3725〜3774m と場所で違うので、平らな板とも見なせない（近い竜ヶ岳で47日続く判定になった）。
      // 縁の形そのもの（下の FUJI_RIM）を持ち、天体の中心が**縁の稜線に届く位置が縁の範囲の中か**で決める
      rim: { latitude: 35.36295, longitude: 138.73003 } },
    { id: "skytree", name: "東京スカイツリー", latitude: 35.710063, longitude: 139.810700,
      note: "地上の高さ ＋ 地面の標高およそ2m", groundM: 2,
      parts: [{ id: "tip", name: "先端", m: 636 },
              { id: "gallery", name: "天望回廊（第二展望台）", m: 452 },
              { id: "deck", name: "天望デッキ", m: 352 }] },
    // 公式施設案内の地上150m/250m。海面からの値は地面18mを加算する。
    { id: "tokyotower", name: "東京タワー", latitude: 35.658581, longitude: 139.745433,
      note: "地上の高さ ＋ 地面の標高およそ18m", groundM: 18,
      parts: [{ id: "tip", name: "先端", m: 351 },
              { id: "top", name: "トップデッキ", m: 268 },
              { id: "main", name: "メインデッキ", m: 168 }] },
    // 出典：PLATEAU新宿区2025。LOD2を抽出・局所座標へ加工。本体頂部と屋上付属物を区別。
    {"id":"tocho-building","name":"東京都庁 第一本庁舎","latitude":35.6895,"longitude":139.691694,"groundM":34.63,"note":"PLATEAU LOD2。屋上付属物を含む形状。本体頂部は地上243.05m","parts":[{"id":"north","name":"北塔の頂部","m":277.68,"latitude":35.68978611899479,"longitude":139.69164621437966},{"id":"south","name":"南塔の頂部","m":277.68,"latitude":35.68921795263166,"longitude":139.6917781156376}]},
    // 位置は OpenStreetMap の建物の中心（35.6320784, 139.8808364）とユーザーの座標が3mで合う所。
    // 2026-10-02 まで 95m 北西（35.632896, 139.880394）に置いていて、3km 先からの方角が 1° 以上（月2つ分）ずれていた
    { id: "cinderella", name: "シンデレラ城", latitude: 35.632104, longitude: 139.880834,
      note: "高さ51m ＋ 地面の標高およそ3m", groundM: 3,
      parts: [{ id: "tip", name: "てっぺん", m: 54 }] },
    // 東京ディズニーランドホテルの屋根のドームに立つティンカーベルの像。いちばん上は掲げた杖の先。
    // **公表された高さが無い**。2026-10-02 ユーザーの写真（2024-11-30 05:54:55、葛西臨海公園 692.9m 先から、月の上に杖が重なる）で測った:
    // 写真の月の中心と杖の先のずれ（月の直径が物差し）と、その時刻の月の高度 4.30° から、杖の先は見上げ 4.23°＝目より 51.3m 上、
    // 目は地面 2.8m（国土地理院 1m DEM）＋1.5m で、**海抜およそ56m**（時計か撮影地が1〜2mずれていれば 55.5〜57m）。
    // それまでは OpenStreetMap の建物高さ60m を地上として 63m にしていた（7m 高く、月1つ分より上にずれていた）。画面で直せる
    { id: "tinkerbell", name: "ティンカーベル", wholeLabel: "像全体に重なる", latitude: 35.637031, longitude: 139.878077,
      note: "東京ディズニーランドホテルの屋根に立つ像の杖の先。高さは写真から測った値（±1m）なので、合わせながら直せます", groundM: 3,
      parts: [{ id: "tip", name: "杖の先", m: 56, adjustable: true }] },
  ];
  const targetById = (id) => TARGETS.find((t) => t.id === id) || null;

  /**
   * 富士山の火口の縁（build-fuji-rim.mjs が作る）。国土地理院 DEM5A の 3690m 以上を 20m 格子に間引いたもの。
   * 火口の中心（35.36295, 138.73003）からの 東[m], 北[m], 標高−3600[m] を並べてある。
   */
  const FUJI_RIM = "-53,532,97,-45,532,98,-29,532,95,-72,512,98,-53,512,106,-45,512,108,-29,512,104,-10,512,94,-72,493,98,-53,493,110,-41,493,117,-29,493,112,-10,493,102,14,493,90,-92,474,100,-72,474,108,-53,474,119,-37,474,126,-29,474,123,-10,474,112,14,474,100,-111,474,91,33,474,91,-111,450,100,-92,450,111,-72,450,122,-53,450,130,-37,450,138,-29,450,135,-10,450,131,14,450,112,33,450,103,53,450,97,-142,450,94,-131,431,103,-111,431,109,-92,431,120,-72,431,131,-53,431,140,-33,431,149,-29,431,148,-10,431,142,14,431,130,33,431,117,53,431,105,-154,412,97,-131,412,108,-111,412,118,-92,412,133,-72,412,142,-53,412,153,-41,412,155,-29,416,152,-10,416,146,14,412,137,33,419,127,53,412,108,72,412,98,-193,412,99,-189,412,97,92,412,92,-212,392,103,-197,392,109,-173,392,108,-154,392,109,-131,392,117,-111,392,126,-92,392,143,-72,392,152,-53,400,155,-45,408,156,-29,408,151,-10,408,146,14,408,137,33,392,128,53,392,118,72,392,108,107,392,103,127,392,109,138,392,110,169,392,111,173,392,111,193,392,102,-232,373,95,-212,373,107,-201,373,113,-173,373,117,-162,377,124,-131,373,127,-111,373,140,-92,381,146,-72,388,152,-64,388,153,-49,388,152,-29,388,148,-10,388,142,14,388,135,33,388,128,53,381,119,72,377,113,107,377,109,127,377,114,150,373,117,169,373,118,173,373,118,193,373,117,212,373,112,232,373,100,-232,354,103,-212,354,112,-201,354,116,-173,361,117,-154,365,125,-131,369,128,-115,369,142,-92,369,140,-72,369,145,-56,369,145,-49,369,145,-29,369,141,-10,369,135,14,369,128,33,369,122,53,369,117,72,369,111,107,369,108,127,369,113,150,358,118,169,354,121,177,354,121,193,354,121,212,354,119,232,354,115,-251,354,99,251,354,108,-271,354,93,271,354,92,-251,334,103,-232,330,115,-216,330,120,-208,334,119,-173,350,116,-169,350,117,-131,350,118,-115,350,123,-92,350,123,-72,350,134,-68,350,134,-49,350,133,-29,350,131,-10,350,125,14,350,117,33,350,110,53,350,105,72,350,101,107,350,101,127,350,107,150,350,118,169,330,122,189,330,124,197,330,124,212,330,124,232,330,121,251,330,115,271,330,107,290,330,96,-251,311,103,-232,311,119,-216,327,121,-208,327,118,-189,327,108,-166,327,107,-131,327,103,-127,327,103,-92,327,109,-72,327,113,-53,327,116,-41,327,117,-29,327,116,-10,327,111,14,327,102,33,327,97,53,327,94,72,327,90,107,327,92,127,327,100,150,327,113,169,327,122,189,319,125,197,319,125,212,315,125,232,315,123,251,311,117,271,311,111,290,311,99,-271,311,92,-271,292,95,-251,292,107,-232,307,119,-224,303,126,-208,307,115,-189,307,102,-169,307,93,-111,307,91,-92,307,98,-72,307,102,-56,307,105,-49,307,104,-29,307,100,-10,307,97,14,307,93,127,307,95,150,307,108,169,307,120,181,307,122,197,307,122,224,307,124,232,303,123,251,292,118,271,296,115,290,292,104,314,292,92,-271,272,99,-251,272,110,-232,272,121,-228,272,123,-208,272,115,-189,272,102,-72,288,95,-64,288,95,-49,288,94,-29,288,92,127,288,92,146,288,100,154,288,91,185,288,91,208,288,94,228,288,103,247,288,119,251,288,118,271,284,115,290,272,111,314,272,98,-169,276,91,-271,253,104,-251,253,115,-232,253,126,-228,253,127,-208,265,116,-189,269,102,-72,253,93,-60,253,94,-49,253,93,138,269,95,247,269,117,251,261,117,271,269,115,290,253,114,314,253,105,333,253,95,228,253,108,-290,253,92,-29,253,92,-10,253,91,-290,234,99,-271,234,111,-251,234,123,-236,234,131,-228,241,129,-208,234,118,-189,234,107,-72,234,97,-64,234,98,-49,234,96,-21,238,95,-10,234,95,228,249,107,247,249,114,259,249,116,271,249,115,290,234,114,314,234,110,333,234,102,-169,234,97,14,234,92,353,234,92,-150,234,91,-290,210,106,-271,210,117,-251,210,128,-236,230,131,-228,230,129,-208,230,118,-189,230,107,-169,222,100,-150,210,96,-72,230,97,-64,230,98,-49,230,96,-14,230,95,-10,230,95,14,230,92,228,230,102,247,230,108,267,230,113,286,230,114,290,230,114,314,210,113,333,210,107,353,210,101,-314,210,93,372,210,93,-127,210,90,-314,191,97,-290,191,110,-271,191,120,-251,207,128,-247,207,130,-228,207,120,-208,207,112,-189,207,103,-169,207,98,-150,207,95,-127,199,91,-72,207,91,-68,207,91,-49,207,90,228,207,94,247,195,106,267,191,110,286,191,114,310,191,117,314,191,117,333,191,117,353,191,107,372,191,100,392,191,94,-333,172,101,-314,172,104,-290,172,113,-271,172,124,-263,172,127,-247,187,123,-228,187,114,-208,187,104,-189,187,96,-169,187,91,-138,187,91,-127,187,90,247,187,104,267,172,113,286,172,117,310,172,121,318,172,122,337,172,122,353,172,120,372,172,109,392,172,99,-353,172,96,-353,152,107,-333,152,112,-314,152,114,-290,152,121,-271,152,128,-267,152,129,-247,168,118,-228,168,107,-208,168,97,-189,168,90,247,168,99,267,168,113,286,152,121,310,152,125,329,152,127,341,152,127,353,152,126,372,152,116,392,152,103,-372,152,98,-372,145,99,-353,141,114,-337,137,122,-314,133,126,-290,133,129,-279,133,133,-267,137,132,-247,133,116,-228,133,103,-208,149,93,267,145,108,286,149,120,310,145,126,329,137,130,341,133,132,353,133,132,372,133,120,392,133,105,411,133,92,-372,129,99,-353,129,110,-333,129,120,-314,125,130,-290,114,138,-282,114,140,-267,114,139,-247,114,122,-228,114,115,-208,114,92,267,129,106,271,129,106,310,129,113,329,129,124,349,125,133,353,125,133,372,114,123,392,114,108,411,114,95,-353,110,98,-333,110,111,-314,110,125,-290,110,139,-282,106,142,-267,110,138,-247,102,127,-228,90,119,-208,90,108,310,110,104,329,110,116,349,110,127,356,110,128,372,90,126,392,90,113,411,90,101,-189,90,98,-169,90,90,431,90,90,-353,83,92,-333,87,105,-314,87,117,-290,87,131,-275,87,140,-267,87,137,-247,75,127,-228,71,120,-208,71,112,-189,71,105,-169,71,97,310,87,97,329,87,108,349,87,119,368,83,127,372,75,128,392,71,118,411,71,106,431,71,96,-150,71,90,-333,67,99,-314,67,111,-290,67,126,-279,67,137,-267,67,134,-247,52,127,-228,52,121,-208,52,114,-189,52,110,-169,67,97,310,67,91,329,67,103,349,67,115,368,52,127,380,52,129,392,52,124,411,52,113,431,52,102,454,52,90,-333,48,94,-314,48,108,-290,40,126,-279,48,136,-267,32,133,-247,36,127,-228,32,122,-208,32,117,-189,32,112,-169,32,98,329,32,100,349,32,113,368,32,127,380,32,132,392,32,129,411,32,119,431,32,108,454,36,94,-333,29,91,-314,29,106,-290,29,126,-279,13,137,-267,13,135,-247,13,128,-228,13,123,-208,13,119,-189,29,112,-169,29,97,329,13,105,349,13,117,368,13,132,380,13,136,392,13,132,411,13,122,431,13,108,454,13,94,310,13,95,-333,-6,94,-314,-6,108,-290,-6,129,-275,-6,139,-267,-6,137,-247,-6,130,-228,-6,125,-208,-6,121,-189,-6,113,310,-6,108,329,-6,115,349,-6,125,368,-6,137,376,-6,140,392,-6,135,411,-6,124,431,-6,111,454,-6,98,286,-6,95,-333,-10,95,-314,-18,113,-290,-10,134,-279,-29,141,-267,-22,138,-247,-10,130,-228,-29,127,-208,-29,124,-189,-29,116,286,-10,100,310,-18,113,329,-29,133,349,-29,141,368,-18,147,372,-18,148,392,-22,136,411,-22,125,431,-29,113,454,-29,100,-333,-49,97,-314,-49,111,-290,-45,134,-282,-41,144,-267,-33,137,-247,-33,129,-228,-41,127,-208,-49,125,-189,-33,116,286,-33,96,310,-33,111,329,-33,132,349,-33,141,368,-33,145,376,-33,146,392,-33,135,411,-33,125,431,-33,113,454,-41,102,473,-49,95,-333,-64,99,-314,-64,113,-290,-68,135,-282,-53,143,-267,-53,135,-247,-53,127,-224,-53,127,-208,-64,126,-189,-53,91,286,-53,93,310,-53,108,329,-57,125,349,-53,138,368,-53,141,372,-53,141,392,-53,129,411,-53,120,431,-53,110,454,-53,99,473,-53,95,-333,-72,98,-314,-76,113,-290,-76,136,-286,-76,141,-267,-72,133,-247,-84,125,-212,-72,126,-208,-72,126,-189,-88,94,286,-84,91,310,-72,106,329,-72,116,349,-72,133,356,-72,136,372,-72,129,392,-72,123,411,-72,114,431,-72,103,454,-72,91,-333,-99,99,-314,-95,112,-290,-91,134,-282,-107,141,-267,-107,133,-247,-107,125,-212,-91,125,-208,-91,125,-189,-103,98,310,-91,97,329,-91,106,349,-91,118,364,-91,128,372,-91,123,392,-91,113,411,-91,104,431,-91,94,-333,-126,102,-314,-126,114,-290,-111,132,-282,-115,142,-267,-126,136,-247,-126,128,-212,-111,123,-208,-111,123,-189,-126,97,329,-111,100,349,-111,111,364,-111,122,372,-111,118,392,-111,106,411,-111,96,-333,-149,109,-314,-149,121,-290,-149,138,-282,-138,146,-267,-149,143,-247,-149,134,-228,-149,126,-208,-134,122,-189,-149,107,329,-130,93,349,-134,114,356,-130,116,372,-130,115,392,-130,101,-353,-149,97,-353,-169,105,-333,-169,120,-314,-169,135,-290,-169,153,-279,-169,159,-267,-169,149,-247,-169,138,-228,-169,130,-208,-169,124,-189,-169,114,345,-169,118,353,-169,117,372,-153,111,392,-153,97,329,-169,97,-372,-169,92,-372,-188,93,-353,-177,107,-333,-173,121,-314,-173,135,-290,-173,153,-279,-177,160,-267,-188,155,-247,-188,145,-228,-188,137,-208,-188,130,-189,-188,124,329,-188,124,333,-188,125,353,-188,122,372,-184,109,392,-173,95,-169,-188,93,310,-188,116,-372,-192,93,-353,-192,106,-333,-192,119,-314,-192,133,-290,-192,150,-271,-196,162,-263,-207,169,-247,-207,152,-228,-207,145,-208,-207,137,-189,-200,125,-169,-207,98,310,-207,129,329,-207,130,333,-207,130,353,-196,123,372,-207,110,392,-207,97,286,-207,94,-372,-211,91,-353,-211,103,-333,-211,116,-314,-211,130,-290,-211,146,-271,-227,163,-259,-223,170,-247,-227,162,-228,-227,153,-208,-227,144,-189,-227,132,-169,-227,116,286,-227,129,310,-223,132,318,-219,132,333,-215,130,353,-211,120,372,-211,111,392,-227,100,267,-227,119,-150,-227,99,247,-227,112,228,-227,105,-353,-231,102,-333,-246,115,-314,-246,130,-290,-246,147,-271,-231,164,-251,-235,171,-247,-242,174,-228,-246,160,-208,-246,152,-189,-246,140,-169,-246,122,-150,-242,104,228,-246,115,247,-246,124,267,-242,127,286,-231,129,306,-231,131,314,-231,131,333,-231,128,353,-231,119,372,-231,109,392,-231,100,-353,-269,105,-333,-269,119,-314,-269,133,-290,-262,149,-271,-250,162,-251,-266,171,-247,-250,174,-228,-269,167,-208,-269,156,-189,-269,143,-169,-254,126,-150,-269,108,216,-269,125,247,-262,125,267,-250,127,286,-250,127,302,-250,127,314,-250,127,333,-250,122,353,-250,113,372,-250,103,392,-250,93,189,-269,111,205,-269,125,-372,-269,92,-127,-269,94,162,-269,90,-372,-289,94,-353,-281,107,-333,-285,120,-314,-273,134,-290,-273,149,-271,-273,161,-251,-273,171,-247,-273,170,-228,-277,167,-208,-281,162,-189,-289,146,-169,-289,129,-150,-289,116,-127,-289,103,-107,-289,95,169,-289,100,189,-289,126,197,-281,127,212,-277,126,232,-277,125,251,-273,124,271,-273,124,290,-273,122,314,-273,121,333,-273,116,353,-273,107,372,-273,96,-53,-289,94,-45,-289,94,131,-289,94,-72,-289,92,-29,-289,92,127,-289,94,-372,-293,94,-353,-293,106,-333,-293,119,-314,-293,131,-290,-293,144,-271,-293,154,-251,-293,160,-247,-293,161,-224,-293,159,-201,-293,157,-189,-300,149,-169,-308,139,-150,-308,127,-127,-304,112,-107,-308,101,-72,-308,103,-53,-308,106,-37,-308,108,-29,-308,105,-10,-308,100,127,-308,113,131,-308,116,169,-308,106,189,-293,124,197,-293,126,212,-293,125,232,-293,124,251,-293,122,271,-293,121,290,-293,119,314,-293,116,333,-293,110,353,-293,102,372,-293,92,107,-308,108,14,-308,95,33,-308,95,68,-308,94,88,-308,100,-372,-312,92,-353,-312,104,-333,-312,116,-314,-312,127,-290,-312,136,-271,-312,144,-251,-312,147,-232,-312,147,-228,-312,147,-197,-312,147,-189,-312,146,-169,-312,139,-150,-312,127,-127,-327,115,-92,-327,111,-72,-327,114,-53,-327,120,-41,-327,120,-29,-327,118,-10,-327,117,14,-327,114,33,-327,112,68,-327,110,88,-327,112,107,-324,116,127,-320,120,131,-324,120,169,-324,108,189,-312,119,205,-312,123,212,-312,123,232,-312,122,251,-312,120,271,-312,118,290,-312,116,314,-312,111,333,-312,104,353,-312,95,-353,-331,100,-333,-331,109,-314,-331,118,-290,-331,126,-271,-331,132,-251,-331,133,-232,-331,134,-224,-331,134,-193,-331,135,-185,-331,135,-169,-331,135,-150,-347,129,-111,-347,127,-107,-347,127,-72,-347,125,-60,-347,126,-49,-347,125,-29,-347,121,-10,-343,119,14,-343,117,33,-347,113,53,-347,112,88,-335,113,107,-331,115,127,-331,118,131,-331,118,169,-331,108,189,-331,117,208,-331,120,212,-331,120,232,-331,119,251,-331,116,271,-331,111,290,-331,105,314,-331,100,333,-331,95,-353,-351,92,-333,-351,101,-314,-351,108,-290,-351,116,-275,-351,119,-251,-351,119,-232,-351,121,-220,-351,121,-193,-351,123,-173,-351,123,-154,-351,128,-150,-351,129,-111,-351,126,-103,-351,127,-72,-355,127,-60,-358,129,-49,-366,129,-29,-366,127,-10,-366,124,14,-366,122,33,-366,116,53,-366,113,88,-366,113,107,-351,114,127,-366,115,131,-366,115,154,-351,104,189,-351,107,208,-351,111,216,-351,111,232,-351,109,251,-351,103,271,-351,95,290,-351,90,-333,-370,91,-314,-370,98,-290,-370,104,-275,-370,105,-251,-370,106,-247,-370,107,-220,-370,107,-201,-370,108,-173,-370,110,-162,-370,117,-150,-370,116,-111,-370,116,-92,-370,118,-72,-370,123,-53,-370,125,-33,-378,131,-29,-378,131,-2,-389,133,14,-389,131,33,-389,125,53,-389,117,88,-378,113,107,-370,113,127,-378,117,131,-385,116,154,-389,105,189,-370,96,193,-370,96,228,-370,96,232,-370,94,-298,-393,90,-232,-393,91,-228,-393,92,-193,-393,92,-173,-393,99,-169,-393,100,-131,-393,100,-115,-393,103,-92,-393,104,-72,-393,109,-53,-393,114,-33,-393,118,-14,-393,124,-2,-393,133,25,-397,132,33,-397,129,53,-401,118,72,-393,111,95,-393,109,127,-393,113,134,-393,114,154,-397,109,173,-397,97,-173,-413,90,-111,-413,90,-92,-413,93,-72,-413,98,-53,-413,104,-33,-413,108,-14,-413,118,10,-413,122,25,-413,124,33,-413,124,53,-413,115,72,-420,104,92,-413,99,127,-413,104,131,-413,104,166,-413,100,173,-413,96,-53,-432,91,-33,-432,98,-14,-432,108,-2,-432,109,25,-432,111,33,-432,110,53,-432,100,72,-432,93,134,-432,90,-14,-451,95,10,-451,95,29,-451,99,33,-451,98,53,-451,92";
  let rimCache = null;
  function rimPoints(rim) {
    if (rimCache && rimCache.rim === rim) return rimCache.pts;
    const v = FUJI_RIM.split(",").map(Number);
    const kx = Math.cos(rim.latitude * Math.PI / 180) * 111320, ky = 110574;
    const pts = [];
    for (let i = 0; i + 2 < v.length; i += 3) {
      pts.push({ latitude: rim.latitude + v[i + 1] / ky, longitude: rim.longitude + v[i] / kx, m: v[i + 2] + 3600 });
    }
    rimCache = { rim, pts };
    return pts;
  }

  /**
   * ダイヤモンド富士・パール富士の**主な観測スポット**（2026-09-30）。
   *
   * 座標は OpenStreetMap（Nominatim）の地物、標高は国土地理院の標高API で引いた値。
   * 住所は地物の所在地（山頂は市町村の境にあることが多いので両方を書く）。
   * `deckM` は展望室の床の高さ（地上から）。
   *
   * 線や一覧が合っているかは、よく知られた日で確かめてある（test-align）:
   *   高尾山 12/22 16:10（冬至前後）・田貫湖 4/23 と 8/21 の日の出（4/20・8/20前後）・竜ヶ岳 12/21（冬至前後）。
   * 陣馬山・大観山・三ツ峠山・大菩薩嶺・精進湖・河口湖・新倉山は、太陽が富士山の方角を通らないので入れていない。
   */
  const FUJI_SPOTS = [
    { id: "panorama", name: "山中湖パノラマ台", kind: "展望地", latitude: 35.41261, longitude: 138.90948, groundM: 1089,
      address: "山梨県南都留郡山中湖村平野（県道730号 山中湖小山線）", note: "駐車場あり" },
    { id: "nagaike", name: "長池親水公園（山中湖）", kind: "湖畔", latitude: 35.42702, longitude: 138.87136, groundM: 984,
      address: "山梨県南都留郡山中湖村平野" },
    { id: "kirara", name: "山中湖交流プラザきらら", kind: "湖畔", latitude: 35.41975, longitude: 138.90208, groundM: 984,
      address: "山梨県南都留郡山中湖村平野" },
    { id: "ishiwari", name: "石割山 山頂", kind: "山頂", latitude: 35.45049, longitude: 138.90136, groundM: 1412,
      address: "山梨県南都留郡山中湖村", note: "登山" },
    { id: "tanuki", name: "田貫湖（休暇村富士の前）", kind: "湖畔", latitude: 35.34111, longitude: 138.55320, groundM: 680,
      address: "静岡県富士宮市佐折", note: "朝の富士山" },
    { id: "kenashi", name: "毛無山 山頂", kind: "山頂", latitude: 35.41581, longitude: 138.54387, groundM: 1962,
      address: "静岡県富士宮市・山梨県南巨摩郡身延町", note: "登山（朝霧高原から）" },
    { id: "ryugatake", name: "竜ヶ岳 山頂", kind: "山頂", latitude: 35.44664, longitude: 138.58367, groundM: 1482,
      address: "山梨県南都留郡富士河口湖町", note: "登山（本栖湖から）" },
    { id: "nakanokura", name: "中ノ倉峠（本栖湖）", kind: "展望地", latitude: 35.47568, longitude: 138.57299, groundM: 1083,
      address: "山梨県南巨摩郡身延町", note: "千円札の富士の撮影地。登山" },
    { id: "koan", name: "本栖湖（浩庵キャンプ場）", kind: "湖畔", latitude: 35.47273, longitude: 138.57501, groundM: 908,
      address: "山梨県南巨摩郡身延町" },
    { id: "takao", name: "高尾山 山頂", kind: "山頂", latitude: 35.62523, longitude: 139.24369, groundM: 598,
      address: "東京都八王子市高尾町", note: "ケーブルカーあり" },
    { id: "tonodake", name: "塔ノ岳 山頂", kind: "山頂", latitude: 35.45407, longitude: 139.16332, groundM: 1489,
      address: "神奈川県秦野市・足柄上郡山北町", note: "登山" },
    { id: "tanzawa", name: "丹沢山 山頂", kind: "山頂", latitude: 35.47436, longitude: 139.16269, groundM: 1567,
      address: "神奈川県足柄上郡山北町", note: "登山" },
    { id: "oyama", name: "大山 山頂（丹沢）", kind: "山頂", latitude: 35.44083, longitude: 139.23133, groundM: 1249,
      address: "神奈川県伊勢原市", note: "ケーブルカー＋登山" },
    { id: "myojin", name: "明神ヶ岳 山頂", kind: "山頂", latitude: 35.27950, longitude: 139.05251, groundM: 1168,
      address: "神奈川県南足柄市・足柄下郡箱根町", note: "登山" },
    { id: "kintoki", name: "金時山 山頂", kind: "山頂", latitude: 35.28970, longitude: 139.00485, groundM: 1212,
      address: "神奈川県足柄下郡箱根町・静岡県駿東郡小山町", note: "登山" },
    { id: "enoshima", name: "江の島", kind: "島", latitude: 35.30011, longitude: 139.48064, groundM: 41,
      address: "神奈川県藤沢市江の島" },
    { id: "katase", name: "片瀬東浜", kind: "海岸", latitude: 35.30690, longitude: 139.48507, groundM: 2,
      address: "神奈川県藤沢市片瀬海岸1丁目" },
    // 浜と岬は、波打ち際から陸へ寄せた点（2026-10-01。元の点は海の上だった。国土地理院の水域で確認）
    { id: "southern", name: "サザンビーチちがさき", kind: "海岸", latitude: 35.31780, longitude: 139.40030, groundM: 2,
      address: "神奈川県茅ヶ崎市中海岸4丁目" },
    { id: "jogashima", name: "城ヶ島", kind: "島", latitude: 35.13332, longitude: 139.61825, groundM: 30,
      address: "神奈川県三浦市三崎町城ヶ島" },
    { id: "landmark", name: "横浜ランドマークタワー スカイガーデン", kind: "展望台", latitude: 35.45460, longitude: 139.63145,
      groundM: 4, deckM: 273, address: "神奈川県横浜市西区みなとみらい2-2-1（69階）", note: "有料・開いている時間だけ" },
    { id: "tocho", name: "東京都庁 展望室", kind: "展望台", latitude: 35.68974, longitude: 139.69300,
      groundM: 35, deckM: 202, address: "東京都新宿区西新宿2-8-1（第一本庁舎45階）", note: "無料・開いている時間だけ" },
    { id: "umihotaru", name: "海ほたる", kind: "展望デッキ", latitude: 35.46299, longitude: 139.87642,
      groundM: 1, deckM: 12, address: "千葉県木更津市中島地先（東京湾アクアライン）", note: "車で行く" },
    { id: "futtsu", name: "富津岬（富津公園）", kind: "岬", latitude: 35.31280, longitude: 139.78520, groundM: 2,
      address: "千葉県富津市富津" },
  ];
  /// スポットに立ったときの観測者（地面＋展望室）
  const spotObserver = (s) => ({ latitude: s.latitude, longitude: s.longitude,
    elevation: (s.groundM ?? 0) + (s.deckM ?? 0) });
  const partOf = (target, partId) =>
    (target.parts || []).find((p) => p.id === partId) || (target.parts || [])[0] || null;

  const partTarget = (target, partId) => {
    if(partId==="__whole")return target;
    const p=partOf(target,partId);
    return p&&Number.isFinite(p.latitude)&&Number.isFinite(p.longitude)?{...target,latitude:p.latitude,longitude:p.longitude}:target;
  };

  /**
   * 天体のどこを合わせるか。**「下の縁」と「真ん中」は別の位置**。
   *   onTop  … 天体の下の縁が先端に接する（乗っかって見える）→ 中心は半径ぶん上
   *   center … 中心がその高さに重なる
   *   behind … 天体の上の縁がその高さ → 中心は半径ぶん下。山では山の裏へ沈みきる・裏から出始める瞬間（きらり）、
   *             塔は細いので天体は隠れず、円盤ぜんぶに塔が重なる
   * 名前は**天体のどの縁をてっぺんに合わせるか**だけを短く言い、意味は画面の図で見せる（2026-10-02。
   * 「てっぺんに乗る・中心が重なる・裏に隠れる」→「乗せる」→ ユーザー「乗せる・中心とか、なんかわからん。もっと簡潔でわかりやすいのが」
   * → Codex と相談（撮影の言葉に3つを分ける定着した言い方は無い。位置で言い、図を添える）→ ユーザーが「図つきの釦・短い字」を選んだ）。
   * 山と塔で名前は変えない（図の形だけ変える）
   */
  const LIMBS = [
    { id: "onTop", name: "下の縁", sign: 1 },
    { id: "center", name: "真ん中", sign: 0 },
    { id: "behind", name: "上の縁", sign: -1 },
  ];
  const limbById = (id) => LIMBS.find((l) => l.id === id) || LIMBS[1];

  const B = global.SoramiBodies || (typeof require !== "undefined" ? require("./sorami-bodies.js") : null);
  const ATM=global.SoramiAtmosphere||(typeof require!=="undefined"?require("./sorami-atmosphere.js"):null);
  const targetAngle=(...args)=>A.targetElevationAngle(...args,{k:ATM?ATM.targetK():7/6});
  const limbAltitude=(s,sign)=>ATM?ATM.limbAltitude(s,sign):s.apparentAltitude-sign*s.angularRadius;
  const bodyAt = (body, ms, obs) => B ? B.state(body, ms, obs) : (body === "moon" ? A.moon(ms, obs) : body === "sun" ? A.sun(ms, obs) : (() => { throw new Error("天体計算が未読込です"); })());
  const extended = body => body !== "sun" && body !== "moon";
  const DEG = Math.PI / 180;

  /**
   * その日、天体の見かけの高度が `alt` を通る時刻。
   * @param {string} side "set"=下降中 / "rise"=上昇中
   */
  function altitudeCrossing(body, dayMs, obs, alt, side, stepMs = 120000, sign = 0) {
    let prev = null;
    for (let t = dayMs; t <= dayMs + 86400000; t += stepMs) {
      const cur = limbAltitude(bodyAt(body, t, obs),sign);
      if (prev !== null) {
        const falling = cur < prev.alt;
        const crossed = (prev.alt - alt) * (cur - alt) <= 0;
        if (crossed && ((side === "set" && falling) || (side === "rise" && !falling))) {
          let lo = prev.t, hi = t, loDiff = prev.alt - alt;
          for (let i = 0; i < 30; i++) {
            const mid = (lo + hi) / 2;
            const d = limbAltitude(bodyAt(body, mid, obs),sign) - alt;
            if (d * loDiff > 0) { lo = mid; loDiff = d; } else hi = mid;
          }
          return (lo + hi) / 2;
        }
      }
      prev = { t, alt: cur };
    }
    return null;
  }

  /**
   * 距離 d の観測点を1つ解く。
   * @param {function} elevationAt  (lat, lon) => 標高[m]（省略可。既定は 0m）
   */
  async function solvePoint(target, body, dayMs, distanceKm, side, opts = {}) {
    target=partTarget(target,opts.partId);
    const { eyeM = 1.5, elevationAt = null, rounds = 3, heightM = null, limb = "center" } = opts;
    const topM = heightM !== null ? heightM : (partOf(target, opts.partId) || {}).m;
    if (!Number.isFinite(topM)) return null;
    const sign = limbById(limb).sign;
    let guess = { latitude: target.latitude, longitude: target.longitude };
    let obsM = 0, at = null, azimuth = null, alpha = null;
    let back = null;   // 目標から見た観測点の方位
    for (let i = 0; i < rounds; i++) {
      if (elevationAt) {
        const e = await elevationAt(guess.latitude, guess.longitude);
        if (Number.isFinite(e)) obsM = e;
      }
      const obs0 = { latitude: guess.latitude, longitude: guess.longitude, elevation: obsM + eyeM };
      // その高さを見上げる角度。乗せる／隠れるは、天体の半径ぶんずらした高度を狙う
      const base = targetAngle(distanceKm, obsM + eyeM, topM);
      alpha = base;
      at = altitudeCrossing(body, dayMs, obs0, alpha, side,120000,sign);
      if (at === null) return null;
      const st = bodyAt(body, at, obs0);
      azimuth = st.azimuth;
      // 観測者から見て天体（＝目標）が方位 azimuth にある。
      //
      // **「目標から見て反対の方位」に置くだけでは、観測者から見た目標の方位は azimuth にならない。**
      // 球の上では、行きの方位と帰りの方位が子午線の収束ぶん（経度差×sin緯度）ずれる。
      // 富士山から東へ80kmで 0.44°＝太陽の半径（0.27°）より大きく、線が横に 0.6km ずれていた
      // （2026-09-30。高尾山で線が 0.2〜0.6km 外れていた原因）。
      // 観測者から目標を見た方位が azimuth になるまで、置く方位を直す
      if (back === null) back = (azimuth + 180) % 360;
      for (let k = 0; k < 4; k++) {
        guess = TR.destination(target.latitude, target.longitude, back, distanceKm);
        const seen = TR.bearing(guess.latitude, guess.longitude, target.latitude, target.longitude);
        const miss = ((azimuth - seen + 540) % 360) - 180;
        if (Math.abs(miss) < 1e-6) break;
        back = (back + miss + 360) % 360;
      }
    }
    const obs = { latitude: guess.latitude, longitude: guess.longitude, elevation: obsM + eyeM };
    const st = bodyAt(body, at, obs);
    return {
      latitude: guess.latitude, longitude: guess.longitude,
      at, distanceKm, elevationM: obsM, targetTopM: topM, limb,
      azimuth: st.azimuth, altitude: st.apparentAltitude,
      radius: st.angularRadius,
      illuminated: body === "moon" ? st.illuminatedFraction : null,
      sunAltitude: body === "sun" ? null : body === "moon" ? bodyAt("sun",at,obs).apparentAltitude : A.sun(at, obs).geometricAltitude,
    };
  }

  /**
   * 線を引く距離の範囲。**目標の高さで決まる。**
   * 高さ h を見上げる角度は距離で決まるので、使える角度の帯（約20°〜0.5°）を距離に直す。
   * 60mの避雷針を120km先から見上げても地平線の下で、3776mの富士山を8km先から
   * 見上げるのは山の中腹。同じ距離を全部の目標に当てると、どちらかが無駄になる。
   * 遠い端は 2026-10-02 まで 1° だった（シンデレラ城で3km）。城の 3.7km 先の候補地が線の先に浮いていて（ユーザー「地図上の線が届いてないね」）、
   * ユーザーの城と満月の写真も見上げ 0.98°（2.85km）と 1° の端ぎりぎりから撮れているので、0.5° にした（城で6km、スカイツリーで73km）
   */
  function lineRange(topM) {
    const near = Math.max(0.3, (topM / 1000) / Math.tan(20 * Math.PI / 180));
    const far = Math.min(150, (topM / 1000) / Math.tan(0.5 * Math.PI / 180));
    return { minKm: Math.round(near * 10) / 10, maxKm: Math.round(far) };
  }

  /**
   * 数をかぎって同時に走らせる。
   * 1点ずつ順番に待つと、標高タイルの往復（1枚55ms・実測）がそのまま積み上がる
   * （富士山の線で88枚＝4.2秒）。かといって全部いっぺんに投げると
   * 国土地理院へ一度に88本の要求が飛ぶ。**6本ずつ**にして両方を避ける。
   */
  async function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return out;
  }

  /**
   * 線を解く距離の並び。**等間隔ではなく、近いほど細かく取る。**
   * 線は近いほど強く曲がる（見上げ角が急に変わるので、天体の方位も急に変わる）。
   * 等間隔だと、その曲がる区間が数点しか無くて折れ線に見える。
   */
  function lineDistances(minKm, maxKm, count = 36) {
    const r = (maxKm / minKm) ** (1 / (count - 1));
    return Array.from({ length: count }, (_, i) => minKm * r ** i);
  }

  /**
   * その日の線。距離を変えながら観測点を並べる。
   * 距離を渡さなければ、目標の高さから決める（`lineRange`）。
   * @returns {Promise<{side:string, points:Array}>[]} 日の出側・日の入側それぞれ
   */
  async function line(target, body, dayMs, opts = {}) {
    const auto = lineRange(((partOf(target, opts.partId) || {}).m) || 0);
    const { minKm = auto.minKm, maxKm = auto.maxKm, stepKm = null, sides = ["rise", "set"] } = opts;
    const dists = stepKm
      ? Array.from({ length: Math.floor((maxKm - minKm) / stepKm) + 1 }, (_, i) => minKm + i * stepKm)
      : lineDistances(minKm, maxKm);
    const out = [];
    for (const side of sides) {
      const solved = await mapLimit(dists, 6,
        (d) => solvePoint(target, body, dayMs, d, side, opts));
      // 地平線より下、または天体が出ていない側は線にならない
      let points = solved.filter((p) => p && p.altitude > -1).map((p) => ({ ...p, side }));
      // **1点ごとの凹凸で線を蛇行させない。**
      // 谷と尾根では立つ標高が 1500m 違い、そのぶん山頂の見上げ角も変わるので、
      // 生の標高で1点ずつ解くと隣の点どうしで方位が行き来する（実測: ±1°＝50kmで約900m）。
      // 標高をならしてから解き直す。**その方向のおおよその地面の高さ**で引いた線になる。
      if (points.length >= 3 && opts.elevationAt && opts.smooth !== false) {
        points = await smoothLine(target, body, dayMs, side, points, opts);
      }
      if (points.length >= 2) out.push({ side, points });
    }
    return out;
  }

  /// 標高をならして解き直す。窓は前後 `smoothWindow` 点（両端は在るぶんだけ）
  async function smoothLine(target, body, dayMs, side, points, opts) {
    const w = Number.isFinite(opts.smoothWindow) ? opts.smoothWindow : 5;
    const raw = points.map((p) => p.elevationM);
    const solved = await mapLimit(points, 6, async (pt, i) => {
      const lo = Math.max(0, i - w), hi = Math.min(raw.length - 1, i + w);
      const win = raw.slice(lo, hi + 1);
      const m = win.reduce((a, b) => a + b, 0) / win.length;
      const p = await solvePoint(target, body, dayMs, pt.distanceKm, side,
        { ...opts, elevationAt: () => m });
      return p && p.altitude > -1 ? { ...p, side, groundM: raw[i] } : null;
    });
    const out = solved.filter(Boolean);
    return out.length >= 2 ? out : points;
  }

  /// 観測地点から見た目標の幾何（方位と見上げ角）。**地形は見ない**（線と一覧の両方で使う素の値）
  function geometryFrom(observer, target, opts = {}) {
    target=partTarget(target,opts.partId);
    const { eyeM = 1.5, partId = null, heightM = null } = opts;
    const topM = heightM !== null ? heightM : (partOf(target, partId) || {}).m;
    if (!Number.isFinite(topM)) return null;
    const distanceKm = TR.distanceKm(observer.latitude, observer.longitude, target.latitude, target.longitude);
    return {
      distanceKm,
      azimuth: TR.bearing(observer.latitude, observer.longitude, target.latitude, target.longitude),
      angle: targetAngle(distanceKm, (observer.elevation ?? 0) + eyeM, topM),
      topM,
    };
  }

  const azDiff = (a, b) => ((a - b + 540) % 360) - 180;

  /**
   * 観測者から見た頂の稜線（火口の縁）。縁の点ごとに方位と見上げ角を出し、
   * 方位の近いものの一番上を稜線とする。幅の無い目標は null。
   * @returns {{azimuth, min, max, at(rel)}} azimuth は縁の中心の方位、min/max は稜線の左右の端（中心からの差[度]）
   */
  function rimOutline(obs, target) {
    const rim = target && target.rim;
    if (!rim) return null;
    const d0 = TR.distanceKm(obs.latitude, obs.longitude, rim.latitude, rim.longitude);
    const az0 = TR.bearing(obs.latitude, obs.longitude, rim.latitude, rim.longitude);
    const list = rimPoints(rim).map((p) => {
      const d = TR.distanceKm(obs.latitude, obs.longitude, p.latitude, p.longitude);
      return { rel: azDiff(TR.bearing(obs.latitude, obs.longitude, p.latitude, p.longitude), az0),
               ang: targetAngle(d, obs.elevation ?? 0, p.m) };
    }).sort((a, b) => a.rel - b.rel);
    // 20m 格子なので、その距離で 15m ぶんの幅の中の一番上を取る
    const bin = Math.atan(0.015 / Math.max(0.5, d0)) / DEG;
    const rels = list.map((x) => x.rel);
    const lower = (x) => { let lo = 0, hi = rels.length; while (lo < hi) { const m = (lo + hi) >> 1; if (rels[m] < x) lo = m + 1; else hi = m; } return lo; };
    return {
      azimuth: az0, min: rels[0], max: rels[rels.length - 1],
      at(rel) {
        let best = null;
        for (let i = lower(rel - bin); i < list.length && list[i].rel <= rel + bin; i++) {
          if (best === null || list[i].ang > best) best = list[i].ang;
        }
        return best;
      },
    };
  }

  /**
   * 天体が狙う方位を横切った瞬間 `at0` の重なり方。
   * 頂が輪（火口の縁）なら、天体が縁の左右の端のあいだを渡るあいだに、
   * 中心（乗る・隠れるは半径ぶんずらした点）が**稜線に届くか**を見る。
   * 届けば差は 0 で、時刻はその瞬間（頂に沈む／頂から出る）。届かなければ一番近づいたときの差。
   */
  function judge(body, at0, obs, angle, sign, outline) {
    const st0 = bodyAt(body, at0, obs);
    if (!outline) return { at: at0, gap: limbAltitude(st0,sign) - angle, st: st0 };
    const a = bodyAt(body, at0 - 60000, obs), b = bodyAt(body, at0 + 60000, obs);
    const rate = azDiff(b.azimuth, a.azimuth) / 120000;          // 方位の動き[度/ms]
    if (!rate) return { at: at0, gap: limbAltitude(st0,sign) - angle, st: st0 };
    const tA = at0 + outline.min / rate, tB = at0 + outline.max / rate;
    const t0 = Math.min(tA, tB), t1 = Math.max(tA, tB);
    const f = (t) => {
      const st = bodyAt(body, t, obs);
      const ridge = outline.at(azDiff(st.azimuth, outline.azimuth));
      return ridge === null ? null : { t, st, v: limbAltitude(st,sign) - ridge };
    };
    const n = 48;
    let prev = null, best = null;
    for (let i = 0; i <= n; i++) {
      const cur = f(t0 + (t1 - t0) * i / n);
      if (!cur) continue;
      if (!best || Math.abs(cur.v) < Math.abs(best.v)) best = cur;
      if (prev && Math.sign(prev.v) !== Math.sign(cur.v)) {
        let lo = prev, hi = cur;
        for (let k = 0; k < 20; k++) {
          const mid = f((lo.t + hi.t) / 2);
          if (!mid) break;
          if (Math.sign(mid.v) === Math.sign(lo.v)) lo = mid; else hi = mid;
        }
        const at = (lo.t + hi.t) / 2, st = bodyAt(body, at, obs);
        // 縁の左右の真ん中からどれだけ外れた所か。**内側の6割なら「ど真ん中」、外側なら「重なる」**
        // （頂の端の肩に沈む日まで「ど真ん中」と言わない）。同じ回の中で代表の日を選ぶのにも使う。
        // 高尾山では 12/19〜12/24 が「ど真ん中」になり、よく知られた「冬至の前後」と合う
        const half = (outline.max - outline.min) / 2;
        const off = Math.abs(azDiff(st.azimuth, outline.azimuth) - (outline.min + outline.max) / 2);
        return { at, gap: 0, st, off, rank: off <= 0.6 * half ? "center" : "overlap" };
      }
      prev = cur;
    }
    // 中心が稜線に届かなかった。**届かない以上「ど真ん中」とは言わない**（円盤の一部が縁に掛かるだけ）
    const miss = best ? { at: best.t, gap: best.v, st: best.st }
      : { at: at0, gap: limbAltitude(st0,sign) - angle, st: st0 };
    const r = rankOf(miss.gap, miss.st.angularRadius);
    return { ...miss, rank: r === "center" ? "overlap" : r };
  }

  /**
   * その地点で、次に重なる日を並べる（「ダイヤモンド◯◯一覧」「パール◯◯一覧」）。
   * 判定は `SoramiFuji.alignments()` と同じ考え方で、幾何だけ目標ごとに作る。
   */
  function upcoming(observer, target, body, opts = {}) {
    const { from = Date.now(), days = 400, limit = 6, limb = "center", stepMs = null, groupDays = true } = opts;
    const g = geometryFrom(observer, target, opts);
    if (!g) return [];
    const sign = limbById(limb).sign;
    const step = stepMs ?? (body === "moon" ? 900000 : 600000);
    const obs = { latitude: observer.latitude, longitude: observer.longitude,
                  elevation: (observer.elevation ?? 0) + (opts.eyeM ?? 1.5) };
    const outline = rimOutline(obs, target);
    const aimAz = { azimuth: outline ? outline.azimuth : null };
    const out = [];
    let group = null;
    for (let i = 0; i < days && out.length < limit; i++) {
      const dayMs = from + i * 86400000;
      // その日、天体が目標の方位を横切る時刻
      let prev = null;
      for (let t = dayMs; t <= dayMs + 86400000; t += step) {
        const diff = azDiff(bodyAt(body, t, obs).azimuth, aimAz.azimuth ?? g.azimuth);
        if (prev && Math.sign(prev.diff) !== Math.sign(diff) && Math.abs(diff - prev.diff) < 90) {
          let lo = prev.t, hi = t, loDiff = prev.diff;
          for (let k = 0; k < 36; k++) {
            const mid = (lo + hi) / 2;
            const md = azDiff(bodyAt(body, mid, obs).azimuth, aimAz.azimuth ?? g.azimuth);
            if (Math.sign(md) === Math.sign(loDiff)) { lo = mid; loDiff = md; } else hi = mid;
          }
          const j = judge(body, (lo + hi) / 2, obs, g.angle, sign, outline);
          const { at, gap, st } = j;
          const within = Math.abs(gap) <= (extended(body) ? st.angularRadius + 0.5 : 2 * st.angularRadius);
          if (within && st.apparentAltitude > -1) {
            const later = bodyAt(body, at + 60000, obs).apparentAltitude;
            const row = { at, gap, radius: st.angularRadius,
              rank: j.rank || rankOf(gap, st.angularRadius),
              side: later < st.apparentAltitude ? "set" : "rise",
              altitude: st.apparentAltitude,
              illuminated: body === "moon" ? st.illuminatedFraction : null,
              sunAltitude: body === "sun" ? null : body === "moon" ? bodyAt("sun",at,obs).apparentAltitude : A.sun(at, obs).geometricAltitude };
            row.off = j.off ?? 0;
            // カレンダーでは各日を返す。既存の候補帯は連続日を代表日にまとめる。
            if (groupDays && group && at - group.last <= 40 * 3600000) {
              group.last = at;
              // 差が同じ（どちらも頂に届く）なら、縁の真ん中に近い日を代表にする
              if (Math.abs(row.gap) < Math.abs(group.best.gap)
                || (row.gap === group.best.gap && row.off < group.best.off)) group.best = row;
              if (row.rank !== "graze") group.solid.push(row);
            } else {
              if (group) out.push(group);
              group = { best: row, first: at, last: at, solid: row.rank !== "graze" ? [row] : [] };
            }
          }
        }
        prev = { t, diff };
      }
    }
    if (group && out.length < limit) out.push(group);
    return out.slice(0, limit).map((x) => ({
      ...x.best, distanceKm: g.distanceKm, targetAngle: g.angle, targetTopM: g.topM,
      from: x.solid.length ? x.solid[0].at : x.best.at,
      to: x.solid.length ? x.solid[x.solid.length - 1].at : x.best.at,
      dayCount: Math.max(1, x.solid.length),
    }));
  }

  // 写真の見え方は先端の一致に限定しない。建物の輪郭全体と円盤の距離。
  function polygonDistance(point, polygon) {
    let inside = false, distance = Infinity;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const a = polygon[j], b = polygon[i];
      if ((a[1] > point[1]) !== (b[1] > point[1]) && point[0] < (b[0] - a[0]) * (point[1] - a[1]) / (b[1] - a[1]) + a[0]) inside = !inside;
      const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
      const u = len ? Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / len)) : 0;
      distance = Math.min(distance, Math.hypot(point[0] - a[0] - u * dx, point[1] - a[1] - u * dy));
    }
    return inside ? 0 : distance;
  }
  function cameraFrame(focalMm, sensorWidth = 36, sensorHeight = 24, portrait = false) {
    if (!Number.isFinite(focalMm) || focalMm < 8 || focalMm > 2000 || !Number.isFinite(sensorWidth) || !Number.isFinite(sensorHeight) || !(sensorWidth > 0 && sensorHeight > 0)) return null;
    const w = portrait ? sensorHeight : sensorWidth, h = portrait ? sensorWidth : sensorHeight;
    return { halfW: w / (2 * focalMm) / R, halfH: h / (2 * focalMm) / R,
      horizontalDeg: 2 * Math.atan(w / (2 * focalMm)) / R, verticalDeg: 2 * Math.atan(h / (2 * focalMm)) / R };
  }
  function dailyView(observer, target, body, dayMs, opts = {}) {
    const g = geometryFrom(observer, target, opts);
    if (!g) return [];
    const obs = { ...observer, elevation: (observer.elevation ?? 0) + (opts.eyeM ?? 1.5) };
    const outline = towerOutline(observer, target, opts);
    const centerAlt = outline ? (outline.viewBaseAngle + outline.topAngle) / 2 : g.angle;
    const project = viewProjector(g.azimuth, centerAlt);
    const polygons = outline ? (outline.hitPolygons || [outline.hitPoints || outline.points]).map(poly=>poly.map(([a,h])=>project(a,h)).filter(Boolean)).filter(poly=>poly.length>=3) : null;
    const evaluate = (at) => {
      const st = bodyAt(body, at, obs), xy = project(st.azimuth, st.apparentAltitude);
      const radius = Math.tan(st.angularRadius * R) / R;
      const upper=project(st.azimuth,st.upperAltitude??st.apparentAltitude+st.angularRadius),lower=project(st.azimuth,st.lowerAltitude??st.apparentAltitude-st.angularRadius);
      const ratio=Number.isFinite(st.upperRadius)&&radius>0&&upper&&lower?Math.max(.1,Math.abs(upper[1]-lower[1])/(2*radius)):1;
      const center=xy?[xy[0],Number.isFinite(st.upperRadius)&&upper&&lower?(upper[1]+lower[1])/2:xy[1]]:null;
      const scaled=polygons&&ratio!==1?polygons.map(poly=>poly.map(p=>[p[0],p[1]/ratio])):polygons;
      const distance = center ? (scaled ? Math.min(...scaled.map(poly=>polygonDistance([center[0],center[1]/ratio],poly))) : Math.hypot(center[0],center[1]/ratio)) : Infinity;
      return { at, gap: st.apparentAltitude - g.angle, radius: st.angularRadius, distanceToTarget: distance, approximate: !!outline?.approximate,
        intersects: distance <= radius && (st.upperAltitude??st.apparentAltitude+st.angularRadius) > 0,
        nearTarget: distance <= (extended(body) ? radius + 0.5 : 2 * radius) && st.apparentAltitude + st.angularRadius > 0,
        altitude: st.apparentAltitude, illuminated: body === "moon" ? st.illuminatedFraction : null,
        sunAltitude: body === "sun" ? st.apparentAltitude : body === "moon" ? bodyAt("sun",at,obs).apparentAltitude : A.sun(at, obs).geometricAltitude,
        side: bodyAt(body, at + 60000, obs).apparentAltitude < st.apparentAltitude ? "set" : "rise" };
    };
    const end = dayMs + 86400000, crossings = [];
    let previous = null, nearest = null;
    // 全天の軌道も確認し、目標の方位を横切らない日にも最接近を返す。
    for (let at = dayMs; at <= end; at += 600000) {
      const st = bodyAt(body, at, obs), diff = azDiff(st.azimuth, g.azimuth), row = evaluate(at);
      if (at < end && (!nearest || row.distanceToTarget < nearest.distanceToTarget)) nearest = row;
      if (at === dayMs && Math.abs(diff) < 1e-9) crossings.push(row);
      if (previous && Math.abs(previous.diff) > 1e-9 && (at < end || Math.abs(diff) > 1e-9) && Math.sign(diff) !== Math.sign(previous.diff) && Math.abs(diff - previous.diff) < 90) {
        let lo = previous.at, hi = at, sign = previous.diff;
        for (let k = 0; k < 28; k++) {
          const mid = (lo + hi) / 2, d = azDiff(bodyAt(body, mid, obs).azimuth, g.azimuth);
          if (Math.sign(d) === Math.sign(sign)) lo = mid; else hi = mid;
        }
        let best = evaluate((lo + hi) / 2);
        // 横切る瞬間の前後も見る。円盤が建物の横の縁だけに掛かる日を落とさない。
        if (outline) for (let dt = -600000; dt <= 600000; dt += 20000) {
          const t = (lo + hi) / 2 + dt;
          if (t < dayMs || t >= end) continue;
          const e = evaluate(t);
          if (e.distanceToTarget < best.distanceToTarget) best = e;
        }
        if (best.at >= dayMs && best.at < end) crossings.push(best);
      }
      previous = { at, diff };
    }
    if (!crossings.length && nearest) {
      const lo = Math.max(dayMs, nearest.at - 600000), hi = Math.min(end - 1, nearest.at + 600000);
      for (let at = lo; at <= hi; at += 20000) { const e = evaluate(at); if (e.distanceToTarget < nearest.distanceToTarget) nearest = e; }
      crossings.push(nearest);
    }
    if (extended(body)) {
      const refine = row => {
        let lo=Math.max(dayMs,row.at-20000),hi=Math.min(end-1,row.at+20000);
        const ratio=(Math.sqrt(5)-1)/2;
        let x=hi-ratio*(hi-lo),y=lo+ratio*(hi-lo),a=evaluate(x),b=evaluate(y);
        for(let i=0;i<32;i++) {
          if(a.distanceToTarget<=b.distanceToTarget){hi=y;y=x;b=a;x=hi-ratio*(hi-lo);a=evaluate(x);}
          else{lo=x;x=y;a=b;y=lo+ratio*(hi-lo);b=evaluate(y);}
        }
        const best=a.distanceToTarget<=b.distanceToTarget?a:b;
        return best.distanceToTarget<row.distanceToTarget?best:row;
      };
      for(let i=0;i<crossings.length;i++) crossings[i]=refine(crossings[i]);
    }
    return crossings.sort((a, b) => a.at - b.at);
  }

  function buildingUpcoming(observer, target, body, { from = Date.now(), days = 400, limit = 4, partId = null } = {}) {
    const start = Math.floor((from + 9 * 3600000) / 86400000) * 86400000 - 9 * 3600000, out = [];
    for (let i = 0; i < days && out.length < limit; i++) {
      const row = dailyView(observer, target, body, start + i * 86400000, { partId })
        .find((e) => e.at >= from && e.intersects && (body !== "moon" || e.sunAltitude < 0));
      if (row) out.push(row);
    }
    return out;
  }

  // ---------------------------------------------------------------- その日の候補地（2026-09-30）
  /*
   * 線だけでは「どこへ行けばよいか」が分からない（ユーザー指摘「月丼みたいに候補地を出して」）。
   * **立てる場所**（展望地・山頂・峠・橋・公園・海岸・展望台）の中から、その日の線に掛かるものを拾い、
   * そこに立ったとして**重なるかを1つずつ解き直す**。線は標高をならして引いているので、
   * 山頂のように周りより高い場所では、本当に重なる位置が線から横にずれる（50km先の山頂で数百m）。
   *
   * 場所の形で、立つ位置の決め方が違う。
   *   点（展望地・山頂・峠・展望台）… その点に立つ。動かさない
   *   線（橋・桟橋）                … 橋の上で重なる点を探す（両端で天体の上下が入れ替われば挟んで解く）
   *   面（公園・海岸）              … 線が通る区間の中ほどに立ち、重なるよう横へ1歩直す（面の外へは出ない）
   */

  /// 天体の中心と、合わせたい高さ（先端＋半径×合わせ方）との差を段に分ける。`upcoming` と同じ区切り
  const rankOf = (gap, r) => (Math.abs(gap) <= (r === 0 ? 1e-5 : 0.5 * r) ? "center"
    : Math.abs(gap) <= r ? "overlap" : Math.abs(gap) <= 2 * r ? "graze" : null);
  /**
   * **選んだ合わせ方どおり**とみなすずれ（天体の半径に対する割合）。候補地はこれ以内のものだけを出す（2026-10-02）。
   * ユーザー「上の縁を選んでるのに上の縁が先端に重ならなかったりする」: それまで半径の2倍ずれた所（縁がかすめる）まで
   * 「重なる」として出していて、図では選んだ縁が先端から 0.5° 離れていた。半径の2割なら、図でも縁が先端に触れて見える
   */
  const LIMB_FIT = 0.2;
  /// 動ける場所（橋・川岸・公園）は、ずれがここまで小さくなるまで立つ点を詰める
  const LIMB_EXACT = 0.02;

  /**
   * その地点で、`approxAt` の前後に天体が目標の方位を横切る瞬間を解く。
   * 一覧（`upcoming`）の1日ぶんと同じ判定を、時刻の見当を付けて速く回す。
   * @returns {{at, gap, rank, slope, altitude, azimuth, radius, distanceKm, targetAngle, ...}|null}
   *   slope は天体の通り道の傾き（方位1°あたりの高度の変化）。立つ位置を横へ直すのに使う
   */
  function crossingNear(observer, target, body, approxAt, opts = {}) {
    const g = geometryFrom(observer, target, opts);
    if (!g) return null;
    const sign = limbById(opts.limb).sign;
    const obs = { latitude: observer.latitude, longitude: observer.longitude,
                  elevation: (observer.elevation ?? 0) + (opts.eyeM ?? 1.5) };
    const span = opts.spanMs ?? 3 * 3600000, step = opts.stepMs ?? 300000;
    const outline = rimOutline(obs, target);
    const azT = outline ? outline.azimuth : g.azimuth;
    let prev = null, best = null;
    for (let t = approxAt - span; t <= approxAt + span; t += step) {
      const diff = azDiff(bodyAt(body, t, obs).azimuth, azT);
      if (prev && Math.sign(prev.diff) !== Math.sign(diff) && Math.abs(diff - prev.diff) < 90) {
        let lo = prev.t, hi = t, loDiff = prev.diff;
        for (let k = 0; k < 30; k++) {
          const mid = (lo + hi) / 2;
          const md = azDiff(bodyAt(body, mid, obs).azimuth, azT);
          if (Math.sign(md) === Math.sign(loDiff)) { lo = mid; loDiff = md; } else hi = mid;
        }
        const at = (lo + hi) / 2;
        if (!best || Math.abs(at - approxAt) < Math.abs(best.at - approxAt)) best = { at };
      }
      prev = { t, diff };
    }
    if (!best) return null;
    const j = judge(body, best.at, obs, g.angle, sign, outline);
    best.at = j.at;
    const st = j.st, gap = j.gap;
    const rank = j.rank || rankOf(gap, st.angularRadius);
    const a = bodyAt(body, best.at - 60000, obs), b = bodyAt(body, best.at + 60000, obs);
    const dAz = azDiff(b.azimuth, a.azimuth);
    const later = b.apparentAltitude;
    return {
      at: best.at, gap, rank,
      slope: dAz !== 0 ? (b.apparentAltitude - a.apparentAltitude) / dAz : 0,
      side: later < st.apparentAltitude ? "set" : "rise",
      altitude: st.apparentAltitude, azimuth: st.azimuth, radius: st.angularRadius,
      distanceKm: g.distanceKm, targetAngle: g.angle, targetTopM: g.topM,
      illuminated: body === "moon" ? st.illuminatedFraction : null,
      sunAltitude: body === "sun" ? null : body === "moon" ? bodyAt("sun",best.at,obs).apparentAltitude : A.sun(best.at, obs).geometricAltitude,
    };
  }

  // 平面の近似（候補1つのまわり数km）。緯度1°=110.574km、経度1°=111.320km×cos(緯度)
  function localFrame(lat0, lon0) {
    const kx = Math.cos(lat0 * DEG) * 111320, ky = 110574;
    return {
      xy: (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky],
      ll: (x, y) => ({ latitude: lat0 + y / ky, longitude: lon0 + x / kx }),
    };
  }

  /// 線分 ab と cd の交点（あれば a→b の割合 t と c→d の割合 u）
  function segmentCross(a, b, c, d) {
    const rx = b[0] - a[0], ry = b[1] - a[1], sx = d[0] - c[0], sy = d[1] - c[1];
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-9) return null;
    const qx = c[0] - a[0], qy = c[1] - a[1];
    const t = (qx * sy - qy * sx) / den, u = (qx * ry - qy * rx) / den;
    return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? { t, u } : null;
  }
  /// 点 p から線分 ab への最短（距離と、線分上の割合）
  function nearestOnSegment(p, a, b) {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)) : 0;
    const x = a[0] + t * dx, y = a[1] + t * dy;
    return { d: Math.hypot(p[0] - x, p[1] - y), t, x, y };
  }
  function insidePolygon(p, ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const [xi, yi] = ring[i], [xj, yj] = ring[j];
      if ((yi > p[1]) !== (yj > p[1]) && p[0] < (xj - xi) * (p[1] - yi) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  /// 目標のまわりに観測点を回す（距離は保ったまま方位だけ変える）。重なる位置へ横に直すのに使う
  function rotateAround(target, point, dBearing) {
    const d = TR.distanceKm(target.latitude, target.longitude, point.latitude, point.longitude);
    const b = TR.bearing(target.latitude, target.longitude, point.latitude, point.longitude);
    return TR.destination(target.latitude, target.longitude, b + dBearing, d);
  }

  /**
   * 場所の形の読み方。`g` は緯度経度を交互に並べた配列（×1e5 の整数）。
   *   shape "point" … 点。`g` は無い
   *   shape "line"  … 橋・桟橋。`g` は折れ線
   *   shape "area"  … 公園・海岸。`g` は外周（閉じていなくてよい）
   */
  function placeGeometry(p) {
    if (!p.g || p.g.length < 4) return [];
    const out = [];
    for (let i = 0; i + 1 < p.g.length; i += 2) out.push([p.g[i] / 1e5, p.g[i + 1] / 1e5]);
    return out;
  }

  /**
   * その日の線に掛かる場所を拾い、立つ位置と重なり方を決める。
   * @param {Array} lines  `line()` の結果（標高をならした線）
   * @param {Array} places 立てる場所 {id, name, kind, shape, latitude, longitude, elevationM, deckM, g, reachM}
   * @param {object} opts  partId, limb, eyeM, elevationAt(lat,lon)→標高（面・線で立つ位置の標高）
   * @returns {Promise<Array>} 重なる（かすめる）場所。立つ位置 `stand` と、そこでの `crossingNear` の結果
   */
  async function candidates(lines, places, target, body, opts = {}) {
    target=partTarget(target,opts.partId);
    const { elevationAt = null } = opts;
    const jobs = [];
    for (const l of lines) {
      const pts = l.points;
      if (!pts || pts.length < 2) continue;
      const lineBearings = pts.map((p) => TR.bearing(target.latitude, target.longitude, p.latitude, p.longitude));
      const minKm = pts[0].distanceKm, maxKm = pts[pts.length - 1].distanceKm;
      // 天体の通り道の傾き（方位1°あたりの高度）。立つ高さが違うと、重なる方位がこれで決まるぶんずれる
      const eye = opts.eyeM ?? 1.5;
      const topM = (partOf(target, opts.partId) || {}).m;
      const mid = pts[Math.floor(pts.length / 2)];
      const mo = { latitude: mid.latitude, longitude: mid.longitude, elevation: (mid.elevationM ?? 0) + eye };
      const b0 = bodyAt(body, mid.at - 60000, mo), b1 = bodyAt(body, mid.at + 60000, mo);
      const dAz = azDiff(b1.azimuth, b0.azimuth);
      const pathSlope = dAz ? (b1.apparentAltitude - b0.apparentAltitude) / dAz : 0;
      const radius = b0.angularRadius;
      for (const place of places) {
        const D = TR.distanceKm(target.latitude, target.longitude, place.latitude, place.longitude);
        const reachKm = (place.reachM || 0) / 1000;
        if (D + reachKm < minKm * 0.9 || D - reachKm > maxKm * 1.05) continue;
        // 線の方位をこの距離で読む
        let i = pts.findIndex((p) => p.distanceKm >= D);
        if (i < 0) i = pts.length - 1;
        if (i === 0) i = 1;
        const p0 = pts[i - 1], p1 = pts[i];
        const f = Math.max(0, Math.min(1, (D - p0.distanceKm) / ((p1.distanceKm - p0.distanceKm) || 1)));
        const lb = lineBearings[i - 1] + azDiff(lineBearings[i], lineBearings[i - 1]) * f;
        const pb = TR.bearing(target.latitude, target.longitude, place.latitude, place.longitude);
        if (Math.abs(azDiff(pb, lb)) > 90) continue;
        // **立つ高さで、本当の線は横にずれる。** 線は標高をならして引いてあるので、
        // その場所の高さ（点は持っている標高、面と線はその距離の生の地面）で見上げ角を出し直し、
        // 天体の通り道の傾きから、重なる方位がどれだけ動くかを見積もる
        const eLine = p0.elevationM + ((p1.elevationM ?? p0.elevationM) - p0.elevationM) * f;
        const g0 = p0.groundM ?? p0.elevationM, g1 = p1.groundM ?? p1.elevationM;
        const eRaw = g0 + (g1 - g0) * f;
        const eP = (place.shape === "point" && Number.isFinite(place.elevationM) ? place.elevationM : eRaw)
          + (place.deckM || 0);
        let shift = 0;
        if (Number.isFinite(topM) && pathSlope) {
          const dAlpha = targetAngle(D, eP + eye, topM) - targetAngle(D, eLine + eye, topM);
          shift = dAlpha / pathSlope;
        }
        const lateralM = Math.abs(Math.sin(azDiff(pb, lb + shift) * DEG)) * D * 1000;
        // 重なって見える幅（天体の直径ぶんの高度差を、通り道の傾きで方位に直す）＋見積もりの余裕
        const bandM = D * 1000 * ((extended(body) ? 0.5 + 2 * radius : 2 * radius) / Math.max(0.2, Math.abs(pathSlope))) * DEG;
        // 頂が輪なら、その幅（中心から縁まで 450m）と剣ヶ峰からのずれ（360m）ぶん広く拾う
        const plateauM = target.rim ? 850 : 0;
        if (lateralM > (place.reachM || 0) + bandM + plateauM + 150 + 0.004 * D * 1000) continue;
        const approxAt = p0.at + (p1.at - p0.at) * f;
        jobs.push(async () => {
          const hit = await standOn(place, l, target, body, approxAt, opts, elevationAt);
          // 線の届く範囲に立ち、選んだ合わせ方どおりに重なる地点だけ。
          return hit && hit.rank && Math.abs(hit.gap) <= (hit.radius === 0 ? 1e-5 : LIMB_FIT * hit.radius)
            && hit.distanceKm >= minKm * 0.98 && hit.distanceKm <= maxKm * 1.02 ? { place, side: l.side, ...hit } : null;
        });
      }
    }
    // 標高APIの上限と同じ6地点まで。1地点ずつ待つと数百の地点で数分掛かる。
    // 応答順に依存せず、入力順で返す。
    const out = new Array(jobs.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(6, jobs.length) }, async () => {
      while (next < jobs.length) { const i = next++; out[i] = await jobs[i](); }
    }));
    return out.filter(Boolean);
  }

  /// 場所の中で立つ位置を決め、そこでの重なり方を返す
  async function standOn(place, l, target, body, approxAt, opts, elevationAt) {
    const eyeM = (opts.eyeM ?? 1.5) + (place.deckM || 0);
    const at = async (pt, fixedElev = null) => {
      const e = fixedElev !== null ? fixedElev
        : (elevationAt ? await elevationAt(pt.latitude, pt.longitude) : 0);
      if (!Number.isFinite(e)) return null;
      const obs = { latitude: pt.latitude, longitude: pt.longitude, elevation: Number.isFinite(e) ? e : 0 };
      const c = crossingNear(obs, target, body, approxAt, { ...opts, eyeM });
      return c ? { ...c, stand: { latitude: pt.latitude, longitude: pt.longitude, elevationM: obs.elevation } } : null;
    };
    const shape = place.shape || "point";
    if (shape === "point") {
      return at({ latitude: place.latitude, longitude: place.longitude },
        !opts.requireFreshElevation && Number.isFinite(place.elevationM) ? place.elevationM : null);
    }
    const geom = placeGeometry(place);
    if (geom.length < 2) return null;
    const F = localFrame(place.latitude, place.longitude);
    const g = geom.map(([la, lo]) => F.xy(la, lo));
    const L = l.points.map((p) => F.xy(p.latitude, p.longitude));
    if (shape === "line") {
      // 橋の上で、線と交わる点。交わらなければ、線に一番近い点
      let start = null;
      for (let j = 0; j + 1 < g.length && !start; j++) {
        for (let k = 0; k + 1 < L.length; k++) {
          const c = segmentCross(g[j], g[j + 1], L[k], L[k + 1]);
          if (c) { start = { j, t: c.t }; break; }
        }
      }
      if (!start) {
        let best = null;
        for (let j = 0; j + 1 < g.length; j++) {
          for (const q of L) {
            const n = nearestOnSegment(q, g[j], g[j + 1]);
            if (!best || n.d < best.d) best = { j, t: n.t, d: n.d };
          }
        }
        start = best;
      }
      // 橋を1本の道のりとして、端から端まで s∈[0,1] で読む
      const seg = [];
      let total = 0;
      for (let j = 0; j + 1 < g.length; j++) {
        const len = Math.hypot(g[j + 1][0] - g[j][0], g[j + 1][1] - g[j][1]);
        seg.push({ j, from: total, len }); total += len;
      }
      const posAt = (s) => {
        const d = s * total;
        const sg = seg.find((x) => d <= x.from + x.len) || seg[seg.length - 1];
        const t = sg.len ? (d - sg.from) / sg.len : 0;
        const a = g[sg.j], b = g[sg.j + 1];
        return F.ll(a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t);
      };
      const s0 = total ? (seg[start.j].from + start.t * seg[start.j].len) / total : 0;
      // 橋の上は川面から高いので、標高は交点で1回だけ読む（橋の上の標高タイルは水面のことが多い）
      const p0 = posAt(s0);
      const e0 = elevationAt ? await elevationAt(p0.latitude, p0.longitude) : 0;
      if (!Number.isFinite(e0)) return null;
      const elev = e0 + (place.bridgeM ?? 0);
      let c0 = await at(p0, elev);
      if (!c0) return null;
      if (Math.abs(c0.gap) <= LIMB_EXACT * c0.radius) return c0;
      // 重なる側へ、橋の上を挟み撃ちで詰める
      const ends = [await at(posAt(0), elev), await at(posAt(1), elev)];
      let lo = null, hi = null;
      for (const [s, c] of [[0, ends[0]], [1, ends[1]]]) {
        if (c && Math.sign(c.gap) !== Math.sign(c0.gap)) { lo = { s: s0, c: c0 }; hi = { s, c }; break; }
      }
      if (!lo) {
        const cands = [c0, ...ends].filter(Boolean).sort((x, y) => Math.abs(x.gap) - Math.abs(y.gap));
        return cands[0];
      }
      for (let k = 0; k < 12; k++) {
        const s = lo.s + (hi.s - lo.s) * (lo.c.gap / (lo.c.gap - hi.c.gap));
        const c = await at(posAt(s), elev);
        if (!c) break;
        if (Math.abs(c.gap) <= LIMB_EXACT * c.radius) return c;
        if (Math.sign(c.gap) === Math.sign(lo.c.gap)) lo = { s, c }; else hi = { s, c };
      }
      return Math.abs(lo.c.gap) < Math.abs(hi.c.gap) ? lo.c : hi.c;
    }
    // 面: 線が面の中を通る区間を探し、その中ほどに立つ
    const ring = g;
    let inside = null;
    for (let k = 0; k + 1 < L.length; k++) {
      const hits = [];
      for (let j = 0; j < ring.length; j++) {
        const c = segmentCross(L[k], L[k + 1], ring[j], ring[(j + 1) % ring.length]);
        if (c) hits.push(c.t);
      }
      const a = insidePolygon(L[k], ring), b = insidePolygon(L[k + 1], ring);
      if (a) hits.push(0);
      if (b) hits.push(1);
      if (hits.length >= 2) {
        hits.sort((x, y) => x - y);
        const t = (hits[0] + hits[hits.length - 1]) / 2;
        inside = [L[k][0] + (L[k + 1][0] - L[k][0]) * t, L[k][1] + (L[k + 1][1] - L[k][1]) * t];
        break;
      }
    }
    if (!inside) {
      // 線は面を通らない。面の中で線に一番近い点から始める（標高のずれで本当の線が通ることがある）
      let best = null;
      for (let j = 0; j < ring.length; j++) {
        for (let k = 0; k + 1 < L.length; k++) {
          const n = nearestOnSegment(ring[j], L[k], L[k + 1]);
          if (!best || n.d < best.d) best = { d: n.d, p: ring[j] };
        }
      }
      if (!best) return null;
      inside = best.p;
    }
    let c = await at(F.ll(inside[0], inside[1]));
    if (!c || !c.slope || Math.abs(c.gap) <= LIMB_EXACT * c.radius) return c;
    // 横へ1歩ずつ。天体の通り道の傾きから、ずれ（gap）を消す方位の差を出して、目標のまわりに回す。
    // 中心に入った所で止めず、選んだ縁が先端に触れるまで詰める（それまで半径の半分ずれたまま止めていた。Codex の点検で指摘）
    for (let k = 0; k < 6; k++) {
      const moved = rotateAround(target, c.stand, -c.gap / c.slope);
      if (!insidePolygon(F.xy(moved.latitude, moved.longitude), ring)) break;
      const c2 = await at(moved);
      if (!c2 || Math.abs(c2.gap) >= Math.abs(c.gap)) break;
      c = c2;
      if (Math.abs(c.gap) <= LIMB_EXACT * c.radius) break;
    }
    return c;
  }

  /**
   * 目標の先端まで、地形で見通せるか（建物は見ない）。
   * `elevations(points)` は標高をまとめて返す関数（画面では標高タイル）。
   * 山のすぐ手前だけは目標自身の山腹として除外する。塔は直前まで読む。
   */
  async function lineOfSight(observer, target, opts = {}) {
    target=partTarget(target,opts.partId);
    const g = geometryFrom(observer, target, opts);
    if (!g || !opts.elevations) return null;
    const eye = (observer.elevation ?? 0) + (opts.eyeM ?? 1.5);
    const bearingTo = TR.bearing(observer.latitude, observer.longitude, target.latitude, target.longitude);
    const endSkipKm = opts.endSkipKm ?? (target.kind === "mountain" || target.id === "fuji" ? 1 : 0.01);
    const endKm = g.distanceKm - endSkipKm;
    if (!(endKm > 0.01)) return null;
    // 近距離DEMは1m/5mが使える。300mを空けると土手・切通しを見落とす。
    // 10m〜1kmは10m、1〜5kmは50m、以遠は200m。遠方の範囲も頭打ちにしない。
    const dists = [];
    for (let d = 0.01; d < endKm;) {
      dists.push(d);
      d += d < 1 ? 0.01 : d < 5 ? 0.05 : 0.2;
    }
    dists.push(endKm);
    const pts = dists.map((d) => TR.destination(observer.latitude, observer.longitude, bearingTo, d));
    const elevs = await opts.elevations(pts);
    // 欠けた升目を空と扱うと、そこにある尾根を無視して clear になる。
    if (!Array.isArray(elevs) || elevs.length !== pts.length || Array.from(elevs).some((e) => !Number.isFinite(e))) return null;
    let worst = -90, at = null;
    dists.forEach((d, i) => {
      const e = elevs[i];
      if (!Number.isFinite(e)) return;
      const a = targetAngle(d, eye, e);
      if (a > worst) { worst = a; at = d; }
    });
    const sightAngle = Number.isFinite(opts.maxAngleDeg) ? Math.min(g.angle, opts.maxAngleDeg) : g.angle;
    return { clear: worst < sightAngle - 0.02, marginDeg: sightAngle - worst, blockKm: at };
  }

  /**
   * 目標の方向に、建物が立ちふさがるか（塔の候補地で使う。2026-09-30）。
   * `buildings` は [{ ring: [[緯度, 経度], …], heightM }]（外周と高さ）か、[{ latitude, longitude, radiusM, heightM }]（円）。
   * 立つ位置から目標へ向かう直線が
   * 建物の外周に入る距離を出し、その距離で建物の屋上を見上げる角度と、目標の先端の見上げ角を比べる。
   * **建物の地面は立つ位置と同じとみなす**（街の中の数百m。`urbanHorizon` と同じ前提）。
   * @param {number} eyeAboveGroundM 地面から目までの高さ（橋や土手、展望台の高さを含む）
   */
  function buildingBlock(observer, target, buildings, { partId = null, eyeAboveGroundM = 1.5, maxKm = 1.5 } = {}) {
    target=partTarget(target,partId);
    const g = geometryFrom(observer, target, { partId, eyeM: 1.5 });
    if (!g) return null;
    const F = localFrame(observer.latitude, observer.longitude);
    const brg = TR.bearing(observer.latitude, observer.longitude, target.latitude, target.longitude) * DEG;
    const ux = Math.sin(brg), uy = Math.cos(brg);
    const L = Math.min(maxKm, g.distanceKm - 0.3) * 1000;
    let worst = -90, by = null;
    for (const b of buildings || []) {
      if (!Number.isFinite(b.heightM)) continue;
      // **円で持った建物**（同梱の高い建物。中心・半径）。直線が円に入る距離
      if (!b.ring && Number.isFinite(b.radiusM)) {
        const [cx, cy] = F.xy(b.latitude, b.longitude);
        const along = cx * ux + cy * uy;
        if (along < -b.radiusM || along > L + b.radiusM) continue;
        const perp = Math.abs(cx * uy - cy * ux);
        if (perp > b.radiusM) continue;
        const t = along - Math.sqrt(b.radiusM * b.radiusM - perp * perp);
        if (t < 5 || t > L) continue;                 // 自分が中にいる・目標より先
        const a = Math.atan2(b.heightM - eyeAboveGroundM, t) / DEG;
        if (a > worst) { worst = a; by = { distanceM: Math.round(t), heightM: b.heightM }; }
        continue;
      }
      if (!b.ring || b.ring.length < 3) continue;
      const pts = b.ring.map(([la, lo]) => F.xy(la, lo));
      let entry = null;
      for (let i = 0; i < pts.length; i++) {
        const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
        // 直線 (t*ux, t*uy) と辺の交点
        const ex = x2 - x1, ey = y2 - y1;
        const den = ux * ey - uy * ex;
        if (Math.abs(den) < 1e-9) continue;
        const t = (x1 * ey - y1 * ex) / den;
        const u = (x1 * uy - y1 * ux) / den;
        if (u < 0 || u > 1 || t < 5 || t > L) continue;
        if (entry === null || t < entry) entry = t;
      }
      if (entry === null) continue;
      const a = Math.atan2(b.heightM - eyeAboveGroundM, entry) / DEG;
      if (a > worst) { worst = a; by = { distanceM: Math.round(entry), heightM: b.heightM }; }
    }
    return { blocked: worst > g.angle, marginDeg: g.angle - worst, by };
  }

  // ---------------------------------------------------------------- 見え方の図（2026-10-02）
  //
  // 「その日、その場所から目標物を見たとき、太陽・月がどう動いて重なるか」の図の計算（描くのは画面側）。
  // ユーザー「その目標物に対して月、太陽がどのような軌道で動くのかを見たい」。全周の展開図（空の見え方）は
  // 地平線のあたりが潰れて使えなかったので、目標のまわり数度だけを拡大する。Codex と相談して、
  // 方位と高さをそのまま並べず、目標を中心に**見かけの角度を保つ**心射図法で写す。

  const R = Math.PI / 180;
  const unit = (az, alt) => [Math.cos(alt * R) * Math.sin(az * R), Math.cos(alt * R) * Math.cos(az * R), Math.sin(alt * R)];
  const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  /**
   * 方位・高さ → 図の座標（度。右が方位の増える向き、上が高い向き）。中心から90度以上離れた所は null。
   * 中心の右向き e は方位が増える向き、上向き n は e × 中心
   */
  function viewProjector(az0, alt0) {
    const c = unit(az0, alt0);
    const e = [Math.cos(az0 * R), -Math.sin(az0 * R), 0];
    const n = [e[1] * c[2] - e[2] * c[1], e[2] * c[0] - e[0] * c[2], e[0] * c[1] - e[1] * c[0]];
    return (az, alt) => {
      const v = unit(az, alt), d = dot3(v, c);
      if (d <= 1e-6) return null;
      return [dot3(v, e) / d / R, dot3(v, n) / d / R];
    };
  }

  /**
   * よく使う4つの目標の形（2026-10-02 ユーザー「頻度高いししっかり形は作り込んで欲しい」）。`outline` は [横m, 地上の高さm] を左から右へ
   * （ティンカーベルは `fromTop` で [横m, 先端から下へm]）。ユーザーのシルエットと写真から作り、**大きさは写真の実測**に合わせた
   * （ユーザー「観測地点からの月とシルエットの比率が合うようになってれば」）。見る向きで少し変わる
   */
  const TOWER_SHAPES = {
    // 634m。2026-10-02 ユーザーがくれた**スカイツリーのシルエット**をそのまま使い、大きさは写真の実測に合わせた
    // （ユーザー「観測地点からの月とシルエットの比率が合うようになってれば」）。写真は 35.707668, 139.798313（1,150m、水平に構えた画角）から。
    // 写真の上で先端（海抜636m）と天望デッキの床（352m）の位置から 1px＝0.59m（f＝1952px）を出し、天望回廊（450m）の位置の予測 617px が写真の 612px と合った。
    // シルエットは先端〜足もとを 634m にした同じ縮尺で、天望デッキの幅 62.7m（写真 62.5m）・天望回廊 35.6m（37m）と合う。
    // 高さは写真に合わせて区切りごとに伸び縮みさせた（天望デッキ 344〜382m → 341〜372m、回廊の上 467 → 459m。シルエットは 2〜3% 高かった）。
    // 足もとはシルエットが 81m に広がるので、公表の一辺68m に合うよう地上100m より下だけ横を詰めた。写真に重ねて確かめた
    skytree: { outline: [
      [-34.18, 0], [-32.79, 17.6], [-32.57, 26], [-32.23, 26.4], [-32.41, 29.4], [-31.65, 35.6], [-31.29, 49.5], [-30.72, 53.3],
      [-29.4, 90.2], [-29, 90.6], [-29.22, 95.2], [-28.58, 99.4], [-28.18, 108.2], [-27.76, 108.7], [-26.06, 133.9],
      [-25.64, 134.3], [-24.79, 152.3], [-24.37, 152.8], [-24.37, 158.2], [-23.94, 158.6], [-23.94, 164.1], [-23.52, 164.5],
      [-23.52, 171.2], [-23.1, 171.6], [-23.1, 178.3], [-22.67, 178.7], [-21.83, 200.2], [-21.4, 200.6], [-21.4, 207.3],
      [-20.98, 207.7], [-20.13, 232.9], [-19.71, 233.3], [-19.71, 240.9], [-19.28, 241.3], [-19.28, 249.7], [-18.86, 250.1],
      [-18.44, 270.2], [-18.01, 270.6], [-18.01, 278.2], [-17.59, 278.6], [-18.01, 279], [-17.59, 280.3], [-17.59, 289.5],
      [-17.16, 289.9], [-17.16, 297.9], [-16.74, 298.3], [-16.32, 314.7], [-15.89, 315.2], [-15.89, 320.2], [-18.44, 329],
      [-21.4, 330.7], [-22.25, 334.9], [-23.94, 337.8], [-23.94, 339.9], [-25.64, 342.1], [-26.91, 346.3], [-28.18, 347.7],
      [-32.42, 357.6], [-32.42, 359.7], [-29.88, 362.1], [-30.73, 363.5], [-30.3, 364.2], [-31.15, 365.3], [-31.15, 368.4],
      [-29.03, 370.2], [-25.64, 371.6], [-16.74, 374.1], [-16.32, 374.5], [-16.32, 378.4], [-14.2, 380.1], [-14.2, 386.5],
      [-13.77, 387.9], [-16.32, 388.3], [-17.59, 389.2], [-17.59, 390], [-16.74, 390.9], [-13.77, 391.3], [-13.35, 394],
      [-13.35, 396.5], [-15.04, 397.8], [-14.62, 399.5], [-13.35, 400.4], [-13.35, 402.5], [-15.89, 403.4], [-16.74, 404.2],
      [-16.32, 406], [-14.2, 407.3], [-14.62, 409], [-16.32, 409.4], [-16.32, 412], [-14.2, 413.3], [-14.2, 415],
      [-16.32, 416.3], [-16.32, 418.5], [-13.77, 421.1], [-13.77, 422.7], [-16.32, 423.6], [-16.32, 425.8], [-15.04, 427.1],
      [-12.08, 427.5], [-12.08, 433.1], [-12.93, 434.4], [-12.93, 435.7], [-15.89, 437], [-18.01, 439.2], [-18.86, 440.8],
      [-18.86, 443.1], [-16.74, 445.6], [-18.01, 449], [-18.01, 451.2], [-16.32, 452.9], [-16.32, 456.8], [-12.5, 459.9],
      [-12.5, 462.1], [-10.38, 463.9], [-9.96, 478.2], [-9.54, 478.6], [-9.96, 479], [-9.54, 479.4], [-9.54, 486.6],
      [-9.11, 487], [-9.11, 492.9], [-9.96, 493.3], [-10.38, 495.1], [-7.84, 496.9], [-4.03, 497.7], [-4.03, 503.5],
      [-5.72, 504.8], [-5.72, 520.9], [-6.15, 521.3], [-4.03, 523.6], [-4.03, 532.1], [-5.72, 533.3], [-5.72, 539.6],
      [-4.03, 540.9], [-4.03, 557.4], [-4.87, 557.8], [-5.3, 559.2], [-3.6, 563.6], [-3.6, 568.1], [-4.87, 569.4], [-5.3, 574.7],
      [-2.75, 576.5], [-3.18, 577.9], [-4.03, 578.3], [-4.03, 584.6], [-4.87, 585.4], [-4.87, 587.2], [-1.91, 588.6],
      [-3.18, 589.9], [-3.18, 595.7], [-4.03, 596.6], [-4.03, 598], [-3.18, 598.8], [-1.48, 599.2], [-2.75, 599.7],
      [-2.75, 602.8], [-3.6, 604.2], [-3.6, 615.7], [-5.72, 616.7], [-5.3, 625.5], [-5.72, 627.8], [-7.42, 630.8],
      [-6.15, 632.6], [-3.18, 634], [4.45, 634], [6.99, 633.2], [8.69, 631.8], [8.69, 629.6], [6.99, 627.3], [6.57, 624.6],
      [6.57, 622], [7.42, 621.1], [7.42, 617.1], [4.87, 615.7], [4.87, 603.7], [4.03, 603.3], [4.03, 599.7], [3.18, 599.2],
      [5.3, 598], [5.3, 596.6], [4.45, 595.7], [4.45, 590.4], [4.03, 589.4], [-2.33, 589], [4.87, 588.1], [6.57, 586.8],
      [6.57, 585.4], [5.3, 584.1], [5.3, 578.3], [4.45, 577], [-2.33, 576.5], [4.45, 576.1], [6.57, 574.7], [6.15, 569.4],
      [4.87, 568.1], [4.87, 563.6], [6.57, 559.6], [6.57, 558.3], [5.3, 557.4], [5.3, 540.9], [6.99, 539.6], [6.99, 533.7],
      [7.42, 533.3], [5.3, 532.1], [5.3, 523.6], [6.99, 522.2], [6.99, 504.8], [5.3, 503.5], [5.3, 497.7], [7.84, 497.3],
      [11.65, 495.5], [11.65, 493.7], [10.38, 492.3], [11.65, 464.3], [13.77, 462.1], [13.35, 460.3], [16.74, 458.1],
      [18.01, 456.4], [17.59, 452.9], [19.71, 450.8], [18.44, 445.6], [19.71, 444.3], [20.55, 442.1], [19.71, 440],
      [18.01, 438.3], [15.04, 436.5], [13.35, 432.7], [13.35, 427.1], [17.59, 426.2], [17.59, 423.6], [15.47, 422.7],
      [15.04, 421.1], [16.74, 420.2], [16.74, 419.4], [17.59, 418.9], [17.59, 415.9], [15.47, 415], [15.47, 413.3], [17.59, 412],
      [17.59, 409.8], [15.47, 408.6], [15.47, 407.3], [18.01, 405.5], [18.01, 403.8], [14.62, 402.5], [14.62, 399.5],
      [15.89, 398.2], [14.62, 395.2], [15.04, 394.8], [15.04, 391.3], [18.44, 390.9], [18.86, 388.8], [15.04, 387.5],
      [15.47, 380.1], [17.59, 378.4], [17.59, 374.5], [27.76, 371.6], [30.73, 370.2], [32.42, 368.8], [32.84, 365.6],
      [32, 364.5], [31.57, 361.8], [33.27, 360.7], [34.12, 359.3], [32.42, 354], [27.76, 344.9], [27.76, 343.5], [25.64, 340.3],
      [25.64, 338.6], [24.79, 336.5], [23.52, 334.9], [23.1, 331.5], [22.25, 330.2], [19.71, 329], [18.01, 324], [17.59, 322.3],
      [17.59, 310.5], [18.01, 310.1], [18.01, 299.2], [18.44, 298.7], [18.44, 290.4], [18.86, 289.9], [18.86, 276.9],
      [19.28, 276.5], [19.28, 265.2], [19.71, 264.8], [19.71, 254.3], [20.13, 253.9], [20.13, 245.1], [20.55, 244.7],
      [21.4, 215.3], [21.83, 214.9], [21.83, 205.2], [22.25, 204.8], [22.67, 187.1], [23.1, 186.7], [23.1, 178.7],
      [23.52, 178.3], [23.52, 170.8], [23.94, 170.4], [25.22, 143.5], [25.64, 143.1], [25.64, 138], [26.06, 137.6],
      [26.91, 121.7], [27.33, 121.3], [28.18, 104.1], [28.61, 103.7], [28.82, 95.6], [29.22, 95.2], [28.98, 90.2], [29.38, 89.8],
      [29.19, 86], [29.79, 81.4], [29.58, 77.2], [29.96, 76.8], [29.73, 72.2], [30.29, 67.5], [30.43, 55.3], [30.81, 55],
      [30.6, 51.2], [31.17, 47.4], [30.96, 43.7], [31.32, 43.3], [31.87, 26.8], [32.23, 26.4], [32.46, 18], [32.79, 17.6],
      [32.82, 12.2], [33.82, 0]] },
    // 333m。2026-10-02 ユーザーがくれた**東京タワーのシルエット**をそのまま使い、大きさは写真の実測に合わせた。
    // 写真は真南 424m（35.654769, 139.745427、地面4.7m）から水平に構えたもので、アンテナの先（海抜351m）とメインデッキの屋根（地上131m）の
    // 位置から f＝1856px を出すと、トップデッキの筒は地上225〜252m（公表の床 223.55m）、アンテナの付け根は 258m（約253m）と合った。
    // シルエットは先端〜足もとを 333m にした同じ縮尺で、メインデッキの幅 43m が写真（44m。この向きでは斜めに見える）と合う。
    // 高さは写真に合わせて区切りごとに伸び縮みさせた（メインデッキ 135〜150m → 112〜131m、上の筒の上 266 → 258m）。写真に重ねて確かめた。
    // 足もとの幅（135m）は塔脚の間隔 88m を斜めに見た幅（124m）に脚の太さを足した程度で、真南から見た形
    tokyotower: { outline: [
      [-68.38, 0], [-68.14, 0.6], [-66.92, 0.8], [-66.92, 1.6], [-65.45, 1.8], [-65.45, 3.8], [-62.29, 4], [-61.8, 4.6],
      [-62.04, 5.2], [-61.55, 5.7], [-60.33, 5.9], [-48.63, 21], [-46.93, 23.6], [-45.46, 25.2], [-40.1, 32.9], [-36.69, 38.5],
      [-36.2, 38.9], [-30.59, 49.2], [-28.89, 53.3], [-27.91, 54.9], [-27.18, 57.1], [-26.69, 57.7], [-23.28, 66.6],
      [-23.28, 67.2], [-22.55, 68.6], [-22.06, 70.8], [-21.57, 71.6], [-20.11, 76.5], [-19.14, 81.1], [-18.65, 82.1],
      [-18.16, 85.4], [-17.43, 87.6], [-17.43, 88.6], [-17.19, 88.8], [-17.19, 90], [-16.7, 91.2], [-16.21, 95.7],
      [-15.72, 97.3], [-15.72, 98.7], [-15.48, 98.9], [-15.48, 100.3], [-15.24, 100.5], [-15.24, 102.5], [-16.7, 103.3],
      [-16.7, 104.9], [-15.24, 105.3], [-15.48, 106.5], [-16.45, 107], [-16.45, 107.8], [-15.48, 108.4], [-15.48, 110.2],
      [-15.97, 111.4], [-18.41, 111.8], [-19.62, 113], [-21.09, 126.8], [-21.33, 128.1], [-22.06, 129], [-21.09, 130],
      [-19.87, 130.3], [-19.62, 131], [-17.92, 131.5], [-18.16, 131.8], [-17.92, 134.7], [-13.77, 135], [-14.99, 135.8],
      [-14.75, 136], [-14.75, 137.9], [-14.02, 138.2], [-14.26, 139.2], [-14.02, 140.8], [-12.07, 141.4], [-12.07, 142.4],
      [-11.82, 142.7], [-11.82, 145.6], [-12.31, 146.2], [-12.55, 147.5], [-12.07, 148], [-12.07, 149.1], [-11.34, 149.9],
      [-11.09, 150.7], [-10.85, 156], [-13.04, 156.3], [-13.29, 156.5], [-13.53, 157.3], [-13.53, 160.5], [-12.8, 161.6],
      [-10.36, 161.9], [-10.12, 165.3], [-9.87, 165.6], [-9.87, 166.1], [-12.55, 166.4], [-12.8, 166.9], [-12.8, 171.2],
      [-12.31, 172.5], [-9.63, 172.8], [-9.39, 173], [-9.39, 176], [-10.12, 176.2], [-10.12, 177.6], [-12.07, 178.1],
      [-12.07, 181], [-11.34, 181.6], [-8.9, 181.8], [-8.65, 182.9], [-8.65, 186.1], [-9.39, 186.3], [-9.39, 187.1],
      [-9.87, 187.4], [-9.87, 188.5], [-9.63, 188.7], [-9.63, 190.1], [-8.17, 191.1], [-7.92, 195.4], [-7.68, 195.7],
      [-7.68, 196.7], [-8.17, 197.3], [-8.17, 197.8], [-7.68, 198.3], [-7.68, 198.9], [-10.12, 199.1], [-10.36, 199.4],
      [-10.6, 202.6], [-10.12, 203.9], [-7.19, 204.2], [-6.7, 213], [-7.68, 213.5], [-7.68, 214], [-6.46, 214.8], [-6.46, 216.7],
      [-6.22, 217], [-6.22, 218.3], [-6.95, 219.4], [-6.95, 221.5], [-6.46, 222.6], [-7.92, 223.4], [-8.9, 224.9], [-8.9, 226.3],
      [-8.41, 227.3], [-6.95, 228.7], [-6.95, 229.7], [-7.44, 230.3], [-7.44, 231.3], [-8.17, 232.4], [-8.17, 232.9],
      [-7.68, 233.7], [-6.95, 234], [-6.95, 235.6], [-8.17, 235.9], [-8.9, 236.7], [-7.68, 237.5], [-7.44, 238], [-7.68, 238.5],
      [-7.68, 240.4], [-7.44, 240.7], [-7.44, 241.7], [-6.95, 242.3], [-6.7, 243.3], [-7.44, 244.4], [-7.44, 249.4],
      [-6.95, 250.2], [-6.7, 255], [-5.24, 256.6], [-3.53, 259.3], [-3.53, 259.6], [-4.27, 259.9], [-4.27, 260.4], [-3.53, 261],
      [-3.78, 263.7], [-3.53, 264], [-3.53, 267.5], [-3.29, 267.8], [-3.29, 275.1], [-3.05, 275.4], [-3.29, 278.4], [-2.8, 279],
      [-2.8, 282.2], [-3.05, 283.1], [-2.8, 283.3], [-2.8, 290.7], [-2.56, 291], [-2.56, 292.6], [-3.05, 293.2], [-3.05, 294],
      [-2.8, 294.3], [-2.8, 296.7], [-2.32, 297.3], [-2.32, 300.3], [-2.8, 302.4], [-2.32, 303], [-2.07, 304.1], [-2.8, 305.4],
      [-2.8, 308.7], [-2.56, 309], [-2.56, 312.5], [-2.8, 313.6], [-0.61, 315.3], [-0.61, 328.9], [-0.37, 330], [-1.1, 330.8],
      [-1.34, 331.6], [-1.1, 332.5], [-0.37, 333], [0.37, 333], [1.34, 332.2], [1.34, 331.1], [0.61, 330.3], [0.61, 328.9],
      [0.85, 328.6], [0.85, 315.3], [3.05, 313.6], [2.8, 312.5], [3.05, 305.7], [2.56, 304.9], [2.56, 303.3], [2.8, 303],
      [2.8, 301.1], [3.05, 300.5], [2.56, 300], [2.56, 297], [3.29, 295.9], [3.29, 293.4], [2.8, 292.9], [2.8, 290.7],
      [3.05, 290.4], [3.05, 283.3], [3.29, 283.1], [3.05, 282.5], [3.29, 281.2], [3.05, 280.9], [3.29, 280.6], [3.29, 278.7],
      [3.53, 278.4], [3.29, 277.1], [3.53, 276.8], [3.53, 271.6], [3.78, 271.3], [3.53, 271.1], [3.53, 269.1], [4.02, 267],
      [3.78, 266.4], [3.78, 264], [4.02, 263.7], [4.02, 261], [5.73, 259.9], [5.73, 259.3], [4.02, 259], [4.02, 258.2],
      [4.75, 256.9], [6.22, 256.1], [6.95, 255], [6.95, 253.7], [7.19, 253.4], [7.19, 251.3], [6.95, 251], [7.19, 250.8],
      [6.95, 250.5], [7.68, 249.4], [7.68, 244.4], [6.7, 243.3], [6.7, 240.9], [7.92, 240.7], [8.41, 240.1], [8.41, 237.7],
      [7.92, 236.9], [6.7, 236.7], [6.7, 236.1], [8.9, 235.9], [9.14, 235.3], [9.14, 234.8], [7.92, 234], [8.65, 233.2],
      [8.65, 232.4], [7.68, 231.6], [7.92, 231.3], [7.92, 230], [7.44, 229.5], [7.44, 228.7], [9.14, 227.1], [9.63, 225.5],
      [9.39, 224.4], [8.41, 223.4], [6.95, 222.6], [7.44, 221.8], [7.44, 219.4], [6.7, 218.3], [6.7, 217.2], [6.95, 217],
      [6.95, 215.6], [7.68, 215.1], [7.68, 214.3], [8.17, 213.8], [7.92, 213.2], [7.19, 213], [7.19, 209.2], [7.44, 209],
      [7.68, 204.2], [10.6, 203.9], [11.09, 202.6], [10.85, 199.7], [10.36, 199.1], [7.92, 198.9], [8.17, 198.1], [8.65, 197.8],
      [8.65, 197.3], [8.17, 196.7], [8.65, 190.9], [9.87, 190.1], [9.87, 188.7], [10.36, 188.2], [10.36, 187.7], [9.63, 186.9],
      [9.63, 186.3], [8.9, 185.8], [8.9, 185.3], [9.14, 185], [9.14, 182.4], [9.39, 181.8], [12.07, 181.6], [12.55, 180.8],
      [12.55, 180.2], [11.82, 180], [12.55, 179.7], [12.55, 178.6], [12.07, 178.1], [12.55, 177.3], [12.55, 176.5], [11.58, 176],
      [9.87, 175.7], [9.87, 172.8], [12.31, 172.5], [12.8, 172], [12.8, 167.7], [13.04, 166.6], [10.6, 165.6], [10.6, 162.4],
      [14.02, 162.1], [14.5, 161.6], [14.99, 160.3], [14.99, 157.6], [14.26, 155.7], [14.02, 155.5], [11.34, 155.2],
      [11.58, 151.2], [13.77, 150.9], [14.02, 150.7], [14.02, 146.7], [12.55, 146.4], [12.07, 145.6], [12.07, 144.8],
      [12.31, 144.6], [12.55, 139.2], [13.77, 139], [13.77, 138.4], [14.75, 137.9], [14.99, 135.5], [13.04, 134.7],
      [13.04, 133.6], [13.77, 133.4], [14.99, 132], [20.11, 130.7], [20.6, 130], [21.82, 129.4], [21.82, 128.4], [21.33, 128.1],
      [20.84, 125.5], [20.84, 123.6], [20.6, 123.3], [20.6, 121.6], [20.36, 121.3], [19.38, 112.6], [18.16, 111.8],
      [15.97, 111.2], [14.99, 108.8], [14.99, 108.4], [15.97, 108.2], [16.7, 107.4], [16.21, 106.8], [15.24, 106.3],
      [15.24, 105.3], [16.7, 104.9], [16.7, 103.1], [15.24, 102.5], [15.24, 101.1], [15.48, 100.9], [16.7, 92.4], [17.19, 91],
      [17.19, 89.8], [17.43, 89.6], [17.43, 88.4], [18.16, 86.2], [18.41, 83.9], [18.89, 82.7], [18.89, 81.7], [19.14, 81.5],
      [19.87, 77.7], [20.36, 76.7], [20.36, 75.7], [21.82, 70.8], [22.31, 70], [22.79, 67.6], [23.52, 66.2], [24.01, 64],
      [26.21, 58.7], [26.21, 58.1], [29.38, 50.7], [30.59, 48.6], [32.3, 44.8], [34.74, 40.8], [34.74, 40.4], [42.78, 27.6],
      [58.38, 5.9], [59.6, 5.2], [60.09, 4.2], [60.58, 3.8], [63.99, 3.6], [63.99, 1.8], [65.7, 1.4], [65.7, 0.8], [66.67, 0.6],
      [66.92, 0]] },
    // 51m。ユーザーがくれた**城のシルエット**（同じ向きの写真から描き起こした絵）を**そのまま**使い、尖塔の先を 51m・絵の下の端を地面にそろえた
    // （1px＝3.8cm。幅 30m）。2026-10-02 は写真の実測（主塔のバルコニーの幅）に合わせたが、絵は写真で木に隠れた高さを地面として描いているので、
    // 下の端が地上18m に来て、城らしい下の段（角の小塔・城壁）が地面に隠れ「形へんてこりん」になった（2026-10-03 ユーザー）。
    // 全体の高さ・幅と月の比は合う（ユーザー「観測地点からの月とシルエットの比率が合うようになってれば」）。尖塔どうしの高さは写真と数m 違う。西北西から見た形
    cinderella: { referenceView: {
      observer: { latitude: 35.6394512, longitude: 139.8405504, elevation: 2, eyeM: 1.5 },
      inferredObserver: { ...TR.destination(targetById("cinderella").latitude, targetById("cinderella").longitude, 284.99, 2.85), elevation: 2, eyeM: 1.5 },
      photoAt: "2024-08-20T19:02:04+09:00", source: "user-estimated", description: "ユーザー申告の撮影地点候補。過去の月位置による逆算地点は別に保持（実測未確認）"
    }, outline: [
      [-12.58, 0], [-12.58, 4.45], [-12.23, 4.49], [-12.19, 4.14], [-12.04, 4.14], [-12, 4.26], [-11.96, 6.98], [-11.54, 7.44],
      [-11.16, 8.36], [-10.55, 11.62], [-10.55, 13.42], [-10.43, 13.46], [-10.39, 14.15], [-10.2, 14.11], [-10.2, 13.46],
      [-10.08, 13.46], [-10.08, 11.58], [-9.62, 8.78], [-9.39, 7.86], [-9.01, 7.13], [-8.9, 7.06], [-8.9, 7.75], [-8.82, 7.78],
      [-8.44, 9.2], [-8.44, 10.51], [-8.32, 10.51], [-8.28, 11.01], [-8.17, 10.97], [-8.17, 10.51], [-8.05, 10.51],
      [-8.01, 9.16], [-7.9, 8.9], [-7.9, 17.06], [-7.75, 17.22], [-7.52, 17.75], [-6.9, 20.28], [-6.83, 20.67], [-6.83, 22.28],
      [-6.67, 22.28], [-6.67, 22.85], [-6.52, 22.82], [-6.52, 22.32], [-6.37, 22.28], [-6.37, 20.44], [-6.02, 18.67],
      [-5.68, 17.49], [-5.41, 17.03], [-5.41, 15.91], [-5.1, 15.91], [-5.06, 19.75], [-4.91, 20.02], [-4.72, 20.78],
      [-4.64, 22.01], [-4.49, 22.05], [-4.45, 22.24], [-4.45, 23.51], [-4.37, 23.51], [-4.37, 24], [-4.26, 24], [-4.26, 23.51],
      [-4.14, 23.51], [-4.14, 22.16], [-4.1, 22.05], [-3.99, 22.01], [-3.95, 21.05], [-3.83, 20.67], [-3.41, 23.7], [-3.41, 26],
      [-3.3, 26.08], [-3.3, 28.18], [-3.22, 28.15], [-3.22, 28.41], [-3.07, 28.38], [-3.03, 28.18], [-2.99, 26.08],
      [-2.88, 26.04], [-2.88, 31.94], [-2.53, 32.1], [-2.15, 32.13], [-2.07, 32.63], [-1.76, 32.75], [-1.76, 34.01],
      [-1.61, 34.09], [-1.61, 35.97], [-1.5, 37.12], [-1.42, 37.16], [-1.38, 37.08], [-1.27, 35.24], [-1.15, 35.28],
      [-1.15, 36.24], [-1.07, 36.28], [-1.07, 37.16], [-1, 37.2], [-0.88, 39.84], [-0.81, 39.88], [-0.81, 40.72], [-0.69, 40.8],
      [-0.69, 41.72], [-0.61, 41.72], [-0.61, 42.6], [-0.54, 42.64], [-0.5, 50.12], [-0.38, 50.12], [-0.38, 50.54],
      [-0.08, 50.58], [-0.08, 50.96], [0.04, 51], [0.12, 50.12], [0.31, 50.12], [0.31, 44.52], [0.42, 44.48], [0.42, 43.56],
      [0.5, 43.52], [0.58, 41.72], [0.65, 41.72], [0.73, 39.88], [0.84, 39.84], [0.88, 38.08], [0.96, 38.08], [1.04, 38.92],
      [1.11, 38.88], [1.15, 37.31], [1.27, 37.16], [1.27, 36.28], [1.38, 36.24], [1.38, 35.24], [1.53, 35.24], [1.61, 36.7],
      [1.69, 36.77], [1.69, 37.16], [1.76, 37.12], [1.88, 35.93], [1.88, 34.09], [2.03, 34.01], [2.03, 32.71], [2.15, 32.67],
      [2.15, 32.17], [2.65, 32.1], [2.99, 31.9], [2.99, 27.07], [3.22, 27.99], [3.22, 29.64], [3.26, 30.18], [3.41, 30.18],
      [3.41, 30.95], [3.53, 30.91], [3.53, 30.18], [3.68, 30.18], [3.72, 29.1], [3.76, 29.26], [3.87, 29.22], [3.87, 29.07],
      [4.03, 29.1], [4.03, 29.26], [4.14, 29.26], [4.14, 29.07], [4.22, 29.07], [4.26, 29.22], [4.33, 29.07], [4.41, 29.07],
      [4.45, 29.26], [4.52, 29.26], [4.52, 29.07], [4.64, 29.07], [4.68, 29.26], [4.75, 29.26], [4.79, 29.07], [4.91, 29.07],
      [4.95, 29.26], [5.02, 29.26], [5.06, 29.1], [5.06, 29.6], [5.14, 29.64], [5.18, 31.75], [5.25, 31.75], [5.25, 31.9],
      [5.37, 31.9], [5.41, 31.18], [5.48, 31.18], [5.48, 29.64], [5.6, 29.6], [5.6, 27.53], [5.75, 26.61], [5.75, 27.69],
      [6.02, 27.92], [6.25, 28.34], [6.48, 29.83], [6.48, 37.23], [7.09, 37.35], [7.09, 37.46], [7.21, 37.43], [7.21, 35.82],
      [7.25, 35.55], [7.4, 35.55], [7.4, 33.21], [7.9, 29.07], [8.09, 28.18], [8.44, 27.76], [8.55, 27.72], [8.55, 17.64],
      [8.78, 17.64], [8.78, 20.82], [8.97, 21.21], [9.05, 21.7], [9.2, 24.39], [9.2, 26.84], [9.32, 26.84], [9.32, 27.38],
      [9.47, 27.42], [9.51, 26.84], [9.62, 26.84], [9.66, 26.77], [9.66, 24.12], [9.89, 21.36], [9.89, 24.27], [10.28, 26.04],
      [10.89, 29.91], [10.97, 30.52], [10.97, 32.71], [11.12, 32.67], [11.12, 33.21], [11.24, 33.25], [11.24, 32.79],
      [11.27, 32.71], [11.43, 32.71], [11.43, 30.02], [11.89, 25.77], [11.93, 26.84], [12.08, 26.84], [12.08, 27.38],
      [12.23, 27.38], [12.23, 26.84], [12.39, 26.84], [12.39, 24.69], [12.5, 24.12], [12.5, 20.4], [12.73, 20.4], [12.73, 19.86],
      [13, 19.86], [13, 14.72], [13.19, 15.38], [13.19, 15.99], [13.31, 15.99], [13.38, 15.03], [13.69, 14.26], [13.69, 12.16],
      [13.8, 12.16], [13.8, 7.59], [14.23, 9.2], [14.34, 11.35], [14.38, 11.43], [14.49, 11.43], [14.53, 10.81], [14.65, 10.81],
      [14.65, 9.39], [15.22, 6.98], [15.61, 5.91], [15.61, 4.98], [15.65, 5.94], [15.76, 5.98], [15.76, 6.44], [15.91, 6.48],
      [15.91, 5.94], [16.03, 5.94], [16.07, 4.83], [16.45, 3.99], [16.53, 3.87], [16.68, 3.87], [16.68, 3.53], [16.95, 3.53],
      [16.95, 3.91], [17.52, 3.91], [17.52, 0]] },
    // 東京ディズニーランドホテルの屋根のドームと、その上のティンカーベル（杖の先が先端）。[横m, 先端から下へm] で持つ
    // （高さを直しても形が崩れないように）。2026-10-03 ユーザーのシルエット（ドーム・左右の小塔・手すりまで。ユーザー「ティンカーベルは
    // もっと大きくできる？撮影場所はほぼ同じでこんな感じのシルエットを用意した」）をそのまま使い、縮尺はユーザーの写真
    // （2024-11-29 04:52:23・700mm。撮影地は月の位置から逆算して葛西臨海公園の 694m 先）の月の直径を物差しに、像の下の玉と屋根の手すりで
    // 合わせた（絵の 59.5px＝1m。像と手すりは写真と合い、ドームは写真より2割ほど細い）。横はドームの軸から（杖の先が写真と同じ軸の 0.3m 左になるようにずらした）。
    // 見え方の図は先端から14m（絵の下の端の屋根）まで。そこから下はホテルの幅で埋める
    tinkerbell: { referenceView: {
      observer: { latitude: 35.6397478, longitude: 139.8711648, elevation: 2.8, eyeM: 1.5 },
      photoAt: "2024-11-29T04:52:23+09:00", source: "photo-inferred", description: "写真の月の位置から逆算した参照地点（GPS実測ではない）"
    }, fromTop: true, hitFromTopM: 2.5, roofHalf: 60, viewFromTopM: 14, outline: [
      [-12.434, 13.95], [-12.333, 13.933], [-12.333, 13.815], [-12.149, 13.681], [-12.233, 13.58], [-12.233, 13.496],
      [-12.132, 13.378], [-12.031, 13.378], [-11.947, 13.445], [-11.93, 13.58], [-12.014, 13.681], [-11.829, 13.866],
      [-11.107, 13.731], [-11.073, 13.697], [-11.123, 13.664], [-11.123, 13.613], [-11.073, 13.563], [-11.073, 13.496],
      [-11.006, 13.445], [-10.955, 12.908], [-10.955, 12.79], [-11.039, 12.672], [-10.955, 12.639], [-10.821, 12.319],
      [-10.586, 12.134], [-10.619, 12.05], [-10.434, 11.882], [-10.602, 11.748], [-10.602, 11.681], [-10.401, 11.479],
      [-10.468, 11.395], [-10.35, 10.891], [-10.249, 11.395], [-10.3, 11.496], [-10.098, 11.681], [-10.098, 11.748],
      [-10.266, 11.882], [-10.249, 11.95], [-10.132, 12.034], [-10.149, 12.134], [-9.863, 12.269], [-9.745, 12.403],
      [-9.661, 12.622], [-9.56, 12.655], [-8.922, 11.613], [-8.939, 11.529], [-8.888, 11.429], [-8.939, 11.311], [-8.804, 11.277],
      [-8.569, 11.042], [-8.569, 10.975], [-8.72, 10.874], [-8.737, 10.807], [-8.502, 10.588], [-8.502, 10.521],
      [-8.619, 10.387], [-8.518, 10.286], [-8.535, 10.202], [-8.468, 9.832], [-8.367, 10.218], [-8.384, 10.286], [-8.283, 10.336],
      [-8.249, 10.269], [-8.216, 10.437], [-8.081, 10.42], [-8.014, 10.37], [-8.014, 10.218], [-7.981, 10.387], [-7.863, 10.353],
      [-7.896, 10.303], [-7.846, 10.202], [-7.812, 10.37], [-7.678, 10.353], [-7.644, 10.319], [-7.644, 10.168], [-7.594, 10.336],
      [-7.476, 10.319], [-7.426, 10.286], [-7.409, 10.118], [-7.375, 10.286], [-7.207, 10.269], [-7.191, 10.118],
      [-7.14, 10.084], [-7.157, 10.034], [-6.939, 9.899], [-6.888, 9.765], [-6.905, 9.714], [-7.123, 9.58], [-7.14, 9.529],
      [-6.787, 9.261], [-6.787, 9.193], [-6.939, 9.059], [-6.939, 8.975], [-6.804, 8.874], [-6.821, 8.739], [-6.737, 8.218],
      [-6.619, 8.79], [-6.636, 8.874], [-6.502, 8.975], [-6.502, 9.042], [-6.653, 9.193], [-6.653, 9.261], [-6.384, 9.496],
      [-6.3, 9.513], [-6.3, 9.563], [-6.451, 9.63], [-6.535, 9.714], [-6.535, 9.782], [-6.401, 9.933], [-6.3, 9.966],
      [-6.266, 9.899], [-6.249, 10.067], [-6.065, 10.05], [-6.048, 9.866], [-5.997, 10.034], [-5.796, 10], [-5.762, 9.815],
      [-5.762, 9.966], [-5.728, 10], [-5.527, 9.966], [-5.493, 9.782], [-5.476, 9.933], [-5.392, 9.933], [-5.392, 9.849],
      [-5.308, 9.782], [-5.241, 9.328], [-5.174, 9.782], [-5.107, 9.832], [-5.09, 9.933], [-5.039, 9.899], [-5.056, 9.798],
      [-5.023, 9.782], [-5.006, 9.933], [-4.821, 9.95], [-4.77, 9.782], [-4.77, 9.933], [-4.586, 9.966], [-4.552, 9.782],
      [-4.518, 9.966], [-4.317, 9.983], [-4.283, 9.815], [-4.283, 9.966], [-4.249, 10], [-4.081, 10.017], [-4.048, 9.849],
      [-4.014, 9.916], [-4.031, 10], [-3.981, 10.017], [-3.981, 9.916], [-3.913, 9.866], [-3.93, 9.815], [-3.829, 9.412],
      [-3.762, 9.866], [-3.678, 9.933], [-3.628, 9.866], [-3.611, 10.034], [-3.409, 10.034], [-3.392, 9.882], [-3.359, 10.034],
      [-3.191, 10.017], [-3.191, 9.597], [-3.258, 9.513], [-3.207, 9.429], [-3.207, 9.21], [-3.359, 9.059], [-3.224, 8.992],
      [-3.191, 8.924], [-3.224, 8.84], [-3.157, 8.672], [-2.905, 8.353], [-2.972, 8.202], [-2.922, 8.151], [-2.871, 7.815],
      [-2.838, 7.798], [-2.787, 8.134], [-2.754, 8.151], [-2.485, 7.345], [-2.249, 6.908], [-1.997, 6.555], [-1.712, 6.252],
      [-1.375, 5.983], [-0.569, 5.546], [-0.905, 5.395], [-0.871, 5.311], [-0.602, 5.21], [-0.787, 5.126], [-0.871, 5.008],
      [-0.821, 4.941], [-0.72, 4.924], [-0.67, 4.824], [-0.552, 4.79], [-0.367, 4.622], [-0.216, 4.269], [-0.233, 3.916],
      [-0.35, 3.782], [-0.434, 3.765], [-0.434, 3.697], [-0.552, 3.647], [-0.552, 3.597], [-0.199, 3.513], [0.003, 3.311],
      [-0.031, 3.193], [0.137, 3.042], [-0.014, 2.874], [-0.031, 2.689], [0.188, 2.353], [0.12, 2.017], [-0.031, 1.613],
      [0.019, 1.429], [-0.031, 1.176], [0.003, 1.076], [-0.132, 0.874], [-0.182, 0.706], [-0.283, 0.588], [-0.249, 0.437],
      [-0.3, 0], [-0.266, 0.017], [-0.249, 0.387], [-0.165, 0.538], [-0.182, 0.588], [-0.048, 0.84], [0.12, 1.008],
      [0.171, 0.975], [0.104, 0.908], [0.154, 0.723], [0.272, 0.655], [0.339, 0.672], [0.372, 0.622], [0.473, 0.622],
      [0.524, 0.672], [0.473, 0.874], [0.272, 1.025], [0.339, 1.109], [0.742, 1.025], [1.347, 1.042], [0.608, 1.294],
      [0.44, 1.277], [0.423, 1.311], [0.507, 1.496], [0.625, 1.613], [0.507, 1.58], [0.322, 1.378], [0.238, 1.378], [0.389, 1.563],
      [0.339, 1.899], [0.356, 2.42], [0.574, 2.571], [0.625, 2.723], [0.574, 2.924], [0.456, 3.042], [0.625, 3.193],
      [0.608, 3.328], [0.793, 3.513], [1.146, 3.597], [0.86, 3.882], [0.826, 4.168], [0.893, 4.471], [1.011, 4.655],
      [1.162, 4.79], [1.314, 4.824], [1.347, 4.924], [1.482, 4.975], [1.482, 5.059], [1.431, 5.109], [1.23, 5.21], [1.498, 5.311],
      [1.532, 5.378], [1.482, 5.429], [1.414, 5.429], [1.364, 5.496], [1.28, 5.496], [1.213, 5.546], [2.036, 6], [2.272, 6.185],
      [2.608, 6.538], [2.927, 7.008], [3.129, 7.412], [3.398, 8.185], [3.498, 7.798], [3.532, 7.815], [3.583, 8.134],
      [3.633, 8.185], [3.566, 8.336], [3.65, 8.42], [3.633, 8.471], [3.801, 8.622], [3.902, 8.84], [3.885, 8.975], [4.036, 9.042],
      [3.868, 9.21], [3.868, 9.429], [3.919, 9.529], [3.851, 9.58], [3.851, 10.05], [3.902, 10.05], [3.919, 9.933], [3.952, 10.067],
      [4.137, 10.05], [4.171, 10.017], [4.171, 9.899], [4.204, 10.05], [4.406, 10.034], [4.423, 9.866], [4.473, 9.916],
      [4.54, 9.866], [4.524, 9.815], [4.625, 9.412], [4.709, 9.866], [4.793, 9.916], [4.826, 9.849], [4.86, 10.017],
      [5.045, 10], [5.078, 9.815], [5.112, 9.983], [5.381, 9.966], [5.414, 9.782], [5.431, 9.966], [5.616, 9.95], [5.633, 9.782],
      [5.667, 9.95], [5.851, 9.933], [5.885, 9.899], [5.885, 9.765], [5.902, 9.916], [5.935, 9.933], [5.952, 9.849], [6.036, 9.798],
      [6.053, 9.563], [6.12, 9.345], [6.188, 9.798], [6.255, 9.849], [6.272, 9.95], [6.305, 9.933], [6.288, 9.849], [6.322, 9.782],
      [6.356, 9.966], [6.557, 9.983], [6.591, 9.815], [6.608, 10], [6.826, 10.034], [6.86, 9.866], [6.86, 10.017],
      [6.893, 10.05], [7.078, 10.067], [7.112, 9.899], [7.112, 10.067], [7.213, 10.101], [7.246, 10.067], [7.213, 9.966],
      [7.364, 9.899], [7.448, 9.782], [7.448, 9.714], [7.246, 9.58], [7.213, 9.513], [7.28, 9.496], [7.566, 9.261],
      [7.583, 9.193], [7.414, 9.008], [7.566, 8.857], [7.549, 8.773], [7.667, 8.218], [7.751, 8.739], [7.734, 8.857],
      [7.868, 8.958], [7.868, 9.042], [7.717, 9.193], [7.717, 9.261], [8.07, 9.529], [8.053, 9.58], [7.919, 9.63],
      [7.818, 9.731], [7.868, 9.899], [8.053, 9.983], [8.07, 10.034], [8.019, 10.084], [8.12, 10.269], [8.221, 10.269],
      [8.221, 10.185], [8.272, 10.118], [8.272, 10.252], [8.339, 10.303], [8.44, 10.319], [8.49, 10.151], [8.507, 10.319],
      [8.675, 10.353], [8.725, 10.185], [8.725, 10.336], [8.927, 10.387], [8.961, 10.218], [8.961, 10.37], [9.162, 10.42],
      [9.179, 10.269], [9.23, 10.319], [9.33, 10.235], [9.314, 10.185], [9.414, 9.815], [9.465, 10.235], [9.566, 10.319],
      [9.566, 10.387], [9.448, 10.487], [9.448, 10.555], [9.7, 10.773], [9.532, 10.941], [9.532, 11.008], [9.751, 11.244],
      [9.885, 11.277], [9.835, 11.429], [9.902, 11.479], [9.868, 11.58], [10.456, 12.521], [10.49, 12.588], [10.473, 12.706],
      [10.591, 12.891], [10.608, 12.739], [10.524, 12.655], [10.641, 12.571], [10.692, 12.42], [10.877, 12.218], [11.146, 12.118],
      [11.129, 12.017], [11.263, 11.899], [11.263, 11.849], [11.112, 11.731], [11.112, 11.647], [11.297, 11.496], [11.246, 11.395],
      [11.381, 10.874], [11.482, 11.395], [11.414, 11.479], [11.616, 11.681], [11.431, 11.866], [11.599, 12], [11.566, 12.101],
      [11.767, 12.269], [11.919, 12.605], [12.003, 12.639], [12.003, 12.689], [11.919, 12.773], [11.919, 12.857],
      [11.969, 13.395], [12.053, 13.462], [12.053, 13.546], [12.104, 13.597], [12.07, 13.664], [12.188, 13.714],
      [12.759, 13.798], [12.961, 13.613], [12.877, 13.529], [12.893, 13.378], [13.045, 13.311], [13.162, 13.412], [13.162, 13.529],
      [13.095, 13.613], [13.28, 13.782], [13.263, 13.849], [13.364, 13.882]] },
  };

  // 写真の月の横径から角度縮尺を取り、見える塔の段と屋根を校正した自作立体。
  // 写真は1280×1920の表示座標で手動計測。遮蔽された下部/裏面/奥行きは概算。
  // 他者メッシュ・テクスチャなし。凸部品を別々に投影して塔間を埋めない。
  const CASTLE_MODEL = (() => {
    const solids = [];
    const calibration = {
      observer:{latitude:35.63993502841878,longitude:139.8405560339636,elevation:2,eyeM:1.5},
      photoAt:"2023-08-31T18:41:19+09:00",timeZoneAssumed:true,source:"user-estimated",
      imageSize:[1280,1920],tipPx:[646,724],moonLimbXPx:[279,1023],
      moonDiameterDeg:.5565571875567298,pixelsPerM:20.423209149450226,
      translationAligned:true,depthMeasured:false,
      // 主塔と4つの見える尖塔。頂点の目視計測誤差は数px、空/雲の遮蔽もある。
      landmarksPx:[[646,724],[595,1084],[540,1140],[771,921],[827,949]],
      description:"2023年写真の見える輪郭を校正。地点・時刻・奥行き・背面は実測確定ではない"
    };
    const ppm=calibration.pixelsPerM,pxX=x=>(x-646)/ppm,pxZ=y=>51-(y-724)/ppm;
    const box = (x,y,w,d,z0,z1) => solids.push([z0,z1].flatMap(z => [-1,1].flatMap(a => [-1,1].map(b => [x+a*w/2,y+b*d/2,z]))));
    const band = (x,y,z0,r0,z1,r1) => solids.push([[z0,r0],[z1,r1]].flatMap(([z,r]) => Array.from({length:16},(_,i) => [x+r*Math.cos(i*Math.PI/8),y+r*Math.sin(i*Math.PI/8),z])));
    const profile = (cx,depth,stations) => {
      const rows=stations.map(([y,r])=>[Math.max(0,pxZ(y)),r/ppm]).sort((a,b)=>a[0]-b[0]);
      rows.unshift([0,rows[0][1]]);
      for(let i=1;i<rows.length;i++)if(rows[i][0]>rows[i-1][0])band(pxX(cx),depth,...rows[i-1],...rows[i]);
    };
    // 主塔：細い旗竿、長い尖屋根、装飾帯、広いバルコニー、下の柱を分離。
    profile(646,0,[[724,0],[735,1.8],[800,2],[820,4],[940,14],[951,16],
      [957,25],[995,25],[1018,28],[1036,42],[1045,42],[1062,28],
      [1210,28],[1228,36],[1260,36],[1410,38]]);
    profile(595,3,[[1084,0],[1107,2],[1155,13],[1175,16],[1220,16],[1234,20],[1410,20]]);
    profile(540,-3,[[1140,0],[1160,2],[1258,20],[1272,23],[1315,23],[1324,28],[1450,28]]);
    profile(771,2,[[921,0],[946,2],[1095,20],[1105,26],[1114,22],[1210,22],[1220,28],[1246,28],[1425,28]]);
    profile(827,-4,[[949,0],[975,2],[1167,18],[1175,22],[1200,22],[1210,15],[1253,15],[1270,27],[1280,27],[1460,27]]);
    profile(704,-5,[[1257,0],[1270,2],[1316,13],[1325,16],[1460,16]]);
    profile(774,-6,[[1238,0],[1253,2],[1302,13],[1315,18],[1460,18]]);
    // 塔の間の大きな屋根。左右は写真で計測、厚みは推定の5m。
    solids.push([-2.5,2.5].flatMap(y=>[[668,1220],[691,1090],[691,1075],[724,1075],[750,1215]].map(([x,z])=>[pxX(x),y,pxZ(z)])));
    box(1,0,5,8,0,pxZ(1260));box(5,0,5,7,0,pxZ(1250));box(-4,0,5,7,0,pxZ(1340));
    // 写真では木/手前の建物に隠れる低層部と奥側は概算を保持する。
    for(const [x,y,h,r]of [[-10.3,-6,14.15,1.1],[-8.2,5,11.01,.85],[10.5,5,16,.85]]){
      band(x,y,0,r,h-4,r);band(x,y,h-4,r,h,0);
    }
    box(0,-6,24,2,0,8);box(0,6,24,2,0,8);box(-11,0,2,12,0,8);box(11,0,2,12,0,8);
    for(const y of [-6,6])for(let x=-11;x<=11;x+=2)box(x,y,.8,2,8,8.7);
    return {id:"cinderella-photo-v2",heightM:51,approximate:true,calibration,solids};
  })();

  // 出典：Project PLATEAU 新宿区（2025年度）
  // https://www.geospatial.jp/ckan/dataset/plateau-13104-shinjuku-ku-2025
  // https://www.mlit.go.jp/plateau/site-policy/ (PDL1.0 / CC BY4.0)
  // CityGML LOD2を抽出・三角形化・東/北/上のメートル座標へ加工。
  const TOCHO_MODEL={"id":"tocho-plateau-lod2-2025","heightM":243.05,"groundM":34.63,"referenceBearing":0,"approximate":true,"sourceLabel":"PLATEAU 新宿区2025（加工）・形状は目安","sourceUrl":"https://www.geospatial.jp/ckan/dataset/plateau-13104-shinjuku-ku-2025","buildingId":"bldg_94caaf2f-dec2-41a7-8b0f-06ecd0fac6c7","vertices":[[-5.57626,55.02169,0.0],[1.81815,56.38199,0.0],[3.03579,50.19274,0.0],[8.37877,51.24402,0.0],[9.70757,44.16191,0.0],[17.69716,45.66854,0.0],[21.31098,26.4686,0.0],[13.32132,25.02218,0.0],[14.429,18.87291,0.0],[16.13081,19.17238,0.0],[22.06935,-11.97475,0.0],[20.54733,-12.25389,0.0],[21.8649,-18.48313,0.0],[29.61479,-17.04709,0.0],[33.62058,-37.94222,0.0],[25.95074,-39.45842,0.0],[26.83617,-43.88215,0.0],[21.04394,-45.09461,0.0],[22.18208,-51.59503,0.0],[18.80666,-52.3324,0.0],[19.16971,-54.71997,0.0],[5.8872,-57.24771,0.0],[5.44422,-54.85021,0.0],[1.19978,-55.63902,0.0],[-0.06803,-49.27927,0.0],[-4.86175,-50.16921,0.0],[-5.86754,-45.41453,0.0],[-13.68722,-46.92094,0.0],[-17.79376,-25.5042,0.0],[-10.2037,-24.08843,0.0],[-11.41108,-18.07978,0.0],[-12.56266,-18.24099,0.0],[-18.50093,12.63519,0.0],[-17.40937,12.85652,0.0],[-18.57692,18.93546,0.0],[-26.01729,17.60017,0.0],[-29.57111,36.6898,0.0],[-22.07103,38.19576,0.0],[-23.56926,44.98664,0.0],[-17.78686,46.11884,0.0],[-18.95474,52.42856,0.0],[-12.45336,53.76249,0.0],[-13.08544,56.35336,0.0],[-6.04475,57.77837,0.0],[-9.56366,-46.12728,151.74],[-10.32257,-42.16895,151.74],[-14.44512,-42.96661,151.74],[-13.68722,-46.92094,151.74],[-22.05503,38.18575,214.73],[-17.08577,46.25231,214.73],[-23.56926,44.98664,214.73],[-22.2971,18.26782,151.74],[-22.74123,20.76264,151.74],[-26.4814,20.09095,151.74],[-26.01729,17.60017,151.74],[-10.51051,13.54583,214.73],[-18.57692,18.93546,214.73],[-17.27354,12.17741,214.73],[-23.16287,27.75877,243.05],[-22.34294,27.90846,243.05],[-26.11773,30.47772,243.05],[-26.90267,30.304,243.05],[14.76357,18.93159,47.68],[20.54733,-12.25389,47.68],[22.06935,-11.97475,47.68],[16.13081,19.17238,47.68],[-12.80217,-28.13491,190.949],[-10.2187,-24.07841,190.949],[-13.43447,-24.69114,190.949],[-14.77756,50.0104,191.27],[-12.46236,53.76849,191.27],[-15.45538,53.14606,191.27],[0.80597,-9.56023,190.949],[0.02601,-9.71688,190.949],[4.3235,-12.47002,190.949],[6.79235,-8.58127,190.949],[10.56899,-11.06324,190.949],[9.93408,-7.88236,190.949],[6.27893,-8.61813,190.949],[6.16423,-8.04335,190.949],[0.72245,-9.13892,190.949],[-10.83082,-35.3666,243.05],[-9.87007,-35.19664,243.05],[-14.40503,-31.94114,243.05],[-15.35378,-32.12012,243.05],[-0.66927,12.54565,243.05],[3.08354,9.96832,243.05],[2.93153,10.78287,243.05],[-0.82728,13.3632,243.05],[18.26178,32.28595,243.05],[17.45184,32.13326,243.05],[15.33688,-52.74881,243.05],[30.56408,-30.49435,243.05],[29.59435,-30.67436,243.05],[15.15667,-51.77577,243.05],[-18.57692,18.93546,243.05],[-3.22906,8.67984,243.05],[-3.39106,9.49136,243.05],[-18.25295,19.42258,243.05],[-5.21719,-16.22654,190.949],[-3.77494,-13.96178,190.949],[-5.57857,-14.30655,190.949],[-5.57626,55.02169,191.27],[-6.04475,57.77837,191.27],[-13.08544,56.35336,191.27],[-8.06395,51.02654,191.27],[14.20898,35.06654,243.05],[16.99422,39.16245,243.05],[16.18428,39.00776,243.05],[13.39904,34.91184,243.05],[11.79007,-50.30062,243.05],[11.60986,-49.32858,243.05],[13.14809,44.81107,151.22],[13.6011,42.3855,151.22],[18.15317,43.24397,151.22],[17.69716,45.66854,151.22],[26.60528,-27.76178,243.05],[29.39653,-23.68292,243.05],[28.4268,-23.86393,243.05],[25.63555,-27.94279,243.05],[-2.82925,8.52288,191.27],[-2.74969,8.07648,191.27],[2.94893,9.10018,191.27],[2.86937,9.54658,191.27],[6.98005,10.28502,191.27],[6.39494,13.56732,191.27],[9.2113,14.0741,191.27],[8.60403,17.48078,191.27],[8.11271,17.36368,191.27],[3.08354,9.96832,191.27],[-0.66927,12.54565,191.27],[-3.22906,8.67984,191.27],[-7.58773,11.59243,191.27],[-6.91096,7.7895,191.27],[-22.74123,20.76264,191.27],[-22.2971,18.26782,191.27],[-18.57692,18.93546,191.27],[-25.77384,24.05543,191.27],[-23.16287,27.75877,191.27],[-26.91267,30.31,191.27],[-24.48685,34.24787,191.27],[-28.93485,33.27413,191.27],[-26.4814,20.09095,191.27],[-24.48985,34.25088,151.22],[-25.27479,37.55194,151.22],[-29.57111,36.6898,151.22],[-28.93485,33.27413,151.22],[25.95074,-39.45842,214.64],[25.59368,-37.75916,214.64],[20.50764,-45.19272,214.64],[21.04394,-45.09461,214.64],[26.83617,-43.88215,214.64],[4.3235,-12.47002,243.05],[-0.7629,-9.21231,243.05],[-0.54673,-10.18028,243.05],[4.53667,-13.437,243.05],[30.17339,-19.96117,151.74],[29.61479,-17.04709,151.74],[25.49816,-17.8086,151.74],[26.0628,-20.75579,151.74],[21.8649,-18.48313,243.05],[21.46914,-19.06066,243.05],[-24.96088,24.19608,243.05],[-25.77384,24.05543,243.05],[-2.55397,-12.0435,190.949],[-1.23631,-9.97559,190.949],[-2.90111,-10.30611,190.949],[-13.43447,-24.69114,151.74],[-17.79376,-25.5042,151.74],[-17.0268,-29.50466,151.74],[-13.19386,-28.76562,151.74],[-12.79517,-28.13992,151.74],[13.85391,-10.59792,190.949],[10.78697,-11.20641,190.949],[14.19264,-13.44309,190.949],[14.40437,-13.40265,190.949],[3.03579,50.19274,214.73],[9.70757,44.16191,214.73],[8.37877,51.24402,214.73],[16.99422,39.16245,191.27],[14.20898,35.06654,191.27],[18.26178,32.28595,191.27],[13.32132,25.02218,191.27],[16.72391,25.64018,191.27],[16.25417,28.58851,191.27],[20.75733,29.41179,191.27],[18.15317,43.24397,191.27],[13.6011,42.3855,191.27],[13.14809,44.81107,191.27],[9.70757,44.16191,191.27],[32.79023,-33.60972,151.74],[28.93734,-34.37085,151.74],[29.78566,-38.70032,151.74],[33.62058,-37.94222,151.74],[-17.09077,46.25531,191.27],[-15.26692,49.21499,191.27],[-18.27918,48.78116,191.27],[-17.78686,46.11884,191.27],[-13.1914,-38.81772,243.05],[9.11248,-54.21376,243.05],[8.93227,-53.24072,243.05],[-12.22267,-38.63771,243.05],[-22.05903,38.18876,191.27],[-25.27479,37.55194,191.27],[3.03579,50.19274,243.05],[-5.57626,55.02169,243.05],[-5.37535,54.23833,243.05],[2.69483,49.71262,243.05],[-8.06395,51.02654,243.05],[-12.45236,53.76148,243.05],[-12.2644,52.95602,243.05],[-7.87699,50.22108,243.05],[-15.34478,-32.12713,190.949],[-13.20086,-28.76161,190.949],[-17.0268,-29.50466,190.949],[-14.44512,-42.96661,190.949],[-10.32257,-42.16895,190.949],[-9.56366,-46.12728,190.949],[-5.86754,-45.41453,190.949],[-4.86175,-50.16921,190.949],[-0.06803,-49.27927,190.949],[1.19978,-55.63902,190.949],[5.44422,-54.85021,190.949],[5.8872,-57.24771,190.949],[19.16971,-54.71997,190.949],[18.80666,-52.3324,190.949],[18.20229,-49.5408,190.949],[21.68856,-48.77919,190.949],[21.04394,-45.09461,190.949],[20.50764,-45.19272,190.949],[15.33688,-52.74881,190.949],[11.79007,-50.30062,190.949],[9.11248,-54.21376,190.949],[-13.1914,-38.81772,190.949],[-10.83082,-35.3666,190.949],[6.79235,-8.58127,243.05],[7.00053,-9.55527,243.05],[-1.26822,52.59468,151.22],[2.36559,53.59933,151.22],[1.81815,56.38199,151.22],[-2.10474,55.64683,151.22],[13.32132,25.02218,214.73],[8.11271,17.36368,214.73],[14.429,18.87291,214.73],[-15.27491,49.21999,151.22],[-14.78456,50.0154,151.22],[-15.45538,53.14606,151.22],[-18.95474,52.42856,151.22],[-18.27918,48.78116,151.22],[-10.2227,-24.07541,214.64],[-5.60094,-16.81911,214.64],[-11.41108,-18.07978,214.64],[9.70757,44.16191,243.05],[9.34661,43.69982,243.05],[-5.57857,-14.30655,143.93],[-3.76595,-13.96678,143.93],[-2.54497,-12.04851,143.93],[-2.90111,-10.30611,143.93],[-1.22731,-9.98059,143.93],[-0.7449,-9.22332,143.93],[0.02601,-9.71688,143.93],[0.80597,-9.56023,143.93],[0.72245,-9.13892,143.93],[6.16423,-8.04335,143.93],[6.27893,-8.61813,143.93],[9.93408,-7.88236,143.93],[10.56899,-11.06324,143.93],[10.78697,-11.20641,143.93],[13.85391,-10.59792,143.93],[14.40437,-13.40265,143.93],[19.70743,-12.41063,143.93],[13.86478,18.73864,143.93],[8.60403,17.48078,143.93],[9.2113,14.0741,143.93],[6.39494,13.56732,143.93],[6.98005,10.28502,143.93],[2.86937,9.54658,143.93],[2.94893,9.10018,143.93],[-2.74969,8.07648,143.93],[-2.82925,8.52288,143.93],[-6.91096,7.7895,143.93],[-7.58773,11.59243,143.93],[-10.51051,13.54583,143.93],[-16.63139,12.30779,143.93],[-10.97367,-17.98583,143.93],[-5.58794,-16.82812,143.93],[-5.20919,-16.23255,143.93],[21.8649,-18.48313,214.64],[20.54733,-12.25389,214.64],[14.19264,-13.44309,214.64],[-7.87699,50.22108,242.086],[-12.2644,52.95602,242.086],[-26.11773,30.47772,242.086],[-22.34294,27.90846,242.086],[-24.96088,24.19608,242.086],[-18.25295,19.42258,242.086],[-3.39106,9.49136,242.086],[-0.82728,13.3632,242.086],[2.93153,10.78287,242.086],[17.45184,32.13326,242.086],[13.39904,34.91184,242.086],[16.18428,39.00776,242.086],[9.34661,43.69982,242.086],[2.69483,49.71262,242.086],[-5.37535,54.23833,242.086],[-1.26822,52.59468,191.27],[-2.10474,55.64683,191.27],[2.36559,53.59933,191.27],[3.03579,50.19274,191.27],[13.86478,18.73864,151.74],[19.70743,-12.41063,151.74],[20.54733,-12.25389,151.74],[14.76357,18.93159,151.74],[14.429,18.87291,151.74],[16.25417,28.58851,151.22],[16.72391,25.64018,151.22],[21.31098,26.4686,151.22],[20.75733,29.41179,151.22],[-10.97367,-17.98583,151.74],[-16.63139,12.30779,151.74],[-17.27354,12.17741,151.74],[-17.40937,12.85652,151.74],[-18.50093,12.63519,151.74],[-12.56266,-18.24099,151.74],[-11.41108,-18.07978,151.74],[11.60986,-49.32858,242.133],[15.15667,-51.77577,242.133],[29.59435,-30.67436,242.133],[25.63555,-27.94279,242.133],[28.4268,-23.86393,242.133],[21.46914,-19.06066,242.133],[7.00053,-9.55527,242.133],[4.53667,-13.437,242.133],[-0.54673,-10.18028,242.133],[-14.40503,-31.94114,242.133],[-9.87007,-35.19664,242.133],[-12.22267,-38.63771,242.133],[8.93227,-53.24072,242.133],[29.39653,-23.68292,190.949],[26.60528,-27.76178,190.949],[30.56408,-30.49435,190.949],[25.59368,-37.75916,190.949],[25.95074,-39.45842,190.949],[29.78566,-38.70032,190.949],[28.93734,-34.37085,190.949],[32.79023,-33.60972,190.949],[30.17339,-19.96117,190.949],[26.0628,-20.75579,190.949],[25.49816,-17.8086,190.949],[21.8649,-18.48313,190.949],[18.20229,-49.5408,151.74],[18.80666,-52.3324,151.74],[22.18208,-51.59503,151.74],[21.68856,-48.77919,151.74],[-6.48185,0.44921,143.929],[-8.32345,0.10438,143.929],[-8.45232,0.80056,143.929],[-6.58375,1.14844,143.929],[-7.15761,4.24411,143.929],[-9.26186,3.85174,143.929],[-9.39275,4.56096,143.929],[-1.10357,6.10818,143.929],[-0.65697,6.06468,143.929],[-0.44208,5.98873,143.929],[-0.22803,5.79739,143.929],[0.01449,5.26393,143.929],[0.15745,4.49051,143.929],[-0.64051,4.34186,143.929],[-0.82978,5.36104,143.929],[-6.30962,4.33766,143.929],[-5.81831,1.68135,143.929],[-5.89754,1.20061,143.929],[-5.96108,0.92759,143.929],[-6.12858,0.69757,143.929],[-9.39275,4.56096,151.445],[-9.26186,3.85174,151.445],[-8.45232,0.80056,151.445],[-8.32345,0.10438,151.445],[-7.15761,4.24411,151.445],[-6.58375,1.14844,151.445],[-6.48185,0.44921,151.445],[-6.12858,0.69757,151.445],[-5.81831,1.68135,151.445],[-6.30962,4.33766,151.445],[-5.96108,0.92759,151.445],[-5.89754,1.20061,151.445],[-1.10357,6.10818,151.445],[-0.64051,4.34186,151.445],[0.15745,4.49051,151.445],[0.01449,5.26393,151.445],[-0.22803,5.79739,151.445],[-0.44208,5.98873,151.445],[-0.65697,6.06468,151.445],[-0.82978,5.36104,151.445],[-8.92626,-38.52456,242.133],[7.59787,-13.00913,242.133],[24.86612,-24.29151,242.133],[8.34195,-49.80692,242.133],[-8.92626,-38.52456,243.785],[8.34195,-49.80692,243.785],[24.86612,-24.29151,243.785],[7.59787,-13.00913,243.785],[-5.65287,-27.95497,237.192],[-3.29257,-24.3112,237.192],[-0.78382,-25.95114,237.192],[-3.14312,-29.59491,237.192],[-4.41658,-22.79367,237.192],[-2.44472,-19.95018,237.192],[-1.60474,-20.53796,237.192],[-3.57661,-23.38145,237.192],[-5.65287,-27.95497,241.62],[-3.29257,-24.3112,241.62],[-3.14312,-29.59491,241.62],[-3.57661,-23.38145,241.62],[-4.41658,-22.79367,241.62],[-2.44472,-19.95018,241.62],[-0.78382,-25.95114,241.62],[-1.60474,-20.53796,241.62],[8.02161,32.1156,250.163],[8.13573,31.95221,250.163],[7.90619,32.49572,250.163],[7.94343,32.29911,250.163],[8.28178,31.81596,250.163],[8.83748,31.62411,250.163],[8.45275,31.71286,250.163],[7.9089,32.6954,250.163],[7.95357,32.89013,250.163],[8.64065,31.64791,250.163],[8.03723,33.07086,250.163],[9.03625,31.64145,250.163],[9.39965,31.79751,250.163],[8.15687,33.23058,250.163],[8.30653,33.36124,250.163],[9.22597,31.69993,250.163],[8.48121,33.45882,250.163],[8.8687,33.53464,250.163],[9.5503,31.92817,250.163],[9.66895,32.08788,250.163],[8.67093,33.51729,250.163],[9.7536,32.26962,250.163],[9.80099,32.66403,250.163],[9.06653,33.51084,250.163],[9.25443,33.44589,250.163],[9.79828,32.46334,250.163],[9.4254,33.34279,250.163],[9.68456,33.04315,250.163],[9.76275,32.85964,250.163],[9.57144,33.20754,250.163],[8.55773,35.82697,243.901],[9.14677,36.77002,242.086],[9.14677,36.77002,243.901],[8.55773,35.82697,242.086],[9.03625,31.64145,247.809],[8.83748,31.62411,247.809],[8.8687,33.53464,247.809],[9.06653,33.51084,247.809],[9.24389,35.22291,242.086],[8.81223,35.29653,247.809],[9.24389,35.22291,247.809],[8.81223,35.29653,242.086],[6.30075,-5.02792,151.207],[12.05515,-3.88975,143.929],[12.05515,-3.88975,151.207],[6.30075,-5.02792,143.929],[9.22597,31.69993,247.809],[9.25443,33.44589,247.809],[9.41145,31.2296,247.809],[8.98705,31.11961,242.086],[9.41145,31.2296,242.086],[8.98705,31.11961,247.809],[9.39965,31.79751,247.809],[9.4254,33.34279,247.809],[9.69769,36.42364,243.901],[9.69769,36.42364,242.086],[9.6507,35.06195,242.086],[9.6507,35.06195,247.809],[9.5503,31.92817,247.809],[9.57144,33.20754,247.809],[9.80277,31.42483,242.086],[9.80277,31.42483,247.809],[9.66895,32.08788,247.809],[9.68456,33.04315,247.809],[9.7536,32.26962,247.809],[9.76275,32.85964,247.809],[9.79828,32.46334,247.809],[9.80099,32.66403,247.809],[10.01467,34.81865,242.086],[10.01467,34.81865,247.809],[10.14502,31.69825,247.809],[10.14502,31.69825,242.086],[10.40334,37.55549,243.901],[10.40334,37.55549,242.086],[10.32081,34.50502,247.809],[10.32081,34.50502,242.086],[10.02639,37.79276,243.901],[10.02639,37.79276,242.086],[10.42424,32.0368,247.809],[10.42424,32.0368,242.086],[10.69017,38.85733,243.901],[10.69017,38.85733,242.086],[10.5551,34.1331,247.809],[10.5551,34.1331,242.086],[10.62648,32.42541,247.809],[10.62648,32.42541,242.086],[10.70753,33.72193,242.086],[10.70753,33.72193,247.809],[10.74375,32.84902,247.809],[10.74375,32.84902,242.086],[10.77209,33.28754,242.086],[10.77209,33.28754,247.809],[9.8201,7.5087,151.207],[9.8201,7.5087,143.929],[18.43965,-35.33224,242.133],[19.27456,-35.87889,243.916],[18.43965,-35.33224,243.916],[19.27456,-35.87889,242.133],[18.54394,-37.00577,243.916],[18.54394,-37.00577,242.133],[19.66182,-37.73563,243.916],[19.66182,-37.73563,242.133],[20.17898,-32.64562,242.133],[20.17898,-32.64562,243.916],[21.06027,-35.57629,243.916],[21.06027,-35.57629,242.133],[23.26066,-34.65901,243.916],[22.18915,-36.31417,243.916],[22.18915,-36.31417,242.133],[23.26066,-34.65901,242.133],[-6.98586,-31.86416,242.133],[-5.31803,-32.95345,243.785],[-6.98586,-31.86416,243.785],[-5.31803,-32.95345,242.133],[-7.19817,-32.19258,242.133],[-7.19817,-32.19258,243.785],[-4.01329,-30.93873,243.785],[-4.01329,-30.93873,242.133],[-9.01299,-31.00618,243.785],[-9.01299,-31.00618,242.133],[-7.2617,-28.30147,243.785],[-5.31889,-29.57198,243.785],[-5.55213,-29.93354,243.785],[-5.55213,-29.93354,242.133],[-5.31889,-29.57198,242.133],[-7.2617,-28.30147,242.133],[2.11628,-4.45602,150.072],[-0.28755,-4.93009,143.929],[2.11628,-4.45602,143.929],[-0.28755,-4.93009,150.072],[-0.4697,-3.99418,143.929],[-0.4697,-3.99418,150.072],[-1.31459,-4.16097,143.929],[-1.31459,-4.16097,150.072],[1.95727,-3.63948,150.072],[1.95727,-3.63948,143.929],[2.44762,-3.54344,150.072],[2.44762,-3.54344,143.929],[-1.63059,-2.53691,143.929],[-1.63059,-2.53691,150.072],[-0.84563,-2.38326,150.072],[2.08936,-1.70873,150.072],[-0.94123,-1.89374,150.072],[1.45319,-1.83307,150.072],[1.37571,-1.43684,150.072],[2.08936,-1.70873,143.929],[-0.84563,-2.38326,143.929],[-0.94123,-1.89374,143.929],[1.45319,-1.83307,143.929],[1.37571,-1.43684,143.929],[1.57847,-0.02977,147.994],[0.39797,-0.22012,143.929],[1.57847,-0.02977,143.929],[0.39797,-0.22012,147.994],[0.2377,0.77803,143.929],[0.2377,0.77803,147.994],[1.4182,0.96838,147.994],[1.4182,0.96838,143.929],[4.0667,6.37054,143.929],[4.0667,6.37054,151.207],[-3.43993,15.00199,242.086],[-2.99034,14.9615,247.809],[-3.43993,15.00199,247.809],[-2.99034,14.9615,242.086],[-2.54188,15.01633,247.809],[-2.54188,15.01633,242.086],[-3.87168,15.13481,247.809],[-3.87168,15.13481,242.086],[-2.11454,15.16244,247.809],[-2.11454,15.16244,242.086],[-4.26658,15.35599,242.086],[-4.26658,15.35599,247.809],[-1.72627,15.3958,247.809],[-1.72627,15.3958,242.086],[-4.60766,15.65351,242.086],[-4.60766,15.65351,247.809],[-1.39506,15.70533,247.809],[-1.39506,15.70533,242.086],[-4.8789,16.01735,242.086],[-4.8789,16.01735,247.809],[-1.13586,16.07596,247.809],[-1.13586,16.07596,242.086],[-5.0693,16.42847,242.086],[-5.0693,16.42847,247.809],[-0.95865,16.49363,247.809],[-0.95865,16.49363,242.086],[-5.16983,16.87083,242.086],[-5.16983,16.87083,247.809],[-0.87138,16.93927,247.809],[-0.87138,16.93927,242.086],[-5.17747,17.32436,242.086],[-5.17747,17.32436,247.809],[-4.91299,18.18767,247.809],[-5.0902,17.77,247.809],[-4.65279,18.5583,247.809],[-3.93431,19.10118,247.809],[-4.32258,18.86783,247.809],[-3.50697,19.2483,247.809],[-3.05851,19.30213,247.809],[-2.60792,19.26265,247.809],[-2.17617,19.12881,247.809],[-1.78226,18.90864,247.809],[-1.16995,18.24728,247.809],[-1.44119,18.61012,247.809],[-0.97955,17.83515,247.809],[-0.87902,17.3928,247.809],[-0.87902,17.3928,242.086],[1.58771,17.19469,242.086],[1.78449,17.20601,245.102],[1.58771,17.19469,245.102],[1.78449,17.20601,242.086],[1.39387,17.22551,242.086],[1.39387,17.22551,245.102],[1.97422,17.25746,245.102],[1.97422,17.25746,242.086],[1.20996,17.29548,242.086],[1.20996,17.29548,245.102],[2.14791,17.34801,245.102],[2.14791,17.34801,242.086],[1.04397,17.40261,242.086],[1.04397,17.40261,245.102],[2.30057,17.47266,245.102],[2.30057,17.47266,242.086],[0.90492,17.54188,242.086],[0.90492,17.54188,245.102],[2.42422,17.62636,245.102],[2.42422,17.62636,242.086],[-5.0902,17.77,242.086],[-0.97955,17.83515,242.086],[0.79779,17.70728,242.086],[0.79779,17.70728,245.102],[2.51288,17.80208,245.102],[2.51288,17.80208,242.086],[0.7266,17.8908,242.086],[0.7266,17.8908,245.102],[2.56355,17.99381,245.102],[2.56355,17.99381,242.086],[-4.91299,18.18767,242.086],[0.69535,18.08542,242.086],[0.69535,18.08542,245.102],[-1.16995,18.24728,242.086],[2.57326,18.19049,245.102],[2.57326,18.19049,242.086],[2.54101,18.3851,245.102],[0.70506,18.2831,245.102],[0.75473,18.47382,245.102],[0.84439,18.65055,245.102],[1.1197,18.92889,245.102],[0.96704,18.80425,245.102],[1.48412,19.0709,245.102],[1.29439,19.01945,245.102],[2.47082,18.56963,245.102],[2.36269,18.73503,245.102],[1.6809,19.08122,245.102],[2.22364,18.8743,245.102],[1.87474,19.0514,245.102],[2.05865,18.98143,245.102],[0.70506,18.2831,242.086],[2.54101,18.3851,242.086],[0.75473,18.47382,242.086],[-4.65279,18.5583,242.086],[-1.44119,18.61012,242.086],[2.47082,18.56963,242.086],[0.84439,18.65055,242.086],[2.36269,18.73503,242.086],[-4.32258,18.86783,242.086],[0.96704,18.80425,242.086],[-1.78226,18.90864,242.086],[2.22364,18.8743,242.086],[1.1197,18.92889,242.086],[2.05865,18.98143,242.086],[1.29439,19.01945,242.086],[-3.93431,19.10118,242.086],[1.87474,19.0514,242.086],[-2.17617,19.12881,242.086],[1.48412,19.0709,242.086],[1.6809,19.08122,242.086],[-3.50697,19.2483,242.086],[-2.60792,19.26265,242.086],[-3.05851,19.30213,242.086],[-17.89707,25.50373,247.582],[-18.30663,25.48809,242.086],[-17.89707,25.50373,242.086],[-18.30663,25.48809,247.582],[-18.71131,25.55774,242.086],[-18.71131,25.55774,247.582],[-17.49963,25.60565,247.582],[-17.49963,25.60565,242.086],[-19.09213,25.71071,242.086],[-19.09213,25.71071,247.582],[-17.13227,25.7878,247.582],[-17.13227,25.7878,242.086],[-19.43311,25.93999,242.086],[-19.43311,25.93999,247.582],[-16.80997,26.04213,247.582],[-16.80997,26.04213,242.086],[-19.71924,26.23458,242.086],[-19.71924,26.23458,247.582],[-16.5477,26.35858,247.582],[-16.5477,26.35858,242.086],[-19.93752,26.58345,242.086],[-19.93752,26.58345,247.582],[-16.35642,26.7231,247.582],[-16.35642,26.7231,242.086],[-20.07992,26.96955,242.086],[-20.07992,26.96955,247.582],[-16.24511,27.1196,247.582],[-16.24511,27.1196,242.086],[-20.13845,27.37785,242.086],[-20.13845,27.37785,247.582],[-16.21773,27.53104,247.582],[-16.21773,27.53104,242.086],[-20.11207,27.78928,247.582],[-19.99976,28.18479,247.582],[-19.80848,28.5493,247.582],[-19.54621,28.86576,247.582],[-17.64487,29.35015,247.582],[-19.22391,29.12109,247.582],[-18.85655,29.30324,247.582],[-18.04955,29.4208,247.582],[-18.45911,29.40516,247.582],[-17.26405,29.19818,247.582],[-16.92307,28.9689,247.582],[-16.63694,28.67331,247.582],[-16.41866,28.32544,247.582],[-16.27625,27.93834,247.582],[-20.11207,27.78928,242.086],[-16.27625,27.93834,242.086],[-6.92137,27.54953,242.086],[-3.73156,28.16724,243.901],[-6.92137,27.54953,243.901],[-3.73156,28.16724,242.086],[-19.99976,28.18479,242.086],[-16.41866,28.32544,242.086],[-19.80848,28.5493,242.086],[-16.63694,28.67331,242.086],[-3.78893,28.46818,242.086],[-3.08086,28.60566,243.29],[-3.78893,28.46818,243.29],[-3.08086,28.60566,242.086],[-3.02349,28.30372,242.086],[-0.12429,28.86582,243.901],[-3.02349,28.30372,243.901],[-0.12429,28.86582,242.086],[-19.54621,28.86576,242.086],[-16.92307,28.9689,242.086],[-19.22391,29.12109,242.086],[-17.26405,29.19818,242.086],[-7.53936,30.76856,242.086],[-7.53936,30.76856,243.901],[-18.85655,29.30324,242.086],[-17.64487,29.35015,242.086],[3.75562,29.61596,243.901],[0.71261,29.02757,242.086],[3.75562,29.61596,242.086],[0.71261,29.02757,243.901],[0.62907,29.46193,243.29],[-0.20683,29.30017,242.086],[0.62907,29.46193,242.086],[-0.20683,29.30017,243.29],[-18.45911,29.40516,242.086],[-18.04955,29.4208,242.086],[-4.34855,31.38627,243.901],[-4.34855,31.38627,242.086],[-4.28513,31.05223,243.29],[-4.28513,31.05223,242.086],[-3.57606,31.18871,243.29],[-3.64048,31.52376,242.086],[-3.57606,31.18871,242.086],[-3.64048,31.52376,243.901],[-0.74228,32.08485,243.901],[-0.67183,31.72272,243.29],[-0.74228,32.08485,242.086],[-0.67183,31.72272,242.086],[0.16407,31.88448,243.29],[0.16407,31.88448,242.086],[0.09462,32.2466,242.086],[0.09462,32.2466,243.901],[3.13863,32.836,243.901],[8.55052,31.10192,242.086],[8.55052,31.10192,247.809],[8.11886,31.17555,247.809],[8.11886,31.17555,242.086],[3.13863,32.836,242.086],[7.71205,31.33651,242.086],[7.71205,31.33651,247.809],[7.34808,31.57981,242.086],[7.34808,31.57981,247.809],[8.64065,31.64791,247.809],[8.45275,31.71286,247.809],[7.04195,31.89343,242.086],[7.04195,31.89343,247.809],[8.28178,31.81596,247.809],[8.13573,31.95221,247.809],[8.02161,32.1156,247.809],[6.80766,32.26435,242.086],[6.80766,32.26435,247.809],[7.94343,32.29911,247.809],[7.90619,32.49572,247.809],[6.65522,32.67653,242.086],[6.65522,32.67653,247.809],[7.9089,32.6954,247.809],[7.95357,32.89013,247.809],[6.59066,33.11091,242.086],[6.59066,33.11091,247.809],[8.03723,33.07086,247.809],[8.15687,33.23058,247.809],[6.619,33.54944,247.809],[6.73628,33.97305,247.809],[6.93851,34.36166,247.809],[8.30653,33.36124,247.809],[7.21773,34.70021,247.809],[7.55999,34.97363,247.809],[8.48121,33.45882,247.809],[7.9523,35.16886,247.809],[8.67093,33.51729,247.809],[8.37571,35.27784,247.809],[6.619,33.54944,242.086],[6.73628,33.97305,242.086],[6.93851,34.36166,242.086],[7.21773,34.70021,242.086],[7.55999,34.97363,242.086],[7.9523,35.16886,242.086],[8.37571,35.27784,242.086],[-8.70624,35.6956,243.901],[-5.51543,36.3133,242.086],[-5.51543,36.3133,243.901],[-8.70624,35.6956,242.086],[-4.86573,36.75173,243.29],[-5.5738,36.61424,242.086],[-4.86573,36.75173,242.086],[-5.5738,36.61424,243.29],[-4.80736,36.45079,242.086],[-1.90816,37.01188,243.901],[-4.80736,36.45079,243.901],[-1.90816,37.01188,242.086],[-11.85031,36.61317,242.086],[-10.36319,36.85012,245.892],[-11.85031,36.61317,245.892],[-10.36319,36.85012,242.086],[4.95119,38.09747,242.086],[4.95119,38.09747,243.901],[-9.31015,38.84842,242.086],[-9.31015,38.84842,243.901],[-12.07109,38.00858,242.086],[-12.07109,38.00858,245.892],[-10.58397,38.24554,245.892],[-10.58397,38.24554,242.086],[-6.12033,39.46512,243.901],[-6.069,39.19829,243.29],[-6.069,39.19829,242.086],[-6.12033,39.46512,242.086],[-5.36093,39.33478,243.29],[-5.41226,39.60261,242.086],[-5.36093,39.33478,242.086],[-5.41226,39.60261,243.901],[-2.51306,40.1637,243.901],[-2.51306,40.1637,242.086],[5.63591,39.19518,242.086],[5.63591,39.19518,243.901],[3.72007,43.24516,243.902],[1.93303,40.38086,243.902],[4.41307,39.96503,243.902],[3.89278,39.1475,243.902],[3.89278,39.1475,242.086],[4.41307,39.96503,242.086],[1.93303,40.38086,242.086],[3.72007,43.24516,242.086],[-8.1585,41.73889,242.086],[-7.62699,41.69953,260.649],[-8.1585,41.73889,260.649],[-7.62699,41.69953,242.086],[-7.09764,41.77254,242.086],[-7.09764,41.77254,260.649],[-8.67019,41.88967,242.086],[-8.67019,41.88967,260.649],[-6.59642,41.95288,260.649],[-6.59642,41.95288,242.086],[-9.14007,42.14285,242.086],[-9.14007,42.14285,260.649],[-6.14229,42.23549,242.086],[-6.14229,42.23549,260.649],[-9.54714,42.48843,260.649],[-9.54714,42.48843,242.086],[-5.75722,42.6053,242.086],[-5.75722,42.6053,260.649],[-9.87441,42.9124,242.086],[-9.87441,42.9124,260.649],[-5.45717,43.04824,260.649],[-5.45717,43.04824,242.086],[-10.10587,43.3947,242.086],[-10.10587,43.3947,260.649],[-5.25509,43.54421,260.649],[-5.25509,43.54421,242.086],[-10.23249,43.91528,242.086],[-10.23249,43.91528,260.649],[-5.15995,44.07214,260.649],[-5.15995,44.07214,242.086],[-10.24924,44.45007,242.086],[-10.24924,44.45007,260.649],[-5.1767,44.60693,260.649],[-5.30332,45.12752,260.649],[-5.53577,45.60982,260.649],[-5.86205,46.03378,260.649],[-6.26912,46.37937,260.649],[-6.739,46.63255,260.649],[-7.25069,46.78332,260.649],[-7.7832,46.82269,260.649],[-10.1541,44.978,260.649],[-8.31155,46.75068,260.649],[-8.81377,46.56934,260.649],[-9.95202,45.47398,260.649],[-9.65296,45.91691,260.649],[-9.2669,46.28773,260.649],[-5.1767,44.60693,242.086],[-10.1541,44.978,242.086],[-5.30332,45.12752,242.086],[-9.95202,45.47398,242.086],[-5.53577,45.60982,242.086],[-9.65296,45.91691,242.086],[-5.86205,46.03378,242.086],[-9.2669,46.28773,242.086],[-6.26912,46.37937,242.086],[-8.81377,46.56934,242.086],[-6.739,46.63255,242.086],[-8.31155,46.75068,242.086],[-7.25069,46.78332,242.086],[-7.7832,46.82269,242.086]],"triangles":[[0,43,42],[0,42,41],[0,41,40],[0,40,39],[39,38,37],[0,39,37],[37,36,35],[0,37,35],[0,35,34],[0,34,33],[33,32,31],[0,33,31],[0,31,30],[0,30,29],[29,28,27],[29,27,26],[0,29,26],[0,26,25],[0,25,24],[0,24,23],[0,23,22],[0,22,21],[0,21,20],[0,20,19],[0,19,18],[0,18,17],[0,17,16],[0,16,15],[15,14,13],[15,13,12],[0,15,12],[0,12,11],[0,11,10],[10,9,8],[0,10,8],[0,8,7],[0,7,6],[6,5,4],[0,6,4],[4,3,2],[0,4,2],[2,1,0],[47,44,45],[45,46,47],[48,49,50],[54,51,52],[52,53,54],[55,56,57],[61,58,59],[59,60,61],[65,62,63],[63,64,65],[66,67,68],[69,70,71],[72,73,74],[80,72,74],[80,74,75],[75,76,77],[75,77,78],[80,75,78],[78,79,80],[84,81,82],[82,83,84],[88,85,86],[86,87,88],[87,86,89],[89,90,87],[94,91,92],[92,93,94],[98,95,96],[96,97,98],[99,100,101],[105,102,103],[105,103,104],[104,70,105],[109,106,107],[107,108,109],[111,110,91],[91,94,111],[115,112,113],[113,114,115],[119,116,117],[117,118,119],[120,121,122],[120,122,123],[123,124,125],[125,126,127],[123,125,127],[123,127,128],[123,128,129],[120,123,129],[133,120,129],[129,130,131],[133,129,131],[131,132,133],[134,135,136],[134,136,137],[142,134,137],[137,138,139],[142,137,139],[139,140,141],[139,141,142],[146,143,144],[144,145,146],[151,147,148],[151,148,149],[149,150,151],[155,152,153],[153,154,155],[92,116,119],[119,93,92],[159,156,157],[157,158,159],[117,160,161],[161,118,117],[163,95,98],[98,162,163],[59,58,163],[163,162,59],[164,165,166],[171,167,168],[171,168,169],[169,170,171],[175,172,173],[173,174,175],[176,177,178],[179,180,181],[182,183,184],[181,182,184],[181,184,185],[179,181,185],[179,185,186],[179,186,187],[189,179,187],[187,188,189],[154,153,84],[84,83,154],[193,190,191],[191,192,193],[197,194,195],[195,196,197],[201,198,199],[199,200,201],[140,202,203],[207,204,205],[205,206,207],[211,208,209],[209,210,211],[212,213,214],[212,214,215],[216,217,218],[218,219,220],[216,218,220],[220,221,222],[222,223,224],[224,225,226],[226,227,228],[226,228,229],[226,229,230],[224,226,230],[230,231,232],[224,230,232],[222,224,232],[220,222,232],[216,220,232],[216,232,233],[215,216,233],[212,215,233],[212,233,234],[161,160,235],[235,236,161],[235,152,155],[155,236,235],[240,237,238],[238,239,240],[241,242,243],[248,244,245],[248,245,246],[246,247,248],[249,250,251],[107,252,253],[253,108,107],[254,255,256],[254,256,257],[257,258,259],[259,260,261],[259,261,262],[259,262,263],[263,264,265],[265,266,267],[265,267,268],[268,269,270],[265,268,270],[265,270,271],[263,265,271],[259,263,271],[257,259,271],[254,257,271],[271,272,273],[254,271,273],[273,274,275],[254,273,275],[275,276,277],[254,275,277],[254,277,278],[254,278,279],[254,279,280],[254,280,281],[254,281,282],[254,282,283],[286,254,283],[286,283,284],[284,285,286],[199,110,111],[111,200,199],[287,288,289],[290,291,292],[290,292,293],[293,294,295],[290,293,295],[304,290,295],[304,295,296],[304,296,297],[304,297,298],[298,299,300],[304,298,300],[300,301,302],[304,300,302],[302,303,304],[305,306,102],[307,305,308],[253,252,204],[204,207,253],[313,309,310],[313,310,311],[311,312,313],[317,314,315],[315,316,317],[82,81,198],[198,201,82],[205,208,211],[211,206,205],[89,106,109],[109,90,89],[324,318,319],[324,319,320],[324,320,321],[324,321,322],[322,323,324],[325,326,327],[325,327,328],[337,325,328],[328,329,330],[337,328,330],[337,330,331],[337,331,332],[337,332,333],[333,334,335],[337,333,335],[335,336,337],[210,209,61],[61,60,210],[96,85,88],[88,97,96],[338,339,340],[340,341,342],[342,343,344],[340,342,344],[340,344,345],[338,340,345],[338,345,346],[338,346,347],[349,338,347],[347,348,349],[353,350,351],[351,352,353],[46,47,27],[46,27,28],[215,46,28],[28,168,169],[215,28,169],[169,214,215],[342,15,14],[14,193,192],[342,14,192],[192,343,342],[8,9,65],[8,65,62],[8,62,312],[312,313,8],[35,34,136],[136,135,51],[35,136,51],[51,54,35],[52,134,135],[135,51,52],[55,282,281],[55,281,132],[55,132,131],[55,131,96],[56,55,96],[96,95,56],[18,17,228],[228,227,353],[18,228,353],[353,352,18],[16,151,150],[16,150,228],[228,17,16],[77,76,266],[266,265,77],[44,47,27],[44,27,26],[217,44,26],[26,218,217],[220,219,25],[25,24,220],[310,311,288],[310,288,289],[289,174,175],[310,289,175],[310,175,269],[269,270,310],[28,29,67],[67,68,167],[28,67,167],[167,168,28],[321,322,32],[32,33,321],[1,239,240],[240,306,102],[1,240,102],[102,0,1],[302,253,207],[207,303,302],[88,297,298],[298,87,88],[201,336,337],[337,200,201],[179,107,252],[179,252,177],[177,189,179],[254,255,100],[100,101,254],[241,182,181],[241,181,89],[242,241,89],[242,89,86],[242,86,129],[129,128,242],[36,37,202],[202,203,144],[36,202,144],[144,145,36],[162,294,295],[295,98,162],[229,228,150],[150,149,229],[195,244,245],[195,245,69],[69,70,209],[195,69,209],[61,139,140],[61,140,202],[61,202,48],[209,61,48],[209,48,49],[195,209,49],[49,194,195],[194,49,197],[45,216,217],[217,44,45],[215,46,45],[45,216,215],[87,298,299],[299,90,87],[339,338,117],[117,116,339],[73,74,152],[73,152,153],[73,153,259],[259,260,73],[159,158,348],[348,347,159],[257,258,165],[165,166,257],[109,300,301],[301,108,109],[332,155,154],[154,333,332],[235,75,76],[76,266,267],[76,267,173],[235,76,173],[235,173,174],[235,174,289],[235,289,287],[287,160,235],[260,261,72],[72,73,260],[352,351,19],[19,18,352],[67,29,30],[67,30,324],[67,324,251],[251,249,67],[329,118,161],[161,330,329],[139,138,58],[58,61,139],[122,121,278],[278,277,122],[170,213,214],[214,169,170],[184,314,317],[317,185,184],[103,102,0],[0,43,103],[85,130,129],[129,86,85],[301,108,253],[253,302,301],[324,323,31],[31,30,324],[303,207,206],[206,304,303],[339,340,92],[92,116,339],[114,186,185],[114,185,317],[317,316,6],[114,317,6],[114,6,5],[5,115,114],[330,161,236],[236,331,330],[335,82,201],[201,336,335],[310,270,271],[271,309,310],[172,175,269],[269,268,172],[91,230,229],[91,229,149],[92,91,149],[92,149,148],[92,148,341],[341,340,92],[218,219,25],[25,26,218],[105,208,209],[209,70,105],[126,125,274],[274,273,126],[278,279,120],[120,121,278],[192,191,344],[344,343,192],[7,6,316],[7,316,315],[7,315,183],[183,182,7],[342,341,148],[148,147,342],[234,81,198],[198,233,234],[147,151,16],[147,16,15],[15,342,147],[222,223,21],[21,22,222],[137,138,58],[58,163,137],[167,68,66],[66,171,167],[10,9,65],[65,64,10],[222,221,23],[23,22,222],[248,244,195],[195,196,248],[94,326,327],[327,93,94],[283,282,55],[55,57,320],[55,320,319],[55,319,283],[237,240,306],[306,305,237],[351,350,226],[226,225,351],[50,48,202],[50,202,37],[37,38,50],[103,104,42],[42,43,103],[200,337,325],[325,111,200],[199,232,231],[231,110,199],[40,41,70],[70,71,246],[40,70,246],[246,247,40],[39,40,247],[39,247,248],[39,248,196],[196,197,39],[79,78,264],[264,263,79],[180,179,107],[107,106,180],[299,90,109],[109,300,299],[293,59,162],[162,294,293],[290,211,210],[210,291,290],[143,140,141],[141,146,143],[220,221,23],[23,24,220],[267,268,172],[172,173,267],[3,178,177],[3,177,189],[189,4,3],[74,75,235],[235,152,74],[127,126,273],[273,272,127],[261,262,80],[80,72,261],[96,131,130],[130,85,96],[127,272,271],[127,271,309],[127,309,313],[127,313,243],[127,243,242],[242,128,127],[111,325,326],[326,94,111],[83,334,335],[335,82,83],[224,223,21],[21,20,224],[124,123,276],[276,275,124],[256,257,166],[166,164,256],[304,206,211],[211,290,304],[97,296,297],[297,88,97],[66,67,249],[250,285,286],[250,286,99],[250,99,100],[100,255,256],[100,256,164],[250,100,164],[250,164,165],[165,258,259],[165,259,153],[250,165,153],[249,250,153],[249,153,84],[66,249,84],[66,84,212],[213,170,171],[213,171,66],[212,213,66],[321,33,34],[321,34,136],[321,136,56],[321,56,57],[57,320,321],[120,133,280],[280,279,120],[159,156,346],[346,347,159],[333,154,83],[83,334,333],[156,346,345],[156,345,190],[190,193,14],[156,190,14],[156,14,13],[13,157,156],[238,307,305],[305,237,238],[178,176,308],[178,308,2],[2,3,178],[64,63,11],[11,10,64],[180,181,89],[89,106,180],[163,137,136],[163,136,56],[56,95,163],[331,236,155],[155,332,331],[262,263,79],[79,80,262],[144,203,140],[140,143,144],[38,39,197],[313,8,7],[243,313,7],[243,7,182],[182,241,243],[264,265,77],[77,78,264],[53,54,35],[53,35,36],[142,53,36],[36,145,146],[142,36,146],[146,141,142],[158,348,349],[158,349,12],[158,12,13],[13,157,158],[125,124,275],[275,274,125],[176,204,205],[176,205,102],[176,102,305],[305,308,176],[286,254,101],[101,99,286],[142,53,52],[52,134,142],[49,50,38],[307,308,2],[2,1,239],[2,239,238],[2,238,307],[246,71,69],[69,245,246],[119,328,329],[329,118,119],[98,295,296],[296,97,98],[251,324,318],[318,284,285],[251,318,285],[285,250,251],[187,113,112],[112,188,187],[84,212,234],[234,81,84],[311,63,62],[62,312,311],[102,205,208],[208,105,102],[349,12,11],[287,349,11],[287,11,63],[287,63,311],[311,288,287],[280,281,132],[132,133,280],[327,93,119],[119,328,327],[183,315,314],[314,184,183],[114,186,187],[187,113,114],[283,319,318],[318,284,283],[60,292,293],[293,59,60],[338,117,160],[338,160,287],[287,349,338],[225,224,20],[225,20,19],[19,351,225],[322,323,31],[31,32,322],[291,210,60],[60,292,291],[4,5,115],[4,115,112],[4,112,188],[188,189,4],[49,38,197],[176,177,252],[252,204,176],[104,70,41],[41,42,104],[191,190,345],[345,344,191],[123,122,277],[277,276,123],[198,233,232],[232,199,198],[110,231,230],[230,91,110],[350,353,227],[227,226,350],[354,373,372],[354,372,371],[354,371,370],[354,370,369],[368,367,366],[368,366,365],[368,365,364],[369,368,364],[369,364,363],[369,363,362],[369,362,361],[369,361,360],[360,359,358],[369,360,358],[369,358,357],[354,369,357],[354,357,356],[356,355,354],[374,375,359],[359,360,374],[376,377,355],[355,356,376],[378,375,359],[359,358,378],[379,376,356],[356,357,379],[380,377,355],[355,354,380],[378,379,357],[357,358,378],[381,380,354],[354,373,381],[383,382,370],[370,369,383],[381,373,372],[372,384,381],[385,384,372],[372,371,385],[382,385,371],[371,370,382],[386,374,360],[360,361,386],[393,387,388],[393,388,389],[393,389,390],[393,390,391],[393,391,392],[393,392,386],[393,386,374],[374,375,378],[393,374,378],[379,376,377],[379,377,380],[379,380,381],[378,379,381],[378,381,384],[378,384,385],[378,385,382],[378,382,383],[378,383,393],[393,383,369],[369,368,393],[392,386,361],[361,362,392],[368,393,387],[387,367,368],[391,392,362],[362,363,391],[390,391,363],[363,364,390],[388,387,367],[367,366,388],[390,389,365],[365,364,390],[388,366,365],[365,389,388],[394,397,396],[396,395,394],[399,398,394],[394,397,399],[399,397,396],[396,400,399],[399,400,401],[401,398,399],[401,398,394],[394,395,401],[395,396,400],[400,401,395],[402,405,404],[404,403,402],[406,409,408],[408,407,406],[410,402,403],[403,411,410],[412,410,402],[402,405,412],[409,413,414],[414,406,409],[415,414,406],[406,407,415],[412,416,411],[411,410,412],[415,414,413],[413,417,415],[408,417,413],[413,409,408],[411,403,404],[404,416,411],[415,407,408],[408,417,415],[404,416,412],[412,405,404],[418,419,420],[421,418,420],[419,422,420],[423,422,424],[425,420,426],[423,424,427],[428,426,420],[429,430,423],[431,428,432],[429,433,430],[434,432,435],[436,437,430],[438,434,435],[439,440,437],[441,435,442],[439,443,440],[444,442,435],[445,440,446],[447,444,445],[420,422,430],[430,422,423],[428,420,432],[435,432,420],[437,445,430],[437,440,445],[444,435,445],[445,420,430],[435,420,445],[448,449,450],[448,451,449],[452,423,453],[452,429,423],[435,454,441],[454,455,441],[458,457,456],[457,459,456],[460,461,462],[460,463,461],[429,464,433],[429,452,464],[441,455,442],[455,465,442],[466,467,468],[466,469,467],[433,470,430],[433,464,470],[442,465,444],[465,471,444],[472,449,473],[472,450,449],[475,458,474],[458,456,474],[476,430,470],[476,436,430],[477,447,471],[447,444,471],[466,478,479],[466,468,478],[480,436,476],[480,437,436],[445,477,447],[445,481,477],[482,437,480],[482,439,437],[446,481,445],[446,483,481],[484,439,482],[484,443,439],[483,440,485],[483,446,440],[485,443,484],[485,440,443],[487,475,486],[475,474,486],[478,488,479],[478,489,488],[490,473,491],[490,472,473],[492,486,487],[492,493,486],[495,491,494],[491,490,494],[489,496,488],[489,497,496],[498,495,499],[498,494,495],[500,493,492],[500,501,493],[497,502,496],[497,503,502],[504,500,505],[504,501,500],[503,506,502],[503,507,506],[508,505,509],[508,504,505],[507,509,506],[507,508,509],[461,510,462],[461,511,510],[512,513,514],[512,515,513],[513,516,515],[516,517,515],[517,518,516],[517,519,518],[521,514,520],[514,512,520],[519,522,518],[519,523,522],[522,524,521],[521,514,513],[522,525,524],[516,518,513],[518,522,513],[513,522,521],[523,525,522],[523,526,525],[527,524,520],[524,521,520],[526,524,525],[526,527,524],[528,529,530],[528,531,529],[532,530,533],[532,528,530],[531,534,529],[531,535,534],[532,536,537],[532,533,536],[533,530,536],[536,530,538],[539,538,540],[540,530,529],[540,529,534],[538,530,540],[534,540,535],[540,541,535],[541,539,540],[541,542,539],[543,538,537],[538,536,537],[539,538,542],[538,543,542],[544,545,546],[544,547,545],[545,548,547],[548,549,547],[549,550,548],[549,551,550],[552,546,553],[552,544,546],[554,553,555],[554,552,553],[550,556,551],[556,557,551],[544,552,547],[547,552,549],[551,549,558],[557,551,558],[552,554,559],[560,558,561],[560,561,562],[561,552,559],[549,552,561],[558,549,561],[559,555,563],[559,554,555],[556,564,557],[564,558,557],[564,565,558],[565,560,558],[566,563,561],[563,559,561],[565,567,560],[567,562,560],[562,566,567],[562,561,566],[568,569,570],[568,571,569],[569,572,571],[572,573,571],[571,574,573],[571,568,574],[574,570,575],[574,568,570],[463,576,460],[576,577,460],[572,575,573],[575,574,573],[577,462,510],[577,460,462],[511,510,576],[510,577,576],[578,579,580],[578,581,579],[581,582,579],[581,583,582],[578,584,585],[578,580,584],[583,586,582],[583,587,586],[584,588,585],[584,589,588],[587,590,586],[587,591,590],[589,592,588],[589,593,592],[591,594,590],[591,595,594],[592,596,593],[596,597,593],[595,598,594],[595,599,598],[596,600,597],[600,601,597],[599,602,598],[599,603,602],[600,604,601],[604,605,601],[603,606,602],[603,607,606],[604,608,605],[608,609,605],[610,611,612],[613,614,612],[611,609,605],[615,613,616],[601,597,605],[617,616,618],[593,589,597],[619,618,616],[620,621,619],[584,580,589],[622,620,623],[579,582,580],[606,623,602],[586,590,582],[598,602,582],[590,594,582],[594,598,582],[612,611,605],[613,612,616],[597,589,605],[619,616,623],[620,619,623],[580,582,589],[602,623,582],[589,612,605],[612,623,616],[589,582,612],[582,623,612],[607,623,606],[607,624,623],[625,626,627],[625,628,626],[629,627,630],[629,625,627],[628,631,626],[628,632,631],[633,630,634],[633,629,630],[632,635,631],[632,636,635],[637,634,638],[637,633,634],[636,639,635],[636,640,639],[642,638,641],[638,637,641],[640,643,639],[640,644,643],[611,609,645],[609,608,645],[624,622,623],[624,646,622],[648,642,647],[642,641,647],[644,649,643],[644,650,649],[652,648,651],[648,647,651],[650,653,649],[650,654,653],[610,611,655],[611,645,655],[657,652,656],[652,651,656],[646,620,622],[646,658,620],[654,659,653],[654,660,659],[630,648,634],[634,642,638],[630,627,626],[648,642,634],[635,626,631],[648,657,652],[639,661,635],[648,662,657],[639,643,649],[663,662,664],[661,649,653],[664,665,666],[661,653,659],[667,668,665],[669,670,661],[667,665,671],[671,670,672],[673,671,672],[672,674,673],[635,648,630],[635,630,626],[635,661,648],[639,649,661],[648,664,662],[664,671,665],[661,670,671],[648,661,664],[661,671,664],[662,657,675],[657,656,675],[660,661,659],[660,676,661],[663,662,677],[662,675,677],[612,610,678],[610,655,678],[658,621,620],[658,679,621],[676,669,661],[676,680,669],[664,663,681],[663,677,681],[680,670,669],[680,682,670],[614,612,683],[612,678,683],[666,664,684],[664,681,684],[621,619,679],[619,685,679],[682,672,670],[682,686,672],[665,666,687],[666,684,687],[672,674,686],[674,688,686],[668,665,689],[665,687,689],[613,614,690],[614,683,690],[674,673,688],[673,691,688],[619,618,685],[618,692,685],[667,668,693],[668,689,693],[673,671,691],[671,694,691],[671,667,694],[667,693,694],[615,613,695],[613,690,695],[618,617,692],[617,696,692],[616,615,697],[615,695,697],[617,616,696],[616,697,696],[698,699,700],[698,701,699],[701,702,699],[701,703,702],[704,700,705],[704,698,700],[703,706,702],[703,707,706],[708,705,709],[708,704,705],[707,710,706],[707,711,710],[712,709,713],[712,708,709],[710,714,711],[714,715,711],[716,713,717],[716,712,713],[714,718,715],[718,719,715],[720,717,721],[720,716,717],[718,722,719],[722,723,719],[724,721,725],[724,720,721],[722,726,723],[726,727,723],[728,725,729],[728,724,725],[730,727,731],[732,731,719],[733,732,719],[727,723,719],[734,735,733],[734,736,735],[715,711,719],[737,738,736],[711,707,701],[737,736,734],[701,707,703],[739,734,740],[698,704,701],[740,734,741],[742,741,734],[708,701,704],[728,743,742],[712,716,708],[728,742,724],[716,720,724],[731,727,719],[708,733,719],[708,734,733],[711,708,719],[711,701,708],[734,724,742],[708,716,724],[708,724,734],[726,744,727],[744,730,727],[743,729,745],[743,728,729],[746,747,748],[746,749,747],[731,730,750],[730,744,750],[751,743,745],[751,742,743],[750,752,731],[752,732,731],[753,742,751],[753,741,742],[754,755,756],[754,757,755],[758,759,760],[758,761,759],[752,762,732],[762,733,732],[740,753,763],[740,741,753],[762,764,733],[764,735,733],[763,740,765],[740,739,765],[767,748,766],[748,746,766],[764,768,735],[768,736,735],[769,765,734],[765,739,734],[770,771,772],[770,773,771],[774,775,776],[774,777,775],[768,778,736],[778,738,736],[779,769,737],[769,734,737],[778,779,738],[779,737,738],[767,747,780],[767,748,747],[781,782,783],[756,749,754],[756,747,749],[780,782,781],[747,782,780],[747,756,782],[784,756,755],[784,782,756],[755,758,757],[784,786,785],[760,755,784],[784,785,787],[760,758,755],[760,784,787],[759,788,787],[760,759,787],[788,789,790],[790,789,791],[788,759,777],[777,759,761],[777,761,775],[789,788,777],[792,789,777],[774,792,777],[774,771,776],[774,773,771],[794,792,793],[795,773,774],[795,774,792],[795,792,794],[773,770,796],[795,773,796],[780,767,781],[767,766,781],[469,797,467],[469,798,797],[784,782,786],[782,783,786],[799,797,798],[799,800,797],[770,801,796],[770,772,801],[799,802,800],[799,803,802],[804,803,805],[804,802,803],[453,427,806],[453,423,427],[806,424,807],[806,427,424],[804,808,805],[808,809,805],[807,422,810],[807,424,422],[791,793,789],[793,792,789],[785,790,787],[790,788,787],[810,419,811],[810,422,419],[812,418,811],[418,419,811],[808,813,809],[813,814,809],[815,421,812],[421,418,812],[421,815,420],[815,816,420],[813,817,814],[817,818,814],[794,801,795],[801,796,795],[420,816,425],[816,819,425],[425,819,426],[819,820,426],[822,818,821],[818,817,821],[823,428,820],[428,426,820],[824,431,823],[431,428,823],[819,818,814],[816,814,809],[818,820,822],[805,815,809],[822,820,825],[805,803,811],[826,825,823],[799,810,803],[824,827,826],[798,807,799],[827,828,829],[798,469,453],[828,830,829],[452,469,466],[831,832,830],[466,479,470],[833,834,832],[476,479,488],[833,457,834],[482,488,496],[454,458,457],[502,484,496],[455,475,458],[502,506,485],[487,475,455],[506,509,483],[492,487,465],[509,505,481],[492,471,500],[505,500,477],[819,820,818],[815,816,809],[819,814,816],[805,812,815],[825,820,823],[803,810,811],[805,811,812],[824,826,823],[799,807,810],[824,828,827],[806,807,798],[452,453,469],[453,806,798],[828,831,830],[452,466,464],[831,833,832],[470,479,476],[464,466,470],[480,476,488],[454,457,833],[484,482,496],[482,480,488],[454,455,458],[502,485,484],[506,483,485],[487,455,465],[483,509,481],[492,465,471],[481,505,477],[477,500,471],[431,824,432],[824,828,432],[825,822,835],[822,821,835],[432,828,434],[828,831,434],[434,831,438],[831,833,438],[438,833,435],[833,454,435],[826,825,836],[825,835,836],[836,837,826],[837,827,826],[837,838,827],[838,829,827],[830,829,839],[829,838,839],[832,830,840],[830,839,840],[834,832,841],[832,840,841],[457,834,459],[834,841,459],[842,843,844],[842,845,843],[846,847,848],[846,849,847],[850,851,852],[850,853,851],[854,855,856],[854,857,855],[858,448,859],[858,451,448],[845,860,842],[860,861,842],[854,862,856],[862,863,856],[856,864,863],[856,855,864],[857,864,855],[857,865,864],[861,844,866],[861,842,844],[843,847,849],[844,843,849],[844,849,866],[867,868,869],[866,867,869],[866,849,867],[846,867,849],[846,870,867],[870,872,871],[870,871,873],[852,846,873],[850,848,846],[850,846,852],[846,870,873],[864,863,865],[863,862,865],[852,874,873],[852,851,874],[853,874,851],[853,875,874],[877,859,876],[859,858,876],[866,861,869],[861,860,869],[870,867,872],[867,868,872],[878,879,880],[878,877,498],[879,881,880],[450,859,448],[472,490,494],[498,877,494],[450,877,859],[878,880,877],[472,494,450],[494,877,450],[880,882,883],[880,881,882],[877,883,876],[877,880,883],[884,881,879],[884,882,881],[874,873,875],[873,871,875],[885,499,498],[885,498,878],[886,887,888],[886,889,887],[890,887,889],[890,891,887],[879,884,878],[884,885,878],[892,888,893],[892,886,888],[890,894,891],[890,895,894],[896,893,897],[896,892,893],[898,894,895],[898,899,894],[896,900,901],[896,897,900],[902,899,898],[902,903,899],[905,900,904],[900,901,904],[902,906,903],[902,907,906],[909,905,908],[905,904,908],[907,910,906],[907,911,910],[913,909,912],[909,908,912],[911,914,910],[911,915,914],[917,913,916],[913,912,916],[903,906,899],[894,899,891],[918,906,910],[887,891,893],[918,910,914],[888,887,893],[919,920,918],[893,913,897],[913,900,897],[921,922,920],[909,905,900],[922,923,920],[909,900,913],[924,925,923],[917,913,926],[925,927,928],[913,929,926],[930,929,931],[928,931,929],[899,906,920],[891,899,920],[920,906,918],[923,893,891],[893,929,913],[923,891,920],[925,928,923],[928,929,923],[923,929,893],[915,918,914],[915,932,918],[926,917,933],[917,916,933],[932,919,918],[932,934,919],[929,926,935],[926,933,935],[934,920,919],[934,936,920],[930,929,937],[929,935,937],[936,921,920],[936,938,921],[939,931,937],[931,930,937],[938,921,940],[921,922,940],[941,928,939],[928,931,939],[922,923,940],[923,942,940],[927,928,943],[928,941,943],[923,924,942],[924,944,942],[945,925,943],[925,927,943],[924,925,944],[925,945,944],[726,750,744],[718,726,722],[752,750,718],[710,718,714],[752,718,762],[762,769,764],[706,699,710],[769,768,764],[699,706,702],[768,779,778],[705,699,700],[779,768,769],[769,763,765],[709,699,705],[713,717,709],[769,753,763],[753,769,751],[725,717,721],[751,729,745],[725,729,751],[718,750,726],[718,710,709],[718,709,762],[709,769,762],[710,699,709],[709,717,725],[751,769,725],[725,769,709],[857,865,854],[865,862,854],[907,898,902],[932,907,911],[932,911,915],[890,895,898],[936,932,934],[890,892,889],[892,886,889],[940,936,938],[892,912,896],[942,936,940],[912,901,896],[945,942,944],[904,901,908],[945,943,941],[908,901,912],[912,933,916],[935,941,939],[935,939,937],[933,912,935],[936,898,907],[936,907,932],[890,898,936],[890,942,892],[935,912,892],[890,936,942],[942,945,941],[941,935,942],[942,935,892],[528,537,532],[541,528,531],[541,531,535],[543,537,528],[542,543,541],[543,528,541],[847,860,845],[843,847,845],[871,872,875],[875,848,853],[853,848,850],[869,860,868],[848,868,847],[872,868,848],[847,868,860],[872,848,875],[645,678,655],[604,645,608],[690,683,678],[596,604,600],[690,697,695],[588,596,592],[697,692,696],[578,588,585],[697,685,692],[583,578,581],[658,679,685],[583,587,591],[646,658,624],[583,591,595],[624,603,607],[583,595,599],[583,599,603],[604,678,645],[690,678,697],[588,604,596],[583,588,578],[697,624,685],[624,658,685],[624,583,603],[588,678,604],[697,678,624],[583,678,588],[624,678,583],[772,801,776],[776,771,772],[801,794,793],[786,790,785],[783,766,746],[754,746,749],[757,758,761],[786,791,790],[775,757,761],[791,775,793],[766,783,781],[754,757,786],[793,775,776],[783,754,786],[801,793,776],[746,754,783],[786,775,791],[786,757,775],[553,545,546],[553,555,563],[566,567,565],[553,563,566],[550,564,556],[550,548,564],[548,545,553],[564,566,565],[548,553,566],[564,548,566],[572,569,575],[569,570,575],[628,629,625],[647,633,629],[636,628,632],[641,637,633],[636,640,676],[641,633,647],[640,644,650],[647,656,651],[676,650,654],[647,675,656],[676,654,660],[675,681,677],[682,676,680],[681,687,684],[694,682,686],[687,693,689],[686,688,691],[694,693,687],[694,686,691],[636,629,628],[647,629,636],[647,636,676],[676,640,650],[647,681,675],[676,682,694],[681,694,687],[647,676,681],[676,694,681],[858,451,449],[883,885,884],[883,884,882],[473,495,449],[473,491,495],[876,499,885],[858,449,876],[883,876,885],[499,876,495],[449,495,876],[463,461,576],[461,511,576],[800,804,802],[489,800,797],[468,797,467],[813,808,804],[489,468,478],[813,804,817],[817,835,821],[507,489,497],[507,497,503],[835,837,836],[504,507,508],[835,838,837],[838,840,839],[501,507,504],[501,493,486],[838,841,840],[841,456,459],[456,486,474],[817,804,800],[800,489,507],[489,797,468],[817,800,835],[835,501,838],[835,507,501],[456,501,486],[456,841,838],[835,800,507],[501,456,838],[520,523,527],[515,520,512],[523,526,527],[519,515,517],[519,523,515],[515,523,520]],"geoVertices":[[35.689994266026,139.691632324551],[35.690006485686,139.691714109428],[35.689950887022,139.691727576935],[35.689960330763,139.691786672138],[35.689896711346,139.691801369139],[35.689910245611,139.691889736793],[35.689737770414,139.691929706908],[35.689724776999,139.691841338483],[35.689669537437,139.691853589839],[35.68967222761,139.691872412435],[35.689392429482,139.691938094801],[35.689389921928,139.691921260743],[35.689333963985,139.691935833522],[35.689346864082,139.692021549968],[35.689159160763,139.692065855414],[35.689145540641,139.691981024338],[35.689105801733,139.69199081742],[35.689094910063,139.691926753404],[35.689036516088,139.691939341634],[35.689029892235,139.691902008299],[35.689008444351,139.691906023734],[35.688985737432,139.691759114539],[35.689007274408,139.691754215002],[35.689000188506,139.691707270039],[35.689057318852,139.691693247531],[35.689049324406,139.691640227297],[35.689092036239,139.69162910293],[35.689078503995,139.69154261452],[35.689270892933,139.691497194714],[35.689283610986,139.691581143527],[35.689337587308,139.691567789391],[35.68933613913,139.691555052611],[35.689613503357,139.691489373264],[35.689615491581,139.691501446196],[35.689670099368,139.69148853279],[35.689658104299,139.691406239643],[35.689829588599,139.691366933133],[35.689843116802,139.691449886671],[35.689904119996,139.691433315714],[35.689914290704,139.691497271096],[35.689970971634,139.691484353967],[35.689982954419,139.691556261451],[35.690006228563,139.691549270471],[35.690019029564,139.691627142987],[35.689085633456,139.691588222528],[35.689121191623,139.691579828799],[35.689114026118,139.691534231884],[35.689078503995,139.69154261452],[35.689843026874,139.691450063613],[35.689915489647,139.691505025334],[35.689904119996,139.691433315714],[35.689664101841,139.691447386213],[35.689686513115,139.691442473954],[35.689680479256,139.691401106458],[35.689658104299,139.691406239643],[35.689621683726,139.691577750025],[35.689670099368,139.69148853279],[35.689609391078,139.691502948598],[35.689749360125,139.691437810497],[35.689750704841,139.691446879281],[35.689773784772,139.691405128711],[35.68977222418,139.69139644702],[35.68967006458,139.691857290294],[35.689389921928,139.691921260743],[35.689392429482,139.691938094801],[35.68967222761,139.691872412435],[35.689247260955,139.691552403476],[35.689283700927,139.691580977635],[35.689278196742,139.69154541005],[35.689949248973,139.691530554942],[35.689983008384,139.691556161915],[35.689977416957,139.691523058093],[35.68941411941,139.691702914326],[35.689412712137,139.691694287641],[35.689387980384,139.691741819419],[35.689422913532,139.691769125756],[35.689400617689,139.691810896751],[35.689429191867,139.691803874436],[35.689422582361,139.691763447218],[35.689427745718,139.691762178522],[35.689417904076,139.691701990579],[35.689182297873,139.691574207315],[35.689183824687,139.691584833602],[35.689213069148,139.691534675334],[35.689211461363,139.691524181773],[35.689612698998,139.691686597628],[35.689589546573,139.691728105085],[35.689596863717,139.691726423768],[35.689620043105,139.691684849966],[35.689790028264,139.69189598174],[35.689788656671,139.69188702348],[35.689026151527,139.69186363129],[35.68922606582,139.692032049503],[35.689224448792,139.69202132392],[35.689034892471,139.691861638116],[35.689670099368,139.69148853279],[35.689577971963,139.691658285449],[35.689585261936,139.691656493685],[35.689674475233,139.691492115939],[35.689354235136,139.691636296066],[35.689374579798,139.691652247803],[35.689371482648,139.691632299019],[35.689994266026,139.691632324551],[35.690019029564,139.691627142987],[35.690006228563,139.691549270471],[35.689958377153,139.691604809841],[35.689815006628,139.691851156323],[35.689851800682,139.691881962079],[35.689850411061,139.691873003845],[35.689813617004,139.691842198093],[35.689048143912,139.691824402271],[35.689056875843,139.691822409109],[35.689902542871,139.69183942245],[35.689880753642,139.691844432954],[35.689888465433,139.691894780414],[35.689910245611,139.691889736793],[35.6892506128,139.691988263798],[35.689287253668,139.692019135964],[35.689285627625,139.69200841039],[35.689248986754,139.691977538229],[35.689576562017,139.691662707501],[35.689572551957,139.691663587455],[35.689581747974,139.691726616218],[35.689585758034,139.691725736267],[35.689592391504,139.691771201821],[35.689621876711,139.691764730311],[35.689626429199,139.691795880182],[35.689657031817,139.691789163628],[35.689655979839,139.691783729422],[35.689589546573,139.691728105085],[35.689612698998,139.691686597628],[35.689577971963,139.691658285449],[35.689604136064,139.691610077015],[35.689569973951,139.691617562303],[35.689686513115,139.691442473954],[35.689664101841,139.691447386213],[35.689670099368,139.69148853279],[35.689716092584,139.691408932297],[35.689749360125,139.691437810497],[35.689772278132,139.691396336435],[35.689807652467,139.691423166865],[35.689798905261,139.691373970425],[35.689680479256,139.691401106458],[35.689807679469,139.691423133671],[35.68983733331,139.691414451929],[35.689829588599,139.691366933133],[35.689798905261,139.691373970425],[35.689145540641,139.691981024338],[35.689160805208,139.691977075069],[35.689094028767,139.691920821736],[35.689094910063,139.691926753404],[35.689105801733,139.69199081742],[35.689387980384,139.691741819419],[35.689417244774,139.691685562064],[35.68940854937,139.691687952945],[35.689379293952,139.691744177131],[35.689320686543,139.692027728258],[35.689346864082,139.692021549968],[35.689340023313,139.691976018605],[35.689313548404,139.691982263727],[35.689333963985,139.691935833522],[35.689328775968,139.691931456278],[35.689717356088,139.691417923879],[35.689716092584,139.691408932297],[35.689391811852,139.691665752201],[35.689410388203,139.69168032597],[35.689407419057,139.691661912743],[35.689278196742,139.69154541005],[35.689270892933,139.691497194714],[35.689234956301,139.691505677556],[35.689241595251,139.691548071302],[35.689247215978,139.691552480897],[35.689404797681,139.691847229119],[35.689399331564,139.691813307677],[35.689379239239,139.691850975625],[35.689379602539,139.691853317344],[35.689950887022,139.691727576935],[35.689896711346,139.691801369139],[35.689960330763,139.691786672138],[35.689851800682,139.691881962079],[35.689815006628,139.691851156323],[35.689790028264,139.69189598174],[35.689724776999,139.691841338483],[35.689730328594,139.691878972351],[35.689756813744,139.691873776792],[35.689764209408,139.691923583337],[35.689888465433,139.691894780414],[35.689880753642,139.691844432954],[35.689902542871,139.69183942245],[35.689896711346,139.691801369139],[35.689198080145,139.692056671494],[35.689191242814,139.692014057101],[35.689152350709,139.692023439872],[35.689159160763,139.692065855414],[35.689915516623,139.691504970041],[35.68994210375,139.691525142554],[35.689938206638,139.691491825822],[35.689914290704,139.691497271096],[35.689151296062,139.691548098512],[35.689012991731,139.691794787221],[35.689021732675,139.69179279404],[35.689152913119,139.691558813026],[35.689843053863,139.69145001937],[35.68983733331,139.691414451929],[35.689950887022,139.691727576935],[35.689994266026,139.691632324551],[35.689987228945,139.691634546788],[35.689946574039,139.691723805817],[35.689958377153,139.691604809841],[35.689982945419,139.691556272516],[35.689975709869,139.691558351474],[35.689951141589,139.691606877745],[35.689211398385,139.691524281324],[35.689241631215,139.691547993897],[35.689234956301,139.691505677556],[35.689114026118,139.691534231884],[35.689121191623,139.691579828799],[35.689085633456,139.691588222528],[35.689092036239,139.69162910293],[35.689049324406,139.691640227297],[35.689057318852,139.691693247531],[35.689000188506,139.691707270039],[35.689007274408,139.691754215002],[35.688985737432,139.691759114539],[35.689008444351,139.691906023734],[35.689029892235,139.691902008299],[35.689054969502,139.691895323687],[35.689061811126,139.69193388307],[35.689094910063,139.691926753404],[35.689094028767,139.691920821736],[35.689026151527,139.69186363129],[35.689048143912,139.691824402271],[35.689012991731,139.691794787221],[35.689151296062,139.691548098512],[35.689182297873,139.691574207315],[35.689422913532,139.691769125756],[35.68941416394,139.691771428333],[35.689972463888,139.691679973053],[35.689981488815,139.691720164244],[35.690006485686,139.691714109428],[35.689999881679,139.691670720796],[35.689724776999,139.691841338483],[35.689655979839,139.691783729422],[35.689669537437,139.691853589839],[35.689942148714,139.691525054083],[35.68994929395,139.69153047752],[35.689977416957,139.691523058093],[35.689970971634,139.691484353967],[35.689938206638,139.691491825822],[35.689283727916,139.691580933391],[35.689348912059,139.691632051666],[35.689337587308,139.691567789391],[35.689896711346,139.691801369139],[35.689892560352,139.691797376754],[35.689371482648,139.691632299019],[35.689374534846,139.691652347322],[35.6893917669,139.691665851721],[35.689407419057,139.691661912743],[35.689410343252,139.691680425489],[35.689417145858,139.691685761119],[35.689412712137,139.691694287641],[35.68941411941,139.691702914326],[35.689417904076,139.691701990579],[35.689427745718,139.691762178522],[35.689422582361,139.691763447218],[35.689429191867,139.691803874436],[35.689400617689,139.691810896751],[35.689399331564,139.691813307677],[35.689404797681,139.691847229119],[35.689379602539,139.691853317344],[35.689388513893,139.691911971126],[35.689668331281,139.691847349333],[35.689657031817,139.691789163628],[35.689626429199,139.691795880182],[35.689621876711,139.691764730311],[35.689592391504,139.691771201821],[35.689585758034,139.691725736267],[35.689581747974,139.691726616218],[35.689572551957,139.691663587455],[35.689576562017,139.691662707501],[35.689569973951,139.691617562303],[35.689604136064,139.691610077015],[35.689621683726,139.691577750025],[35.689610562212,139.69151005097],[35.689338431278,139.691572627301],[35.689348831105,139.691632195445],[35.689354181158,139.691636384553],[35.689333963985,139.691935833522],[35.689389921928,139.691921260743],[35.689379239239,139.691850975625],[35.689951141589,139.691606877745],[35.689975709869,139.691558351474],[35.689773784772,139.691405128711],[35.689750704841,139.691446879281],[35.689717356088,139.691417923879],[35.689674475233,139.691492115939],[35.689585261936,139.691656493685],[35.689620043105,139.691684849966],[35.689596863717,139.691726423768],[35.689788656671,139.69188702348],[35.689813617004,139.691842198093],[35.689850411061,139.691873003845],[35.689892560352,139.691797376754],[35.689946574039,139.691723805817],[35.689987228945,139.691634546788],[35.689972463888,139.691679973053],[35.689999881679,139.691670720796],[35.689981488815,139.691720164244],[35.689950887022,139.691727576935],[35.689668331281,139.691847349333],[35.689388513893,139.691911971126],[35.689389921928,139.691921260743],[35.68967006458,139.691857290294],[35.689669537437,139.691853589839],[35.689756813744,139.691873776792],[35.689730328594,139.691878972351],[35.689737770414,139.691929706908],[35.689764209408,139.691923583337],[35.689338431278,139.691572627301],[35.689610562212,139.69151005097],[35.689609391078,139.691502948598],[35.689615491581,139.691501446196],[35.689613503357,139.691489373264],[35.68933613913,139.691555052611],[35.689337587308,139.691567789391],[35.689056875843,139.691822409109],[35.689034892471,139.691861638116],[35.689224448792,139.69202132392],[35.689248986754,139.691977538229],[35.689285627625,139.69200841039],[35.689328775968,139.691931456278],[35.68941416394,139.691771428333],[35.689379293952,139.691744177131],[35.68940854937,139.691687952945],[35.689213069148,139.691534675334],[35.689183824687,139.691584833602],[35.689152913119,139.691558813026],[35.689021732675,139.69179279404],[35.689287253668,139.692019135964],[35.6892506128,139.691988263798],[35.68922606582,139.692032049503],[35.689160805208,139.691977075069],[35.689145540641,139.691981024338],[35.689152350709,139.692023439872],[35.689191242814,139.692014057101],[35.689198080145,139.692056671494],[35.689320686543,139.692027728258],[35.689313548404,139.691982263727],[35.689340023313,139.691976018605],[35.689333963985,139.691935833522],[35.689054969502,139.691895323687],[35.689029892235,139.691902008299],[35.689036516088,139.691939341634],[35.689061811126,139.69193388307],[35.689504035331,139.691622308418],[35.689500937682,139.691601939746],[35.68950719151,139.691600514426],[35.689510316551,139.691621181371],[35.689538125349,139.691614834315],[35.689534600634,139.691591560531],[35.689540971613,139.691590112904],[35.689554870481,139.691681794154],[35.68955447969,139.691686733701],[35.689553797446,139.69168911042],[35.689552078615,139.691691477923],[35.689547286484,139.691694160227],[35.689540338784,139.691695741452],[35.689539003387,139.691686915747],[35.68954815884,139.691684822368],[35.689538965649,139.69162421334],[35.689515103776,139.691629647403],[35.689510785184,139.691628771129],[35.689508332631,139.691628068338],[35.689506266314,139.691626215779],[35.689540971613,139.691590112904],[35.689534600634,139.691591560531],[35.68950719151,139.691600514426],[35.689500937682,139.691601939746],[35.689538125349,139.691614834315],[35.689510316551,139.691621181371],[35.689504035331,139.691622308418],[35.689506266314,139.691626215779],[35.689515103776,139.691629647403],[35.689538965649,139.69162421334],[35.689508332631,139.691628068338],[35.689510785184,139.691628771129],[35.689554870481,139.691681794154],[35.689539003387,139.691686915747],[35.689540338784,139.691695741452],[35.689547286484,139.691694160227],[35.689552078615,139.691691477923],[35.689553797446,139.69168911042],[35.68955447969,139.691686733701],[35.68954815884,139.691684822368],[35.689153929529,139.691595272402],[35.689383137549,139.691778035133],[35.68928178662,139.691969027984],[35.689052578886,139.691786264936],[35.689153929529,139.691595272402],[35.689052578886,139.691786264936],[35.68928178662,139.691969027984],[35.689383137549,139.691778035133],[35.68924887737,139.691631477264],[35.689281609789,139.691657583071],[35.689266878005,139.691685330701],[35.689234145604,139.691659235937],[35.689295241896,139.691645151095],[35.68932078534,139.691666960577],[35.689315505232,139.691676250958],[35.68928996179,139.691654441475],[35.68924887737,139.691631477264],[35.689281609789,139.691657583071],[35.689234145604,139.691659235937],[35.68928996179,139.691654441475],[35.689295241896,139.691645151095],[35.68932078534,139.691666960577],[35.689266878005,139.691685330701],[35.689315505232,139.691676250958],[35.689788498023,139.691782721875],[35.689787030274,139.691783984046],[35.689791912713,139.691781445215],[35.689790146513,139.691781857146],[35.689785806311,139.691785599352],[35.689784082908,139.691791745601],[35.689784880124,139.691787490355],[35.689793706474,139.691781475193],[35.689795455712,139.691781969304],[35.689784296677,139.691789568584],[35.689797079265,139.691782894546],[35.689784238725,139.691793944062],[35.689785640574,139.691797963395],[35.689798513999,139.691784217883],[35.689799687726,139.691785873149],[35.689784763987,139.69179604243],[35.689800564326,139.691787805163],[35.689801245392,139.691792090945],[35.689786814313,139.69179962971],[35.689788249034,139.691800941998],[35.689801089587,139.691789903532],[35.689789881614,139.691801878273],[35.689793424613,139.691802402363],[35.689801031636,139.69179427901],[35.689800448189,139.69179635724],[35.689791621838,139.691802372401],[35.689799522001,139.691798248243],[35.689796830276,139.691801114671],[35.689795181786,139.691801979399],[35.689798307051,139.691799863533],[35.689821837645,139.691788651494],[35.689830309166,139.691795166448],[35.689830309166,139.691795166448],[35.689821837645,139.691788651494],[35.689784238725,139.691793944062],[35.689784082908,139.691791745601],[35.689801245392,139.691792090945],[35.689801031636,139.69179427901],[35.689816411308,139.691796240649],[35.689817072709,139.691791466341],[35.689816411308,139.691796240649],[35.689817072709,139.691791466341],[35.689454833653,139.691763688551],[35.689465057904,139.691827334154],[35.689465057904,139.691827334154],[35.689454833653,139.691763688551],[35.689784763987,139.69179604243],[35.689800448189,139.69179635724],[35.689780538975,139.691798093946],[35.689779550963,139.691793399897],[35.689780538975,139.691798093946],[35.689779550963,139.691793399897],[35.689785640574,139.691797963395],[35.689799522001,139.691798248243],[35.689827197591,139.691801259908],[35.689827197591,139.691801259908],[35.689814965393,139.691800740118],[35.689814965393,139.691800740118],[35.689786814313,139.69179962971],[35.689798307051,139.691799863533],[35.68978229272,139.691802422027],[35.68978229272,139.691802422027],[35.689788249034,139.691800941998],[35.689796830276,139.691801114671],[35.689789881614,139.691801878273],[35.689795181786,139.691801979399],[35.689791621838,139.691802372401],[35.689793424613,139.691802402363],[35.689812779798,139.69180476579],[35.689812779798,139.69180476579],[35.689784748896,139.691806207471],[35.689784748896,139.691806207471],[35.689837365202,139.691809064593],[35.689837365202,139.691809064593],[35.689809962491,139.69180815174],[35.689809962491,139.69180815174],[35.689839496547,139.691804895379],[35.689839496547,139.691804895379],[35.689787790143,139.691809295798],[35.689787790143,139.691809295798],[35.689849059696,139.691812237078],[35.689849059696,139.691812237078],[35.689806621456,139.691810743092],[35.689806621456,139.691810743092],[35.689791281073,139.691811532565],[35.689791281073,139.691811532565],[35.689802927823,139.691812429053],[35.689802927823,139.691812429053],[35.689795086377,139.691812829617],[35.689795086377,139.691812829617],[35.689799025731,139.691813143077],[35.689799025731,139.691813143077],[35.689567451483,139.691802613708],[35.689567451483,139.691802613708],[35.689182606545,139.691897948974],[35.689177695914,139.691907183427],[35.689182606545,139.691897948974],[35.689177695914,139.691907183427],[35.689167573052,139.691899102493],[35.689167573052,139.691899102493],[35.689161016592,139.691911466673],[35.689161016592,139.691911466673],[35.689206740785,139.691917186611],[35.689206740785,139.691917186611],[35.689180414211,139.691926933963],[35.689180414211,139.691926933963],[35.689188654273,139.691951271076],[35.689173785781,139.691939419806],[35.689173785781,139.691939419806],[35.689188654273,139.691951271076],[35.689213760678,139.691616733913],[35.689203975489,139.691635180698],[35.689213760678,139.691616733913],[35.689203975489,139.691635180698],[35.689210810435,139.691614385726],[35.689210810435,139.691614385726],[35.689222073951,139.691649611636],[35.689222073951,139.691649611636],[35.689221468035,139.691594313212],[35.689221468035,139.691594313212],[35.689245764726,139.691613683065],[35.689234351638,139.691635171172],[35.68923110367,139.691632591485],[35.68923110367,139.691632591485],[35.689234351638,139.691635171172],[35.689245764726,139.691613683065],[35.689459971108,139.691717406751],[35.689455712406,139.691690819618],[35.689459971108,139.691717406751],[35.689455712406,139.691690819618],[35.689464119815,139.691688804907],[35.689464119815,139.691688804907],[35.689462621559,139.6916794602],[35.689462621559,139.6916794602],[35.689467306189,139.691715648062],[35.689467306189,139.691715648062],[35.68946816887,139.691721071539],[35.68946816887,139.691721071539],[35.689477210622,139.691675965056],[35.689477210622,139.691675965056],[35.68947859092,139.69168464704],[35.689484650261,139.691717109005],[35.68948298836,139.691683589621],[35.689483533299,139.691710072839],[35.689487092701,139.691709215783],[35.689484650261,139.691717109005],[35.68947859092,139.69168464704],[35.68948298836,139.691683589621],[35.689483533299,139.691710072839],[35.689487092701,139.691709215783],[35.689499732542,139.691711458462],[35.689498022607,139.691698401699],[35.689499732542,139.691711458462],[35.689498022607,139.691698401699],[35.68950698915,139.691696629075],[35.68950698915,139.691696629075],[35.689508699085,139.69170968584],[35.689508699085,139.69170968584],[35.689557227232,139.691738979076],[35.689557227232,139.691738979076],[35.689634764522,139.691655953144],[35.689634400813,139.691660925796],[35.689634764522,139.691655953144],[35.689634400813,139.691660925796],[35.68963489339,139.691665885884],[35.68963489339,139.691665885884],[35.689635957724,139.691651177906],[35.689635957724,139.691651177906],[35.689636205938,139.691670612496],[35.689636205938,139.691670612496],[35.689637944611,139.691646810074],[35.689637944611,139.691646810074],[35.689638302169,139.691674906814],[35.689638302169,139.691674906814],[35.689640617239,139.69164303767],[35.689640617239,139.69164303767],[35.689641082698,139.691678570136],[35.689641082698,139.691678570136],[35.68964388568,139.691640037636],[35.68964388568,139.691640037636],[35.689644412125,139.691681436965],[35.689644412125,139.691681436965],[35.689647578817,139.691637931812],[35.689647578817,139.691637931812],[35.689648164129,139.691683397038],[35.689648164129,139.691683397038],[35.689651552548,139.691636819893],[35.689651552548,139.691636819893],[35.689652167346,139.691684362264],[35.689652167346,139.691684362264],[35.68965562664,139.691636735346],[35.68965562664,139.691636735346],[35.689663381862,139.691639660641],[35.689659629857,139.69163770057],[35.689666711303,139.691642538518],[35.689671588052,139.691650485111],[35.689669491821,139.691646190791],[35.689672909615,139.691655211708],[35.689673393178,139.691660171815],[35.689673038495,139.691665155502],[35.689671836279,139.691669930758],[35.689669858392,139.691674287526],[35.689663917321,139.691681059964],[35.68966717675,139.691678059947],[35.68966021517,139.691683165803],[35.689656241438,139.691684277719],[35.689656241438,139.691684277719],[35.689654461783,139.691711560624],[35.689654563494,139.69171373708],[35.689654461783,139.691711560624],[35.689654563494,139.69171373708],[35.689654738686,139.691709416646],[35.689654738686,139.691709416646],[35.689655025662,139.691715835556],[35.689655025662,139.691715835556],[35.689655367252,139.691707382536],[35.689655367252,139.691707382536],[35.689655839154,139.691717756628],[35.689655839154,139.691717756628],[35.689656329557,139.691705546716],[35.689656329557,139.691705546716],[35.689656958839,139.691719445132],[35.689656958839,139.691719445132],[35.689657580652,139.691704008705],[35.689657580652,139.691704008705],[35.689658339543,139.691720812757],[35.689658339543,139.691720812757],[35.689659629857,139.69163770057],[35.68966021517,139.691683165803],[35.689659066518,139.691702823845],[35.689659066518,139.691702823845],[35.689659918094,139.69172179332],[35.689659918094,139.69172179332],[35.689660715098,139.691702036459],[35.689660715098,139.691702036459],[35.689661640369,139.69172235377],[35.689661640369,139.69172235377],[35.689663381862,139.691639660641],[35.689662463349,139.691701690852],[35.689662463349,139.691701690852],[35.689663917321,139.691681059964],[35.68966340718,139.691722461136],[35.68966340718,139.691722461136],[35.689665155417,139.691722104481],[35.689664239173,139.691701798202],[35.689665952422,139.691702347619],[35.689667539999,139.691703339214],[35.689670040376,139.691706384294],[35.689668920691,139.69170469579],[35.689671316049,139.691710414892],[35.689670853881,139.691708316416],[35.689666813024,139.691721328128],[35.689668298878,139.691720132219],[35.689671408746,139.691712591364],[35.689669549972,139.691718594209],[35.689671140857,139.691714735327],[35.689670512291,139.691716769438],[35.689664239173,139.691701798202],[35.689665155417,139.691722104481],[35.689665952422,139.691702347619],[35.689666711303,139.691642538518],[35.68966717675,139.691678059947],[35.689666813024,139.691721328128],[35.689667539999,139.691703339214],[35.689668298878,139.691720132219],[35.689669491821,139.691646190791],[35.689668920691,139.69170469579],[35.689669858392,139.691674287526],[35.689669549972,139.691718594209],[35.689670040376,139.691706384294],[35.689670512291,139.691716769438],[35.689670853881,139.691708316416],[35.689671588052,139.691650485111],[35.689671140857,139.691714735327],[35.689671836279,139.691669930758],[35.689671316049,139.691710414892],[35.689671408746,139.691712591364],[35.689672909615,139.691655211708],[35.689673038495,139.691665155502],[35.689673393178,139.691660171815],[35.689729102873,139.691496052085],[35.68972896233,139.691491522276],[35.689729102873,139.691496052085],[35.68972896233,139.691491522276],[35.689729588015,139.691487046356],[35.689729588015,139.691487046356],[35.689730018435,139.691500447934],[35.689730018435,139.691500447934],[35.689730962148,139.691482834284],[35.689730962148,139.691482834284],[35.689731654701,139.69150451104],[35.689731654701,139.69150451104],[35.68973302184,139.691479062956],[35.68973302184,139.691479062956],[35.689733939366,139.691508075798],[35.689733939366,139.691508075798],[35.689735668138,139.691475898279],[35.689735668138,139.691475898279],[35.689736782098,139.691510976632],[35.689736782098,139.691510976632],[35.68973880206,139.691473484065],[35.68973880206,139.691473484065],[35.689740056562,139.691513092229],[35.689740056562,139.691513092229],[35.689742270477,139.691471908977],[35.689742270477,139.691471908977],[35.689743618422,139.691514323403],[35.689743618422,139.691514323403],[35.689745938289,139.691471261645],[35.689745938289,139.691471261645],[35.689747314395,139.691514626231],[35.689747314395,139.691514626231],[35.689749634248,139.691471553422],[35.689753187108,139.69147279566],[35.689756461573,139.691474911256],[35.689759304306,139.691477812089],[35.689763655658,139.691498841538],[35.689761597985,139.691481376831],[35.689763234252,139.691485439938],[35.689764290357,139.6914943656],[35.689764149815,139.69148983579],[35.689762290539,139.691503053595],[35.689760230845,139.691506824925],[35.689757575533,139.691509989617],[35.689754450624,139.691512403814],[35.689750973193,139.691513978917],[35.689749634248,139.691471553422],[35.689750973193,139.691513978917],[35.689747480546,139.691617447212],[35.689753029441,139.691652727659],[35.689747480546,139.691617447212],[35.689753029441,139.691652727659],[35.689753187108,139.69147279566],[35.689754450624,139.691512403814],[35.689756461573,139.691474911256],[35.689757575533,139.691509989617],[35.689755732803,139.69165209309],[35.689756967883,139.691659924593],[35.689755732803,139.69165209309],[35.689756967883,139.691659924593],[35.689754255507,139.691660559178],[35.689759304854,139.691692625277],[35.689754255507,139.691660559178],[35.689759304854,139.691692625277],[35.689759304306,139.691477812089],[35.689760230845,139.691506824925],[35.689761597985,139.691481376831],[35.689762290539,139.691503053595],[35.689776397452,139.691610612023],[35.689776397452,139.691610612023],[35.689763234252,139.691485439938],[35.689763655658,139.691498841538],[35.689766043499,139.691735538439],[35.689760757936,139.691701881707],[35.689766043499,139.691735538439],[35.689760757936,139.691701881707],[35.689764659779,139.691700957749],[35.68976320671,139.691691712367],[35.689764659779,139.691700957749],[35.68976320671,139.691691712367],[35.689764149815,139.69148983579],[35.689764290357,139.6914943656],[35.689781946362,139.691645903531],[35.689781946362,139.691645903531],[35.689778945627,139.69164660492],[35.689778945627,139.69164660492],[35.689780171706,139.69165444749],[35.689783181442,139.691653735037],[35.689780171706,139.69165444749],[35.689783181442,139.691653735037],[35.689788221764,139.691685790114],[35.689784968736,139.69168656929],[35.689788221764,139.691685790114],[35.689784968736,139.69168656929],[35.689786421806,139.691695814674],[35.689786421806,139.691695814674],[35.689789674846,139.691695046547],[35.689789674846,139.691695046547],[35.689794969438,139.691728714324],[35.689779392054,139.691788571796],[35.689779392054,139.691788571796],[35.689780053454,139.691783797491],[35.689780053454,139.691783797491],[35.689794969438,139.691728714324],[35.689781499368,139.691779298023],[35.689781499368,139.691779298023],[35.689783684963,139.691775272352],[35.689783684963,139.691775272352],[35.689784296677,139.691789568584],[35.689784880124,139.691787490355],[35.689786502269,139.691771886402],[35.689786502269,139.691771886402],[35.689785806311,139.691785599352],[35.689787030274,139.691783984046],[35.689788498023,139.691782721875],[35.689789834289,139.691769295066],[35.689789834289,139.691769295066],[35.689790146513,139.691781857146],[35.689791912713,139.691781445215],[35.689793536936,139.691767609086],[35.689793536936,139.691767609086],[35.689793706474,139.691781475193],[35.689795455712,139.691781969304],[35.689797439027,139.69176689506],[35.689797439027,139.69176689506],[35.689797079265,139.691782894546],[35.689798513999,139.691784217883],[35.689801378381,139.691767208519],[35.689805183686,139.691768505569],[35.689808674617,139.691770742334],[35.689799687726,139.691785873149],[35.689811715864,139.691773830661],[35.689814172041,139.691777616105],[35.689800564326,139.691787805163],[35.6898159258,139.691781955237],[35.689801089587,139.691789903532],[35.689816904786,139.691786638255],[35.689801378381,139.691767208519],[35.689805183686,139.691768505569],[35.689808674617,139.691770742334],[35.689811715864,139.691773830661],[35.689814172041,139.691777616105],[35.6898159258,139.691781955237],[35.689816904786,139.691786638255],[35.689820657535,139.691597705921],[35.689826206449,139.691632997448],[35.689826206449,139.691632997448],[35.689820657535,139.691597705921],[35.689830144879,139.691640183338],[35.689828909798,139.691632351828],[35.689830144879,139.691640183338],[35.689828909798,139.691632351828],[35.68982744153,139.691640828957],[35.689832481868,139.6916728951],[35.68982744153,139.691640828957],[35.689832481868,139.6916728951],[35.689828900176,139.691562931393],[35.689831028749,139.69157937949],[35.689828900176,139.691562931393],[35.689831028749,139.69157937949],[35.689842233801,139.69174876195],[35.689842233801,139.69174876195],[35.689848979719,139.691591026456],[35.689848979719,139.691591026456],[35.689841435352,139.691560489495],[35.689841435352,139.691560489495],[35.689843563926,139.691576937595],[35.689843563926,139.691576937595],[35.689854519608,139.691626306961],[35.689852122633,139.691626874697],[35.689852122633,139.691626874697],[35.689854519608,139.691626306961],[35.689853348701,139.691634706225],[35.689855754689,139.691634138474],[35.689853348701,139.691634706225],[35.689855754689,139.691634138474],[35.68986079503,139.691666204628],[35.68986079503,139.691666204628],[35.689852094678,139.691756335144],[35.689852094678,139.691756335144],[35.689888476076,139.691735145278],[35.689862745764,139.691715380005],[35.689859010304,139.691742810072],[35.689851666387,139.691737055505],[35.689851666387,139.691737055505],[35.689859010304,139.691742810072],[35.689862745764,139.691715380005],[35.689888476076,139.691735145278],[35.689874945148,139.691603764143],[35.689874591521,139.691609642805],[35.689874945148,139.691603764143],[35.689874591521,139.691609642805],[35.689875247399,139.691615497583],[35.689875247399,139.691615497583],[35.689876299553,139.69159810469],[35.689876299553,139.69159810469],[35.689876867377,139.691621041286],[35.689876867377,139.691621041286],[35.6898785739,139.691592907664],[35.6898785739,139.691592907664],[35.689879406138,139.691626064064],[35.689879406138,139.691626064064],[35.689881678324,139.691588405253],[35.689881678324,139.691588405253],[35.689882728192,139.69163032308],[35.689882728192,139.69163032308],[35.689885486855,139.691584785511],[35.689885486855,139.691584785511],[35.689886707138,139.691633641774],[35.689886707138,139.691633641774],[35.689889819429,139.69158222554],[35.689889819429,139.69158222554],[35.689891162535,139.691635876829],[35.689891162535,139.691635876829],[35.689894495888,139.6915808251],[35.689894495888,139.6915808251],[35.689895904978,139.691636929141],[35.689895904978,139.691636929141],[35.68989929997,139.691580639817],[35.68989929997,139.691580639817],[35.68990070906,139.691636743861],[35.68990538552,139.691635343424],[35.689909718082,139.691632772406],[35.689913526628,139.691629163714],[35.689916631053,139.691624661302],[35.689918905401,139.691619464274],[35.689920259807,139.691613804818],[35.689920613421,139.691607915104],[35.689904042414,139.691581692125],[35.689919966569,139.691602071355],[35.689918337563,139.691596516617],[35.689908497812,139.691583927178],[35.689912476746,139.691587234822],[35.689915807828,139.691591504871],[35.68990070906,139.691636743861],[35.689904042414,139.691581692125],[35.68990538552,139.691635343424],[35.689908497812,139.691583927178],[35.689909718082,139.691632772406],[35.689912476746,139.691587234822],[35.689913526628,139.691629163714],[35.689915807828,139.691591504871],[35.689916631053,139.691624661302],[35.689918337563,139.691596516617],[35.689918905401,139.691619464274],[35.689919966569,139.691602071355],[35.689920259807,139.691613804818],[35.689920613421,139.691607915104]]};

  function convexHull(points) {
    const p=points.filter(q=>q&&q.every(Number.isFinite)).slice().sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
    const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
    const half=q=>{const h=[];for(const v of q){while(h.length>1&&cross(h[h.length-2],h[h.length-1],v)<=0)h.pop();h.push(v);}return h;};
    if(p.length<3)return p;
    const lo=half(p),hi=half(p.slice().reverse());lo.pop();hi.pop();return lo.concat(hi);
  }
  const castleWorldCache = new Map();
  function modelOutline(observer,target,model,{eyeM=1.5,heightM=null}={}) {
    const ground=target.groundM??0,top=heightM??((partOf(target,"tip")||target.parts[0]).m-ground);
    if(!(top>.5))return null;
    const ref=model.calibration?.observer;
    const bearing=ref?TR.bearing(target.latitude,target.longitude,ref.latitude,ref.longitude):model.referenceBearing;
    const key=`${model.id},${target.latitude},${target.longitude},${bearing}`;
    let world=castleWorldCache.get(key);
    if(!world){
      const places=new Map(),axis=(bearing-90)*R,depth=(bearing+180)*R;
      const mapped=new Map();
      const mapVertex=([x,y,z],index)=>{
        const vk=`${x},${y},${z}`;if(mapped.has(vk))return mapped.get(vk);
        const k=`${x},${y}`;let p=places.get(k);
        if(!p&&model.geoVertices){const [latitude,longitude]=model.geoVertices[index];p={latitude,longitude};places.set(k,p);}
        if(!p){const east=model.vertices?x:x*Math.sin(axis)+y*Math.sin(depth),north=model.vertices?y:x*Math.cos(axis)+y*Math.cos(depth);
          p=TR.destination(target.latitude,target.longitude,Math.atan2(east,north)/R,Math.hypot(east,north)/1000);places.set(k,p);}
        const result={place:p,z};mapped.set(vk,result);return result;
      };
      world=model.vertices?(model.faces||model.triangles).map(face=>face.map(i=>mapVertex(model.vertices[i],i))):model.solids.map(solid=>solid.map(mapVertex));
      if(castleWorldCache.size>=8)castleWorldCache.clear();castleWorldCache.set(key,world);
    }
    const d=TR.distanceKm(observer.latitude,observer.longitude,target.latitude,target.longitude);
    const az0=TR.bearing(observer.latitude,observer.longitude,target.latitude,target.longitude),eye=(observer.elevation??0)+eyeM;
    const sight=new Map(),projected=new Map();
    const polygons=world.map(solid=>convexHull(solid.map(vertex=>{
      if(projected.has(vertex))return projected.get(vertex);
      const {place,z}=vertex;
      let g=sight.get(place);if(!g){g={d:TR.distanceKm(observer.latitude,observer.longitude,place.latitude,place.longitude),az:TR.bearing(observer.latitude,observer.longitude,place.latitude,place.longitude)};sight.set(place,g);}
      const result=[az0+azDiff(g.az,az0),targetAngle(g.d,eye,ground+z*top/model.heightM)];projected.set(vertex,result);return result;
    }))).filter(p=>p.length>=3);
    const points=polygons.flat(),ang=h=>targetAngle(d,eye,ground+h);
    const viewTop=model.vertices?Math.max(...model.vertices.map(v=>v[2]))*top/model.heightM:top;
    return {points,polygons,hitPolygons:polygons,schematic:false,known:true,approximate:true,
      modelId:model.id,sourceLabel:model.sourceLabel,sourceUrl:model.sourceUrl,azimuth:az0,distanceKm:d,baseAngle:ang(0),topAngle:ang(viewTop),viewBaseAngle:ang(0),hiddenAngle:null};
  }

  /**
   * 塔の輪郭（方位・高さの点の並び。左の根元から上がって右へ下りる）。既定の塔は模式図、
   * 地上の高さ heightM だけ分かる建物（他の目標）は**幅を推定した四角**（schematic: true）。山（地上 0m）は null（地形から描く）
   */
  function towerOutline(observer, target, { eyeM = 1.5, heightM = null } = {}) {
    if (target.id === "cinderella") return modelOutline(observer,target,CASTLE_MODEL,{eyeM,heightM});
    if (target.id === "tocho-building") return modelOutline(observer,target,TOCHO_MODEL,{eyeM,heightM});
    if (TM?.[target.id]) return modelOutline(observer,target,TM[target.id],{eyeM,heightM});
    if (target.rim) return null;   // 富士山（火口の縁のデータを持つ山）
    const ground = target.groundM ?? 0;
    const top = heightM !== null ? heightM : ((partOf(target, "tip") || (target.parts || [])[0] || {}).m ?? ground) - ground;
    if (!(top > 0.5)) return null;
    const d = TR.distanceKm(observer.latitude, observer.longitude, target.latitude, target.longitude);
    const az0 = TR.bearing(observer.latitude, observer.longitude, target.latitude, target.longitude);
    const eye = (observer.elevation ?? 0) + eyeM;
    let shape = TOWER_SHAPES[target.id] || null, schematic = false, outline = null;
    if (shape && shape.outline && shape.fromTop) {
      // 先端から下へ測った左右の形（ティンカーベル）。高さを直しても形は崩さず、屋根の線から下は建物の幅で埋める
      const depth = Math.max(...shape.outline.map(([, dd]) => dd)), half = shape.roofHalf;
      outline = [[-half, 0], [-half, top - depth], ...shape.outline.map(([x, dd]) => [x, top - dd]), [half, top - depth], [half, 0]];
    } else if (shape && shape.outline) {
      // 高さを直したら縦だけ伸び縮みさせる
      const k = top / Math.max(...shape.outline.map(([, h]) => h));
      outline = shape.outline.map(([x, h]) => [x, h * k]);
    } else {
      const w = Math.max(6, Math.min(25, top * 0.12));
      shape = [[0, w], [top, w]];
      schematic = true;
    }
    const ang = (h) => targetAngle(d, eye, ground + h);
    const daz = (w) => Math.atan(w / (d * 1000)) / R;
    const points = outline ? outline.map(([x, h]) => [az0 + daz(x), ang(h)])
      : [...shape.map(([h, w]) => [az0 - daz(w), ang(h)]), ...shape.slice().reverse().map(([h, w]) => [az0 + daz(w), ang(h)])];
    // 背景のドーム/ホテルを描く輪郭とは別に、像と杖だけで重なりを判定する。
    let hitPoints = null;
    if (shape?.fromTop && Number.isFinite(shape.hitFromTopM)) {
      const limit=shape.hitFromTopM, clipped=[];
      for(let i=0;i<shape.outline.length;i++){
        const a=shape.outline[i],b=shape.outline[(i+1)%shape.outline.length],insideA=a[1]<=limit,insideB=b[1]<=limit;
        if(insideA)clipped.push(a);
        if(insideA!==insideB){const k=(limit-a[1])/(b[1]-a[1]);clipped.push([a[0]+k*(b[0]-a[0]),limit]);}
      }
      hitPoints=clipped.map(([x,depth])=>[az0+daz(x),ang(top-depth)]);
    }
    const from = TOWER_SHAPES[target.id] && TOWER_SHAPES[target.id].viewFromTopM;
    // 形の材料で見えていない下の方の上端（hiddenBelowM を持つ目標だけ）。図ではそこから下を地面として塗る
    const hidden = TOWER_SHAPES[target.id] && TOWER_SHAPES[target.id].hiddenBelowM;
    const hiddenM = hidden ? hidden * top / Math.max(...TOWER_SHAPES[target.id].outline.map(([, h]) => h)) : null;
    // 図の下の端: ティンカーベルはドームと像のまわり。hiddenBelowM を持つ目標はその高さ（そこから下は地面として塗るので図に入れない）
    return { points, hitPoints, schematic, known: !!TOWER_SHAPES[target.id], azimuth: az0, distanceKm: d,
      baseAngle: ang(0), topAngle: ang(top),
      viewBaseAngle: from ? ang(Math.max(0, top - from)) : hiddenM !== null ? ang(hiddenM) : ang(0),
      hiddenAngle: hiddenM !== null ? ang(hiddenM) : null };
  }

  /**
   * 図の範囲。**目標の大きさをそろえる**: 目標（根元から先端。ティンカーベルはドームから、城は木の線から、山は頂の少し下から）が
   * 図の高さのおよそ6割になるように取り、太陽・月は本当の比で描く（2026-10-03 ユーザー「もう少し拡大した図にして欲しい。
   * 目標物の大きさは固定化して、太陽とか月の大きさを正しい見え方になるように」「あまりにも大きくなりすぎるなら良い感じの比率に。自分で決めて」）。
   * 円盤は重なる時刻の位置を必ず入れ（include）、直径が図の高さの4割を超えるときは範囲を上へ広げる（比はごまかさず、目標の方を小さくする）
   */
  function viewWindow({ azimuth, baseAngle, topAngle, radiusDeg = 0.27, aspect = 1, include = [] }) {
    const span = Math.max(topAngle - baseAngle, 1e-6);
    // 接平面に写すと真ん中から離れた所は tan で広がるので、写したあとの長さで範囲を取る（近い塔で上の端が切れていた）
    const t = (deg) => Math.tan(deg * R) / R;
    const build = (k) => {
      let lo = baseAngle - 0.08 * span;
      let hi = lo + span / k;
      for (const a of include) { lo = Math.min(lo, a - radiusDeg * 1.5); hi = Math.max(hi, a + radiusDeg * 1.5); }
      hi = Math.max(hi, lo + radiusDeg * 5);
      const raw = (hi - lo) / 2;
      const alt0 = lo + raw;
      const halfH = Math.max(t(hi - alt0), t(alt0 - lo), raw);
      return { alt0, halfH, frac: (t(topAngle - alt0) - t(baseAngle - alt0)) / (2 * halfH) };
    };
    // 6割は**写したあとの長さで**そろえる（見上げ 29° の塔では、角度で6割にすると写したあと5割台だった。Codex の点検）
    let k = 0.62, w = build(k);
    for (let i = 0; i < 12 && w.frac < 0.615 && k < 0.95; i++) {
      const k2 = Math.min(0.95, k * 0.62 / Math.max(w.frac, 0.05));
      const w2 = build(k2);
      if (w2.frac <= w.frac + 1e-6) break;   // 円盤を入れるために広げている（目標の割合は変わらない）
      k = k2; w = w2;
    }
    return { az0: azimuth, alt0: w.alt0, halfH: w.halfH, halfW: w.halfH * aspect };
  }


  /** 画角の時刻判定用。当日全体を採取し、表示の道が途中で切れていても判定できる。 */
  function frameDayPath(body, observer, dayMs, proj, { stepS = 60 } = {}) {
    if (!Number.isFinite(dayMs) || !Number.isFinite(stepS) || stepS < 1 || stepS > 60) throw new RangeError("日付と採取間隔（1〜60秒）を指定してください");
    const out = [], end = dayMs + 86400000;
    for (let at = dayMs; at <= end; at = Math.min(end, at + stepS * 1000)) {
      const st = bodyAt(body, at, observer);
      const xy = proj(st.azimuth, st.apparentAltitude);
      out.push({ at, x: xy ? xy[0] : null, y: xy ? xy[1] : null, radius: st.angularRadius });
      if (at === end) break;
    }
    return out;
  }

  /** 円盤の一部が矩形の画角に入る区間。採取点間は補間し、角をかすめる短い通過も拾う。 */
  function framePassages(points, frame, { x = 0, y = 0 } = {}) {
    if (!frame || !points || points.length < 2 || !Number.isFinite(frame.halfW) || !Number.isFinite(frame.halfH)
      || frame.halfW <= 0 || frame.halfH <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) return [];
    const valid = p => Number.isFinite(p.at) && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.radius) && p.radius >= 0;
    const norm = v => { const length = Math.hypot(...v); return v.map(c => c / length); };
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const ray = (px, py) => norm([px * R, py * R, 1]);
    const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => ray(sx * frame.halfW - x, sy * frame.halfH - y));
    const edges = corners.map((a, i) => { const b = corners[(i + 1) % 4]; return { a, b, n: norm(cross(a, b)) }; });
    // 正接投影の円盤は広角端で拡大・楕円化する。球面の矩形辺と円盤の角距離で接触を判定する。
    const gap = p => {
      if (Math.abs(p.x + x) <= frame.halfW && Math.abs(p.y + y) <= frame.halfH) return -p.radius;
      const v = ray(p.x, p.y);
      let closest = -1;
      for (const { a, b, n } of edges) {
        const h = dot3(v, n), q = v.map((c, i) => c - h * n[i]);
        const onArc = dot3(cross(a, q), n) >= -1e-12 && dot3(cross(q, b), n) >= -1e-12;
        closest = Math.max(closest, onArc ? Math.sqrt(Math.max(0, 1 - h * h)) : Math.max(dot3(v, a), dot3(v, b)));
      }
      return Math.acos(Math.max(-1, Math.min(1, closest))) / R - p.radius;
    };
    // 外側の候補を軽く捨てるための、安全側の投影半径上限。精密な判定自体は上の球面距離を使う。
    const projectedRadius = (p, r) => {
      const rho = Math.hypot(p.x, p.y) * R, t = Math.tan(r * R);
      return rho * t >= 1 ? Infinity : t * (1 + rho * rho) / (1 - rho * t) / R;
    };
    const result = [];
    const add = (start, end) => {
      const last = result[result.length - 1];
      if (last && start - last.end <= 1) last.end = end;
      else result.push({ start, end });
    };
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      if (!valid(a) || !valid(b) || b.at <= a.at) continue;
      const radius = Math.max(a.radius, b.radius), r = Math.max(projectedRadius(a, radius), projectedRadius(b, radius));
      if (Math.min(a.x, b.x) + x > frame.halfW + r || Math.max(a.x, b.x) + x < -frame.halfW - r
        || Math.min(a.y, b.y) + y > frame.halfH + r || Math.max(a.y, b.y) + y < -frame.halfH - r) continue;
      const mix = f => ({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, radius: a.radius + (b.radius - a.radius) * f });
      const g = f => gap(mix(f));
      let lo = 0, hi = 1;
      // 一分以内の線分で最も近い所を探す。両端が外でも矩形の角を横切る場合を見逃さない。
      for (let j = 0; j < 24; j++) {
        const l = (lo * 2 + hi) / 3, h = (lo + hi * 2) / 3;
        if (g(l) < g(h)) hi = h; else lo = l;
      }
      const mid = (lo + hi) / 2;
      if (g(mid) > 1e-9 && g(0) > 0 && g(1) > 0) continue;
      let enter = 0, exit = 1;
      if (g(0) > 0) {
        let l = 0, h = mid;
        for (let j = 0; j < 24; j++) { const m = (l + h) / 2; if (g(m) > 0) l = m; else h = m; }
        enter = h;
      }
      if (g(1) > 0) {
        let l = mid, h = 1;
        for (let j = 0; j < 24; j++) { const m = (l + h) / 2; if (g(m) > 0) h = m; else l = m; }
        exit = l;
      }
      add(a.at + (b.at - a.at) * enter, a.at + (b.at - a.at) * exit);
    }
    return result.map(row => ({ ...row, openStart: row.start <= points[0].at + 1, openEnd: row.end >= points[points.length - 1].at - 1 }));
  }

  /**
   * 図の範囲を通る太陽・月の道。重なる時刻 `at` から前後へ、範囲の外へ出るまで stepS 秒ごと（最大 maxMin 分）。
   * 重なる時刻の点を必ず含める（細い塔で、刻みが瞬間を飛び越えないように）
   */
  function viewPath(body, observer, at, proj, win, { stepS = 20, maxMin = 240, includeAt = at, dayMs = null } = {}) {
    if (!(stepS > 0) || !Number.isFinite(stepS)) throw new RangeError("stepS must be positive");
    if (!Number.isFinite(includeAt) || (!Number.isFinite(dayMs) && Math.abs(includeAt - at) > maxMin * 60000)) includeAt = at;
    const stateAt = (t) => bodyAt(body, t, observer);
    const inside = (p) => p && Math.abs(p[0]) <= win.halfW * 1.15 && Math.abs(p[1]) <= win.halfH * 1.15;
    const pt = (t) => {
      const st = stateAt(t);
      const p = proj(st.azimuth, st.apparentAltitude);
      return { at: t, azimuth: st.azimuth, altitude: st.apparentAltitude, radius: st.angularRadius, upperRadius: st.upperRadius, lowerRadius: st.lowerRadius,
        illuminated: body === "moon" ? st.illuminatedFraction : null,
        brightLimbZenithAngle: body === "moon" ? st.brightLimbZenithAngle : null, x: p ? p[0] : null, y: p ? p[1] : null };
    };
    if (Number.isFinite(dayMs)) {
      const out = [], end = dayMs + 86400000;
      for (let ms = dayMs; ms < end; ms += stepS * 1000) out.push(pt(ms));
      for (const ms of [at, includeAt]) if (ms >= dayMs && ms < end && !out.some(p => p.at === ms)) out.push(pt(ms));
      out.push(pt(end - 1));
      return out.sort((a, b) => a.at - b.at);
    }
    const out = [pt(at)];
    for (const dir of [-1, 1]) {
      let wasIn = inside([out[0].x, out[0].y]);
      for (let k = 1; k * stepS <= maxMin * 60; k++) {
        const q = pt(at + dir * k * stepS * 1000);
        const isIn = q.x !== null && inside([q.x, q.y]);
        if (dir < 0) out.unshift(q); else out.push(q);
        if (wasIn && !isIn && dir * (q.at - includeAt) >= 0) break;
        wasIn = wasIn || isIn;
      }
    }
    // 拡大で表示範囲から外れても、つまみで選んだ補間時刻を正確に保持する。
    if (!out.some(p => p.at === includeAt)) { out.push(pt(includeAt)); out.sort((a, b) => a.at - b.at); }
    return out;
  }

  // 同じ観測地点の目標を遠い順に並べる。選択中の目標以外も同じ投影を使う。
  function sceneTargets(observer, targets, { eyeM = 1.5 } = {}) {
    const seen = new Set(), out = [];
    for (const target of targets) {
      if (!target || seen.has(target.id) || !Number.isFinite(target.latitude) || !Number.isFinite(target.longitude)
          || !target.parts?.length || !Number.isFinite(target.parts[0].m)) continue;
      seen.add(target.id);
      const distanceKm = TR.distanceKm(observer.latitude, observer.longitude, target.latitude, target.longitude);
      if (!(distanceKm > 0.01)) continue;
      const azimuth = TR.bearing(observer.latitude, observer.longitude, target.latitude, target.longitude);
      const eye = (observer.elevation || 0) + eyeM;
      out.push({ target, distanceKm, azimuth, topAngle: targetAngle(distanceKm, eye, target.parts[0].m),
        outline: target.rim ? null : towerOutline(observer, target, { eyeM }) });
    }
    return out.sort((a, b) => b.distanceKm - a.distanceKm);
  }

  /** 図の座標（度）→ 方位・高さ。viewProjector の逆 */
  function viewUnprojector(az0, alt0) {
    const c = unit(az0, alt0);
    const e = [Math.cos(az0 * R), -Math.sin(az0 * R), 0];
    const n = [e[1] * c[2] - e[2] * c[1], e[2] * c[0] - e[0] * c[2], e[0] * c[1] - e[1] * c[0]];
    return (x, y) => {
      const v = [0, 1, 2].map((i) => c[i] + x * R * e[i] + y * R * n[i]);
      const L = Math.hypot(v[0], v[1], v[2]);
      return [((Math.atan2(v[0], v[1]) / R) + 360) % 360, Math.asin(v[2] / L) / R];
    };
  }

  /**
   * 逆引き（2026-10-03 ユーザー「見え方の月とか太陽の位置を調整したら、それがどこら辺の座標で撮れるのか逆引きみたいなことってできる？」）。
   * 目標から distanceKm の円の上で、時刻 at0 の近くに、円盤の中心が目標の先端から図の上で (dx, dy) 度の所に来る立つ点と時刻を解く。
   * 未知数は「目標から見た立つ点の方位」と「時刻」、条件は図の上の横と縦（Codex と相談: 距離は固定、2変数のニュートン法）。
   * 立つ高さは地面＋eyeM。解いた点の地面を elevationAt で取り直し、0.5m 以上変われば解き直す。dayMs（その日の始まり）を渡せば、その日の中の解だけ。解けなければ null
   */
  async function solveComposition(target, body, { around, distanceKm, at0, dx, dy, eyeM = 1.5, groundM = 0,
    elevationAt = null, partId = null, maxShiftMs = 4 * 3600000, dayMs = null } = {}) {
    target=partTarget(target,partId);
    const D = distanceKm;
    const pid = partId || ((target.parts || [])[0] || {}).id;
    const place = (th) => TR.destination(target.latitude, target.longitude, th, D);
    const at = (th, t, g) => {
      const p = place(th);
      const obs = { latitude: p.latitude, longitude: p.longitude, elevation: g };
      const geo = geometryFrom(obs, target, { eyeM, partId: pid });
      if (!geo) return null;
      const st = bodyAt(body, t, { ...obs, elevation: g + eyeM });
      const xy = viewProjector(geo.azimuth, geo.angle)(st.azimuth, st.apparentAltitude);
      return xy ? { r: [xy[0] - dx, xy[1] - dy], p, geo, st } : null;
    };
    let th = TR.bearing(target.latitude, target.longitude, around.latitude, around.longitude), t = at0, g = groundM;
    for (let round = 0; round < 3; round++) {
      let ok = false;
      for (let k = 0; k < 40; k++) {
        const c = at(th, t, g);
        if (!c) return null;
        if (Math.hypot(c.r[0], c.r[1]) < 5e-4) { ok = true; break; }
        const hTh = (3 / (D * 1000)) / R, hT = 5000;   // 3m ぶんの方位と5秒で傾きを測る
        const a = at(th + hTh, t, g), b = at(th, t + hT, g);
        if (!a || !b) return null;
        const j00 = (a.r[0] - c.r[0]) / hTh, j01 = (b.r[0] - c.r[0]) / hT;
        const j10 = (a.r[1] - c.r[1]) / hTh, j11 = (b.r[1] - c.r[1]) / hT;
        const det = j00 * j11 - j01 * j10;
        if (!Number.isFinite(det) || det === 0) return null;
        const dTh = -(j11 * c.r[0] - j01 * c.r[1]) / det;
        const dT = -(-j10 * c.r[0] + j00 * c.r[1]) / det;
        // 一度に動かしすぎない（方位は 20°・時刻は 30分まで）
        const s = Math.min(1, 20 / Math.max(1e-9, Math.abs(dTh)), 1800000 / Math.max(1, Math.abs(dT)));
        th += dTh * s; t += dT * s;
        if (Math.abs(t - at0) > maxShiftMs) return null;
      }
      if (!ok) return null;
      if (!elevationAt) break;
      const p = place(th);
      let g2 = null;
      try { g2 = await elevationAt(p.latitude, p.longitude); } catch { g2 = null; }
      if (!Number.isFinite(g2)) break;
      const moved = Math.abs(g2 - g) >= 0.5;
      g = g2;
      if (!moved) break;
    }
    const c = at(th, t, g);
    if (!c || Math.hypot(c.r[0], c.r[1]) > 2e-3) return null;
    // 「同じ日」を守る（dayMs はその日の始まり。日付の境目の近くで前後の日の解へ進むことがある。Codex の点検）
    if (Number.isFinite(dayMs) && (t < dayMs || t >= dayMs + 86400000)) return null;
    const eye = { latitude: c.p.latitude, longitude: c.p.longitude, elevation: g + eyeM };
    const later = bodyAt(body, t + 60000, eye).apparentAltitude;
    return { latitude: c.p.latitude, longitude: c.p.longitude, groundM: g, at: Math.round(t), azimuth: c.geo.azimuth, distanceKm: D,
      altitude: c.st.apparentAltitude, side: later < c.st.apparentAltitude ? "set" : "rise",
      sunAltitude: body === "sun" ? c.st.apparentAltitude : body === "moon" ? bodyAt("sun",t,eye).apparentAltitude : A.sun(t, eye).geometricAltitude };
  }

  const SoramiAlign = { TARGETS, targetById, partOf, LIMBS, limbById, line, lineRange, lineDistances, smoothLine, mapLimit, solvePoint,
                        altitudeCrossing, geometryFrom, upcoming, dailyView, buildingUpcoming, polygonDistance, cameraFrame, FUJI_SPOTS, spotObserver,
                        crossingNear, candidates, lineOfSight, rankOf, LIMB_FIT, rimOutline, judge, buildingBlock,
                        viewProjector, viewUnprojector, frameDayPath, framePassages, solveComposition, partTarget, TOWER_MODELS:TM, TOCHO_MODEL, CASTLE_MODEL, convexHull, TOWER_SHAPES, towerOutline, viewWindow, viewPath, sceneTargets };
  global.SoramiAlign = SoramiAlign;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiAlign;
})(typeof globalThis !== "undefined" ? globalThis : window);
