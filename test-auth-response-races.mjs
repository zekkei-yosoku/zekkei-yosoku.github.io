import {createRequire} from 'node:module';const require=createRequire(import.meta.url),HttpClient=require('./src/ports/http-client.js');
import {readFileSync} from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';const html=readFileSync(new URL('./index.html',import.meta.url),'utf8');
function fixture(){let resolve,cleared=0;const c={auth:{token:'old-token',loginId:'old-user'},authGeneration:1,API:'https://fixture.test',fetch:()=>new Promise(r=>resolve=r),clearAuth:()=>{cleared++;c.auth=null;c.authGeneration++;},renderAuthButton(){},Error,JSON};vm.createContext(c);c.apiCall=HttpClient.create({base:c.API,fetch:c.fetch,getAuth:()=>c.auth,getGeneration:()=>c.authGeneration,onUnauthorized:()=>{c.clearAuth();c.renderAuthButton();}});return {c,reply:(status,data)=>resolve({ok:status<400,status,json:async()=>data}),get cleared(){return cleared;}};}
for(const status of [200,401]){const f=fixture(),pending=f.c.apiCall('GET','/me').catch(e=>e);f.c.auth={token:'new-token',loginId:'new-user'};f.c.authGeneration++;f.reply(status,{error:'old request',loginId:'old-user',tools:['tower']});const error=await pending;assert.ok(error instanceof Error);assert.equal(f.c.auth.loginId,'new-user');assert.equal(f.cleared,0);}
const r=fixture(),request=r.c.apiCall('POST','/admin/tools',{}).catch(e=>e);r.reply(401,{error:'確認のため、もう一度ログインしてください',code:'reauth_required'});assert.equal((await request).code,'reauth_required');assert.equal(r.cleared,0);assert.equal(r.c.auth.loginId,'old-user');
const f=fixture(),request401=f.c.apiCall('GET','/me').catch(e=>e);f.reply(401,{error:'expired'});await request401;assert.equal(f.cleared,1);assert.equal(f.c.auth,null);
const AccountSync=require('./src/services/account-sync.js');
// 実factoryのportへfixtureをつなぐ。状態はcの現在値を毎回読み書きし、写しを持たない。
function connectAccountSync(c,ports={}){const lexical=name=>vm.runInContext(`typeof ${name}!=="undefined"?${name}:undefined`,c);const sync=AccountSync.create({state:c,session:{auth:()=>c.auth,generation:()=>c.authGeneration},apiCall:(...a)=>c.apiCall(...a),store:{set:(k,v)=>c.store.set(k,v)},toItem:(...a)=>lexical('toItem')(...a),cleanFavorite:x=>c.cleanFavorite(x),cleanSighting:x=>c.cleanSighting(x),records:()=>lexical('RecordSync'),refresh:()=>c.AstroTargetPicker?.refresh?.(),render:()=>c.renderAuthButton(),...ports});Object.assign(c,sync);return sync;}
const sync=fixture();sync.c.pushQueue=[];sync.c.syncInfo=null;sync.c.favorites=[];sync.c.sightings=[];let applied=0;sync.c.store={set(){}};sync.c.syncError=null;connectAccountSync(sync.c,{refresh:()=>applied++});const incoming=sync.c.syncNow();sync.c.auth={token:'other-token',loginId:'other-user'};sync.c.authGeneration++;sync.reply(200,{favorites:[{id:'old-private-item'}],rev:2});await incoming;assert.equal(applied,0);assert.deepEqual(sync.c.favorites,[]);assert.equal(sync.c.syncError,null);
console.log('AUTH RESPONSE RACES OK: late success/401, account switch, private sync, reauth preserves session, actual expiry');

// 直URLを未認証で開いてから認証したとき、認証済みの権限で道具を初期化する。
let opened=0;const login={auth:null,authGeneration:0,clearAdminView(){},saveAuth(){},wantsRemember:()=>false,
 privateDraft:null,adminUnmount:null,lastLoginId:null,dataOwner:'owner-one',favorites:[],sightings:[],pushQueue:[],syncInfo:{loginId:'owner-one'},
 migrationPlan:()=> 'keep',store:{set(){}},syncNow:async()=>{},renderAuthButton(){},render(){},atAim:true,
 routeFromHash:()=>({preset:'tower'}),openAim:p=>{assert.equal(p,'tower');opened++;},$:()=>({close(){}})};
vm.createContext(login);vm.runInContext(html.slice(html.indexOf('async function onLoggedIn('),html.indexOf('const authFail =',html.indexOf('async function onLoggedIn('))),login);
await login.onLoggedIn({token:'fixture-only-token',loginId:'owner-one',tools:['tower']});assert.equal(opened,1);
console.log('DIRECT ROUTE AUTH OK: login initializes allowed aim route after authenticated sync');
