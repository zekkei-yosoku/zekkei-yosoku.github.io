function renderBestNote(best, now) {
  const el = $("bestNote");
  const ev = best ? best.u.evaluation : null;
  // 見に行く価値のあるものが無いなら、そう言って終える。
  // 「なさそうです」と書いた下に期待薄の候補を並べると、見出しと中身が食い違う。
  // 14日ぶんを見たうえでの結論なので、「本日の」ではなく期間で言う。
  if (!best || ev.rank.key === "poor") {
    el.hidden = false;
    el.innerHTML = `<div class="muted" style="font-size:0.72rem">★ この2週間、見に行くほどの空はありません</div>`;
    return;
  }
  const grade = S.reliabilityGrade(ev.confidence, ev.models);
  const err = ev.uncertainty && ev.uncertainty.expectedError !== null
    ? Math.round(ev.uncertainty.expectedError) : null;
  el.hidden = false;
  el.innerHTML = `<div class="muted" style="font-size:0.72rem">★ ${HIGHLIGHT_HEAD[ev.rank.key]}</div>`
    + highlightRow(best.id, best.u.dayMs, ev, now)
    + `<div style="display:flex;align-items:baseline;gap:10px;margin-top:6px">`
      + `<span class="muted" style="font-variant-numeric:tabular-nums">${Math.round(ev.score)}`
      + `${err ? ` <span style="font-weight:400">±${err}</span>` : ""}`
      + ` <span class="grade" title="${esc(grade.caption)}">${grade.key}</span></span>`
      // カード全体は押さない（情報カードの見た目で画面が変わるのを避ける現行の判断）。
      // 代わりに行き先を明示したリンクを1つ置く。
      + `<button class="tap" data-cell="${best.id}|${best.u.dayMs}" style="margin-left:auto;color:var(--accent);font-size:0.75rem;font-weight:700">詳細を見る →</button>`
    + `</div>`;
}

function highlightRow(id, dayMs, ev, now) {
  const color = RANK_COLOR[ev.rank.key];
  return `<div style="margin-top:3px"><span style="font-size:1.25rem">${iconFor(id, ev.peak)}</span>
    <strong style="margin-left:4px">${S.longNameOf(id)}</strong>
    <span class="muted" style="white-space:nowrap">${S.JstCal.relativeDay(dayMs, now)}${ev.specificTime === false ? "" : " " + S.JstCal.hhmmRounded(ev.peak)}</span>
    ・<span style="color:${color};font-weight:700;white-space:nowrap">${esc(S.phrasing(id, ev.rank).label)}</span></div>`;
}

// 現象ごとのカード。
//
// 以前は 7現象 × 7日 をひとつの表にしていたが、49個の数字を凡例と
// 照らし合わせて読む形になっていて、「見に行くか」を決める道具になっていなかった。
// 現象ごとに分け、日の良し悪しは【棒の高さ】で示す。
// 色や数字を覚えなくても、どの日がいいかがそのまま見える。
//
// 押せるのは日のボタンだけ。カード全体を押せるようにすると、
// 情報を読んでいるつもりの場所で画面が変わってしまう。
// 14日 × 現象のマトリクス（旧: 現象ごとのカード）。
//
// 現象ごとにカードを分けると、横スクロールが7本に分かれて日付の列が揃わない。
// 「土曜はどれも良い」を読むには、7枚それぞれを土曜まで動かす必要があった。
// 軸を1本にすると、良い日が【縦の列】として浮かぶ。
//
// 行の並びは呼び出し元から渡された order をそのまま使う。
// 並び替えは表の左上の札から選ぶ（→ sortFace）。
/// 並び替えの札。いま何で並べているかを、表の左上に出す
function sortFace() {
  return `<span class="mxsort-face"><i>⇅</i>${esc(SORTS[sortMode].label)}</span>`;
}

function renderMatrix(order, now) {
  const live = order.filter((id) => weeks[id] && weeks[id].length
    && !weeks[id].every((e) => e.evaluation.unavailable));
  const dead = order.filter((id) => weeks[id] && weeks[id].length
    && weeks[id].every((e) => e.evaluation.unavailable));
  if (!live.length) return "";
  const dayList = weeks[live[0]].map((e) => e.dayMs);
  const today = S.Cal.startOfDay(now);

  let head = `<div class="mxrail mxsort">${sortFace()}`
    + `<select id="sortSelect" aria-label="並び替え"></select></div>`;
  for (const dayMs of dayList) {
    const wd = S.Cal.weekday(dayMs);
    const cls = [wd === "土" ? "sat" : wd === "日" ? "sun" : "", dayMs === today ? "today" : ""].filter(Boolean).join(" ");
    head += `<div class="dhead ${cls}"${cls.includes("today") ? ' aria-current="date" aria-label="今日"' : ""}><span class="d">${S.Cal.monthDay(dayMs)}</span><span>${wd}</span>${cls.includes("today") ? '<span class="sr-only">今日</span>' : ""}</div>`;
  }
  let rows = "";
  for (const id of live) {
    const meta = S.PHENOMENA[id];
    const u = upcoming(weeks[id], now);
    // 行に時間帯を添える。**名前で時間帯が分かるのは朝焼け・夕焼けだけ**だった
    // （2026-09-24 ユーザー指摘）。幅は実質48pxなので、3〜4文字に収める語を core が持つ。
    let grid = `<div class="mxrail"><span>${iconFor(id, now)}</span>`
      + `<span class="nmw"><span class="nm">${esc(meta.name)}</span></span></div>`;
    for (const dayMs of dayList) {
      const e = weeks[id].find((x) => x.dayMs === dayMs);
      if (!e) { grid += `<div class="cell void" title="予測がありません">—</div>`; continue; }
      if (e.evaluation.unavailable) {
        const reason = `${meta.name} ${S.JstCal.relativeDay(dayMs, now)}：${e.evaluation.unavailable.message}`;
        grid += `<button class="cell void" data-cell="${id}|${dayMs}" title="${esc(reason)}" aria-label="${esc(reason)}"><span class="v">—</span></button>`;
        continue;
      }
      const ev = e.evaluation;
      // 点数と信頼度は【全部の日に出す】（2026-09-07 ユーザー指定）。
      // 40点未満を伏せていたが、0点なのか39点なのかは判断に効くし、
      // 「低いと分かっている」ことと「値が無い」ことは別。地の色は目安、数字が正本。
      const grade = S.reliabilityGrade(ev.confidence, ev.models);
      const past = ev.window[1] <= now ? " past" : "";
      const next = u && e.dayMs === u.dayMs ? " next" : "";
      grid += `<button class="cell${past}${next}" data-cell="${id}|${dayMs}"
        style="background:${cellBg(ev.score, !!past)}"
        title="${esc(meta.name)} ${S.JstCal.relativeDay(dayMs, now)} ${Math.round(ev.score)}点 ${esc(S.phrasing(id, ev.rank).label)} ・ 信頼度${grade.key}（${esc(grade.caption)}）${past ? "（終了）" : ""}">
        <span class="v">${Math.round(ev.score)}</span>
        <span class="g" title="${esc(grade.caption)}">${grade.key}</span></button>`;
    }
    rows += `<div class="mxrow">${grid}</div>`;
  }

  // 凡例はセルと同じ式から作る。凡例と実物が違う色だと照合できない。
  const legend = `<div class="mxlegend">`
    + `<span class="ramp"><i style="background:${rampGradient()}"></i>`
      + `<b>期待薄</b><span>→</span><b>絶景</b></span>`
    + `<span><span class="g-inline">A</span>/<span class="g-inline">B</span>/<span class="g-inline">C</span> は信頼度</span></div>`;

  // 見られない現象は行を作らない。行があると「今日は0点」と読めてしまう。
  const out = dead.length
    ? `<details class="mxout"><summary>判定対象外・データ不足の現象 ${dead.length}件</summary>`
      + `<ul style="padding:0;margin:4px 0 0">` + dead.map((id) =>
          `<li>${iconFor(id)} <strong>${esc(S.PHENOMENA[id].name)}</strong> — ${
            esc(weeks[id][0].evaluation.unavailable.message)}</li>`).join("") + `</ul></details>`
    : "";

  return `<div class="card" style="padding:14px 0 12px">
    <div class="mxscroll"><div class="mxstack" style="--days:${dayList.length}">
      <div class="mxhead">${head}</div>${rows}</div></div>
    <div style="padding:0 16px">${legend}${out}</div></div>`;
}

