// Adopted rounded-v1 mark; no redraw. SHARP_MODULE can point to a local sharp install.
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const sharp=require(process.env.SHARP_MODULE || 'sharp');
for(const size of [32,180,192,512]){
 const inset=Math.round(size*.1);
 const logo=await sharp(new URL('./astronotes-icon-source.svg',import.meta.url).pathname).resize(size-2*inset,size-2*inset).png().toBuffer();
 await sharp({create:{width:size,height:size,channels:4,background:'#0a0f24'}}).composite([{input:logo,left:inset,top:inset}]).png().toFile(new URL(`./icon-${size}.png`,import.meta.url).pathname);
}
