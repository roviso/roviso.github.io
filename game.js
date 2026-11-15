/* =====================================================================
   Ravi Prajapati — interactive 3D portfolio
   Drive a monster truck around an island to explore the work.
   Three.js (render) + cannon-es (physics), fully static, no server.
   Controls: WASD/arrows drive · SHIFT turbo · SPACE jump · E interact · click minimap to fast-travel
   ===================================================================== */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/* ------------------------------------------------ palette / config */
const C = {
  paper:  0xf4ead9,
  beach:  0xf0e2c4,
  road:   0xdec6a1,
  ink:    0x2b2016,
  orange: 0xe8921a,
  deep:   0x7a3000,
  rust:   0xc05010,
  cream:  0xfffaf1,
  sand:   0xd9c4a2,
  gold:   0xe8b31a,
  leafA:  0x8aa065,
  leafB:  0x798f55,
  trunk:  0x6e4a2a,
  grassLo: 0xbcc486,
  grassHi: 0x8fa862,
  brick:  0xb5482a,
  roof:   0x5a2a1c,
  stone:  0xe6dac4,
  clay:   0xc4673a,
};
const GRAVITY = -30;
const MAX_FORCE = 1000;
const TURBO_FORCE = 1900;
const MAX_STEER = 0.55;
const SPEED_CAP = 24;
const TURBO_CAP = 38;
const JUMP_SPEED = 9.5;
const DRIFT_SLIP = 1.6;    // rear grip while turbo-cornering (lower = looser tail)
const MAX_YAW = 2.4;       // rad/s — caps spin so a slide stays a slide instead of a pirouette
const GRIP_SLIP = 2.5;
const SPAWN = new CANNON.Vec3(0, 2.2, 0);
// island footprint (ellipse) — the shore slopes into the sea around r ≈ 0.92
const ISLE_RX = 115, ISLE_RZ = 150;
// lake (ellipse) crossed by the bridge
const LAKE = { x: 32, z: -48, rx: 13, rz: 10 };
const WATER_Y = -0.4;
// terrain grid — kept square: cannon-es heightfield raycasts assume it
const T_N = 177, T_EL = 2, T_HALF = (T_N - 1) * T_EL / 2;
// zones kept dead level for roads + content: [x0, x1, z0, z1] (plus the spawn plaza)
const FLAT = [
  [-7, 7, -86, 116],     // N/S road
  [-66, 50, -7, 7],      // E/W road
  [-20, 20, -84, -32],   // projects
  [24, 52, -20, 6],      // skills wall + ramp
  [-84, -34, -16, 16],   // contact plaza + stupa
  [-46, -24, 28, 52],    // bowling
  [-18, 18, 26, 116],    // experience / education
  [8, 56, -64, -32],     // lake + bridge
  [-36, -14, 54, 76],    // pagoda
];
const smooth = (a, b, v) => { const t = Math.min(1, Math.max(0, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
function flatDist(x, z) { // distance to the nearest level zone (0 = inside one)
  let d = Math.max(0, Math.hypot(x, z) - 17.5);
  for (const [x0, x1, z0, z1] of FLAT) {
    d = Math.min(d, Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1)));
  }
  return d;
}
/* terrain height: level content zones → rolling hills → beach → seabed, minus the lake bowl */
function groundH(x, z) {
  const r = Math.hypot(x / ISLE_RX, z / ISLE_RZ);
  const hill = Math.max(0.3, 2.4 + 2.2 * Math.sin(x * 0.045 + 1.3) * Math.cos(z * 0.038 - 0.4)
    + 1.2 * Math.sin(x * 0.09 - z * 0.07) + 0.35 * Math.sin(x * 0.21 + z * 0.17));
  let h = hill * smooth(3, 34, flatDist(x, z)) * (1 - 0.85 * smooth(0.62, 0.9, r));
  h += (-4.5 - h) * smooth(0.86, 1.06, r);
  const lr = Math.hypot((x - LAKE.x) / LAKE.rx, (z - LAKE.z) / LAKE.rz);
  return h - 2.6 * (1 - smooth(0.55, 1.1, lr));
}
// the one check that fails if the terrain maths breaks: content stays level, water stays wet
console.assert(groundH(0, 0) === 0 && groundH(0, -60) === 0 && groundH(-74, 0) === 0
  && groundH(LAKE.x, LAKE.z) < WATER_Y && groundH(140, 0) < WATER_Y && groundH(70, 70) > 0.2,
  'terrain invariants broken');
// seeded scatter so the island is identical on every visit
let seed = 7;
const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
// ?t=seconds jumps the day/night clock (e.g. ?t=130 starts at night)
const DAY_OFFSET = +(new URLSearchParams(location.search).get('t') || 0);

/* ------------------------------------------------ dom */
const canvas   = document.getElementById('game');
const overlay  = document.getElementById('overlay');
const startBtn = document.getElementById('start-btn');
const hud      = document.getElementById('hud');
const panel    = document.getElementById('panel');
const panelTag = document.getElementById('panel-tag');
const panelTitle = document.getElementById('panel-title');
const panelDesc  = document.getElementById('panel-desc');
const panelOpen  = document.getElementById('panel-open');
const touchUI  = document.getElementById('touch');
const toastsEl = document.getElementById('toasts');

/* ------------------------------------------------ renderer / scene */
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
} catch (e) {
  document.getElementById('webgl-error').classList.remove('hidden');
  overlay.classList.add('hidden');
  throw e;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.background = new THREE.Color(C.paper);
scene.fog = new THREE.Fog(C.paper, 95, 230);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 2000);
const CAM_OFFSET = new THREE.Vector3(15, 18, 15);
let camZoom = 1; // pulled back on portrait screens, where the horizontal view is narrow
const fitCamera = () => { camZoom = window.innerWidth < window.innerHeight ? 1.5 : 1; };
fitCamera();
camera.position.copy(CAM_OFFSET);
camera.lookAt(0, 0, 0);

/* ------------------------------------------------ material helpers */
// 4-step toon ramp: two shadow-side bands, two lit bands
const GRAD = new THREE.DataTexture(new Uint8Array([95, 125, 200, 255]), 4, 1, THREE.RedFormat);
GRAD.minFilter = GRAD.magFilter = THREE.NearestFilter;
GRAD.needsUpdate = true;
function toonMat({ roughness, metalness, ...o }) {
  return new THREE.MeshToonMaterial({ gradientMap: GRAD, ...o });
}
// unlit materials don't see the lights, so the day cycle tints them by hand
const unlit = [];
function basicMat(o) {
  const m = new THREE.MeshBasicMaterial(o);
  m.userData.base = m.color.clone();
  unlit.push(m);
  return m;
}
// faceted look for low-poly solids
function flat(geo) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  g.computeVertexNormals();
  return g;
}

