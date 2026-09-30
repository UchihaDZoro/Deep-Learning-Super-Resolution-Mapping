# PS 26142: Deep Learning Super-Resolution Mapping (SRM) for Sentinel-2
**Organisation:** NTRO · **Theme:** Space Technology · **Category:** Software
**Target:** Sentinel-2 at 10 m → **2.5 m** (4×, which beats the <4 m requirement), with spectral and geospatial consistency and a measured uncertainty for every pixel.

---

## 1. What the problem is really asking

The PS text makes four demands. A good solution has to meet all four:

| Requirement in PS | What it means technically | How judges will test it |
|---|---|---|
| "Sharper, information-rich products (<4 m)" | 4× SR of the 10 m bands (B2, B3, B4, B8). Also bring the 20 m bands (B5–B7, B8A, B11, B12) up to the same grid. | Before/after visuals. Can you see small buildings, narrow roads and field bunds? |
| "Preserving geospatial and spectral consistency" | The SR output, degraded back to 10 m, must match the input. Georeferencing and reflectance values must stay intact, so it's not "just pretty". | Spectral metrics (SAM, ERGAS), NDVI before vs after, GeoTIFF alignment |
| "Clearly manage uncertainty… details are inferred" | Give an uncertainty / hallucination map for every pixel along with the image | "How do I know this building is real?" |
| "Validation against high-resolution references" + applications | Accuracy assessment on real cross-sensor pairs, plus gains on downstream tasks (crops, urban, disaster) | Numbers table + application demos |

The YouTube video makes one point that sets the tone: SR "doesn't unveil hidden data". **Most teams will ignore this. We will build our whole pitch around it: *trustworthy* SR.**

---

## 2. State of the art (research summary, 2024–2026)

**Datasets (paired LR–HR):**
- **SEN2NAIPv2**: Sentinel-2 L2A ↔ NAIP aerial (USA), 2.5 m targets. It has 2,851 real cross-sensor pairs plus ~17.6k synthetic pairs built with a learned S2-like degradation model. It's on HuggingFace (`tacofoundation/SEN2NAIPv2`). This is the main training source.
- **WorldStrat**: multi-temporal Sentinel-2 stacks ↔ SPOT 6/7 (1.5 m pan / 6 m MS), **globally distributed**, so it gives better geographic diversity than NAIP. Check how many tiles fall in or near India.
- **MuS2**: real-world benchmark for multi-image S2 SR (WorldView-2 references).
- **OpenSR-test** (ESA): a benchmark of 5 carefully co-registered datasets. It has consistency, synthesis and hallucination metrics as a Python package (`opensr-test`). **Use it for reporting. It's the credibility anchor.**
- **CloudSEN12**: cloud-free S2 scenes. SEN2SR used it for SWIR/red-edge training.

**Models:**
- **SEN2SR (ESA OpenSR, RSE 2025)**: CNN, Swin and Mamba networks with a *low-frequency hard-constraint layer* that forces SR outputs to keep the original low-frequency content, which guarantees radiometric consistency. Main finding: models with more than ~15 M parameters were **not** better, and Mamba beat CNN. This matters for us because small models are fine and we can train them on free GPUs.
- **LDSR-S2 ("Trustworthy SR with Latent Diffusion", 2025)**: latent diffusion from 10 m to 2.5 m. It is the only model so far that gives a *pixel-wise uncertainty* by drawing several samples.
- **DiffFuSR (2025)**: diffusion SR of **all 12 bands** to 2.5 m, using fusion for the 20/60 m bands.
- **Gated dual-conditioning flow matching (2025)**: semantic-guided cross-sensor SR.
- **Multi-image SR** (HighRes-net, TR-MISR, "Beyond Pretty Pictures" 2025): fuse several revisit dates. The sub-pixel shifts between dates carry *real* extra information, not just learned priors.
- **GeoSR-Bench (2026)**: finds that gains in PSNR/SSIM **often do not correlate, and can even anti-correlate**, with downstream task performance. So we must evaluate on downstream tasks.

