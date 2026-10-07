# coding: utf-8
"""Own approximate geometry; no third-party model assets. Units: east,north,up meters.
Dimensions: published tower dimensions and drawing/LOD2 deck envelopes and SKYTREE 68 m equilateral footprint.
PLATEAU 2025 used to check geographic orientation/envelope, not a measured lattice.
Member spacing, thickness, decks' outer profiles and curvature are estimates.
"""
import math,json
from pathlib import Path

def model(name,height):return dict(id=name+'-drawing-envelope-v2',heightM=height,referenceBearing=0,approximate=True,sourceLabel='図面参照3D・細部は推定',sourceUrl='https://www.tokyotower.co.jp/guidance/' if name=='tokyotower' else 'https://www.tokyo-skytree.jp/floor/',vertices=[],faces=[],provenance={'kind':'self-authored-approximation','envelopeReference':'PLATEAU 2025 港区・墨田区（参考）','measuredLattice':False})
def add(m,pts):
 i=len(m['vertices']);m['vertices'] += [[round(x,4) for x in p] for p in pts];m['faces'].append(list(range(i,i+len(pts))))
def cross(a,b):return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
def unit(a):
 l=math.sqrt(sum(x*x for x in a));return [x/l for x in a]
def beam(m,a,b,width):
 direction=unit([b[i]-a[i] for i in range(3)]);u=unit(cross(direction,[0,0,1] if abs(direction[2])<.95 else [1,0,0]));v=cross(direction,u);r=width/2
 add(m,[[p[i]+r*(sx*u[i]+sy*v[i]) for i in range(3)] for p in [a,b] for sx,sy in [(-1,-1),(-1,1),(1,1),(1,-1)]])
def ring(m,h,r,n=24):return [[r*math.sin(i*2*math.pi/n),r*math.cos(i*2*math.pi/n),h] for i in range(n)]
def cylinder(m,z0,z1,r0,r1,n=24):add(m,ring(m,z0,r0,n)+ring(m,z1,r1,n))
def box(m,z0,z1,half0,half1,rot):
 def pts(z,h):return [[x*math.cos(rot)-y*math.sin(rot),x*math.sin(rot)+y*math.cos(rot),z] for x,y in [(-h,-h),(h,-h),(h,h),(-h,h)]]
 add(m,pts(z0,half0)+pts(z1,half1))
def interp(profile,h):
 for (a,x),(b,y) in zip(profile,profile[1:]):
  if a<=h<=b:return x+(y-x)*(h-a)/(b-a)
 return profile[-1][1]

t=model('tokyotower',333);rot=math.radians(55.872276)
t['provenance'].update({'footSpacingM':80,'foundationOuterWidthM':88,'rotationEastNorthCCWDeg':55.872276,'cornerBearingDeg':79.127724,'orientationFitRmsDeg':2.410756,'groundAssumptionM':18,'drawingSourceUrl':'https://www.usao.jp/usao/内藤多仲カルテ/資料全部/カルテ6-1-3.pdf','deckFloorEstimateAglM':[125,223.55],'orientationReference':'PLATEAU tower body cross-section near z=149.408m','outlineReference':'東京タワー設計と計測 図2・図10','deckEnvelopeSeaM':[148.389,247.55],'nominalLabelM':[150,250]})
# Estimated curved four-legged envelope, calibrated to official overall/deck heights.
# Fig.2 and Fig.10: 80 m above-ground foot spacing, 88 m foundation exterior. The above-ground
# tower cannot be modelled as a solid 95 m square or as full-width X braces below its arch.
# Intermediate leg curve stations are traced estimates; deck roofs use PLATEAU absolute z.
profile=[(0,40),(20,30.5),(40,23),(60,17),(80,14),(100,12),(120,10.5),(130.389,10),(160,8),(200,5.7),(223.55,4.8),(229.55,4.5),(252.65,1.5)]
def square(h):
 r=interp(profile,h);return [[x*math.cos(rot)-y*math.sin(rot),x*math.sin(rot)+y*math.cos(rot),h] for x,y in [(-r,-r),(r,-r),(r,r),(-r,r)]]
levels=[0,10,20,30,40,50,60,70,80,90,100,110,120,130.389,140,150,160,170,180,190,200,210,220,223.55,229.55,240,252.65]
for a,b in zip(levels,levels[1:]):
 if a==120 or a==223.55:continue
 low,up=square(a),square(b);w=1.3 if a<80 else .65 if a<223.55 else .35
 for i in range(4):
  n=(i+1)%4;beam(t,low[i],up[i],w)
  if a>=40:
   beam(t,low[i],low[n],w*.7);beam(t,low[i],up[n],w*.55);beam(t,low[n],up[i],w*.55)
# Visible arch follows Fig.2; keep the space above FootTown open.
for i in range(4):
 a,b=square(0)[i],square(0)[(i+1)%4];prev=None
 for j in range(17):
  f=j/16;z=40*math.sin(math.pi*f);shrink=interp(profile,z)/40
  q=[(a[k]*(1-f)+b[k]*f)*shrink for k in range(2)]+[z]
  if prev:beam(t,prev,q,.8)
  prev=q
box(t,0,23.465,22.05,22.05,rot)
def octagon(m,z0,z1,width0,width1,rot):
 def pts(z,w):
  h=w/2;c=h*(math.sqrt(2)-1)
  return [[x*math.cos(rot)-y*math.sin(rot),x*math.sin(rot)+y*math.cos(rot),z] for x,y in [(-c,-h),(c,-h),(h,-c),(h,c),(c,h),(-c,h),(-h,c),(-h,-c)]]
 add(m,pts(z0,width0)+pts(z1,width1))