// colours + intensities are driven by the day cycle below
const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1.6);
sun.position.set(-40, 70, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70;  sun.shadow.camera.bottom = -70;
sun.shadow.camera.far = 220;
sun.shadow.bias = -0.0008;
scene.add(sun);
scene.add(sun.target);

/* ------------------------------------------------ physics world */
const world = new CANNON.World({ gravity: new CANNON.Vec3(0, GRAVITY, 0) });
world.broadphase = new CANNON.SAPBroadphase(world);
world.allowSleep = true;
world.defaultContactMaterial.friction = 0.3;
world.defaultContactMaterial.restitution = 0.1;

// seabed: catches anything that leaves the terrain grid
const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
groundBody.position.y = -6;
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
// cannon-es computes a body's AABB at construction; posing a STATIC body
// afterwards leaves it stale, which silently breaks raycasts + SAP broadphase.
groundBody.updateAABB();
world.addBody(groundBody);

/* ------------------------------------------------ terrain / water / sky */
let heightTex; // terrain height baked to a texture — the water shader reads depth from it
{
  const N = T_N, EL = T_EL, HALF = T_HALF;
  const pos = new Float32Array(N * N * 3), col = new Float32Array(N * N * 3), idx = [];
  const hmap = new Uint8Array(N * N * 4);
  const cSand = new THREE.Color(C.beach), cWet = new THREE.Color(0xcdb78f);
  const cLo = new THREE.Color(C.grassLo), cHi = new THREE.Color(C.grassHi), tmp = new THREE.Color();
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < N; k++) {
      const x = -HALF + i * EL, z = -HALF + k * EL, h = groundH(x, z), v = i * N + k;
      pos.set([x, h, z], v * 3);
      // paper-sand where it's level, grass as the hills rise, darker sand under water
      tmp.copy(cLo).lerp(cHi, smooth(1.5, 5.5, h));
      tmp.lerpColors(cSand, tmp, smooth(0.15, 1.1, h)).lerp(cWet, smooth(0.1, -1.2, h) * 0.9);
      col.set([tmp.r, tmp.g, tmp.b], v * 3);
      hmap[(k * N + i) * 4] = Math.round(255 * Math.min(1, Math.max(0, (h + 5) / 10)));
      if (i < N - 1 && k < N - 1) idx.push(v, v + 1, v + N, v + N, v + 1, v + N + 1);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const terrain = new THREE.Mesh(geo, toonMat({ vertexColors: true }));
  terrain.receiveShadow = true;
  scene.add(terrain);

  heightTex = new THREE.DataTexture(hmap, N, N, THREE.RGBAFormat);
  heightTex.minFilter = heightTex.magFilter = THREE.LinearFilter;
  heightTex.needsUpdate = true;

  // physics: cannon heightfields lie in local XY with height along Z, so the
  // body is tipped −90° about X and its rows run from +z to −z.
  const data = [];
  for (let i = 0; i < N; i++) {
    const row = [];
    for (let j = 0; j < N; j++) row.push(groundH(-HALF + i * EL, HALF - j * EL));
    data.push(row);
  }
  const hf = new CANNON.Body({ mass: 0, shape: new CANNON.Heightfield(data, { elementSize: EL }) });
  hf.position.set(-HALF, 0, HALF);
  hf.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
  hf.updateAABB(); // static body posed after construction
  world.addBody(hf);
}

/* water: one plane for sea + lake; depth comes from the baked terrain heights */
const waterMat = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, fog: true,
  uniforms: {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: { value: 0 },
    uHeight: { value: heightTex },
    uShallow: { value: new THREE.Color(0xa6dcd2) },
    uDeep: { value: new THREE.Color(0x4a97a6) },
    uFoam: { value: new THREE.Color(0xfffaf1) },
    uTint: { value: new THREE.Color(1, 1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vXZ;
    #include <fog_pars_vertex>
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vXZ = wp.xz;
      vec4 mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: /* glsl */`
    uniform float uTime;
    uniform sampler2D uHeight;
    uniform vec3 uShallow, uDeep, uFoam, uTint;
    varying vec2 vXZ;
    #include <fog_pars_fragment>
    void main() {
      vec2 uv = ((vXZ + ${T_HALF.toFixed(1)}) / ${T_EL.toFixed(1)} + 0.5) / ${T_N.toFixed(1)};
      float depth = ${WATER_Y.toFixed(2)} - (texture2D(uHeight, uv).r * 10.0 - 5.0);
      float wob = sin(vXZ.x * 0.35 + uTime * 0.8) * 0.5 + sin(vXZ.y * 0.3 - uTime * 0.6) * 0.5;
      vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 3.0, depth));
      // foam: bands rolling in to shore + a solid lip at the waterline
      float band = step(0.7, sin(depth * 6.5 - uTime * 1.5 + wob)) * (1.0 - smoothstep(0.2, 1.6, depth));
      float lip = 1.0 - step(0.14 + wob * 0.05, depth);
      // sparse light streaks out in open water
      float streak = step(0.94, sin(vXZ.y * 1.1 + sin(vXZ.x * 0.25 + uTime * 0.4) * 2.0))
                   * step(0.35, sin(vXZ.x * 0.17 + vXZ.y * 0.09 - uTime * 0.25))
                   * smoothstep(1.2, 3.0, depth);
      float foam = max(max(band * 0.85, lip), streak * 0.3);
      col = mix(col, uFoam, foam) * uTint;
      float alpha = max(mix(0.6, 0.95, smoothstep(0.0, 2.0, depth)), foam);
      gl_FragColor = vec4(col, alpha);
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
});
{
  const water = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.y = WATER_Y;
  scene.add(water);
}

/* sky dome (seen on the title orbit) + a ring of far peaks, Himalaya to the north */
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: { uTop: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() } },
  vertexShader: `
    varying float vH;
    void main() {
      vH = normalize(position).y;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform vec3 uTop, uHorizon;
    varying float vH;
    void main() {
      gl_FragColor = vec4(mix(uHorizon, uTop, smoothstep(0.0, 0.5, vH)), 1.0);
      #include <colorspace_fragment>
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 24, 12), skyMat);
sky.renderOrder = -1;
scene.add(sky);

const peakMat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
{
  const geo = flat(new THREE.ConeGeometry(1, 1, 6, 3));
  const p = geo.attributes.position, c = new Float32Array(p.count * 3);
  const rock = new THREE.Color(0x8d9cc6);
  for (let i = 0; i < p.count; i++) {
    const snow = p.getY(i) > 0.1;
    c.set(snow ? [1, 1, 1] : [rock.r, rock.g, rock.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const N = 44;
  const peaks = new THREE.InstancedMesh(geo, peakMat, N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2 + rand() * 0.1;
    const north = Math.max(0, -Math.sin(a));           // −z is north
    const h = 60 + rand() * 50 + north * (120 + rand() * 90);
    const w = 110 + rand() * 70;
    const d = 640 + rand() * 120;
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * 6);
    m4.compose(v.set(Math.cos(a) * d, h / 2 - 14, Math.sin(a) * d), q, s.set(w, h, w));
    peaks.setMatrixAt(i, m4);
  }
  peaks.frustumCulled = false;
  scene.add(peaks);
}

/* grass: instanced tufts on the hills, swaying in a shared wind */
const grassMat = new THREE.ShaderMaterial({
  side: THREE.DoubleSide, fog: true,
  uniforms: {
    ...THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
    uTime: { value: 0 },
    uBase: { value: new THREE.Color(0x9cb26a) },
    uTip: { value: new THREE.Color(0xdcdc92) },
    uTint: { value: new THREE.Color(1, 1, 1) },
  },
  vertexShader: `
    uniform float uTime;
    varying float vY;
    #include <fog_pars_vertex>
    void main() {
      vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
      vY = position.y;
      float sway = sin(wp.x * 0.25 + uTime * 1.7) * 0.6 + sin(wp.z * 0.4 + uTime * 1.1) * 0.4;
      wp.x += sway * 0.24 * position.y;
      wp.z += sway * 0.13 * position.y;
      vec4 mvPosition = viewMatrix * wp;
      gl_Position = projectionMatrix * mvPosition;
      #include <fog_vertex>
    }`,
  fragmentShader: `
    uniform vec3 uBase, uTip, uTint;
    varying float vY;
    #include <fog_pars_fragment>
    void main() {
      gl_FragColor = vec4(mix(uBase, uTip, clamp(vY / 0.8, 0.0, 1.0)) * uTint, 1.0);
      #include <colorspace_fragment>
      #include <fog_fragment>
    }`,
});
{
  // one tuft = three tapered blades fanned around the root
  const verts = [];
  for (let b = 0; b < 3; b++) {
    const a = b * 2.1, ox = Math.cos(a) * 0.14, oz = Math.sin(a) * 0.14;
    const px = Math.cos(a + 1.57) * 0.1, pz = Math.sin(a + 1.57) * 0.1;
    verts.push(ox - px, 0, oz - pz, ox + px, 0, oz + pz, ox * 2, 0.55 + b * 0.13, oz * 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  const N = window.matchMedia('(pointer: coarse)').matches ? 9000 : 22000;
  const grass = new THREE.InstancedMesh(geo, grassMat, N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), v = new THREE.Vector3();
  let placed = 0, guard = 0;
  while (placed < N && guard++ < N * 8) {
    const x = (rand() * 2 - 1) * ISLE_RX, z = (rand() * 2 - 1) * ISLE_RZ;
    const h = groundH(x, z);
    if (h < 0.55) continue; // only where the terrain is already green
    const sc = 0.8 + rand() * 0.9;
    q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, rand() * 6.28);
    m4.compose(v.set(x, h - 0.03, z), q, s.set(sc, sc, sc));
    grass.setMatrixAt(placed++, m4);
  }
  grass.count = placed;
  grass.frustumCulled = false;
  scene.add(grass);
}

/* day → dusk → night → dawn, on a slow loop */
const night = { k: 0 }; // 0 = full day, 1 = dusk/night — drives headlights + lanterns
const glows = [];       // materials that light up after dark
const updateDay = (() => {
  const PHASES = [
    { sun: 0xfff8e0, sunI: 2.3,  hemiSky: 0xcfc8ee, hemiGnd: 0xdba878, hemiI: 1.25, top: 0x8ec9ee, horizon: 0xf5ead8, tint: 0xffffff }, // day
    { sun: 0xffdcae, sunI: 1.95, hemiSky: 0xc4a8dc, hemiGnd: 0xc87a52, hemiI: 1.3,  top: 0x6468b4, horizon: 0xf6b78a, tint: 0xffe2c8 }, // dusk
    { sun: 0x93a8ff, sunI: 0.7,  hemiSky: 0x7d8ae0, hemiGnd: 0x40396a, hemiI: 1.5,  top: 0x121838, horizon: 0x36437c, tint: 0x6f80c4 }, // night
  ].map((p) => Object.fromEntries(Object.entries(p).map(([k, v]) => [k, k.endsWith('I') ? v : new THREE.Color(v)])));
  const SEQ = [[0, 80], [1, 22], [2, 40], [1, 12]]; // [phase, seconds it holds]
  const BLEND = 14;
  const TOTAL = SEQ.reduce((n, [, hold]) => n + hold + BLEND, 0);
  const cur = { sun: new THREE.Color(), hemiSky: new THREE.Color(), hemiGnd: new THREE.Color(), top: new THREE.Color(), horizon: new THREE.Color(), tint: new THREE.Color() };
  const WHITE = new THREE.Color(1, 1, 1);
  return (t) => {
    let u = (t + DAY_OFFSET) % TOTAL, a = PHASES[0], b = a, k = 0;
    for (let i = 0; i < SEQ.length; i++) {
      const [p, hold] = SEQ[i];
      a = b = PHASES[p]; k = 0;
      if (u < hold) break;
      u -= hold;
      if (u < BLEND) { b = PHASES[SEQ[(i + 1) % SEQ.length][0]]; k = u / BLEND; break; }
      u -= BLEND;
    }
    for (const key in cur) cur[key].lerpColors(a[key], b[key], k);
    sun.color.copy(cur.sun);
    sun.intensity = a.sunI + (b.sunI - a.sunI) * k;
    hemi.color.copy(cur.hemiSky);
    hemi.groundColor.copy(cur.hemiGnd);
    hemi.intensity = a.hemiI + (b.hemiI - a.hemiI) * k;
    skyMat.uniforms.uTop.value.copy(cur.top);
    skyMat.uniforms.uHorizon.value.copy(cur.horizon);
    scene.fog.color.copy(cur.horizon);
    scene.background.copy(cur.horizon);
    waterMat.uniforms.uTint.value.copy(cur.tint);
    grassMat.uniforms.uTint.value.copy(cur.tint);
    peakMat.color.copy(cur.horizon).lerp(WHITE, 0.5);
    for (const m of unlit) m.color.copy(m.userData.base).multiply(cur.tint);
    night.k = (a === PHASES[0] ? 0 : 1 - k) + (b === PHASES[0] ? 0 : k);
    for (const m of glows) m.emissiveIntensity = night.k * 1.6;
  };
})();

/* roads */
const ROADS = [ // [cx, cz, w(x-extent), h(z-extent)]
  [0, -42, 6, 80],    // north → projects
  [0, 58, 6, 112],    // south → experience/education
  [24, 0, 46, 6],     // east → skills
  [-32, 0, 62, 6],    // west → contact
  [11.5, -48, 9, 5],  // bridge approach
];
{
  const roadMat = toonMat({ color: C.road, roughness: 1 });
  for (const [cx, cz, w, h] of ROADS) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), roadMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(cx, 0.012, cz);
    m.receiveShadow = true;
    scene.add(m);
  }
  const plaza = new THREE.Mesh(new THREE.CircleGeometry(7.5, 40), roadMat);
  plaza.rotation.x = -Math.PI / 2;
  plaza.position.y = 0.013;
  plaza.receiveShadow = true;
  scene.add(plaza);
}

/* ------------------------------------------------ sync registry */
const synced = []; // { mesh, body }
function track(mesh, body) { synced.push({ mesh, body }); }

/* ------------------------------------------------ canvas-texture helpers */
function makeTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function wrapText(g, text, x, y, maxW, lineH) {
  const words = text.split(' ');
  let line = '';
  for (const word of words) {
    const test = line ? line + ' ' + word : word;
    if (g.measureText(test).width > maxW && line) {
      g.fillText(line, x, y); y += lineH; line = word;
    } else line = test;
  }
  if (line) g.fillText(line, x, y);
  return y;
}

/* flat text lying on the ground */
function groundText(text, x, z, size = 3, opts = {}) {
  const font = `900 ${opts.px || 110}px Inter, Arial, sans-serif`;
  const meas = document.createElement('canvas').getContext('2d');
  meas.font = font;
  const tw = Math.ceil(meas.measureText(text).width) + 40;
  const th = (opts.px || 110) + 60;
  const tex = makeTexture(tw, th, (g) => {
    g.font = font;
    g.fillStyle = opts.color || '#8a6f4d';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(text, tw / 2, th / 2);
  });
  const aspect = tw / th;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(size * aspect, size),
    basicMat({ map: tex, transparent: true, depthWrite: false, opacity: opts.opacity ?? 1 })
  );
  mesh.rotation.x = -Math.PI / 2;
  if (opts.rotY) mesh.rotation.z = opts.rotY; // plane is flat; z acts as yaw
  mesh.position.set(x, 0.03, z);
  scene.add(mesh);
  return mesh;
}

/* dynamic labelled cube (name letters, skill bricks) */
const bricks = []; // for the smash mission
function labelledBox(label, sx, sy, sz, x, y, z, opts = {}) {
  const bg = opts.bg || '#fffaf1';
  const fg = opts.fg || '#2b2016';
  const tex = makeTexture(256, 128, (g) => {
    g.fillStyle = bg; g.fillRect(0, 0, 256, 128);
    g.strokeStyle = 'rgba(122,48,0,0.25)'; g.lineWidth = 6; g.strokeRect(3, 3, 250, 122);
    g.fillStyle = fg;
    let px = opts.px || 44;
    g.font = `800 ${px}px Inter, Arial, sans-serif`;
    while (g.measureText(label).width > 225 && px > 16) {
      px -= 2; g.font = `800 ${px}px Inter, Arial, sans-serif`;
    }
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, 128, 68);
  });
  const mat = toonMat({ map: tex, roughness: 0.85 });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  const body = new CANNON.Body({
    mass: opts.mass ?? 2,
    shape: new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2)),
    position: new CANNON.Vec3(x, y, z),
    sleepSpeedLimit: 0.6,
  });
  if (opts.rotY) body.quaternion.setFromEuler(0, opts.rotY, 0);
  world.addBody(body);
  track(mesh, body);
  return body;
}

/* static box (walls, ramps, kiosk stands) */
function staticBox(sx, sy, sz, x, y, z, color = C.sand, rotY = 0, rotX = 0, rotZ = 0) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    toonMat({ color, roughness: 0.9 })
  );
  mesh.position.set(x, y, z);
  mesh.rotation.set(rotX, rotY, rotZ);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2)) });
  body.position.set(x, y, z);
  body.quaternion.setFromEuler(rotX, rotY, rotZ);
  body.updateAABB(); // static body posed after construction
  world.addBody(body);
  return { mesh, body };
}