/**
 * 予報を待っているあいだの骨組み。**空白のまま3秒待たせない。**
 *
 * 日付と行の名前は予報が無くても決まるので、先に出して**形を確定させる**。
 * 中身が入っても行が動かないので、読み始めた場所がずれない。
 * 実測（2026-09-26・本番・予報の保存を消した状態）: 予報が出そろうまで約3.2秒あり、
 * その間は見出しと「8つの気象モデルから取得しています…」だけで、下は真っ白だった。
 */
function renderSkeleton(now) {
  const today = S.Cal.startOfDay(now);
  const days = Array.from({ length: 14 }, (_, i) => today + i * 86400000);
  const order = Object.entries(S.PHENOMENA)
    .sort((a, b) => (a[1].order ?? 99) - (b[1].order ?? 99));
  // 骨組みにも同じ札を置く。置かないと、予報が届いた瞬間に見出しの高さが変わる
  let head = `<div class="mxrail mxsort">${sortFace()}</div>`;
  for (const dayMs of days) {
    const wd = S.Cal.weekday(dayMs);
    const cls = [wd === "土" ? "sat" : wd === "日" ? "sun" : "", dayMs === today ? "today" : ""].filter(Boolean).join(" ");
    head += `<div class="dhead ${cls}"${cls.includes("today") ? ' aria-current="date" aria-label="今日"' : ""}><span class="d">${S.Cal.monthDay(dayMs)}</span><span>${wd}</span>${cls.includes("today") ? '<span class="sr-only">今日</span>' : ""}</div>`;
  }
  let rows = "";
  for (const [id, meta] of order) {
    // 記号は本物と同じ出し方にする（月は満ち欠けで変わる）。入れ替わりで印が動かない
    let grid = `<div class="mxrail"><span>${iconFor(id, now)}</span>`
      + `<span class="nmw"><span class="nm">${esc(meta.name)}</span></span></div>`;
    for (let i = 0; i < days.length; i++) grid += `<div class="cell skel"></div>`;
    rows += `<div class="mxrow">${grid}</div>`;
  }
  return `<div class="card" style="padding:14px 0 12px" aria-hidden="true">
    <div class="mxscroll"><div class="mxstack skel" style="--days:${days.length}">
      <div class="mxhead">${head}</div>${rows}</div></div></div>`;
}

// 一覧と詳細で、点数・棒・日付・信頼度の読み方を揃える。
function renderDays(id, entries, now, selected = null) {
  const meta = S.PHENOMENA[id];
  const u = upcoming(entries, now);
  return entries.map((e) => {
    const ev = e.evaluation;
    // 全部の日を日付で書く。「今日」「明日」だけ1行になって、
    // その下に置いた等級の位置が日ごとにずれていた。どの列が今日かは
    // 左端であることと、次の回の枠（.next）で分かる。
    const label = `${S.Cal.monthDay(e.dayMs)}<br>${S.Cal.weekday(e.dayMs)}`;
    if (ev.unavailable) {
      return `<div class="day" style="opacity:.45" title="${esc(ev.unavailable.message)}"><span class="v muted">—</span>
        <span class="col"><i style="height:3px;background:var(--line)"></i></span>
        <span class="d">${label}</span></div>`;
    }
    const color = RANK_COLOR[ev.rank.key];
    const h = Math.max(3, Math.round(30 * ev.score / 100));
    const isNext = selected === null && u && e.dayMs === u.dayMs ? " next" : "";
    // 終わった回は薄くする。押せるままにするのは、見えたかどうかを記録するため。
    const isPast = ev.window[1] <= now ? " past" : "";
    // 14日ぶん並ぶので、どこから先を鵜呑みにしないかを1文字で添える。
    const grade = S.reliabilityGrade(ev.confidence, ev.models);
    // 朝・日中・夕を持つ現象（富士山）は、**日のカードも3段**にする。
    // 1つの数字（一日のトータル）だけだと、どの時間帯の話か日ごとに比べられない
    // （2026-09-24 ユーザー指摘）。棒はその場所を3段に譲る。
    const bands = Array.isArray(ev.bands) && ev.bands.some((b) => b.score !== null) ? ev.bands : null;
    const attrs = `${isNext}${isPast}${bands ? " bands" : ""}" ${selected === null
      ? `data-cell="${id}|${e.dayMs}"`
      : `data-day="${e.dayMs}" aria-pressed="${e.dayMs === selected}" aria-controls="dayDetail"`}`;
    const title = bands
      ? `${meta.name} ${S.JstCal.relativeDay(e.dayMs, now)} `
        + bands.map((b) => `${b.label} ${b.score === null ? "—" : `${Math.round(b.score)}点`}`).join(" / ")
        + ` ・ 信頼度${grade.key}（${grade.caption}）${isPast ? "（終了）" : ""}`
      : `${meta.name} ${S.JstCal.relativeDay(e.dayMs, now)} ${Math.round(ev.score)}点 `
        + `${S.phrasing(id, ev.rank).label} ・ 信頼度${grade.key}（${grade.caption}）${isPast ? "（終了）" : ""}`;
    const body = bands
      ? `<span class="bd">${bands.map((b) => {
          const top = b.score !== null && bands.every((x) => x.score === null || x.score <= b.score);
          return `<i>${esc(b.label)}</i><b style="color:${b.score === null ? "var(--tertiary)"
            : RANK_COLOR[S.rankOf(b.score).key]}${top ? ";font-weight:800" : ""}">${
            b.score === null ? "—" : Math.round(b.score)}</b>`;
        }).join("")}</span>`
      : `<span class="v" style="color:${color}">${Math.round(ev.score)}</span>
         <span class="col"><i style="height:${h}px;background:${color}"></i></span>`;
    return `<button class="day${attrs}
      title="${esc(title)}">
      ${body}
      <span class="d">${label}</span>
      <span class="g">${grade.key}</span></button>`;
  }).join("");
}




