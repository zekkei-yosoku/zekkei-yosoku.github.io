import {readFileSync} from 'node:fs';
const patch=(source,from,to)=>{
 const first=source.indexOf(from);
 if(first<0||source.indexOf(from,first+from.length)>=0)throw Error('Forecast summary boundary changed: '+from.slice(0,100));
 return source.slice(0,first)+to+source.slice(first+from.length);
};
const style=String.raw`
/* The forecast matrix remains one 14-day comparison surface. */
#cards .cell[aria-pressed="true"]{outline:2px solid var(--accent);outline-offset:-2px}
.forecast-selection-head,.forecast-selection-overview{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:6px 10px}
.forecast-selection-head .ph-head{margin:0;min-width:0;flex:1 1 auto}
.forecast-selection-open{margin-left:auto;min-height:32px;color:var(--accent);font-size:.75rem;font-weight:700;white-space:nowrap}
.forecast-selection-close{min-width:36px;min-height:36px;padding:0;color:var(--secondary);font-size:1.3rem}
.forecast-selection-overview{margin-top:8px;font-size:.81rem}
.forecast-selection-verdict{font-weight:700}.forecast-selection-score{margin-left:6px;color:var(--secondary);font-variant-numeric:tabular-nums}
.forecast-selection-time{margin-top:6px;font-size:.94rem;font-weight:700;font-variant-numeric:tabular-nums}
.forecast-selection-say{margin-top:6px;font-size:.81rem}
.forecast-selection-bands{margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}
/* The mobile preview stays in view without moving the comparison table. It is not a modal. */
@media(max-width:640px){
 #cards:has(.forecast-selection){padding-bottom:min(280px,36dvh)}
 .forecast-selection{position:fixed;z-index:20;left:12px;right:12px;bottom:max(12px,env(safe-area-inset-bottom));margin:0;padding:10px 12px;max-height:min(260px,34dvh);overflow:auto;overscroll-behavior:contain;border:1px solid var(--line);box-shadow:0 4px 20px #0003}
 .forecast-selection-head{display:grid;grid-template-columns:minmax(0,1fr) auto 36px;gap:4px}.forecast-selection-head .ph-head{flex-wrap:nowrap;align-items:center}
 .forecast-selection-head .ph-head .nm{font-size:.94rem}
 .forecast-selection-open,.forecast-selection-close{margin-left:0}
 .forecast-selection-overview{margin-top:2px}.forecast-selection-bands{margin-top:6px;padding-top:6px}
}
`;
export function forecastSummaryHtml(html){
 const factory=readFileSync(new URL('../experiments/forecast-summary/controller.js',import.meta.url),'utf8');
 // Trial presentation only: retain both DTOs, metadata, saved results, and direct detail routes.
 // capCloud already has highlight:false; its conditions now supplement the selected Fuji day.
 html=patch(html,'  const best = pickHighlight(weeks, now);','  const best = pickHighlight(Object.fromEntries(Object.entries(weeks).filter(([id]) => id !== "rainbow" && id !== "capCloud")), now);');
 html=patch(html,'  const order = Object.keys(weeks).sort((a, b) => {','  const order = Object.keys(weeks).filter(id => id !== "rainbow" && id !== "capCloud").sort((a, b) => {');
 html=patch(html,'  const order = Object.entries(S.PHENOMENA)\n    .sort','  const order = Object.entries(S.PHENOMENA)\n    .filter(([id]) => id !== "rainbow" && id !== "capCloud")\n    .sort');
 html=patch(html,`function renderCapLine(dayMs) {
  const rows = weeks.capCloud;
  if (!rows || typeof AstroNotesCapCloud === "undefined") return "";
  const hit = rows.find((r) => S.JstCal.sameDay(r.dayMs, dayMs));
  if (!hit || hit.evaluation.unavailable) return "";
  const ev = hit.evaluation;
  const label = S.phrasing("capCloud", ev.rank).label;
  const type = ev.detail ? AstroNotesCapCloud.TYPE_LABEL[ev.detail.type] : "";
  return \`<a class="card cap-line" href="#/capCloud">
    <span class="ic">\${iconFor("capCloud")}</span>
    <span><strong>笠雲</strong> \${esc(label)} \${Math.round(ev.score)}
      <span class="tiny" style="color:var(--tertiary)">\${esc(type)}・\${S.JstCal.hhmmRounded(ev.peak)}ごろ</span></span>
    <span class="go">›</span></a>\`;
}`,`function renderCapLine(dayMs) {
  const hit = weeks.capCloud?.find((r) => S.JstCal.sameDay(r.dayMs, dayMs));
  const ev = hit?.evaluation;
  let text = "この日の条件データはありません。";
  let note = "";
  if (ev?.unavailable) text = "この地点・日では条件を判定できません。";
  else if (ev) {
    const t = ev.timing;
    const partial = ev.dataQuality?.status === "partial";
    if (!t) text = partial ? "判定材料が一部不足しており、時間帯を示せません。" : "この日のデータでは時間帯を示せません。";
    else if (t.allDay) text = "条件が整う時間が広く、時間帯を絞れません。";
    else {
      text = \`条件の時間帯 \${t.openStart ? "〜" : ""}\${S.JstCal.hhmmRounded(t.from)}–\${S.JstCal.hhmmRounded(t.to)}\${t.openEnd ? "〜" : ""}\`;
      note = \`1時間きざみの参考です。\${t.spans > 1 ? "ほかにも条件に届く時間帯があります。" : ""}\${t.openStart || t.openEnd ? "前後の日へ続く可能性があります。" : ""}\`;
    }
    if (t && partial) note += "判定材料が一部不足しています。";
    note += "発生・見え始めの時刻は予測していません。時間帯は未検証の参考です。";
  }
  return \`<section class="card cap-reference" data-day="\${dayMs}" aria-label="笠雲の条件（参考）">
    <div class="tiny" style="font-weight:700">笠雲の条件（参考）</div>
    <div style="margin-top:6px">\${esc(text)}</div>
    \${note ? \`<div class="tiny" style="margin-top:6px;color:var(--tertiary)">\${esc(note)}</div>\` : ""}</section>\`;
}`);
 // Fuji/capCloud arrive together, but a later retry may add missing capCloud data.
 // Refresh only this supplement for the rendered day; keep the open detail and scroll untouched.
 html=patch(html,'  if (inDetail) return;\n  render();',String.raw`  if (inDetail) {
    const reference = picked === "fuji" && document.querySelector("#dayDetail .cap-reference");
    if (reference) reference.outerHTML = renderCapLine(Number(reference.dataset.day));
    return;
  }
  render();`);
 html=patch(html,'let currentView = "list";','let currentView = "list";\nlet forecastSummary = null;');
 // Create the view owner on the first render, not during classic-script startup.
 html=patch(html,'function render() {\n  if (!routeFromHash()', 'function render() {\n  forecastSummary ||= '+factory+`({
 document,host:()=>$("cards"),
 context:()=>({placeKey:predictionKeyFor(place),weeks,now:Date.now()}),
 presentation:{escape:esc,icon:iconFor,name:id=>S.longNameOf(id),meta:id=>S.PHENOMENA[id],
 day:(day,now)=>S.JstCal.relativeDay(day,now),time:t=>S.JstCal.hhmmRounded(t),
 grade:ev=>S.reliabilityGrade(ev.confidence,ev.models),phrase:(id,ev)=>S.phrasing(id,ev.rank,ev.afterglow),
 color:ev=>RANK_COLOR[ev.rank.key],timeBandPhases:ev=>timeBandPhases(ev),bands:ev=>renderTwilight(ev,{inline:true})},
 openDetail:(id,dayMs)=>pick(id,Date.now(),dayMs),announce:message=>{$("listAnnouncement").textContent=message;}
});\n  forecastSummary.capture();\n  if (!routeFromHash()`);
 html=patch(html,'        pick(id, now, +dayMs);','        // Trial: a cell updates the preview; only the explicit detail button navigates.\n        forecastSummary.select(id, +dayMs);');
 html=patch(html,'    if (sel) sel.onchange = () => {','    forecastSummary.restore();\n    if (sel) sel.onchange = () => {');
 // A location change clears the old preview before a new prediction arrives.
 html=patch(html,'  if (!bundle) $("cards").innerHTML = renderSkeleton(Date.now());','  if (!bundle) { forecastSummary?.waiting(); $("cards").innerHTML = renderSkeleton(Date.now()); }');
 html=patch(html,'    $("cards").innerHTML = renderSkeleton(now);','    forecastSummary.waiting();\n    $("cards").innerHTML = renderSkeleton(now);');
 // Reuse the one time-band presentation; only its outer card is omitted inside the summary.
 html=patch(html,'function renderTwilight(ev) {','function renderTwilight(ev, { inline = false } = {}) {');
 html=patch(html,'<div class="card twilight-card"><div class="tw-head">時間帯ごとの見込み</div>','<div class="${inline ? "forecast-selection-bands" : "card twilight-card"}"><div class="tw-head">時間帯ごとの見込み</div>');
 html=patch(html,'</head>','<style>\n'+style+'\n</style>\n</head>');
 return html;
}
