import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {versionAssets,versionRating} from './tools/release-html.mjs';
const root=new URL('./',import.meta.url),path=new URL('index.html',root);
const {html,id,scripts}=versionAssets(readFileSync(path,'utf8'),name=>readFileSync(new URL(name,root)));
writeFileSync(path,html);console.log(`HTML ${id}; ${scripts.length} parallel critical scripts; content-versioned assets`);
// 写真の評価ページ（2026-10-28）。読む3資産の内容版だけを付け直す
const ratingPath=new URL('sky-rating.html',root);
if(existsSync(ratingPath))writeFileSync(ratingPath,versionRating(readFileSync(ratingPath,'utf8'),name=>readFileSync(new URL(name,root))));
