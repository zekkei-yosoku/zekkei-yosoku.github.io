"""Reproducible, source-preserving silhouette corrections for two city models.

Uses scipy only at build time. Original CityGML-derived meshes remain in data/.
Run from any directory; --output defaults to work/refined-city-models.js.
The output is a candidate: it does not install or publish itself.
"""
import argparse
import copy
import hashlib
import json
import math
from collections import defaultdict
from pathlib import Path

import numpy as np
from scipy.interpolate import PchipInterpolator, CubicHermiteSpline

ROOT = Path(__file__).resolve().parent.parent
BASE_PATH = ROOT / 'tools/data/city-refinement-source.json'
BASE = json.loads(BASE_PATH.read_text())
REPORT = {}


def read_models(path):
    text = path.read_text()
    return json.JSONDecoder().raw_decode(text.split('const models=', 1)[1])[0]


def clip(poly, z, above):
    out = []
    for a, b in zip(poly, poly[1:] + poly[:1]):
        ina, inb = (a[2] >= z, b[2] >= z) if above else (a[2] <= z, b[2] <= z)
        if ina:
            out.append(a)
        if ina != inb:
            t = (z-a[2])/(b[2]-a[2])
            out.append([a[k] + t*(b[k]-a[k]) for k in range(3)])
    return out


class Mesh:
    def __init__(self, original):
        self.model = copy.deepcopy(original)
        self.vertices, self.triangles, self.lookup = [], [], {}
        # Invert the same linear tangent-plane transform as build-city-models.py.
        p = np.asarray(original['vertices'])
        geo = np.asarray(original['geoVertices'])
        self.lat0 = float(np.median(geo[:, 0]-p[:, 1]/111320))
        self.lon0 = float(np.median(geo[:, 1]-p[:, 0]/(111320*math.cos(math.radians(self.lat0)))))

    def vertex(self, p):
        key = tuple(round(float(x), 8) for x in p)
        if key not in self.lookup:
            self.lookup[key] = len(self.vertices)
            self.vertices.append(list(key))
        return self.lookup[key]

    def triangle(self, a, b, c):
        face = [self.vertex(p) for p in (a, b, c)]
        if len(set(face)) == 3:
            self.triangles.append(face)

    def polygon(self, p):
        for i in range(1, len(p)-1):
            self.triangle(p[0], p[i], p[i+1])

    def finish(self, correction):
        m = self.model
        m['vertices'], m['triangles'] = self.vertices, self.triangles
        m['geoVertices'] = [[self.lat0+y/111320,
                             self.lon0+x/(111320*math.cos(math.radians(self.lat0)))]
                            for x, y, z in self.vertices]
        m['geometryRevision'] = '20261019-curves-v2'
        m['provenance']['refinement'] = correction
        m['provenance']['sourceMeshSha256'] = hashlib.sha256(BASE_PATH.read_bytes()).hexdigest()
        m['provenance']['accuracyVerifiedBySurvey'] = False
        return m


def stitch_plane_edges(mesh,z):
    """Match the loft's long top edges to the upper source mesh's cut vertices."""
    plane=[i for i,p in enumerate(mesh.vertices) if abs(p[2]-z)<1e-7]
    faces=[];splits=0
    for face in mesh.triangles:
        j=next((j for j in range(3) if face[j] in plane and face[(j+1)%3] in plane),None)
        if j is None:faces.append(face);continue
        a,b,c=face[j],face[(j+1)%3],face[(j+2)%3]
        p,q=np.asarray(mesh.vertices[a]),np.asarray(mesh.vertices[b]);edge=q-p
        length=float(edge@edge)
        if length<1e-16:faces.append(face);continue
        between=[]
        for k in plane:
            if k in (a,b,c):continue
            delta=np.asarray(mesh.vertices[k])-p;t=float(delta@edge/length)
            # The source facade endpoints differ by up to 0.1 mm in plan.
            # Reuse their exact vertices; do not shift the source upper mesh.
            if 1e-8<t<1-1e-8 and np.linalg.norm(delta-t*edge)<2e-4:between.append((t,k))
        if not between:faces.append(face);continue
        ids=[a]+[k for _,k in sorted(between)]+[b]
        faces.extend([[left,right,c] for left,right in zip(ids,ids[1:])]);splits+=len(between)
    mesh.triangles=faces
    return splits


