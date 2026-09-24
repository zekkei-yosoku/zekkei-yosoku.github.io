"""富士山笠雲研究用パイプライン。未検証の確率は提供しない。"""
from __future__ import annotations
import argparse, collections, datetime as dt, hashlib, json, math, sys
from pathlib import Path
import numpy as np

JST = dt.timezone(dt.timedelta(hours=9))
CAP = {'CAP','CAP_SUMMIT_COVERING', 'CAP_DETACHED'}
LABELS = CAP | {'TSURUSHI','HATA','OTHER_CLOUD','NO_CAP','MOUNTAIN_OBSCURED','UNKNOWN'}
FEATURES = ['rh_summit','z_rhmax_minus_summit','dewpoint_depression','u_cross','wind_speed','n2','month_sin','month_cos','hour_sin','hour_cos']

def timestamp(value):
    t = dt.datetime.fromisoformat(value.replace('Z','+00:00'))
    if t.tzinfo is None: raise ValueError('時刻にはタイムゾーンが必要です')
    return t

def read_json(path):
    return json.loads(Path(path).read_text(encoding='utf-8'))

def write_json(path, value):
    p=Path(path);p.parent.mkdir(parents=True,exist_ok=True)
    p.write_text(json.dumps(value,ensure_ascii=False,indent=2,allow_nan=False)+'\n',encoding='utf-8')

def features(profile):
    """高度[m MSL], pressure[hPa], T[C], RH[%], u/v[m/s]。外挿しない。"""
    levels = sorted(profile['levels'],key=lambda x:x['z_m'])
    keys=['z_m','pressure_hpa','temperature_c','rh_pct','u_ms','v_ms']
    a=np.array([[l[k] for k in keys] for l in levels],dtype=float)
    if len(a)<3 or not np.isfinite(a).all(): raise ValueError('有限値の鉛直データが3層以上必要です')
    z,p,t,rh,u,v=a.T
    if np.any(np.diff(z)<=0) or np.any(np.diff(p)>=0): raise ValueError('高度は増加、気圧は減少させてください')
    if np.any((rh<=0)|(rh>100)) or np.any(p<=0) or np.any((t<=-100)|(t>60)): raise ValueError('気象値の単位・範囲を確認してください')
    if not z[0]<=3776<=z[-1]: raise ValueError('山頂高度を挟まないデータは補間できません')
    interp=lambda x:float(np.interp(3776,z,x))
    ts,rs,us,vs=map(interp,(t,rh,u,v))
    gamma=math.log(rs/100)+17.625*ts/(243.04+ts)
    td=243.04*gamma/(17.625-gamma)
    theta=(t+273.15)*(1000/p)**(287.05/1004)
    n2=9.80665/theta*np.gradient(theta,z)
    speed=math.hypot(us,vs)
    wind=(math.degrees(math.atan2(-us,-vs))+360)%360 if speed>0 else None
    peaks=z[rh==rh.max()]
    when=timestamp(profile['valid_at']).astimezone(JST)
    return dict(rh_summit=rs,temperature_summit_c=ts,pressure_summit_hpa=interp(p),
        z_rhmax_minus_summit=float(peaks[0]-3776) if len(peaks)==1 else None,
        moist_peak_ambiguous=len(peaks)>1,moist_peak_base_m=float(peaks.min()),moist_peak_top_m=float(peaks.max()),dewpoint_depression=ts-td,
        u_cross=(us+vs)/math.sqrt(2),wind_speed=speed,wind_direction_deg=wind,
        n2=interp(n2),month_sin=math.sin(2*math.pi*(when.month-1)/12),
        month_cos=math.cos(2*math.pi*(when.month-1)/12),hour_sin=math.sin(2*math.pi*when.hour/24),
        hour_cos=math.cos(2*math.pi*when.hour/24))

def label_target(row):
    label=row['label'];quality=row['quality']
    if label not in LABELS or quality not in {'GOLD','SILVER','BRONZE','UNKNOWN'}: raise ValueError('ラベルまたは品質が未定義です')
    if label in {'UNKNOWN','MOUNTAIN_OBSCURED'} or quality=='UNKNOWN' or row.get('daylight') is not True:
        return None
    if row.get('label_source')!='human_reviewed': return None
    if quality in {'GOLD','SILVER'} and label in CAP:
        if row.get('duration_minutes',0)<=5 or row.get('max_frame_gap_seconds',math.inf)>60:
            raise ValueError('5分超継続の高品質陽性には最大60秒以下の観測間隔が必要です')
        if quality=='GOLD' and row.get('camera_count',0)<2: raise ValueError('GOLD陽性には複数カメラが必要です')
    if 'cap_present' in row:
        if label in CAP and row['cap_present'] is not True: raise ValueError('笠雲ラベルと有無が不整合です')
        if label=='NO_CAP' and row['cap_present'] is not False: raise ValueError('陰性ラベルと有無が不整合です')
        if row['cap_present'] not in (True,False): return None
        return int(row['cap_present'])
    if label in {'TSURUSHI','HATA','OTHER_CLOUD'}: return None
    return int(label in CAP)

