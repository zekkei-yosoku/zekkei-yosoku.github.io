"""同じ正解に対する候補・基準モデルの比較。採用・公開を自動決定しない。"""
import argparse,json,datetime as dt
from pathlib import Path
import numpy as np

def instant(s):
 t=dt.datetime.fromisoformat(s.replace('Z','+00:00'))
 if t.tzinfo is None:raise ValueError('時刻にタイムゾーンが必要です')
 return t

def evaluate(data,draws=2000,seed=47):
 if data.get('schemaVersion')!=1 or data.get('synthetic') not in (True,False):raise ValueError('スキーマと合成区分が必要です')
 if data.get('comparisonKind') not in ('prospective_frozen','retrospective_replay'):raise ValueError('前向き／再計算の区分が必要です')
 rows=data['rows'];seen=set()
 for r in rows:
  if not r.get('sampleId') or r['sampleId'] in seen:raise ValueError('試験IDの欠落または重複')
  seen.add(r['sampleId'])
  for k in ('weatherEpisodeId','cameraEra','leadBin','truthEvidence','candidateVersion','baselineVersion'):
   if not isinstance(r.get(k),str) or not r[k]:raise ValueError('必須: '+k)
  if r.get('truthSource')!='human_reviewed' or r.get('quality') not in ('GOLD','SILVER'):raise ValueError('人手監査済み高品質正解が必要です')
  if type(r.get('label')) is not int or r['label'] not in (0,1):raise ValueError('正解は0/1です')
  for k in ('candidateProbability','baselineProbability'):
   if type(r.get(k)) not in (int,float) or not np.isfinite(r[k]) or not 0<=r[k]<=1:raise ValueError('確率が不正: '+k)
  valid=instant(r['validAt'])
  if instant(r['forecastAvailableAt'])>=valid:raise ValueError('事後の気象入力を予報扱いにできません')
  if data['comparisonKind']=='prospective_frozen':
   for k in ('candidateCreatedAt','baselineCreatedAt'):
    if instant(r[k])>=valid:raise ValueError('事後作成モデル出力は前向き試験ではありません')
 versions={(r['candidateVersion'],r['baselineVersion']) for r in rows}
 if len(versions)>1:raise ValueError('異なるモデル版を同じ試験に混ぜられません')
 result={'status':'research_only' if rows else 'waiting_for_pairs','synthetic':data['synthetic'],'comparisonKind':data['comparisonKind'],'n':len(rows),'uiEnabled':False,'productionReady':False,'brierDeltaVsBaseline95CI':None}
 if not rows:return result
 if not 100<=draws<=10000:raise ValueError('再標本化回数は100〜10000です')
 y=np.array([r['label'] for r in rows]);pc=np.array([r['candidateProbability'] for r in rows]);pb=np.array([r['baselineProbability'] for r in rows])
 delta=(pc-y)**2-(pb-y)**2
 groups={}
 for i,r in enumerate(rows):groups.setdefault(r['weatherEpisodeId'],[]).append(i)
 result.update(positiveCount=int(y.sum()),episodeCount=len(groups),candidateBrier=float(np.mean((pc-y)**2)),baselineBrier=float(np.mean((pb-y)**2)),brierDelta=float(delta.mean()),seed=seed,draws=draws,byLead={},byCameraEra={})
 # 同一気象系の行を分割せず、気象系を復元抽出する。各回の全行平均を比較。
 if len(groups)>=5 and len(set(y))==2:
  parts=[delta[idx] for idx in groups.values()];sums=np.array([x.sum() for x in parts]);counts=np.array([len(x) for x in parts]);rng=np.random.default_rng(seed)
  selected=rng.integers(0,len(parts),size=(draws,len(parts)))
  estimates=sums[selected].sum(axis=1)/counts[selected].sum(axis=1)
  result['brierDeltaVsBaseline95CI']=np.quantile(estimates,[.025,.975]).tolist()
 else:result['intervalUnavailableReason']='気象系5件以上と陽性・陰性の両方が必要（実行下限であり精度採用の十分条件ではない）'
 for key,out in [('leadBin','byLead'),('cameraEra','byCameraEra')]:
  for value in sorted({r[key] for r in rows}):
   idx=[i for i,r in enumerate(rows) if r[key]==value]
   result[out][value]={'n':len(idx),'positiveCount':int(y[idx].sum()),'candidateBrier':float(np.mean((pc[idx]-y[idx])**2)),'baselineBrier':float(np.mean((pb[idx]-y[idx])**2)),'brierDelta':float(delta[idx].mean())}
 result['limitations']=['区間は入力された気象系分けに依存','ラベル証拠の実物監査・時系列分割・校正・欠測率・モデル選択の独立性は別途監査','5気象系は実行下限であり採用基準ではない','retrospective_replayの結果を凍結後の前向き試験と扱わない']
 return result

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('input');p.add_argument('--output',required=True);a=p.parse_args()
 try:
  result=evaluate(json.loads(Path(a.input).read_text()))
  with Path(a.output).open('x') as f:json.dump(result,f,ensure_ascii=False,indent=2)
  print(json.dumps({'status':result['status'],'n':result['n'],'interval':result['brierDeltaVsBaseline95CI'],'productionReady':False},ensure_ascii=False))
 except (ValueError,KeyError,OSError,TypeError) as e:print('評価できません: '+str(e));raise SystemExit(2)
