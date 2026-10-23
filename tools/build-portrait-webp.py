"""Generate lightweight display derivatives from the retained original PNG artwork.
Requires Pillow; run from any directory. Moon projection/light calculations remain in JS.
"""
from pathlib import Path
from PIL import Image
root = Path(__file__).resolve().parent.parent
for body in ("moon", "sun"):
    image = Image.open(root / f"almanac-{body}-surface-v1.png")
    if body == "moon":
        bbox = image.getchannel("A").point(lambda v: 255 if v > 200 else 0).getbbox()
        image = image.crop(bbox).resize((512, 512), Image.Resampling.LANCZOS)
    target = root / f"almanac-{body}-surface-v2.webp"
    image.save(target, "WEBP", quality=96, method=6)
    print(target.name, target.stat().st_size)
