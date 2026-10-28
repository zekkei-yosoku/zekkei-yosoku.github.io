// Refresh only the registered independent trial; production bytes must stay fixed.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)),read=n=>readFileSync(root+n,'utf8');
const hash=n=>createHash('sha256').update(readFileSync(root+n)).digest('hex');
const ledger=JSON.parse(read('trial/ui-experiment.json'));
if(ledger.rootHtmlSha256!==hash('index.html'))throw Error('Production HTML changed. Reconcile the trial base before refreshing.');
for(const [name,entry]of Object.entries(ledger.files))if(entry.root!==hash(name))throw Error('Production asset changed: '+name);
for(const [file,from,to]of [
 ['update-assets.mjs',"new URL('./',import.meta.url)","new URL('./trial/',import.meta.url)"],
 ['update-csp.mjs',"new URL('./index.html',import.meta.url)","new URL('./trial/index.html',import.meta.url)"],
]){
 const source=read(file);if(!source.includes(from))throw Error('Updater layout changed: '+file);
 const result=spawnSync(process.execPath,['--input-type=module'],{cwd:root,input:source.replace(from,to),encoding:'utf8'});
 if(result.status!==0)throw Error(result.stderr||'Trial update failed');process.stdout.write(result.stdout);
}
// Independent photo-rating page has its own CSP and external assets.
if(ledger.trialOnlyFiles?.['sky-rating.html']){
 let html=read('trial/sky-rating.html');
 for(const name of ['sky-rating.js','sky-rating-theme.js','sky-rating.css'])html=html.replace(new RegExp(name.replaceAll('.','\\.')+'(?:\\?v=[0-9a-f]+)?','g'),name+'?v='+hash('trial/'+name).slice(0,16));
 writeFileSync(root+'trial/sky-rating.html',html);
}
for(const [name,entry]of Object.entries(ledger.files))entry.trial=hash('trial/'+name);
for(const name of Object.keys(ledger.trialOnlyFiles||{}))ledger.trialOnlyFiles[name]=hash('trial/'+name);
ledger.trialHtmlSha256=hash('trial/index.html');writeFileSync(root+'trial/ui-experiment.json',JSON.stringify(ledger,null,2)+'\n');
console.log('Trial content versions, CSP and experiment hashes updated; production unchanged.');
