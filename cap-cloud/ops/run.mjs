// launchd用の1回実行。常駐ループ・自動再試行はしない。
import {fileURLToPath} from 'node:url';
import {collect,health} from '../collect.mjs';
const root=fileURLToPath(new URL('../../data/cap-cloud-runs/',import.meta.url));
try{
 const report=await collect(root);
 const state=await health(root);
 console.log(JSON.stringify({time:new Date().toISOString(),result:report.status,validRows:report.validRows??0,health:state.status,nextAction:state.nextAction,runId:report.runId}));
 if(report.status==='failed')process.exitCode=1;
}catch(e){console.error(JSON.stringify({result:'failed',reason:e.message,nextAction:'保存先とネットワーク接続を確認する'}));process.exitCode=1;}
