"""Replace the slide-6 reference block with linked references in four domains."""
from pathlib import Path

p = Path(__file__).with_name("index.html")
lines = p.read_text(encoding="utf-8").split("\n")
start = next(i for i, l in enumerate(lines) if "REFERENCES BY DOMAIN" in l)
end = next(i for i, l in enumerate(lines) if "<!-- resources -->" in l)

COLS = [
    ("SUPER-RESOLUTION", "var(--blue)", "#CFE0FB", [
        ("[1] Aybar et al. 2025 · SEN2SR, Remote Sens. Environ.", "https://www.sciencedirect.com/science/article/pii/S0034425725006261"),
        ("[2] Wan et al. 2024 · SPAN attention SR", "https://arxiv.org/abs/2311.12770"),
        ("[3] Liang et al. 2021 · SwinIR", "https://arxiv.org/abs/2108.10257"),
        ("[4] Wang et al. 2018 · ESRGAN", "https://arxiv.org/abs/1809.00219"),
        ("[5] Yue et al. 2023 · ResShift diffusion SR", "https://arxiv.org/abs/2307.12348"),
        ("[6] Donike et al. 2025 · latent-diffusion S2 SR", "https://www.semanticscholar.org/paper/27fa48af71d55c671c498649b5a65d57fbed13f4"),
        ("[7] DiffFuSR 2025 · all-band S2 SR", "https://arxiv.org/abs/2506.11764"),
    ]),
    ("DATA &amp; BENCHMARKS", "var(--saff)", "#F9D7B3", [
        ("[8] Deudon et al. 2020 · HighRes-net", "https://arxiv.org/abs/2002.06460"),
        ("[9] Aybar et al. 2024 · SEN2NAIP, Sci. Data", "https://www.nature.com/articles/s41597-024-04214-y"),
        ("[10] Cornebise et al. 2022 · WorldStrat", "https://arxiv.org/abs/2207.06418"),
        ("[11] MuS2 2023 · multi-image S2 SR, Sci. Data", "https://www.nature.com/articles/s41597-023-02538-9"),
        ("[12] ESA OpenSR · opensr-test benchmark", "https://github.com/ESAOpenSR/opensr-test"),
        ("[13] GeoSR-Bench 2026 · downstream-task SR", "https://arxiv.org/abs/2605.00310"),
    ]),
    ("UNCERTAINTY &amp; TOOLS", "var(--green)", "#BFE3C9", [
        ("[14] Lakshminarayanan et al. 2017 · deep ensembles", "https://arxiv.org/abs/1612.01474"),
        ("[15] Wang et al. 2019 · TTA uncertainty", "https://arxiv.org/abs/1807.07356"),
        ("[16] Angelopoulos &amp; Bates 2021 · conformal prediction", "https://arxiv.org/abs/2107.07511"),
        ("[17] Element 84 · Earth Search STAC API", "https://earth-search.aws.element84.com/v1"),
        ("[18] ONNX Runtime Web · in-browser inference", "https://onnxruntime.ai"),
    ]),
    ("GOVERNMENT &amp; OFFICIAL", "var(--violet)", "#D9CFFF", [
        ("[19] ESA · Sentinel-2 mission", "https://www.esa.int/Applications/Observing_the_Earth/Copernicus/Sentinel-2"),
        ("[20] EU Copernicus · Data Space Ecosystem", "https://dataspace.copernicus.eu"),
        ("[21] ISRO–NRSC · Bhuvan geoportal", "https://bhuvan.nrsc.gov.in"),
        ("[22] NRSC · Bhoonidhi EO data hub", "https://bhoonidhi.nrsc.gov.in"),
        ("[23] DST / Survey of India · National Geospatial Policy 2022", "https://surveyofindia.gov.in/pages/national-geospatial-policy-2022"),
        ("[24] NDMA · disaster &amp; landslide guidelines", "https://ndma.gov.in"),
        ("[25] ISRO · Cartosat earth-observation missions", "https://www.isro.gov.in"),
    ]),
]

out = ['  <div class="abs" style="left:52px;top:586px;display:flex;align-items:center;gap:12px"><span class="ic sm" style="background:var(--blue)"><img src="img/ic/book.png" alt=""></span><div style="font:800 20px Montserrat, Arial, sans-serif;color:var(--navy)">REFERENCES BY DOMAIN · click any entry to open it</div></div>',
       '  <div class="abs" style="left:52px;top:628px;width:1240px;display:flex;gap:12px">']
for title, col, border, items in COLS:
    links = "".join(f'<a href="{u}" style="display:block;font:500 14.5px/1.35 Inter, Arial, sans-serif;color:#1B4FA8;text-decoration:none;margin-bottom:6px">{t}</a>' for t, u in items)
    out.append(f'    <div style="flex:1;border:2px solid {border};border-radius:16px;padding:12px 14px;height:352px"><div style="font:800 15px Inter, Arial, sans-serif;color:{col};margin-bottom:8px">{title}</div>{links}</div>')
out.append("  </div>")
out.append("")
lines[start:end] = out
p.write_text("\n".join(lines), encoding="utf-8")
print("replaced lines", start, "to", end)
