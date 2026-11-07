import {prepareExactPolygonDistance,exactScaledPolygonDistance} from './exact-polygon-distance.mjs';
export function patchExactPolygonDistance(source){
 const start='    const bounds=polygons?.map(poly=>',end='    const evaluate = (at, st = bodyAt(body, at, obs)) => {';
 if(source.split(start).length!==2||source.split(end).length!==2)throw Error('Exact polygon distance boundary changed');
 const a=source.indexOf(start),b=source.indexOf(end,a);
 if(b<a)throw Error('Exact polygon distance section moved');
 return source.slice(0,a)+'    const distanceToPolygons=polygons?('+prepareExactPolygonDistance.toString()+')(polygons,polygonDistance,'+exactScaledPolygonDistance.toString()+'):null;\n'+source.slice(b);
}

// Apply after heightGeometry is attached. Returned searches need projected faces
// and scalar flags, not the much larger raw outline/vertex arrays used to prepare them.
export function patchPreparedOutlineRetention(source){
 const start='  function prepareDailyView(',end='  function dailyView(';
 if(source.split(start).length!==2||source.split(end).length!==2)throw Error('Prepared outline boundary changed');
 const a=source.indexOf(start),b=source.indexOf(end,a);let part=source.slice(a,b);
 const replace=(from,to)=>{if(part.split(from).length!==2)throw Error('Prepared outline contract changed: '+from);part=part.replace(from,to);};
 replace('    const outline = mountainRidge ?', '    const hasMountainRidge=!!mountainRidge;\n    let centerAlt,project,polygons,hasOutline,approximate;\n    {\n    const outline = mountainRidge ?');
 replace('    const centerAlt = outline ?', '    centerAlt = outline ?');
 replace('    const project = viewProjector(g.azimuth, centerAlt);','    project = viewProjector(g.azimuth, centerAlt);');
 replace('    const polygons = outline ?', '    polygons = outline ?');
 replace('    const distanceToPolygons=', '    hasOutline=!!outline;approximate=!!outline?.approximate;\n    }\n    const distanceToPolygons=');
 replace('approximate: !!outline?.approximate,','approximate,');
 replace('if (outline) for (let dt', 'if (hasOutline) for (let dt');
 replace('(!crossings.length || mountainRidge)', '(!crossings.length || hasMountainRidge)');
 replace('if(mountainRidge){', 'if(hasMountainRidge){');
 replace('ridge:!!mountainRidge,ridgeBase:mountainRidge?ridgeBase:null,outline:!!outline,', 'ridge:hasMountainRidge,ridgeBase:hasMountainRidge?ridgeBase:null,outline:hasOutline,');
 return source.slice(0,a)+part+source.slice(b);
}