// 月の形は、一覧の月のアイコンと同じ仕組み（AstroNotesMoon.phaseOf：輝面と満ち欠けの向き）で決める。
// 以前はここだけ月齢の表（MOON_FACES）で決めていて、同じ時刻でも一覧と形・呼び名が食い違うことがあった（2026-10-01）

// その日の光の時間。撮りに行くなら点数より先に要る情報なので、詳細では上のほうに置く。
//
// 表で出していたが、朝夕2列×3行の数字を読んで頭で1日に組み直す必要があった。
// 1日を1本の帯にして、夜・薄明・ブルーアワー・ゴールデンアワーを
// 【実際の時刻】で色分けする。停止位置は Sun.eventTime が返す時刻そのもの。
//
// 軸は 0〜27時。夜の現象は暦をまたぐ（9/7の星空の見ごろは 9/8 0:28）。
// 0〜24時で切ると星空が軸から落ちるので、テレビ欄と同じ27時制で描く。
// 月の出・月の入りを時刻で出す。
//
// 月の行で知りたいのは点数より「何時に出て、そのとき見えるか」（2026-09-14 ユーザー）。
// 必要な計算は astronotes-moon.js の timeline / markers に既にあり、
// 画面へ繋いでいなかっただけ。
//
// 4段に分けているのは、月の出が**一点ではない**ため。
//   空の上では … 平らな地平線での理論値（暦や新聞に載る値）
//   地形から   … 実際の山や尾根から上端が出る時刻。ここが本当の「見え始め」の下限
//   まるごと   … 全体が出る時刻。写真に撮るならここから
//   見え始め   … 雲と薄明を入れて、実際に視認できると見込まれる時刻
// 平らな地平線の値だけを出すと、山に囲まれた土地では何十分も早く言うことになる。
function renderMoonTimes(dayMs) {
  if (typeof AstroNotesAstro === "undefined" || typeof AstroNotesMoon === "undefined") return "";
  if (!moonObs) return "";
  const horizonAt = moonHorizon || (() => 0);
  let ev;
  try {
    ev = AstroNotesAstro.moonEvents(dayMs, dayMs + 86400000, moonObs, { horizonAt });
  } catch { return ""; }

  const hm = (t) => (t ? S.JstCal.hhmmRounded(t) : "—");
  const pick = (kind, names) => {
    for (const n of names) {
      const hit = ev.terrain.find((e) => e.kind === kind && e.event === n);
      if (hit) return hit.at;
    }
    return null;
  };
  const astro = (kind) => ev.astronomical.find((e) => e.kind === kind)?.at ?? null;

  // 雲込みの「見え始め／最後に見える」。見つからなければ、その日の最良の見込みを返す
  const detail = moonVisibility.get(dayMs);
  if (!detail) requestMoonDetails(dayMs);
  const best = { rise: detail?.rise?.best ?? null, set: detail?.set?.best ?? null };
  const vis = { rise: detail?.rise?.at ?? null, set: detail?.set?.at ?? null };

  const rows = [
    // 「地形から」だと、遮るものがある方向にしか意味が無いように読める。
    // 高い場所では地平線が**下がる**ので暦より早く出る（東京タワー150mで2分早い）。
    // 上下どちらへも動くので、場所で決まるという言い方にする。
    ["暦の上では", astro("rise"), astro("set")],
    ["この場所では", pick("rise", ["firstLimb"]), pick("set", ["start"])],
    ["まるごと", pick("rise", ["fullDisk"]), pick("set", ["full"])],
    ["見え始め", vis.rise, vis.set],
  ];
  if (rows.every((r) => r[1] === null && r[2] === null)) return "";

  // 「見え始め」が両方とも出ないとき、ダッシュ2つだけだと壊れて見える。
  // 見込みが何%までしか上がらなかったのかを言う。
  const noVisible = !!detail && !detail.failed && vis.rise === null && vis.set === null;
  const peak = Math.max(best.rise ?? 0, best.set ?? 0);

  // 月は毎日約50分ずれるので、出ない日・入らない日がある。黙って空欄にしない。
  const note = (!astro("rise") || !astro("set"))
    ? `<div class="tiny" style="margin-top:6px;color:var(--tertiary)">この日は${!astro("rise") ? "月の出" : "月の入"}がありません</div>`
    : "";
  return `<div class="card" id="moonTimes">
    <div class="lt">
      <span></span><span class="lt-h">月の出</span><span class="lt-h">月の入</span>
      ${rows.map(([l, a, b]) => {
        // **「見え始め」がこの表でいちばん使う行。** 雲も山も建物も込みで、実際に見え出す時刻。
        // 4段の最後に同じ太さで並べていたので埋もれていた（2026-09-24 ユーザー指摘）。
        const key = l === "見え始め" ? ' class="lt-key"' : "";
        return `<span class="lt-l"${key}>${esc(l)}</span><span${key}>${l === "見え始め" && !detail ? "…" : hm(a)}</span><span${key}>${l === "見え始め" && !detail ? "…" : hm(b)}</span>`;
      }).join("")}
    </div>
    ${AstroNotesTerrain.locationScope(place) === "area" ? `<div class="tiny" style="margin-top:4px;color:var(--tertiary)">近くの建物は含めていません（地域の代表地点）</div>` : ""}
    ${noVisible ? `<div class="tiny" style="margin-top:4px;color:var(--tertiary)">出入りのころに見える見込みは最大 ${Math.round(peak * 100)}% で、「見え始め」の時刻は出ませんでした。</div>` : ""}
    ${detail?.failed ? `<button type="button" class="fav-btn" data-moon-time-retry="${dayMs}">見え始めの時刻を再試行</button>` : ""}
    ${note}</div>`;
}

