"""Recompute metrics from saved GeoTIFFs (no re-inference) and update site meta."""
import json

import numpy as np
import rasterio
import torch
import torch.nn.functional as F

from run_sr import OUT, SCALE, SITE, compute_metrics


def read(p):
    with rasterio.open(p) as src:
        return src.read().astype("float32") / 10_000


index = SITE / "data" / "index.json"
entries = json.loads(index.read_text())
for e in entries:
    X = read(OUT / f"{e['id']}_input_10m.tif")
    sr = read(OUT / f"{e['id']}_sr_2p5m.tif")
    unc = read(OUT / f"{e['id']}_uncertainty_2p5m.tif")
    bic = F.interpolate(torch.from_numpy(X)[None], scale_factor=SCALE, mode="bicubic",
                        align_corners=False).squeeze(0).numpy()
    e["metrics"] = compute_metrics(X, sr, bic, unc)
    (SITE / "data" / e["id"] / "meta.json").write_text(json.dumps(e, indent=2))
    print(e["id"], e["metrics"])
index.write_text(json.dumps(entries, indent=2))
