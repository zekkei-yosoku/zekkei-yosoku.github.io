// Pure release transforms: production scripts and --check use the exact same implementation.
import {createHash} from 'node:crypto';
export function versionAssets(input,readAsset){
 let html=input.replace(/\n?<link data-script-preload[^>]*>/g,'');
 html=html.replace(/([A-Za-z0-9_-]+\.(?:js|css))\?v=[A-Za-z0-9]+/g,(_,name)=>{
  const hash=createHash('sha256').update(readAsset(name)).digest('hex');
  return name+'?v='+BigInt('0x'+hash.slice(0,16)).toString();
 });
 for(const kind of ['city','tower']){
  const digest=createHash('sha256').update(readAsset('astronotes-'+kind+'-models.js')).digest('base64');
  html=html.replace(new RegExp('name="shape-'+kind+'-integrity" content="[^\"]*"'),'name="shape-'+kind+'-integrity" content="sha256-'+digest+'"');
 }
 for(const [,src] of html.matchAll(/<script src="([^"]+)"/g))if(/^[A-Za-z0-9_-]+\.js$/.test(src))throw Error('Missing content version: '+src);
 const scripts=[...html.matchAll(/<script src="([^"/]+\.js\?v=\d+)"/g)].map(m=>m[1]);
 const preload=scripts.map(src=>`<link data-script-preload rel="preload" as="script" href="${src}">`).join('\n');
 html=html.replace(/(<meta http-equiv="Content-Security-Policy"[^>]+>)/,'$1\n'+preload);
 html=html.replace(/name="app-version" content="\d+"/,'name="app-version" content="0"');
 const id=BigInt('0x'+createHash('sha256').update(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/,'')).digest('hex').slice(0,16)).toString();
 html=html.replace('name="app-version" content="0"',`name="app-version" content="${id}"`);
 return {html,id,scripts};
}
export function hashCsp(input){
 const hashes=[...input.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(([,attrs,body])=>! /\bsrc\s*=/.test(attrs)&&body.trim()).map(([,attrs,body])=>`'sha256-${createHash('sha256').update(body).digest('base64')}'`);
 if(!hashes.length)throw Error('No inline script hashes found');
 return {html:input.replace(/script-src[^;]+;/,`script-src 'self' blob: ${hashes.join(' ')};`),hashes};
}
export function versionRating(input,readAsset){
 return input.replace(/(sky-rating(?:-theme)?\.(?:js|css))\?v=[A-Za-z0-9]+/g,(_,name)=>name+'?v='+createHash('sha256').update(readAsset(name)).digest('hex').slice(0,16));
}
