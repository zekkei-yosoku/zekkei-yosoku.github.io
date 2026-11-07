import {prepareExactPolygonDistance} from './exact-polygon-distance.mjs';
export function patchExactPolygonDistance(source){
 const start='    const bounds=polygons?.map(poly=>',end='    const evaluate = (at, st = bodyAt(body, at, obs)) => {';
 if(source.split(start).length!==2||source.split(end).length!==2)throw Error('Exact polygon distance boundary changed');
 const a=source.indexOf(start),b=source.indexOf(end,a);
 if(b<a)throw Error('Exact polygon distance section moved');
 return source.slice(0,a)+'    const distanceToPolygons=polygons?('+prepareExactPolygonDistance.toString()+')(polygons,polygonDistance):null;\n'+source.slice(b);
}