// 富士山：時刻ごとの見え方。
//
// 知りたいのは日の代表点ではなく「朝焼け・夕焼けのときに見えるか」と
// 「一日のどこなら見えるか」（2026-09-14 ユーザー）。
// evaluateDay が時刻ごとの結果（hours）と黄金の時間の最良（golden）を返すので、
// それをそのまま並べる。
//
// 帯は一覧のセルと同じ `cellTint` で塗る。同じ点数が同じ色で出るようにするため、
// ここで別の配色を作らない。
// ダイヤモンド富士・パール富士。**天気ではなく幾何と天文の話**なので、天気の表とは別のカードにする。
//
// 年に2回しかない（太陽）ので「その日だけ出す」形にはしない。**いつ来るか**を常に出す。
// 立つ場所が数百m違うと日付が数日ずれるため、地域の代表地点では出さない。
function renderAlignments(now) {
  const a = fujiAlign;
  // **メニューに出している道具の分だけ出す。** 太陽はダイヤモンド富士、月はパール富士の許可で見る
  const showSun = toolAllowed("diamond"), showMoon = toolAllowed("pearl");
  if (!a || (!showSun && !showMoon)) return "";
  const bodies = [showSun && "太陽", showMoon && "月"].filter(Boolean);
  const title = [showSun && "ダイヤモンド富士", showMoon && "パール富士"].filter(Boolean).join("・");
  const head = `<div class="section-h" style="margin-top:2px"><h2>${title}</h2></div>`;
  const wrap = (inner) => `<div class="card">${head}${inner}</div>`;
  if (a.area) {
    return wrap(`<div class="tiny" style="color:var(--tertiary)">地域の代表地点では出せません。
      <strong>立つ場所が1km違うと日付が9日ずれます。</strong>現在地・スポット・お気に入りを選ぶと出ます。</div>`);
  }
  if (a.loading) return wrap(`<div class="tiny" style="color:var(--tertiary)">計算しています…</div>`);
  const sun = showSun ? a.sun || [] : [], moon = showMoon ? a.moon || [] : [];
  if (!sun.length && !moon.length) {
    return wrap(`<div class="tiny" style="color:var(--tertiary)">この地点では、${
      bodies.length > 1 ? "太陽も月も" : `${bodies[0]}は`}山頂に重なりません。</div>`);
  }
  const last = weeks.fuji && weeks.fuji.length ? weeks.fuji[weeks.fuji.length - 1].dayMs + 86400000 : 0;
  const row = (e, label, icon) => {
    const day = S.Cal.startOfDay(e.at);
    const inRange = day >= S.Cal.startOfDay(now) && e.at < last;
    const isMoon = e.illuminated !== null && e.illuminated !== undefined;
    const when = `${S.Cal.monthDay(e.at)}(${S.Cal.weekday(e.at)}) ${S.JstCal.hhmm(e.at)}`;
    // **パール富士は、日の入・日の出からどれだけ離れているかが写真を決める。**
    // 同じ「重なる」でも、日の入直後の薄明の空か、真夜中か、日中かでまるで別物
    //（2026-09-24 ユーザー依頼）。月の出入りからの差も添える（2026-10-01、道具と同じ書き方）
    const twilight = isMoon ? lightTimingText(e.at, observerHere()) : "";
    const extra = [e.rankLabel,
      isMoon ? `輝面 ${Math.round(e.illuminated * 100)}%` : null,
      isMoon ? twilight : null,
      isMoon ? (e.side === "rise" ? "月の出側" : "月の入側")
             : (e.side === "rise" ? "日の出側" : "日の入側")].filter(Boolean).join(" ・ ");
    const span = e.dayCount > 1
      ? `<span class="tiny sub-line" style="color:var(--tertiary)">前後 ${S.Cal.monthDay(e.from)}〜${S.Cal.monthDay(e.to)} も重なります</span>` : "";
    // ボタンの中に置けるのは句だけなので、行は span（.al-l・.al-w・.sub-line で段にする）
    const body = `<span class="al-l">${icon} ${esc(label)}</span>`
      + `<span class="al-w"><strong>${when}</strong> <span class="tiny">${esc(extra)}</span></span>`
      + span
      + (inRange ? `<span class="tiny sub-line" style="color:var(--accent)">この日の見え方を見る →</span>` : "");
    // 予報のある日なら、その日の富士山の見え方へ飛べる。**天気は別に計算しない**
    return inRange
      ? `<button class="al-row jump" data-jump="${day}" title="この日の富士山の見え方を見る">${body}</button>`
      : `<div class="al-row">${body}</div>`;
  };
  const rows = [
    ...sun.map((e, i) => row(e, i === 0 ? "ダイヤモンド富士" : "その次", AstroNotesIcons.icon("sun"))),
    ...moon.map((e, i) => row(e, i === 0 ? "パール富士" : "その次", iconFor("moon", e.at))),
  ].join("");
  // 片方しか無いことがある。**黙って消さない**（探して無いのか、そもそも出ないのか分からない）
  const none = [
    showSun && !sun.length ? "ダイヤモンド富士は今後1年でありません" : null,
    showMoon && !moon.length ? "パール富士は今後1年でありません（満ちた月が山頂に重なる回がない）" : null,
  ].filter(Boolean);
  return wrap(`<div class="al">${rows}</div>
    ${none.length ? `<div class="tiny" style="margin-top:6px;color:var(--tertiary)">${none.map(esc).join("／")}</div>` : ""}
    <div class="tiny" style="margin-top:8px;color:var(--tertiary)">
      ${bodies.join("・")}の中心が<strong>山頂の火口の縁</strong>に届くかで判定しています（縁の内側6割なら「ど真ん中」）。
      <strong>立つ場所が数百m違うと日付が数日ずれます。</strong>まわりの木や建物は含めていません。</div>`);
}

function renderFujiTimes(ev) {
  if (!ev || !ev.hours || !ev.hours.length) return "";
  const hm = (t) => S.JstCal.hhmmRounded(t);
  // 計算は30分きざみだが、**並べるのは1時間ごと**。
  // 27個に数字を入れると 375px 幅で読めない（1セル 13px）。
  // その1時間でいちばん良い値を採る（日の代表値が最良なのと同じ扱い）。
  const byHour = new Map();
  for (const h of ev.hours) {
    const k = Math.floor((h.at + 9 * 3600000) / 3600000);
    const cur = byHour.get(k);
    if (!cur || h.score > cur.score) byHour.set(k, h);
  }
  const cells = [...byHour.entries()].sort((a, b) => a[0] - b[0]).map(([k, h]) => ({ ...h, hourKey: k }));

  // 帯も朝・日中・夕で区切る。**上の表と同じ切れ目**にする（別の切り方をすると
  // 表の数字がどこから来たのか辿れない。2026-09-24 ユーザー指摘）。
  // 切れ目は、上の3段が持っている時刻から決める。
  const { amEnd = null, pmStart = null } = ev.bandBounds || {};
  const segOf = (h) => (amEnd !== null && h.at <= amEnd ? "morning"
    : pmStart !== null && h.at >= pmStart ? "evening" : "midday");
  const SEG_LABEL = { morning: "朝", midday: "日中", evening: "夕" };
  const segs = [];
  for (const h of cells) {
    const key = segOf(h);
    if (!segs.length || segs[segs.length - 1].key !== key) segs.push({ key, cells: [] });
    segs[segs.length - 1].cells.push(h);
  }
  const cell = (h) => `<div class="ft-c" style="background:${cellBg(h.score)}" `
    + `title="${esc(SEG_LABEL[segOf(h)])} ${esc(hm(h.at))}　${Math.round(h.score)}点　${esc(h.why || "")}">`
    + `<span>${Math.round(h.score)}</span></div>`;

  // 時刻は3時間ごと。窓は市民薄明の始まり（例 4:58）なので、
  // 「毎時0分」で拾おうとすると一度も当たらない（実際そうなって目盛りが消えた）。
  // セルの並び順を基準に、3つおきで振る。
  const HOUR = (h) => new Date(h.at + 9 * 3600000).getUTCHours();

  // 朝・日中・夕の3段。**日中も出す**（朝夕だけにすると、真昼に見たい日が読めない。
  // 2026-09-24 ユーザー指摘）。一覧はこの3つを含む一日のトータル1つ。
  const bandRow = (b) => {
    if (!b || b.score === null) return `<span class="lt-l">${esc(b ? b.label : "—")}</span><span>—</span><span class="tiny">この日は評価できません</span>`;
    const best = bands.every((x) => x.score === null || x.score <= b.score);
    return `<span class="lt-l${best ? " lt-key" : ""}">${esc(b.label)}</span><span${best ? ' class="lt-key"' : ""}>${hm(b.at)}</span>`
      + `<span><strong>${Math.round(b.score)}</strong> <span class="tiny">${esc(S.phrasing("fuji", S.rankOf(b.score)).label)}</span></span>`;
  };
  const bands = ev.bands || [];

  return `<div class="card">
    <div class="lt" style="grid-template-columns:auto auto 1fr">
      <span></span><span class="lt-h">時刻</span><span class="lt-h">見え方</span>
      ${bands.map(bandRow).join("")}
    </div>
    <div class="ft-segs" style="grid-template-columns:${segs.map((g) => `${g.cells.length}fr`).join(" ")}">
      ${segs.map((g) => `<span>${esc(SEG_LABEL[g.key])}</span>`).join("")}
    </div>
    <div class="ft-segs ft-bandwrap" style="grid-template-columns:${segs.map((g) => `${g.cells.length}fr`).join(" ")}">
      ${segs.map((g) => `<div class="ft-band" style="grid-template-columns:repeat(${g.cells.length},minmax(0,1fr))">`
        + g.cells.map(cell).join("") + `</div>`).join("")}
    </div>
    <div class="ft-segs" style="grid-template-columns:${segs.map((g) => `${g.cells.length}fr`).join(" ")}">
      ${segs.map((g) => `<div class="ft-ticks" style="grid-template-columns:repeat(${g.cells.length},minmax(0,1fr))">`
        + g.cells.map((h, i) => `<span>${i % 3 === 0 ? HOUR(h) + "時" : ""}</span>`).join("") + `</div>`).join("")}
    </div>
  </div>`;
}

