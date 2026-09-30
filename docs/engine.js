/* TRINETRA-SR in-browser engine.
 *
 * Runs the whole pipeline client-side, no server:
 *   Earth Search STAC -> clearest Sentinel-2 L2A window (SCL cloud check) ->
 *   windowed COG reads from AWS -> SEN2SR-Lite (ONNX, exported with exact
 *   linear-algebra rewrites of the FFT hard constraint) -> dihedral TTA
 *   uncertainty -> consistency metrics -> viewer images + GeoTIFF downloads.
 *
 * Needs globals: ort (onnxruntime-web), GeoTIFF (geotiff.js), proj4.
 */
(function () {
  'use strict';
  const STAC = 'https://earth-search.aws.element84.com/v1/search';
  const MODEL_URL = 'model/sen2sr_lite.onnx';
  const ASSETS = ['blue', 'green', 'red', 'rededge1', 'rededge2', 'rededge3', 'nir', 'nir08', 'swir16', 'swir22'];
  const BAND_NAMES = ['B02', 'B03', 'B04', 'B05', 'B06', 'B07', 'B08', 'B8A', 'B11', 'B12'];
  const NB = 10, SCALE = 4, TILE = 128, OVERLAP = 32, UNC_MAX = 0.02;
  const B10 = [0, 1, 2, 6], B20 = [3, 4, 5, 7, 8, 9];
  const LUT = {
    inferno: 'AAAEAQAFAQEGAQEIAgEKAgIMAgIOAwIQBAMSBAMUBQQXBgQZBwUbCAUdCQYfCgciCwckDAgmDQgpDgkrEAktEQowEgoyFAs0FQs3Fgs5GAw8GQw+GwxBHAxDHgxFHwxIIQxKIwxMJAxPJgxRKAtTKQtVKwtXLQtZLwpbMQpcMgpeNApfNglhOAliOQljOwlkPQllPglmQApnQgpoRApoRQppRwtqSQtqSgxrTAxrTQ1sTw1sUQ5sUg5tVA9tVQ9tVxBuWRBuWhFuXBJuXRJuXxNuYRNuYhRuZBVuZRVuZxZuaRZuahdubBhubRhubxlucRluchpudBpudRtudxxteBxteh1tfB1tfR5tfx5sgB9sgiBshCBrhSFrhyFriCJqiiJqjCNpjSNpjyRpkCVokiVokyZnlSZnlydmmCdmmihlmylknSlknypjoCpjoitioyxhpSxgpi1gqC5fqS5eqy9erTBdrjBcsDFbsTJaszJatDNZtjRYtzVXuTVWujZVvDdUvThTvzlSwDpRwTpQwztPxDxOxj1Nxz5MyD9LykBKy0FJzEJIzkNHz0RG0EVF0kZE00dD1EhC1UpB10s/2Ew+2U092k4821A73VE63lI431M34FU24VY14lc041kz5Fox5Vww5l0v514u6GAt6WEr6mMq62Qp62Yo7Gcm7Wkl7mok72wj724h8G8g8XEf8XMd8nQc83Yb83gZ9HkY9XsX9X0V9n4U9oAT94IS94QQ+IUP+IcO+IkM+YsL+YwK+Y4J+pAI+pIH+pQH+5YG+5cG+5kG+5sG+50H/J8H/KEI/KMJ/KUK/KYM/KgN/KoP/KwR/K4S/LAU/LIW/LQY+7Ya+7gd+7of+7wh+74j+sAm+sIo+sQq+sYt+ccv+cky+cs1+M03+M8699E999NA9tVD9tdG9dlJ9dtM9N1P9N9T9OFW8+Na8+Vd8uZh8uhl8upp8ext8e1x8e918fF58vJ98vSC8/WG8/aK9PiO9fmS9vqW+Pua+fyd+v2h/P+k',
    RdYlGn: 'pQAmpwImqQQmqwYmrQgmrwkmsQsmsw0mtQ8mtxEmuRMmuxUmvRcmvhgnwBonwhwnxB4nxiAnyCInyiQnzCYnzign0Ckn0isn1C0n1i8n2DEo2TQp2jYq2zgr3Dss3T0t3kAu4EIv4UQw4kcx40kz5Ew05U415lA251M36VU46lc561o67Fw77V887mE+72M/8WZA8mhB82tC9G1D9HBE9XJF9XVH9XdI9npJ9nxK9n9L94FM94RO+IZP+IlQ+IxR+Y5S+ZFT+ZNV+pZW+phX+ptY+51Z+6Bb+6Nc/KVd/Khe/Kpf/a1g/a9i/bFj/bNl/bVn/bdo/blq/bts/b1t/b9v/cFx/cNy/cV0/cd2/sh3/sp5/sx7/s58/tB+/tJ//tSB/taD/tiE/tqG/tyI/t6J/uCL/uGN/uKP/uSR/uWT/uaV/ueX/umZ/uqb/uud/uyf/u2h/u+j//Cm//Go//Kq//Os//Wu//aw//ey//i0//q2//u4//y6//28//6+/v++/f68+/26+v24+Py29/y09fuy9Pqw8vqu8fms7/iq7vio7Pem6/ej6fah6PWf5vWd5fSb4/OZ4vOX4PKV3/KT3fGR3PCP2vCN2e+L1+6K1e2I0+yH0eyGz+uFzeqDy+mCyeiBx+d/xeZ+w+Z9weV7v+R6veN5u+J4ueF2t+B1td90s99ysd5xr91wrdxvq9ttqdpsp9lrpdhqotdqoNZpndVpm9RpmNNoltJok9FokdBojs9njM1nicxnh8tnhMpmgslmf8hmfcdlesZleMVldcRlc8JkcMFkbsBka79kab5jZr1jY7xiYLpiXblhWrdgV7ZfVLRfUbNeTrFdS7BcSK5cRa1bQqxaP6pZPKlZOadYNqZXM6RWMKNWLaFVKqBUJ59TJJ1TIZxSHppRG5lQGZdQGJVPF5NOFpFNFZBMFI5LE4xKEopJEYhIEIZHD4RGDoJFDYBEDH9DC31CCntBCXlACHc/B3U+BnM9BXE8BHA7A246Amw5AWo4AGg3',
  };
  const lut = {};
  for (const k in LUT) lut[k] = Uint8Array.from(atob(LUT[k]), c => c.charCodeAt(0));

  let session = null, backend = '';

  // ------------------------------------------------------------ model
  async function loadModel(progress) {
    if (session) return session;
    ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/';
    ort.env.wasm.numThreads = self.crossOriginIsolated ? Math.min(4, navigator.hardwareConcurrency || 1) : 1;
    progress && progress(0.02, 'Downloading SR model (19 MB, cached after first use)…');
    const buf = await fetchWithProgress(MODEL_URL, f => progress && progress(0.02 + 0.08 * f, `Downloading SR model… ${Math.round(f * 100)}%`));
    progress && progress(0.1, 'Initialising neural network…');
    // Reference run on WebAssembly (always correct); WebGPU is used only if it
    // reproduces that output (some drivers silently return zeros for this graph).
    const probe = new Float32Array(NB * TILE * TILE);
    for (let i = 0; i < probe.length; i++) probe[i] = 0.1 + 0.2 * Math.abs(Math.sin(i * 0.37));
    const run = s => s.run({ x: new ort.Tensor('float32', probe, [1, NB, TILE, TILE]) }).then(o => o.y.data);
    const wasm = await ort.InferenceSession.create(buf, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    session = wasm; backend = 'WebAssembly';
    if (navigator.gpu) {
      try {
        const gpu = await ort.InferenceSession.create(buf, { executionProviders: ['webgpu'] });
        const [a, b] = await Promise.all([run(wasm), run(gpu)]);
        let err = 0;
        for (let i = 0; i < a.length; i += 7) err = Math.max(err, Math.abs(a[i] - b[i]));
        if (err < 1e-3) { session = gpu; backend = 'WebGPU'; }
        else console.warn('[engine] WebGPU output mismatch (max err ' + err + '); using WebAssembly');
      } catch (e) { console.warn('[engine] WebGPU unavailable:', e); }
    }
    return session;
  }

  async function fetchWithProgress(url, onFrac) {
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Could not download ${url} (${r.status})`);
    const total = +r.headers.get('content-length') || 0;
    if (!r.body || !total) return new Uint8Array(await r.arrayBuffer());
    const reader = r.body.getReader(), chunks = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value); got += value.length; onFrac(Math.min(1, got / total));
    }
    const out = new Uint8Array(got); let o = 0;
    for (const c of chunks) { out.set(c, o); o += c.length; }
    return out;
  }

  // ------------------------------------------------------------ data access
  function utmDef(epsg) {
    const zone = epsg % 100, south = Math.floor(epsg / 100) === 327;
    return `+proj=utm +zone=${zone}${south ? ' +south' : ''} +datum=WGS84 +units=m +no_defs`;
  }
  function itemEpsg(it) {
    const p = it.properties;
    if (p['proj:epsg']) return +p['proj:epsg'];
    if (p['proj:code']) return +String(p['proj:code']).split(':')[1];
    throw new Error('Scene has no projection info');
  }
  function reflParams(asset, props) {
    // Earth Search already removes the baseline-04 +1000 DN offset when
    // `earthsearch:boa_offset_applied` is true, yet still lists offset -0.1:
    // honouring it then would zero out most dark pixels.
    const rb = (asset['raster:bands'] || [])[0] || {};
    const scale = rb.scale ?? 1e-4;
    if (props['earthsearch:boa_offset_applied'] === true) return [scale, 0];
    const offset = rb.offset ?? (parseFloat(props['s2:processing_baseline'] || '0') >= 4 ? -0.1 : 0);
    return [scale, offset];
  }

  async function searchScenes(lat, lon, start, end) {
    const body = {
      collections: ['sentinel-2-l2a'], limit: 100,
      intersects: { type: 'Point', coordinates: [lon, lat] },
      datetime: `${start}T00:00:00Z/${end}T23:59:59Z`,
      query: { 'eo:cloud_cover': { lt: 20 } },
    };
    const r = await fetch(STAC, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('Sentinel-2 catalogue search failed (' + r.status + ')');
    const items = (await r.json()).features || [];
    items.sort((a, b) => a.properties['eo:cloud_cover'] - b.properties['eo:cloud_cover']);
    return items;
  }

  async function openImage(href) { return (await GeoTIFF.fromUrl(href)).getImage(); }

  async function fetchS2(lat, lon, start, end, edge, progress, log) {
    progress(0.12, 'Searching the Sentinel-2 archive…');
    const items = await searchScenes(lat, lon, start, end);
    if (!items.length) throw new Error('No Sentinel-2 scene with <20% cloud for this place and date range. Try a wider or dry-season date range.');
    let best = null;
    for (const [i, it] of items.slice(0, 6).entries()) {
      progress(0.14 + i * 0.02, `Checking clouds · scene ${i + 1}: ${it.properties.datetime.slice(0, 10)}`);
      const epsg = itemEpsg(it);
      const [x, y] = proj4('EPSG:4326', utmDef(epsg), [lon, lat]);
      const red = await openImage(it.assets.red.href);
      const [ox, oy] = red.getOrigin(), [rx] = red.getResolution();
      const col = Math.floor((x - ox) / rx), row = Math.floor((oy - y) / rx);
      const c0 = 2 * Math.floor((col - edge / 2) / 2), r0 = 2 * Math.floor((row - edge / 2) / 2);
      if (c0 < 0 || r0 < 0 || c0 + edge > red.getWidth() || r0 + edge > red.getHeight()) { log(`skip ${it.id}: tile edge`); continue; }
      const scl = await openImage(it.assets.scl.href);
      const [s] = await scl.readRasters({ window: [c0 / 2, r0 / 2, (c0 + edge) / 2, (r0 + edge) / 2], width: edge, height: edge, resampleMethod: 'nearest' });
      let ok = 0;
      for (let k = 0; k < s.length; k++) { const v = s[k]; if (v === 4 || v === 5 || v === 6 || v === 7 || v === 11) ok++; }
      const clear = ok / s.length;
      const cand = { it, epsg, c0, r0, clear, ox, oy, rx };
      if (clear >= 0.97) { best = cand; break; }
      log(`skip ${it.id}: clear=${clear.toFixed(2)}`);
      if (!best || clear > best.clear) best = cand;
    }
    if (!best || best.clear < 0.6) throw new Error('No sufficiently cloud-free window found. Try another date range or move the point.');
    const { it, epsg, c0, r0, clear, ox, oy, rx } = best;
    progress(0.26, `Reading 10 bands · ${it.properties.datetime.slice(0, 10)}`);
    const n = edge * edge, X = new Float32Array(NB * n);
    let done = 0;
    await Promise.all(ASSETS.map(async (key, b) => {
      const a = it.assets[key], img = await openImage(a.href);
      const f = img.getResolution()[0] / 10;
      const win = [c0 / f, r0 / f, (c0 + edge) / f, (r0 + edge) / f];
      const [d] = await img.readRasters({ window: win, width: edge, height: edge, resampleMethod: f > 1 ? 'bilinear' : 'nearest' });
      const [sc, off] = reflParams(a, it.properties);
      for (let k = 0; k < n; k++) X[b * n + k] = d[k] === 0 ? 0 : Math.max(0, d[k] * sc + off);
      progress(0.26 + 0.1 * (++done) / NB, `Reading bands ${done}/${NB}`);
    }));
    return {
      X, edge, epsg, crs: `EPSG:${epsg}`,
      origin: [ox + c0 * rx, oy - r0 * rx], res: rx,
      scene: it.id, date: it.properties.datetime.slice(0, 10),
      cloud: +it.properties['eo:cloud_cover'].toFixed(2), clear,
    };
  }

  // ------------------------------------------------------------ SR
  function rot90(src, C, n) {            // torch.rot90(k=1, dims=(-2,-1)): out[i,j] = in[j, n-1-i]
    const out = new Float32Array(src.length), nn = n * n;
    for (let c = 0; c < C; c++) {
      const o = c * nn;
      for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) out[o + i * n + j] = src[o + j * n + (n - 1 - i)];
    }
    return out;
  }
  function flipW(src, C, n) {
    const out = new Float32Array(src.length), nn = n * n;
    for (let c = 0; c < C; c++) for (let i = 0; i < n; i++) {
      const o = c * nn + i * n;
      for (let j = 0; j < n; j++) out[o + j] = src[o + n - 1 - j];
    }
    return out;
  }
  function dihedral(x, C, n, k, flip) { for (let t = 0; t < k; t++) x = rot90(x, C, n); return flip ? flipW(x, C, n) : x; }
  function undihedral(x, C, n, k, flip) { if (flip) x = flipW(x, C, n); for (let t = 0; t < (4 - k) % 4; t++) x = rot90(x, C, n); return x; }

  function starts(n) {
    if (n <= TILE) return [0];
    const s = [];
    for (let v = 0; v < n - TILE; v += TILE - OVERLAP) s.push(v);
    s.push(n - TILE);
    return s;
  }

  async function predictTiled(x, n) {        // x: (10, n, n), n >= 128
    const N = n * SCALE, T = TILE * SCALE, fr = OVERLAP * SCALE;
    const ramp = new Float32Array(T).fill(1);
    for (let i = 0; i < fr; i++) { const v = 0.05 + 0.95 * i / (fr - 1); ramp[i] = v; ramp[T - 1 - i] = v; }
    const out = new Float32Array(NB * N * N), acc = new Float32Array(N * N);
    const tile = new Float32Array(NB * TILE * TILE);
    for (const r of starts(n)) for (const q of starts(n)) {
      for (let c = 0; c < NB; c++) for (let i = 0; i < TILE; i++) {
        const so = c * n * n + (r + i) * n + q, to = c * TILE * TILE + i * TILE;
        for (let j = 0; j < TILE; j++) tile[to + j] = x[so + j];
      }
      const res = await session.run({ x: new ort.Tensor('float32', tile, [1, NB, TILE, TILE]) });
      const y = res.y.data;
      for (let i = 0; i < T; i++) for (let j = 0; j < T; j++) {
        const w = ramp[i] * ramp[j], p = (r * SCALE + i) * N + q * SCALE + j;
        acc[p] += w;
        for (let c = 0; c < NB; c++) out[c * N * N + p] += y[c * T * T + i * T + j] * w;
      }
    }
    for (let c = 0; c < NB; c++) for (let p = 0; p < N * N; p++) out[c * N * N + p] /= acc[p];
    return out;
  }

  const ORDER = [[0, false], [2, true], [1, false], [3, true], [2, false], [0, true], [3, false], [1, true]];
  async function superResolve(X, n, tta, progress) {
    const N = n * SCALE, len = NB * N * N;
    const mean = new Float32Array(len), m2 = new Float32Array(len);
    const passes = ORDER.slice(0, Math.max(1, Math.min(8, tta)));
    for (const [i, [k, flip]] of passes.entries()) {
      progress(0.38 + 0.5 * i / passes.length, `Super-resolving · pass ${i + 1}/${passes.length} (${backend})`);
      await new Promise(r => setTimeout(r, 0));
      const y = undihedral(await predictTiled(dihedral(X, NB, n, k, flip), n), NB, N, k, flip);
      const cnt = i + 1;
      for (let p = 0; p < len; p++) { const d = y[p] - mean[p]; mean[p] += d / cnt; m2[p] += d * (y[p] - mean[p]); }
    }
    for (let p = 0; p < len; p++) m2[p] = Math.sqrt(Math.max(0, m2[p] / passes.length));
    return { sr: mean, std: m2 };
  }

  // ------------------------------------------------------------ metrics
  function pool(src, C, n, f) {           // (C,n,n) -> (C,n/f,n/f) average
    const m = n / f, out = new Float32Array(C * m * m);
    for (let c = 0; c < C; c++) for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) {
      let s = 0;
      for (let a = 0; a < f; a++) { const o = c * n * n + (i * f + a) * n + j * f; for (let b = 0; b < f; b++) s += src[o + b]; }
      out[c * m * m + i * m + j] = s / (f * f);
    }
    return out;
  }
  function pick(src, n, bands) {
    const nn = n * n, out = new Float32Array(bands.length * nn);
    bands.forEach((b, i) => out.set(src.subarray(b * nn, (b + 1) * nn), i * nn));
    return out;
  }
  function psnr(a, b) {
    let s = 0; for (let i = 0; i < a.length; i++) { const d = a[i] - b[i]; s += d * d; }
    const mse = s / a.length; return mse === 0 ? 99 : 10 * Math.log10(1 / mse);
  }
  function mae(a, b) { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; }
  function sam(a, b, C, nn) {
    let tot = 0;
    for (let p = 0; p < nn; p++) {
      let ab = 0, aa = 0, bb = 0;
      for (let c = 0; c < C; c++) { const x = a[c * nn + p], y = b[c * nn + p]; ab += x * y; aa += x * x; bb += y * y; }
      tot += Math.acos(Math.max(-1, Math.min(1, ab / (Math.sqrt(aa) * Math.sqrt(bb) + 1e-8))));
    }
    return tot / nn * 180 / Math.PI;
  }
  function ndvi(x, nn) {
    const out = new Float32Array(nn);
    for (let p = 0; p < nn; p++) { const r = x[2 * nn + p], ni = x[6 * nn + p]; out[p] = (ni - r) / (ni + r + 1e-6); }
    return out;
  }
  function meanOf(a) { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s / a.length; }
  function rgbMean(x, nn) { const o = new Float32Array(nn); for (let p = 0; p < nn; p++) o[p] = (x[p] + x[nn + p] + x[2 * nn + p]) / 3; return o; }
  function gradEnergy(img, n) {           // numpy.gradient, central differences
    let s = 0;
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
      const gx = j === 0 ? img[i * n + 1] - img[i * n] : j === n - 1 ? img[i * n + j] - img[i * n + j - 1] : (img[i * n + j + 1] - img[i * n + j - 1]) / 2;
      const gy = i === 0 ? img[n + j] - img[j] : i === n - 1 ? img[i * n + j] - img[(i - 1) * n + j] : (img[(i + 1) * n + j] - img[(i - 1) * n + j]) / 2;
      s += Math.hypot(gx, gy);
    }
    return s / (n * n);
  }
  function bicubicUp(x, C, n, f) {        // torch bicubic (a=-0.75, align_corners=False)
    const N = n * f, A = -0.75;
    const cub = t => { t = Math.abs(t); return t <= 1 ? ((A + 2) * t - (A + 3)) * t * t + 1 : t < 2 ? ((A * t - 5 * A) * t + 8 * A) * t - 4 * A : 0; };
    const idx = [], wts = [];
    for (let d = 0; d < N; d++) {
      const s = (d + 0.5) / f - 0.5, i0 = Math.floor(s), t = s - i0;
      idx.push([-1, 0, 1, 2].map(k => Math.min(n - 1, Math.max(0, i0 + k))));
      wts.push([cub(1 + t), cub(t), cub(1 - t), cub(2 - t)]);
    }
    const tmp = new Float32Array(C * n * N), out = new Float32Array(C * N * N);
    for (let c = 0; c < C; c++) for (let i = 0; i < n; i++) for (let d = 0; d < N; d++) {
      let s = 0; for (let k = 0; k < 4; k++) s += wts[d][k] * x[c * n * n + i * n + idx[d][k]];
      tmp[c * n * N + i * N + d] = s;
    }
    for (let c = 0; c < C; c++) for (let d = 0; d < N; d++) for (let j = 0; j < N; j++) {
      let s = 0; for (let k = 0; k < 4; k++) s += wts[d][k] * tmp[c * n * N + idx[d][k] * N + j];
      out[c * N * N + d * N + j] = s;
    }
    return out;
  }

  function computeMetrics(X, sr, bic, std, n) {
    const N = n * SCALE, nn = n * n, NN = N * N;
    const d10 = pool(pick(sr, N, B10), 4, N, SCALE), x10 = pick(X, n, B10);
    const d20 = pool(pick(sr, N, B20), 6, N, SCALE * 2), x20 = pool(pick(X, n, B20), 6, n, 2);
    const down = pool(sr, NB, N, SCALE);
    const ndIn = ndvi(X, nn), ndDown = ndvi(down, nn), ndSr = ndvi(sr, NN);
    let ndErr = 0; for (let p = 0; p < nn; p++) ndErr += Math.abs(ndDown[p] - ndIn[p]);
    const u = rgbMean(std, NN);
    let hi = 0; for (let p = 0; p < NN; p++) if (u[p] > UNC_MAX / 2) hi++;
    const r = (v, d) => +v.toFixed(d);
    return {
      consistency_psnr_db: r(psnr(d10, x10), 2),
      consistency_psnr_20m_db: r(psnr(d20, x20), 2),
      consistency_mae: r(mae(d10, x10), 5),
      spectral_angle_deg: r(sam(d10, x10, 4, nn), 3),
      spectral_angle_20m_deg: r(sam(d20, x20, 6, (n / 2) * (n / 2)), 3),
      ndvi_mae: r(ndErr / nn, 4),
      ndvi_mean_in: r(meanOf(ndIn), 3),
      ndvi_mean_sr: r(meanOf(ndSr), 3),
      sharpness_gain_vs_bicubic: r(gradEnergy(rgbMean(sr, NN), N) / gradEnergy(rgbMean(bic, NN), N), 2),
      mean_uncertainty: r(meanOf(u), 5),
      high_uncertainty_pct: r(hi / NN * 100, 2),
    };
  }

  // ------------------------------------------------------------ rendering
  function percentile(vals, q) {
    const step = Math.max(1, Math.floor(vals.length / 200000)), s = [];
    for (let i = 0; i < vals.length; i += step) s.push(vals[i]);
    s.sort((a, b) => a - b);
    return s[Math.min(s.length - 1, Math.floor(q / 100 * (s.length - 1)))];
  }
  function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }
  function toBlobURL(canvas, type) {
    return new Promise(res => canvas.toBlob(b => res(URL.createObjectURL(b)), type, 0.9));
  }
  function rgbImage(x, n, lo, hi) {
    const c = canvasOf(n, n), ctx = c.getContext('2d'), im = ctx.createImageData(n, n), nn = n * n;
    const bands = [2, 1, 0];
    for (let p = 0; p < nn; p++) for (let k = 0; k < 3; k++) {
      const v = Math.min(1, Math.max(0, (x[bands[k] * nn + p] - lo) / (hi - lo)));
      im.data[p * 4 + k] = Math.round(Math.pow(v, 1 / 1.2) * 255);
    }
    for (let p = 0; p < nn; p++) im.data[p * 4 + 3] = 255;
    ctx.putImageData(im, 0, 0);
    return c;
  }
  function upscaleNearest(c, f) {
    const o = canvasOf(c.width * f, c.height * f), ctx = o.getContext('2d');
    ctx.imageSmoothingEnabled = false; ctx.drawImage(c, 0, 0, o.width, o.height);
    return o;
  }
  function cmapImage(field, n, vmin, vmax, name, alpha) {
    const c = canvasOf(n, n), ctx = c.getContext('2d'), im = ctx.createImageData(n, n), L = lut[name];
    for (let p = 0; p < n * n; p++) {
      const t = Math.min(1, Math.max(0, (field[p] - vmin) / (vmax - vmin))), k = Math.min(255, Math.floor(t * 256));
      im.data[p * 4] = L[k * 3]; im.data[p * 4 + 1] = L[k * 3 + 1]; im.data[p * 4 + 2] = L[k * 3 + 2];
      im.data[p * 4 + 3] = alpha ? Math.round(Math.min(1, t * 1.4) * 235) : 255;
    }
    ctx.putImageData(im, 0, 0);
    return c;
  }

  // ------------------------------------------------------------ GeoTIFF writer
  // Minimal baseline GeoTIFF: uint16, pixel-interleaved, one strip, projected EPSG.
  function geotiff(data, C, n, origin, res, epsg) {
    const tags = [], nn = n * n;
    const add = (tag, type, vals) => tags.push({ tag, type, vals: Array.isArray(vals) ? vals : [vals] });
    const img = new Uint16Array(C * nn);
    for (let p = 0; p < nn; p++) for (let c = 0; c < C; c++) img[p * C + c] = Math.max(0, Math.min(65535, Math.round(data[c * nn + p] * 10000)));
    add(256, 3, n); add(257, 3, n); add(258, 3, new Array(C).fill(16)); add(259, 3, 1); add(262, 3, 1);
    add(273, 4, 0); add(277, 3, C); add(278, 3, n); add(279, 4, img.byteLength); add(284, 3, 1);
    if (C > 1) add(338, 3, new Array(C - 1).fill(0));
    add(339, 3, new Array(C).fill(1));
    if (epsg) {
      add(33550, 12, [res, res, 0]);
      add(33922, 12, [0, 0, 0, origin[0], origin[1], 0]);
      add(34735, 3, [1, 1, 0, 3, 1024, 0, 1, 1, 1025, 0, 1, 1, 3072, 0, 1, epsg]);
    }
    tags.sort((a, b) => a.tag - b.tag);
    const size = { 3: 2, 4: 4, 12: 8 };
    let extra = 0;
    for (const t of tags) { const b = size[t.type] * t.vals.length; if (b > 4) extra += b + (b % 2); }
    const ifdSize = 2 + tags.length * 12 + 4, header = 8;
    const dataOff = header + ifdSize + extra;
    const buf = new ArrayBuffer(dataOff + img.byteLength), dv = new DataView(buf);
    dv.setUint16(0, 0x4949); dv.setUint16(2, 42, true); dv.setUint32(4, 8, true);
    let p = 8, ext = header + ifdSize;
    dv.setUint16(p, tags.length, true); p += 2;
    for (const t of tags) {
      if (t.tag === 273) t.vals = [dataOff];
      const bytes = size[t.type] * t.vals.length;
      dv.setUint16(p, t.tag, true); dv.setUint16(p + 2, t.type, true); dv.setUint32(p + 4, t.vals.length, true);
      let w = bytes <= 4 ? p + 8 : ext;
      if (bytes > 4) { dv.setUint32(p + 8, ext, true); ext += bytes + (bytes % 2); }
      for (const v of t.vals) {
        if (t.type === 3) { dv.setUint16(w, v, true); w += 2; }
        else if (t.type === 4) { dv.setUint32(w, v, true); w += 4; }
        else { dv.setFloat64(w, v, true); w += 8; }
      }
      p += 12;
    }
    dv.setUint32(p, 0, true);
    new Uint16Array(buf, dataOff).set(img);
    const blob = new Blob([buf], { type: 'image/tiff' });
    return { url: URL.createObjectURL(blob), bytes: blob.size };
  }

  // ------------------------------------------------------------ orchestration
  async function finish(scene, tta, progress, extra) {
    const { X, edge: n } = scene, N = n * SCALE, nn = n * n, NN = N * N;
    const t0 = performance.now();
    const { sr, std } = await superResolve(X, n, tta, progress);
    const runtime = (performance.now() - t0) / 1000;
    progress(0.9, 'Computing metrics & rendering');
    await new Promise(r => setTimeout(r, 0));
    const bic = bicubicUp(X, NB, n, SCALE);
    const metrics = computeMetrics(X, sr, bic, std, n);
    const rgbIn = pick(X, n, [0, 1, 2]);
    let lo = percentile(rgbIn, 1), hi = percentile(rgbIn, 99); if (hi <= lo) hi = lo + 1e-3;
    const ndIn = ndvi(X, nn), ndInUp = new Float32Array(NN);
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) ndInUp[i * N + j] = ndIn[Math.floor(i / SCALE) * n + Math.floor(j / SCALE)];
    const urls = {
      'input.jpg': await toBlobURL(upscaleNearest(rgbImage(X, n, lo, hi), SCALE), 'image/jpeg'),
      'bicubic.jpg': await toBlobURL(rgbImage(bic, N, lo, hi), 'image/jpeg'),
      'sr.jpg': await toBlobURL(rgbImage(sr, N, lo, hi), 'image/jpeg'),
      'uncertainty.png': await toBlobURL(cmapImage(rgbMean(std, NN), N, 0, UNC_MAX, 'inferno', true), 'image/png'),
      'ndvi_input.jpg': await toBlobURL(cmapImage(ndInUp, N, -0.1, 0.8, 'RdYlGn', false), 'image/jpeg'),
      'ndvi_sr.jpg': await toBlobURL(cmapImage(ndvi(sr, NN), N, -0.1, 0.8, 'RdYlGn', false), 'image/jpeg'),
    };
    progress(0.97, 'Writing GeoTIFFs');
    const hr = [scene.origin, scene.res / SCALE, scene.epsg];
    const files = {
      sr: geotiff(sr, NB, N, ...hr),
      uncertainty: geotiff(std, NB, N, ...hr),
      input: geotiff(X, NB, n, scene.origin, scene.res, scene.epsg),
    };
    const downloads = {}, sizes = {};
    for (const k in files) { downloads[k] = files[k].url; sizes[k] = files[k].bytes; }
    return Object.assign({
      id: 'live-' + Date.now(), scene: scene.scene, date: scene.date, cloud: scene.cloud, crs: scene.crs,
      extent_km: +(n * 10 / 1000).toFixed(2), metrics, urls, downloads, sizes, runtime_s: +runtime.toFixed(1), tta, backend,
    }, extra);
  }

  async function runPoint({ lat, lon, start, end, size, tta }, progress, log = () => {}) {
    await loadModel(progress);
    const scene = await fetchS2(lat, lon, start, end, size, progress, log);
    return finish(scene, tta, progress, {
      name: `Your pick · ${lat.toFixed(4)}, ${lon.toFixed(4)}`, use: 'Live run on a location chosen by you',
      lat, lon, clear: +scene.clear.toFixed(3),
    });
  }

  async function runUpload(file, tta, progress) {
    await loadModel(progress);
    progress(0.12, 'Reading GeoTIFF');
    const tiff = await GeoTIFF.fromArrayBuffer(await file.arrayBuffer()), img = await tiff.getImage();
    const count = img.getSamplesPerPixel();
    if (![10, 12, 13].includes(count)) throw new Error(`Expected a 10-band Sentinel-2 stack (B2,B3,B4,B5,B6,B7,B8,B8A,B11,B12); got ${count} band(s).`);
    const h = img.getHeight(), w = img.getWidth(), e = Math.min(256, h, w) & ~1;
    if (e < 64) throw new Error('Image too small (need at least 64×64 pixels).');
    const n = e >= 128 ? e : 128, r0 = Math.floor((h - e) / 2), c0 = Math.floor((w - e) / 2);
    const rasters = await img.readRasters({ window: [c0, r0, c0 + e, r0 + e] });
    const sel = count === 12 ? [1, 2, 3, 4, 5, 6, 7, 8, 10, 11] : count === 13 ? [1, 2, 3, 4, 5, 6, 7, 8, 11, 12] : [...Array(10).keys()];
    let mx = 0; for (const b of sel) for (const v of rasters[b]) if (v > mx) mx = v;
    const div = mx > 2 ? 10000 : 1, X = new Float32Array(NB * n * n);
    sel.forEach((b, i) => {
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {      // reflect-pad small inputs up to 128
        const rr = r < e ? r : Math.max(0, 2 * e - 2 - r), cc = c < e ? c : Math.max(0, 2 * e - 2 - c);
        const v = rasters[b][rr * e + cc] / div;
        X[i * n * n + r * n + c] = Number.isFinite(v) ? Math.min(2, Math.max(0, v)) : 0;
      }
    });
    let epsg = 0, origin = [0, 0], res = 10;
    try {
      const gk = img.getGeoKeys() || {};
      epsg = gk.ProjectedCSTypeGeoKey || 0;
      const [ox, oy] = img.getOrigin(), [rx] = img.getResolution();
      res = rx; origin = [ox + c0 * rx, oy - r0 * rx];
    } catch (_) { /* no georeferencing */ }
    const scene = { X, edge: n, epsg, crs: epsg ? `EPSG:${epsg}` : 'unknown', origin, res, scene: file.name, date: 'uploaded', cloud: 0 };
    return finish(scene, tta, progress, { name: `Upload · ${file.name.slice(0, 40)}`, use: 'Your own Sentinel-2 GeoTIFF' });
  }

  window.TrinetraEngine = { runPoint, runUpload, loadModel, get backend() { return backend; } };
})();
