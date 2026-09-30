// TRINETRA-SR — fixed 3D background: Earth, atmosphere, stars, Sentinel-2 orbit, AOI pins.
import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

const canvas = document.getElementById('space');
const pinLayer = document.getElementById('pins');
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
} catch (e) {
  canvas.style.background = 'radial-gradient(circle at 70% 45%, #0b1a33, #03050b 60%)';
  throw e;
}
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setClearColor(0x03050b, 1);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 400);
const CAM_Z = 4.7;
camera.position.set(0, 0, CAM_Z);

const SUN = new THREE.Vector3(-1.0, 0.35, 0.75).normalize();
const loader = new THREE.TextureLoader();
const tex = (f, srgb = true) => {
  const t = loader.load('assets/' + f);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
};

// ---------------------------------------------------------------- Earth
const world = new THREE.Group();          // moves with scroll
scene.add(world);
const earth = new THREE.Group();          // rotates (spin + drag)
world.add(earth);

const earthMat = new THREE.ShaderMaterial({
  uniforms: {
    day: { value: tex('earth_atmos_2048.jpg') },
    night: { value: tex('earth_lights_2048.png') },
    spec: { value: tex('earth_specular_2048.jpg', false) },
    sun: { value: SUN.clone() },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv; varying vec3 vN; varying vec3 vPos;
    void main() {
      vUv = uv;
      vN = normalize(mat3(modelMatrix) * normal);
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vPos = wp.xyz;
      gl_Position = projectionMatrix * viewMatrix * wp;
    }`,
  fragmentShader: /* glsl */`
    uniform sampler2D day, night, spec; uniform vec3 sun;
    varying vec2 vUv; varying vec3 vN; varying vec3 vPos;
    void main() {
      vec3 N = normalize(vN);
      vec3 V = normalize(cameraPosition - vPos);
      float l = dot(N, sun);
      float dayMix = smoothstep(-0.18, 0.22, l);
      vec3 d = texture2D(day, vUv).rgb;
      vec3 n = texture2D(night, vUv).rgb;
      float s = texture2D(spec, vUv).r;
      vec3 lit = d * (0.06 + 1.05 * max(l, 0.0));
      vec3 H = normalize(sun + V);
      lit += s * pow(max(dot(N, H), 0.0), 38.0) * 0.55 * vec3(0.8, 0.9, 1.0) * step(0.0, l);
      vec3 lights = n * vec3(1.0, 0.72, 0.42) * 1.6 * (1.0 - dayMix);
      vec3 col = lit * dayMix + lights + d * 0.015;
      float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
      col += vec3(0.30, 0.62, 1.0) * rim * 0.6 * (0.15 + 0.85 * smoothstep(-0.3, 0.6, l));
      gl_FragColor = vec4(col, 1.0);
      #include <colorspace_fragment>
    }`,
});
earth.add(new THREE.Mesh(new THREE.SphereGeometry(1, 128, 128), earthMat));

const clouds = new THREE.Mesh(
  new THREE.SphereGeometry(1.012, 96, 96),
  new THREE.MeshLambertMaterial({ map: tex('earth_clouds_1024.png'), alphaMap: tex('earth_clouds_1024.png', false), transparent: true, opacity: 0.55, depthWrite: false })
);
earth.add(clouds);
const sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
sunLight.position.copy(SUN).multiplyScalar(10);
scene.add(sunLight, new THREE.AmbientLight(0x223355, 0.15));

const atmo = new THREE.Mesh(
  new THREE.SphereGeometry(1.16, 96, 96),
  new THREE.ShaderMaterial({
    uniforms: { sun: { value: SUN.clone() } },
    vertexShader: /* glsl */`
      varying vec3 vN; varying vec3 vW;
      void main(){ vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz;
        gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      uniform vec3 sun; varying vec3 vN; varying vec3 vW;
      void main(){
        vec3 V = normalize(cameraPosition - vW);
        // back faces: N.V goes from 0 at the outer edge to about -0.5 at the planet's limb
        float k = clamp(-dot(normalize(vN), V) / 0.5, 0.0, 1.0);
        float i = pow(k, 2.2) * 0.85;
        float day = 0.3 + 0.7 * smoothstep(-0.5, 0.4, dot(normalize(vN), sun));
        gl_FragColor = vec4(vec3(0.30, 0.62, 1.0) * i * day, i * day);
      }`,
    side: THREE.BackSide, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false,
  })
);
world.add(atmo);

// ---------------------------------------------------------------- sky: nebula sphere, Milky Way, stars, meteors
// The galactic plane is a tilted great circle; stars and nebulosity concentrate along it.
const GAL = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(0.18, 0, 0.52));
function galacticDir(band) {                      // band: 0 = isotropic, 1 = tightly in the plane
  const th = Math.random() * Math.PI * 2;
  let lat = Math.asin(Math.random() * 2 - 1);
  if (band > 0) lat *= Math.pow(Math.random(), 2.2 * band) * 0.55;
  return new THREE.Vector3(Math.cos(lat) * Math.cos(th), Math.sin(lat), Math.cos(lat) * Math.sin(th)).applyMatrix4(GAL);
}

function nebulaTexture() {
  const w = 2048, h = 1024, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const blob = (x, y, r, rgb, a) => {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, `rgba(${rgb},${a})`); gr.addColorStop(1, `rgba(${rgb},0)`);
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  };
  // band along the equator of the texture (the mesh is rotated into the galactic frame)
  for (let i = 0; i < 900; i++) {
    const x = Math.random() * w, off = (Math.random() - 0.5) * Math.random() * 260;
    const core = Math.exp(-Math.pow((x / w - 0.62) * 3.2, 2));          // brighter towards the "core"
    const pal = Math.random();
    const rgb = pal < 0.6 ? '110,140,235' : pal < 0.85 ? '140,125,220' : '235,200,160';
    blob(x, h / 2 + off, 30 + Math.random() * 120, rgb, (0.03 + 0.085 * core) * Math.random());
  }
  // dark dust lanes
  g.globalCompositeOperation = 'multiply';
  for (let i = 0; i < 260; i++) {
    const x = Math.random() * w, y = h / 2 + (Math.random() - 0.5) * 70;
    const r = 20 + Math.random() * 70, gr = g.createRadialGradient(x, y, 0, x, y, r);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
const sky = new THREE.Mesh(new THREE.SphereGeometry(190, 64, 32),
  new THREE.MeshBasicMaterial({ map: nebulaTexture(), side: THREE.BackSide, transparent: true, opacity: 0.55, depthWrite: false }));
sky.matrixAutoUpdate = false; sky.matrix.copy(GAL); sky.matrixWorldNeedsUpdate = true;
scene.add(sky);

function starfield(count, rMin, rMax, size, band = 0) {
  const pos = new Float32Array(count * 3), sz = new Float32Array(count), tw = new Float32Array(count), col = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const d = galacticDir(band), r = rMin + Math.random() * (rMax - rMin);
    pos.set([d.x * r, d.y * r, d.z * r], i * 3);
    sz[i] = size * (0.4 + Math.pow(Math.random(), 3) * 2.2);
    tw[i] = Math.random() * 6.28;
    const warm = Math.random();
    col.set(warm < 0.15 ? [1, 0.85, 0.7] : warm < 0.3 ? [0.75, 0.85, 1] : [1, 1, 1], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('size', new THREE.BufferAttribute(sz, 1));
  g.setAttribute('tw', new THREE.BufferAttribute(tw, 1));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const m = new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 }, pr: { value: renderer.getPixelRatio() } },
    vertexShader: /* glsl */`
      attribute float size; attribute float tw; attribute vec3 color; uniform float t; uniform float pr;
      varying float vA; varying vec3 vC;
      void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0);
        vA = 0.55 + 0.45 * sin(t * 1.3 + tw); vC = color;
        gl_PointSize = size * pr * (60.0 / -mv.z); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`
      varying float vA; varying vec3 vC;
      void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vC, a * a * vA); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  return new THREE.Points(g, m);
}
const stars = starfield(4200, 70, 170, 2.1);            // isotropic field
const milky = starfield(9000, 90, 180, 1.35, 1);         // dense, faint band
const dust = starfield(600, 14, 45, 1.1);                 // near layer for parallax
scene.add(stars, milky, dust);

// meteors: one streak every few seconds, far behind the globe
const METEOR_N = 24, meteorPos = new Float32Array(METEOR_N * 3), meteorA = new Float32Array(METEOR_N);
for (let i = 0; i < METEOR_N; i++) meteorA[i] = 1 - i / (METEOR_N - 1);
const meteorG = new THREE.BufferGeometry();
meteorG.setAttribute('position', new THREE.BufferAttribute(meteorPos, 3));
meteorG.setAttribute('a', new THREE.BufferAttribute(meteorA, 1));
const meteorMat = new THREE.ShaderMaterial({
  uniforms: { fade: { value: 0 } },
  vertexShader: 'attribute float a; varying float vA; void main(){ vA=a; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: 'uniform float fade; varying float vA; void main(){ gl_FragColor = vec4(0.85,0.93,1.0, vA*vA*fade); }',
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
});
const meteor = new THREE.Line(meteorG, meteorMat);
meteor.frustumCulled = false;
scene.add(meteor);
let meteorT = -1, meteorNext = 3, meteorFrom = new THREE.Vector3(), meteorDir = new THREE.Vector3();
function spawnMeteor() {
  meteorFrom.set((Math.random() - 0.2) * 70, 18 + Math.random() * 22, -60 - Math.random() * 30);
  meteorDir.set(-0.6 - Math.random() * 0.5, -0.35 - Math.random() * 0.3, 0).normalize();
  meteorT = 0;
}
function updateMeteor(dt) {
  meteorNext -= dt;
  if (meteorT < 0 && meteorNext <= 0 && !reduced) spawnMeteor();
  if (meteorT < 0) { meteorMat.uniforms.fade.value = 0; return; }
  meteorT += dt;
  const life = 1.1, head = meteorT * 55;
  for (let i = 0; i < METEOR_N; i++) {
    const d = Math.max(0, head - i * 0.9);
    meteorPos.set([meteorFrom.x + meteorDir.x * d, meteorFrom.y + meteorDir.y * d, meteorFrom.z], i * 3);
  }
  meteorG.attributes.position.needsUpdate = true;
  meteorMat.uniforms.fade.value = Math.sin(Math.min(1, meteorT / life) * Math.PI) * 0.9;
  if (meteorT > life) { meteorT = -1; meteorNext = 4 + Math.random() * 7; }
}

// ---------------------------------------------------------------- Sentinel-2 orbit
// Sun-synchronous, 786 km altitude, 98.62 deg inclination (inertial frame; Earth spins beneath).
const R_ORB = 1 + 786 / 6371;
const orbit = new THREE.Group();
orbit.rotation.z = THREE.MathUtils.degToRad(98.62 - 90);
orbit.rotation.y = 0.6;
world.add(orbit);
const ringPts = [];
for (let i = 0; i <= 256; i++) { const a = i / 256 * Math.PI * 2; ringPts.push(new THREE.Vector3(Math.cos(a) * R_ORB * 0, Math.sin(a) * R_ORB, Math.cos(a) * R_ORB)); }
const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ringPts),
  new THREE.LineDashedMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0.35, dashSize: 0.03, gapSize: 0.025 }));
ring.computeLineDistances();
orbit.add(ring);
const sat = new THREE.Group();
orbit.add(sat);
const glowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(94,231,255,.9)'); gr.addColorStop(1, 'rgba(94,231,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const satSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, blending: THREE.AdditiveBlending, depthWrite: false }));
satSprite.scale.setScalar(0.09);
sat.add(satSprite);
// swath cone toward nadir
const swath = new THREE.Mesh(new THREE.ConeGeometry(0.045, R_ORB - 1, 24, 1, true),
  new THREE.MeshBasicMaterial({ color: 0x5ee7ff, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
orbit.add(swath);
const UP = new THREE.Vector3(0, 1, 0);
const TRAIL = 60, trailPos = new Float32Array(TRAIL * 3), trailA = new Float32Array(TRAIL);
for (let i = 0; i < TRAIL; i++) trailA[i] = 1 - i / TRAIL;
const trailG = new THREE.BufferGeometry();
trailG.setAttribute('position', new THREE.BufferAttribute(trailPos, 3));
trailG.setAttribute('a', new THREE.BufferAttribute(trailA, 1));
const trail = new THREE.Line(trailG, new THREE.ShaderMaterial({
  vertexShader: 'attribute float a; varying float vA; void main(){ vA=a; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
  fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.37,0.9,1.0, vA*vA*0.9); }',
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
}));
orbit.add(trail);

// ---------------------------------------------------------------- pins
const DEG = Math.PI / 180;
function ll2v(lat, lon, r = 1) {
  const phi = (90 - lat) * DEG, th = (lon + 180) * DEG;
  return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th));
}
const pins = [];
function addPin(lat, lon, label, onClick, live = false) {
  const anchor = new THREE.Object3D();
  anchor.position.copy(ll2v(lat, lon, 1.005));
  earth.add(anchor);
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, 0.07, 6),
    new THREE.MeshBasicMaterial({ color: live ? 0x5ee7ff : 0xffb454, transparent: true, opacity: 0.9 }));
  beam.position.copy(ll2v(lat, lon, 1.035));
  beam.lookAt(0, 0, 0); beam.rotateX(Math.PI / 2);
  earth.add(beam);
  const el = document.createElement('button');
  el.className = 'pin hidden' + (live ? ' live' : '');
  el.type = 'button';
  el.textContent = label;
  el.addEventListener('click', e => { e.stopPropagation(); onClick && onClick(); });
  pinLayer.appendChild(el);
  const p = { anchor, beam, el, lat, lon };
  pins.push(p);
  return p;
}

// ---------------------------------------------------------------- interaction
// yaw that turns (lat, lon) toward the camera, given where the globe sits on screen
function facingYaw(lat, lon) {
  const v = ll2v(lat, lon);
  const c = Math.atan2(camera.position.x - world.position.x, camera.position.z - world.position.z);
  return c - Math.atan2(v.x, v.z);
}
let yaw = 0, home = 0, pitch = 0.3, vYaw = 0, target = null, dragging = false, lastX = 0, lastY = 0, idleT = 0;
let mx = 0, my = 0;
canvas.addEventListener('pointerdown', e => {
  if (scrollP > 0.9) return;
  dragging = true; lastX = e.clientX; lastY = e.clientY; target = null; canvas.setPointerCapture(e.pointerId);
});
canvas.addEventListener('pointermove', e => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  vYaw = dx * 0.005; yaw += vYaw; pitch = THREE.MathUtils.clamp(pitch + dy * 0.004, -0.9, 0.9); idleT = 0;
});
const endDrag = () => { dragging = false; };
canvas.addEventListener('pointerup', endDrag); canvas.addEventListener('pointercancel', endDrag);
addEventListener('mousemove', e => { mx = e.clientX / innerWidth - 0.5; my = e.clientY / innerHeight - 0.5; });

function focus(lat, lon) {
  let t = facingYaw(lat, lon);
  while (t - yaw > Math.PI) t -= Math.PI * 2;
  while (yaw - t > Math.PI) t += Math.PI * 2;
  target = { yaw: t, pitch: THREE.MathUtils.clamp(lat * DEG * 0.9, -0.9, 0.9) };
  home = t; idleT = 0;
}

// ---------------------------------------------------------------- layout + scroll
let scrollP = 0, W = 1, H = 1, mobile = false;
function resize() {
  W = innerWidth; H = innerHeight; mobile = W < 900;
  renderer.setSize(W, H, false);
  camera.aspect = W / H; camera.updateProjectionMatrix();
}
addEventListener('resize', resize); resize();
world.position.set(mobile ? 0 : 1.15, mobile ? 0.78 : 0, 0);
yaw = home = facingYaw(20, 79);
addEventListener('scroll', () => { scrollP = scrollY / H; }, { passive: true });
const smooth = (a, b, x) => { const t = THREE.MathUtils.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// ---------------------------------------------------------------- loop
const clock = new THREE.Clock();
const tmp = new THREE.Vector3(), camDir = new THREE.Vector3();
let satAngle = 0.4, running = true;
document.addEventListener('visibilitychange', () => { running = !document.hidden; if (running) { clock.getDelta(); tick(); } });

function tick() {
  if (!running) return;
  const dt = Math.min(clock.getDelta(), 0.05), t = clock.elapsedTime;
  idleT += dt;

  // globe placement: hero -> side -> far background
  const s = smooth(0, 1.1, scrollP), s2 = smooth(1.1, 3.5, scrollP);
  const baseX = mobile ? 0 : 1.15, baseY = mobile ? 0.78 : 0;
  world.position.set(
    THREE.MathUtils.lerp(baseX, mobile ? 0 : 2.3, s) + s2 * 3.2,
    THREE.MathUtils.lerp(baseY, mobile ? 1.3 : 0.35, s) + s2 * 0.9,
    THREE.MathUtils.lerp(0, -2.6, s) - s2 * 2.5
  );
  const sc = mobile ? 0.6 : 1; world.scale.setScalar(sc);

  // rotation: drag inertia, focus target, idle spin
  if (target) {
    yaw += (target.yaw - yaw) * Math.min(1, dt * 3);
    pitch += (target.pitch - pitch) * Math.min(1, dt * 3);
    if (Math.abs(target.yaw - yaw) < 1e-3) target = null;
  } else if (!dragging) {
    vYaw *= 0.94; yaw += vYaw;
    if (Math.abs(vYaw) > 1e-4) home = yaw;                        // after a fling, sway around the new spot
    if (!reduced && idleT > 2) yaw += (home + 0.45 * Math.sin(t * 0.09) - yaw) * dt * 0.6;
    if (idleT > 4) pitch += (0.3 - pitch) * dt * 0.3;
  }
  earth.rotation.set(pitch, yaw, 0, 'XYZ');
  clouds.rotation.y += dt * 0.006;

  // Sentinel-2
  if (!reduced) satAngle += dt * 0.22;
  const sp = new THREE.Vector3(0, Math.sin(satAngle) * R_ORB, Math.cos(satAngle) * R_ORB);
  sat.position.copy(sp);
  const out = sp.clone().normalize();
  swath.position.copy(out).multiplyScalar(1 + (R_ORB - 1) / 2);   // apex at satellite, base on ground
  swath.quaternion.setFromUnitVectors(UP, out);
  for (let i = 0; i < TRAIL; i++) {
    const a = satAngle - i * 0.012;
    trailPos.set([0, Math.sin(a) * R_ORB, Math.cos(a) * R_ORB], i * 3);
  }
  trailG.attributes.position.needsUpdate = true;

  // camera parallax
  camera.position.x += (mx * 0.25 - camera.position.x) * 0.04;
  camera.position.y += (-my * 0.18 - camera.position.y) * 0.04;
  camera.lookAt(0, 0, -1);
  stars.rotation.y = t * 0.004 + scrollP * 0.05;
  milky.rotation.y = stars.rotation.y;
  sky.matrix.copy(new THREE.Matrix4().makeRotationY(stars.rotation.y).multiply(GAL)); sky.matrixWorldNeedsUpdate = true;
  dust.rotation.y = -t * 0.01 - scrollP * 0.12;
  stars.material.uniforms.t.value = t; milky.material.uniforms.t.value = t; dust.material.uniforms.t.value = t;
  updateMeteor(dt);

  // HTML pins
  camera.getWorldDirection(camDir);
  const pinsVisible = scrollP < 0.75, placed = [];
  for (const p of pins) {
    p.anchor.getWorldPosition(tmp);
    const n = tmp.clone().sub(world.position).normalize();
    const toCam = camera.position.clone().sub(tmp).normalize();
    p.show = n.dot(toCam) > 0.25 && pinsVisible;
    tmp.project(camera);
    p.x = (tmp.x * 0.5 + 0.5) * W; p.y = (-tmp.y * 0.5 + 0.5) * H - 6;
    if (p.show) placed.push(p);
  }
  // de-overlap labels: push later labels down (then right) when they collide
  placed.sort((a, b) => a.y - b.y);
  for (let i = 0; i < placed.length; i++) {
    const p = placed[i];
    for (let j = 0; j < i; j++) {
      const q = placed[j];
      if (Math.abs(p.x - q.x) < 86 && Math.abs(p.y - q.y) < 22) p.y = q.y + 22;
    }
  }
  for (const p of pins) {
    p.el.classList.toggle('hidden', !p.show);
    p.el.style.left = p.x + 'px'; p.el.style.top = p.y + 'px';
  }

  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

window.Globe = { addPin, focus };
window.dispatchEvent(new Event('globe-ready'));