/* signboard: card texture in a timber frame under a little hipped roof, static physics */
const ROOF_GEO = flat(new THREE.CylinderGeometry(0.42, 0.7071, 1, 4).rotateY(Math.PI / 4)); // unit base, scale to fit
const flags = []; // prayer flags: { m, ph }
function billboard({ title, tag, desc, x, z, rotY = 0, w = 7, accent = '#e8921a' }) {
  const tex = makeTexture(640, 400, (g) => {
    g.fillStyle = '#fffaf1'; g.fillRect(0, 0, 640, 400);
    g.fillStyle = accent; g.fillRect(0, 0, 640, 14);
    g.fillStyle = accent;
    g.font = '600 24px "JetBrains Mono", monospace';
    g.fillText(tag.toUpperCase(), 36, 70);
    g.fillStyle = '#2b2016';
    let px = 52;
    g.font = `800 ${px}px Inter, Arial, sans-serif`;
    while (g.measureText(title).width > 568 && px > 30) {
      px -= 2; g.font = `800 ${px}px Inter, Arial, sans-serif`;
    }
    g.fillText(title, 36, 128);
    g.fillStyle = '#5d4a30';
    g.font = '400 27px Inter, Arial, sans-serif';
    wrapText(g, desc, 36, 185, 568, 38);
  });
  const h = w * (400 / 640), top = h + 1.3;
  const sign = new THREE.Group();
  sign.position.set(x, 0, z);
  sign.rotation.y = rotY;
  // the face glows faintly with its own texture so it reads in shade and at night
  const faceMat = toonMat({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.22 });
  const sideMat = toonMat({ color: 0xefe0c8 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.2),
    [sideMat, sideMat, sideMat, sideMat, faceMat, faceMat]);
  board.position.y = top - h / 2;
  const timber = toonMat({ color: C.deep });
  const postGeo = new THREE.BoxGeometry(0.32, top + 0.1, 0.32);
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(postGeo, timber);
    p.position.set(side * (w / 2 + 0.16), (top + 0.1) / 2, 0);
    sign.add(p);
  }
  const roof = new THREE.Mesh(ROOF_GEO, toonMat({ color: C.roof }));
  roof.scale.set(w + 1.6, 0.6, 1.6);
  roof.position.y = top + 0.36;
  sign.add(board, roof);
  sign.traverse((m) => { m.castShadow = m.receiveShadow = true; });
  scene.add(sign);
  const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(w / 2 + 0.3, top / 2, 0.2)) });
  body.position.set(x, top / 2, z);
  body.quaternion.setFromEuler(0, rotY, 0);
  body.updateAABB(); // static body posed after construction
  world.addBody(body);
}

/* interactive circular pad on the ground */
const pads = []; // { pos, r, tag, title, desc, url, ring }
function pad({ x, z, r = 3.2, tag, title, desc, url }) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(r - 0.35, r, 48),
    basicMat({ color: C.orange, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.035, z);
  scene.add(ring);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(r - 0.4, 48),
    basicMat({ color: C.cream, transparent: true, opacity: 0.35, depthWrite: false })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(x, 0.032, z);
  scene.add(disc);
  pads.push({ pos: new THREE.Vector3(x, 0, z), r, tag, title, desc, url, ring });
}

/* =====================================================================
   THE MONSTER TRUCK — cannon-es RaycastVehicle
   ===================================================================== */
const chassisBody = new CANNON.Body({ mass: 160 });
chassisBody.addShape(new CANNON.Box(new CANNON.Vec3(1.05, 0.5, 1.9)));
chassisBody.position.copy(SPAWN);
chassisBody.angularDamping = 0.5;

const vehicle = new CANNON.RaycastVehicle({
  chassisBody,
  indexRightAxis: 0,
  indexUpAxis: 1,
  indexForwardAxis: 2,
});
const WHEEL_R = 0.7;
const wheelOptions = {
  radius: WHEEL_R,
  directionLocal: new CANNON.Vec3(0, -1, 0),
  suspensionStiffness: 50,
  suspensionRestLength: 0.6,
  frictionSlip: 2.5,
  dampingRelaxation: 2.5,
  dampingCompression: 4.5,
  maxSuspensionForce: 100000,
  rollInfluence: 0.01,
  axleLocal: new CANNON.Vec3(-1, 0, 0),
  maxSuspensionTravel: 0.5,
  customSlidingRotationalSpeed: -30,
  useCustomSlidingRotationalSpeed: true,
};
// front wheels (0,1 — +z where the headlights are), rear (2,3)
[[-1.15, 1.4], [1.15, 1.4], [-1.15, -1.4], [1.15, -1.4]].forEach(([wx, wz]) => {
  wheelOptions.chassisConnectionPointLocal = new CANNON.Vec3(wx, 0, wz);
  vehicle.addWheel({ ...wheelOptions });
});
vehicle.addToWorld(world);

/* --- monster truck visual --- */
const carGroup = new THREE.Group(); // follows the chassis body
const carBody = new THREE.Group();  // leans + squats on top of that, purely for feel
carGroup.add(carBody);
const tailMat = toonMat({ color: 0xb02010, emissive: 0xff2a10, emissiveIntensity: 0.4 });
const lampMat = toonMat({ color: 0xfff2c9, emissive: 0xffe9a8, emissiveIntensity: 0.9 });
const headlight = new THREE.SpotLight(0xffeec4, 0, 46, 0.55, 0.7, 1);
{
  const paint = toonMat({ color: C.orange });
  const dark = toonMat({ color: 0x33251a });
  const glass = toonMat({ color: 0x25333f });
  const steel = toonMat({ color: 0xa39a8c });
  const add = (geo, mat, x = 0, y = 0, z = 0, shadow = false) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.castShadow = shadow;
    carBody.add(m);
    return m;
  };
  // side profile [z, y] swept across the truck's width, with chamfered edges
  const sweep = (pts, width, bevel = 0.05) => {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y))),
      { depth: width - bevel * 2, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1 });
    g.rotateY(-Math.PI / 2);
    g.translate(width / 2 - bevel, 0, 0);
    return g;
  };
  // body: nose → hood → raked windshield → cab → pickup bed
  add(sweep([[-1.85, -0.25], [1.85, -0.25], [1.95, 0.05], [1.9, 0.42], [0.75, 0.5],
    [0.3, 1.12], [-0.75, 1.12], [-0.88, 0.5], [-1.85, 0.5]], 1.9), paint, 0, 0, 0, true);
  // glass: side windows are a slightly wider slab poking through the cab
  add(sweep([[0.6, 0.58], [0.27, 1.03], [-0.7, 1.03], [-0.8, 0.58]], 1.94, 0.01), glass);
  add(new THREE.BoxGeometry(1.6, 0.6, 0.04), glass, 0, 0.83, 0.55).rotation.x = -0.628;  // windshield
  add(new THREE.BoxGeometry(1.5, 0.42, 0.04), glass, 0, 0.83, -0.84).rotation.x = 0.207; // rear window
  // bed rails, tailgate and a spare wheel
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.1, 0.2, 0.95), paint, s * 0.9, 0.6, -1.36);
  add(new THREE.BoxGeometry(1.9, 0.2, 0.1), paint, 0, 0.6, -1.82);
  add(new THREE.CylinderGeometry(0.46, 0.46, 0.26, 14), dark, 0, 0.64, -1.3);
  add(new THREE.CylinderGeometry(0.22, 0.22, 0.28, 10), toonMat({ color: 0xd8c9ae }), 0, 0.64, -1.3);
  // fender flares over each wheel
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(new THREE.BoxGeometry(0.55, 0.12, 1.3), dark, sx * 1.12, 0.36, sz * 1.4);
  // bumpers + bull bar
  add(new THREE.BoxGeometry(2.15, 0.24, 0.22), steel, 0, -0.12, 2.02, true);
  add(new THREE.BoxGeometry(2.15, 0.22, 0.2), steel, 0, -0.12, -1.93);
  for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.09, 0.62, 0.09), steel, s * 0.42, 0.22, 2.1);
  add(new THREE.BoxGeometry(1.0, 0.09, 0.09), steel, 0, 0.52, 2.1);
  // roof light bar
  add(new THREE.BoxGeometry(1.5, 0.1, 0.12), steel, 0, 1.2, 0.12);
  const spotGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.16, 10);
  spotGeo.rotateX(Math.PI / 2);
  for (const sx of [-0.52, -0.18, 0.18, 0.52]) add(spotGeo, lampMat, sx, 1.22, 0.22);
  // exhaust stacks behind the cab
  for (const s of [-1, 1]) add(new THREE.CylinderGeometry(0.08, 0.1, 1.0, 10), steel, s * 0.82, 0.98, -0.98, true);
  // lamps
  for (const s of [-1, 1]) {
    add(new THREE.BoxGeometry(0.38, 0.2, 0.1), lampMat, s * 0.64, 0.24, 1.9);
    add(new THREE.BoxGeometry(0.34, 0.16, 0.08), tailMat, s * 0.7, 0.3, -1.87);
  }
  // headlight beam, switched on by the day cycle
  headlight.position.set(0, 0.5, 1.9);
  headlight.target.position.set(0, -1.2, 14);
  carGroup.add(headlight, headlight.target);
}
scene.add(carGroup);

