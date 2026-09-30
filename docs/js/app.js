/* TRINETRA-SR — page logic: navigation, gallery, viewer, trust metrics, Live Lab. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const E = window.TrinetraEngine;

  // ------------------------------------------------------------ nav, progress, reveal
  const progress = $('#progress');
  addEventListener('scroll', () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    progress.style.width = (h > 0 ? scrollY / h * 100 : 0) + '%';
  }, { passive: true });
  const links = $$('#navlinks a');
  function makeSectionObs() {
    const sectionObs = new IntersectionObserver(entries => {
      for (const e of entries) if (e.isIntersecting) links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id));
    }, { rootMargin: '-45% 0px -50% 0px' });
    $$('main section[id]').forEach(s => sectionObs.observe(s));
  }
  const revealObs = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); revealObs.unobserve(e.target); }
  }, { threshold: 0.12 });
  function observeReveals(root = document) { root.querySelectorAll('.reveal:not(.in)').forEach(el => revealObs.observe(el)); }

  // ------------------------------------------------------------ state
  const state = { aois: [], cur: null, mode: 'sr', pos: 50, z: 1, tx: 0, ty: 0 };
  const viewer = $('#viewer'), imgL = $('#imgL'), imgR = $('#imgR'), imgU = $('#imgU');
  const asset = (a, f) => a.urls ? a.urls[f] : `data/${a.id}/${f}`;
  const fmtLL = (la, lo) => `${Math.abs(la).toFixed(4)}°${la >= 0 ? 'N' : 'S'}, ${Math.abs(lo).toFixed(4)}°${lo >= 0 ? 'E' : 'W'}`;

  // ------------------------------------------------------------ gallery
  function card(a) {
    const b = document.createElement('button');
    b.className = 'card glass'; b.type = 'button'; b.dataset.id = a.id;
    const live = !!a.urls;
    b.innerHTML = `<div class="thumb" style="background-image:url('${asset(a, 'sr.jpg')}')"><span class="badge ${live ? 'live' : ''}">${live ? 'LIVE RUN' : 'STUDY AREA'}</span></div>
      <h4></h4><small>${a.date} · ${a.metrics.consistency_psnr_db} dB</small>`;
    b.querySelector('h4').textContent = a.name.replace(/^Your pick · /, '');
    b.onclick = () => selectAoi(a);
    return b;
  }
  function renderGallery() {
    const g = $('#gallery'); g.innerHTML = '';
    state.aois.forEach(a => g.appendChild(card(a)));
    markGallery();
  }
  function markGallery() { $$('.card').forEach(c => c.classList.toggle('on', state.cur && c.dataset.id === state.cur.id)); }

  // ------------------------------------------------------------ viewer
  function render() {
    const t = `translate(${state.tx}px,${state.ty}px) scale(${state.z})`;
    [imgL, imgR, imgU].forEach(i => i.style.transform = t);
    $('#R').style.clipPath = `inset(0 0 0 ${state.pos}%)`;
    $('#div').style.left = state.pos + '%';
    if (state.cur) {
      const pxPerM = viewer.clientWidth * state.z / (state.cur.extent_km * 1000);
      const nice = [10, 20, 50, 100, 200, 500, 1000].find(m => m * pxPerM > 60) || 1000;
      $('#sbw').style.width = (nice * pxPerM) + 'px';
      $('#sbl').textContent = nice >= 1000 ? nice / 1000 + ' km' : nice + ' m';
    }
  }
  function setImages() {
    const a = state.cur, m = state.mode;
    $('#loading').style.display = 'grid';
    const L = m === 'sr' ? 'input.jpg' : m === 'bic' ? 'bicubic.jpg' : 'ndvi_input.jpg';
    const R = m === 'ndvi' ? 'ndvi_sr.jpg' : 'sr.jpg';
    imgL.className = m === 'bic' ? '' : 'px';
    $('#lblL').textContent = m === 'sr' ? 'Sentinel-2 · 10 m native' : m === 'bic' ? 'Bicubic · 2.5 m' : 'NDVI · 10 m';
    $('#lblR').textContent = m === 'ndvi' ? 'NDVI · 2.5 m' : 'TRINETRA · 2.5 m';
    let n = 0; const done = () => { if (++n === 2) $('#loading').style.display = 'none'; };
    imgL.onload = imgR.onload = imgL.onerror = imgR.onerror = done;
    imgL.src = asset(a, L); imgR.src = asset(a, R); imgU.src = asset(a, 'uncertainty.png');
    updateLegend();
  }
  function updateLegend() {
    const u = $('#unc').checked, nd = state.mode === 'ndvi';
    imgU.style.display = u ? 'block' : 'none';
    imgU.style.opacity = $('#uncop').value / 100;
    $('#legend').style.display = (u || nd) ? 'block' : 'none';
    if (u) { $('#legT').textContent = 'Uncertainty σ (reflectance)'; $('#legBar').className = 'bar'; $('#leg0').textContent = '0'; $('#leg1').textContent = '≥0.02'; }
    else if (nd) { $('#legT').textContent = 'NDVI'; $('#legBar').className = 'bar ndvi'; $('#leg0').textContent = '−0.1'; $('#leg1').textContent = '0.8'; }
  }
  function selectAoi(a) {
    state.cur = a; state.z = 1; state.tx = state.ty = 0;
    $('#aoiName').textContent = a.name;
    $('#aoiUse').textContent = a.use;
    const rows = [
      ['Acquired', a.date], ['Scene cloud', a.cloud + ' %'], ['Extent', `${a.extent_km} × ${a.extent_km} km`],
      ['Resolution', '10 m → 2.5 m'], ['Bands', '10 · VNIR, RE, SWIR'], ['CRS', a.crs],
    ];
    if (a.lat !== undefined) rows.push(['Centre', fmtLL(a.lat, a.lon)]);
    if (a.backend) rows.push(['Computed', `your browser · ${a.backend} · ${a.runtime_s} s`]);
    $('#aoiMeta').innerHTML = rows.map(([k, v]) => `<span>${k}</span><b>${v}</b>`).join('');
    const dl = a.downloads;
    $('#dlcard').style.display = dl ? 'block' : 'none';
    if (dl) {
      const tag = (a.scene || 'trinetra').replace(/[^\w.-]+/g, '_').slice(0, 40);
      $('#dls').innerHTML = [['sr', 'Super-resolved · 2.5 m', '_sr_2p5m'], ['uncertainty', 'Uncertainty σ · 2.5 m', '_uncertainty_2p5m'], ['input', 'Sentinel-2 input · 10 m', '_input_10m']]
        .map(([k, n, suf]) => `<a href="${dl[k]}" download="${tag}${suf}.tif">${n}<span>10 bands · .tif</span></a>`).join('');
    }
    renderMetrics(a);
    markGallery(); setImages(); render();
  }
  function zoomAt(f, cx, cy) {
    const nz = Math.min(12, Math.max(1, state.z * f));
    state.tx = cx - (cx - state.tx) * nz / state.z;
    state.ty = cy - (cy - state.ty) * nz / state.z;
    state.z = nz; clamp(); render();
  }
  function clamp() {
    const w = viewer.clientWidth, h = viewer.clientHeight;
    state.tx = Math.min(0, Math.max(w - w * state.z, state.tx));
    state.ty = Math.min(0, Math.max(h - h * state.z, state.ty));
  }
  viewer.addEventListener('wheel', e => {
    e.preventDefault();
    const r = viewer.getBoundingClientRect();
    zoomAt(e.deltaY < 0 ? 1.25 : 0.8, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });
  let drag = null;
  viewer.addEventListener('pointerdown', e => {
    if (e.target.closest('.zoomctl')) return;
    drag = { kind: e.target.closest('#handle') ? 'div' : 'pan', x: e.clientX, y: e.clientY, tx: state.tx, ty: state.ty };
    viewer.setPointerCapture(e.pointerId);
    if (drag.kind === 'pan') viewer.classList.add('dragging');
  });
  viewer.addEventListener('pointermove', e => {
    if (!drag) return;
    const r = viewer.getBoundingClientRect();
    if (drag.kind === 'div') state.pos = Math.min(100, Math.max(0, (e.clientX - r.left) / r.width * 100));
    else { state.tx = drag.tx + e.clientX - drag.x; state.ty = drag.ty + e.clientY - drag.y; clamp(); }
    render();
  });
  const endDrag = () => { drag = null; viewer.classList.remove('dragging'); };
  viewer.addEventListener('pointerup', endDrag); viewer.addEventListener('pointercancel', endDrag);
  const mid = () => [viewer.clientWidth / 2, viewer.clientHeight / 2];
  $('#zin').onclick = () => zoomAt(1.6, ...mid());
  $('#zout').onclick = () => zoomAt(1 / 1.6, ...mid());
  $('#zreset').onclick = () => { state.z = 1; state.tx = state.ty = 0; render(); };
  addEventListener('resize', () => { clamp(); render(); });
  $('#mode').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    state.mode = b.dataset.m;
    $$('#mode button').forEach(x => x.classList.toggle('on', x === b));
    setImages();
  };
  $('#unc').onchange = updateLegend; $('#uncop').oninput = updateLegend;

  // ------------------------------------------------------------ trust metrics
  const METRICS = [
    ['consistency_psnr_db', '10 m consistency', 'dB', v => v >= 40, v => (v - 20) / 40,
      'Output degraded to 10 m vs the real B2, B3, B4, B8 input. Above 40 dB means the radiometry is preserved.'],
    ['consistency_psnr_20m_db', '20 m consistency', 'dB', v => v >= 33, v => (v - 20) / 30,
      'Red-edge and SWIR bands checked at their native 20 m grid.'],
    ['spectral_angle_deg', 'Spectral angle', '°', v => v <= 1.5, v => 1 - v / 5,
      'Mean angle between input and output spectra. Lower means colours and indices are unchanged.'],
    ['ndvi_mae', 'NDVI deviation', '', v => v <= 0.02, v => 1 - v / 0.05,
      'Mean |ΔNDVI| after degradation. Vegetation analytics stay valid.'],
    ['sharpness_gain_vs_bicubic', 'Sharpness gain', '×', v => v >= 1.1, v => (v - 1) / 0.5,
      'Edge energy relative to bicubic upsampling of the same scene.'],
    ['high_uncertainty_pct', 'Flagged as uncertain', '%', v => v <= 5, v => 1 - v / 10,
      'Share of pixels where the ensemble disagrees (σ > 0.01). These are shown on the trust map.'],
  ];
  function renderMetrics(a) {
    $('#trustCtx').innerHTML = `Showing <b>${a.name}</b> · ${a.date}`;
    $('#metrics').innerHTML = METRICS.map(([k, name, unit, good, frac, text]) => {
      const v = a.metrics[k], ok = good(v), w = Math.max(4, Math.min(100, frac(v) * 100));
      return `<div class="metric glass"><div class="lbl">${name}</div>
        <div class="val">${v}<small>${unit}</small></div><p>${text}</p>
        <div class="meter"><div style="width:${w}%;background:${ok ? 'var(--good)' : 'var(--saffron)'}"></div></div>
        <div class="verdict ${ok ? 'ok' : 'warn'}">${ok ? '● within target' : '● review'}</div></div>`;
    }).join('');
  }

  // ------------------------------------------------------------ roadmap
  const tick = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5cf2b0" stroke-width="2.4"><path d="M5 12l5 5L20 7"/></svg>';
  const arrow = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffb454" stroke-width="2.2"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  $('#liveList').innerHTML = [
    ['4× SR on all 10 bands', 'VNIR, red-edge and SWIR to 2.5 m, so NDVI, NDRE and NBR are available at 2.5 m.'],
    ['Per-pixel trust map', '8-fold dihedral ensemble uncertainty shipped with every product.'],
    ['Radiometric validation', 'Native-resolution consistency, spectral angle and NDVI checks on every run.'],
    ['Anywhere, on demand', 'Map search, cloud-aware scene selection, GeoTIFF export, all in the browser.'],
  ].map(([b, s]) => `<li>${tick}<div><b>${b}</b><span>${s}</span></div></li>`).join('');
  $('#nextList').innerHTML = [
    ['Multi-temporal fusion', 'Fuse several 5-day revisits so extra detail is partly observed from sub-pixel shifts.'],
    ['Calibrated uncertainty', 'Conformal prediction intervals with guaranteed coverage on held-out pairs.'],
    ['Fidelity ↔ detail dial', 'A diffusion refiner for visual detail, blended live against the fidelity model.'],
    ['Task-level validation', 'Building, road, field-boundary and change-detection gains on an India test set.'],
  ].map(([b, s]) => `<li>${arrow}<div><b>${b}</b><span>${s}</span></div></li>`).join('');

  // ------------------------------------------------------------ Live Lab: map
  const iso = d => d.toISOString().slice(0, 10);
  const today = new Date();
  $('#d1').value = iso(today);
  $('#d0').value = iso(new Date(today - 365 * 864e5));
  const lab = { lat: 17.385, lon: 78.4867, size: 128, tta: 4, name: 'Hyderabad' };

  let map, marker, box;
  function footprint() {
    const half = lab.size * 10 / 2, dLa = half / 111320, dLo = half / (111320 * Math.cos(lab.lat * Math.PI / 180));
    return [[lab.lat - dLa, lab.lon - dLo], [lab.lat + dLa, lab.lon + dLo]];
  }
  function setPlace(lat, lon, name, fly) {
    lab.lat = +lat; lab.lon = +lon; lab.name = name || 'Selected point';
    $('#placeName').textContent = lab.name;
    $('#placeCoords').textContent = fmtLL(lab.lat, lab.lon);
    if (map) {
      marker.setLatLng([lab.lat, lab.lon]); box.setBounds(footprint());
      if (fly) map.flyTo([lab.lat, lab.lon], Math.max(map.getZoom(), 14), { duration: 1.2 });
    }
  }
  if (window.L) {
    map = L.map('map', { zoomControl: false, attributionControl: true }).setView([lab.lat, lab.lon], 13);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics (navigation only)' }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18, opacity: 0.85 }).addTo(map);
    marker = L.circleMarker([lab.lat, lab.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#5ee7ff', fillOpacity: 1 }).addTo(map);
    box = L.rectangle(footprint(), { color: '#ffb454', weight: 2, fillOpacity: 0.06, dashArray: '6 5' }).addTo(map);
    map.on('click', e => { setPlace(e.latlng.lat, e.latlng.lng, 'Selected point'); reverseName(e.latlng.lat, e.latlng.lng); });
  }
  function seg(id, key) {
    $(id).onclick = e => {
      const b = e.target.closest('button'); if (!b) return;
      $$(id + ' button').forEach(x => x.classList.toggle('on', x === b));
      lab[key] = +b.dataset.v;
      if (key === 'size' && box) box.setBounds(footprint());
    };
  }
  seg('#size', 'size'); seg('#tta', 'tta');

  // ------------------------------------------------------------ Live Lab: location search (Photon / OpenStreetMap)
  const q = $('#q'), qres = $('#qres');
  let qTimer, qCtl, hits = [], act = -1;
  const label = f => {
    const p = f.properties, parts = [p.name, p.city !== p.name ? p.city : null, p.state, p.country].filter(Boolean);
    const kind = p.osm_value && !['yes', 'no'].includes(p.osm_value) ? ` · ${p.osm_value.replace(/_/g, ' ')}` : '';
    return { title: parts[0] || 'Unnamed place', sub: parts.slice(1).join(', ') + kind };
  };
  function showHits() {
    if (!hits.length) { qres.innerHTML = '<div class="empty">No places found.</div>'; qres.classList.add('open'); return; }
    qres.innerHTML = hits.map((f, i) => { const l = label(f); return `<button type="button" role="option" data-i="${i}" class="${i === act ? 'act' : ''}"><b></b><small></small></button>`; }).join('');
    qres.querySelectorAll('button').forEach((b, i) => { const l = label(hits[i]); b.querySelector('b').textContent = l.title; b.querySelector('small').textContent = l.sub; });
    qres.classList.add('open');
  }
  function choose(i) {
    const f = hits[i]; if (!f) return;
    const [lon, lat] = f.geometry.coordinates, l = label(f);
    q.value = l.title; qres.classList.remove('open');
    setPlace(lat, lon, l.title, true);
  }
  async function search(text) {
    if (qCtl) qCtl.abort();
    qCtl = new AbortController();
    try {
      const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=7&lang=en`, { signal: qCtl.signal });
      hits = (await r.json()).features || [];
    } catch (e) {
      if (e.name === 'AbortError') return;
      try {   // fallback: single Nominatim query (on explicit search only)
        const r = await fetch(`https://nominatim.openstreetmap.org/search?format=geojson&limit=6&q=${encodeURIComponent(text)}`);
        hits = ((await r.json()).features || []).map(f => ({ ...f, properties: { name: f.properties.display_name.split(',')[0], state: f.properties.display_name.split(',').slice(1, 3).join(',').trim() } }));
      } catch (_) { hits = []; }
    }
    act = -1; showHits();
  }
  q.addEventListener('input', () => {
    clearTimeout(qTimer);
    const t = q.value.trim();
    if (t.length < 3) { qres.classList.remove('open'); return; }
    qTimer = setTimeout(() => search(t), 320);
  });
  q.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      if (!hits.length) return; e.preventDefault();
      act = (act + (e.key === 'ArrowDown' ? 1 : -1) + hits.length) % hits.length; showHits();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (act >= 0) choose(act); else if (hits.length && qres.classList.contains('open')) choose(0); else if (q.value.trim()) search(q.value.trim());
    } else if (e.key === 'Escape') qres.classList.remove('open');
  });
  qres.addEventListener('click', e => { const b = e.target.closest('button'); if (b) choose(+b.dataset.i); });
  document.addEventListener('click', e => { if (!e.target.closest('#search')) qres.classList.remove('open'); });
  let revTimer;
  function reverseName(lat, lon) {
    clearTimeout(revTimer);
    revTimer = setTimeout(async () => {
      try {
        const r = await fetch(`https://photon.komoot.io/reverse?lat=${lat}&lon=${lon}&lang=en`);
        const f = ((await r.json()).features || [])[0];
        if (f && Math.abs(lab.lat - lat) < 1e-9) {
          const p = f.properties;
          setPlace(lat, lon, [p.name || p.street, p.city || p.county || p.state].filter(Boolean).slice(0, 2).join(', ') || 'Selected point');
        }
      } catch (_) { /* keep generic name */ }
    }, 250);
  }
  $('#locate').onclick = () => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(p => { setPlace(p.coords.latitude, p.coords.longitude, 'Your location', true); reverseName(p.coords.latitude, p.coords.longitude); },
      () => { $('#err').textContent = 'Location permission was denied.'; }, { timeout: 8000 });
  };

  // ------------------------------------------------------------ Live Lab: engine
  function engineStatus(ok, txt) { $('#engDot').className = 'dot ' + (ok ? 'on' : 'off'); $('#engTxt').textContent = txt; }
  const libsOk = E && window.ort && window.GeoTIFF && window.proj4;
  engineStatus(!!libsOk, libsOk ? 'engine ready' : 'engine failed to load');
  function setBusy(b) { $('#run').disabled = b; $('#drop').style.pointerEvents = b ? 'none' : ''; $('#run').textContent = b ? 'Working…' : 'Super-resolve this place'; }
  function showProgress(p, s) { $('#bar').style.width = Math.round(p * 100) + '%'; $('#stage').textContent = s; }
  async function launch(job, pinAt) {
    $('#err').textContent = ''; setBusy(true); showProgress(0.01, 'starting…');
    try {
      const r = await job(showProgress);
      showProgress(1, `done · ${r.runtime_s} s on ${r.backend} · scene ${r.date}`);
      engineStatus(true, r.backend);
      if (pinAt) r.name = `${lab.name}`;
      state.aois.unshift(r); renderGallery(); selectAoi(r);
      if (pinAt && window.Globe) window.Globe.addPin(pinAt[0], pinAt[1], lab.name, () => { selectAoi(r); go('#results'); }, true);
      go('#results');
    } catch (e) {
      console.error(e); showProgress(0, '');
      $('#err').textContent = (e && e.message) || String(e);
    } finally { setBusy(false); }
  }
  $('#run').onclick = () => launch(p => E.runPoint({
    lat: lab.lat, lon: lab.lon, start: $('#d0').value, end: $('#d1').value, size: lab.size, tta: lab.tta,
  }, p, m => console.log('[engine]', m)), [lab.lat, lab.lon]);
  const fileIn = $('#file'), drop = $('#drop');
  fileIn.onchange = () => { const f = fileIn.files[0]; if (f) launch(p => E.runUpload(f, lab.tta, p)); fileIn.value = ''; };
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if (f) launch(p => E.runUpload(f, lab.tta, p)); });

  function go(sel) { const el = $(sel); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); }

  // ------------------------------------------------------------ boot
  makeSectionObs(); observeReveals();
  function addPresetPins() {
    if (!window.Globe || addPresetPins.done) return;
    addPresetPins.done = true;
    state.aois.filter(a => !a.urls).forEach(a => window.Globe.addPin(a.lat, a.lon, a.name.split(/[—,]/)[0].trim(), () => { selectAoi(a); go('#results'); }));
  }
  fetch('data/index.json').then(r => r.json()).then(list => {
    state.aois = list;
    renderGallery();
    if (list.length) selectAoi(list[0]);
    const avg = list.reduce((s, a) => s + a.metrics.consistency_psnr_db, 0) / list.length;
    $('#chipPsnr').textContent = `~${Math.round(avg)} dB`;
    if (window.Globe) addPresetPins(); else addEventListener('globe-ready', addPresetPins, { once: true });
  }).catch(() => { $('#loading').textContent = 'No preset data found.'; });
})();
