/** 本番へ出す前に満たすべき証跡の照合。フラグを有効化する機能は持たない。 */
export const UI_ENABLED=false;
export function readiness(evidence={}){
 const reasons=[];
 const require=(condition,message)=>{if(!condition)reasons.push(message);};
 require(evidence.synthetic===false,'実測データでの評価が必要');
 require(evidence.highQualityLabelsVerified===true,'複数方向・高頻度ラベルの監査が必要');
 require(evidence.longTermDataEvaluated===true,'長期データ追加の同一試験期間比較が必要');
 require(evidence.timeLeakageAuditPassed===true,'日・イベント・気象系の分離と境界の監査が必要');
 require(evidence.eraHoldoutPassed===true,'年代とカメラ世代を分離した検証が必要');
 require(evidence.forecastValidationPassed===true,'事前保存した予報との照合が必要');
 require(['snapshot','model_run'].includes(evidence.leadReference),'リードタイムの基準を明示する');
 require(evidence.leadSpecificCalibrationPassed===true,'時間帯別の校正と未観測率の報告が必要');
 const ci=evidence.brierDeltaVsLogistic95CI;
 require(Array.isArray(ci)&&ci.length===2&&ci.every(Number.isFinite)&&ci[0]<=ci[1]&&ci[1]<0,'ロジスティック回帰を上回るBrier改善の区間推定が必要');
 require(evidence.calibrationReviewPassed===true,'確率校正のレビューが必要');
 require(evidence.coverageReviewPassed===true,'観測不能・境界事例を含めた適用範囲のレビューが必要');
 return {status:reasons.length?'not_ready':'eligible_for_review',uiEnabled:UI_ENABLED,probability:null,reasons,
  nextAction:reasons.length?'不足する証跡を検証する':'証跡と運用手順の独立レビュー後、別変更で利用画面を有効化する'};
}
