import sys,unittest,copy,datetime as dt
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import model
class ModelTests(unittest.TestCase):
 def rows(self):return model.demo_rows()
 def test_demo_not_production(self):
  m=model.train(self.rows(),'2020-07-01T00:00:00+09:00','2020-10-01T00:00:00+09:00')
  self.assertFalse(m['production_ready']);self.assertTrue(m['report']['synthetic'])
 def test_snapshot_reference(self):
  r=self.rows()[0];r.update(forecast_reference_kind='snapshot',prediction_captured_at=r['available_at'],issued_at=None)
  self.assertEqual(model.validate_forecast(r),'0-6h')
 def test_reject_mixed_leads(self):
  rows=self.rows();rows[0].update(forecast_reference_kind='snapshot',prediction_captured_at=rows[0]['available_at'],issued_at=None)
  with self.assertRaises(ValueError):model.train(rows,'2020-07-01T00:00:00+09:00','2020-10-01T00:00:00+09:00')
 def test_episode_leak(self):
  rows=self.rows();rows[0]['weather_episode_id']='front1';rows[-1]['weather_episode_id']='front1'
  with self.assertRaises(ValueError):model.split_rows(rows,'2020-07-01T00:00:00+09:00','2020-10-01T00:00:00+09:00')
 def test_tsurushi_unknown(self):
  r=self.rows()[0];r['label']='TSURUSHI';self.assertIsNone(model.label_target(r))
 def test_five_minutes_is_not_more_than_five(self):
  r=self.rows()[0];r.update(label='CAP_DETACHED',duration_minutes=5)
  with self.assertRaises(ValueError):model.label_target(r)
 def test_missing_imputer_uses_training_only(self):
  rows=self.rows();rows[0]['features']['z_rhmax_minus_summit']=None
  expected=__import__('numpy').nanmedian([r['features']['z_rhmax_minus_summit'] if r['features']['z_rhmax_minus_summit'] is not None else float('nan') for r in rows[:182]])
  rows[-1]['features']['z_rhmax_minus_summit']=999999
  m=model.train(rows,'2020-07-01T00:00:00+09:00','2020-10-01T00:00:00+09:00')
  self.assertAlmostEqual(m['imputation_medians'][1],expected)
 def test_future_forecast_rejected(self):
  r=self.rows()[0];r['available_at']='2040-01-01T00:00:00Z'
  with self.assertRaises(ValueError):model.validate_forecast(r)
 def test_contradictory_label_rejected(self):
  r=self.rows()[0];r.update(label='NO_CAP',cap_present=True)
  with self.assertRaises(ValueError):model.label_target(r)
 def test_flat_peak_matches_collector(self):
  levels=[dict(z_m=z,pressure_hpa=p,temperature_c=t,rh_pct=100,u_ms=10,v_ms=10) for z,p,t in [(1500,850,15),(3000,700,0),(4300,600,-7),(5600,500,-14)]]
  f=model.features(dict(levels=levels,valid_at='2026-09-14T01:00:00Z'))
  self.assertIsNone(f['z_rhmax_minus_summit']);self.assertTrue(f['moist_peak_ambiguous'])
if __name__=='__main__':unittest.main()