const wheelMeshes = [];
{
  const tyreMat = toonMat({ color: 0x2a2119 });
  const rimMat = toonMat({ color: 0xd8c9ae });
  const tyreGeo = new THREE.CylinderGeometry(WHEEL_R - 0.05, WHEEL_R - 0.05, 0.55, 18).rotateZ(Math.PI / 2); // axis → x
  const rimGeo = new THREE.CylinderGeometry(0.36, 0.36, 0.58, 12).rotateZ(Math.PI / 2);
  const lugGeo = new THREE.BoxGeometry(0.62, 0.1, 0.1);
  const treadGeo = new THREE.BoxGeometry(0.5, 0.12, 0.2);
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    const tyre = new THREE.Mesh(tyreGeo, tyreMat);
    tyre.castShadow = true;
    g.add(tyre, new THREE.Mesh(rimGeo, rimMat));
    // lugs + chunky tread blocks: these are what make the spin readable
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      const lug = new THREE.Mesh(lugGeo, tyreMat);
      lug.position.set(0, Math.cos(a) * 0.2, Math.sin(a) * 0.2);
      g.add(lug);
    }
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      const tread = new THREE.Mesh(treadGeo, tyreMat);
      tread.position.set(0, Math.cos(a) * (WHEEL_R - 0.05), Math.sin(a) * (WHEEL_R - 0.05));
      tread.rotation.x = a;
      g.add(tread);
    }
    scene.add(g);
    wheelMeshes.push(g);
  }
}

/* --- dust puffs + tyre tracks --- */
const dust = [];
{
  const geo = new THREE.IcosahedronGeometry(0.3, 0);
  for (let i = 0; i < 44; i++) {
    const m = new THREE.Mesh(geo, basicMat({ color: 0xf3e6cf, transparent: true, depthWrite: false }));
    m.visible = false;
    scene.add(m);
    dust.push({ m, vel: new THREE.Vector3(), life: 0 });
  }
}
let dustCursor = 0, dustClock = 0;
function puff(pos, vx, vz) {
  const d = dust[dustCursor++ % dust.length];
  d.m.visible = true;
  d.m.position.set(pos.x + (Math.random() - 0.5) * 0.4, pos.y + 0.15, pos.z + (Math.random() - 0.5) * 0.4);
  d.vel.set(vx + (Math.random() - 0.5) * 1.5, 1 + Math.random() * 1.2, vz + (Math.random() - 0.5) * 1.5);
  d.life = 0.75;
}
function updateDust(dt) {
  for (const d of dust) {
    if (!d.m.visible) continue;
    d.life -= dt;
    if (d.life <= 0) { d.m.visible = false; continue; }
    d.m.position.addScaledVector(d.vel, dt);
    d.vel.multiplyScalar(1 - 2.5 * dt);
    d.m.scale.setScalar(2.4 - d.life * 2.2);
    d.m.material.opacity = d.life * 0.6;
  }
}
// ponytail: tracks never fade — the ring buffer just recycles the oldest stamp.
// Per-instance alpha would need a custom attribute; add it if the pop-out ever shows.
const TRACK_N = 500;
const tracks = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(0.5, 1.5).rotateX(-Math.PI / 2),
  basicMat({ color: 0x5d4a30, transparent: true, opacity: 0.2, depthWrite: false }), TRACK_N);
tracks.count = 0;
tracks.frustumCulled = false;
scene.add(tracks);
let trackCursor = 0;
const trackLast = [new THREE.Vector3(), new THREE.Vector3()];
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _one = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);
function stampTrack(side, hit, normal, yaw) {
  if (trackLast[side].distanceToSquared(hit) < 1) return;
  trackLast[side].copy(hit);
  _q.setFromUnitVectors(UP, _v.copy(normal)).multiply(_q2.setFromAxisAngle(UP, yaw));
  _m4.compose(_v.set(hit.x, hit.y + 0.04, hit.z), _q, _one);
  tracks.setMatrixAt(trackCursor % TRACK_N, _m4);
  trackCursor++;
  tracks.count = Math.min(trackCursor, TRACK_N);
  tracks.instanceMatrix.needsUpdate = true;
}

function resetCar(pos = SPAWN, yaw = Math.PI) { // default: facing north, up the screen
  chassisBody.position.copy(pos);
  chassisBody.quaternion.setFromEuler(0, yaw, 0);
  chassisBody.velocity.setZero();
  chassisBody.angularVelocity.setZero();
  chassisBody.wakeUp();
}

/* =====================================================================
   AUDIO — synthesized with WebAudio, no files
   ===================================================================== */
const SFX = {
  ctx: null, muted: false,
  engineGain: null, engineOsc: null, engineFilter: null,
  windGain: null,
  init() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.master.connect(ctx.destination);
    // engine: saw → lowpass → gain
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 400;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0;
    this.engineOsc.connect(this.engineFilter).connect(this.engineGain).connect(this.master);
    this.engineOsc.start();
    // wind: looped noise → bandpass → gain
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noiseBuf = buf;
    const wind = ctx.createBufferSource();
    wind.buffer = buf; wind.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 500; bp.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0.015;
    wind.connect(bp).connect(this.windGain).connect(this.master);
    wind.start();
  },
  engine(speed, throttle, turbo) {
    if (!this.ctx || this.muted) return;
    const f = 50 + speed * 6 + (turbo ? 30 : 0) + (throttle ? 15 : 0);
    this.engineOsc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.08);
    this.engineFilter.frequency.setTargetAtTime(350 + speed * 40 + (turbo ? 400 : 0), this.ctx.currentTime, 0.1);
    const g = 0.02 + Math.min(speed / 40, 1) * 0.03 + (throttle ? 0.02 : 0) + (turbo ? 0.02 : 0);
    this.engineGain.gain.setTargetAtTime(g, this.ctx.currentTime, 0.1);
  },
  blip(freq, dur = 0.12, gain = 0.15, type = 'sine', when = 0) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  },
  chime() { this.blip(660, 0.15, 0.14); this.blip(990, 0.22, 0.14, 'sine', 0.09); },
  fanfare() { [523, 659, 784, 1046].forEach((f, i) => this.blip(f, 0.28, 0.16, 'triangle', i * 0.13)); },
  noiseBurst(dur, freq, gain) {
    if (!this.ctx || this.muted) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = freq;
    const g = this.ctx.createGain();
    const t = this.ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + dur + 0.02);
  },
  thud(strength) { this.noiseBurst(0.18, 300 + strength * 30, Math.min(0.05 + strength * 0.02, 0.25)); },
  splash() { this.noiseBurst(0.7, 900, 0.22); },
  jump() { this.blip(220, 0.18, 0.1, 'triangle'); },
  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.value = this.muted ? 0 : 0.9;
    return this.muted;
  },
};
// crash thuds
let lastThud = 0;
chassisBody.addEventListener('collide', (e) => {
  const v = Math.abs(e.contact.getImpactVelocityAlongNormal());
  const now = performance.now();
  if (v > 4 && now - lastThud > 180) { lastThud = now; SFX.thud(v); }
});

/* =====================================================================
   MISSIONS / CHECKPOINTS
   ===================================================================== */
const TASKS = [
  { id: 'move',     label: 'Fire up the truck and get moving' },
  { id: 'turbo',    label: 'Hit SHIFT for a turbo boost' },
  { id: 'jump',     label: 'Catch air with SPACE' },
  { id: 'projects', label: 'Cruise down Projects Avenue' },
  { id: 'open',     label: 'Open any link with E' },
  { id: 'smash',    label: 'Smash through the skills wall' },
  { id: 'bridge',   label: 'Cross the lake bridge' },
  { id: 'bowl',     label: 'Knock down 6 bowling pins' },
  { id: 'exp',      label: 'Tour the Experience road' },
  { id: 'contact',  label: 'Visit the Contact plaza' },
];
const taskState = (() => {
  try { return JSON.parse(localStorage.getItem('rp3d-missions-v1')) || {}; }
  catch { return {}; }
})();
const tasksListEl = document.getElementById('tasks-list');
const tasksCountEl = document.getElementById('tasks-count');
function renderTasks() {
  tasksListEl.innerHTML = '';
  let done = 0;
  for (const t of TASKS) {
    const li = document.createElement('li');
    li.textContent = t.label;
    if (taskState[t.id]) { li.classList.add('done'); done++; }
    tasksListEl.appendChild(li);
  }
  tasksCountEl.textContent = `${done}/${TASKS.length}`;
  return done;
}
function toast(msg, big = false) {
  const el = document.createElement('div');
  el.className = 'toast' + (big ? ' big' : '');
  el.textContent = msg;
  toastsEl.appendChild(el);
  setTimeout(() => el.remove(), 2900);
}
function completeTask(id) {
  if (taskState[id]) return;
  taskState[id] = true;
  localStorage.setItem('rp3d-missions-v1', JSON.stringify(taskState));
  const t = TASKS.find(t => t.id === id);
  const done = renderTasks();
  SFX.chime();
  confettiBurst(carGroup.position, 36);
  toast(`✓ Mission complete: ${t.label}`);
  if (done === TASKS.length) {
    setTimeout(() => { SFX.fanfare(); toast('🏆 ALL MISSIONS COMPLETE — you really explored everything!', true); confettiBurst(carGroup.position, 80); }, 900);
  }
}
document.getElementById('tasks-head').addEventListener('click', () =>
  document.getElementById('tasks').classList.toggle('closed'));

/* checkpoint rings */
const checkpoints = []; // { x, y, z, r, taskId, mesh, beam, done }
function checkpoint(x, z, taskId, y = 2.3, minY = 0) {
  const mesh = new THREE.Mesh(
    new THREE.TorusGeometry(2.2, 0.16, 12, 40),
    toonMat({ color: C.gold, emissive: 0xa87708, emissiveIntensity: 0.5, roughness: 0.35 })
  );
  mesh.position.set(x, y, z);
  scene.add(mesh);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.55, 9, 12, 1, true),
    basicMat({ color: C.gold, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })
  );
  beam.position.set(x, 4.5, z);
  scene.add(beam);
  const cp = { x, y, z, taskId, mesh, beam, minY, done: !!taskState[taskId] };
  if (cp.done) markCheckpointDone(cp);
  checkpoints.push(cp);
}
function markCheckpointDone(cp) {
  cp.done = true;
  cp.mesh.material.color.set(0x3f9e57);
  cp.mesh.material.emissive.set(0x1d5a2e);
  cp.beam.material.opacity = 0.05;
}

/* confetti pool */
const confetti = [];
{
  const colors = [0xe8921a, 0xc05010, 0x3f9e57, 0xfff3df, 0xe8b31a];
  for (let i = 0; i < 90; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.22, 0.22),
      basicMat({ color: colors[i % colors.length], side: THREE.DoubleSide, transparent: true })
    );
    m.visible = false;
    scene.add(m);
    confetti.push({ m, vel: new THREE.Vector3(), life: 0, spin: 0 });
  }
}
let confettiCursor = 0;
function confettiBurst(pos, n = 30) {
  for (let i = 0; i < n; i++) {
    const c = confetti[confettiCursor++ % confetti.length];
    c.m.visible = true;
    c.m.position.set(pos.x, pos.y + 1.5, pos.z);
    c.vel.set((Math.random() - 0.5) * 9, 5 + Math.random() * 6, (Math.random() - 0.5) * 9);
    c.spin = (Math.random() - 0.5) * 12;
    c.life = 1.3 + Math.random() * 0.4;
    c.m.material.opacity = 1;
  }
}
function updateConfetti(dt) {
  for (const c of confetti) {
    if (!c.m.visible) continue;
    c.life -= dt;
    if (c.life <= 0) { c.m.visible = false; continue; }
    c.vel.y -= 22 * dt;
    c.m.position.addScaledVector(c.vel, dt);
    c.m.rotation.x += c.spin * dt;
    c.m.rotation.y += c.spin * 0.7 * dt;
    if (c.life < 0.4) c.m.material.opacity = c.life / 0.4;
  }
}

