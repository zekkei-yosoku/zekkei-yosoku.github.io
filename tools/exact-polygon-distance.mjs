// A hierarchy of the SAME bounding rectangles used by the linear evaluator.
// It only skips polygons whose lower distance bound exceeds the current minimum.
// Leaves use the original polygons and distance function, including ellipse scaling.
export function prepareExactPolygonDistance(polygons,polygonDistance){
 const boxes=polygons.map(poly=>({minX:Math.min(...poly.map(p=>p[0])),maxX:Math.max(...poly.map(p=>p[0])),minY:Math.min(...poly.map(p=>p[1])),maxY:Math.max(...poly.map(p=>p[1]))}));
 const combine=indices=>{
  const out={minX:Infinity,maxX:-Infinity,minY:Infinity,maxY:-Infinity};
  for(const i of indices){const b=boxes[i];out.minX=Math.min(out.minX,b.minX);out.maxX=Math.max(out.maxX,b.maxX);out.minY=Math.min(out.minY,b.minY);out.maxY=Math.max(out.maxY,b.maxY);}
  return out;
 };
 function build(indices){
  const box=combine(indices);
  if(indices.length<=8)return {box,indices};
  // Preserve original face order. Reordering can change legacy floating-point
  // cancellation and the running minimum used by the existing skip condition.
  const mid=Math.floor(indices.length/2);
  return {box,left:build(indices.slice(0,mid)),right:build(indices.slice(mid))};
 }
 const tree=polygons.length>16&&boxes.every(b=>Object.values(b).every(Number.isFinite))?build(polygons.map((_,i)=>i)):null;
 return (center,ratio)=>{
  const point=[center[0],center[1]/ratio];let nearest=Infinity;
  const lower=(box,group=false)=>{
   const dx=Math.max(box.minX-point[0],0,point[0]-box.maxX),dy=Math.max(box.minY/ratio-point[1],0,point[1]-box.maxY/ratio);
   const distance=Math.hypot(dx,dy);
   // Leave a generous rounding cushion ONLY in the group rejection bound.
   // This can visit extra faces; the original leaf bound/distance stays exact.
   return group?(Number.isFinite(distance)?distance*(1-1e-12):Math.max(dx,dy)):distance;
  };
  const evaluate=i=>{
   if(lower(boxes[i])>nearest+1e-10)return;
   const poly=ratio===1?polygons[i]:polygons[i].map(p=>[p[0],p[1]/ratio]);
   nearest=Math.min(nearest,polygonDistance(point,poly));
  };
  function visit(node,bound){
   if(bound>nearest+1e-10||nearest===0)return;
   if(node.indices){for(const i of node.indices){evaluate(i);if(nearest===0)break;}return;}
   visit(node.left,lower(node.left.box,true));visit(node.right,lower(node.right.box,true));
  }
  if(tree&&ratio>0&&Number.isFinite(ratio)&&point.every(Number.isFinite))visit(tree,lower(tree.box,true));
  else for(let i=0;i<polygons.length;i++){evaluate(i);if(nearest===0)break;}
  return nearest;
 };
}
