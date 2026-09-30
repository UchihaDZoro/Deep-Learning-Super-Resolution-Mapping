"""TRINETRA-SR live engine.

FastAPI app that serves the web viewer (docs/) and runs super-resolution jobs
on demand: pick any point on Earth -> clearest Sentinel-2 L2A window ->
10 m to 2.5 m SR + uncertainty + consistency metrics + GeoTIFF downloads.

Run locally:  uvicorn server.app:app --port 7860
"""
import io
import json
import os
import shutil
import sys
import threading
import time
import traceback
import uuid
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import rasterio
import torch
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "prototype"))
import run_sr  # noqa: E402

RESULTS = Path(os.environ.get("RESULTS_DIR", "/tmp/trinetra_results"))
RESULTS.mkdir(parents=True, exist_ok=True)
MAX_QUEUE = 6
JOB_TTL_S = 3 * 3600

torch.set_num_threads(max(1, os.cpu_count() or 1))
DEVICE = torch.device(os.environ.get("SR_DEVICE", "cpu"))
MODEL = run_sr.load_model(DEVICE)
POOL = ThreadPoolExecutor(max_workers=1)   # one job at a time: CPU-bound
JOBS: dict[str, dict] = {}
LOCK = threading.Lock()

app = FastAPI(title="TRINETRA-SR live engine")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ---------------------------------------------------------------- jobs
class JobRequest(BaseModel):
    lat: float = Field(ge=-85, le=85)
    lon: float = Field(ge=-180, le=180)
    start: date | None = None
    end: date | None = None
    size: int = Field(128, description="input edge in 10 m pixels (128, 192 or 256)")
    tta: int = Field(4, ge=2, le=8, description="uncertainty passes")


def _update(jid, **kw):
    with LOCK:
        JOBS[jid].update(kw)


def _log(jid, msg):
    with LOCK:
        JOBS[jid]["log"].append(msg)


def _pending():
    with LOCK:
        return sum(j["status"] in ("queued", "running") for j in JOBS.values())


def _cleanup():
    now = time.time()
    with LOCK:
        old = [k for k, j in JOBS.items() if now - j["created"] > JOB_TTL_S]
        for k in old:
            JOBS.pop(k, None)
    for k in old:
        shutil.rmtree(RESULTS / k, ignore_errors=True)


def _finish(jid, X, meta, name, extra):
    def progress(i, n):
        _update(jid, progress=0.35 + 0.55 * i / n, stage=f"Super-resolving · pass {i}/{n}")

    t0 = time.time()
    sr, std = run_sr.super_resolve(MODEL, X, DEVICE, n_tta=JOBS[jid]["tta"], progress=progress)
    _update(jid, progress=0.92, stage="Computing metrics & exporting GeoTIFFs")
    d = RESULTS / jid
    m = run_sr.render(X, meta, sr, std, d, d, "trinetra")
    edge = X.shape[-1]
    result = dict(
        id=f"live-{jid}", name=extra.pop("name"), use=extra.pop("use"),
        scene=meta.get("scene", "uploaded"), date=meta.get("date", "—"),
        cloud=round(float(meta.get("cloud", 0)), 2), crs=meta["crs"],
        extent_km=round(edge * 10 / 1000, 2), metrics=m, base=f"results/{jid}/",
        downloads={
            "sr": f"results/{jid}/trinetra_sr_2p5m.tif",
            "uncertainty": f"results/{jid}/trinetra_uncertainty_2p5m.tif",
            "input": f"results/{jid}/trinetra_input_10m.tif",
        },
        runtime_s=round(time.time() - t0, 1), tta=JOBS[jid]["tta"], **extra)
    (d / "meta.json").write_text(json.dumps(result, indent=2))
    _update(jid, status="done", progress=1.0, stage="Done", result=result)


def _run_point(jid, req: JobRequest):
    try:
        _update(jid, status="running", progress=0.05, stage="Searching Sentinel-2 archive")
        aoi = dict(lat=req.lat, lon=req.lon, dates=f"{req.start}/{req.end}")
        X, meta = run_sr.fetch_s2(aoi, edge=req.size, log=lambda s: _log(jid, s))
        _log(jid, f"scene {meta['scene']} ({meta['date']}), clear={meta['clear']:.2f}")
        if float((X[[0, 1, 2, 6]].sum(0) == 0).mean()) > 0.2:
            raise RuntimeError("Location is at the edge of a Sentinel-2 tile (no-data). Move the point slightly.")
        _update(jid, progress=0.3, stage="Scene fetched")
        _finish(jid, X, meta, "trinetra", dict(
            name=f"Your pick · {req.lat:.4f}, {req.lon:.4f}", use="Live run on a location chosen by you",
            lat=req.lat, lon=req.lon, clear=round(meta["clear"], 3)))
    except Exception as e:
        traceback.print_exc()
        _update(jid, status="error", error=str(e), stage="Failed")