**What nobody has put together yet (our gap):** a single system that combines (a) multi-temporal fusion, (b) a hard radiometric-consistency guarantee, (c) *calibrated* uncertainty with a statistical guarantee, (d) India-specific validation and (e) task-level proof, delivered as a GIS-ready tool that runs air-gapped.

---

## 3. Proposed solution: **"TRINETRA-SR"** (working name)
*Trustworthy, Radiometrically-consistent, INdia-validated, Explainable, Temporal, Reliable Aggregated SR*

### 3.1 Architecture (three stages)

```
 Copernicus / STAC API
        │  (AOI + date range)
        ▼
┌─────────────────────────┐
│ 1. PRE-PROCESSING       │  L2A BOA reflectance, SCL cloud/shadow mask,
│                         │  pick best N clear dates, co-registration
│                         │  (phase correlation / AROSICS), band stacking,
│                         │  20 m → 10 m alignment, tiling with overlap
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│ 2a. FIDELITY BACKBONE   │  Lightweight Swin/Mamba-style network
│  (deterministic, fast)  │  Input: 1 or N dates × 10 bands
│                         │  Temporal attention fusion  → 2.5 m
│                         │  + Low-Frequency Consistency Layer (hard)
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│ 2b. DETAIL REFINER      │  Residual diffusion / flow-matching
│  (optional, generative) │  (few steps, e.g. 4–15), predicts only the
│                         │  high-frequency residual on top of 2a
│                         │  → K stochastic samples
└──────────┬──────────────┘
           ▼
┌─────────────────────────┐
│ 3. TRUST LAYER          │  • Per-pixel uncertainty (sample variance
│                         │    + ensemble/aleatoric head)
│                         │  • Conformal calibration → guaranteed
│                         │    prediction intervals (e.g. 90% coverage)
│                         │  • Hallucination flag map
│                         │  • Consistency check: ↓(SR) vs input
└──────────┬──────────────┘
           ▼
  Cloud-Optimized GeoTIFF (2.5 m, same CRS) + uncertainty band +
  hallucination mask + provenance metadata (STAC item) → Web app / QGIS plugin
```

### 3.2 Key design decisions