// 富士山の詳細から笠雲へ1行。**同じ山の話**なので隣に置く。
// 笠雲は独立した行としても並ぶ（起きるか起きないかの現象なので見どころにも出る）。
//
// 2026-09-15 まで、ここには「笠雲の気象条件」という湿度と風の表を開く
// `<details>` を置いていた（確率は出さない内部版）。点数を出すようになったので、
// 条件は詳細の「この点数のわけ」に内訳として出る。表を二重に持たない。
function renderCapLine(dayMs) {
  const rows = weeks.capCloud;
  if (!rows || typeof AstroNotesCapCloud === "undefined") return "";
  const hit = rows.find((r) => S.JstCal.sameDay(r.dayMs, dayMs));
  if (!hit || hit.evaluation.unavailable) return "";
  const ev = hit.evaluation;
  const label = S.phrasing("capCloud", ev.rank).label;
  const type = ev.detail ? AstroNotesCapCloud.TYPE_LABEL[ev.detail.type] : "";
  return `<a class="card cap-line" href="#/capCloud">
    <span class="ic">${iconFor("capCloud")}</span>
    <span><strong>笠雲</strong> ${esc(label)} ${Math.round(ev.score)}
      <span class="tiny" style="color:var(--tertiary)">${esc(type)}・${S.JstCal.hhmmRounded(ev.peak)}ごろ</span></span>
    <span class="go">›</span></a>`;
}

// 笠雲の条件がいちばん整う時間帯。
//
// **「できはじめる時刻」は出せない。** このスコアが測っているのは「材料が揃っているか」で、
// 材料は総観規模（数時間〜一日）でしか動かない。雲そのものの発生・消滅より遅い。
// 最初これを 40点の出入りで「出はじめ・弱まる」として出したら、条件の良い日は
// **0:00〜23:00 の24時間**になって何も言っていなかった（2026-09-15 ユーザー指摘）。
//
// 閾値はその日が到達したランクの境界。見出しが「好条件 97」なら 85点以上でいられる時間。
// 見出しの言葉と時間帯の意味が一致し、良い日ほど自動的に絞られる。
function renderCapTiming(ev) {
  const t = ev.timing;
  const label = (k) => S.phrasing("capCloud", S.RANKS.find((r) => r.key === k)).label;
  if (!t) {
    return `<div class="card"><div class="tiny" style="color:var(--tertiary)">
      この日は「${esc(label("fair"))}」に届く時間帯がありません。</div></div>`;
  }
  const hm = (x) => S.JstCal.hhmmRounded(x);
  const name = label(t.rankLabel);
  // **ほぼ一日なら「時間帯」と言わない。** 絞れていないことを絞れたように見せない
  if (t.allDay) {
    return `<div class="card">
      <div><strong>${esc(name)}</strong>の条件が<strong>一日を通して</strong>続きます
        <span class="tiny" style="color:var(--tertiary)">（いちばん整うのは ${hm(t.peakAt)} ごろ）</span></div>
      <div class="tiny" style="margin-top:6px;color:var(--tertiary)">
        材料が一日中そろっている日です。時間帯は絞れません。
        時間帯の出し方そのものは検証していません。</div>
    </div>`;
  }
  return `<div class="card">
    <div class="lt" style="grid-template-columns:auto auto 1fr">
      <span class="lt-l">いちばん整う</span><span>${hm(t.peakAt)}</span><span class="tiny">${Math.round(t.peakScore)}点</span>
      <span class="lt-l">その前後</span><span>${t.openStart ? "〜" : ""}${hm(t.from)}–${hm(t.to)}${t.openEnd ? "〜" : ""}</span><span class="tiny">${t.hours} 時間</span>
    </div>
    <div class="tiny" style="margin-top:6px;color:var(--tertiary)">
      「${esc(name)}」（${t.thresholdScore}点）の条件でいられる時間です。1時間きざみの目安${
        t.spans > 1 ? `で、途切れる時間帯が ${t.spans - 1} 回あります` : ""}。
      ${t.openStart || t.openEnd ? "前後の日へ続いている可能性があります。" : ""}
      <strong>雲ができはじめる時刻ではありません</strong>——笠雲が見えそうな時間帯です。
      時間帯の出し方そのものは検証していません。
    </div>
  </div>`;
}

// 笠雲の詳細から富士山へ。**笠雲は見えてこそ**なので、
// 「その日に富士山が見えるか」を隣に置く。材料が揃っていても霞んでいれば写らない。
function renderFujiBackLine(dayMs) {
  const rows = weeks.fuji;
  if (!rows) return "";
  const hit = rows.find((r) => S.JstCal.sameDay(r.dayMs, dayMs));
  if (!hit || hit.evaluation.unavailable) return "";
  const ev = hit.evaluation;
  return `<a class="card cap-line" href="#/fuji">
    <span class="ic">${iconFor("fuji")}</span>
    <span><strong>富士山そのもの</strong> ${esc(S.phrasing("fuji", ev.rank).label)} ${Math.round(ev.score)}
      <span class="tiny" style="color:var(--tertiary)">笠雲は富士山が見えてこそ</span></span>
    <span class="go">›</span></a>`;
}

/**
 * 山・建物の稜線を入れた日の出・日の入（太陽の上の縁が稜線から出る・稜線に隠れる時刻）。帯の印は暦の上の時刻のまま。
 * 2026-10-02 「空の見え方」をなくした（ユーザー「使い物になってない」→ なくすを選んだ）ので、その画面にしか無かったこの時刻をここへ移した。
 * 月は月の詳細に「この場所では」がある。稜線は月の判定が測ったもの（地形＋建物）を使い、地形を測れていなければ出さない（平らな地平線なら暦と同じ）
 */