octagon(t,120,125,27,28,rot);octagon(t,125,130.389,28,29,rot)
octagon(t,223.55,229.55,13,13,rot)
box(t,23.465,120,1.4,1.4,rot);box(t,130.389,223.55,1.0,1.0,rot)
# Original tower's 253 m body + 80 m aerial. Antenna equipment changed later;
# member thickness and current aerial detail remain estimated.
box(t,252.65,300,1.5,1.0,rot);box(t,300,313,1.0,.75,rot)
cylinder(t,313,333,.3,.12,12)

s=model('skytree',634)
# Official operator: 68 m equilateral base; circular transition at 315 m.
# Designer: 32 m diameter transition, circular arcs tangent to a cone, 24 perimeter subdivisions.
# Reconstruct the radial arc envelope; cone slope inferred from the published
# 4520 m vertex arc. Per-member positions remain an approximation.
base=68/math.sqrt(3);transition=315.;radius=16.;arcRadius=4520.
dx=radius-base;dz=transition;length=math.hypot(dx,dz)
h=math.sqrt(arcRadius**2-length**2/4)
cx=(base+radius)/2+dz/length*h;cz=transition/2-dx/length*h
slope=-(transition-cz)/(radius-cx)
s['provenance'].update({'baseSideM':68,'transitionHeightM':315,'transitionDiameterM':32,'crossSectionSamples':24,'sourceUrl':'https://www.nikken.jp/en/about/p4iusj0000001hyd-att/Journal-2012_Autumn.pdf','sourceAccess':'designer PDF search-index text; full file unavailable','orientationFitQuality':'low LOD2 points are not reliable foot anchors; bearing remains estimated','vertexArcRadiusM':4520,'coneSlopeInferred':slope,'orientationBearingDeg':60,'orientationQuality':'PLATEAU lower body points; approximate','reference':'NIKKEN JOURNAL 12 / operator structural guide'})
tri=[[base*math.sin(math.radians(60)+i*2*math.pi/3),base*math.cos(math.radians(60)+i*2*math.pi/3)] for i in range(3)]
def arc_r(r0,z):
 dr=r0-radius;dh=-transition
 den=2*(dr-slope*dh)
 if abs(den)<1e-9:return radius+slope*(z-transition)
 lam=(dr*dr+dh*dh)/den
 centerR=radius+lam;centerZ=transition-lam*slope;R=abs(lam)*math.sqrt(1+slope*slope)
 return centerR-math.copysign(math.sqrt(max(0,R*R-(z-centerZ)**2)),lam)
def contour(z):
 pts=[]
 for i in range(24):
  side=i//8;f=(i%8)/8;a,b=tri[side],tri[(side+1)%3];p=[a[j]*(1-f)+b[j]*f for j in range(2)];r0=math.hypot(*p);angle=math.atan2(p[0],p[1])
  r=arc_r(r0,z) if z<=transition else radius+slope*(z-transition)
  pts.append([r*math.sin(angle),r*math.cos(angle),z])
 return pts
levels=sorted(set(list(range(0,315,15))+[50,315,329,374,390,405,420,434,462,478,494]))
for a,b in zip(levels,levels[1:]):
 if a==329 or a==434:continue
 low,up=contour(a),contour(b);w=1.5 if a<160 else 1 if a<329 else .65
 for i in range(24):
  n=(i+1)%24
  # Below the 50 m junction, keep three leg groups rather than 24 ground feet.
  if a<50 and i%8 not in (0,1,7):continue
  beam(s,low[i],up[i],w if i%8==0 else w*.65)
  # The three main legs join around 50 m; don't invent full cross braces at ground.
  if a>=50 or n%8 in (0,1,7):
   beam(s,low[i],low[n],w*.55);beam(s,low[i],up[n],w*.5);beam(s,low[n],up[i],w*.5)
# Central elevator/concrete shaft is opaque; lattice gaps remain around it.
cylinder(s,0,375,4.0,4.0,16);cylinder(s,375,434,3.3,3,16)
for a,b,r0,r1 in [(329,341,17,24),(341,350,24,28),(350,360,28,29.25),(360,368,29.25,28),(368,374,28,17),(434,441,16,17),(441,450,17,19),(450,457,19,20),(457,462,20,12)]:cylinder(s,a,b,r0,r1,32)
for a,b,r0,r1 in [(494,500,8,4),(500,525,4,4),(525,530,4,3),(530,557,3,3),(557,563,3,2.5),(563,587,2.5,2.5),(587,592,2.5,2),(592,616,2,2),(616,630,2,2.8),(630,634,2.8,.4)]:cylinder(s,a,b,r0,r1,24)
for m in [t,s]:
 assert all(all(math.isfinite(x) for x in p) for p in m['vertices'])
 assert math.isclose(max(p[2] for p in m['vertices']),m['heightM'],abs_tol=1e-6)
models={'tokyotower':t,'skytree':s}
out=Path(__file__).resolve().parent.parent/'sorami-tower-models.js'
out.write_text('/* Generated by tools/build-free-towers.py. Own estimated lattice, drawing/dimension-constrained envelope; internal detail remains approximate. */\n(function(g){"use strict";const models='+json.dumps(models,ensure_ascii=False,separators=(',',':'))+';if(typeof module!=="undefined"&&module.exports)module.exports=models;else g.SoramiTowerModels=models;})(typeof globalThis!=="undefined"?globalThis:this);\n')
print(out)
