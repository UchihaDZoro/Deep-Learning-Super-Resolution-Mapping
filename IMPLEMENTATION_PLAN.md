# Approach & Implementation Plan

**TRINETRA-SR · Smart India Hackathon 2026 · PS 26142 (NTRO) · Team Sentinels_W (190286)**

This document records how we approached the problem statement, the decisions we made along the way and why, what prototype v1 delivers today, and how we plan to take it to a validated, deployable system.
The technical specification is in [TECHNICAL_DESIGN.md](TECHNICAL_DESIGN.md).

---

## Summary

| | |
|---|---|
| **Problem** | Sentinel-2 is free and revisits India every 5 days, but its 10 m pixels hide roads, rooftops, field bunds and localised damage. |
| **Our framing** | Super-resolution is only useful if it stays faithful to the measurement and declares what it inferred. We treat **fidelity**, **detail** and **trust** as three separate engineering requirements. |
| **What we built (v1)** | A working 10 m → 2.5 m system for all 10 bands, with a frequency-domain consistency constraint, per-pixel uncertainty, automatic validation and GeoTIFF export. It runs entirely in the browser and is live online. |
| **Evidence** | Across 5 Indian sites: 51.1 dB mean consistency (10 m bands), 36.8 dB (20 m bands), 0.48° spectral angle, NDVI deviation 0.007. |
| **Next 12 weeks** | Fine-tune on Indian references, add multi-date fusion, calibrate uncertainty with conformal prediction, and benchmark on independent high-resolution data and downstream tasks. |

---

## 1. How we read the problem statement

We broke the PS into four requirements and treated each one as something we would have to *demonstrate*, not just claim.

| PS requirement | What it means technically | How we demonstrate it |
|---|---|---|
| "Sharper, information-rich products (< 4 m)" | 4× SR of Sentinel-2: 10 m → 2.5 m, across all bands, not only RGB | Side-by-side comparison against the 10 m input and bicubic upsampling |
| "Preserve geospatial and spectral consistency" | Output stays in the source map grid, and degrading it back to 10 m reproduces the measured reflectance | GeoTIFF in the original UTM CRS; PSNR, spectral angle and NDVI checks at native resolution |
| "Clearly manage uncertainty" | Reconstructed detail is inferred, not observed, so the product must say where it is unsure | Per-pixel uncertainty layer shipped with every product |
| "Validate against high-resolution references" | Quantitative accuracy assessment, and evidence that SR helps real applications | v1: automatic self-consistency. v2: cross-sensor benchmarks and task-level tests |

The video accompanying the PS makes the point we built around: super-resolution "doesn't unveil hidden data". **Most SR work optimises for images that look sharper. We optimised for images that can be trusted.**

---

## 2. What we learned from the literature

Before writing code we reviewed current Sentinel-2 SR research. Five findings shaped the design.

| Finding | Source | Design decision |
|---|---|---|
| A low-frequency hard constraint guarantees radiometric consistency; models above ~15 M parameters gave no significant gain | SEN2SR (ESA OpenSR, RSE 2025) | Keep the constraint; use a compact network that runs on a laptop |
| PSNR / SSIM gains often do not translate into downstream-task gains | GeoSR-Bench (2026) | Plan validation on buildings, roads, field boundaries and change detection, not just image metrics |
| Only one prior S2 SR method reports pixel-wise uncertainty, and it relies on slow diffusion sampling | LDSR-S2 (2025) | Cheap ensemble uncertainty now; diffusion only as an optional refiner later |
| Real cross-sensor pairs are mis-registered; synthetic pairs are clean but less realistic | SEN2NAIP (Sci. Data 2024) | Pre-train on synthetic pairs, fine-tune on real pairs with a shift-tolerant loss |
| Multiple revisits carry genuine sub-pixel information | HighRes-net, WorldStrat, MuS2 | Multi-temporal fusion as the main v2 upgrade |