// 予報の詳細の日の出・日の入（2026-10-20 ユーザー「予報ならざっくり日の出日の入の時間を残すだけでいい」
// 「夕焼けには日の入、朝焼けには日の出だけでいいのか」）。時間帯の帯・ゴールデン／ブルーアワーはホームの太陽へ移した。
// 夕焼けは日の入だけ、朝焼けは日の出だけ、ほかの現象は両方を1行で出す
function renderLightTimes(dayMs, now, phenomenonId) {
  const w = S.Sun.lightWindows(dayMs, place.latitude, place.longitude);
  const t = (x) => S.JstCal.hhmmRounded(x);
  const items = [["日の出", w.sunrise, "sunrise"], ["日の入", w.sunset, "sunset"]]
    // 見出しに入れるので朝焼け・夕焼けだけ（ほかの現象で2つ並べると見出しが2〜3行に折り返した）
    .filter(([, x, kind]) => x !== null && (phenomenonId === "sunset" ? kind === "sunset" : phenomenonId === "sunrise" ? kind === "sunrise" : false));
  if (!items.length) return "";
  // 2026-10-20 ユーザー「ここら辺空いてるから入れれば良かったんじゃない?」：カードの見出しの空き（名前と共有ボタンのあいだ）に置く
  // 絵は付けない。見出しの左に同じ朝焼け・夕焼けの絵があり、2つ並んでいた（2026-10-20 ユーザー「ピクトグラムがだぶってる」）
  return `<span class="lt-simple" id="lightTimes">${items.map(([name, x]) =>
    `<span class="lt-item"><b>${name}</b><span class="v">${t(x)}</span></span>`).join("")}</span>`;
}

/// 選択中の現象の詳細。1本の列で、上から読む順に並べる。
///
/// 現象を選ぶプルダウンは置かない。画面を分けたので、別の現象を見たいときは
/// 一覧へ戻って選ぶのが素直で、行き先も分かる。
/// 「週間」はここに残す。この画面で日を替える手段。
function renderDetailPane(id, now) {
  const entries = weeks[id];
  if (!entries || !entries.length) return "";
  const u = upcoming(entries, now);
  const sel = entries.find((e) => e.dayMs === selectedDay[id]) || u;
  return `<div data-id="${id}">${renderWeek(id, entries, sel, now)}
    <p id="dayAnnouncement" class="sr-only" role="status" aria-live="polite" aria-atomic="true"></p>
    <div id="dayDetail">${renderDayDetail(id, entries, sel, now)}</div></div>`;
}

function renderDayDetail(id, entries, sel, now) {
  const ev = sel.evaluation;
  const meta = S.PHENOMENA[id];
  // 星空は「その瞬間」ではなく「この時間帯に見に行く」話なので、詳細では幅で出す。
  // 一覧のカードは場所が無いので開始時刻だけ。
  const spanHours = (ev.window[1] - ev.window[0]) / 3600000;
  const asRange = id === "starrySky" && spanHours >= 1.5;
  // **見出しには必ず「いつ」を出す。** 富士山・笠雲・虹は日付だけで、朝の話か夕方の話か
  // 分からなかった（2026-09-24 ユーザー指摘）。時刻が出せないものは時間帯の語で埋める。
  // 朝焼け・夕焼けは見出しに日の出／日の入の時刻があるので、ここは日付だけ（2026-10-20 ユーザー「この観点でしっかり見直して」：同じ時刻が2回出ていた）
  const headTime = id === "sunset" || id === "sunrise";
  const when = `${S.JstCal.relativeDay(sel.dayMs, now)}`
    + (headTime ? "" : ev.specificTime === false ? (meta.timeOfDay ? ` ${meta.timeOfDay}` : "")
       : asRange ? ` ${S.JstCal.hhmmRounded(ev.window[0])}〜${S.JstCal.hhmmRounded(ev.window[1])}`
       : ` ${S.JstCal.hhmmRounded(ev.peak)}`);

  if (ev.unavailable) {
    return `<div class="card">
      <div class="ph-head"><span class="ic">${iconFor(id, ev.peak)}</span><span class="nm">${S.longNameOf(id)}</span></div>
      <div class="ph-out">${esc(ev.unavailable.message)}</div></div>`;
  }
  const color = RANK_COLOR[ev.rank.key];
  const head = `<div class="card highlight" style="border-color:${color}">
      <div class="ph-head"><span class="ic">${iconFor(id, ev.peak)}</span><span class="nm">${S.longNameOf(id)}</span>${renderLightTimes(sel.dayMs, now, id)}
        ${id === "moon" ? `<span class="tiny" style="color:var(--tertiary)">${esc(phaseNameFor(ev.peak))}</span>` : ""}${planButtons(`data-plan-source="detail" data-plan-id="${id}" data-plan-day="${sel.dayMs}"`)}</div>
      <div class="head-row">
        <span class="muted">${when}</span>
        ${renderVerdict(id, ev)}
      </div>
      ${renderScoreBar(ev)}
      <div style="margin-top:9px">${esc(S.phrasing(id, ev.rank, ev.afterglow).say)}</div>
      <div class="tiny" style="margin-top:4px">${CONF_ICON[ev.confidence.key]} ${esc(confidenceText(ev))}</div></div>`;
  return `${head}
    ${renderTwilight(ev)}
    ${id === "moon" ? renderMoonTimes(sel.dayMs) : ""}
    ${id === "fuji" ? renderAlignments(now) + renderCapLine(sel.dayMs) : ""}
    ${id === "capCloud" ? renderCapTiming(ev) + renderFujiBackLine(sel.dayMs) : ""}
    <div class="card">${renderDetail(id, sel, now)}</div>
    <details class="card more"><summary>もっと詳しく</summary>
      ${id === "fuji" ? renderFujiTimes(ev) : ""}${renderDetail(id, sel, now, { part: "how" })}${renderTable(id, entries)}
      <p class="tiny">📖 ${esc(ev.source)}</p></details>`;
}

