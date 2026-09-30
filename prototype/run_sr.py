"""TRINETRA-SR prototype v1.

Fetch cloud-free Sentinel-2 L2A for Indian AOIs, super-resolve 10 m -> 2.5 m,
estimate per-pixel uncertainty (8-fold dihedral test-time augmentation),
verify radiometric consistency, and export assets for the web viewer.

Usage:  python run_sr.py            (all AOIs)
        python run_sr.py bengaluru  (one AOI)
"""
import json
import os
import sys
from pathlib import Path

import matplotlib
import numpy as np
import planetary_computer as pc
import pystac_client
import rasterio
import torch
import torch.nn.functional as F
from PIL import Image
from rasterio.enums import Resampling
from rasterio.transform import Affine
from rasterio.warp import transform as warp_transform
from rasterio.windows import Window

import mlstac
import sen2sr

ROOT = Path(__file__).resolve().parent
SITE = ROOT.parent / "docs"
OUT = ROOT / "outputs"
MODEL_DIR = ROOT / "model" / "SEN2SRLite"

BANDS = ["B02", "B03", "B04", "B05", "B06", "B07", "B08", "B8A", "B11", "B12"]
EDGE = 256          # input window in 10 m pixels (2.56 km)
SCALE = 4           # 10 m -> 2.5 m
UNC_MAX = 0.02      # reflectance std mapped to top of colour scale

AOIS = [
    dict(id="bengaluru", name="Bengaluru — dense urban", lat=12.9716, lon=77.5946,
         dates="2024-01-01/2024-03-31", use="Urban mapping: small buildings, narrow roads"),
    dict(id="punjab", name="Ludhiana, Punjab — smallholder farms", lat=30.8700, lon=75.7900,
         dates="2024-02-01/2024-03-31", use="Crop monitoring: field boundaries, NDVI at 2.5 m"),
    dict(id="mumbai", name="Mumbai — port & informal settlements", lat=19.0400, lon=72.8550,
         dates="2024-01-01/2024-03-31", use="Urban & coastal: dense settlements, water edges"),
    dict(id="wayanad", name="Wayanad, Kerala — 2024 landslide", lat=11.4750, lon=76.1350,
         dates="2024-12-01/2025-03-31", use="Disaster assessment: landslide scar & debris path"),
    dict(id="delhi_yamuna", name="Delhi — Yamuna floodplain", lat=28.6100, lon=77.2600,
         dates="2024-10-15/2024-12-31", use="Water & infrastructure: bridges, river edges"),
]