/* =====================================================================
   WORLD CONTENT — built after fonts load so canvas textures use Inter
   ===================================================================== */
const pins = [];        // bowling pins {body, x0, z0}
const treePts = [];     // [x, z] for minimap
function buildWorld() {

/* ---- spawn area: name + hints ---- */
groundText('RAVI PRAJAPATI', 0, 8.5, 4.2, { color: '#5d4a30' });
groundText('ML/AI ENGINEER · FOUNDER OF THIMI TECH', 0, 12, 1.4, { color: '#8a6f4d' });
groundText('↑ PROJECTS', 0, -22, 2.2);
groundText('SKILLS →', 24, 4.6, 2.2 );
groundText('← CONTACT & LINKS', -24, 4.6, 2.2);
groundText('EXPERIENCE ↓', 0, 24, 2.2, { rotY: Math.PI });

/* pushable name letters ahead of spawn */
'RAVI'.split('').forEach((ch, i) => {
  labelledBox(ch, 1.7, 1.7, 1.7, (i - 1.5) * 2.4 + 8, 0.9, -12, { mass: 3, px: 78, bg: '#e8921a', fg: '#fffaf1' });
});

/* =====================  PROJECTS (north, −z)  ===================== */
const projects = [
  { title: 'PlanMyNepal', tag: 'Travel Tech · Live', url: 'https://planmynepal.com',
    desc: 'Travel & trip-planning platform for Nepal — itineraries, storytelling and local destination data in one place.' },
  { title: 'AI.ThimiTech', tag: 'RAG · LLM · SaaS · Live', url: 'https://ai.thimitech.com',
    desc: 'Custom chatbot service with trainable knowledge bases — RAG-powered answers tuned to each business.' },
  { title: 'Survey & Geoportal', tag: 'GIS · Gov Tech', url: 'https://survey.thimitech.com',
    desc: 'Geospatial survey and municipal management platform serving government bodies across Nepal.' },
  { title: 'Nepali TTS', tag: 'ML · NLP · Production',
    desc: 'Real-time Nepali text-to-speech, live in production on Annapurna Post and ThahaKhabar.' },
  { title: 'News Talk', tag: 'Recommendation · Mobile',
    desc: 'Personalized news recommendation app powered by ML on user interaction data. Android & iOS.' },
  { title: 'SIKKA', tag: 'Blockchain · AWS',
    desc: 'Digital voucher platform on Hyperledger Fabric — distributed digital tokens to beneficiaries.' },
];
groundText('FEATURED PROJECTS', 0, -30, 2.6, { color: '#7a3000' });
projects.forEach((p, i) => {
  const side = i % 2 === 0 ? -1 : 1;
  const z = -40 - Math.floor(i / 2) * 18;
  const x = side * 11;
  billboard({ title: p.title, tag: p.tag, desc: p.desc, x, z, rotY: side * -Math.PI / 2.6, w: 7.5 });
  pad({ x: x - side * 6, z, r: 3.4, tag: p.tag, title: p.title,
        desc: p.desc + (p.url ? '' : ' (no public link)'), url: p.url });
});

/* =====================  SKILLS (east, +x)  ===================== */
groundText('SKILLS — SMASH THE WALL', 38, 8, 2.4, { color: '#7a3000', rotY: -Math.PI / 2 });
{
  const skills = [
    'PyTorch', 'LLMs', 'RAG', 'Agentic AI', 'MCP',
    'NLP', 'Computer Vision', 'Hugging Face', 'FastAPI', 'Docker',
    'AWS', 'GCP', 'Airflow', 'Celery', 'FAISS',
    'Pinecone', 'n8n', 'PostgreSQL', 'Selenium', 'Streamlit',
  ];
  const bw = 3.4, bh = 1.3, bd = 1.1;
  skills.forEach((s, i) => {
    const row = Math.floor(i / 5);           // 4 rows of 5
    const col = i % 5;
    const offset = (row % 2) * (bw / 2);     // stagger like brickwork
    const b = labelledBox(s, bw, bh, bd,
      44,
      bh / 2 + row * (bh + 0.02),
      (col - 2) * (bw + 0.12) + offset - 8,
      { mass: 2, px: 40 });
    bricks.push({ body: b, x0: b.position.x, z0: b.position.z });
  });
}
/* run-up jump ramp toward the wall */
// one slab rising east, its low edge flush with the ground (no lip for the wheel rays to catch)
// (kept shallow: any steeper and a turbo run clears the wall instead of hitting it)
staticBox(8, 0.4, 6, 30, 0.416, -8, 0xd3b98c, 0, 0, 0.15);
staticBox(0.6, 0.75, 6, 33.6, 0.375, -8, 0xdcc6a0);

/* =====================  LAKE BRIDGE  ===================== */
groundText('THE LAKE', 32, -62, 1.8, { color: '#5f8a8d' });
// The ramps' top edges meet the deck exactly flush. Any lip here leaves a vertical
// face for the wheel raycasts to hit, and that kicks the truck back down the ramp.
staticBox(30.56, 0.4, 5, 32, 1.35, -48, 0xcbb28c);         // deck
staticBox(6.5, 0.4, 5, 13.6, 0.614, -48, 0xd3b98c, 0, 0, 0.23);   // west ramp up
staticBox(6.5, 0.4, 5, 50.4, 0.614, -48, 0xd3b98c, 0, 0, -0.23);  // east ramp down
// low rails so you don't slide off
staticBox(34, 0.5, 0.25, 32, 1.85, -50.4, 0xb59a73);
staticBox(34, 0.5, 0.25, 32, 1.85, -45.6, 0xb59a73);

/* =====================  EXPERIENCE + EDUCATION (south, +z)  ===================== */
groundText('EXPERIENCE', 0, 32, 2.6, { color: '#7a3000', rotY: Math.PI });
const jobs = [
  { title: 'Founder & CEO — Thimi Tech', tag: '2025 – Present · Bhaktapur',
    desc: 'Founded a Nepal-based software company shipping geoportals, municipal systems and AI products. Trusted by Bagmati Province Government, Explore Nepal, Modish Era and Navtech.', url: 'https://thimitech.com' },
  { title: 'ML Engineer — S.D.S. Nepal', tag: 'Jan 2024 – Ongoing · Kathmandu',
    desc: 'Production-grade ML for healthcare AI — automating claims and document workflows with OCR and NLP at cloud scale.' },
  { title: 'ML Engineer — Prixa Technologies', tag: 'Dec 2020 – Dec 2023 · Lalitpur',
    desc: 'Deployed AI models on AWS, PaperSpace and GCP. LLMs and generative models for personalization; Airflow/Celery data pipelines.' },
];
jobs.forEach((j, i) => {
  const side = i % 2 === 0 ? 1 : -1;
  const z = 42 + i * 16;
  billboard({ title: j.title, tag: j.tag, desc: j.desc, x: side * 10, z, rotY: side * Math.PI / 2.6 + (side > 0 ? Math.PI : 0), w: 8, accent: '#c05010' });
  pad({ x: side * 10 - side * 6.5, z, r: 3, tag: j.tag, title: j.title, desc: j.desc, url: j.url });
});
groundText('EDUCATION', 0, 96, 2.4, { color: '#7a3000', rotY: Math.PI });
billboard({
  title: 'MSc AI — Islington College', tag: 'Nov 2025 – Present · Kathmandu',
  desc: 'MSc IT with specialisation in Artificial Intelligence, affiliated with London Metropolitan University, UK.',
  x: -7, z: 106, rotY: Math.PI / 3 + Math.PI, w: 7.5, accent: '#8a5800',
});
billboard({
  title: 'B.E. — Kathmandu University', tag: 'Aug 2016 – Aug 2020 · Dhulikhel',
  desc: 'Undergraduate studies in Computer Engineering at Kathmandu University.',
  x: 7, z: 106, rotY: -Math.PI / 3 + Math.PI, w: 7.5, accent: '#8a5800',
});

/* =====================  CONTACT + SOCIAL (west, −x)  ===================== */
const socials = [
  { title: 'GitHub',    desc: 'github.com/roviso — code & experiments.',            url: 'https://github.com/roviso' },
  { title: 'LinkedIn',  desc: 'Connect professionally.',                            url: 'https://www.linkedin.com/in/ravi-prajapati-2b7422149' },
  { title: 'YouTube',   desc: '@rovisodominator — videos & streams.',               url: 'https://youtube.com/@rovisodominator' },
  { title: 'Instagram', desc: '@roviso_dominator',                                  url: 'https://www.instagram.com/roviso_dominator/' },
  { title: 'TikTok',    desc: '@roviso_dominator',                                  url: 'https://www.tiktok.com/@roviso_dominator' },
  { title: 'Twitch',    desc: 'twitch.tv/rovisodominator — live streams.',          url: 'https://www.twitch.tv/rovisodominator' },
  { title: 'Email me',  desc: 'ravi.praj05@gmail.com — always open to new projects.', url: 'mailto:ravi.praj05@gmail.com' },
  { title: 'Download CV', desc: 'Grab the latest PDF résumé.',                      url: 'ravi-cv-2026-updated.pdf' },
  { title: 'Classic portfolio', desc: 'The regular 2D version of this site.',       url: 'classic/' },
];
socials.forEach((s, i) => {
  const col = i % 3, row = Math.floor(i / 3);
  const x = -40 - row * 10;
  const z = (col - 1) * 10;
  pad({ x, z, r: 2.6, tag: 'LINK', title: s.title, desc: s.desc, url: s.url });
  const totem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.6, 1.6, 14),
    toonMat({ color: C.rust, roughness: 0.5 })
  );
  totem.position.set(x, 0.8, z);
  totem.castShadow = true;
  scene.add(totem);
  const tb = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(0.45, 0.6, 1.6, 10) });
  tb.position.set(x, 0.8, z);
  tb.updateAABB(); // static body posed after construction
  world.addBody(tb);
});

/* =====================  PLAYGROUND — bowling (south-west)  ===================== */
groundText('BOWLING', -34, 34, 2, { color: '#8a6f4d', rotY: Math.PI / 2 });
{
  const pinGeo = new THREE.CylinderGeometry(0.28, 0.42, 1.5, 12);
  const pinMat = toonMat({ color: 0xfffaf1, roughness: 0.5 });
  const stripeMat = toonMat({ color: C.rust, roughness: 0.5 });
  for (let row = 0; row < 4; row++) {
    for (let k = 0; k <= row; k++) {
      const x = -34 - row * 1.4;
      const z = 44 + (k - row / 2) * 1.5;
      const g = new THREE.Group();
      const pin = new THREE.Mesh(pinGeo, pinMat);
      pin.castShadow = true;
      g.add(pin);
      const stripe = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.18, 12), stripeMat);
      stripe.position.y = 0.35;
      g.add(stripe);
      scene.add(g);
      const b = new CANNON.Body({
        mass: 1.2,
        shape: new CANNON.Cylinder(0.3, 0.42, 1.5, 10),
        position: new CANNON.Vec3(x, 0.78, z),
        sleepSpeedLimit: 0.4,
      });
      world.addBody(b);
      track(g, b);
      pins.push({ body: b, x0: x, z0: z });
    }
  }
  const ball = new THREE.Mesh(
    new THREE.SphereGeometry(0.9, 24, 18),
    toonMat({ color: C.deep, roughness: 0.3 })
  );
  ball.castShadow = true;
  scene.add(ball);
  const ballBody = new CANNON.Body({ mass: 4, shape: new CANNON.Sphere(0.9), position: new CANNON.Vec3(-28, 1, 38) });
  world.addBody(ballBody);
  track(ball, ballBody);
}

