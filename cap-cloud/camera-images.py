"""富士市の1日分の目録を取得。全期間走査は行わない。"""
import argparse,datetime as dt,hashlib,io,json,time,urllib.error,urllib.parse,urllib.request,urllib.robotparser
from html.parser import HTMLParser
from pathlib import Path
from PIL import Image
def write_json(path,value):
    p=Path(path);p.write_text(json.dumps(value,ensure_ascii=False,indent=2),encoding="utf-8")
BASE='https://www2.city.fuji.shizuoka.jp'
AGENT='FujiCapResearchPrototype/0.1'
class Links(HTMLParser):
    def __init__(self):super().__init__();self.links=[]
    def handle_starttag(self,tag,attrs):
        d=dict(attrs)
        if tag.lower()=='a' and d.get('href','').lower().endswith('.jpg') and '/livehistory/' in d['href']:
            self.links.append(d['href'])

def parse_slots(html):
    parser=Links();parser.feed(html)
    if len(parser.links)!=15:raise ValueError('履歴ページの形式が変わったため停止しました')
    return parser.links

def get(url):
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':AGENT}),timeout=20) as r:
        data=r.read(10_000_001)
        if len(data)>10_000_000:raise ValueError('取得上限を超えました')
        return data

def inventory(day,output,max_images=1):
    if max_images not in range(1,16):raise ValueError("取得上限は1〜15枚です")
    d=dt.date.fromisoformat(day)
    if not dt.date(1999,1,28)<=d<=dt.datetime.now(dt.timezone(dt.timedelta(hours=9))).date():raise ValueError('履歴対象外の日付です')
    url=BASE+'/livecamera/fujiyama_history.htm?'+urllib.parse.urlencode({'YY':f'{d.year%100:02}','MM':f'{d.month:02}','DD':f'{d.day:02}'})
    robot=urllib.robotparser.RobotFileParser();robots_status='available'
    try: robot.parse(get(BASE+'/robots.txt').decode().splitlines())
    except urllib.error.HTTPError as e:
        if e.code!=404:raise
        robots_status='404_no_rules';robot.parse([])
    if not robot.can_fetch(AGENT,url):raise ValueError('robotsの制限で取得できません')
    time.sleep(2)
    html=get(url);links=parse_slots(html.decode('shift_jis',errors='replace'))
    root=Path(output);root.mkdir(parents=True,exist_ok=False)
    (root/(day+'.html')).write_bytes(html)
    rows=[];downloaded=0
    for hour,link in enumerate(links,5):
        missing='/film/' in link
        row={'image_id':f'fuji-city-{day}-{hour:02}','source':url,'camera_id':'fuji-city',
            'capture_time_jst':f'{day}T{hour:02}:00:00+09:00','capture_time_precision':'approximate_hour',
            'latitude':None,'longitude':None,'view_direction':None,'image_width':None,'image_height':None,
            'file_size':None,'camera_era':'UNREVIEWED','daylight':None,'quality':'UNKNOWN','label':'UNKNOWN',
            'label_confidence':None,'label_source':'unreviewed','candidate_quality':'BRONZE',
            'availability':'missing' if missing else 'linked_unverified','url':None if missing else urllib.parse.urljoin(BASE,link)}
        if not missing and downloaded<max_images:
            image_url=row['url']
            if urllib.parse.urlsplit(image_url).netloc!=urllib.parse.urlsplit(BASE).netloc:raise ValueError('予期しない画像ホストです')
            if not robot.can_fetch(AGENT,image_url):raise ValueError('画像はrobotsで制限されています')
            time.sleep(2);b=get(image_url)
            with Image.open(io.BytesIO(b)) as im: im.verify()
            with Image.open(io.BytesIO(b)) as im:row.update(image_width=im.width,image_height=im.height)
            row.update(file_size=len(b),sha256=hashlib.sha256(b).hexdigest(),availability='downloaded')
            (root/(row['image_id']+'.jpg')).write_bytes(b);downloaded+=1
        rows.append(row)
    result={'source':url,'robots_status':robots_status,'retrieved_at':dt.datetime.now(dt.timezone.utc).isoformat(),
            'scope':f'固定日15枠、画像最大{max_images}枚。全期間の欠測率ではない。',
            'expected_slots':15,'missing_slots':sum(r['availability']=='missing' for r in rows),
            'downloaded_images':downloaded,'rows':rows}
    write_json(root/(day+'.json'),result);return result
if __name__=='__main__':
    a=argparse.ArgumentParser(description='富士市の1日分を検査し、画像を指定上限まで取得します（最大15枚）。')
    a.add_argument('day');a.add_argument('--output',default='data/camera');a.add_argument('--max-images',type=int,default=1);args=a.parse_args()
    try:
        r=inventory(args.day,args.output,args.max_images);print(json.dumps({k:v for k,v in r.items() if k!='rows'},ensure_ascii=False,indent=2))
    except (ValueError,OSError) as e:print('取得できません: '+str(e));raise SystemExit(2)
