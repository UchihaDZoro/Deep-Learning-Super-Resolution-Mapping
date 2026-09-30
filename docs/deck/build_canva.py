"""Make a self-contained copy of the deck for Canva's HTML importer.

Canva's importer does not fetch linked images and mis-places loose text beside
icons, so this wraps loose text in spans and inlines every image as a data URI.
python build_canva.py  ->  index_canva.html
"""
import base64
import io
import re
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
s = (HERE / "index.html").read_text(encoding="utf-8")
s = re.sub(r'(</span>|<img [^>]*>)([^<>\n]*[A-Za-z0-9][^<>\n]*?)(</div>)', r'\1<span>\2</span>\3', s)

cache = {}


def data_uri(rel):
    if rel not in cache:
        im = Image.open(HERE / rel)
        buf = io.BytesIO()
        if rel.endswith(".jpg"):
            im = im.convert("RGB"); im.thumbnail((420, 420)); im.save(buf, "JPEG", quality=88); mime = "image/jpeg"
        else:
            im.thumbnail((900, 900) if "sih_" in rel else (128, 128)); im.save(buf, "PNG", optimize=True); mime = "image/png"
        cache[rel] = f"data:{mime};base64," + base64.b64encode(buf.getvalue()).decode()
    return cache[rel]


s = re.sub(r'src="(img/[^"]+)"', lambda m: f'src="{data_uri(m.group(1))}"', s)
(HERE / "index_canva.html").write_text(s, encoding="utf-8")
print(f"index_canva.html · {len(cache)} images inlined · {len(s) // 1024} KB")