def split_rows(rows,train_end,cal_end):
    train_end=timestamp(train_end);cal_end=timestamp(cal_end)
    if train_end>=cal_end: raise ValueError('分割日時の順序が不正です')
    out=[[],[],[]];seen={};ids=set()
    for r in rows:
        if r['sample_id'] in ids: raise ValueError('sample_idが重複しています')
        ids.add(r['sample_id']); t=timestamp(r['valid_at'])
        s=0 if t<train_end else 1 if t<cal_end else 2
        for key in [('day',t.astimezone(JST).date().isoformat()),('event',r['event_id']),('weather_episode',r.get('weather_episode_id',r['event_id']))]:
            if key in seen and seen[key]!=s: raise ValueError('同日または同イベントが分割境界をまたぎます')
            seen[key]=s
        out[s].append(r)
    if any(not group for group in out): raise ValueError('学習・校正・試験の全区間にデータが必要です')
    for earlier,later in zip(out,out[1:]):
        if max(timestamp(r['valid_at']) for r in earlier)>=min(timestamp(r.get('prediction_captured_at') or r['issued_at']) for r in later):
            raise ValueError('前区間の正解確定前に次区間の予報が発行されています。境界に空白期間を設けてください')
    return out

def sigmoid(z): return 1/(1+np.exp(-np.clip(z,-35,35)))

def fit_logistic(x,y,weight=None,penalty=0.01):
    x=np.asarray(x,float);y=np.asarray(y,float)
    if set(y)!={0.,1.}: raise ValueError('学習・校正には陽性と陰性の両方が必要です')
    mean=x.mean(axis=0);scale=x.std(axis=0);scale[scale<1e-9]=1
    a=np.column_stack([np.ones(len(x)),(x-mean)/scale]);b=np.zeros(a.shape[1])
    w=np.ones(len(x)) if weight is None else np.asarray(weight,float)
    for _ in range(150):
        prob=sigmoid(a@b);reg=penalty*b;reg[0]=0
        grad=a.T@(w*(prob-y))/w.sum()+reg
        h=(a.T*(w*prob*(1-prob)))@a/w.sum()+np.diag([1e-8]+[penalty]*(len(b)-1))
        step=np.linalg.solve(h,grad);b-=step
        if np.max(np.abs(step))<1e-8:break
    return {'mean':mean.tolist(),'scale':scale.tolist(),'coef':b.tolist()}

def predict(model,x):
    a=(np.asarray(x,float)-model['mean'])/model['scale']
    return sigmoid(np.column_stack([np.ones(len(a)),a])@model['coef'])

def metrics(y,p):
    y=np.asarray(y,int);p=np.asarray(p,float)
    if not len(y) or len(y)!=len(p) or not set(y)<= {0,1} or not np.isfinite(p).all() or np.any((p<0)|(p>1)):
        raise ValueError('評価値が不正です')
    positive=p>=.5;tp=int(sum(positive&(y==1)));fp=int(sum(positive&(y==0)));fn=int(sum(~positive&(y==1)))
    ratio=lambda a,b:a/b if b else None
    bins=[];ece=0.
    for i in range(10):
        mask=(p>=i/10)&((p<(i+1)/10) if i<9 else (p<=1))
        if mask.any():
            observed=float(y[mask].mean());pred=float(p[mask].mean());n=int(mask.sum());ece+=n/len(y)*abs(observed-pred)
            bins.append({'count':n,'predicted':pred,'observed':observed})
    # Tie-aware ROC trapezoids and average precision (step PR area).
    order=np.argsort(-p,kind='stable');ys=y[order];ps=p[order]
    boundaries=np.r_[np.flatnonzero(np.diff(ps)),len(p)-1]
    ct=np.cumsum(ys)[boundaries];cf=(boundaries+1)-ct;P=int(y.sum());N=len(y)-P
    roc=ap=None
    if P and N:
        recall=np.r_[0,ct/P];fpr=np.r_[0,cf/N]
        roc=float(np.sum(np.diff(fpr)*(recall[1:]+recall[:-1])/2))
        ap=float(np.sum(np.diff(recall)*ct/(ct+cf)))
    q=np.clip(p,1e-12,1-1e-12)
    return {'n':len(y),'positive_count':P,'precision':ratio(tp,tp+fp),'recall_pod':ratio(tp,tp+fn),
        'false_alarm_ratio':ratio(fp,tp+fp),'csi':ratio(tp,tp+fp+fn),'f1':ratio(2*tp,2*tp+fp+fn),
        'roc_auc':roc,'pr_auc_average_precision':ap,'brier':float(np.mean((p-y)**2)),
        'log_loss':float(-np.mean(y*np.log(q)+(1-y)*np.log(1-q))),'ece':ece,'reliability':bins}