/* Thimi is a potters' town: clay pots stacked around the island, begging to be knocked over */
{
  const potGeo = new THREE.LatheGeometry(
    [[0, 0], [0.32, 0], [0.5, 0.3], [0.52, 0.55], [0.36, 0.85], [0.3, 0.95], [0.38, 1.05]]
      .map(([r, y]) => new THREE.Vector2(r, y - 0.525)), 10);
  const potMat = toonMat({ color: C.clay, side: THREE.DoubleSide });
  const spots = [[14, -14], [-16, -18], [18, 16], [-14, 20], [8, 30], [-8, -34], [26, -28], [-26, -12], [52, 12], [-52, -16]];
  for (const [sx, sz] of spots) {
    for (const [ox, oz, sc] of [[0, 0, 1], [1.15, 0.3, 0.8], [0.45, 1.05, 0.65]]) {
      const x = sx + ox, z = sz + oz;
      const m = new THREE.Mesh(potGeo, potMat);
      m.scale.setScalar(sc);
      m.castShadow = true;
      scene.add(m);
      const b = new CANNON.Body({
        mass: 0.6 * sc,
        shape: new CANNON.Cylinder(0.42 * sc, 0.42 * sc, 1.05 * sc, 8),
        position: new CANNON.Vec3(x, groundH(x, z) + 0.55 * sc, z),
        sleepSpeedLimit: 0.4,
      });
      world.addBody(b);
      track(m, b);
    }
  }
}

/* =====================  TREES & ROCKS  ===================== */
{
  const N = 120;
  const mk = (geo, color) => {
    const im = new THREE.InstancedMesh(geo, toonMat({ color }), N);
    im.castShadow = true;
    im.count = 0;
    scene.add(im);
    return im;
  };
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.6, 6);
  const blobGeo = flat(new THREE.IcosahedronGeometry(1.3, 1));
  const pineTrunk = mk(trunkGeo, C.trunk), rhoTrunk = mk(trunkGeo, C.trunk);
  const cone1 = mk(flat(new THREE.ConeGeometry(1.35, 2.6, 7)), C.leafA);
  const cone2 = mk(flat(new THREE.ConeGeometry(0.95, 2.0, 7)), C.leafB);
  const blob1 = mk(blobGeo, 0xd4476c), blob2 = mk(blobGeo, 0xe8789a);
  const m4 = new THREE.Matrix4();
  const put = (im, x, y, z, s) => { m4.makeScale(s, s, s); m4.setPosition(x, y, z); im.setMatrixAt(im.count++, m4); };
  let placed = 0, guard = 0;
  while (placed < N && guard++ < 4000) {
    const x = (rand() * 2 - 1) * ISLE_RX, z = (rand() * 2 - 1) * ISLE_RZ;
    if (Math.hypot(x / ISLE_RX, z / ISLE_RZ) > 0.84 || flatDist(x, z) < 4) continue;
    const y = groundH(x, z), s = 0.85 + rand() * 0.65;
    const rho = placed % 4 === 3; // every fourth tree is a rhododendron in bloom
    if (rho) {
      put(rhoTrunk, x, y + 0.8 * s, z, s);
      put(blob1, x, y + 2.5 * s, z, s);
      put(blob2, x + 0.6 * s, y + 3.3 * s, z - 0.4 * s, s * 0.62);
    } else {
      put(pineTrunk, x, y + 0.8 * s, z, s);
      put(cone1, x, y + 2.3 * s, z, s);
      put(cone2, x, y + 3.6 * s, z, s);
    }
    const tb = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(0.32 * s, 0.4 * s, 3 * s, 8) });
    tb.position.set(x, y + 1.5 * s, z);
    tb.updateAABB(); // static body posed after construction
    world.addBody(tb);
    treePts.push([x, z, rho]);
    placed++;
  }

  const rockMat = toonMat({ color: 0xb8a88f });
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  for (let n = 0, tries = 0; n < 26 && tries < 2000; tries++) {
    const x = (rand() * 2 - 1) * ISLE_RX, z = (rand() * 2 - 1) * ISLE_RZ;
    if (Math.hypot(x / ISLE_RX, z / ISLE_RZ) > 0.92 || flatDist(x, z) < 5) continue;
    n++;
    const s = 0.7 + rand() * 1.3, y = groundH(x, z) + s * 0.3;
    const m = new THREE.Mesh(rockGeo, rockMat);
    m.scale.set(s, s * 0.75, s);
    m.position.set(x, y, z);
    m.rotation.y = rand() * Math.PI;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    const rb = new CANNON.Body({ mass: 0, shape: new CANNON.Sphere(s * 0.7) });
    rb.position.set(x, y, z);
    rb.updateAABB(); // static body posed after construction
    world.addBody(rb);
  }
}

/* =====================  LANDMARKS  ===================== */
const brickMat = toonMat({ color: C.brick }), roofMat = toonMat({ color: C.roof });
const goldMat = toonMat({ color: C.gold, emissive: 0x8a5a00, emissiveIntensity: 0.3 });
const lanternMat = toonMat({ color: 0x3a2418, emissive: 0xffb354, emissiveIntensity: 0 });
glows.push(lanternMat);
const deco = (geo, mat, x, y, z) => {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = m.receiveShadow = true;
  scene.add(m);
  return m;
};
const hipRoof = (sx, sy, sz, x, y, z) => deco(ROOF_GEO, roofMat, x, y, z).scale.set(sx, sy, sz);

/* a gate over Projects Avenue */
{
  const z = -25;
  for (const s of [-1, 1]) staticBox(1.3, 5, 1.3, s * 5.4, 2.5, z, C.brick);
  const sign = makeTexture(1024, 96, (g, w, h) => {
    g.fillStyle = '#5a2a1c'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e8b31a';
    g.font = '800 52px Inter, Arial, sans-serif';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('PROJECTS AVENUE', w / 2, h / 2 + 3);
  });
  const face = toonMat({ map: sign, emissive: 0xffffff, emissiveMap: sign, emissiveIntensity: 0.25 });
  const beam = new THREE.Mesh(new THREE.BoxGeometry(12.4, 1.1, 1.1), [roofMat, roofMat, roofMat, roofMat, face, face]);
  beam.position.set(0, 5.5, z);
  beam.castShadow = true;
  scene.add(beam);
  hipRoof(14.5, 1.2, 3.4, 0, 6.65, z);
  for (const sx of [-4.5, 0, 4.5]) deco(new THREE.ConeGeometry(0.22, 0.9, 8), goldMat, sx, 7.65, z);
}

/* a tiered pagoda on a stepped plinth, beside the Experience road */
{
  const x = -25, z = 65;
  [[14, 0], [11, 0.6], [8.2, 1.2]].forEach(([s, y]) => staticBox(s, 0.6, s, x, y + 0.3, z, C.stone));
  let y = 1.8;
  [[5.0, 2.6, 9.0], [3.6, 2.1, 6.8], [2.4, 1.8, 4.8]].forEach(([w, h, rw], i) => {
    if (i === 0) staticBox(w, h, w, x, y + h / 2, z, C.brick);
    else deco(new THREE.BoxGeometry(w, h, w), brickMat, x, y + h / 2, z);
    for (let k = 0; k < 4; k++) { // doorways that glow after dark
      const a = k * Math.PI / 2;
      deco(new THREE.BoxGeometry(w * 0.34, h * 0.6, 0.12), lanternMat,
        x + Math.sin(a) * w / 2, y + h * 0.36, z + Math.cos(a) * w / 2).rotation.y = a;
    }
    hipRoof(rw, 0.9, rw, x, y + h + 0.35, z);
    y += h + 0.8;
  });
  deco(new THREE.ConeGeometry(0.4, 1.7, 8), goldMat, x, y + 0.75, z);
}

/* a stupa past the contact plaza, with prayer flags strung from its spire */
{
  const x = -74, z = 0;
  staticBox(9, 0.7, 9, x, 0.35, z, C.stone);
  staticBox(7, 0.6, 7, x, 1.0, z, C.stone);
  deco(new THREE.SphereGeometry(3, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), toonMat({ color: 0xfffaf1 }), x, 1.3, z);
  deco(new THREE.BoxGeometry(1.4, 1.0, 1.4), goldMat, x, 4.7, z);
  deco(new THREE.ConeGeometry(0.8, 2.8, 8), goldMat, x, 6.6, z);
  const dome = new CANNON.Body({ mass: 0, shape: new CANNON.Sphere(3) });
  dome.position.set(x, 1.3, z);
  dome.updateAABB(); // static body posed after construction
  world.addBody(dome);

  const flagGeo = new THREE.PlaneGeometry(0.75, 0.6).translate(0, -0.3, 0); // hangs from its top edge
  const flagMats = [0x2f6fd0, 0xfffaf1, 0xd0342c, 0x2f9e57, 0xe8c21a].map((color) => toonMat({ color, side: THREE.DoubleSide }));
  const poleMat = toonMat({ color: C.deep }), lineMat = new THREE.LineBasicMaterial({ color: 0x5d4a30 });
  const top = new THREE.Vector3(x, 7.7, z);
  for (let k = 0; k < 4; k++) {
    const a = Math.PI / 4 + k * Math.PI / 2;
    const end = new THREE.Vector3(x + Math.cos(a) * 12, 3.2, z + Math.sin(a) * 12);
    deco(new THREE.CylinderGeometry(0.1, 0.13, 3.2, 6), poleMat, end.x, 1.6, end.z);
    const pts = [];
    for (let i = 0; i <= 16; i++) {
      const t = i / 16, p = top.clone().lerp(end, t);
      p.y -= Math.sin(t * Math.PI) * 1.3; // sag
      pts.push(p);
      if (i === 0 || i === 16) continue;
      const f = new THREE.Mesh(flagGeo, flagMats[i % 5]);
      f.position.copy(p);
      f.rotation.order = 'YXZ'; // flutter about the string, then face along it
      f.rotation.y = -a;
      scene.add(f);
      flags.push({ m: f, ph: i * 0.9 + k });
    }
    scene.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), lineMat));
  }
}

/* checkpoint rings (positions match minimap) */
checkpoint(0, -52, 'projects');
checkpoint(32, -48, 'bridge', 3.4, 2.0);
checkpoint(0, 60, 'exp');
checkpoint(-45, 0, 'contact');

} // end buildWorld

/* =====================================================================
   WIND STREAKS
   ===================================================================== */
