/* Trial-only transformation of the canonical plan asset. Never edit its exports. */
function replaceOnce(source, before, after, label) {
  const start = source.indexOf(before);
  if (start < 0 || source.indexOf(before, start + before.length) >= 0) {
    throw new Error(`Plan calendar UI patch: expected exactly one ${label}`);
  }
  return source.slice(0, start) + after + source.slice(start + before.length);
}

export function patchPlanCalendarUI(source) {
  if (typeof source !== 'string') throw new TypeError('Plan calendar UI patch requires source text');
  const patches = [
    [
      `<div id="planExport"><h3 class="my-title">カレンダーに追加</h3>
      <div class="plan-actions"><a id="planGoogle" class="chip" target="_blank" rel="noopener noreferrer">Googleカレンダーで登録</a><button type="button" class="chip" id="planIcs">予定ファイルを保存</button></div>
      <p class="tiny">予定ファイルはAppleカレンダー・Outlookなどで開けます。</p></div></section>`,
      `<div id="planExport"><div class="plan-actions"><button type="button" class="chip primary" id="planCalendarAdd" style="min-height:44px">カレンダーに追加</button></div></div></section>`,
      'calendar actions markup'
    ],
    [
      `$('planGoogle').href=google(e);$('planGoogle').removeAttribute('aria-disabled');$('planIcs').disabled=false;$('planKeep').disabled=false;status(!$('planKeep').hidden?'記録に保存するか、カレンダーへ追加できます。記録の予定はログイン中に同期します。':'予定ファイルを開いて、カレンダーへの登録を確定してください。');`,
      `$('planCalendarAdd').disabled=false;$('planKeep').disabled=false;status(!$('planKeep').hidden?'記録に保存するか、カレンダーへ追加できます。記録の予定はログイン中に同期します。':'');`,
      'valid calendar state'
    ],
    [
      `$('planGoogle').removeAttribute('href');$('planGoogle').setAttribute('aria-disabled','true');$('planIcs').disabled=true;`,
      `$('planCalendarAdd').disabled=true;`,
      'invalid calendar state'
    ],
    [
      `$('planGoogle').onclick=e=>{if(!validate())e.preventDefault();};
    $('planIcs').onclick=()=>{const e=validate();if(!e)return;download(new Blob([ics(e)],{type:'text/calendar;charset=utf-8'}),'AstroNotes_撮影予定.ics');status('予定ファイルを保存しました。カレンダーで開き、登録を確認してください。');};`,
      `$('planCalendarAdd').onclick=()=>{
      const e=validate();if(!e)return;
      const button=$('planCalendarAdd'),token=seq,captured=current;
      if(typeof AstroNotesPlan.externalApps?.requestCalendar!=='function'){status('カレンダーを開けませんでした。画面を開き直してください。');return;}
      try{AstroNotesPlan.externalApps.requestCalendar(e,{source:button,isCurrent:()=>d.open&&token===seq&&current===captured,onStatus:status});}
      catch{status('カレンダーを開けませんでした。もう一度お試しください。');}
    };`,
      'calendar click handlers'
    ],
    [
      `d.addEventListener('close',()=>{if(d.open)return;seq++;clearSaved();`,
      `d.addEventListener('close',()=>{if(d.open)return;AstroNotesPlan.externalApps?.cancelCalendar();seq++;clearSaved();`,
      'plan close invalidation'
    ],
    [
      `async function open(kind,source,reuse=false){requested=kind;`,
      `async function open(kind,source,reuse=false){AstroNotesPlan.externalApps?.cancelCalendar();requested=kind;`,
      'plan open invalidation'
    ]
  ];
  for (const [before, after, label] of patches) source = replaceOnce(source, before, after, label);
  if (/\b(?:planGoogle|planIcs)\b/.test(source)) throw new Error('Plan calendar UI patch left obsolete calendar actions');
  if (source.split('id="planCalendarAdd"').length !== 2) throw new Error('Plan calendar UI patch requires one calendar action');
  return source;
}