def lead_bin(hours):
    if hours<0:raise ValueError('予報リードタイムが負です')
    return '0-6h' if hours<6 else '6-18h' if hours<18 else '18-36h' if hours<36 else '36-78h' if hours<78 else '78h+'

def validate_forecast(row):
    if row['data_kind']!='forecast':raise ValueError('解析値を予報検証へ投入できません')
    if row.get('forecast_reference_kind')=='snapshot':
        if row.get('issued_at') is not None:raise ValueError('snapshotの発行時刻を捏造できません')
        issued=timestamp(row['prediction_captured_at'])
    else: issued=timestamp(row['issued_at'])
    valid=timestamp(row['valid_at']);available=timestamp(row['available_at'])
    if available<issued or available>valid:raise ValueError('発表・利用可能・対象時刻の順序が不正です')
    if not row.get('model_source') or not row.get('met_dataset_version'):raise ValueError('気象モデルの出所・版が必要です')
    return lead_bin((valid-issued).total_seconds()/3600)

def train(rows,train_end,cal_end):
    # Check all rows before exclusion so leakage cannot hide behind missing labels.
    for r in rows: validate_forecast(r)
    kinds={r.get('synthetic',False) for r in rows}
    if len(kinds)>1:raise ValueError('実測と合成データは混在できません')
    references={r.get('forecast_reference_kind','model_run') for r in rows}
    if len(references)!=1:raise ValueError('モデル初期値基準と取得時刻基準を混ぜられません')
    domains={(r['model_source'],r['met_dataset_version']) for r in rows}
    if len(domains)!=1:raise ValueError('初期実装は単一モデル・単一版で評価してください')
    groups=split_rows(rows,train_end,cal_end)
    groups=[[r for r in g if label_target(r) is not None] for g in groups]
    if any(len(g)<4 for g in groups):raise ValueError('除外後の各区間に最低4件必要です（研究用の実行下限）')
    if any(r['quality'] not in {'GOLD','SILVER'} for g in groups[1:] for r in g):raise ValueError('校正・試験はGOLD/SILVERに限定してください')
    xs=[np.array([[r['features'][k] for k in FEATURES] for r in g],float) for g in groups]
    if any(np.isinf(x).any() for x in xs):raise ValueError('無限大の特徴量は使用できません')
    if np.any(np.all(np.isnan(xs[0]),axis=0)):raise ValueError('学習期間で全欠測の特徴量があります')
    medians=np.nanmedian(xs[0],axis=0)
    missing=[np.isnan(x).astype(float) for x in xs]
    xs=[np.where(np.isnan(x),medians,x) for x in xs]
    full_xs=[np.column_stack([x,m]) for x,m in zip(xs,missing)]
    ys=[np.array([label_target(r) for r in g]) for g in groups]
    weights=[{'GOLD':1.,'SILVER':.8,'BRONZE':.4}[r['quality']] for r in groups[0]]
    model=fit_logistic(full_xs[0],ys[0],weights)
    raw_cal=predict(model,full_xs[1]);logit=lambda p:np.log(np.clip(p,1e-9,1-1e-9)/(1-np.clip(p,1e-9,1-1e-9)))[:,None]
    calibration=fit_logistic(logit(raw_cal),ys[1])
    raw=predict(model,full_xs[2]);p=predict(calibration,logit(raw))
    climate=fit_logistic(xs[0][:,6:10],ys[0])
    simple=fit_logistic(xs[0][:,[0,3,4]],ys[0])
    report={'status':'RESEARCH_ONLY','synthetic':bool(next(iter(kinds))),
        'warning':'合成データの動作試験。予報精度ではありません。' if True in kinds else '研究評価のみ。本番確率の公開承認はありません。',
        'lead_reference':next(iter(references)),'split_counts':[len(g) for g in groups], 'excluded_count':len(rows)-sum(map(len,groups)),
        'split_boundaries':[train_end,cal_end], 'model_source':next(iter(domains))[0],
        'metrics':{'climatology':metrics(ys[2],predict(climate,xs[2][:,6:10])),
        'rh_wind':metrics(ys[2],predict(simple,xs[2][:,[0,3,4]])),
        'logistic_raw':metrics(ys[2],raw),'logistic_calibrated':metrics(ys[2],p)},'by_lead':{}}
    for name in sorted({validate_forecast(r) for r in groups[2]}):
        idx=[i for i,r in enumerate(groups[2]) if validate_forecast(r)==name]
        report['by_lead'][name]=metrics(ys[2][idx],p[idx])
    return {'imputation_medians':medians.tolist(),'feature_names':FEATURES+[k+'_missing' for k in FEATURES],'model':model,'calibration':calibration,'report':report,'production_ready':False}