# ---------------------------------------------------------------- data access
def fetch_s2(aoi, edge=EDGE, min_clear=0.97, log=print):
    """Return (X[10,H,W] reflectance, meta) for the clearest scene in the window.

    Falls back to the clearest window found if none reaches `min_clear`."""
    EDGE = edge
    cat = pystac_client.Client.open(
        "https://planetarycomputer.microsoft.com/api/stac/v1", modifier=pc.sign_inplace)
    items = list(cat.search(
        collections=["sentinel-2-l2a"],
        intersects={"type": "Point", "coordinates": [aoi["lon"], aoi["lat"]]},
        datetime=aoi["dates"], query={"eo:cloud_cover": {"lt": 20}}).items())
    items.sort(key=lambda it: it.properties["eo:cloud_cover"])
    if not items:
        raise RuntimeError("No Sentinel-2 scene with <20% cloud found for this location and date range. "
                           "Try a wider date range or a dry-season window.")
    best = None

    for item in items[:8]:
        with rasterio.open(item.assets["B04"].href) as ref:
            xs, ys = warp_transform("EPSG:4326", ref.crs, [aoi["lon"]], [aoi["lat"]])
            r, c = ref.index(xs[0], ys[0])
            win = Window(c - EDGE // 2, r - EDGE // 2, EDGE, EDGE)
            transform = ref.window_transform(win)
            crs = ref.crs

        # cloud check with the scene classification layer (20 m)
        with rasterio.open(item.assets["SCL"].href) as src:
            scl = src.read(1, window=Window(win.col_off / 2, win.row_off / 2, EDGE / 2, EDGE / 2),
                           out_shape=(EDGE, EDGE), resampling=Resampling.nearest)
        clear = np.isin(scl, [4, 5, 6, 7, 11]).mean()   # veg, bare, water, unclassified, snow
        if clear < min_clear:
            log(f"skip {item.id[:38]}: clear={clear:.2f}")
            if best is None or clear > best[1]:
                best = (item, clear, win, transform, crs)
            continue
        return _read_window(item, clear, win, transform, crs, EDGE)
    if best and best[1] >= 0.6:
        log(f"using clearest available window (clear={best[1]:.2f})")
        return _read_window(*best, EDGE)
    raise RuntimeError("No sufficiently cloud-free window found (clouds or no-data). "
                       "Try another date range.")


def _read_window(item, clear, win, transform, crs, edge):
    stack = []
    for b in BANDS:
        with rasterio.open(item.assets[b].href) as src:
            f = src.res[0] / 10.0                      # 1 for 10 m bands, 2 for 20 m
            w = Window(win.col_off / f, win.row_off / f, edge / f, edge / f)
            stack.append(src.read(1, window=w, out_shape=(edge, edge), boundless=True, fill_value=0,
                                  resampling=Resampling.bilinear).astype("float32"))
    X = np.stack(stack)
    # harmonise processing baseline >= 04.00 (+1000 DN offset since Jan 2022)
    if float(item.properties.get("s2:processing_baseline", "0")) >= 4.0:
        X = np.clip(X - 1000, 0, None)
    X /= 10_000
    meta = dict(scene=item.id, date=item.datetime.strftime("%Y-%m-%d"),
                cloud=item.properties["eo:cloud_cover"], clear=float(clear),
                crs=str(crs), transform=transform)
    return X, meta


# ---------------------------------------------------------------- model
def load_model(device):
    if not (MODEL_DIR / "mlm.json").exists():
        mlstac.download(
            file="https://huggingface.co/tacofoundation/sen2sr/resolve/main/SEN2SRLite/main/mlm.json",
            output_dir=str(MODEL_DIR))
    return mlstac.load(str(MODEL_DIR)).compiled_model(device=device).to(device).eval()


def dihedral(x, k, flip):
    x = torch.rot90(x, k, dims=(-2, -1))
    return torch.flip(x, dims=(-1,)) if flip else x


def undihedral(x, k, flip):
    x = torch.flip(x, dims=(-1,)) if flip else x
    return torch.rot90(x, -k, dims=(-2, -1))


TILE, OVERLAP = 128, 32


def _starts(n):
    if n <= TILE:
        return [0]
    s = list(range(0, n - TILE, TILE - OVERLAP))
    return s + [n - TILE]


@torch.no_grad()
def predict_tiled(model, x):
    """Run the 128 px model over a (C,H,W) image of any size >= 64, feather-blending overlaps."""
    c, h, w = x.shape
    ph, pw = max(0, TILE - h), max(0, TILE - w)
    if ph or pw:  # small inputs: reflect-pad up to one tile
        x = F.pad(x[None], (0, pw, 0, ph), mode="reflect")[0]
    H, W = x.shape[-2:]
    ramp = torch.ones(TILE * SCALE)
    fr = OVERLAP * SCALE
    ramp[:fr] = torch.linspace(0.05, 1, fr)
    ramp[-fr:] = torch.linspace(1, 0.05, fr)
    wt = ramp[:, None] * ramp[None, :]
    out = torch.zeros(c, H * SCALE, W * SCALE)
    acc = torch.zeros(1, H * SCALE, W * SCALE)
    for r in _starts(H):
        for q in _starts(W):
            y = model(x[None, :, r:r + TILE, q:q + TILE]).squeeze(0).float().cpu()
            sl = (slice(None), slice(r * SCALE, (r + TILE) * SCALE), slice(q * SCALE, (q + TILE) * SCALE))
            out[sl] += y * wt
            acc[sl] += wt
    return (out / acc)[:, :h * SCALE, :w * SCALE]


@torch.no_grad()
def super_resolve(model, X, device, n_tta=8, progress=None):
    """Return (mean SR, per-pixel std) from `n_tta` dihedral TTA passes (1-8)."""
    x = torch.from_numpy(X).to(device)
    x = torch.nan_to_num(x)
    outs = []
    # ordered so that any prefix mixes rotations and flips
    order = [(0, False), (2, True), (1, False), (3, True), (2, False), (0, True), (3, False), (1, True)]
    passes = order[:max(1, min(8, n_tta))]
    for i, (k, flip) in enumerate(passes):
        y = predict_tiled(model, dihedral(x, k, flip))
        outs.append(undihedral(y, k, flip).float().cpu())
        if device.type == "cuda":
            torch.cuda.empty_cache()
        if progress:
            progress(i + 1, len(passes))
    stack = torch.stack(outs)
    std = stack.std(0, correction=0)
    return stack.mean(0).numpy(), std.numpy()


# ---------------------------------------------------------------- metrics
def psnr(a, b, peak=1.0):
    mse = float(np.mean((a - b) ** 2))
    return 99.0 if mse == 0 else 10 * np.log10(peak ** 2 / mse)


def sam_deg(a, b):
    num = (a * b).sum(0)
    den = np.linalg.norm(a, axis=0) * np.linalg.norm(b, axis=0) + 1e-8
    return float(np.degrees(np.arccos(np.clip(num / den, -1, 1))).mean())


def ndvi(x):  # bands: B04 idx 2, B08 idx 6
    return (x[6] - x[2]) / (x[6] + x[2] + 1e-6)


def grad_energy(img):
    gy, gx = np.gradient(img)
    return float(np.mean(np.hypot(gx, gy)))


B10 = [0, 1, 2, 6]            # B02 B03 B04 B08: observed at 10 m
B20 = [3, 4, 5, 7, 8, 9]      # red-edge, B8A, SWIR: observed at 20 m


def pool(x, f):
    return F.avg_pool2d(torch.from_numpy(np.ascontiguousarray(x))[None], f).squeeze(0).numpy()


def compute_metrics(X, sr, bic, unc):
    """Consistency is checked at each band's *native* resolution: SR degraded to 10 m
    for the 10 m bands, to 20 m for the 20 m bands (the 20 m input was interpolated)."""
    d10, x10 = pool(sr[B10], SCALE), X[B10]
    d20, x20 = pool(sr[B20], SCALE * 2), pool(X[B20], 2)
    down = pool(sr, SCALE)
    rgb_sr, rgb_bic = sr[[2, 1, 0]].mean(0), bic[[2, 1, 0]].mean(0)
    return dict(
        consistency_psnr_db=round(float(psnr(d10, x10)), 2),
        consistency_psnr_20m_db=round(float(psnr(d20, x20)), 2),
        consistency_mae=round(float(np.abs(d10 - x10).mean()), 5),
        spectral_angle_deg=round(sam_deg(d10, x10), 3),
        spectral_angle_20m_deg=round(sam_deg(d20, x20), 3),
        ndvi_mae=round(float(np.abs(ndvi(down) - ndvi(X)).mean()), 4),
        ndvi_mean_in=round(float(ndvi(X).mean()), 3),
        ndvi_mean_sr=round(float(ndvi(sr).mean()), 3),
        sharpness_gain_vs_bicubic=round(grad_energy(rgb_sr) / grad_energy(rgb_bic), 2),
        mean_uncertainty=round(float(unc[[2, 1, 0]].mean()), 5),
        high_uncertainty_pct=round(float((unc[[2, 1, 0]].mean(0) > UNC_MAX / 2).mean() * 100), 2),
    )


# ---------------------------------------------------------------- rendering
def to_rgb8(x, lo, hi):
    rgb = x[[2, 1, 0]].transpose(1, 2, 0)
    rgb = np.clip((rgb - lo) / (hi - lo), 0, 1) ** (1 / 1.2)
    return (rgb * 255).astype("uint8")


def save_jpg(arr, path, size=None, nearest=False):
    im = Image.fromarray(arr)
    if size:
        im = im.resize((size, size), Image.NEAREST if nearest else Image.BICUBIC)
    im.save(path, quality=90)


def save_cmap(field, path, vmin, vmax, cmap, alpha=False):
    norm = np.clip((field - vmin) / (vmax - vmin), 0, 1)
    rgba = (matplotlib.colormaps[cmap](norm) * 255).astype("uint8")
    if alpha:
        rgba[..., 3] = (np.clip(norm * 1.4, 0, 1) * 235).astype("uint8")
        Image.fromarray(rgba).save(path.with_suffix(".png"), optimize=True)
    else:
        Image.fromarray(rgba[..., :3]).save(path.with_suffix(".jpg"), quality=90)


def write_geotiff(arr, meta, path, scale):
    t = meta["transform"]
    transform = Affine(t.a / scale, t.b, t.c, t.d, t.e / scale, t.f)
    data = np.clip(arr * 10_000, 0, 65535).astype("uint16")
    with rasterio.open(path, "w", driver="GTiff", height=data.shape[1], width=data.shape[2],
                       count=data.shape[0], dtype="uint16", crs=meta["crs"], transform=transform,
                       compress="deflate", tiled=True) as dst:
        dst.write(data)
        dst.descriptions = tuple(BANDS[: data.shape[0]])


# ---------------------------------------------------------------- main
def render(X, meta, sr, std, d, geotiff_dir=None, name="scene"):
    """Write viewer assets (and optionally GeoTIFFs) for one scene; return metrics."""
    edge = X.shape[-1]
    bic = F.interpolate(torch.from_numpy(X)[None], scale_factor=SCALE, mode="bicubic",
                        align_corners=False).squeeze(0).numpy()
    m = compute_metrics(X, sr, bic, std)

    d.mkdir(parents=True, exist_ok=True)
    lo, hi = np.percentile(X[[2, 1, 0]], 1), np.percentile(X[[2, 1, 0]], 99)
    hi = max(hi, lo + 1e-3)
    save_jpg(to_rgb8(X, lo, hi), d / "input.jpg", edge * SCALE, nearest=True)
    save_jpg(to_rgb8(bic, lo, hi), d / "bicubic.jpg")
    save_jpg(to_rgb8(sr, lo, hi), d / "sr.jpg")
    save_cmap(std[[2, 1, 0]].mean(0), d / "uncertainty", 0, UNC_MAX, "inferno", alpha=True)
    save_cmap(np.kron(ndvi(X), np.ones((SCALE, SCALE))), d / "ndvi_input", -0.1, 0.8, "RdYlGn")
    save_cmap(ndvi(sr), d / "ndvi_sr", -0.1, 0.8, "RdYlGn")

    if geotiff_dir is not None:
        geotiff_dir.mkdir(parents=True, exist_ok=True)
        write_geotiff(sr, meta, geotiff_dir / f"{name}_sr_2p5m.tif", SCALE)
        write_geotiff(std, meta, geotiff_dir / f"{name}_uncertainty_2p5m.tif", SCALE)
        write_geotiff(X, meta, geotiff_dir / f"{name}_input_10m.tif", 1)
    return m


def process(aoi, model, device):
    print(f"[{aoi['id']}] fetching Sentinel-2 ...")
    X, meta = fetch_s2(aoi)
    print(f"[{aoi['id']}] {meta['scene']} ({meta['date']}), super-resolving ...")
    sr, std = super_resolve(model, X, device)
    d = SITE / "data" / aoi["id"]
    m = render(X, meta, sr, std, d, OUT, aoi["id"])

    info = {k: v for k, v in aoi.items()}
    info.update(scene=meta["scene"], date=meta["date"], cloud=round(meta["cloud"], 2),
                crs=meta["crs"], extent_km=EDGE * 10 / 1000, metrics=m)
    (d / "meta.json").write_text(json.dumps(info, indent=2))
    print(f"[{aoi['id']}] done: {m}")
    return info


def main():
    device = torch.device(os.environ.get("SR_DEVICE", "cpu"))  # RTX 2050 driver fails on this model's kernels
    print("device:", device)
    model = load_model(device)
    wanted = sys.argv[1:]
    done = []
    for aoi in AOIS:
        if wanted and aoi["id"] not in wanted:
            continue
        try:
            done.append(process(aoi, model, device))
        except Exception as e:  # keep going for other AOIs
            print(f"[{aoi['id']}] FAILED: {e}")
    (SITE / "data").mkdir(parents=True, exist_ok=True)
    index = SITE / "data" / "index.json"
    existing = json.loads(index.read_text()) if index.exists() else []
    ids = {a["id"] for a in done}
    merged = [a for a in existing if a["id"] not in ids] + done
    order = [a["id"] for a in AOIS]
    merged.sort(key=lambda a: order.index(a["id"]) if a["id"] in order else 99)
    index.write_text(json.dumps(merged, indent=2))


if __name__ == "__main__":
    main()
