import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
const require=createRequire(import.meta.url);
const sharp=require(process.env.SHARP_MODULE || 'sharp');
// Trim transparent layout padding; preserve the adopted A/orbit/moon artwork.
const source=new URL('./astronotes-icon-source.svg',import.meta.url).pathname;
for(const size of [32,180,192,512]){
 const logo=await sharp(source,{density:300}).trim().resize({width:Math.round(size*.9),height:Math.round(size*.9),fit:'inside'}).png().toBuffer();
 const png=await sharp({create:{width:size,height:size,channels:3,background:'#0a0f24'}}).composite([{input:logo,gravity:'centre'}]).removeAlpha().png().toBuffer();
 const fs=await import('node:fs/promises');
 await fs.writeFile(new URL(`./app-icon-${size}-v2.png`,import.meta.url),png);
 await fs.writeFile(new URL(`./icon-${size}.png`,import.meta.url),png);
}