// 朝夕焼けの時間帯ごとの見込み（2026-10-20 ユーザー「日の入り前に色付きそうは欲しい」「どの時間がどんな感じで良さそうか」）。
// 太陽高度で分けた3つの時間帯を、本体と同じ実写モデルにその時間の気象を入れて出す（API の twilight）。
// 2026-10-20 ユーザー「ごちゃごちゃ文字を出すのは好きじゃない。検証中・目安の注記・見頃はいらない（点数を見ればどの時間がいいかわかる）」：
// 時間帯・時刻・評価語・点数・棒だけを出す。API の best / verified は読まない
// 点数も出す（2026-10-20 ユーザー「時間帯ごとの見込みでも点数が観れるといい」）。320幅では棒を外して数字を残す
// 評価の語は上のカードと同じ（朝夕焼けなら「よく染まる」「ほんのり」「期待薄」）。2026-10-20 ユーザー「ほんのりなのに時間帯は平凡とか良好なの?」
// 月と富士山にも同じ形で出す（2026-10-21 ユーザー「月について、登って行ってから見え始めるのか、月の出は見えるのか、
// 月の入は見えるのか」「富士山も、朝焼けの時間は見えるのか夕焼けの時間は見えるのかそれとも日中なのか」）。
// 月は API の timeBands（月の出のころ・高く昇ったころ・月の入のころ）。富士山は前からある朝・日中・夕の最高点（bands）と
// その境目（bandBounds）。富士山の1時間ごとの色の帯は同じ情報なので「もっと詳しく」へ移した
function timeBandPhases(ev) {
  if (ev.twilight && Array.isArray(ev.twilight.phases)) return ev.twilight.phases;
  if (ev.phenomenon === "moon" && ev.timeBands && Array.isArray(ev.timeBands.phases)) return ev.timeBands.phases;
  if (ev.phenomenon === "fuji" && Array.isArray(ev.bands) && ev.bandBounds && Array.isArray(ev.window)) {
    const { amEnd = null, pmStart = null } = ev.bandBounds;
    const win = { morning: amEnd !== null ? [ev.window[0], amEnd] : null,
      midday: amEnd !== null && pmStart !== null ? [amEnd, pmStart] : null, evening: pmStart !== null ? [pmStart, ev.window[1]] : null };
    const label = { morning: "朝焼け", midday: "日中", evening: "夕焼け" };
    return ev.bands.filter((b) => label[b.key]).map((b) => ({ id: b.key, label: label[b.key], window: win[b.key],
      score: Number.isFinite(b.score) ? b.score : null }));
  }
  return null;
}
function renderTwilight(ev) {
  const t = { phases: timeBandPhases(ev) };
  if (!Array.isArray(t.phases) || !t.phases.some((p) => Number.isFinite(p.score))) return "";
  const time = (w) => (w ? `${S.JstCal.hhmmRounded(w[0])}–${S.JstCal.hhmmRounded(w[1])}` : "—");
  const rows = t.phases.map((p) => {
    const ok = Number.isFinite(p.score), r = ok ? S.rankOf(p.score) : null, color = ok ? RANK_COLOR[r.key] : "var(--tertiary)";
    return `<li class="tw-row"><span class="tw-name">${esc(p.label)}</span>
      <span class="tw-time">${time(p.window)}</span><span class="tw-rank" style="color:${color}">${ok ? esc(S.phrasing(ev.phenomenon, r).label) : "—"}</span>
      <span class="tw-score">${ok ? Math.round(p.score) : "—"}</span><span class="tw-bar" aria-hidden="true"><i style="width:${ok ? Math.round(p.score) : 0}%;background:${color}"></i></span></li>`;
  }).join("");
  return `<div class="card twilight-card"><div class="tw-head">時間帯ごとの見込み</div><ol class="tw-list">${rows}</ol></div>`;
}

// 評価の言葉を主役、点数を従にする。
//
// 点数の実測誤差は ±9.5 点（10地点×61日＝610標本）。ランク境界の間隔は 20〜25 点なので、
// 83% の日はランクが動かない。動かないほうを大きく出す。
// 以前は数字が 38.4px、誤差の但し書きが 11px で、いちばん不確かなものがいちばん大きかった。
function renderVerdict(id, ev) {
  const color = RANK_COLOR[ev.rank.key];
  const raw = ev.uncertainty && ev.uncertainty.expectedError !== null
    ? Math.round(ev.uncertainty.expectedError) : null;
  // 「±0」は点数が正確だという意味に読めるが、そうではない。
  // これは51通りの計算どうしの散らばりで、全通りが一致しても実際の空とはずれる
  // （星空の実測誤差は当日で 12.6点）。上限や 100点の頭打ちに全メンバーが
  // 張り付くと 0 になるので、めずらしくもない。0 のときは何も付けない。
  const err = raw === 0 ? null : raw;
  const grade = S.reliabilityGrade(ev.confidence, ev.models);
  return `<span class="verdict-box">
    <span class="verdict" style="color:${color}">${esc(S.phrasing(id, ev.rank).label)}</span>
    <span class="big muted">${Math.round(ev.score)}${err !== null ? ` <span style="font-weight:400">±${err}</span>` : ""}`
    + ` <span class="grade" title="${esc(grade.caption)}">${grade.key}</span></span></span>`;
}

// 点数のバーに、動きうる幅を薄い帯で重ねる。
// 「84」の一点だけを見せると、±8 の幅があることが目に入らない。
function renderScoreBar(ev) {
  const color = RANK_COLOR[ev.rank.key];
  const err = ev.uncertainty && ev.uncertainty.expectedError !== null ? ev.uncertainty.expectedError : null;
  if (err === null) {
    return `<div class="scorebar" style="margin:10px 0 0"><div style="width:${ev.score}%;background:${color}"></div></div>`;
  }
  const lo = Math.max(0, ev.score - err), hi = Math.min(100, ev.score + err);
  return `<div class="scorebar withband" style="margin:10px 0 0">
    <div style="width:${ev.score}%;background:${color}"></div>
    <span class="band" style="left:${lo}%;width:${hi - lo}%;background:${color}"></span></div>`;
}

// 効き具合を記号にする。数字を読まなくても、何が良くて何が足を引っ張っているかが分かる。
//
// 符号だけで決めてはいけない。星空の雲量のように「減点しか無い」要素では、
// 小さな減点はむしろ good な状態を意味する（雲量8%で -4.5 に ✕ を出すと、
// 説明文の「ほとんど雲がありません」と矛盾する）。
// そこで、その評価の中で最も大きな減点・加点を基準にした相対的な重さで決める。
function factorMark(c, maxPositive, maxNegative) {
  if (c < 0) {
    const severity = maxNegative > 0 ? Math.abs(c) / maxNegative : 1;
    if (severity >= 0.6) return { m: "✕", color: "var(--red)" };
    if (severity >= 0.25) return { m: "△", color: "var(--orange)" };
    return { m: "○", color: "var(--accent)" };
  }
  if (c > 0) {
    return c >= maxPositive * 0.6
      ? { m: "◎", color: "var(--accent)" }
      : { m: "○", color: "var(--accent)" };
  }
  return { m: "－", color: "var(--tertiary)" };
}

