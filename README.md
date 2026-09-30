# 🛰️ TRINETRA-SR

### Trustworthy Super-Resolution for Sentinel-2

**Smart India Hackathon · PS 26142 · NTRO · Space Technology**

[![Architecture Diagram](https://gitdiagram.com/uchihadzoro/deep-learning-super-resolution-mapping/diagram.png)](https://gitdiagram.com/uchihadzoro/deep-learning-super-resolution-mapping?utm_source=readme&utm_medium=picture)

> **From 10 m Sentinel-2 imagery to an estimated 2.5 m representation — with uncertainty, spectral consistency, and geospatial fidelity.**

---

## 🌍 Overview

**TRINETRA-SR** is a deep-learning-based Super-Resolution Mapping system for Sentinel-2 satellite imagery.

The current prototype performs **4× super-resolution**, transforming Sentinel-2 imagery from **10 m to an estimated 2.5 m spatial grid** across 10 multispectral bands.

Unlike conventional image upscaling, TRINETRA-SR is designed around **trustworthy reconstruction**:

* 🧠 **4× Super-Resolution** — 10 m → 2.5 m
* 🛰️ **10-band multispectral output**
* 🎲 **Per-pixel uncertainty estimation**
* 📐 **Radiometric consistency validation**
* 🌱 **NDVI consistency analysis**
* 🗺️ **GeoTIFF export with original CRS**
* ⚡ **Browser-side ONNX inference**
* 🖥️ **Optional FastAPI / Docker deployment**

The current prototype implements the core inference and trust pipeline, while the broader roadmap extends it toward multi-temporal fusion, calibrated uncertainty, generative refinement, downstream validation, and GIS integration.

---

## ⚠️ Scientific Disclaimer

TRINETRA-SR does **not** produce native 2.5 m Sentinel-2 observations.

The 2.5 m product is a **model-generated reconstruction**. Fine-scale details may be inferred by the model and should therefore be interpreted together with the uncertainty information.

> **Sharper imagery is useful only when we can quantify how trustworthy the additional detail is.**

---

## ✨ Key Features

| Feature                 | Description                                                   |
| ----------------------- | ------------------------------------------------------------- |
| **4× SR**               | 10 m → estimated 2.5 m                                        |
| **10 Bands**            | B02, B03, B04, B05, B06, B07, B08, B8A, B11, B12              |
| **Uncertainty**         | 8-fold dihedral test-time ensemble                            |
| **Consistency**         | SR degraded back to native resolution and compared with input |
| **Spectral Validation** | Spectral angle and reflectance consistency                    |
| **NDVI Analysis**       | Native, degraded-SR and SR comparison                         |
| **GeoTIFF**             | Multiband geospatial export                                   |
| **Browser Inference**   | ONNX Runtime Web                                              |
| **GPU Acceleration**    | WebGPU with WebAssembly fallback                              |
| **Server Mode**         | FastAPI + Docker                                              |

The current browser engine retrieves Sentinel-2 data, performs cloud screening, runs ONNX inference locally, computes uncertainty and metrics, and generates visualization/export products.

---

# 🧠 How It Works

```text
                Sentinel-2 L2A
                    10 m
                      │
                      ▼
             ┌─────────────────┐
             │  Scene Search   │
             │  & Cloud Check  │
             └────────┬────────┘
                      │
                      ▼
             ┌─────────────────┐
             │ Windowed COG    │
             │ Band Retrieval  │
             └────────┬────────┘
                      │
                      ▼
             ┌─────────────────┐
             │  SEN2SR-Lite    │
             │  ONNX Inference │
             └────────┬────────┘
                      │
                      ▼
              Estimated 2.5 m
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
      Uncertainty  Consistency   NDVI
          │           │           │
          └───────────┼───────────┘
                      ▼
              GeoTIFF + Metrics
```

---

# 🔬 Trust Layer

TRINETRA-SR does not treat super-resolution as simply an image enhancement problem.

### 1. Uncertainty

The prototype uses an **8-fold dihedral test-time ensemble** to estimate per-pixel variation across multiple transformed inference passes.

### 2. Radiometric Consistency

The generated SR image is degraded back toward the original Sentinel-2 resolution and compared with the input.

Metrics include:

* PSNR
* MAE
* Spectral Angle
* NDVI deviation

### 3. Spectral Consistency

The system evaluates whether the reconstructed multispectral information remains consistent with the original observation.

### 4. Sharpness

The system compares gradient-based image sharpness against bicubic upsampling to quantify the increase in spatial detail.

---

# 🛰️ Multispectral Output

TRINETRA-SR targets all 10 bands:

| Band | Resolution | Region     |
| ---- | ---------: | ---------- |
| B02  |       10 m | Blue       |
| B03  |       10 m | Green      |
| B04  |       10 m | Red        |
| B05  |       20 m | Red Edge   |
| B06  |       20 m | Red Edge   |
| B07  |       20 m | Red Edge   |
| B08  |       10 m | NIR        |
| B8A  |       20 m | Narrow NIR |
| B11  |       20 m | SWIR       |
| B12  |       20 m | SWIR       |

The planned system brings the 20 m bands onto the same **2.5 m output grid**, enabling higher-resolution spectral analysis such as NDVI, NDRE, NDWI, MNDWI and NBR.

---

# 🌐 Web Application

The `docs/` directory contains the browser-based TRINETRA-SR application.

The inference pipeline runs locally in the browser:

```text
AOI Selection
     │
     ▼
Earth Search STAC
     │
     ▼
Sentinel-2 L2A
     │
     ▼
SCL Cloud Screening
     │
     ▼
Windowed COG Read
     │
     ▼
ONNX Runtime Web
     │
     ├── WebGPU
     └── WebAssembly
     │
     ▼
Super-Resolution
     │
     ├── Uncertainty
     ├── Consistency
     ├── NDVI
     └── Visualization
```

No imagery needs to be uploaded to a central inference server for the browser workflow.

---

# 📁 Repository Structure

```text
deep-learning-super-resolution-mapping/
│
├── README.md
├── Dockerfile
├── IMPLEMENTATION_PLAN.md
├── requirements.txt
├── .dockerignore
│
├── docs/
│   ├── index.html
│   ├── engine.js
│   ├── .nojekyll
│   │
│   ├── css/
│   │   └── style.css
│   │
│   ├── js/
│   │   ├── app.js
│   │   └── globe.js
│   │
│   └── data/
│       ├── index.json
│       ├── bengaluru/
│       │   └── meta.json
│       ├── delhi_yamuna/
│       │   └── meta.json
│       ├── mumbai/
│       │   └── meta.json
│       ├── punjab/
│       │   └── meta.json
│       └── wayanad/
│           └── meta.json
│
├── prototype/
│   ├── run_sr.py
│   ├── export_onnx.py
│   └── recompute_metrics.py
│
├── server/
│   └── app.py
│
└── .claude/
    └── launch.json
```

---

# ⚙️ Installation

### 1. Clone the repository

```bash
git clone https://github.com/UchihaDZoro/Deep-Learning-Super-Resolution-Mapping.git

cd Deep-Learning-Super-Resolution-Mapping
```

### 2. Create a virtual environment

```bash
py -3.11 -m venv .venv
```

Activate it on Windows:

```bash
.venv\Scripts\activate
```

### 3. Install PyTorch

For CUDA 12.1:

```bash
pip install torch torchvision \
  --index-url https://download.pytorch.org/whl/cu121
```

### 4. Install dependencies

```bash
pip install -r requirements.txt
```

The repository's dependency set includes Sentinel-2/STAC access, raster processing, PyTorch inference, FastAPI and supporting utilities.

---

# ▶️ Run

## Python Prototype

```bash
python prototype/run_sr.py
```

The prototype performs the core:

```text
Fetch
  ↓
Preprocess
  ↓
Super-Resolve
  ↓
Uncertainty
  ↓
Metrics
  ↓
GeoTIFF Export
```

## FastAPI Server

Install the server dependencies if required:

```bash
pip install fastapi uvicorn[standard] python-multipart
```

Run:

```bash
python -m uvicorn server.app:app --port 7860
```

Then open:

```text
http://localhost:7860
```

The repository's Docker configuration also exposes the application on port `7860`.

---

# 🐳 Docker

Build:

```bash
docker build -t trinetra-sr .
```

Run:

```bash
docker run --rm -p 7860:7860 trinetra-sr
```

Open:

```text
http://localhost:7860
```

The Docker image packages the Python inference pipeline, server and web assets and uses Python 3.11.

---

# 🧪 Evaluation

The current prototype evaluates the reconstruction using:

### Reconstruction

* PSNR
* MAE
* Spectral Angle

### Spectral / Scientific

* NDVI deviation
* Per-band consistency

### Spatial

* Sharpness gain relative to bicubic

### Trust

* Mean uncertainty
* High-uncertainty pixel percentage

The broader implementation plan extends this evaluation to **ERGAS, LPIPS, OpenSR-test, uncertainty calibration and downstream-task performance**.

---

# 🗺️ Planned Architecture

The current prototype is the first stage of the larger TRINETRA-SR architecture.

```text
                Copernicus / STAC
                       │
                       ▼
              ┌──────────────────┐
              │ Pre-processing   │
              │                  │
              │ Cloud Masking    │
              │ Co-registration  │
              │ Temporal Fusion  │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐
              │ Fidelity         │
              │ Backbone         │
              │                  │
              │ Swin / Mamba     │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐
              │ Detail Refiner   │
              │                  │
              │ Diffusion / Flow │
              └────────┬─────────┘
                       │
                       ▼
              ┌──────────────────┐
              │ Trust Layer      │
              │                  │
              │ Uncertainty      │
              │ Calibration      │
              │ Hallucination    │
              │ Consistency      │
              └────────┬─────────┘
                       │
                       ▼
             ┌────────────────────┐
             │ GIS-ready Product  │
             │                    │
             │ COG + STAC + QGIS  │
             └────────────────────┘
```

The implementation plan defines this as the target three-stage architecture: **pre-processing → fidelity/detail reconstruction → trust layer**.

---

# 🚀 Roadmap

### Phase 1 — Data Pipeline

* [ ] Copernicus STAC pipeline
* [ ] Cloud masking
* [ ] Multi-temporal scene selection
* [ ] Co-registration
* [ ] S2 PSF degradation
* [ ] Spectral harmonisation
* [ ] IndiaSR-Val

### Phase 2 — Fidelity Backbone

* [ ] Lightweight Swin/Mamba model
* [ ] Hard low-frequency constraint
* [ ] Multi-temporal attention
* [ ] Misalignment-tolerant loss
* [ ] Spectral loss

### Phase 3 — Trust Layer

* [ ] Diffusion / flow-matching refiner
* [ ] Stochastic sampling
* [ ] Conformal calibration
* [ ] Hallucination map
* [ ] Fidelity ↔ Detail control

### Phase 4 — Downstream Validation

* [ ] Building segmentation
* [ ] Road extraction
* [ ] Field boundary detection
* [ ] Water-body detection
* [ ] Flood / landslide change detection

### Phase 5 — Deployment

* [ ] COG output
* [ ] STAC metadata
* [ ] QGIS plugin
* [ ] ONNX optimization
* [ ] TensorRT deployment
* [ ] Offline / air-gapped deployment

These phases follow the implementation roadmap defined for the project.

---

# 🔬 Research Direction

The long-term objective is to move from **single-image super-resolution** toward **trustworthy multi-temporal super-resolution**.

The planned system combines:

**Multi-temporal evidence**

→ recover information supported by repeated observations

**Physics-informed reconstruction**

→ preserve Sentinel-2 low-frequency/radiometric content

**Generative refinement**

→ improve high-frequency detail when appropriate

**Uncertainty calibration**

→ quantify how reliable each reconstruction is

**Downstream validation**

→ measure whether SR actually improves geospatial tasks

The central research question is:

> **Can we generate useful 2.5 m representations from Sentinel-2 while explicitly distinguishing observed information from model-inferred detail?**

---

# 🛰️ Why TRINETRA-SR?

Most super-resolution systems answer:

> **"Does this image look sharper?"**

TRINETRA-SR aims to answer four additional questions:

> **What information supports this detail?**

> **How uncertain is this pixel?**

> **Does the reconstruction remain consistent with the original observation?**

> **Does the additional resolution actually improve the task?**

That is the foundation of **Trustworthy Super-Resolution Mapping**.

---

# 📚 References

### Super-Resolution

* [SEN2SR — ESA OpenSR](https://github.com/ESAOpenSR/SEN2SR)
* [OpenSR-test](https://github.com/ESAOpenSR/opensr-test)
* [LDSR-S2 — Trustworthy SR with Latent Diffusion](https://www.semanticscholar.org/paper/27fa48af71d55c671c498649b5a65d57fbed13f4)
* [DiffFuSR](https://arxiv.org/abs/2506.11764)

### Datasets

* [SEN2NAIPv2](https://huggingface.co/datasets/tacofoundation/SEN2NAIPv2)
* [MuS2](https://www.nature.com/articles/s41597-023-02538-9)

### Evaluation

* [GeoSR-Bench](https://arxiv.org/abs/2605.00310)

### Satellite Data

* [Copernicus Browser](https://browser.dataspace.copernicus.eu)
* [Bhuvan](https://bhuvan.nrsc.gov.in/wiki/index.php/Free_Satellite_Data_Download)

The research references and evaluation direction are based on the project's implementation plan.

---

# 👥 Team

**Team Sentinels**

**Smart India Hackathon · PS 26142**

**Organisation:** NTRO
**Theme:** Space Technology
**Category:** Software

---

# 📜 Credits

The project uses modified Copernicus Sentinel data accessed through Microsoft Planetary Computer.

The v1 inference engine is based on **SEN2SR-Lite / ESA OpenSR**.

The surrounding trust layer, consistency validation, data pipeline and visualization system are developed as part of TRINETRA-SR.

---

<div align="center">

### 🛰️ TRINETRA-SR

**Trustworthy · Spectrally Consistent · Geospatially Aware · Explainable**

*Sharper maps. Quantified uncertainty. More trustworthy decisions.*

</div>
