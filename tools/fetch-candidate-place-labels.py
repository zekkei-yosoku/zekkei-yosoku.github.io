#!/usr/bin/env python3
"""Manual, bounded source export for the pilot. Runtime clients never call these services."""
import argparse,hashlib,json,subprocess,urllib.request
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
parser=argparse.ArgumentParser();parser.add_argument('--output-dir',type=Path,required=True);args=parser.parse_args();out=args.output_dir;out.mkdir(parents=True,exist_ok=True)
agent='AstroNotesTrialDataBuild/1.0 (https://zekkei-yosoku.github.io/trial/)'
def address(code):
    url=f'https://geoshape.ex.nii.ac.jp/ka/topojson/2020/13/r2ka{code}.topojson'
    with urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':agent}),timeout=45) as r:data=r.read()
    json.loads(data);(out/(code+'.topojson')).write_bytes(data)
    return dict(url=url,sha256=hashlib.sha256(data).hexdigest(),bytes=len(data))
with ThreadPoolExecutor(max_workers=2) as ex:sources=list(ex.map(address,['13101','13103','13104','13106','13107']))
parts=[]
for box in [(35.6825,139.7235,35.693,139.739),(35.707,139.798,35.718,139.8145)]:
    bbox=','.join(map(str,box));parts.extend([f'way["name"][~"^(leisure|tourism|amenity|building|landuse)$"~"."]({bbox});',f'rel["type"="multipolygon"]["name"][~"^(leisure|tourism|amenity|building|landuse)$"~"."]({bbox});'])
query='[out:json][timeout:40][maxsize:67108864];('+''.join(parts)+');out geom;';q=out/'facilities-query.overpass';q.write_text(query)
# curl uses the system TLS trust store; never disable certificate verification.
subprocess.run(['curl','--fail','--show-error','--silent','--max-time','60','--user-agent',agent,'--data-urlencode','data@'+str(q),'--output',str(out/'facilities-osm.json'),'https://overpass-api.de/api/interpreter'],check=True)
data=(out/'facilities-osm.json').read_bytes();osm=json.loads(data);sources.append(dict(url='https://overpass-api.de/api/interpreter',query=query,sha256=hashlib.sha256(data).hexdigest(),dataDate=osm['osm3s']['timestamp_osm_base'],bytes=len(data)))
(out/'downloads.json').write_text(json.dumps(sources,indent=2)+'\n');print(json.dumps(sources,indent=2))
