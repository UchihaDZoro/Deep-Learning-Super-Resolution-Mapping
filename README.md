---
title: TRINETRA-SR
emoji: 🛰️
colorFrom: yellow
colorTo: green
sdk: docker
app_port: 7860
pinned: false
short_description: Sentinel-2 10 m to 2.5 m super-resolution with trust maps
---

# TRINETRA-SR: Trustworthy Super-Resolution for Sentinel-2
**Smart India Hackathon · PS 26142 (NTRO): Deep Learning Based Super Resolution Mapping from Medium Resolution Satellite Imagery**

Prototype v1 turns Sentinel-2 L2A imagery at **10 m into 2.5 m** (4×). Every output comes with:
- a **per-pixel uncertainty map** (8-fold dihedral test-time ensemble),
- a **radiometric consistency check**: the SR output is degraded back to 10 m and compared with the input (PSNR, spectral angle, NDVI deviation),
- **all 10 bands** at 2.5 m (VNIR + red-edge + SWIR), exported as GeoTIFF in the original CRS.

**Live engine, running entirely in the browser:** pick any location on the map (or upload a 10-band Sentinel-2 GeoTIFF). `docs/engine.js` searches Earth Search, checks clouds with the SCL band, reads just the needed window from the Sentinel-2 COGs on AWS, and runs the SR network locally with ONNX Runtime Web (WebGPU if it validates, otherwise WebAssembly). It then computes the uncertainty and metrics and writes GeoTIFFs. There is no server, nothing is uploaded, and it can be hosted on any static host.

The ONNX model (`docs/model/sen2sr_lite.onnx`) is exported by `prototype/export_onnx.py`. The FFT low-pass hard constraint and the antialiased resampling are rewritten as exact matrix products (parity with PyTorch: 9e-7). `server/app.py` + `Dockerfile` provide an optional server/on-prem deployment of the same pipeline.

## Structure
```
prototype/run_sr.py   fetch → super-resolve → uncertainty → metrics → export
prototype/outputs/    2.5 m GeoTIFFs (SR, uncertainty) + 10 m inputs
docs/                 static web demo (swipe viewer, uncertainty overlay, NDVI, metrics)
IMPLEMENTATION_PLAN.md full roadmap (v2: multi-temporal fusion, diffusion refiner, conformal calibration, downstream validation)
```

## Run
```bash
py -3.11 -m venv .venv
.venv\Scripts\pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
.venv\Scripts\pip install sen2sr mlstac git+https://github.com/ESDS-Leipzig/cubo.git planetary-computer pystac-client rasterio matplotlib pillow
.venv\Scripts\python prototype\run_sr.py
.venv\Scripts\pip install fastapi uvicorn[standard] python-multipart
.venv\Scripts\python -m uvicorn server.app:app --port 7860   # full app with live engine
```

## Credits
Contains modified Copernicus Sentinel data, accessed via Microsoft Planetary Computer. The v1 inference engine is the SEN2SR-Lite baseline network (ESA OpenSR). The trust layer, consistency validation, pipeline and viewer were built by the team.
