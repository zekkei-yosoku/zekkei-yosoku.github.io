/* Lossless packed PLATEAU geometry. Unpack only the building faces a ray needs. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.AstroNotesCandidateBuildings=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
async function decode(data){
 if(!data.arrays)return data;
 const unpack=async item=>{const packed=Uint8Array.from(atob(item.gzipBase64),c=>c.charCodeAt(0)),buffer=await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();if(buffer.byteLength!==item.elementCount*4)throw Error('packed-building-size');
 return new DataView(buffer);};
 const [vertices,indices,rings,faces]=await Promise.all(['vertexCoordinates','ringVertexIndices','ringOffsets','faceRingOffsets'].map(n=>unpack(data.arrays[n]))),q=data.quantization;
 const result={...data,buildings:data.buildings.map(b=>({...b,sourceSha256:b.sourceSha256||data.sourceSha256s[b.sourceIndex]}))};
 for(const b of result.buildings)Object.defineProperty(b,'polygons',{get(){const rows=[];for(let j=0;j<b.faceCount;j++){const face=b.firstFace+j,rr=[];for(let r=faces.getUint32(face*4,true);r<faces.getUint32((face+1)*4,true);r++){const ring=[];for(let i=rings.getUint32(r*4,true);
 i<rings.getUint32((r+1)*4,true);i++){const v=indices.getUint32(i*4,true)*3;ring.push([q.originLon+vertices.getInt32(v*4,true)*q.angularScale,q.originLat+vertices.getInt32((v+1)*4,true)*q.angularScale,vertices.getInt32((v+2)*4,true)*q.heightScale]);}rr.push(ring);
 }rows.push({id:data.targetPolygonIds?.[b.id]?.[j]||b.id+':source-face-index:'+j,sourcePolygonIndex:j,rings:rr});}return rows;}});
 return result;
}
return {decode};
});