1. **Two modes on a single "Fidelity ↔ Detail" dial.** Analysts (NTRO use case) need *fidelity mode*: no invented structures, radiometry you can defend. Visual interpretation and demos benefit from *detail mode* (the diffusion refiner). A slider blends the two, and the uncertainty map updates live. This makes the perception–distortion trade-off something the user controls instead of something hidden.
2. **Hard physics constraint.** The final layer projects the output so that `Downsample_S2-PSF(SR) == Input`. It uses Sentinel-2's real MTF/PSF (Gaussian approximation per band from the ESA spec). Spectral consistency becomes *guaranteed by construction*, not just encouraged by a loss.
3. **Multi-temporal input (the key technical USP).** Sentinel-2 revisits every 5 days. Fusing 4–8 clear acquisitions from within a few weeks recovers *real* sub-pixel information. We can honestly tell judges: "our extra detail is partly *observed*, not only *imagined*." For a quick, single-date comparison, fall back to a single-image model.
4. **All 10 bands at 2.5 m.** The 20 m bands (red-edge, SWIR) are sharpened too, guided by the SR'd 10 m bands. This makes NDVI, NDRE, NDWI, MNDWI and NBR available at 2.5 m, which matters for crop monitoring and burn/flood mapping.
5. **Small models.** Aim for 3–15 M parameters (backed by SEN2SR's findings). They train on Kaggle/Colab GPUs, can be exported to ONNX and run on a laptop GPU. NTRO is likely to value on-prem or air-gapped deployment.

### 3.3 Training strategy

| Stage | Data | Loss | Purpose |
|---|---|---|---|
| Pre-train | SEN2NAIPv2 synthetic + WorldStrat, with degradation built by our own S2-PSF + noise + spectral harmonisation | L1 + FFT/frequency loss + SAM spectral loss | Learn textures safely (perfectly aligned) |
| Fine-tune | SEN2NAIPv2 cross-sensor + WorldStrat real pairs | **Misalignment-tolerant** L1 (search in a ±1–2 px window) + perceptual (LPIPS, light weight) + edge loss | Close the synthetic→real gap |
| Refiner | Same real pairs, residual target = HR − backbone output | Diffusion / flow-matching objective | Detail mode + uncertainty samples |
| Domain adaptation | Unlabelled Indian S2 scenes (self-supervised: cycle/degradation consistency) + small Indian HR reference set | Consistency loss | Indian terrain: small irregular fields, dense informal settlements, monsoon haze |
| Calibration | Held-out real pairs | Split conformal prediction | Calibrated uncertainty |

**Spectral harmonisation:** before training, map NAIP/SPOT reflectance to the S2 spectral response, using per-band linear regression on overlapping degraded pixels. This removes sensor bias, so the model learns spatial detail and not colour shifts.

### 3.4 Validation framework (planned before building, so it can't be gamed)

**A. Image-quality metrics** (report them, but explain their limits):
- PSNR, SSIM, LPIPS (perceptual)
- **Spectral:** SAM (spectral angle), ERGAS, per-band bias
- **Consistency:** error between the input and the SR output degraded back to 10 m (should be ~0 thanks to the hard constraint)
- **OpenSR-test** suite: consistency / synthesis / hallucination scores, compared against bicubic, SEN2SR and LDSR-S2

**B. Uncertainty quality:**
- Calibration: empirical coverage of the conformal intervals vs nominal (e.g. 90% → 89–91%)
- Error–uncertainty correlation (Spearman); sparsification curves (does error drop when we remove the most uncertain pixels?)

**C. Downstream utility (the most convincing to judges):**
| Application | Task | Metric | Compare |
|---|---|---|---|
| Urban | Building footprint segmentation | IoU / F1, and **small-building recall** | 10 m bicubic vs our 2.5 m vs real HR |
| Roads | Road extraction | Road completeness/correctness, **narrow-road** recall | same |
| Agriculture | Field boundary delineation (Indian smallholdings) | Boundary F1, number of parcels detected | same |
| Water | Water-body edge / small ponds (MNDWI) | Edge accuracy, detection of ponds < 0.1 ha | same |
| Disaster | Flood extent / landslide / building damage change detection | F1 of change map | same |

**D. Hallucination audit:** run an object detector on SR vs HR, and count "phantom objects" (detected in SR but absent in HR). Show that our uncertainty map flags them.

---

## 4. Uniqueness & innovation (how to stand out)

Most teams will fine-tune an ESRGAN/SwinIR on some pairs and show pretty pictures. The ten points below make us different, roughly in order of impact:

1. **Trust map with a statistical guarantee (conformal prediction).** Our output isn't just "high uncertainty here". It says "the true reflectance lies in this interval with 90% probability, and here is the proof on held-out data". Very few Sentinel-2 SR works do this, and it answers the PS's uncertainty clause directly.
2. **Real information vs imagined detail.** Multi-temporal fusion plus a map that separates observed detail (supported by multi-date evidence) from prior-inferred detail. Our pitch line: *"We tell you which pixels are seen and which are guessed."*
3. **Physics-guaranteed radiometry.** A hard consistency layer using the real Sentinel-2 PSF, so scientific indices (NDVI etc.) stay valid. The live demo: compute NDVI on the input and on the SR output degraded back, and show they are identical.
4. **Fidelity ↔ Detail dial.** Interactive, with a live uncertainty update. It's memorable in a demo and explains the core trade-off in 5 seconds.
5. **Task-level proof, not PSNR theatre.** Cite GeoSR-Bench (2026) to argue that PSNR doesn't predict usefulness, then show building/road/field-boundary gains.
6. **Indian-context validation set ("IndiaSR-Val").** Punjab/Haryana fields, Bengaluru/Delhi urban sprawl, Assam floods, Wayanad landslide area, coastal Odisha. Existing benchmarks are mostly US/Europe, so this shows domain awareness.
7. **All-band SR** (red-edge + SWIR to 2.5 m), so we can offer 2.5 m NDRE/NBR/MNDWI. Most teams will do RGB only.
8. **Hallucination audit ("phantom object" count).** A concrete, honest number most teams won't even think to measure.
9. **Analyst-ready product.** COG GeoTIFF in the same CRS, STAC metadata with a provenance tag ("AI-enhanced, model vX, uncertainty band 11"), a QGIS plugin, a web swipe-viewer and a REST API.
10. **Deployment fit for a security org.** Runs fully offline, ONNX/TensorRT export, runs on a single consumer GPU, fixed model hashes, audit log. Frame it as *"deployable inside an air-gapped NTRO network."*

**Nice-to-have extras (only if time allows):**
- **Change-aware SR:** super-resolve a before/after pair jointly for disaster damage assessment, so SR artefacts don't show up as fake changes.
- **SAR-guided SR under clouds:** use Sentinel-1 as auxiliary structural guidance during the monsoon. This is a strong "India-relevant" angle, but it's a stretch goal.
- **Resolution-adaptive output:** 5 m / 3.3 m / 2.5 m depending on how much uncertainty the user will accept.

---

## 5. Tech stack

| Layer | Tools |
|---|---|
| Data access | Copernicus Data Space Ecosystem (STAC API / openEO / Sentinel Hub), `pystac-client`, `odc-stac` |
| Geo processing | `rasterio`, `GDAL`, `xarray`, `rioxarray`, `AROSICS` (co-registration), `s2cloudless` / SCL band |
| DL | PyTorch + Lightning, `timm`, `diffusers` (refiner), `torchmetrics`, `opensr-test` |
| Uncertainty | Deep ensembles / sample variance, `MAPIE`-style split-conformal (or custom) |
| Downstream models | `segmentation_models_pytorch` (U-Net), `SAM`/`SAM2` for zero-shot boundaries, YOLO-OBB for buildings |
| Serving | FastAPI + ONNX Runtime / TensorRT, tiled inference with overlap-blend (Hann window) |
| Frontend | React + Leaflet/MapLibre (swipe compare, uncertainty overlay, dial) **or** Streamlit for speed; QGIS plugin (Python) |
| Output | Cloud-Optimized GeoTIFF, STAC item JSON, PDF accuracy report |
| Compute | Kaggle (free GPU ~30 h/week), Colab, college GPU. Mixed precision, patches of 64→256 px |
| MLOps | Git + DVC (data versioning), Weights & Biases / MLflow |

---

## 6. Timeline

> **Check the exact SIH dates on sih.gov.in.** Usual pattern: idea (PPT) submission → internal college hackathon → shortlisting announcement → Grand Finale (36 h, ~Dec). The plan below assumes about **10–12 weeks** from now to the finale. Weeks 1–2 must produce the idea PPT.

### Phase 0: Research & idea submission (Week 1–2)
- Read the key papers: SEN2SR, LDSR-S2, DiffFuSR, SEN2NAIP, WorldStrat, GeoSR-Bench, OpenSR-test
- Register on the Copernicus Data Space. Download SEN2NAIPv2, WorldStrat and OpenSR-test
- Run **baselines**: bicubic + pretrained SEN2SR on 3–4 Indian AOIs, to get real visuals for the PPT
- Write the idea PPT: problem → architecture diagram → USPs (Section 4) → feasibility → impact → timeline
- **Deliverable:** idea submission + a working baseline notebook

### Phase 1: Data pipeline (Week 3–4)
- Copernicus STAC fetcher: AOI + date range → cloud-masked, co-registered multi-date stack
- S2 PSF degradation model + spectral harmonisation for NAIP/SPOT
- Tiling / patch dataset, train/val/test splits (geographically disjoint!)
- Start **IndiaSR-Val**: pick 6–10 Indian AOIs. Collect HR references where licensing allows (see Risks)
- **Deliverable:** `data/` pipeline, dataset cards, a documented degradation model

### Phase 2: Fidelity backbone (Week 4–6)
- Single-image Swin/Mamba-lite with the low-frequency hard-constraint layer, 4×, 10 bands
- Then the multi-temporal version (temporal attention over N dates)
- Misalignment-tolerant loss, spectral (SAM) loss
- Evaluate on OpenSR-test and compare with bicubic and SEN2SR
- **Deliverable:** model v1 plus a metrics table. **Checkpoint: must beat bicubic clearly and be comparable to SEN2SR.**

### Phase 3: Refiner + trust layer (Week 6–8)
- Residual diffusion / flow-matching refiner (few steps). Sample K=8–16 outputs
- Uncertainty = sample std (+ ensemble). Split conformal calibration
- Hallucination map + phantom-object audit
- Fidelity↔Detail blend
- **Deliverable:** model v2 + uncertainty calibration plots

### Phase 4: Downstream validation (Week 7–9, parallel)
- Buildings, roads, field boundaries, water, flood/landslide change detection
- Compare bicubic 10 m vs SR 2.5 m vs real HR
- **Deliverable:** a "utility table", the most important slide for the finale

### Phase 5: Product & integration (Week 8–10)
- FastAPI inference service + tiled large-scene inference + COG/STAC export
- Web app: AOI draw → fetch → SR → swipe viewer + uncertainty overlay + dial + downstream result toggle
- QGIS plugin (thin client calling the API, or running local ONNX)
- ONNX export, benchmark speed (km²/min on a T4 / laptop GPU)
- **Deliverable:** end-to-end demo

### Phase 6: Hardening & pitch (Week 10–12)
- Pre-compute demo AOIs, so the finale never depends on the internet
- Accuracy report PDF, generated automatically for each run
- Pitch deck + 3-min demo video + README + model card (limitations and ethics)
- Mock judging Q&A (see Section 8)

### Grand Finale (36 h) plan
- **Don't train from scratch at the finale.** Arrive with trained models.
- Hours 0–8: apply judges' or mentors' feedback, fine-tune on any new AOI they give, fix bugs
- Hours 8–24: polish UI, add one stretch feature (e.g. change-aware SR or SAR guidance)
- Hours 24–32: full rehearsal, backup video, offline cached data
- Hours 32–36: final presentations. Keep a buffer.

---

## 7. Team roles (team of 6)

| Member | Role |
|---|---|
| 1 | **ML lead**: backbone, multi-temporal fusion, training |
| 2 | **Generative / uncertainty**: diffusion refiner, conformal calibration, hallucination audit |
| 3 | **Data / GIS engineer**: Copernicus pipeline, co-registration, degradation model, COG/STAC |
| 4 | **Downstream apps**: segmentation/change detection experiments, utility table |
| 5 | **Full-stack**: FastAPI, web viewer, QGIS plugin, ONNX deployment |
| 6 | **Validation & pitch**: IndiaSR-Val curation, metrics/reporting, deck, demo video, Q&A prep |

---

## 8. Likely judge questions — prepare answers

- *"Isn't SR just hallucination?"* → Point to the trust map, conformal guarantee, multi-temporal real information, phantom-object audit and fidelity mode.
- *"How do you validate in India without HR data?"* → Cross-sensor global benchmarks + the IndiaSR-Val subset + downstream task gains + self-consistency metrics.
- *"Does NDVI stay valid?"* → Hard-constraint layer; show it live.
- *"Why not just buy Pleiades/Maxar?"* → Cost, coverage, 5-day revisit, historical archive since 2015, and it's free and sovereign-usable.
- *"How fast? Can it run at scale?"* → Numbers in km²/min, ONNX, tiled inference.
- *"What if clouds cover the scene?"* → SCL masking, multi-date selection, (stretch) S1 SAR guidance.
- *"Which model is best: GAN vs diffusion vs transformer?"* → Our hybrid: a transformer for fidelity plus a diffusion residual for detail and uncertainty. Backed by an ablation table.

---

## 9. Risks & mitigations

| Risk | Mitigation |
|---|---|
| No free HR reference imagery over India | WorldStrat has global (incl. Asia) SPOT pairs. The **Maxar Open Data Program** gives free imagery for disaster events (check which Indian events are covered). **Planet Education & Research** program (3 m) for students. Ask NTRO/mentor for Cartosat reference tiles. Google/Esri basemaps only for *qualitative* visual checks (licensing forbids training use). |
| Cross-sensor misalignment ruins metrics | AROSICS co-registration + shift-tolerant loss + OpenSR-test's aligned datasets |
| GPU limits | Small models (≤15 M params), mixed precision, Kaggle + Colab rotation, pre-trained weights |
| Diffusion too slow for demo | Few-step residual refiner, precomputed samples for demo AOIs, fidelity mode is instant |
| Overclaiming | Model card with limitations; always show the uncertainty band; label output "AI-enhanced" |
| Scope creep | Must-haves = Phases 1–5 on RGB+NIR. All-band, SAR and change-aware SR are stretch goals |

---

## 10. MVP checklist (minimum to be competitive)
- [ ] Copernicus fetch → cloud-mask → SR → 2.5 m GeoTIFF with the same CRS
- [ ] 4× SR on B2/B3/B4/B8 with the hard-consistency layer
- [ ] Metrics table on OpenSR-test vs bicubic and SEN2SR
- [ ] Per-pixel uncertainty map (calibrated)
- [ ] At least 2 downstream demos (buildings + field boundaries or flood)
- [ ] Web swipe-viewer with uncertainty overlay

**Winning extras:** multi-temporal fusion · Fidelity↔Detail dial · all-band SR · IndiaSR-Val · phantom-object audit · QGIS plugin · offline deployment.

---

## 11. Key references
- SEN2SR / radiometrically consistent SR framework (RSE 2025): https://www.sciencedirect.com/science/article/pii/S0034425725006261 · code: https://github.com/ESAOpenSR/SEN2SR
- OpenSR-test benchmark: https://github.com/ESAOpenSR/opensr-test
- Trustworthy SR with latent diffusion (LDSR-S2): https://www.semanticscholar.org/paper/27fa48af71d55c671c498649b5a65d57fbed13f4
- DiffFuSR, all-band diffusion SR: https://arxiv.org/abs/2506.11764
- SEN2NAIP dataset (Scientific Data): https://www.nature.com/articles/s41597-024-04214-y · HF: https://huggingface.co/datasets/tacofoundation/SEN2NAIPv2
- MuS2 multi-image benchmark: https://www.nature.com/articles/s41597-023-02538-9
- Beyond Pretty Pictures (single + multi-image SR): https://arxiv.org/pdf/2505.24799
- Semantic-guided flow-matching cross-sensor SR: https://arxiv.org/pdf/2510.23816
- GeoSR-Bench, downstream-task SR benchmark: https://arxiv.org/abs/2605.00310
- Domain gap in cross-sensor diffusion SR: https://arxiv.org/pdf/2606.28039
- Bhuvan free data: https://bhuvan.nrsc.gov.in/wiki/index.php/Free_Satellite_Data_Download
- Copernicus Browser (dataset link from PS): https://browser.dataspace.copernicus.eu
