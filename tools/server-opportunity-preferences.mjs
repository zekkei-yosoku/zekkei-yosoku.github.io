export function geometricOpportunitySettings(value={}){
 return {model:'geometric-candidate-v1',mode:'none',refractionCoefficient:0,effectiveEarthRadiusFactor:1,targetHeights:Object.fromEntries(Object.entries(value.targetHeights??{}).sort(([a],[b])=>a.localeCompare(b)).map(([key,height])=>[key,height]))};
}
// Account-scoped list preferences are separate from the device's atmosphere.
// Existing target heights win at startup. The model migration is a CAS write
// using those stored heights; later writes require an explicit local edit.
export function createServerOpportunityPreferences({api,getSession,getSettings,applySettings,sync,canUse=()=>true}){
 const state={enabled:null,prepare:false,settings:null,prefRev:null,sourceRev:null,error:null};
 const currentModel=value=>value?.model==='geometric-candidate-v1'&&value.mode==='none'&&value.refractionCoefficient===0&&value.effectiveEarthRadiusFactor===1&&Object.keys(value).every(k=>['model','mode','refractionCoefficient','effectiveEarthRadiusFactor','targetHeights'].includes(k));
 let owner=null,controller=null,flight=null,loaded=false,dirty=null,edit=0,epoch=0;
 const key=()=>JSON.stringify(getSession());
 function reset(){controller?.abort();controller=new AbortController();owner=key();flight=null;loaded=false;dirty=null;edit++;epoch++;Object.assign(state,{enabled:null,prepare:false,settings:null,prefRev:null,sourceRev:null,error:null});}
 function changed(){if(owner!==key())reset();const next=geometricOpportunitySettings(getSettings());if(state.settings&&JSON.stringify(next)===JSON.stringify(geometricOpportunitySettings(state.settings))&&!dirty)return false;dirty=next;edit++;return true;}
 async function prepare({refresh=false}={}){
  if(owner!==key())reset();if(!canUse())return state;if(flight)return flight;
  const ticket=owner,ticketEpoch=epoch,signal=controller.signal,current=()=>epoch===ticketEpoch&&owner===ticket&&key()===ticket&&!signal.aborted&&canUse();
  const call=(method,path,body)=>api(method,path,body,signal);
  flight=(async()=>{
   try{
    if(!loaded||refresh){const data=await call('GET','/overlap-preferences');if(!current())throw new DOMException('cancelled','AbortError');
     // The old API/test fixture omits enabled; only that explicit compatibility
     // response, or enabled=false, permits the on-device solver.
     if(!data||typeof data!=='object'||(state.enabled===true&&typeof data.enabled!=='boolean'))throw Error('サーバーの設定を確認できません。再試行してください。');
     Object.assign(state,{enabled:data.enabled===true,prepare:data.prepare===true,settings:data.settings??null,prefRev:data.prefRev??0,sourceRev:data.sourceRev??null});loaded=true;
     if((state.enabled||state.prepare)&&state.settings&&!dirty)applySettings(structuredClone(state.settings));
    }
    // During rollout the server may prepare results while the existing local
    // list remains active. Sync preferences without enabling remote reads.
    if(!state.enabled&&!state.prepare)return state;
    const migration=state.settings&&!currentModel(state.settings);
    if(!state.settings||dirty||migration){const value=dirty||geometricOpportunitySettings(state.settings||getSettings()),revision=edit;const data=await call('POST','/overlap-preferences',{environment:'trial',settings:value,expectedPrefRev:state.prefRev||0});if(!current())throw new DOMException('cancelled','AbortError');Object.assign(state,data);if(revision===edit){dirty=null;applySettings(structuredClone(state.settings));}else return await saveLatest();}
    if(!currentModel(state.settings))throw Error('一覧の計算条件を更新できません。再試行してください。');state.error=null;return state;
   }catch(error){if(current()){state.error=error;if(error.status===409){dirty=null;loaded=false;}}throw error;}
  })().finally(()=>{if(epoch===ticketEpoch&&owner===ticket)flight=null;});return flight;
  async function saveLatest(){while(dirty){const value=dirty,revision=edit;const data=await call('POST','/overlap-preferences',{environment:'trial',settings:value,expectedPrefRev:state.prefRev});if(!current())throw new DOMException('cancelled','AbortError');Object.assign(state,data);if(revision===edit){dirty=null;applySettings(structuredClone(state.settings));}}if(!currentModel(state.settings))throw Error('一覧の計算条件を更新できません。再試行してください。');state.error=null;return state;}
 }
 async function ready(){await prepare();if(!state.enabled)return state;const ticket=key();await sync();if(ticket!==key()||!canUse())throw new DOMException('cancelled','AbortError');return prepare({refresh:true});}
 function cancel(){reset();}
 return {state,prepare,ready,changed,cancel};
}
