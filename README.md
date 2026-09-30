# TRINETRA-SR: Trustworthy Super-Resolution for Sentinel-2
**Smart India Hackathon · PS 26142 (NTRO): Deep Learning Based Super Resolution Mapping from Medium Resolution Satellite Imagery**

Prototype v1 turns Sentinel-2 L2A imagery at **10 m into 2.5 m** (4×). Every output comes with:
- a **per-pixel uncertainty map** (8-fold dihedral test-time ensemble),
- a **radiometric consistency check**: the SR output is degraded back to 10 m and compared with the input (PSNR, spectral angle, NDVI deviation),
- **all 10 bands** at 2.5 m (VNIR + red-edge + SWIR), exported as GeoTIFF in the original CRS.

## Structure
```
prototype/run_sr.py   fetch → super-resolve → uncertainty → metrics → export
prototype/outputs/    2.5 m GeoTIFFs (SR, uncertainty) + 10 m inputs
site/                 static web demo (swipe viewer, uncertainty overlay, NDVI, metrics)
IMPLEMENTATION_PLAN.md full roadmap (v2: multi-temporal fusion, diffusion refiner, conformal calibration, downstream validation)
```

## Run
```bash
py -3.11 -m venv .venv
.venv\Scripts\pip install torch torchvision --index-url https://download.pytorch.org/whl/cu121
.venv\Scripts\pip install sen2sr mlstac git+https://github.com/ESDS-Leipzig/cubo.git planetary-computer pystac-client rasterio matplotlib pillow
.venv\Scripts\python prototype\run_sr.py
cd site && python -m http.server 8000
```

## Credits
Contains modified Copernicus Sentinel data, accessed via Microsoft Planetary Computer. The v1 inference engine is the SEN2SR-Lite baseline network (ESA OpenSR). The trust layer, consistency validation, pipeline and viewer were built by the team.
