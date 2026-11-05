// Search-stage presentation only. Preview keeps its existing dimensions and controls.
const root='#skyMapView[data-explore-stage="search"]';
export const explorePageStyle=`
main:has(>${root}){max-width:1280px}
${root} #exploreConditions{max-width:none;margin:0;border:0;border-radius:0;background:transparent;position:static}
${root} #exploreConditions>summary{display:none}
${root} .explore-condition-fields{padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:24px}
${root} .explore-search-fields,${root} .explore-known-place{min-width:0}
${root} .explore-section-title{font-size:18px;font-weight:650;margin:0 0 16px}
${root} .explore-known-place{padding-top:20px;border-top:1px solid var(--line)}
${root} .explore-known-place>.tiny{margin:-6px 0 14px}
${root} .sky-map-controls{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;margin:0}
${root} .sky-map-controls .condition-field{margin:0;max-width:none}
${root} #candidateWorkspaceDate{margin:16px 0}
${root} #candidateDateNavigation{margin-bottom:0!important}
${root} #candidateWorkspaceAction #candidateSearchAction{min-height:48px;background:var(--accent);color:var(--on-accent);border:1px solid var(--accent);font-size:16px;font-weight:650}
${root} #candidateWorkspaceAction .aim-disclosure{margin-bottom:0}
${root} .explore-place-actions{display:flex;margin:8px 0 0}
${root} #exploreRecordedPlace{width:auto;padding-inline:18px}
${root} .aim-say-from{margin:0}
${root} .aim-observer-card{background:transparent;border-radius:0}
${root} .aim-observer-card #skyMapObserverDetails{margin:8px 0 0}
${root} .explore-show-result{margin:14px 0 0;min-height:48px}
${root} #exploreSearchResults{width:100%;max-width:none;margin-top:28px;padding:24px 0 0;border-top:1px solid var(--line)}
${root} #exploreSearchResults>h2{font-size:18px;margin-bottom:16px}
${root} #candidateSearchEmpty{margin:0;padding:28px 16px}
@media(min-width:760px){
 ${root} .explore-condition-fields{grid-template-columns:minmax(0,1.15fr) minmax(0,1fr);gap:40px}
 ${root} .explore-known-place{padding:0 0 0 32px;border-top:0;border-left:1px solid var(--line)}
}
`;