const streaks = [];
{
  const geo = new THREE.PlaneGeometry(2.6, 0.06);
  const mat = () => basicMat({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
  for (let i = 0; i < 34; i++) {
    const m = new THREE.Mesh(geo, mat());
    m.position.set((Math.random() - 0.5) * 160, 1.5 + Math.random() * 7, (Math.random() - 0.5) * 160);
    m.rotation.x = -Math.PI / 2.4;
    scene.add(m);
    streaks.push({ m, speed: 7 + Math.random() * 8 });
  }
}
let windAngle = 0.7;
function updateWind(dt, t, turbo) {
  windAngle = 0.7 + Math.sin(t * 0.05) * 0.5;
  const dx = Math.cos(windAngle), dz = Math.sin(windAngle);
  const boost = turbo ? 2.2 : 1;
  for (const s of streaks) {
    s.m.position.x += dx * s.speed * boost * dt;
    s.m.position.z += dz * s.speed * boost * dt;
    s.m.rotation.z = -windAngle;
    s.m.material.opacity = turbo ? 0.3 : 0.14;
    // wrap around the car
    const rx = s.m.position.x - carGroup.position.x;
    const rz = s.m.position.z - carGroup.position.z;
    if (rx * rx + rz * rz > 90 * 90) {
      s.m.position.x = carGroup.position.x - dx * 80 + (Math.random() - 0.5) * 90;
      s.m.position.z = carGroup.position.z - dz * 80 + (Math.random() - 0.5) * 90;
    }
  }
  if (SFX.ctx && !SFX.muted) SFX.windGain.gain.setTargetAtTime(0.012 + (turbo ? 0.02 : 0), SFX.ctx.currentTime, 0.3);
}

/* =====================================================================
   MINIMAP
   ===================================================================== */
const mm = document.getElementById('minimap');
const mmCtx = mm.getContext('2d');
const mmBg = document.createElement('canvas');
mmBg.width = mm.width; mmBg.height = mm.height;
const W2M_X = mm.width / 250, W2M_Z = mm.height / 320; // world [-125,125]×[-160,160]
const mx = (x) => (x + 125) * W2M_X;
const my = (z) => (z + 160) * W2M_Z;
function drawMinimapBg() {
  const g = mmBg.getContext('2d');
  g.fillStyle = '#9fc4c9';
  g.fillRect(0, 0, mmBg.width, mmBg.height);
  // island
  g.fillStyle = '#eadbc2';
  g.beginPath();
  g.ellipse(mx(0), my(0), ISLE_RX * 0.92 * W2M_X, ISLE_RZ * 0.92 * W2M_Z, 0, 0, Math.PI * 2);
  g.fill();
  g.strokeStyle = '#e5d0a8'; g.lineWidth = 2; g.stroke();
  // roads
  g.fillStyle = '#d3b78e';
  for (const [cx, cz, w, h] of ROADS) {
    g.fillRect(mx(cx - w / 2), my(cz - h / 2), w * W2M_X, h * W2M_Z);
  }
  // lake
  g.fillStyle = '#9fc4c9';
  g.beginPath();
  g.ellipse(mx(LAKE.x), my(LAKE.z), LAKE.rx * W2M_X, LAKE.rz * W2M_Z, 0, 0, Math.PI * 2);
  g.fill();
  // bridge
  g.fillStyle = '#cbb28c';
  g.fillRect(mx(15), my(-49.5), 34 * W2M_X, 3 * W2M_Z);
  // trees
  for (const [x, z, rho] of treePts) {
    g.fillStyle = rho ? '#d4476c' : '#8aa065';
    g.beginPath(); g.arc(mx(x), my(z), 1, 0, Math.PI * 2); g.fill();
  }
  // zone labels
  g.fillStyle = '#7a3000';
  g.font = '700 7px Inter, Arial';
  g.textAlign = 'center';
  g.fillText('PROJECTS', mx(0), my(-58) - 4);
  g.fillText('SKILLS', mx(44), my(-10));
  g.fillText('LINKS', mx(-50), my(-6));
  g.fillText('EXPERIENCE', mx(0), my(58));
  g.fillText('EDU', mx(0), my(104));
  g.fillText('BOWL', mx(-38), my(42) + 8);
}
function drawMinimap() {
  mmCtx.clearRect(0, 0, mm.width, mm.height);
  mmCtx.drawImage(mmBg, 0, 0);
  // checkpoints
  for (const cp of checkpoints) {
    mmCtx.fillStyle = cp.done ? '#3f9e57' : '#e8b31a';
    mmCtx.beginPath();
    mmCtx.arc(mx(cp.x), my(cp.z), 3, 0, Math.PI * 2);
    mmCtx.fill();
    mmCtx.strokeStyle = '#fffaf1'; mmCtx.lineWidth = 1; mmCtx.stroke();
  }
  // car arrow
  const p = chassisBody.position;
  const f = new THREE.Vector3(0, 0, 1).applyQuaternion(carGroup.quaternion);
  const yaw = Math.atan2(f.x, f.z);
  mmCtx.save();
  mmCtx.translate(mx(p.x), my(p.z));
  mmCtx.rotate(yaw);            // canvas y grows with world +z
  mmCtx.fillStyle = '#c05010';
  mmCtx.beginPath();
  mmCtx.moveTo(0, 5.5);
  mmCtx.lineTo(-3.4, -3.5);
  mmCtx.lineTo(0, -1.6);
  mmCtx.lineTo(3.4, -3.5);
  mmCtx.closePath();
  mmCtx.fill();
  mmCtx.restore();
}

/* fast travel: click the minimap to jump to the nearest stop */
const TRAVEL = [ // yaw: π = north, π/2 = east, 0 = south, −π/2 = west
  { name: 'Home',       x: 0,   z: 0,   yaw: Math.PI },
  { name: 'Projects',   x: 0,   z: -32, yaw: Math.PI },
  { name: 'Skills',     x: 18,  z: -8,  yaw: Math.PI / 2 },
  { name: 'The Lake',   x: 9,   z: -48, yaw: Math.PI / 2 },
  { name: 'Links',      x: -30, z: 0,   yaw: -Math.PI / 2 },
  { name: 'Bowling',    x: -20, z: 44,  yaw: -Math.PI / 2 },
  { name: 'Experience', x: 0,   z: 30,  yaw: 0 },
  { name: 'Pagoda',     x: -12, z: 65,  yaw: -Math.PI / 2 },
  { name: 'Education',  x: 0,   z: 92,  yaw: 0 },
];
mm.addEventListener('click', (e) => {
  const r = mm.getBoundingClientRect();
  const wx = (e.clientX - r.left) / r.width * 250 - 125;
  const wz = (e.clientY - r.top) / r.height * 320 - 160;
  let best = TRAVEL[0];
  for (const p of TRAVEL) if (Math.hypot(p.x - wx, p.z - wz) < Math.hypot(best.x - wx, best.z - wz)) best = p;
  resetCar(new CANNON.Vec3(best.x, 2.2, best.z), best.yaw);
  SFX.chime();
  toast(`⚡ Fast travel → ${best.name}`);
});

/* =====================================================================
   INPUT
   ===================================================================== */
const input = { fwd: false, back: false, left: false, right: false, turbo: false, axis: 0 }; // axis: analog steer from the touch stick
let nearPad = null;

const KEYMAP = {
  KeyW: 'fwd', ArrowUp: 'fwd',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'turbo', ShiftRight: 'turbo',
};
window.addEventListener('keydown', (e) => {
  if (KEYMAP[e.code]) { input[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (e.code === 'Space') { e.preventDefault(); tryJump(); }
  if (e.code === 'KeyR') resetCar();
  if (e.code === 'KeyE' && nearPad && nearPad.url) openPad(nearPad);
});
window.addEventListener('keyup', (e) => {
  if (KEYMAP[e.code]) input[KEYMAP[e.code]] = false;
});

let lastJump = 0;
let wheelsGrounded = [false, false, false, false];
function tryJump() {
  const now = performance.now();
  if (now - lastJump < 900) return;
  const grounded = wheelsGrounded.filter(Boolean).length >= 2;
  if (!grounded) return;
  lastJump = now;
  chassisBody.applyImpulse(new CANNON.Vec3(0, chassisBody.mass * JUMP_SPEED, 0), new CANNON.Vec3(0, 0, 0));
  chassisBody.wakeUp();
  SFX.jump();
  completeTask('jump');
}

function openPad(p) {
  completeTask('open');
  if (p.url.startsWith('mailto:') || !p.url.includes('://')) {
    window.location.href = p.url;
  } else {
    window.open(p.url, '_blank', 'noopener');
  }
}
panelOpen.addEventListener('click', () => { if (nearPad && nearPad.url) openPad(nearPad); });
document.getElementById('reset-btn').addEventListener('click', () => resetCar());
document.getElementById('sound-btn').addEventListener('click', (e) => {
  const muted = SFX.toggleMute();
  e.target.textContent = muted ? '🔇' : '🔊';
});

/* touch controls */
const isTouch = window.matchMedia('(pointer: coarse)').matches;
if (isTouch) {
  touchUI.classList.remove('hidden');
  document.getElementById('tasks').classList.add('closed'); // keep the small screen clear
  // thumb stick: x steers (analog), pushing up/down drives
  const stick = document.getElementById('stick'), knob = document.getElementById('stick-knob');
  const stickMove = (e) => {
    const r = stick.getBoundingClientRect(), R = r.width / 2;
    let dx = (e.clientX - r.left - R) / R, dy = (e.clientY - r.top - R) / R;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    knob.style.transform = `translate(${dx * R * 0.55}px, ${dy * R * 0.55}px)`;
    input.axis = Math.abs(dx) > 0.12 ? -dx : 0; // + = left, same as the keyboard
    input.fwd = dy < -0.25;
    input.back = dy > 0.5;
  };
  const stickEnd = () => { knob.style.transform = ''; input.axis = 0; input.fwd = input.back = false; };
  stick.addEventListener('pointerdown', (e) => { stick.setPointerCapture(e.pointerId); stickMove(e); });
  stick.addEventListener('pointermove', (e) => { if (stick.hasPointerCapture(e.pointerId)) stickMove(e); });
  stick.addEventListener('pointerup', stickEnd);
  stick.addEventListener('pointercancel', stickEnd);
  touchUI.querySelectorAll('button').forEach((btn) => {
    const k = btn.dataset.k;
    if (k === 'jump') {
      btn.addEventListener('touchstart', (e) => { e.preventDefault(); tryJump(); }, { passive: false });
      return;
    }
    const on = (e) => { e.preventDefault(); input[k] = true; };
    const off = (e) => { e.preventDefault(); input[k] = false; };
    btn.addEventListener('touchstart', on, { passive: false });
    btn.addEventListener('touchend', off);
    btn.addEventListener('touchcancel', off);
  });
}

/* start */
let started = false, startedAt = 0;
function start() {
  if (started) return;
  started = true;
  startedAt = clock.elapsedTime;
  SFX.init();
  overlay.classList.add('fade');
  hud.classList.remove('hidden');
  setTimeout(() => overlay.classList.add('hidden'), 700);
}
startBtn.addEventListener('click', start);
window.addEventListener('keydown', () => start(), { once: true });

/* =====================================================================
   WATER / MISSION CHECKS
   ===================================================================== */
function inLake(x, z) { return ((x - LAKE.x) / LAKE.rx) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2 < 1.7; }

let splashLock = 0;
function checkWater(t) {
  const p = chassisBody.position;
  // the truck can wade the shallows; it's a splash once the chassis is awash
  if (t < splashLock || p.y > WATER_Y + 0.35) return;
  splashLock = t + 2;
  SFX.splash();
  if (inLake(p.x, p.z)) {
    toast('🌊 Into the lake! Try the bridge.');
    resetCar(new CANNON.Vec3(10, 2.2, -48), Math.PI / 2);
  } else {
    toast('🌊 SPLASH! The ocean is not a shortcut…');
    resetCar();
  }
}

let missionTick = 0;
function checkMissions(t) {
  if (t - missionTick < 0.5) return;
  missionTick = t;
  const v = chassisBody.velocity;
  const hSpeed = Math.hypot(v.x, v.z); // horizontal only — the spawn drop must not count
  if (!taskState.move && hSpeed > 2 && (input.fwd || input.back)) completeTask('move');
  if (!taskState.turbo && input.turbo && hSpeed > 6) completeTask('turbo');
  if (!taskState.smash) {
    for (const b of bricks) {
      const dx = b.body.position.x - b.x0, dz = b.body.position.z - b.z0;
      if (dx * dx + dz * dz > 9) { completeTask('smash'); break; }
    }
  }
  if (!taskState.bowl) {
    let down = 0;
    for (const p of pins) {
      const dx = p.body.position.x - p.x0, dz = p.body.position.z - p.z0;
      const up = p.body.quaternion.vmult(new CANNON.Vec3(0, 1, 0));
      if (dx * dx + dz * dz > 1.4 || up.y < 0.55) down++;
    }
    if (down >= 6) completeTask('bowl');
  }
  // checkpoint rings
  const p = chassisBody.position;
  for (const cp of checkpoints) {
    if (cp.done) continue;
    const dx = p.x - cp.x, dz = p.z - cp.z;
    if (dx * dx + dz * dz < 12 && p.y > cp.minY) {
      markCheckpointDone(cp);
      completeTask(cp.taskId);
    }
  }
}

/* =====================================================================
   LOOP
   ===================================================================== */
let steerCur = 0, drifting = false;
function applyControls(dt) {
  const speed = chassisBody.velocity.length();
  const cap = input.turbo ? TURBO_CAP : SPEED_CAP;
  const force = input.turbo ? TURBO_FORCE : MAX_FORCE;
  // cannon RaycastVehicle: negative engine force = local +z = where the headlights are
  const engine = (input.fwd && speed < cap) ? -force : input.back ? force * 0.6 : 0;
  // steering eases in and tightens up at speed, so the truck doesn't twitch
  const want = (input.axis || (input.left ? 1 : input.right ? -1 : 0)) * MAX_STEER * (1 - 0.45 * Math.min(speed / TURBO_CAP, 1));
  steerCur += (want - steerCur) * Math.min(1, dt * 9);
  const steer = steerCur;
  // turbo + hard lock breaks the tail loose
  drifting = input.turbo && input.fwd && speed > 12 && Math.abs(steerCur) > 0.12;
  vehicle.wheelInfos[2].frictionSlip = vehicle.wheelInfos[3].frictionSlip = drifting ? DRIFT_SLIP : GRIP_SLIP;
  if (wheelsGrounded[2] || wheelsGrounded[3]) {
    chassisBody.angularVelocity.y = Math.max(-MAX_YAW, Math.min(MAX_YAW, chassisBody.angularVelocity.y));
  }
  vehicle.applyEngineForce(engine, 2);
  vehicle.applyEngineForce(engine, 3);
  // all-wheel drive during turbo for stability
  vehicle.applyEngineForce(input.turbo ? engine * 0.7 : 0, 0);
  vehicle.applyEngineForce(input.turbo ? engine * 0.7 : 0, 1);
  vehicle.setSteeringValue(steer, 0);
  vehicle.setSteeringValue(steer, 1);
  // gentle rolling brake when coasting
  const brake = (!input.fwd && !input.back && speed > 0.5) ? 1.2 : 0;
  for (let i = 0; i < 4; i++) vehicle.setBrake(brake, i);
  if (engine !== 0 || Math.abs(steer) > 0.01) chassisBody.wakeUp();
  tailMat.emissiveIntensity = (input.back || brake) ? 2.4 : 0.4 + night.k * 0.6;
  SFX.engine(speed, input.fwd || input.back, input.turbo && input.fwd);
}

function updatePads() {
  const carPos = new THREE.Vector3(chassisBody.position.x, 0, chassisBody.position.z);
  let best = null, bestD = Infinity;
  for (const p of pads) {
    const d = carPos.distanceTo(p.pos);
    if (d < p.r && d < bestD) { best = p; bestD = d; }
  }
  if (best !== nearPad) {
    nearPad = best;
    if (best) {
      panelTag.textContent = best.tag;
      panelTitle.textContent = best.title;
      panelDesc.textContent = best.desc;
      panelOpen.classList.toggle('hidden', !best.url);
      panel.classList.remove('hidden');
    } else {
      panel.classList.add('hidden');
    }
  }
}

const clock = new THREE.Clock();
const camTarget = new THREE.Vector3(), camLook = new THREE.Vector3();
let padPulse = 0, lastStep = -1;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const t = clock.elapsedTime;

  if (started) applyControls(dt);
  world.step(1 / 60, dt, 3);
  // cache contact state right after stepping: updateWheelTransform() below
  // (used purely to sync wheel meshes) resets wheelInfo.isInContact as a
  // side effect, so anything checking "grounded" must read this snapshot.
  // Only when a physics step actually ran: on displays faster than 60 Hz most
  // frames have no step, and reading then would see the already-reset flags.
  if (world.stepnumber !== lastStep) {
    lastStep = world.stepnumber;
    wheelsGrounded = vehicle.wheelInfos.map((w) => w.isInContact);
  }

  // truck
  carGroup.position.copy(chassisBody.position);
  carGroup.quaternion.copy(chassisBody.quaternion);
  // local velocity: z = forward speed, x = sideways slip
  const lv = _v.copy(chassisBody.velocity).applyQuaternion(_q.copy(carGroup.quaternion).invert());
  const fwdSpeed = lv.z, slip = Math.abs(lv.x);
  // body roll out of corners + squat under power, on top of the real suspension
  const roll = THREE.MathUtils.clamp(steerCur * fwdSpeed * 0.013, -0.11, 0.11);
  const pitch = !started ? 0 : input.fwd ? (input.turbo ? -0.06 : -0.03) : input.back ? 0.04 : 0;
  carBody.rotation.z += (roll - carBody.rotation.z) * 0.12;
  carBody.rotation.x += (pitch - carBody.rotation.x) * 0.1;
  // dust off the rear wheels, tracks when sliding or off-road
  const yaw = Math.atan2(chassisBody.velocity.x, chassisBody.velocity.z);
  const speedNow = chassisBody.velocity.length();
  dustClock -= dt;
  for (const i of [2, 3]) {
    if (!wheelsGrounded[i] || speedNow < 5) continue;
    const hit = vehicle.wheelInfos[i].raycastResult.hitPointWorld;
    if (slip > 3 || drifting || hit.y > 0.3) stampTrack(i - 2, hit, vehicle.wheelInfos[i].raycastResult.hitNormalWorld, yaw);
    if (dustClock <= 0) puff(hit, -chassisBody.velocity.x * 0.12, -chassisBody.velocity.z * 0.12);
  }
  if (dustClock <= 0) dustClock = drifting || slip > 3 ? 0.035 : input.turbo ? 0.07 : 0.16;
  headlight.intensity = night.k * 26;
  for (let i = 0; i < 4; i++) {
    vehicle.updateWheelTransform(i);
    const tr = vehicle.wheelInfos[i].worldTransform;
    wheelMeshes[i].position.copy(tr.position);
    wheelMeshes[i].quaternion.copy(tr.quaternion);
  }
  if (chassisBody.position.y < -15) resetCar();

  // dynamic props
  for (const s of synced) {
    s.mesh.position.copy(s.body.position);
    s.mesh.quaternion.copy(s.body.quaternion);
  }

  // camera: slow orbit of the island on the title screen, then sweep down to the
  // truck and follow it, leading a little in the direction of travel
  if (!started) {
    const a = t * 0.06 + 0.9;
    camTarget.set(0, 0, 0);
    camera.position.set(Math.cos(a) * 82, 17, Math.sin(a) * 82);
    camLook.set(0, 5, 0);
  } else {
    const k = Math.min(0.08, 0.012 + (t - startedAt) * 0.022);
    camTarget.set(chassisBody.position.x + chassisBody.velocity.x * 0.22, Math.max(chassisBody.position.y - 1.1, WATER_Y),
      chassisBody.position.z + chassisBody.velocity.z * 0.22);
    camera.position.lerp(_v.copy(camTarget).addScaledVector(CAM_OFFSET, camZoom), k);
    camLook.lerp(_v.set(camTarget.x, camTarget.y + 1.2, camTarget.z), Math.min(1, k * 2.2));
  }
  camera.lookAt(camLook);
  const wantFov = input.turbo && input.fwd ? 58 : 50;
  if (Math.abs(camera.fov - wantFov) > 0.1) {
    camera.fov += (wantFov - camera.fov) * 0.08;
    camera.updateProjectionMatrix();
  }

  // shadows follow the car
  sun.position.set(camTarget.x - 40, 70, camTarget.z + 30);
  sun.target.position.copy(camTarget);

  // ambient motion
  padPulse += dt * 2.4;
  const ps = 1 + Math.sin(padPulse) * 0.045;
  for (const p of pads) p.ring.scale.set(ps, ps, 1);
  for (const cp of checkpoints) {
    cp.mesh.rotation.y += dt * (cp.done ? 0.4 : 1.6);
    cp.mesh.position.y = cp.y + Math.sin(t * 2 + cp.x) * 0.15;
  }
  waterMat.uniforms.uTime.value = grassMat.uniforms.uTime.value = t;
  sky.position.copy(camera.position);
  updateDay(t);
  updateWind(dt, t, input.turbo && input.fwd);
  updateConfetti(dt);
  updateDust(dt);
  for (const f of flags) f.m.rotation.x = 0.15 + Math.sin(t * 3.2 + f.ph) * 0.35;

  if (started) {
    checkWater(t);
    checkMissions(t);
    drawMinimap();
  }
  updatePads();
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  fitCamera();
});

/* wait for the display font so canvas textures render with Inter */
async function boot() {
  try {
    await Promise.race([
      document.fonts.load('900 100px Inter').then(() => document.fonts.ready),
      new Promise((res) => setTimeout(res, 1500)),
    ]);
  } catch { /* fall back to system font */ }
  buildWorld();
  resetCar(); // face north, toward Projects
  drawMinimapBg();
  renderTasks();
  // deep-link straight into the game: #go, or #go=x,z to spawn elsewhere
  if (location.hash.startsWith('#go')) {
    const m = location.hash.match(/^#go=(-?\d+),(-?\d+)$/);
    if (m) resetCar(new CANNON.Vec3(+m[1], groundH(+m[1], +m[2]) + 2.2, +m[2]));
    start();
  }
  animate();
}
boot();
