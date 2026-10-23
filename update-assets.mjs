import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=new URL('./',import.meta.url),path=new URL('index.html',root);
let html=readFileSync(path,'utf8').replace(/\n?<link data-script-preload[^>]*>/g,'');
// Numeric content ids retain compatibility with old cached HTML's update reader.
html=html.replace(/([A-Za-z0-9_-]+\.js)\?v=[A-Za-z0-9]+/g,(_,name)=>{
 const hash=createHash('sha256').update(readFileSync(new URL(name,root))).digest('hex');
 return name+'?v='+BigInt('0x'+hash.slice(0,16)).toString();
});
// SRI rejects mixed generations when Pages has replaced a lazy asset under an old URL.
for(const kind of ['city','tower']){
 const digest=createHash('sha256').update(readFileSync(new URL('sorami-'+kind+'-models.js',root))).digest('base64');
 html=html.replace(new RegExp('name="shape-'+kind+'-integrity" content="[^\"]*"'),'name="shape-'+kind+'-integrity" content="sha256-'+digest+'"');
}
for(const [,src] of html.matchAll(/<script src="([^"]+)"/g)){
 if(/^[A-Za-z0-9_-]+\.js$/.test(src))throw Error('Missing content version: '+src);
}
// Discover critical scripts from the document. Optional manifest entries are excluded.
const scripts=[...html.matchAll(/<script src="([^"/]+\.js\?v=\d+)"/g)].map(m=>m[1]);
const preload=scripts.map(src=>`<link data-script-preload rel="preload" as="script" href="${src}">`).join('\n');
html=html.replace(/(<meta http-equiv="Content-Security-Policy"[^>]+>)/,'$1\n'+preload);
// The HTML id is deterministic too. No unchanged resource is invalidated by a UI edit.
html=html.replace(/name="app-version" content="\d+"/,'name="app-version" content="0"');
const id=BigInt('0x'+createHash('sha256').update(html.replace(/<meta http-equiv="Content-Security-Policy"[^>]+>/,'')).digest('hex').slice(0,16)).toString();
html=html.replace('name="app-version" content="0"',`name="app-version" content="${id}"`);
writeFileSync(path,html);console.log(`HTML ${id}; ${scripts.length} parallel critical scripts; content-versioned assets`);