---

## 3. How we built v1

We worked in five stages. Each one ended with something we could run and measure.

### Stage 1 · Baseline and data pipeline
- Built a STAC-based acquisition pipeline: search the Sentinel-2 L2A archive, score each candidate scene by the cloud-free fraction of the target window (SCL mask), and read only that window from cloud-optimised GeoTIFFs.
- Handled the processing-baseline 04.00 reflectance offset so older and newer scenes are radiometrically comparable.
- Chose **SEN2SR-Lite** (ESA OpenSR, CC0-1.0) as the v1 network. It already encodes the fidelity constraint and covers all 10 bands, which let us spend our effort where the PS puts its emphasis: trust, validation and usability.

### Stage 2 · Trust layer
- **Uncertainty.** We run the model on the 8 dihedral transforms of each tile (4 rotations × flip), invert them, and take the per-pixel standard deviation. Regions where the model disagrees with itself are flagged.
- **Self-consistency validation.** Every output is degraded back to each band's *native* grid (10 m and 20 m) and compared with the measurement: PSNR, spectral angle, NDVI deviation, edge-energy gain and the share of high-uncertainty pixels.
- While validating, we found that the library's tiling routine mis-placed tiles for non-default image sizes (consistency fell to 24.9 dB). We replaced it with our own overlap-blended tiler, which restored about 50 dB at every size. This is exactly the kind of silent failure the validation layer exists to catch.

### Stage 3 · Making it usable by anyone
- The PS asks for a framework analysts can use, so we built a web application: search any place, choose dates and area, run, compare, download.
- We first deployed a Python inference server. When free hosting proved unreliable, we moved inference **into the browser**: we exported the model to ONNX, rewriting the FFT constraint and antialiased resampling as exact matrix operations (max deviation from PyTorch: 9 × 10⁻⁷). The result is a 19 MB model that runs on an ordinary laptop with no server, and can be deployed offline on an air-gapped network.
- The same pipeline also exists as a Python batch tool and as a FastAPI/Docker service for on-premise use.

### Stage 4 · Validation on Indian sites
We ran the full pipeline on five contrasting areas: Bengaluru (dense urban), Ludhiana (smallholder farmland), Mumbai (port and informal settlement), Wayanad (2024 landslide track) and the Delhi Yamuna floodplain.

| Metric | Mean | Range | Target |
|---|---|---|---|
| Consistency PSNR, 10 m bands | 51.1 dB | 49.2 – 53.1 | > 40 dB |
| Consistency PSNR, 20 m bands | 36.8 dB | 34.7 – 40.0 | > 33 dB |
| Spectral angle (10 m) | 0.48° | 0.23 – 0.62 | < 1.5° |
| NDVI deviation (MAE) | 0.0066 | 0.003 – 0.009 | < 0.02 |
| Edge-energy gain vs bicubic | 1.17× | 1.14 – 1.21 | > 1.1× |
| Pixels flagged as uncertain | 0.05 % | 0 – 0.19 | < 5 % |

The browser and Python implementations agree within 0.05 dB on identical scenes.

**What these numbers do and do not show:** they prove the output stays faithful to what the satellite measured. They do not prove that every reconstructed detail is physically correct. That requires independent high-resolution references, which is the first item in our plan.

### Stage 5 · Product finish
Interactive 3-D landing page, place search, swipe viewer with zoom, NDVI and uncertainty overlays, automatic metrics, three-layer GeoTIFF export, upload of the user's own Sentinel-2 file, and a downloadable sample scene for evaluators.

---

## 4. What v1 delivers today