class CrownCurve:
    """Interpolate the Mori shaft's exterior ring, preserving all source anchors.

    XY tangents round only its already curved corners. Each roof wing gets a
    one-sided height spline: the low crown notches remain deliberate creases.
    Equipment away from the outer 4 m band is not deformed.
    """
    def __init__(self, model):
        vertices=np.asarray(model['vertices'])
        graph=defaultdict(set)
        for face in model['triangles']:
            p=vertices[face]
            if p[:,2].min()<100 and p[:,2].max()>300:
                ids=[i for i in face if vertices[i,2]>300]
                if len(ids)==2:
                    a,b=ids;graph[a].add(b);graph[b].add(a)
        assert graph and all(len(n)==2 for n in graph.values()),'Unclosed crown ring'
        indices=[];previous=None;current=min(graph)
        while current not in indices:
            indices.append(current)
            following=next(i for i in sorted(graph[current]) if i!=previous)
            previous,current=current,following
        assert len(indices)==len(graph)
        ring=vertices[indices]
        self.center=(ring[:,:2].min(0)+ring[:,:2].max(0))/2
        angles=np.arctan2(ring[:,1]-self.center[1],ring[:,0]-self.center[0])
        order=np.argsort(angles)
        self.ring=ring=ring[order];self.angles=angles[order]
        self.highest_roof=float(ring[:,2].max())
        self.length=np.linalg.norm(np.roll(ring[:,:2],-1,axis=0)-ring[:,:2],axis=1)
        self.s=np.r_[0,np.cumsum(self.length)]
        directions=(np.roll(ring[:,:2],-1,axis=0)-ring[:,:2])/self.length[:,None]
        tangents=[]
        for i in range(len(ring)):
            left,right=directions[i-1],directions[i]
            if self.length[i-1]>8 and self.length[i]<=8:tangent=left
            elif self.length[i]>8 and self.length[i-1]<=8:tangent=right
            else:
                tangent=left+right;tangent/=np.linalg.norm(tangent)
            tangents.append(tangent)
        self.xy=CubicHermiteSpline(self.s,np.vstack([ring[:,:2],ring[0,:2]]),
                                   np.vstack([tangents,tangents[0]]))
        self.height={}
        n=len(ring)
        for valley in np.flatnonzero(ring[:,2]<322):
            left=right=int(valley)
            while ring[left%n,2]<327.5:left-=1
            while ring[right%n,2]<327.5:right+=1
            for start,end in [(left,int(valley)),(int(valley),right)]:
                ids=list(range(start,end+1))
                x=np.r_[0,np.cumsum([self.length[i%n] for i in ids[:-1]])]
                z=np.array([ring[i%n,2] for i in ids])
                derivative=PchipInterpolator(x,z).derivative()(x)
                crest=0 if start!=valley else -1
                derivative[crest]=0
                if len(ids)==2:
                    derivative[-1 if crest==0 else 0]=2*(z[-1]-z[0])/(x[-1]-x[0])
                curve=CubicHermiteSpline(x,z,derivative)
                for k,index in enumerate(ids[:-1]):self.height[index%n]=(curve,float(x[k]))

    def __call__(self,p):
        x,y,z=map(float,p)
        if z<=40:return [x,y,z]
        dx,dy=x-self.center[0],y-self.center[1]
        radius=math.hypot(dx,dy)
        if radius<1:return [x,y,z]
        angle=math.atan2(dy,dx)
        i=(int(np.searchsorted(self.angles,angle,side='right'))-1)%len(self.ring)
        a=self.ring[i];b=self.ring[(i+1)%len(self.ring)]
        ex,ey=b[0]-a[0],b[1]-a[1]
        ax,ay=a[0]-self.center[0],a[1]-self.center[1]
        denominator=ex*dy-ey*dx
        if abs(denominator)<1e-10:return [x,y,z]
        t=min(1,max(0,-(ax*dy-ay*dx)/denominator))
        boundary=a+(b-a)*t
        depth=math.hypot(boundary[0]-self.center[0],boundary[1]-self.center[1])-radius
        if abs(depth)>=4:return [x,y,z]
        weight=(1-abs(depth)/4)**2
        blend=min(1,max(0,(z-40)/20));blend=blend*blend*(3-2*blend)
        smooth=self.xy(self.s[i]+t*self.length[i])
        x+=(float(smooth[0])-boundary[0])*weight*blend
        y+=(float(smooth[1])-boundary[1])*weight*blend
        if i in self.height and z>300:
            curve,offset=self.height[i]
            desired=float(curve(offset+t*self.length[i]))
            h=min(1,max(0,(z-300)/(boundary[2]-300)))
            h=h*h*(3-2*h)
            displacement=(desired-boundary[2])*weight*h
            # Do not raise roof fixtures past the source exterior's top. The
            # curved wing itself stays below this bound; this only limits the
            # blended inner band and leaves higher equipment at its source Z.
            if displacement>0:displacement=min(displacement,max(0,self.highest_roof-z))
            z+=displacement
        return [x,y,z]


