/* AstroNotes pictograms. Rendering only; prediction/astronomical calculations are unchanged. */
(function(global){
  'use strict';
  const star='<path d="M12 2C13 8.8 15.2 11 22 12C15.2 13 13 15.2 12 22C11 15.2 8.8 13 2 12C8.8 11 11 8.8 12 2Z" fill="currentColor" stroke="none"/>';
  const mountain='<path d="m2 20 8-15 4 7 3-4 5 12H2Zm5-9 3 1 2-1"/>';
  const horizon='<path d="M2 16h20M4 20h16M5 16a7 7 0 0 1 14 0"/>';
  const shapes=Object.freeze({
    sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
    sunrise:horizon+'<path d="M12 11V2m-3 3 3-3 3 3"/>',
    sunset:horizon+'<path d="M12 2v9m-3-3 3 3 3-3"/>',
    starrySky:'<g transform="translate(1 -1) scale(.8)">'+star+'</g><path d="M19 15v6m-3-3h6M4 18v4m-2-2h4"/>',
    moon:'<path d="M19.5 15.7A8.8 8.8 0 0 1 8.3 4.5a8.8 8.8 0 1 0 11.2 11.2Z"/>',
    fuji:mountain,
    capCloud:'<path d="m2 21 8-13 4 6 3-3 5 10H2M5 6c0-4 14-4 14 0C19 9 5 9 5 6Z"/>',
    seaOfClouds:'<path d="m3 10 5-7 5 7m-2 0 5-5 5 5M2 13c3-3 5 3 8 0s5 3 8 0h4M2 17h20M5 21h14"/>',
    cityCloudSea:'<path d="M4 12V5h6v7m4 0V2h6v10M7 8v1m10-4v1m0 3v1M2 14c3-3 5 3 8 0s5 3 8 0h4M2 18h20M5 22h14"/>',
    rainbow:'<path d="M2 20v-3a10 10 0 0 1 20 0v3M6 20v-3a6 6 0 0 1 12 0v3M10 20v-3a2 2 0 0 1 4 0v3"/>',
    rime:'<path d="M12 2v20M3.3 7l17.4 10M3.3 17 20.7 7M9 4l3 3 3-3M9 20l3-3 3 3M3 10l4-1V5m10 14v-4l4-1M3 14l4 1v4M17 5v4l4 1"/>',
    diamondDust:'<path d="m12 3 4 6-4 6-4-6 4-6Zm-8 9v6m-3-3h6m12-1v8m-4-4h8"/>'
  });
  const svg=(id,content)=>`<svg class="astro-icon astro-icon-${id}" data-pictogram="${id}" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">${content}</svg>`;
  const icon=id=>Object.hasOwn(shapes,id)?svg(id,shapes[id]):'';
  // The terminator's projected semi-axis is |1 - 2f| * radius.
  // Right-hand light for waxing; mirrored for waning. No globally unique clip IDs.
  function moon(state){
    const f=state?.illuminatedFraction;
    if(typeof f!=='number'||!Number.isFinite(f)||f<0||f>1||typeof state.waxing!=='boolean')return icon('moon');
    const rx=+(Math.abs(1-2*f)*10).toFixed(4);
    const end=rx===0?'L12 2':`A${rx} 10 0 0 ${f<.5?0:1} 12 2`;
    const light=f===0?'':f===1?'<circle cx="12" cy="12" r="10" fill="currentColor" stroke="none"/>':`<path d="M12 2A10 10 0 0 1 12 22${end}Z" fill="currentColor" stroke="none"${state.waxing?'':' transform="translate(24 0) scale(-1 1)"'}/>`;
    const label=`${f===0?'新月':f===1?'満月':state.waxing?'満ちていく月':'欠けていく月'}、輝面${Math.round(f*100)}%`;
    return svg('moon-phase','<circle cx="12" cy="12" r="10" fill="#293542" stroke="none"/>'+light+'<circle cx="12" cy="12" r="10"/>').replace('aria-hidden="true"',`role="img" aria-label="${label}"`);
  }
  const api=Object.freeze({icon,moon,ids:Object.freeze(Object.keys(shapes))});
  global.SoramiIcons=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
