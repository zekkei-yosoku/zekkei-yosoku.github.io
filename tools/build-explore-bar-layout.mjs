// Trial search is often shorter than the viewport. Keep the document scroll
// owner and shared bar; suppress page-edge bounce without cancelling touches.
const search='#skyMapView[data-explore-stage="search"]';
export const exploreBarStyle=`
html:has(${search}),body:has(${search}){overscroll-behavior-y:none}
html:has(#skyMapView.explore-mounted:not([hidden])){scroll-padding-bottom:calc(var(--sky-footer-h,100px) + 12px)}
@media(max-width:959px){${search} .sky-map-footer{transform:translate3d(0,0,0);backface-visibility:hidden}}
main:has(>#skyMapView.explore-mounted:not([hidden]))>#footer>summary{min-height:44px;display:list-item;padding-block:12px}
`;
