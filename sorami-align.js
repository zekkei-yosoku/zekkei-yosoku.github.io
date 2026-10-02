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
    // 333m（海抜351m なので地面は18m）。展望台の「150m」「250m」は海抜に近い呼び名で、**地上はメインデッキ 125m・トップデッキ 223.55m**
    // （Wikipedia。2026-10-02 見え方の図を作るときに調べて気づいた。それまで地上150m・250m として 25m ほど高く解いていた）
    { id: "tokyotower", name: "東京タワー", latitude: 35.658581, longitude: 139.745433,
      note: "地上の高さ ＋ 地面の標高およそ18m", groundM: 18,
      parts: [{ id: "tip", name: "先端", m: 351 },
              { id: "top", name: "トップデッキ", m: 242 },
              { id: "main", name: "メインデッキ", m: 143 }] },
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
    { id: "tinkerbell", name: "ティンカーベル", latitude: 35.637031, longitude: 139.878077,
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

  const bodyAt = (body, ms, obs) => (body === "moon" ? A.moon(ms, obs) : A.sun(ms, obs));
  const DEG = Math.PI / 180;

  /**
   * その日、天体の見かけの高度が `alt` を通る時刻。
   * @param {string} side "set"=下降中 / "rise"=上昇中
   */
  function altitudeCrossing(body, dayMs, obs, alt, side, stepMs = 120000) {
    let prev = null;
    for (let t = dayMs; t <= dayMs + 86400000; t += stepMs) {
      const cur = bodyAt(body, t, obs).apparentAltitude;
      if (prev !== null) {
        const falling = cur < prev.alt;
        const crossed = (prev.alt - alt) * (cur - alt) <= 0;
        if (crossed && ((side === "set" && falling) || (side === "rise" && !falling))) {
          let lo = prev.t, hi = t, loDiff = prev.alt - alt;
          for (let i = 0; i < 30; i++) {
            const mid = (lo + hi) / 2;
            const d = bodyAt(body, mid, obs).apparentAltitude - alt;
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
      const base = A.targetElevationAngle(distanceKm, obsM + eyeM, topM);
      const probe = bodyAt(body, dayMs + 43200000, obs0);
      alpha = base + sign * probe.angularRadius;
      at = altitudeCrossing(body, dayMs, obs0, alpha, side);
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
      sunAltitude: body === "moon" ? A.sun(at, obs).apparentAltitude : null,
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
    const { eyeM = 1.5, partId = null, heightM = null } = opts;
    const topM = heightM !== null ? heightM : (partOf(target, partId) || {}).m;
    if (!Number.isFinite(topM)) return null;
    const distanceKm = TR.distanceKm(observer.latitude, observer.longitude, target.latitude, target.longitude);
    return {
      distanceKm,
      azimuth: TR.bearing(observer.latitude, observer.longitude, target.latitude, target.longitude),
      angle: A.targetElevationAngle(distanceKm, (observer.elevation ?? 0) + eyeM, topM),
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
               ang: A.targetElevationAngle(d, obs.elevation ?? 0, p.m) };
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
    if (!outline) return { at: at0, gap: st0.apparentAltitude - (angle + sign * st0.angularRadius), st: st0 };
    const a = bodyAt(body, at0 - 60000, obs), b = bodyAt(body, at0 + 60000, obs);
    const rate = azDiff(b.azimuth, a.azimuth) / 120000;          // 方位の動き[度/ms]
    if (!rate) return { at: at0, gap: st0.apparentAltitude - (angle + sign * st0.angularRadius), st: st0 };
    const tA = at0 + outline.min / rate, tB = at0 + outline.max / rate;
    const t0 = Math.min(tA, tB), t1 = Math.max(tA, tB);
    const f = (t) => {
      const st = bodyAt(body, t, obs);
      const ridge = outline.at(azDiff(st.azimuth, outline.azimuth));
      return ridge === null ? null : { t, st, v: st.apparentAltitude - sign * st.angularRadius - ridge };
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
      : { at: at0, gap: st0.apparentAltitude - (angle + sign * st0.angularRadius), st: st0 };
    const r = rankOf(miss.gap, miss.st.angularRadius);
    return { ...miss, rank: r === "center" ? "overlap" : r };
  }

  /**
   * その地点で、次に重なる日を並べる（「ダイヤモンド◯◯一覧」「パール◯◯一覧」）。
   * 判定は `SoramiFuji.alignments()` と同じ考え方で、幾何だけ目標ごとに作る。
   */
  function upcoming(observer, target, body, opts = {}) {
    const { from = Date.now(), days = 400, limit = 6, limb = "center", stepMs = null } = opts;
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
          const within = Math.abs(gap) <= 2 * st.angularRadius;
          if (within && st.apparentAltitude > -1) {
            const later = bodyAt(body, at + 60000, obs).apparentAltitude;
            const row = { at, gap, radius: st.angularRadius,
              rank: j.rank || rankOf(gap, st.angularRadius),
              side: later < st.apparentAltitude ? "set" : "rise",
              altitude: st.apparentAltitude,
              illuminated: body === "moon" ? st.illuminatedFraction : null,
              sunAltitude: body === "moon" ? A.sun(at, obs).apparentAltitude : null };
            row.off = j.off ?? 0;
            if (group && at - group.last <= 40 * 3600000) {
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
  const rankOf = (gap, r) => (Math.abs(gap) <= 0.5 * r ? "center"
    : Math.abs(gap) <= r ? "overlap" : Math.abs(gap) <= 2 * r ? "graze" : null);

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
      sunAltitude: body === "moon" ? A.sun(best.at, obs).apparentAltitude : null,
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
    const { elevationAt = null } = opts;
    const out = [];
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
          const dAlpha = A.targetElevationAngle(D, eP + eye, topM) - A.targetElevationAngle(D, eLine + eye, topM);
          shift = dAlpha / pathSlope;
        }
        const lateralM = Math.abs(Math.sin(azDiff(pb, lb + shift) * DEG)) * D * 1000;
        // 重なって見える幅（天体の直径ぶんの高度差を、通り道の傾きで方位に直す）＋見積もりの余裕
        const bandM = D * 1000 * (2 * radius / Math.max(0.2, Math.abs(pathSlope))) * DEG;
        // 頂が輪なら、その幅（中心から縁まで 450m）と剣ヶ峰からのずれ（360m）ぶん広く拾う
        const plateauM = target.rim ? 850 : 0;
        if (lateralM > (place.reachM || 0) + bandM + plateauM + 150 + 0.004 * D * 1000) continue;
        const approxAt = p0.at + (p1.at - p0.at) * f;
        const hit = await standOn(place, l, target, body, approxAt, opts, elevationAt);
        // **線の届く範囲に立つものだけ。** 広い公園は端が範囲に掛かると拾うので、立つ点が線の先に出ることがあった
        if (hit && hit.rank && hit.distanceKm >= minKm * 0.98 && hit.distanceKm <= maxKm * 1.02) out.push({ place, side: l.side, ...hit });
      }
    }
    return out;
  }

  /// 場所の中で立つ位置を決め、そこでの重なり方を返す
  async function standOn(place, l, target, body, approxAt, opts, elevationAt) {
    const eyeM = (opts.eyeM ?? 1.5) + (place.deckM || 0);
    const at = async (pt, fixedElev = null) => {
      const e = fixedElev !== null ? fixedElev
        : (elevationAt ? await elevationAt(pt.latitude, pt.longitude) : 0);
      const obs = { latitude: pt.latitude, longitude: pt.longitude, elevation: Number.isFinite(e) ? e : 0 };
      const c = crossingNear(obs, target, body, approxAt, { ...opts, eyeM });
      return c ? { ...c, stand: { latitude: pt.latitude, longitude: pt.longitude, elevationM: obs.elevation } } : null;
    };
    const shape = place.shape || "point";
    if (shape === "point") {
      return at({ latitude: place.latitude, longitude: place.longitude },
        Number.isFinite(place.elevationM) ? place.elevationM : null);
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
      const elev = (Number.isFinite(e0) ? e0 : 0) + (place.bridgeM ?? 0);
      let c0 = await at(p0, elev);
      if (!c0) return null;
      if (c0.rank === "center") return c0;
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
        if (c.rank === "center") return c;
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
    if (!c || c.rank === "center" || !c.slope) return c;
    // 横へ1歩。天体の通り道の傾きから、ずれ（gap）を消す方位の差を出して、目標のまわりに回す
    for (let k = 0; k < 2; k++) {
      const moved = rotateAround(target, c.stand, -c.gap / c.slope);
      if (!insidePolygon(F.xy(moved.latitude, moved.longitude), ring)) break;
      const c2 = await at(moved);
      if (!c2 || Math.abs(c2.gap) >= Math.abs(c.gap)) break;
      c = c2;
      if (c.rank === "center") break;
    }
    return c;
  }

  /**
   * 目標の先端まで、地形で見通せるか（建物は見ない）。
   * `elevations(points)` は標高をまとめて返す関数（画面では標高タイル）。
   * 目標のすぐ手前（1km）は目標自身の山腹なので数えない。
   */
  async function lineOfSight(observer, target, opts = {}) {
    const g = geometryFrom(observer, target, opts);
    if (!g || !opts.elevations) return null;
    const eye = (observer.elevation ?? 0) + (opts.eyeM ?? 1.5);
    const bearingTo = TR.bearing(observer.latitude, observer.longitude, target.latitude, target.longitude);
    const n = Math.max(12, Math.min(160, Math.ceil(g.distanceKm / 0.4)));
    const dists = [];
    for (let i = 1; i < n; i++) {
      const d = g.distanceKm * i / n;
      if (d > g.distanceKm - 1) break;
      // 足もとは標高タイルの升目（z11 で約60m）より細かく読めないので数えない
      if (d < (opts.skipKm ?? 0.15)) continue;
      dists.push(d);
    }
    const pts = dists.map((d) => TR.destination(observer.latitude, observer.longitude, bearingTo, d));
    const elevs = await opts.elevations(pts);
    let worst = -90, at = null;
    dists.forEach((d, i) => {
      const e = elevs[i];
      if (!Number.isFinite(e)) return;
      const a = A.targetElevationAngle(d, eye, e);
      if (a > worst) { worst = a; at = d; }
    });
    return { clear: worst < g.angle - 0.02, marginDeg: g.angle - worst, blockKm: at };
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
   * よく使う4つの目標の形（2026-10-02 ユーザー「頻度高いししっかり形は作り込んで欲しい」）。
   * ふつうは [地上の高さm, 半分の幅m] を下から並べた左右対称の形。公表寸法と写真から作った**おおよその形**で、
   * 見る向きで少し変わる（スカイツリーの足もとは向きで 59〜68m）。左右で違う形は `outline`（[横m, 地上の高さm]、左から右へ）で持つ
   */
  const TOWER_SHAPES = {
    // 634m。足もとは一辺68mの正三角形で、上へ行くほど丸くなり地上315mで円（公式）。天望デッキ（床 340・345・350m の3層。
    // 胴より一回り張り出す。直径およそ50m）、天望回廊（445〜451.2m を約110m の回廊で一周。直径およそ40m）、
    // 上は約140m のゲイン塔（495m〜。円筒）（公式・東京都の紹介）
    skytree: [[0, 34], [50, 32], [100, 30], [150, 28], [200, 26], [250, 23.5], [300, 20.5], [315, 19.5], [333, 18.5], [335, 25],
      [362, 25], [364, 17.5], [440, 14.5], [443, 20], [458, 20], [460, 13], [480, 10], [494, 7], [496, 4], [620, 3], [625, 1.5], [634, 0.5]],
    // 333m。塔脚の間隔88m、メインデッキ（地上120〜131m の2階建て・幅およそ28.7m で塔から少し張り出す）、
    // トップデッキ（223.55m〜・幅およそ14.3m）、上はアンテナ（およそ253〜333m の80m）（Wikipedia・全日本タワー協議会）
    tokyotower: [[0, 44], [15, 37], [30, 30.5], [45, 25], [60, 20.5], [80, 16], [100, 12.5], [119, 10], [120, 14.4], [131, 14.4],
      [132, 9.2], [160, 7.6], [190, 6], [222, 4.6], [223.5, 7.15], [229.5, 7.15], [231, 4.2], [250, 3], [253, 1.6], [300, 1], [333, 0.3]],
    // 51m。2026-10-02 ユーザーの写真（2024-08-20 19:02:04、700mm、昇る満月の前の城）の輪郭を Codex に画素で起こしてもらった
    // （175点。目視と色の境界の両方で確かめ、写真に重ねて確認。旗・風見の横棒・電線・手前の柱と木は除く）。
    // 撮影地は写真から逆算して西北西 約2.85km（臨海町六丁目。尖塔の先が月の上の縁の少し上に出る見上げ 0.98° になる所）。
    // 月の半径 0.276° が写真で 508px（カメラの計算と1%で合う）を物差しに 1px＝2.7cm、尖塔の先を 51m に合わせた。
    // 写真で見えているのは地上およそ24m から上。**それより下（木に隠れた所）は、ユーザーがくれた城全体のシルエットの絵から**取った
    // （尖塔の先から地面までを 51m にして同じ縮尺で。つなぎ目の左端は写真と 0.05m で合う。右は絵の方が 4m 外にあるので段でつないだ）。
    // その絵は尖塔どうしの高さの差が写真の 1.2〜1.6倍あり（主尖塔と右の尖塔の差: 写真 7.8m・絵 17.8m）、木より上には使わない。西北西から見た形
    // hiddenBelowM: 写真で見えている所の下端（ここより下はシルエットの絵から）
    cinderella: { hiddenBelowM: 23.9, outline: [
      [-12.54, 0], [-12.54, 4.45], [-12.19, 4.49], [-12.16, 4.14], [-11.96, 4.26], [-11.93, 6.98], [-11.12, 8.36],
      [-10.51, 11.62], [-10.35, 14.15], [-10.16, 14.11], [-10.05, 13.46], [-10.05, 11.58], [-9.36, 7.86], [-8.86, 7.06],
      [-8.24, 11.01], [-7.86, 8.9], [-7.86, 17.06], [-7.48, 17.75], [-6.86, 20.28], [-6.79, 22.28], [-6.63, 22.85],
      [-6.33, 22.28], [-6.17, 19.59], [-5.37, 17.03], [-5.37, 15.91], [-5.06, 15.91], [-5.02, 19.75], [-4.41, 22.24],
      [-4.41, 23.51], [-4.35, 23.93], [-4.51, 31.17], [-3.78, 34.87], [-3.76, 35.68], [-3.67, 33.98], [-3.38, 32.17],
      [-3.27, 31.63], [-3, 31.22], [-2.67, 32.71], [-2.27, 36.49], [-2.19, 36.76], [-1.81, 36.76], [-1.78, 39.41],
      [-1.32, 39.44], [-1.22, 39.87], [-0.95, 39.87], [-0.86, 42.11], [-0.81, 42.38], [-0.65, 41.89], [-0.57, 42.46], [0, 51],
      [0.24, 45.54], [0.65, 41.49], [0.81, 42.43], [0.97, 39.87], [1.19, 39.87], [1.3, 39.46], [1.86, 39.35], [1.95, 37],
      [2.11, 39.49], [2.19, 37.9], [3.51, 37.9], [3.62, 39.49], [3.81, 37.46], [4.05, 38], [4.57, 44.49], [4.78, 40.14],
      [5.11, 37.81], [5.35, 37.33], [5.59, 31.01], [5.67, 36.68], [6.24, 36.68], [6.32, 37.3], [6.4, 37.14], [6.57, 37.71],
      [6.92, 41.49], [6.92, 43.16], [7.11, 39.06], [7.54, 36], [7.7, 32.6], [7.94, 32.09], [8.11, 32.06], [8.19, 29.49],
      [8.43, 28.14], [8.59, 28.44], [8.65, 27.71], [8.48, 26.09], [8.02, 23.93], [8.05, 23.93], [9.2, 23.93], [9.74, 23.93],
      [10.08, 23.93], [12.35, 23.93], [12.35, 20.4], [12.77, 20.4], [12.77, 19.86], [13.04, 19.86], [13.04, 14.72],
      [13.34, 15.99], [13.73, 14.26], [13.84, 7.59], [14.53, 11.43], [14.69, 9.39], [15.65, 5.91], [15.65, 4.98], [15.68, 5.94],
      [15.95, 6.48], [16.11, 4.83], [16.72, 3.53], [16.99, 3.53], [16.99, 3.91], [17.56, 3.91], [17.56, 0]] },
    // 東京ディズニーランドホテルの屋根のドームと、その上のティンカーベル（杖の先が先端）。[横m, 先端から下へm] で持つ
    // （高さを直しても形が崩れないように）。2026-10-02 ユーザーの写真（葛西臨海公園から 692.9m・700mm）の輪郭を Codex に画素で起こしてもらい
    // （204点。目視と色の境界の両方で確かめ、写真に重ねて確認）、月の直径 0.497°（写真で 482px）を物差しに 1px＝1.25cm で直した。
    // 横はドームの軸から（杖の先は軸の 0.3m 左、羽は右へ張り出す）。屋根の線は杖の先から 10.4m 下、そこから下はホテルの幅で埋める。
    // 見え方の図ではドームと像のまわり（先端から16m）だけを拡大する。ホテル全体を入れると像が点になる
    tinkerbell: { fromTop: true, roofHalf: 60, viewFromTopM: 16, outline: [
      [-8.312, 10.402], [-4.942, 10.402], [-4.817, 10.377], [-4.63, 10.402], [-4.505, 10.327], [-4.318, 9.903], [-3.819, 8.492],
      [-3.694, 8.33], [-2.945, 7.082], [-2.82, 6.808], [-2.696, 6.658], [-2.571, 6.633], [-2.196, 6.209], [-2.072, 6.121],
      [-1.947, 5.959], [-1.448, 5.497], [-1.136, 5.285], [-1.073, 4.961], [-1.011, 4.948], [-0.948, 4.624], [-0.886, 4.549],
      [-0.724, 4.462], [-0.362, 3.862], [-0.349, 3.675], [-0.424, 3.588], [-0.724, 3.376], [-0.724, 3.338], [-0.324, 3.176],
      [-0.25, 3.089], [-0.187, 2.889], [-0.175, 2.615], [-0.075, 2.24], [-0.212, 1.441], [-0.212, 1.104], [-0.337, 0.643],
      [-0.3, 0.456], [-0.324, 0.393], [-0.306, 0], [-0.262, 0.343], [-0.087, 0.768], [0.1, 0.543], [0.225, 0.493],
      [0.312, 0.568], [0.312, 0.618], [0.175, 0.817], [0.212, 0.867], [0.749, 0.905], [0.973, 0.992], [0.724, 1.042],
      [0.225, 0.967], [0.437, 1.304], [0.424, 1.404], [0.312, 1.292], [0.212, 1.117], [0.175, 1.104], [0.112, 1.816],
      [0.162, 2.065], [0.349, 2.365], [0.374, 2.49], [0.374, 2.602], [0.287, 2.814], [0.487, 3.126], [0.599, 3.201],
      [0.861, 3.276], [0.899, 3.338], [0.761, 3.401], [0.749, 3.463], [0.636, 3.526], [0.562, 3.65], [0.537, 3.838],
      [0.587, 4.087], [0.761, 4.337], [0.948, 4.462], [1.111, 4.524], [1.123, 4.586], [1.061, 4.774], [0.998, 4.836],
      [1.235, 4.948], [1.298, 5.223], [1.672, 5.447], [1.922, 5.734], [2.047, 5.797], [2.171, 5.909], [2.671, 6.458],
      [2.92, 6.67], [3.045, 6.945], [3.17, 7.057], [3.544, 7.594], [3.919, 8.255], [4.043, 8.38], [4.73, 10.402],
      [8.312, 10.402]] },
  };

  /**
   * 塔の輪郭（方位・高さの点の並び。左の根元から上がって右へ下りる）。既定の塔は模式図、
   * 地上の高さ heightM だけ分かる建物（他の目標）は**幅を推定した四角**（schematic: true）。山（地上 0m）は null（地形から描く）
   */
  function towerOutline(observer, target, { eyeM = 1.5, heightM = null } = {}) {
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
      // 左右で違う形（シンデレラ城）。高さを直したら縦だけ伸び縮みさせる
      const k = top / Math.max(...shape.outline.map(([, h]) => h));
      outline = shape.outline.map(([x, h]) => [x, h * k]);
    } else if (shape && shape.fromTop) {
      // 先端から下へ測った形（ティンカーベル）。屋根より下は建物の幅で埋める
      const roof = top - shape.fromTop[shape.fromTop.length - 1][0];
      shape = [[0, shape.roofHalf], [roof, shape.roofHalf], ...shape.fromTop.slice().reverse().map(([d, w]) => [top - d, w])];
    } else if (shape) {
      // 高さを直せる目標（推定の高さ）は、形を高さに合わせて伸び縮みさせる
      const k = top / shape[shape.length - 1][0];
      shape = shape.map(([h, w]) => [h * k, w]);
    } else {
      const w = Math.max(6, Math.min(25, top * 0.12));
      shape = [[0, w], [top, w]];
      schematic = true;
    }
    const ang = (h) => A.targetElevationAngle(d, eye, ground + h);
    const daz = (w) => Math.atan(w / (d * 1000)) / R;
    const points = outline ? outline.map(([x, h]) => [az0 + daz(x), ang(h)])
      : [...shape.map(([h, w]) => [az0 - daz(w), ang(h)]), ...shape.slice().reverse().map(([h, w]) => [az0 + daz(w), ang(h)])];
    const from = TOWER_SHAPES[target.id] && TOWER_SHAPES[target.id].viewFromTopM;
    return { points, schematic, known: !!TOWER_SHAPES[target.id], azimuth: az0, distanceKm: d,
      baseAngle: ang(0), topAngle: ang(top), viewBaseAngle: from ? ang(Math.max(0, top - from)) : ang(0) };
  }

  /**
   * 図の範囲。縦は目標の根元（山は頂の少し下）から先端＋円盤3つぶん、横は図の縦横比で決める。
   * 目標がとても小さく見えるときも、円盤が6つ入る高さは取る。**広げるときは上へ**（下へ広げると地面の帯ばかりになる）
   */
  function viewWindow({ azimuth, baseAngle, topAngle, radiusDeg = 0.27, aspect = 1 }) {
    const lo = baseAngle - Math.max(0.12 * (topAngle - baseAngle), radiusDeg * 0.6);
    const hi = topAngle + radiusDeg * 3;
    const halfH = Math.max((hi - lo) / 2, radiusDeg * 6);
    return { az0: azimuth, alt0: lo + halfH, halfH, halfW: halfH * aspect };
  }

  /**
   * 図の範囲を通る太陽・月の道。重なる時刻 `at` から前後へ、範囲の外へ出るまで stepS 秒ごと（最大 maxMin 分）。
   * 重なる時刻の点を必ず含める（細い塔で、刻みが瞬間を飛び越えないように）
   */
  function viewPath(body, observer, at, proj, win, { stepS = 20, maxMin = 240 } = {}) {
    const stateAt = (t) => (body === "moon" ? A.moon(t, observer) : A.sun(t, observer));
    const inside = (p) => p && Math.abs(p[0]) <= win.halfW * 1.15 && Math.abs(p[1]) <= win.halfH * 1.15;
    const pt = (t) => {
      const st = stateAt(t);
      const p = proj(st.azimuth, st.apparentAltitude);
      return { at: t, azimuth: st.azimuth, altitude: st.apparentAltitude, radius: st.angularRadius,
        illuminated: body === "moon" ? st.illuminatedFraction : null,
        brightLimbZenithAngle: body === "moon" ? st.brightLimbZenithAngle : null, x: p ? p[0] : null, y: p ? p[1] : null };
    };
    const out = [pt(at)];
    for (const dir of [-1, 1]) {
      let wasIn = inside([out[0].x, out[0].y]);
      for (let k = 1; k * stepS <= maxMin * 60; k++) {
        const q = pt(at + dir * k * stepS * 1000);
        const isIn = q.x !== null && inside([q.x, q.y]);
        if (dir < 0) out.unshift(q); else out.push(q);
        if (wasIn && !isIn) break;
        wasIn = wasIn || isIn;
      }
    }
    return out;
  }

  const SoramiAlign = { TARGETS, targetById, partOf, LIMBS, limbById, line, lineRange, lineDistances, smoothLine, mapLimit, solvePoint,
                        altitudeCrossing, geometryFrom, upcoming, FUJI_SPOTS, spotObserver,
                        crossingNear, candidates, lineOfSight, rankOf, rimOutline, judge, buildingBlock,
                        viewProjector, TOWER_SHAPES, towerOutline, viewWindow, viewPath };
  global.SoramiAlign = SoramiAlign;
  if (typeof module !== "undefined" && module.exports) module.exports = SoramiAlign;
})(typeof globalThis !== "undefined" ? globalThis : window);
