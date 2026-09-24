import unittest,tempfile,importlib.util,io
from pathlib import Path
from unittest.mock import patch
from PIL import Image
p=Path(__file__).resolve().parents[1]/'camera-images.py'
if not p.exists():p=Path(__file__).with_name('camera-images.py')
spec=importlib.util.spec_from_file_location('camera_images',p);camera=importlib.util.module_from_spec(spec);spec.loader.exec_module(camera)
class CameraTests(unittest.TestCase):
 def test_bound_and_no_overwrite(self):
  with tempfile.TemporaryDirectory() as d:
   with self.assertRaises(ValueError):camera.inventory('2026-09-14',d,16)
 def test_capture_limit_and_evidence(self):
  b=io.BytesIO();Image.new('RGB',(2,2)).save(b,'JPEG')
  html=''.join(f'<a href="/livehistory/26/09/14/{h:02}.jpg">image</a>' for h in range(5,20)).encode()
  def get(url):return b'User-agent: *\nAllow: /' if url.endswith('robots.txt') else html if 'fujiyama_history' in url else b.getvalue()
  with tempfile.TemporaryDirectory() as d,patch.object(camera,'get',side_effect=get),patch.object(camera.time,'sleep'):
   out=Path(d)/'run';r=camera.inventory('2026-09-14',out,3)
   self.assertEqual(r['downloaded_images'],3);self.assertEqual(len(list(out.glob('*.jpg'))),3)
   self.assertTrue(all(x['label']=='UNKNOWN' for x in r['rows']))
   with self.assertRaises(FileExistsError):camera.inventory('2026-09-14',out,3)
 def test_changed_page_stops(self):
  with self.assertRaises(ValueError):camera.parse_slots('<html>No images</html>')
if __name__=='__main__':unittest.main()
