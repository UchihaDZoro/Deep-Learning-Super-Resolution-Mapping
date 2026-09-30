/* TRINETRA-SR — page logic: navigation, gallery, viewer, validation metrics, Live Lab. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => [...document.querySelectorAll(s)];
  const E = window.TrinetraEngine;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtLL = (la, lo) => `${Math.abs(la).toFixed(4)}°${la >= 0 ? 'N' : 'S'}, ${Math.abs(lo).toFixed(4)}°${lo >= 0 ? 'E' : 'W'}`;
  const fmtBytes = b => b > 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.round(b / 1e3) + ' KB';
  const fmtDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d) ? new Date(d + 'T00:00:00Z').toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) : 'Not recorded';

  // ------------------------------------------------------------ nav, progress, reveal
  const progress = $('#progress');
  addEventListener('scroll', () => {
    const h = document.documentElement.scrollHeight - innerHeight;
    progress.style.width = (h > 0 ? scrollY / h * 100 : 0) + '%';
  }, { passive: true });
  const links = $$('#navlinks a');
  const sectionObs = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id));
  }, { rootMargin: '-45% 0px -50% 0px' });
  $$('main section[id]').forEach(s => sectionObs.observe(s));
  addEventListener('scroll', () => {          // the last section never reaches mid-screen: light it at the page bottom
    if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) links.forEach((l, i) => l.classList.toggle('on', i === links.length - 1));
  }, { passive: true });
  const revealObs = new IntersectionObserver(entries => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('in'); revealObs.unobserve(e.target); }
  }, { threshold: 0.12 });
  $$('.reveal').forEach(el => revealObs.observe(el));
  const go = sel => { const el = $(sel); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  function segmented(id, onPick) {
    $(id).addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      $$(id + ' button').forEach(x => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-checked', on); });
      onPick(b);
    });
  }

  // ------------------------------------------------------------ state
  const state = { aois: [], cur: null, mode: 'sr', pos: 50, z: 1, tx: 0, ty: 0 };
  const viewer = $('#viewer'), imgL = $('#imgL'), imgR = $('#imgR'), imgU = $('#imgU');
  const asset = (a, f) => a.urls ? a.urls[f] : `data/${a.id}/${f}`;
  const kindOf = a => a.urls ? (a.lat === undefined ? 'Uploaded scene' : 'Live run') : 'Study area';

  // ------------------------------------------------------------ gallery
  function card(a) {
    const b = document.createElement('button');
    b.className = 'card glass'; b.type = 'button'; b.dataset.id = a.id; b.setAttribute('role', 'listitem');
    const k = kindOf(a);
    b.innerHTML = `<div class="thumb" style="background-image:url('${asset(a, 'sr.jpg')}')"><span class="badge ${a.urls ? 'live' : ''}">${k}</span></div>
      <h4>${esc(a.name)}</h4><div class="meta"><span>${a.lat !== undefined || !a.urls ? fmtDate(a.date) : 'Uploaded file'}</span><b>${a.metrics.consistency_psnr_db.toFixed(1)} dB</b></div>`;
    b.onclick = () => selectAoi(a);
    return b;
  }
  function renderGallery() {
    const g = $('#gallery'); g.innerHTML = '';
    state.aois.forEach(a => g.appendChild(card(a)));
    markGallery();
  }
  function markGallery() { $$('.card').forEach(c => { const on = !!state.cur && c.dataset.id === state.cur.id; c.classList.toggle('on', on); c.setAttribute('aria-current', on); }); }

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
    $('#lblL').textContent = m === 'sr' ? 'Sentinel-2 · 10 m' : m === 'bic' ? 'Bicubic · 2.5 m' : 'NDVI · 10 m';
    $('#lblR').textContent = m === 'ndvi' ? 'NDVI · 2.5 m' : 'TRINETRA-SR · 2.5 m';
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
    if (u) { $('#legT').textContent = 'Uncertainty σ (reflectance)'; $('#legBar').className = 'bar'; $('#leg0').textContent = '0'; $('#leg1').textContent = '≥ 0.02'; }
    else if (nd) { $('#legT').textContent = 'NDVI'; $('#legBar').className = 'bar ndvi'; $('#leg0').textContent = '−0.1'; $('#leg1').textContent = '0.8'; }
  }
  const DL_ICON = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="M12 4v12M7 11l5 5 5-5"/><path d="M4 20h16"/></svg>';
  function selectAoi(a) {
    state.cur = a; state.z = 1; state.tx = state.ty = 0;
    $('#aoiKind').textContent = kindOf(a);
    $('#aoiName').textContent = a.name;
    $('#aoiUse').textContent = a.use;
    const rows = [
      ['Acquired', fmtDate(a.date)], ...(a.lat !== undefined || !a.urls ? [['Scene cloud cover', a.cloud + ' %']] : []), ['Extent', `${a.extent_km} × ${a.extent_km} km`],
      ['Ground sampling', '10 m → 2.5 m'], ['Bands', '10 (VNIR, red-edge, SWIR)'], ['Projection', a.crs],
    ];
    if (a.lat !== undefined) rows.push(['Centre', fmtLL(a.lat, a.lon)]);
    if (a.backend) rows.push(['Processed', `in browser · ${a.backend} · ${a.runtime_s} s`]);
    $('#aoiMeta').innerHTML = rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('');
    const dl = a.downloads;
    if (dl) {
      const tag = (a.scene || 'trinetra').replace(/[^\w.-]+/g, '_').replace(/\.tiff?$/i, '').slice(0, 44);
      const size = k => a.sizes && a.sizes[k] ? fmtBytes(a.sizes[k]) : '';
      $('#dls').innerHTML = [
        ['sr', 'Super-resolved image', '2.5 m · 10 bands', '_TRINETRA_2p5m'],
        ['uncertainty', 'Uncertainty layer', '2.5 m · σ per band', '_uncertainty_2p5m'],
        ['input', 'Sentinel-2 input', '10 m · 10 bands', '_input_10m'],
      ].map(([k, n, d, suf]) => `<a href="${dl[k]}" download="${tag}${suf}.tif"><span class="dl-ic">${DL_ICON}</span>
          <span class="dl-txt"><b>${n}</b><span>GeoTIFF · ${d}</span></span><span class="dl-size">${size(k)}</span></a>`).join('');
    } else {
      $('#dls').innerHTML = `<p class="dls-empty">GeoTIFF exports are generated for every scene processed in the Live Lab, in the source UTM projection with reflectance scaled ×10000. <a href="#lab">Process a location</a> to download one.</p>`;
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
  viewer.addEventListener('keydown', e => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      state.pos = Math.min(100, Math.max(0, state.pos + (e.key === 'ArrowLeft' ? -4 : 4))); render(); e.preventDefault();
    } else if (e.key === '+' || e.key === '=') zoomAt(1.4, ...mid());
    else if (e.key === '-') zoomAt(1 / 1.4, ...mid());
  });
  const mid = () => [viewer.clientWidth / 2, viewer.clientHeight / 2];
  $('#zin').onclick = () => zoomAt(1.6, ...mid());
  $('#zout').onclick = () => zoomAt(1 / 1.6, ...mid());
  $('#zreset').onclick = () => { state.z = 1; state.tx = state.ty = 0; state.pos = 50; render(); };
  $('#fs').onclick = () => { if (document.fullscreenElement) document.exitFullscreen(); else viewer.requestFullscreen && viewer.requestFullscreen(); };
  document.addEventListener('fullscreenchange', () => setTimeout(() => { clamp(); render(); }, 50));
  addEventListener('resize', () => { clamp(); render(); });
  segmented('#mode', b => { state.mode = b.dataset.m; setImages(); });
  $('#unc').onchange = updateLegend; $('#uncop').oninput = updateLegend;

  // ------------------------------------------------------------ validation metrics
  const METRICS = [
    ['consistency_psnr_db', 'Consistency · 10 m bands', 'dB', 1, v => v >= 40, v => (v - 20) / 40,
      'Output degraded to 10 m and compared with the measured B2, B3, B4 and B8. Target above 40 dB.'],
    ['consistency_psnr_20m_db', 'Consistency · 20 m bands', 'dB', 1, v => v >= 33, v => (v - 20) / 30,
      'Red-edge, B8A and SWIR checked on their native 20 m grid. Target above 33 dB.'],
    ['spectral_angle_deg', 'Spectral angle', '°', 2, v => v <= 1.5, v => 1 - v / 5,
      'Mean angle between measured and reproduced spectra. Target below 1.5°.'],
    ['ndvi_mae', 'NDVI deviation', '', 3, v => v <= 0.02, v => 1 - v / 0.05,
      'Mean absolute NDVI change after degradation. Target below 0.02.'],
    ['sharpness_gain_vs_bicubic', 'Detail gain', '×', 2, v => v >= 1.1, v => (v - 1) / 0.5,
      'Edge energy relative to bicubic interpolation of the same scene.'],
    ['high_uncertainty_pct', 'Flagged as uncertain', '%', 2, v => v <= 5, v => 1 - v / 10,
      'Share of pixels where ensemble spread exceeds σ = 0.01. These are highlighted on the uncertainty map.'],
  ];
  function renderMetrics(a) {
    $('#trustCtx').innerHTML = `${kindOf(a)} · <b>${esc(a.name)}</b> · ${fmtDate(a.date)}`;
    $('#metrics').innerHTML = METRICS.map(([k, name, unit, dp, good, frac, text]) => {
      const v = a.metrics[k], ok = good(v), w = Math.max(4, Math.min(100, frac(v) * 100));
      return `<div class="metric glass"><div class="lbl">${name}</div>
        <div class="val">${v.toFixed(dp)}<small>${unit}</small></div><p>${text}</p>
        <div class="meter"><div style="width:${w}%;background:${ok ? 'var(--good)' : 'var(--saffron)'}"></div></div>
        <div class="verdict ${ok ? 'ok' : 'warn'}">${ok ? 'Within target' : 'Review'}</div></div>`;
    }).join('');
  }

  // ------------------------------------------------------------ roadmap
  const tick = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#5cf2b0" stroke-width="2.4" aria-hidden="true"><path d="M5 12l5 5L20 7"/></svg>';
  const arrow = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ffb454" stroke-width="2.2" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>';
  $('#liveList').innerHTML = [
    ['All ten bands to 2.5 m', 'Visible, NIR, red-edge and SWIR, so NDVI, NDRE, NDWI and NBR are available at 2.5 m.'],
    ['Per-pixel uncertainty', 'An eight-member rotation and reflection ensemble, delivered as a GeoTIFF layer.'],
    ['Automatic validation', 'Native-resolution consistency, spectral angle and NDVI checks on every product.'],
    ['On demand, anywhere', 'Place search, cloud-aware scene selection and GeoTIFF export, all client-side.'],
  ].map(([b, s]) => `<li>${tick}<div><b>${b}</b><span>${s}</span></div></li>`).join('');
  $('#nextList').innerHTML = [
    ['Adaptation to Indian landscapes', 'Fine-tune the pretrained network on Indian reference imagery: smallholder farms, dense settlements, monsoon haze.'],
    ['Multi-temporal fusion', 'Combine several five-day revisits so part of the added detail is observed through sub-pixel shifts.'],
    ['Calibrated uncertainty', 'Conformal prediction intervals with guaranteed coverage on held-out reference pairs.'],
    ['Task-level evaluation', 'Measure gains in building, road, field-boundary and change detection on an Indian test set.'],
  ].map(([b, s]) => `<li>${arrow}<div><b>${b}</b><span>${s}</span></div></li>`).join('');

  // ------------------------------------------------------------ Live Lab: map
  const iso = d => d.toISOString().slice(0, 10);
  const today = new Date();
  $('#d1').value = iso(today); $('#d1').max = iso(today);
  $('#d0').value = iso(new Date(today - 365 * 864e5)); $('#d0').min = '2017-03-28';
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
    $('#err').textContent = '';
    if (map) {
      marker.setLatLng([lab.lat, lab.lon]); box.setBounds(footprint());
      if (fly) map.flyTo([lab.lat, lab.lon], Math.max(map.getZoom(), 14), { duration: 1.2 });
    }
  }
  if (window.L) {
    map = L.map('map', { zoomControl: false, attributionControl: true }).setView([lab.lat, lab.lon], 13);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' }).addTo(map);
    L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 18, opacity: 0.85 }).addTo(map);
    marker = L.circleMarker([lab.lat, lab.lon], { radius: 7, color: '#fff', weight: 2, fillColor: '#5ee7ff', fillOpacity: 1 }).addTo(map);
    box = L.rectangle(footprint(), { color: '#ffb454', weight: 2, fillOpacity: 0.06, dashArray: '6 5' }).addTo(map);
    map.on('click', e => { setPlace(e.latlng.lat, e.latlng.lng, 'Selected point'); reverseName(e.latlng.lat, e.latlng.lng); });
  }
  segmented('#size', b => { lab.size = +b.dataset.v; if (box) box.setBounds(footprint()); });
  segmented('#tta', b => { lab.tta = +b.dataset.v; });

  // ------------------------------------------------------------ Live Lab: place search (Photon / OpenStreetMap)
  const q = $('#q'), qres = $('#qres');
  let qTimer, qCtl, hits = [], act = -1;
  // prefer places, landmarks and heritage over shops, hotels and businesses with similar names
  const RANK = { place: 0, boundary: 0, historic: 0, tourism: 1, natural: 1, amenity: 2, leisure: 2, aeroway: 2, railway: 3, highway: 3, building: 3, shop: 5, office: 5, craft: 5 };
  const rankOf = p => {
    let r = RANK[p.osm_key] ?? 3;
    if (p.osm_key === 'tourism' && /hotel|guest_house|hostel|motel|apartment/.test(p.osm_value || '')) r = 5;
    if (p.osm_key === 'amenity' && /place_of_worship|university|college/.test(p.osm_value || '')) r = 1;
    if (/\b(tour|travels?|hotel|restaurant|agency)\b/i.test(p.name || '')) r = Math.max(r, 4);
    return r;
  };
  const label = f => {
    const p = f.properties, parts = [p.name, p.city !== p.name ? p.city : null, p.state, p.country].filter(Boolean);
    const kind = p.osm_value && !['yes', 'no'].includes(p.osm_value) ? ` · ${p.osm_value.replace(/_/g, ' ')}` : '';
    return { title: parts[0] || 'Unnamed place', sub: parts.slice(1).join(', ') + kind };
  };
  function showHits() {
    if (!hits.length) { qres.innerHTML = '<div class="empty">No matching places.</div>'; qres.classList.add('open'); return; }
    qres.innerHTML = hits.map((f, i) => { const l = label(f); return `<button type="button" role="option" data-i="${i}" aria-selected="${i === act}" class="${i === act ? 'act' : ''}"><b>${esc(l.title)}</b><small>${esc(l.sub)}</small></button>`; }).join('');
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
      const r = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=10&lang=en`, { signal: qCtl.signal });
      const feats = (await r.json()).features || [];
      hits = feats.map((f, i) => ({ f, i, r: rankOf(f.properties) })).sort((a, b) => a.r - b.r || a.i - b.i).slice(0, 6).map(x => x.f);
    } catch (e) {
      if (e.name === 'AbortError') return;
      try {   // fallback: a single Nominatim query
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
    qTimer = setTimeout(() => search(t), 300);
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
      } catch (_) { /* keep the generic name */ }
    }, 250);
  }
  $('#locate').onclick = () => {
    if (!navigator.geolocation) { $('#err').textContent = 'Geolocation is not available in this browser.'; return; }
    navigator.geolocation.getCurrentPosition(p => { setPlace(p.coords.latitude, p.coords.longitude, 'Your location', true); reverseName(p.coords.latitude, p.coords.longitude); },
      () => { $('#err').textContent = 'Location access was declined. Search for a place or click the map instead.'; }, { timeout: 8000 });
  };

  // ------------------------------------------------------------ Live Lab: engine
  function engineStatus(ok, txt) { $('#engDot').className = 'dot ' + (ok ? 'on' : 'off'); $('#engTxt').textContent = txt; }
  const libsOk = E && window.ort && window.GeoTIFF && window.proj4;
  engineStatus(!!libsOk, libsOk ? 'Engine ready' : 'Engine unavailable');
  const runLabel = $('#run span'), upNote = $('#upNote'), upDefault = upNote.innerHTML, drop = $('#drop'), fileIn = $('#file');
  function setBusy(b) {
    $('#run').disabled = b; drop.classList.toggle('busy', b);
    runLabel.textContent = b ? 'Processing…' : 'Super-resolve this location';
  }
  function showProgress(p, s) { $('#bar').style.width = Math.round(p * 100) + '%'; $('#stage').textContent = s; }
  async function launch(job, opts = {}) {
    if (!libsOk) { $('#err').textContent = 'The inference engine failed to load. Check your connection and reload the page.'; return; }
    $('#err').textContent = ''; setBusy(true); showProgress(0.01, 'Starting');
    try {
      const r = await job(showProgress);
      showProgress(1, `Completed in ${r.runtime_s} s on ${r.backend}` + (r.lat !== undefined ? ` · scene of ${fmtDate(r.date)}` : ''));
      engineStatus(true, r.backend);
      if (opts.name) r.name = opts.name;
      state.aois.unshift(r); renderGallery(); selectAoi(r);
      if (opts.pin && window.Globe) window.Globe.addPin(opts.pin[0], opts.pin[1], r.name, () => { selectAoi(r); go('#results'); }, true);
      go('#results');
    } catch (e) {
      console.error(e); showProgress(0, '');
      $('#err').textContent = (e && e.message) || String(e);
    } finally { setBusy(false); upNote.innerHTML = upDefault; }
  }
  $('#run').onclick = () => launch(p => E.runPoint({
    lat: lab.lat, lon: lab.lon, start: $('#d0').value, end: $('#d1').value, size: lab.size, tta: lab.tta,
  }, p, m => console.log('[engine]', m)), { name: lab.name, pin: [lab.lat, lab.lon] });
  function takeFile(f) {
    if (!f) return;
    if (!/\.tiff?$/i.test(f.name)) { $('#err').textContent = 'Please choose a GeoTIFF file (.tif or .tiff).'; return; }
    if (f.size > 60 * 1024 * 1024) { $('#err').textContent = 'That file is larger than 60 MB. Crop it to the area of interest first.'; return; }
    upNote.innerHTML = `Processing <b>${esc(f.name)}</b> · ${fmtBytes(f.size)}`;
    launch(p => E.runUpload(f, lab.tta, p));
  }
  fileIn.onchange = () => { takeFile(fileIn.files[0]); fileIn.value = ''; };
  ['dragenter', 'dragover'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', e => takeFile(e.dataTransfer.files[0]));

  // ------------------------------------------------------------ boot
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
    $('#chipPsnr').textContent = `${Math.round(avg)} dB`;
    if (window.Globe) addPresetPins(); else addEventListener('globe-ready', addPresetPins, { once: true });
  }).catch(() => { $('#loading').innerHTML = '<span style="font:500 13px var(--mono);color:var(--muted)">Study-area data could not be loaded.</span>'; });
})();