def deform_adaptively(raw,deform,tolerance=.05,limit=180000):
    """Bounded conforming red/green refinement of source parameter triangles.

    Every marked face splits all three edges. Neighbours share the same edge
    midpoint, with green transition triangles. This prevents sliver cycles.
    """
    vertices=[tuple(p) for p in raw.vertices]
    mapped=[tuple(map(float,deform(p))) for p in vertices]
    faces=[tuple(f) for f in raw.triangles]
    def key(a,b):return (min(a,b),max(a,b))
    def edge_error(a,b):
        worst=0
        for t in [.25,.5,.75]:
            p=tuple(x+(y-x)*t for x,y in zip(vertices[a],vertices[b]))
            q=tuple(x+(y-x)*t for x,y in zip(mapped[a],mapped[b]))
            worst=max(worst,math.dist(tuple(map(float,deform(p))),q))
        return worst
    history=[]
    for iteration in range(7):
        error_cache={};marked=set()
        for face in faces:
            edges=[key(face[j],face[(j+1)%3]) for j in range(3)]
            if iteration==0:needs=True
            else:
                for edge in edges:
                    if edge not in error_cache:error_cache[edge]=edge_error(*edge)
                needs=max(error_cache[e] for e in edges)>tolerance
            if needs:marked.update(edges)
        if not marked:break
        mids={}
        for a,b in sorted(marked):
            p=tuple((x+y)/2 for x,y in zip(vertices[a],vertices[b]))
            mids[(a,b)]=len(vertices);vertices.append(p);mapped.append(tuple(map(float,deform(p))))
        new=[]
        for a,b,c in faces:
            ring=[a,b,c];mid=[mids.get(key(a,b)),mids.get(key(b,c)),mids.get(key(c,a))]
            count=sum(x is not None for x in mid)
            if count==0:new.append((a,b,c));continue
            if count==3:
                x,y,z=mid;new.extend([(a,x,z),(x,b,y),(z,y,c),(x,y,z)]);continue
            # Rotate so the only split edge is AB, or the two split edges AB/BC.
            pivot=next(i for i in range(3) if mid[i] is not None and
                       (mid[(i+1)%3] is not None if count==2 else True))
            a,b,c=ring[pivot],ring[(pivot+1)%3],ring[(pivot+2)%3]
            x=mid[pivot]
            if count==1:new.extend([(a,x,c),(x,b,c)])
            else:
                y=mid[(pivot+1)%3];new.extend([(b,y,x),(a,x,c),(x,y,c)])
        faces=new
        history.append({'pass':iteration+1,'markedEdges':len(marked),'triangles':len(faces)})
        assert len(faces)<=limit,'Surface refinement exceeded triangle budget'
    result=Mesh(raw.model)
    result.vertices=[[round(x,8) for x in p] for p in mapped]
    result.triangles=[list(f) for f in faces]
    # Report sampled error; it is interpolation error, never real-world accuracy.
    unique={key(f[j],f[(j+1)%3]) for f in faces for j in range(3)}
    worst=max(edge_error(*e) for e in unique)
    assert worst<=tolerance+1e-8,('Surface sampling did not converge',worst)
    return result,{'edgeSampleToleranceM':tolerance,'edgeSampleFractions':[.25,.5,.75],
        'maxSampledEdgeErrorM':worst,'maxNormalizedStep':worst/tolerance,
        'passes':history,'triangles':len(faces)}


# Digitized white section-profile curve, not the photographic outline beside it.
# Pixel coordinates refer to the unchanged 1000 x 1402 official illustration.
MORI_PROFILE = [[110,252],[140,251],[180,250],[220,249],[260,248],
                [300,247],[340,246],[380,245],[420,244],[460,243],
                [500,242],[540,242],[580,241],[620,240],[660,239],
                [700,239],[740,238],[780,238],[820,237],[860,237],
                [900,236],[940,236],[980,237],[1020,239],[1060,240],
                [1100,241],[1140,243],[1180,245],[1220,247],[1250,249]]
PROFILE = PchipInterpolator(*np.asarray(MORI_PROFILE).T)