def _run_upload(jid, data: bytes, filename: str):
    try:
        _update(jid, status="running", progress=0.1, stage="Reading GeoTIFF")
        with rasterio.MemoryFile(data) as mf, mf.open() as src:
            if src.count not in (10, 12, 13):
                raise RuntimeError(f"Expected a 10-band Sentinel-2 stack (B2,B3,B4,B5,B6,B7,B8,B8A,B11,B12); "
                                   f"got {src.count} bands.")
            if abs(src.res[0] - 10) > 1 and src.crs and src.crs.is_projected:
                _log(jid, f"warning: pixel size {src.res[0]:.1f} (expected 10 m)")
            h, w = src.height, src.width
            e = min(256, h, w)
            r0, c0 = (h - e) // 2, (w - e) // 2
            win = rasterio.windows.Window(c0, r0, e, e)
            X = src.read(window=win).astype("float32")
            transform = src.window_transform(win)
            crs = str(src.crs) if src.crs else "unknown"
            count = src.count
        if count == 12:   # B1..B12 without B10
            X = X[[1, 2, 3, 4, 5, 6, 7, 8, 10, 11]]
        elif count == 13:  # B1..B12 incl. B10
            X = X[[1, 2, 3, 4, 5, 6, 7, 8, 11, 12]]
        if np.nanmax(X) > 2.0:          # digital numbers -> reflectance
            X = X / 10_000
        X = np.nan_to_num(np.clip(X, 0, 2)).astype("float32")
        if e < 64:
            raise RuntimeError("Image too small (need at least 64×64 pixels).")
        meta = dict(crs=crs, transform=transform, scene=filename, date="uploaded", cloud=0)
        _update(jid, progress=0.3, stage="GeoTIFF loaded")
        _finish(jid, X, meta, "trinetra", dict(name=f"Upload · {filename[:40]}",
                                               use="Your own Sentinel-2 GeoTIFF"))
    except Exception as e:
        traceback.print_exc()
        _update(jid, status="error", error=str(e), stage="Failed")


def _new_job(kind, tta):
    _cleanup()
    if _pending() >= MAX_QUEUE:
        raise HTTPException(503, "Engine is busy. Please try again in a minute.")
    jid = uuid.uuid4().hex[:12]
    with LOCK:
        JOBS[jid] = dict(id=jid, kind=kind, status="queued", progress=0.0, stage="Queued",
                         log=[], created=time.time(), tta=tta, result=None, error=None)
    return jid


@app.get("/api/health")
def health():
    return dict(ok=True, device=str(DEVICE), threads=torch.get_num_threads(), pending=_pending())


@app.post("/api/jobs")
def create_job(req: JobRequest):
    if req.size not in (128, 192, 256):
        raise HTTPException(400, "size must be 128, 192 or 256")
    today = date.today()
    req.end = req.end or today
    req.start = req.start or (req.end - timedelta(days=365))
    if req.start >= req.end:
        raise HTTPException(400, "start date must be before end date")
    jid = _new_job("point", req.tta)
    POOL.submit(_run_point, jid, req)
    return {"id": jid, "position": _pending()}


@app.post("/api/upload")
async def upload(file: UploadFile = File(...), tta: int = 4):
    data = await file.read()
    if len(data) > 60 * 1024 * 1024:
        raise HTTPException(413, "File too large (max 60 MB).")
    jid = _new_job("upload", max(2, min(8, tta)))
    POOL.submit(_run_upload, jid, data, file.filename or "upload.tif")
    return {"id": jid, "position": _pending()}


@app.get("/api/jobs/{jid}")
def job_status(jid: str):
    with LOCK:
        j = JOBS.get(jid)
        if not j:
            raise HTTPException(404, "job not found (it may have expired)")
        return JSONResponse({k: v for k, v in j.items() if k != "created"})


app.mount("/results", StaticFiles(directory=RESULTS), name="results")
app.mount("/", StaticFiles(directory=ROOT / "docs", html=True), name="site")
