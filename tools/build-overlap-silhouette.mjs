// 2026-11-09 Trial only: the overlap list may hand prepareDailyView one
// precomputed building outline (opts.silhouette) instead of the 3D model.
// Every other caller passes no silhouette and keeps the full outline.
export function patchSilhouetteOutline(source){
 const from=': towerOutline(observer, target, opts);';
 if(source.split(from).length!==2)throw Error('Silhouette outline boundary changed');
 return source.replace(from,': opts.silhouette ? {viewBaseAngle:opts.silhouette.viewBaseAngle,topAngle:opts.silhouette.topAngle,approximate:!!opts.silhouette.approximate,hitPolygons:[opts.silhouette.polygon]} : towerOutline(observer, target, opts);');
}