| Capability | Status |
|---|---|
| 4× super-resolution, all 10 bands (10 m → 2.5 m) | Built |
| Frequency-domain low-pass consistency constraint | Built (from SEN2SR-Lite) |
| Per-pixel uncertainty (8-fold dihedral ensemble) | Built |
| Automatic validation: PSNR, spectral angle, ΔNDVI, sharpness | Built |
| Cloud-aware scene search for any location | Built |
| In-browser inference (ONNX Runtime Web) | Built |
| GeoTIFF export in the source projection | Built |
| Python batch pipeline; FastAPI/Docker service | Built |
| Fine-tuning on Indian data | Planned |
| Multi-temporal fusion | Planned |
| Conformal (calibrated) uncertainty | Planned |
| Independent HR benchmark and task-level validation | Planned |

---

## 5. Plan ahead

Twelve weeks, six phases. Each phase ends with a measurable deliverable.

| Phase | Weeks | Goal | Deliverable | Exit criterion |
|---|---|---|---|---|
| **1 · Data** | 1–3 | Training and reference data | SEN2NAIPv2 + WorldStrat loaders; India reference set (Cartosat tiles requested via NRSC/NTRO, 8–10 AOIs); PSF/MTF degradation model | Data cards; geographically disjoint train/val/test splits |
| **2 · Fine-tuning** | 3–6 | Adapt the network to Indian landscapes | Fine-tuned backbone (≤ 15 M parameters) with spectral and shift-tolerant losses | Beats v1 on the India reference set without lowering consistency |
| **3 · Detail** | 6–9 | Recover more real detail | Temporal-attention front-end (4–8 revisits); optional diffusion/flow refiner with a fidelity ↔ detail dial | Higher edge and object recall at equal consistency |
| **4 · Trust v2** | 8–10 | Calibrated, auditable uncertainty | Conformal prediction intervals; phantom-object hallucination audit; observed-vs-inferred map | Empirical coverage within ±2 % of nominal |
| **5 · Validation** | 9–11 | Prove usefulness | OpenSR-test and SEN2NAIP cross-sensor scores; building, road, field-boundary and flood/landslide change-detection tests | Measurable task gain over the 10 m input |
| **6 · Deployment** | 10–12 | Operational readiness | QGIS plug-in, STAC/COG output, offline package for air-gapped use, hardened demo | End-to-end run on an air-gapped machine |

### Team roles

| Role | Responsibility |
|---|---|
| ML lead | Backbone fine-tuning, temporal fusion |
| Generative & uncertainty | Refiner, conformal calibration, hallucination audit |
| Data & GIS | Acquisition, co-registration, degradation model, COG/STAC |
| Applications | Downstream-task experiments and metrics |
| Full-stack | Web app, ONNX engine, QGIS plug-in, deployment |
| Validation & presentation | India reference set, reports, documentation, demo |

### Compute and cost
Training uses free GPU tiers (Kaggle/Colab) and a college GPU; inference runs on any laptop CPU. Sentinel-2 data is free under the Copernicus licence, and the web application is hosted at no cost.

---

## 6. Risks and mitigations

| Risk | Level | Mitigation |
|---|---|---|
| Hallucinated detail | High | Hard consistency constraint, uncertainty layer, phantom-object audit (v2) |
| Domain gap: model pretrained on US imagery | High | Fine-tuning on Indian references; WorldStrat global pairs |
| Clouds during the monsoon | Medium | 12-month cloud-scored search; multi-date fusion (v2) |
| No 2.5 m ground truth for arbitrary scenes | Medium | Self-consistency for every product; independent benchmarks in phase 5 |
| Cross-sensor misalignment in training pairs | Medium | Co-registration and shift-tolerant loss |
| Scale and compute | Low | Browser for on-demand analysis; tiled GPU batch for large mosaics |

---

## 7. Why this approach

- **It is honest.** Every product carries its own uncertainty and validation report, so an analyst can tell observed detail from inferred detail.
- **It already works.** The prototype is live and measured, not a proposal.
- **It deploys where NTRO needs it.** A 19 MB model with no server dependency runs offline on standard hardware.
- **It has a clear path to rigour.** Each planned phase closes a specific gap with a measurable exit criterion.
