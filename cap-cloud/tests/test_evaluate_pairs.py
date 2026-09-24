import unittest,sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1] if Path(__file__).parent.name=='tests' else Path(__file__).parent))
import evaluate_pairs as e
class Tests(unittest.TestCase):
 def data(self):
  return dict(schemaVersion=1,synthetic=True,comparisonKind='prospective_frozen',rows=[dict(sampleId=str(i),weatherEpisodeId=str(i),cameraEra='era1',leadBin='0-6h',truthEvidence='synthetic fixture',candidateVersion='v1',baselineVersion='b1',truthSource='human_reviewed',quality='GOLD',label=i%2,candidateProbability=.9 if i%2 else .1,baselineProbability=.5,validAt='2026-09-14T12:00:00Z',forecastAvailableAt='2026-09-14T11:00:00Z',candidateCreatedAt='2026-09-14T11:00:00Z',baselineCreatedAt='2026-09-14T11:00:00Z') for i in range(10)])
 def test_improvement_and_seed(self):
  a=e.evaluate(self.data());self.assertLess(a['brierDeltaVsBaseline95CI'][1],0);self.assertEqual(a,e.evaluate(self.data()));self.assertFalse(a['productionReady'])
 def test_single_episode_has_no_ci(self):
  d=self.data()
  for r in d['rows']:r['weatherEpisodeId']='same'
  self.assertIsNone(e.evaluate(d)['brierDeltaVsBaseline95CI'])
 def test_no_truth_waits(self):
  d=self.data();d['rows']=[];self.assertEqual(e.evaluate(d)['status'],'waiting_for_pairs')
 def test_ai_rejected(self):
  d=self.data();d['rows'][0]['truthSource']='ai_reviewed'
  with self.assertRaises(ValueError):e.evaluate(d)
 def test_after_fact_predictions_rejected(self):
  d=self.data();d['rows'][0]['candidateCreatedAt']='2026-09-15T00:00:00Z'
  with self.assertRaises(ValueError):e.evaluate(d)
 def test_duplicate_rejected(self):
  d=self.data();d['rows'].append(d['rows'][0])
  with self.assertRaises(ValueError):e.evaluate(d)
if __name__=='__main__':unittest.main()