def mori():
    original = BASE['azabudai-hills']
    mesh = Mesh(original)
    crown = CrownCurve(original)
    a = math.radians(-26.565051177)
    rotation = np.array([[math.cos(a), math.sin(a)], [-math.sin(a), math.cos(a)]])
    # The LOD2 main shaft's upper ring, separate from its asymmetric podium.
    points = np.asarray(original['vertices'])
    upper = points[(points[:,2] >= 327.53) & (points[:,2] <= 327.88), :2]
    uv = upper @ rotation.T
    center_uv = (uv.min(0)+uv.max(0))/2
    half = (uv.max(0)-uv.min(0))/2
    amplitude = np.maximum(0, 40-half)  # Approximate official 80 m office plan.
    roof_z = 327.622

    def fraction(z):
        # Illustration-to-height alignment is approximate, not a floor survey.
        y = np.clip(103+(330.818-z)*1152/330.818, 110, 1250)
        top_x = float(PROFILE(103+(330.818-roof_z)*1152/330.818))
        f = max(0, (top_x-float(PROFILE(y)))/(top_x-236))
        t = np.clip((z-40)/20, 0, 1)
        return f*t*t*(3-2*t) if z < roof_z else 0

    def deform(p):
        smooth = crown(p)
        xy = np.asarray(smooth[:2]) @ rotation.T
        xy = center_uv+(xy-center_uv)*(1+amplitude*fraction(p[2])/half)
        xy = xy @ rotation
        return [*xy, smooth[2]]

    # Uniform height cuts keep the long shaft well sampled before local
    # red/green refinement. Keep tiny/collinear bridge faces in the source mesh.
    cuts=[40,50,60]+list(range(65,320,5))+[319.6,roof_z]
    for indices in original['triangles']:
        face=[original['vertices'][i] for i in indices]
        levels=[z for z in cuts if min(p[2] for p in face)<z<max(p[2] for p in face)]
        remaining=face
        for z in levels:
            mesh.polygon(clip(remaining,z,False));remaining=clip(remaining,z,True)
        mesh.polygon(remaining)
    mesh,smooth_report=deform_adaptively(mesh,deform)

    REPORT['azabudai-hills'] = {'axisDegreesEast': math.degrees(a), 'halfWidthSourceM': half.tolist(),
        'maximumAxisCorrectionM': amplitude.tolist(), 'profilePixels': MORI_PROFILE,
        'heightSamples': [[z, fraction(z)] for z in range(0, 331, 5)],
        'surfaceSampling':smooth_report,'crownSourceAnchors':crown.ring.tolist()}
    return mesh.finish({'method': 'official-section-profile-loft',
        'sources': ['https://www.nihonsekkei.co.jp/think/ideas/case-study_20974/',
                    'https://www.nihonsekkei.co.jp/wp-content/uploads/2025/01/IDEAS_TowerGeometory.jpg',
                    'https://www.mori.co.jp/projects/azabudaihills/facilities/'],
        'scope': 'main shaft, rounded plan corners and C1 crown wings; source anchors, datum and aim height retained',
        'estimated': ['illustration-to-height mapping', '80m approximate office-plan calibration',
                      'four-sided profile symmetry','crown and corner interpolation between source anchors'],
        'maximumAxisCorrectionM': amplitude.tolist(), 'sampling':'adaptive shared edges',
        'surfaceSampling':smooth_report,
        'surveyToleranceM': None})


def shibuya():
    # Rejected 2026-10-19 after visual correction: a visitor map and guessed
    # vertical radii cannot establish the real urban-core facade geometry.
    # Keep the complete original object, including its GIS/provenance fields.
    REPORT['shibuya-sky'] = {
        'status': 'source-restored-refinement-rejected',
        'reason': 'visitor-plan ellipse and guessed floor interpolation did not establish exterior agreement',
        'notReconstructed': ['curved lower facade', 'urban-core circulation'],
        'surveyToleranceM': None}
    return copy.deepcopy(BASE['shibuya-sky'])


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--output',type=Path,default=ROOT/'work/refined-city-models.js')
    args=parser.parse_args()
    models=read_models(ROOT/'astronotes-city-models.js')
    models.update({'azabudai-hills':mori(),'shibuya-sky':shibuya()})
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text('/* PLATEAU 2025; Mori estimated correction; Shibuya original restored. '
        'Estimated geometry; see tools/2棟の形状補正.md. License: https://www.mlit.go.jp/plateau/site-policy/ */\n'
        '(function(g){const models='+json.dumps(models,ensure_ascii=False,separators=(',',':'))+
        ';if(typeof module!=="undefined"&&module.exports)module.exports=models;g.AstroNotesCityModels=models;'
        '})(typeof globalThis!=="undefined"?globalThis:this);\n')
    args.output.with_suffix('.report.json').write_text(json.dumps(REPORT,ensure_ascii=False,indent=2)+'\n')
    for key in BASE:
        m=models[key]
        print(key,len(m['vertices']),len(m['triangles']))
