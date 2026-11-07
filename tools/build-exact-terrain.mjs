import {readFileSync} from 'node:fs';
const patch=(s,a,b)=>{if(s.split(a).length!==2)throw Error('Exact terrain boundary changed: '+a.slice(0,120));return s.replace(a,b);};
export function patchExactTerrain(s){
 const helper=readFileSync(new URL('./exact-terrain-batch.mjs',import.meta.url),'utf8').replace('export function','function');
 s=patch(s,'  async function elevations(points, opts = {}) {',helper+'\n  const sampleTiles=createExactTerrainBatch({inJapan,tileXf,tileYf,loadTile,pixelToElevation});\n  async function elevations(points, opts = {}) {');
 s=patch(s,'const raw = await Promise.all(points.map((p) => sampleTile(p.latitude, p.longitude, zoomFor(opts.from, p, base))));','const raw = points.length<32 ? await Promise.all(points.map((p) => sampleTile(p.latitude, p.longitude, zoomFor(opts.from, p, base)))) : await sampleTiles(points,points.map(p=>zoomFor(opts.from,p,base)));');
 return s;
}
