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
