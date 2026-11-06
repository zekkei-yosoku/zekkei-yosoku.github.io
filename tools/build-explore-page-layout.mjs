// Search-stage visual owner. Reuse the existing theme, fields, calendar and picker.
// Preview dimensions and controls stay with the existing Explore presentation.
const root='#skyMapView[data-explore-stage="search"]';
export const explorePageStyle=`
main:has(>${root}){max-width:1280px}
${root} #exploreConditions{max-width:none;margin:0;border:0;border-radius:0;background:transparent;position:static}
${root} #exploreConditions>summary{display:none}
${root} .explore-condition-fields{padding:0;display:grid;grid-template-columns:minmax(0,1fr);gap:12px}
${root} .explore-section-title,${root} .explore-results-heading h2{font-size:1.1rem;font-weight:700;line-height:1.5;margin:0}
${root} .explore-search-intro{padding:0 0 8px}
${root} .explore-search-intro p{font-size:.75rem;line-height:1.6;margin:4px 0 0;color:var(--secondary)}
${root} .sky-map-controls{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;margin:0;max-width:none}
${root} #exploreConditions .condition-field,${root} #exploreConditions .condition-field:has(.condition-clear){grid-template-columns:80px minmax(0,1fr)!important;gap:10px;margin:0;max-width:none;align-items:start}
${root} .condition-field>.condition-label{display:flex;grid-column:1;grid-row:1;align-items:center;gap:6px;min-height:48px;font-size:.75rem;font-weight:600;color:var(--secondary);white-space:nowrap}
${root} .condition-field>.condition-label>svg{width:20px;height:20px;margin:0;align-self:auto;stroke-width:1.8}
${root} .condition-field>.condition-label>span{position:static;width:auto;height:auto;padding:0;margin:0;overflow:visible;clip-path:none;white-space:nowrap}
${root} .condition-field>.condition-label{width:auto}
${root} .condition-field :is(.condition-choice,.preview-body-open,.preview-target-open){height:auto;min-height:48px;border-radius:10px;font-size:16px;font-weight:600;padding:10px 12px;box-shadow:none}
${root} .condition-choice>span{white-space:normal;overflow-wrap:anywhere;text-overflow:clip;line-height:1.5}
${root} .aim-say-from{margin:0;max-width:none}
${root} .aim-observer-card{background:transparent;border-radius:0}
${root} .aim-observer-card>.place-row{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:0 6px 0 12px;box-shadow:none}
${root} .condition-field .place-pick{min-height:48px;padding:8px 0;gap:8px}
${root} .place-row .name{font-size:16px;line-height:1.5;font-weight:600}
${root} .place-row .muted{font-size:.69rem;line-height:1.5}
${root} .explore-place-actions{display:flex;margin:4px 0 0;gap:8px}
${root} #exploreRecordedPlace{min-height:44px;width:auto;margin:0;padding:4px 0;background:transparent;border:0;border-radius:5px;color:var(--accent);font-size:.75rem;font-weight:700;text-align:left;box-shadow:none;display:inline-flex;align-items:center;gap:6px}
${root} .aim-observer-card #skyMapObserverDetails{margin:0;padding:0;border:0}
${root} #skyMapObserverSummary{min-height:44px;display:flex;align-items:center;font-size:.75rem;color:var(--secondary)}
${root} #skyMapAlignmentDetails{margin:0 0 0 90px;padding:8px 0;border-top:1px solid var(--line)}
${root} #candidateWorkspaceAction{display:grid;grid-template-columns:minmax(0,1fr);gap:10px;margin:0}
${root} #additionalCandidateSearch{display:contents}
${root} #candidateWorkspaceAction .aim-disclosure{grid-column:1/-1;margin:0;padding:0;border:0}
${root} #candidateWorkspaceAction .aim-disclosure>summary{display:flex;align-items:center;gap:8px;min-height:44px;border-top:1px solid var(--line);font-size:.75rem;font-weight:600;color:var(--secondary);list-style:none;cursor:pointer}
${root} #candidateWorkspaceAction .aim-disclosure>summary::before{content:'›';display:inline-block;font-size:1.25rem;font-weight:400;color:var(--accent);transform-origin:center}
${root} #candidateWorkspaceAction .aim-disclosure[open]>summary::before{transform:rotate(90deg)}
${root} #candidateWorkspaceAction .aim-disclosure>summary::-webkit-details-marker{display:none}
${root} #candidateWorkspaceAction .aim-disclosure>p{font-size:.75rem;line-height:1.7;margin:8px 0}
${root} #candidateWorkspaceAction .aim-disclosure label{font-size:.75rem;line-height:1.7}
${root} #candidateWorkspaceAction :is(select,input){font-size:16px;min-height:44px;max-width:100%}
${root} #candidateSearchAction,${root} .explore-show-result{width:100%;min-height:48px;margin:0;padding:12px;border-radius:10px;box-sizing:border-box;font-size:.88rem;font-weight:700;line-height:1.5;box-shadow:none}
${root} #candidateSearchAction{background:var(--accent);color:var(--on-accent);border:1px solid var(--accent)}
${root} #candidateSearchAction:disabled{opacity:.5;cursor:not-allowed}
${root} #candidateSearchAction[data-state="searching"]{background:var(--card);color:var(--accent);border-color:var(--accent)}
${root} .explore-show-result{background:transparent;color:var(--accent);border:1px solid var(--line)}
${root} #exploreSearchResults{width:100%;max-width:none;margin:16px 0 0;padding:16px 0 0;border-top:1px solid var(--line)}
${root} .explore-results-heading{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:4px 12px;margin:0 0 12px}
${root} .explore-results-heading>.tiny{font-size:.69rem;color:var(--secondary)}
${root} #candidateSearchEmpty{margin:0;padding:16px;background:transparent;border:1px dashed var(--line);border-radius:10px;font-size:.75rem;line-height:1.7;text-align:left;color:var(--secondary)}
${root} #candidateSearchFeedback:empty,${root} #candidateSearchCredits:empty{display:none}
${root} #candidateSearchFeedback>[role="status"]:empty{display:none}
${root} #candidateSearchFeedback>[role="status"]{font-size:.75rem;line-height:1.7;margin:0 0 12px;color:var(--secondary)}
${root} #candidateSearchFeedback .candidate-wait{background:var(--sunk);border-radius:10px;padding:12px}
${root} #exploreSearchResults #recentCandidates{overflow:visible}
${root} #candidateListControls{border:0;margin:0!important;padding:0!important}
${root} .candidate-filter-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;margin:0 0 8px}
${root} .candidate-filter-fields>label{display:flex!important;flex-direction:column;align-items:stretch!important;gap:4px!important;margin:0!important;font-size:.72rem!important;color:var(--secondary)}
${root} .candidate-filter-fields select{background-color:var(--card);border:1px solid var(--line);border-radius:10px;padding:8px 28px 8px 10px;color:var(--text)}
${root} .candidate-list-actions{align-items:center;justify-content:flex-end;gap:8px!important}
${root} .candidate-list-actions button{flex:0 1 auto;width:auto;min-height:44px;padding:6px 10px;border:1px solid var(--line);border-radius:9px;background:transparent;font-size:.75rem;font-weight:700;color:var(--accent);box-shadow:none}
${root} .candidate-filter-status{font-size:.72rem;line-height:1.6;color:var(--secondary);margin:8px 0!important;font-variant-numeric:tabular-nums}
${root} .candidate-list-heading{margin:0!important;background:var(--sunk);border-radius:9px 9px 0 0;padding:0 10px;grid-template-columns:minmax(0,1fr) 52px 64px!important;gap:8px!important}
${root} .candidate-list-heading button{font-size:.75rem!important;font-weight:700!important}
${root} #candidateUnifiedResults>.list-item{grid-template-columns:minmax(0,1fr) 52px 64px!important;column-gap:8px!important;padding:12px 10px!important;border-bottom:1px solid var(--line);border-radius:0;background:transparent;box-shadow:none}
${root} #candidateUnifiedResults [data-candidate-place]{font-size:.88rem!important;line-height:1.5;font-weight:600!important}
${root} #candidateUnifiedResults :is([data-candidate-time],[data-place-kind]){font-size:.81rem!important;line-height:1.6}
${root} #candidateUnifiedResults .sub-line{font-size:.69rem;line-height:1.6;color:var(--secondary)}
${root} #candidateSearchCredits p{margin:8px 0 0;font-size:.63rem;color:var(--tertiary)}
${root} :is(button,summary,select):focus-visible{outline:2px solid var(--accent);outline-offset:2px}
@media (hover:hover){${root} :is(.explore-show-result,#exploreRecordedPlace,.candidate-list-actions button):hover{background:var(--sunk)}${root} #candidateUnifiedResults>.list-item:hover{background:var(--sunk)}}
@media(min-width:760px){
 ${root} .explore-condition-fields{gap:14px}
 ${root} #exploreConditions .condition-field,${root} #exploreConditions .condition-field:has(.condition-clear){grid-template-columns:104px minmax(0,1fr)!important;gap:16px}
 ${root} #skyMapAlignmentDetails{margin-left:120px}
 ${root} #candidateWorkspaceAction{grid-template-columns:minmax(0,1fr) minmax(0,1fr)}
 ${root} #candidateWorkspaceAction .aim-disclosure{margin-left:120px}
 ${root} #candidateListControls{display:grid;grid-template-columns:minmax(0,1fr) auto;column-gap:16px}
 ${root} .candidate-filter-fields{grid-column:1;margin:0}
 ${root} .candidate-filter-fields>label{display:grid!important;grid-template-columns:auto minmax(0,1fr)!important;align-items:center!important;gap:10px!important}
 ${root} .candidate-list-actions{grid-column:2;align-self:end}
 ${root} #candidateListControls>:is(.candidate-filter-status,.candidate-list-heading,#candidateUnifiedResults,#candidateMapPanel){grid-column:1/-1}
 ${root} .candidate-list-heading,${root} #candidateUnifiedResults>.list-item{grid-template-columns:minmax(0,1fr) 96px 144px!important}
}
`;