function renderDetail(id, sel, now, opts = {}) {
  const ev = sel.evaluation;
  const maxAbs = Math.max(1, ...ev.factors.map((f) => Math.abs(f.c)));
  const maxPos = Math.max(0.01, ...ev.factors.map((f) => f.c));
  const maxNeg = Math.max(0.01, ...ev.factors.map((f) => -f.c));
  // 寄与がほぼ 0 の要素は「効かなかった」ことしか言っていない。
  // 1行ずつ並べると、効いた要素が埋もれる。名前だけまとめて1行にする。
  const NEGLIGIBLE = 0.05;
  const moved = ev.factors.filter((f) => Math.abs(f.c) >= NEGLIGIBLE);
  const idle = ev.factors.filter((f) => Math.abs(f.c) < NEGLIGIBLE);
  const factors = moved.map((f) => {
    const pos = f.c >= 0, w = Math.min(50, 50 * Math.abs(f.c) / maxAbs);
    const mk = factorMark(f.c, maxPos, maxNeg);
    return `<div class="f"><div class="fh">
      <span><span class="mark" style="color:${mk.color}">${mk.m}</span>${esc(f.label)}</span>
      <strong style="color:${pos ? "var(--accent)" : "var(--red)"}">${f.c >= 0 ? "+" : ""}${f.c.toFixed(1)}</strong></div>
      <div class="bar"><span class="mid"></span>
        <span class="fill" style="${pos ? `left:50%` : `left:${50 - w}%`};width:${w}%;background:${pos ? "var(--accent)" : "var(--red)"};opacity:.75"></span></div></div>`;
    // 要素ごとの理由文（「低い雲は頭上をふさぎます。ふつうの日より悪い条件です」）は出さない。
    // 良い・悪いは印（◎○△✕）と ± で分かる（2026-10-01 ユーザー「細かい説明文ってこのApp上はいらない」）
  }).join("");
  const perModel = S.MODELS.filter((m) => ev.perModel[m] !== undefined).map((m) => {
    const v = ev.perModel[m], color = RANK_COLOR[S.rankOf(v).key];
    return `<div class="pm"><span class="n">${S.MODEL_NAMES[m]}</span>
      <span class="scorebar"><span style="width:${v}%;background:${color}"></span></span>
      <span class="v">${Math.round(v)}</span></div>`;
  }).join("");
  // 記録できるのはその回が終わってから。まだ来ていない空は評価できない。
  const current = findSighting(id, ev.peak);
  const savedRound = roundOf(id, ev.peak);
  const answerWindow = current?.window || savedRound?.ev.window || ev.window;
  const finished = answerWindow[1] <= now;
  // 分の切上げと日付をそろえる（23:59台を丸めて当日0:00と案内しない）。
  const recordAt = Math.ceil(answerWindow[1] / 60000) * 60000;
  const record = !toolAllowed("records") ? "" : finished
    ? current || savedRound
      ? `<div style="padding:8px 0">${savedPredictionNote(current ? current.predictionSource : savedRound.predictionSource)}<button type="button" class="fav-btn primary" data-open-answers${current?' data-answer-history':''}>${current?'保存した結果を見る':'結果を残す'}</button></div>`
      : `<p class="tiny" style="padding:4px 0">${savedRoundUnavailable()}</p>`
    : `<p class="tiny" style="padding:4px 0">${S.JstCal.sameDay(recordAt, now) ? "" : S.JstCal.monthDay(recordAt) + " "}${S.JstCal.hhmm(recordAt)} を過ぎたら結果を残せます</p>`;
  // 広い画面では「なぜこの点数か」と「どれくらい確かか」で列を分ける。
  // 1行を長くしないための分割で、片方だけを描けるように part で切り替える。
  if (opts.part === "how") {
    return `<div style="padding:4px 0 6px">
      ${renderEnsemble(ev)}
      ${ev.uncertainty && ev.uncertainty.basis === "single" ? ""
        : `<div class="section-h" style="margin-top:8px"><h2>予報モデルごとの見立て</h2></div>${perModel}`}
    </div>`;
  }
  // **掛け算で採点する現象は、加減点の言い方が合わない。**
  // 富士山と月は「見える確率 = A × B × C」で、基準からの増減ではない。
  // 「基準 98 → 98／効かなかった要素: 全部」と出てしまうので、状態として並べる
  // （2026-09-14。既存の器に載せたときに露見した）。
  if (ev.uncertainty && ev.uncertainty.basis === "single") {
    // 値（全角空白の前）だけを出し、続く説明は出さない（2026-10-01）
    const listed = ev.factors.map((f) => {
      const [head] = String(f.detail || "").split("　");
      return `<div class="pk-row"><span>${esc(f.label)}</span>`
           + `<span>${esc(head)}</span></div>`;
    }).join("");
    return `<div style="padding:4px 0 6px">
      <div class="section-h"><h2>この点数のわけ</h2></div>
      <div class="pk-rows">${listed}</div>
      ${record}
    </div>`;
  }
  return `<div style="padding:4px 0 6px">
    <div class="section-h"><h2>この点数のわけ</h2><span class="tiny">基準 ${Math.round(ev.base)} → ${Math.round(ev.score)}</span></div>
    <div class="factors">${factors}</div>
    ${idle.length ? `<p class="tiny" style="padding:2px 0 0">効かなかった要素：${
      idle.map((f) => esc(f.label)).join("、")}</p>` : ""}
    ${record}
  </div>`;
}

function renderWeek(id, entries, sel, now) {
  return `<div class="card" id="detailWeek">
    <!-- 週間の見出しは**今日**の月相。日を切り替えても \$("dayDetail") しか
         差し替わらないので、選んだ日に合わせると食い違ったまま残る。
         選んだ日の月相は、すぐ下の詳細の見出しに出る。 -->
    <div class="ph-head"><span class="ic">${iconFor(id, now)}</span>
      <h2>${S.PHENOMENA[id].name}・週間</h2></div>
    <div class="days" aria-label="詳細を見る日を選ぶ">${renderDays(id, entries, now, sel.dayMs)}</div>
  </div>`;
}

function renderTable(id, entries) {
  if (!bundle) return "";
  const hasSunward = id === "sunset" || id === "sunrise";
  const fmt = (v, unit, dec = 0) => (v === null || v === undefined) ? "—"
    : dec ? v.toFixed(dec) + unit : Math.round(v) + unit;
  const rows = entries.filter((e) => !e.evaluation.unavailable).map((e) => {
    const r = S.readingAt(bundle, id, e.evaluation.peak);
    return `<tr><td>${S.JstCal.relativeDay(e.dayMs, Date.now())}</td>
      <td style="color:${RANK_COLOR[e.evaluation.rank.key]};font-weight:600">${Math.round(e.evaluation.score)}</td>
      <td>${fmt(r.cloudLow, "%")}</td><td>${fmt(r.cloudMid, "%")}</td><td>${fmt(r.cloudHigh, "%")}</td>
      ${hasSunward ? `<td>${fmt(r.sunwardLow, "%")}</td><td>${fmt(r.sunwardMid, "%")}</td><td>${fmt(r.sunwardHigh, "%")}</td>` : ""}
      <td>${fmt(r.precipitation, "", 1)}</td><td>${fmt(r.humidity, "%")}</td>
      <td>${fmt(r.temperature, "℃", 1)}</td>
      <td>${r.visibility === null || r.visibility === undefined ? "—" : Math.round(r.visibility / 1000) + "km"}</td></tr>`;
  }).join("");
  if (!rows) return "";
  return `<div style="padding:4px 0">
    <div class="section-h" style="margin-top:8px"><h2>日ごとの数値</h2></div>
    <div class="scrollx"><table class="numbers">
    <tr><th></th><th>点</th><th>低層</th><th>中層</th><th>高層</th>
    ${hasSunward ? "<th>陽低</th><th>陽中</th><th>陽高</th>" : ""}
    <th>降水</th><th>湿度</th><th>気温</th><th>視程</th></tr>${rows}</table></div>
    ${hasSunward ? `<p class="tiny">陽＝太陽の方向の雲</p>` : ""}</div>`;
}
