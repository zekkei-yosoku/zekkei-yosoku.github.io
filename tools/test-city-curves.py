"""Regression checks for source anchors, crown continuity and roof-fixture limits."""
import importlib.util
from pathlib import Path
import unittest
import numpy as np

spec=importlib.util.spec_from_file_location('city_refinement',Path(__file__).with_name('refine-city-models.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class CrownTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.model=module.BASE['azabudai-hills']
        cls.curve=module.CrownCurve(cls.model)

    def test_source_anchors_are_preserved(self):
        for point in self.curve.ring:
            np.testing.assert_allclose(self.curve(point),point,atol=1e-8,rtol=0)

    def test_periodic_plan_tangents_match(self):
        derivative=self.curve.xy.derivative()
        np.testing.assert_allclose(derivative(0),derivative(self.curve.s[-1]),atol=1e-12,rtol=0)

    def test_crown_wings_do_not_overshoot_or_reverse(self):
        c=self.curve
        for i,(curve,start) in c.height.items():
            z=curve(np.linspace(start,start+c.length[i],129))
            a,b=c.ring[i,2],c.ring[(i+1)%len(c.ring),2]
            self.assertGreaterEqual(float(z.min()),min(a,b)-1e-8)
            self.assertLessEqual(float(z.max()),max(a,b)+1e-8)
            self.assertTrue(np.all(np.diff(z)>=-1e-8) if b>a else np.all(np.diff(z)<=1e-8))

    def test_crown_crests_have_flat_join_tangents(self):
        seen=set()
        for curve,start in self.curve.height.values():
            if id(curve) in seen:continue
            seen.add(id(curve));crest=0 if curve(0)>curve(curve.x[-1]) else curve.x[-1]
            self.assertAlmostEqual(float(curve.derivative()(crest)),0,places=10)

    def test_highest_equipment_is_unchanged(self):
        maximum=max(p[2] for p in self.model['vertices'])
        for point in self.model['vertices']:
            if point[2]==maximum:np.testing.assert_allclose(self.curve(point),point,atol=1e-10,rtol=0)


if __name__=='__main__':unittest.main()
