"""Render the actual silhouette triangles with 4x supersampling, no blur filter.

Usage: python3 tools/render-city-comparison.py --before old.js --after new.js --output-dir DIR
"""
import argparse
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont


def models(path):
    return json.JSONDecoder().raw_decode(path.read_text().split('const models=',1)[1])[0]


def project(model,bearing=300,distance=1000):
    a=math.radians(bearing)
    points=[]
    for x,y,z in model['vertices']:
        forward=x*math.sin(a)+y*math.cos(a)
        right=x*math.cos(a)-y*math.sin(a)
        points.append((math.atan2(right,distance-forward),
                       math.atan2(z-1.5,math.hypot(distance-forward,right))))
    return points


AA=4
FONT='/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc'


def text(image,xy,value,size=28,fill='#25364b'):
    ImageDraw.Draw(image).text(tuple(int(x*AA) for x in xy),value,
                             font=ImageFont.truetype(FONT,size*AA),fill=fill)


def panel(model,points,width,height,bounds,color):
    # Rasterize a binary union at 4x and downsample only once at final output.
    im=Image.new('RGB',(int(width*AA),int(height*AA)),'#f6f8fb')
    d=ImageDraw.Draw(im)
    xmin,xmax,ymin,ymax=bounds
    scale=min((width-28)/(xmax-xmin),(height-24)/(ymax-ymin))
    pp=[((width/2+(x-(xmin+xmax)/2)*scale)*AA,
         (height/2-(y-(ymin+ymax)/2)*scale)*AA) for x,y in points]
    for face in model['triangles']:
        p=[pp[i] for i in face]
        if max(q[0] for q in p)<0 or min(q[0] for q in p)>width*AA:continue
        if max(q[1] for q in p)<0 or min(q[1] for q in p)>height*AA:continue
        d.polygon(p,fill=color)
    return im


def bounds(points):
    return min(p[0] for p in points),max(p[0] for p in points),min(p[1] for p in points),max(p[1] for p in points)


def main():
    p=argparse.ArgumentParser();p.add_argument('--before',type=Path,required=True)
    p.add_argument('--after',type=Path,required=True);p.add_argument('--output-dir',type=Path,required=True)
    args=p.parse_args();old,new=models(args.before),models(args.after)
    args.output_dir.mkdir(parents=True,exist_ok=True)
    ids=[('azabudai-hills','森JPタワー'),('shibuya-sky','渋谷スカイ')]
    image=Image.new('RGB',(1600*AA,1250*AA),'#f6f8fb')
    for col,(key,title) in enumerate(ids):
        text(image,(col*800+40,26),title,36)
        m=new[key];pp=project(m);b=bounds(pp)
        image.paste(panel(m,pp,760,1070,b,'#317bc4'),((col*800+20)*AA,100*AA))
    text(image,(40,1195),'曲面を再分割・4倍解像度で描画後に縮小／形状には推定を含みます',23)
    image.resize((1600,1250),Image.Resampling.LANCZOS).save(args.output_dir/'滑らかな輪郭_v2.png')

    comparison=Image.new('RGB',(1800*AA,1050*AA),'#f6f8fb')
    for row,(key,title) in enumerate(ids):
        y=row*500
        text(comparison,(35,y+15),title+('：冠部の拡大' if row==0 else '：低層カーブの拡大'),30)
        mm=[old[key],new[key]];projected=[project(m) for m in mm]
        selected=[]
        for m,pp in zip(mm,projected):
            selected.extend(q for v,q in zip(m['vertices'],pp) if (v[2]>=310 if row==0 else v[2]<=80))
        b=bounds(selected)
        for col,(m,pp,label,color) in enumerate(zip(mm,projected,['前回の形状','今回の形状'],['#8d99a8','#317bc4'])):
            text(comparison,(col*900+35,y+65),label,25)
            comparison.paste(panel(m,pp,860,370,b,color),((col*900+20)*AA,(y+110)*AA))
    text(comparison,(35,1010),'両方とも同じカメラ・同じ縮小AA。画像のぼかしではなく実メッシュを比較。',22)
    comparison.resize((1800,1050),Image.Resampling.LANCZOS).save(args.output_dir/'曲面の拡大比較_v1_v2.png')
    print(args.output_dir/'滑らかな輪郭_v2.png')
    print(args.output_dir/'曲面の拡大比較_v1_v2.png')


if __name__=='__main__':main()
