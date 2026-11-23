"""Offline metadata-builder regressions; deliberately no numpy/PIL dependency."""
import copy,hashlib,importlib.util,json,tempfile,unittest
from pathlib import Path
import urllib.request

ROOT=Path(__file__).resolve().parent.parent
urllib.request.urlopen=lambda *a,**k:(_ for _ in ()).throw(RuntimeError('external IO forbidden'))
spec=importlib.util.spec_from_file_location('structures',ROOT/'tools/plateau-structure-models.py')
M=importlib.util.module_from_spec(spec);spec.loader.exec_module(M)

class StructureModels(unittest.TestCase):
 def setUp(self):
  self.specs=M.load_specs();self.row=self.specs[0]
  self.index=json.loads((ROOT/'data/building-heights/index.json').read_text())
  self.id=self.row['id'];self.binding=self.row['overlay'];self.mesh=self.binding['mesh']

 def test_real_excerpt_derives_height_and_full_geometry(self):
  models=M.compile_models(self.index,self.specs)
  self.assertEqual(list(models),['way/480651052']);r=models[self.id]
  self.assertEqual(r['topM'],28);self.assertEqual(r['source']['topRangeM'],[20.1158548,27.72094068])
  self.assertEqual(r['geometry']['halfWidthM'],12)
  self.assertEqual(r['geometry'],self.row['geometry'])
  self.assertEqual(len(r['source']['surfaces']),3)
  self.assertTrue(M.covers_lines(r['geometry']['lines'],r['coverage']['polygons']))
  self.assertEqual(self.index.get('structureModels'),models,'the shipped metadata is reproducible')

 def test_every_overlay_value_and_rebuilt_source_are_binding(self):
  for field in ('cells','topM','buildingIds'):
   index=copy.deepcopy(self.index);overlay=index['targets'][self.binding['targetKey']][self.mesh]
   if field=='cells':overlay[field][0][1]+=1
   elif field=='topM':overlay[field]+=1
   else:overlay[field]=['another-building']
   self.assertEqual(M.compile_models(index,self.specs),{})
  self.assertEqual(M.compile_models(self.index,self.specs,{self.mesh:['0'*64]}),{})
  self.assertIn(self.id,M.compile_models(self.index,self.specs,{self.mesh:[self.row['source']['sha256']]}))

 def test_merge_does_not_restore_retired_correspondence(self):
  self.assertEqual(M.compile_merged_models(self.index,self.specs,{self.mesh},{}),{})
  self.assertIn(self.id,M.compile_merged_models(self.index,self.specs,{'other-mesh'},{}))
  known=M.compile_models(self.index,self.specs)
  self.assertEqual(M.compile_merged_models(self.index,self.specs,{self.mesh},known),known)

 def test_changed_excerpt_and_geometry_are_rejected(self):
  row=copy.deepcopy(self.row);row['surfacesXml'][0]=row['surfacesXml'][0].replace('27.72094068','25.72094068')
  with self.assertRaisesRegex(ValueError,'excerpt changed'):M.compile_models(self.index,[row])
  row=copy.deepcopy(self.row);row['geometry']['lines'][0][1][0]+=.001
  with self.assertRaisesRegex(ValueError,'outside source roof'):M.compile_models(self.index,[row])
  for width in (float('nan'),float('inf'),-1):
   row=copy.deepcopy(self.row);row['geometry']['halfWidthM']=width
   with self.assertRaisesRegex(ValueError,'width'):M.compile_models(self.index,[row])

 def test_continuous_coverage_includes_gaps_holes_and_collinear_edges(self):
  def square(a,b):return {'outer':[[0,a],[0,b],[2,b],[2,a],[0,a]],'holes':[]}
  self.assertTrue(M.covers_lines([[[1,0],[1,2]]],[square(0,1),square(1,2)]))
  self.assertFalse(M.covers_lines([[[1,0],[1,2]]],[square(0,.999999999),square(1,2)]))
  self.assertTrue(M.covers_lines([[[0,.2],[0,1.8]]],[square(0,2)]))
  self.assertFalse(M.covers_lines([[[0,-.1],[0,1.8]]],[square(0,2)]))
  outer=square(0,2);outer['holes']=[[[.5,.999999999],[.5,1],[1.5,1],[1.5,.999999999],[.5,.999999999]]]
  self.assertFalse(M.covers_lines([[[1,.2],[1,1.8]]],[outer]))

 def test_original_source_hash_building_and_excerpt_are_checked(self):
  row=copy.deepcopy(self.row)
  xml='<bldg:Building xmlns:bldg="http://www.opengis.net/citygml/building/2.0" xmlns:gml="http://www.opengis.net/gml" gml:id="'+row['source']['buildingId']+'">'+''.join(row['surfacesXml'])+'</bldg:Building>'
  raw=xml.encode();row['source']['sha256']=hashlib.sha256(raw).hexdigest()
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/'source.gml';path.write_bytes(raw)
   self.assertEqual(M.verify_source(row,path),row['source']['sha256'])
   path.write_bytes(raw+b' ')
   with self.assertRaisesRegex(ValueError,'original source changed'):M.verify_source(row,path)
   path.write_bytes(raw);row['source']['buildingId']='absent'
   with self.assertRaisesRegex(ValueError,'building missing'):M.verify_source(row,path)

if __name__=='__main__':unittest.main()
