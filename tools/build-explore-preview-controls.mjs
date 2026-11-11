// Trial preview controls: preserve the existing handlers and the drawing's layout.
export function explorePreviewControlsHtml(html){
 const style=`
#exploreScenePanel #aimLook .trial-scene-toolbar:has(#exploreExternalMap){grid-template-columns:repeat(4,minmax(0,1fr))}
#exploreScenePanel #exploreExternalMap{grid-column:3;grid-row:1;width:100%;min-width:0;height:56px;box-sizing:border-box;margin:0;padding:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;background:var(--card);color:var(--text);border:1px solid var(--line);border-radius:10px;font-size:12px;line-height:1.2;font-weight:600;text-decoration:none}
#exploreScenePanel #trialRecordSave{grid-column:2;grid-row:1}
#trialRecordSave[hidden]{display:none!important}
#exploreScenePanel #trialRecordSave svg{width:24px;height:24px;stroke-width:1.8}
#trialRecordSaveSheet:not([open]){display:none}
#trialRecordSaveSheet .sheet-body{display:grid;gap:10px}
#exploreScenePanel #trialRecordSaveSheet [data-quick-save]{position:static;grid-column:auto;grid-row:auto;display:flex;flex-direction:row;align-items:center;justify-content:flex-start;gap:12px;width:100%;height:auto;min-height:56px;padding:12px;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--text);font-size:16px;text-align:left}
#exploreScenePanel #trialRecordSaveSheet [data-quick-save]::after{content:none}
#exploreScenePanel #trialRecordSaveSheet .sheet-head button{width:auto;min-width:44px;height:auto;min-height:44px;margin:0;padding:8px 12px;display:block;border:0;background:transparent;color:var(--accent);font-size:14px}
#trialRecordSaveSheet [data-quick-save] svg{width:24px;height:24px;flex:none;stroke-width:1.8}
#exploreScenePanel #exploreExternalMap svg{width:24px;height:24px;stroke-width:1.8}
#exploreScenePanel .trial-composition-tool{position:absolute;right:8px;z-index:4;width:44px;min-width:44px;height:44px;min-height:44px;margin:0;padding:0;display:grid;place-items:center;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--text);box-shadow:none}
#exploreScenePanel #trialCompositionToggle{top:64px}
#exploreScenePanel #trialCompositionAdjust{top:118px}
#exploreScenePanel #trialCompositionToggle[aria-pressed=true]{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
#exploreScenePanel .trial-composition-tool[hidden]{display:none}
/* 2026-11-11 ユーザー「右上のアイコンに並べる」: 天体に寄る／全体を入れる sits under 重ねる位置を指定 (and its numeric editor when shown). */
#exploreScenePanel .preview-compose-toggle{position:absolute;top:118px;right:8px;z-index:4;width:44px;min-width:44px;height:44px;min-height:44px;margin:0;padding:0;display:grid;place-items:center;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--text);box-shadow:none}
#exploreScenePanel .aim-look-figure:has(#trialCompositionAdjust:not([hidden])) .preview-compose-toggle{top:172px}
#exploreScenePanel .preview-compose-toggle[aria-pressed=true]{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}
#exploreScenePanel .preview-compose-toggle svg{width:24px;height:24px;stroke-width:1.8}
#trialComposition:not([open]){display:none}
#trialComposition .sheet-body{display:grid;gap:14px;max-height:calc(82dvh - 54px)}
#trialComposition .sheet-body>label{font-size:14px;line-height:1.5}
#trialComposition .fav-in{display:block;width:100%;font-size:16px;min-height:44px;margin:6px 0 0}
#trialComposition .trial-composition-presets{display:flex;flex-wrap:wrap;gap:8px}
#trialComposition .trial-composition-presets .chip{min-height:44px;margin:0}
#trialComposition .sheet-body>.fav-btn{min-height:44px}
#trialCompositionInputStatus{margin:0;color:var(--text)}
`;
 if(!html.includes('</head>'))throw Error('Missing preview HTML head');
 return html.replace('</head>','<style id="trialPreviewControlsStyle">'+style+'</style>\n</head>');
}
