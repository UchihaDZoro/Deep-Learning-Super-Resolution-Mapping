# TRINETRA-SR: Technical Design Document
**SIH 2026 · PS 26142 (NTRO) · Team Sentinels_W (190286)**
Version 1.0 · Status of each component is marked **[v1]** (implemented, running in the prototype) or **[v2]** (designed, planned).

---

## 1. Objective
Transform Sentinel-2 L2A imagery from 10 m to 2.5 m ground sampling (4×) on all ten 10/20 m bands, so that:
1. **Fidelity:** geospatial and spectral consistency with the measured input is preserved.
2. **Detail:** sub-pixel structures (buildings, roads, bunds, scarps) become interpretable.
3. **Trust:** every output pixel carries an uncertainty estimate that separates observed from inferred detail.

## 2. Inputs and outputs
| | Specification |
|---|---|
| **Input** | Sentinel-2 L2A surface reflectance. 10 m: B2, B3, B4, B8. 20 m: B5, B6, B7, B8A, B11, B12 (resampled to the 10 m grid). Either an AOI point + date range (archive search) or an uploaded GeoTIFF (10, 12 or 13 bands). |
| **Pre-processing** | Scene ranking by SCL cloud-free fraction of the AOI window; processing-baseline ≥ 04.00 offset removal (−1000 DN); scaling to reflectance (÷10 000); windowed COG reads. |
| **Output** | 2.5 m 10-band GeoTIFF (source UTM CRS, reflectance ×10 000, uint16); 2.5 m uncertainty GeoTIFF (σ per band); validation metrics (JSON); comparison views (RGB, bicubic, NDVI). |

## 3. System architecture [v1]
```
                   ┌──────────────────────── Browser (client-side engine) ─────────────────────────┐
 Place search ───▶ │ UI (Three.js globe, Leaflet map, swipe viewer)                                │
 (Photon/OSM)      │   │                                                                            │
                   │   ▼                                                                            │
 Earth Search ◀──▶ │ STAC client ──▶ SCL cloud scoring ──▶ COG window reader (geotiff.js, proj4)   │
 STAC API          │                                              │                                 │
 AWS S3 COGs ◀───▶ │                                              ▼                                 │
                   │ Tiler (128 px, 32 px overlap, feathered) ─▶ ONNX Runtime Web (WASM / WebGPU*)  │
                   │   ▼                                                                            │
                   │ 8× dihedral TTA ─▶ mean + σ ─▶ metrics ─▶ renderer + GeoTIFF writer            │
                   └────────────────────────────────────────────────────────────────────────────────┘
 Offline / batch: Python · PyTorch · rasterio · Planetary Computer ─▶ ONNX export ─▶ static hosting
 On-prem option : FastAPI + Docker (same pipeline, air-gapped)       *WebGPU used only if it matches WASM output
```

## 4. Model
### 4.1 v1 network (pretrained baseline)
SEN2SR-Lite from ESA OpenSR (Aybar et al., 2025, *Remote Sensing of Environment*), CC0-1.0. We use the published weights; we did **not** retrain it in v1.

| Stage | Function | Architecture |
|---|---|---|
| A | B2/B3/B4/B8: 10 → 2.5 m | Lightweight CNN (re-parameterised conv blocks, 24 channels) + low-frequency hard constraint |
| B | 20 m bands → 10 m grid | Reference-guided ×2 CNN + hard constraint |
| C | 20 m bands → 2.5 m | SPAN (Swift Parameter-free Attention Network) fusing stage-B bands with stage-A RGBN + hard constraint |

Weights were trained by the OpenSR team on SEN2NAIPv2 (Sentinel-2 ↔ NAIP 2.5 m pairs; 2,851 cross-sensor pairs + 17,657 synthetic pairs), with CloudSEN12 scenes for SWIR.

**Low-frequency hard constraint.** For LR input *x* and network output *y*:
`ŷ = y + F⁻¹[ M ⊙ F(U(x) − y) ]`, where *F* is the 2-D DFT, *U* is antialiased bicubic up-sampling and *M* is a learned-shape low-pass mask. The low frequencies of ŷ are therefore those of the measurement; the network only adds high frequencies.

### 4.2 ONNX export for the browser [v1]
Neither `torch.fft` nor antialiased resize has an ONNX operator. We rewrote both exactly:
* Antialiased up-sampling becomes separable resampling matrices, computed from the original operator: `U(x) = Uh · x · Uwᵀ`.
* The FFT constraint becomes real DFT matrix products (12 matmuls). Rank-1 masks M = a·bᵀ collapse to `A · D · Bᵀ` (2 matmuls).

Parity with PyTorch: max |Δ| = 9 × 10⁻⁷. Model size: 19.3 MB. Latency: 0.58 s per 128×128 tile (1 CPU thread, native) and ≈1.5 s in WebAssembly.

