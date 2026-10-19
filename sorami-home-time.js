/* Home-only civil time adapter. Other screens keep their existing time models. */
(function(g){'use strict';
const pad=n=>String(n).padStart(2,'0'),OFFSET=32400000;
function date(t){const d=new Date(t);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;}
function parse(s){if(!/^\d{4}-\d{2}-\d{2}$/.test(s))return NaN;const[y,m,d]=s.split('-').map(Number),t=new Date(y,m-1,d).getTime();return date(t)===s?t:NaN;}
function start(t){return parse(date(t));}
function addDays(t,n){const d=new Date(t);return new Date(d.getFullYear(),d.getMonth(),d.getDate()+n).getTime();}
function atHour(t,h){const d=new Date(t);return new Date(d.getFullYear(),d.getMonth(),d.getDate(),h).getTime();}
const time=t=>new Intl.DateTimeFormat('en-GB',{hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(t);
const zone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone||'Local';
const zoneLabel=t=>zone()==='Asia/Tokyo'?'JST':new Intl.DateTimeFormat('en-US',{timeZoneName:'short'}).formatToParts(t).find(p=>p.type==='timeZoneName')?.value||zone();
// The shared date ruler/calendar accepts JST-encoded civil dates. Convert only at its boundary.
function toRuler(t){const d=new Date(t);return Date.UTC(d.getFullYear(),d.getMonth(),d.getDate())-OFFSET;}
function fromRuler(t){return parse(new Date(t+OFFSET).toISOString().slice(0,10));}
const api={date,parse,start,addDays,atHour,time,zone,zoneLabel,toRuler,fromRuler};g.SoramiHomeTime=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:window);