def forecast(profile):
    f=features(profile)
    return {'time':profile['valid_at'],'synthetic':bool(profile.get('synthetic',False)),'status':'NOT_CALIBRATED','cap_cloud':{'probability':None,
        'summit_covering_probability':None,'detached_probability':None},'observable_cap_probability':None,
        'visibility_probability':None,'tsurushi_probability':None,'timing':{'expected_start':None,'peak_window':None,'expected_end':None},
        'confidence':'UNAVAILABLE','ensemble':None,'features':f,
        'message':'気象特徴量は計算済み。実測教師データと予報校正が未整備のため、発生確率と時刻は未算出です。'}

def archive_forecast(path,row):
    validate_forecast(row)
    # One immutable file per issued forecast; outcomes belong to separate records.
    key=hashlib.sha256(json.dumps(row,sort_keys=True,allow_nan=False).encode()).hexdigest()
    p=Path(path)/f'{key}.json';p.parent.mkdir(parents=True,exist_ok=True)
    if not p.exists():
        with p.open('x',encoding='utf-8') as f:json.dump(row,f,ensure_ascii=False,indent=2,allow_nan=False)
    return str(p)

def demo_rows():
    rng=np.random.default_rng(47);rows=[]
    for i in range(360):
        t=dt.datetime(2020,1,1,7,tzinfo=JST)+dt.timedelta(days=i)
        x=rng.normal(size=len(FEATURES));x[0]=np.clip(70+15*x[0],5,100)
        x[1]*=800;x[2]=max(0,8+3*x[2]);x[3]*=12;x[4]=abs(x[4])*15;x[5]*=.0001
        x[6:]=[math.sin(2*math.pi*t.month/12),math.cos(2*math.pi*t.month/12),math.sin(2*math.pi*t.hour/24),math.cos(2*math.pi*t.hour/24)]
        y=rng.random()<sigmoid((x[0]-75)/12+x[3]/20)
        rows.append({'sample_id':f'synthetic-{i}','event_id':f'synthetic-event-{i}','valid_at':t.isoformat(),
            'issued_at':(t-dt.timedelta(hours=3)).isoformat(),'available_at':(t-dt.timedelta(hours=2)).isoformat(),
            'data_kind':'forecast','model_source':'SYNTHETIC','met_dataset_version':'test-v1','camera_era':'SYNTHETIC',
            'label':'CAP_SUMMIT_COVERING' if y else 'NO_CAP','quality':'SILVER','daylight':True,
            'label_source':'human_reviewed','duration_minutes':6,'max_frame_gap_seconds':30,
            'synthetic':True,'features':dict(zip(FEATURES,x.tolist()))})
    return rows

def main():
    p=argparse.ArgumentParser(description='富士山笠雲の研究用試作。未校正確率は返しません。')
    sub=p.add_subparsers(dest='command',required=True)
    for cmd in ['features','forecast']:
        a=sub.add_parser(cmd);a.add_argument('input');a.add_argument('--output',required=True)
    a=sub.add_parser('train');a.add_argument('input');a.add_argument('--train-end',required=True);a.add_argument('--cal-end',required=True);a.add_argument('--output',required=True)
    a=sub.add_parser('archive');a.add_argument('input');a.add_argument('--directory',required=True)
    a=sub.add_parser('demo');a.add_argument('--output',default='data/動作試験.json')
    args=p.parse_args()
    try:
        if args.command=='demo': result=train(demo_rows(),'2020-07-01T00:00:00+09:00','2020-10-01T00:00:00+09:00')
        elif args.command=='train':
            data=read_json(args.input)
            result=train(data['rows'] if isinstance(data,dict) else data,args.train_end,args.cal_end)
        elif args.command=='archive':
            print('保存しました: '+archive_forecast(args.directory,read_json(args.input)));return
        else: result=globals()[args.command](read_json(args.input))
        write_json(args.output,result)
        print(('注意: 合成データの動作試験です。予報精度ではありません。' if args.command=='demo' else '処理しました。')+'\n保存先: '+str(Path(args.output).resolve()))
        if args.command=='forecast':print(result['message'])
    except (ValueError,KeyError,OSError,TypeError) as e:
        print('処理できません: '+str(e)+'\n入力ファイルの必須項目・単位・時刻を確認してください。',file=sys.stderr);sys.exit(2)

if __name__=='__main__':main()