### 4.3 v2 network design [v2]
* **Temporal attention front-end:** K ∈ {4…8} co-registered revisits → per-date shallow encoder → attention across time → fused features. The extra detail is then partly *observed* through sub-pixel shifts.
* **Backbone:** Swin/Mamba-style, 3–15 M parameters (OpenSR reports no gain above ~15 M).
* **PSF/MTF-consistent degradation:** per-band Gaussian PSF from the Sentinel-2 MTF specification replaces the generic low-pass in training and in the consistency layer.
* **Detail refiner:** residual diffusion / flow-matching head (4–15 steps) predicting only the high-frequency residual. Output `ŷ_λ = ŷ_fid + λ · r` with a user dial λ ∈ [0, 1] (Fidelity ↔ Detail).

## 5. Trust layer
| Component | Status | Method |
|---|---|---|
| Ensemble uncertainty | v1 | 8 dihedral transforms (4 rotations × flip); σ = per-pixel std of inverted outputs |
| Self-consistency validation | v1 | Degrade output to each band's native grid (avg-pool ×4 / ×8); PSNR, SAM, ΔNDVI vs input |
| Conformal calibration | v2 | Split-conformal on held-out HR pairs: q̂ = ⌈(n+1)(1−α)⌉/n quantile of \|y−ŷ\|/σ; interval ŷ ± q̂σ with coverage ≥ 1−α |
| Hallucination audit | v2 | Object detector on SR vs HR reference; count "phantom" objects; check they fall in high-σ regions |
| Observed vs inferred map | v2 | Multi-date agreement (observed) vs single-prior (inferred) labelling per pixel |

## 6. Validation
### 6.1 v1 measured results (self-consistency, 5 Indian study areas, TTA = 8)
| Metric | Min | Max | Mean | Target |
|---|---|---|---|---|
| PSNR, 10 m bands (dB) | 49.15 | 53.09 | 51.12 | > 40 |
| PSNR, 20 m bands (dB) | 34.73 | 39.98 | 36.84 | > 33 |
| Spectral angle, 10 m (°) | 0.23 | 0.62 | 0.48 | < 1.5 |
| Spectral angle, 20 m (°) | 1.51 | 2.02 | 1.77 | < 2.5 |
| NDVI MAE | 0.0033 | 0.0089 | 0.0066 | < 0.02 |
| Edge-energy gain vs bicubic | 1.14× | 1.21× | 1.17× | > 1.1× |
| Pixels with σ > 0.01 (%) | 0.00 | 0.19 | 0.05 | < 5 |

Sites: Bengaluru (13 Mar 2024), Ludhiana (12 Mar 2024), Mumbai (6 Feb 2024), Wayanad (24 Feb 2025), Delhi–Yamuna (30 Oct 2024). Browser and Python engines agree within 0.05 dB on identical scenes.

**Scope:** self-consistency proves that no measured information was altered. It does **not** prove that the reconstructed detail is correct.

### 6.2 v2 reference validation plan
* **OpenSR-test** (5 curated cross-sensor sets): consistency, synthesis and hallucination scores vs bicubic, SEN2SR and LDSR-S2.
* **SEN2NAIPv2 cross-sensor split:** PSNR, SSIM, LPIPS, SAM against true 2.5 m NAIP.
* **India reference set:** Cartosat / NRSC-provided tiles (requested via NTRO), 8–10 AOIs.
* **Downstream tasks:** building IoU and small-building recall, road completeness, field-boundary F1, water-edge accuracy, change-detection F1, each compared across 10 m, SR 2.5 m and real HR.

## 7. v2 training plan
| Stage | Data | Loss |
|---|---|---|
| Pre-train | SEN2NAIPv2 synthetic (17,657 pairs) + PSF-degraded HR | L1 + FFT + SAM |
| Fine-tune | SEN2NAIPv2 cross-sensor (2,851 pairs) + WorldStrat | shift-tolerant L1 + light LPIPS + edge |
| Domain adaptation | Indian S2 scenes (self-supervised consistency) + Indian HR references | consistency + L1 |
| Calibration | held-out reference pairs | split-conformal |

Compute: Kaggle/Colab T4 or P100 plus a college GPU; mixed precision; 64 → 256 px patches.

## 8. Deployment
| Mode | Status | Notes |
|---|---|---|
| Static web app (client-side) | v1 | GitHub Pages; model cached by the browser; nothing uploaded |
| Offline / air-gapped | v1-ready | Serve `docs/` from any internal web server; data from an internal STAC/COG mirror |
| On-prem API | v1 (code) | `server/app.py` (FastAPI) + `Dockerfile` |
| Batch production | v1 | `prototype/run_sr.py` (Python, tiled, GeoTIFF out) |

## 9. Links
* Live prototype: https://uchihadzoro.github.io/Deep-Learning-Super-Resolution-Mapping/
* Source code: https://github.com/UchihaDZoro/Deep-Learning-Super-Resolution-Mapping
* Implementation plan: `IMPLEMENTATION_PLAN.md`
