/* =====================================================================
   Ravi Prajapati — interactive 3D portfolio
   Drive a monster truck around an island to explore the work.
   Three.js (render) + cannon-es (physics), fully static, no server.
   Controls: WASD/arrows drive · SHIFT turbo · SPACE jump · E interact
   ===================================================================== */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/* ------------------------------------------------ palette / config */
const C = {
  paper:  0xf4ead9,
  ground: 0xeadbc2,
  beach:  0xf0e2c4,
  road:   0xdec6a1,
  water:  0x8fbcbb,
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
};
const GRAVITY = -30;
const MAX_FORCE = 1000;
const TURBO_FORCE = 1900;
const MAX_STEER = 0.55;
const SPEED_CAP = 24;
const TURBO_CAP = 38;
const JUMP_SPEED = 9.5;
const SPAWN = new CANNON.Vec3(0, 2.2, 0);
// island footprint (ellipse) — beyond this is ocean
const ISLE_RX = 115, ISLE_RZ = 150;
const EDGE_RX = 119, EDGE_RZ = 154;
// lake (ellipse) crossed by the bridge
const LAKE = { x: 32, z: -48, rx: 13, rz: 10 };

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

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 500);
const CAM_OFFSET = new THREE.Vector3(15, 18, 15);
camera.position.copy(CAM_OFFSET);
camera.lookAt(0, 0, 0);

const hemi = new THREE.HemisphereLight(0xfff6e6, 0xcaa878, 0.85);
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

const groundBody = new CANNON.Body({ mass: 0, shape: new CANNON.Plane() });
groundBody.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
// cannon-es computes a body's AABB at construction; posing a STATIC body
// afterwards leaves it stale, which silently breaks raycasts + SAP broadphase.
groundBody.updateAABB();
world.addBody(groundBody);

/* ------------------------------------------------ island / ocean / lake */
function ellipseGeo(rx, rz, segs = 96) {
  const shape = new THREE.Shape();
  shape.absellipse(0, 0, rx, rz, 0, Math.PI * 2);
  return new THREE.ShapeGeometry(shape, segs);
}
const waterMat = new THREE.MeshStandardMaterial({ color: C.water, roughness: 0.35, metalness: 0.05 });
let ocean, lakeMesh;
{
  ocean = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600), waterMat);
  ocean.rotation.x = -Math.PI / 2;
  ocean.position.y = -0.12;
  scene.add(ocean);

  const beach = new THREE.Mesh(ellipseGeo(EDGE_RX + 2, EDGE_RZ + 2),
    new THREE.MeshStandardMaterial({ color: C.beach, roughness: 1 }));
  beach.rotation.x = -Math.PI / 2;
  beach.position.y = -0.06;
  beach.receiveShadow = true;
  scene.add(beach);

  const island = new THREE.Mesh(ellipseGeo(ISLE_RX, ISLE_RZ),
    new THREE.MeshStandardMaterial({ color: C.ground, roughness: 1 }));
  island.rotation.x = -Math.PI / 2;
  island.receiveShadow = true;
  scene.add(island);

  lakeMesh = new THREE.Mesh(ellipseGeo(LAKE.rx, LAKE.rz, 48), waterMat.clone());
  lakeMesh.rotation.x = -Math.PI / 2;
  lakeMesh.position.set(LAKE.x, 0.05, LAKE.z);
  scene.add(lakeMesh);

  // soft light patch at spawn
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const rad = g.createRadialGradient(128, 128, 10, 128, 128, 128);
  rad.addColorStop(0, 'rgba(255,250,240,0.9)');
  rad.addColorStop(1, 'rgba(255,250,240,0)');
  g.fillStyle = rad; g.fillRect(0, 0, 256, 256);
  const patch = new THREE.Mesh(
    new THREE.PlaneGeometry(90, 90),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false })
  );
  patch.rotation.x = -Math.PI / 2;
  patch.position.y = 0.008;
  scene.add(patch);
}

/* roads */
const ROADS = [ // [cx, cz, w(x-extent), h(z-extent)]
  [0, -42, 6, 80],    // north → projects
  [0, 58, 6, 112],    // south → experience/education
  [24, 0, 46, 6],     // east → skills
  [-32, 0, 62, 6],    // west → contact
  [11.5, -48, 9, 5],  // bridge approach
];
{
  const roadMat = new THREE.MeshStandardMaterial({ color: C.road, roughness: 1 });
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
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, opacity: opts.opacity ?? 1 })
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
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85 });
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
    new THREE.MeshStandardMaterial({ color, roughness: 0.9 })
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

/* billboard sign: card texture on posts, static physics */
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
  const h = w * (400 / 640);
  const faceMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
  const sideMat = new THREE.MeshStandardMaterial({ color: 0xefe0c8, roughness: 0.9 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.25),
    [sideMat, sideMat, sideMat, sideMat, faceMat, faceMat]);
  const yBoard = h / 2 + 1.5;
  board.position.set(x, yBoard, z);
  board.rotation.y = rotY;
  board.castShadow = board.receiveShadow = true;
  scene.add(board);
  const postGeo = new THREE.CylinderGeometry(0.12, 0.12, 1.7, 10);
  const postMat = new THREE.MeshStandardMaterial({ color: C.deep, roughness: 0.8 });
  for (const side of [-1, 1]) {
    const p = new THREE.Mesh(postGeo, postMat);
    const off = new THREE.Vector3(side * (w / 2 - 0.5), 0.85, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    p.position.set(x + off.x, off.y, z + off.z);
    p.castShadow = true;
    scene.add(p);
  }
  const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(w / 2, (h + 1.7) / 2, 0.2)) });
  body.position.set(x, (h + 1.7) / 2, z);
  body.quaternion.setFromEuler(0, rotY, 0);
  body.updateAABB(); // static body posed after construction
  world.addBody(body);
}

/* interactive circular pad on the ground */
const pads = []; // { pos, r, tag, title, desc, url, ring }
function pad({ x, z, r = 3.2, tag, title, desc, url }) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(r - 0.35, r, 48),
    new THREE.MeshBasicMaterial({ color: C.orange, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.035, z);
  scene.add(ring);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(r - 0.4, 48),
    new THREE.MeshBasicMaterial({ color: C.cream, transparent: true, opacity: 0.35, depthWrite: false })
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
const carGroup = new THREE.Group();
{
  const bodyMat = new THREE.MeshStandardMaterial({ color: C.orange, roughness: 0.4, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x33251a, roughness: 0.6 });
  const steelMat = new THREE.MeshStandardMaterial({ color: 0x8f8577, roughness: 0.35, metalness: 0.5 });

  const main = new THREE.Mesh(new THREE.BoxGeometry(2.0, 0.75, 3.7), bodyMat);
  main.position.y = 0.1;
  main.castShadow = true;
  carGroup.add(main);
  const hood = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.3, 1.0), bodyMat);
  hood.position.set(0, 0.55, 1.15);
  hood.castShadow = true;
  carGroup.add(hood);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.8, 1.7), darkMat);
  cabin.position.set(0, 0.85, -0.25);
  cabin.castShadow = true;
  carGroup.add(cabin);
  // roll bar with spotlights
  const bar = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.14, 0.14), steelMat);
  bar.position.set(0, 1.38, 0.55);
  carGroup.add(bar);
  const spotGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.16, 10);
  const spotMat = new THREE.MeshStandardMaterial({ color: 0xfff2c9, emissive: 0xffe9a8, emissiveIntensity: 0.8 });
  for (const sx of [-0.55, -0.18, 0.18, 0.55]) {
    const s = new THREE.Mesh(spotGeo, spotMat);
    s.rotation.x = Math.PI / 2;
    s.position.set(sx, 1.38, 0.65);
    carGroup.add(s);
  }
  // exhaust stacks
  const pipeGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.9, 10);
  for (const sx of [-0.75, 0.75]) {
    const p = new THREE.Mesh(pipeGeo, steelMat);
    p.position.set(sx, 0.95, -1.35);
    p.castShadow = true;
    carGroup.add(p);
  }
  // lamps
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff2c9, emissive: 0xffe9a8, emissiveIntensity: 0.9 });
  for (const s of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.2, 0.1), lightMat);
    lamp.position.set(s * 0.62, 0.28, 1.87);
    carGroup.add(lamp);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xb02010, emissive: 0x801008, emissiveIntensity: 0.6 }));
    tail.position.set(s * 0.62, 0.3, -1.87);
    carGroup.add(tail);
  }
}
scene.add(carGroup);

const wheelMeshes = [];
{
  const wheelGeo = new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.55, 20);
  wheelGeo.rotateZ(Math.PI / 2); // axis → x
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x2a2119, roughness: 0.9 });
  const hubGeo = new THREE.CylinderGeometry(0.34, 0.34, 0.58, 12);
  hubGeo.rotateZ(Math.PI / 2);
  const hubMat = new THREE.MeshStandardMaterial({ color: 0xd8c9ae, roughness: 0.4 });
  for (let i = 0; i < 4; i++) {
    const g = new THREE.Group();
    const tyre = new THREE.Mesh(wheelGeo, tyreMat);
    tyre.castShadow = true;
    g.add(tyre);
    g.add(new THREE.Mesh(hubGeo, hubMat));
    scene.add(g);
    wheelMeshes.push(g);
  }
}

function resetCar(pos = SPAWN, yaw = 0) {
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
    new THREE.MeshStandardMaterial({ color: C.gold, emissive: 0xa87708, emissiveIntensity: 0.5, roughness: 0.35 })
  );
  mesh.position.set(x, y, z);
  scene.add(mesh);
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.35, 0.55, 9, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: C.gold, transparent: true, opacity: 0.14, depthWrite: false, side: THREE.DoubleSide })
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
      new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, transparent: true })
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
staticBox(8, 0.5, 6, 30, 0.4, -8, 0xdcc6a0, Math.PI / 2, 0);
staticBox(7, 0.4, 9, 32, 1.1, -8, 0xd3b98c, Math.PI / 2, 0, 0.26);

/* =====================  LAKE BRIDGE  ===================== */
groundText('THE LAKE', 32, -62, 1.8, { color: '#5f8a8d' });
staticBox(34, 0.4, 5, 32, 1.35, -48, 0xcbb28c);          // deck
staticBox(6.5, 0.4, 5, 13.6, 0.72, -48, 0xd3b98c, 0, 0, 0.23);   // west ramp up
staticBox(6.5, 0.4, 5, 50.4, 0.72, -48, 0xd3b98c, 0, 0, -0.23);  // east ramp down
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
    new THREE.MeshStandardMaterial({ color: C.rust, roughness: 0.5 })
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
  const pinMat = new THREE.MeshStandardMaterial({ color: 0xfffaf1, roughness: 0.5 });
  const stripeMat = new THREE.MeshStandardMaterial({ color: C.rust, roughness: 0.5 });
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
    new THREE.MeshStandardMaterial({ color: C.deep, roughness: 0.3 })
  );
  ball.castShadow = true;
  scene.add(ball);
  const ballBody = new CANNON.Body({ mass: 4, shape: new CANNON.Sphere(0.9), position: new CANNON.Vec3(-28, 1, 38) });
  world.addBody(ballBody);
  track(ball, ballBody);
}

/* scattered deco cones */
{
  const coneGeo = new THREE.ConeGeometry(0.5, 1.1, 12);
  const coneMat = new THREE.MeshStandardMaterial({ color: C.orange, roughness: 0.6 });
  const spots = [[14, -14], [-16, -18], [18, 16], [-14, 20], [8, 30], [-8, -34], [26, -28], [-26, -12], [52, 12], [-52, -16]];
  for (const [x, z] of spots) {
    const m = new THREE.Mesh(coneGeo, coneMat);
    m.castShadow = true;
    scene.add(m);
    const b = new CANNON.Body({
      mass: 0.6,
      shape: new CANNON.Cylinder(0.06, 0.5, 1.1, 8),
      position: new CANNON.Vec3(x, 0.6, z),
      sleepSpeedLimit: 0.4,
    });
    world.addBody(b);
    track(m, b);
  }
}

/* =====================  TREES & ROCKS  ===================== */
{
  // deterministic scatter (LCG) with keep-out zones
  let seed = 7;
  const rand = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const blocked = (x, z) =>
    (Math.abs(x) < 7 && z > -86 && z < 116) ||             // N/S road
    (Math.abs(z) < 7 && x > -66 && x < 50) ||              // E/W road
    (x > 2 && x < 20 && z < -32 && z > -84) ||             // projects east col
    (x > -20 && x < -2 && z > -84 && z < -32) ||           // projects east col
    (x > 24 && x < 52 && z > -20 && z < 6) ||              // skills + ramp
    (x > -66 && x < -34 && z > -16 && z < 16) ||           // contact plaza
    (x > -46 && x < -24 && z > 28 && z < 52) ||            // bowling
    (x > -18 && x < 18 && z > 26 && z < 116) ||            // exp/edu
    (x > 12 && x < 52 && z > -64 && z < -32) ||            // lake + bridge
    (x * x + z * z < 300);                                 // spawn plaza
  const trunkGeo = new THREE.CylinderGeometry(0.22, 0.3, 1.6, 8);
  const cone1Geo = new THREE.ConeGeometry(1.35, 2.6, 8);
  const cone2Geo = new THREE.ConeGeometry(0.95, 2.0, 8);
  const trunkMat = new THREE.MeshStandardMaterial({ color: C.trunk, roughness: 0.9 });
  const leafMatA = new THREE.MeshStandardMaterial({ color: C.leafA, roughness: 0.9 });
  const leafMatB = new THREE.MeshStandardMaterial({ color: C.leafB, roughness: 0.9 });
  const N = 46;
  const trunkIM = new THREE.InstancedMesh(trunkGeo, trunkMat, N);
  const cone1IM = new THREE.InstancedMesh(cone1Geo, leafMatA, N);
  const cone2IM = new THREE.InstancedMesh(cone2Geo, leafMatB, N);
  trunkIM.castShadow = cone1IM.castShadow = cone2IM.castShadow = true;
  const m4 = new THREE.Matrix4();
  let placed = 0, guard = 0;
  while (placed < N && guard++ < 900) {
    const x = (rand() * 2 - 1) * (ISLE_RX - 12);
    const z = (rand() * 2 - 1) * (ISLE_RZ - 12);
    if ((x / (ISLE_RX - 10)) ** 2 + (z / (ISLE_RZ - 10)) ** 2 > 1) continue;
    if (blocked(x, z)) continue;
    const s = 0.85 + rand() * 0.65;
    m4.makeScale(s, s, s); m4.setPosition(x, 0.8 * s, z);
    trunkIM.setMatrixAt(placed, m4);
    m4.makeScale(s, s, s); m4.setPosition(x, 2.3 * s, z);
    cone1IM.setMatrixAt(placed, m4);
    m4.makeScale(s, s, s); m4.setPosition(x, 3.6 * s, z);
    cone2IM.setMatrixAt(placed, m4);
    const tb = new CANNON.Body({ mass: 0, shape: new CANNON.Cylinder(0.32 * s, 0.4 * s, 3 * s, 8) });
    tb.position.set(x, 1.5 * s, z);
    tb.updateAABB(); // static body posed after construction
    world.addBody(tb);
    treePts.push([x, z]);
    placed++;
  }
  scene.add(trunkIM, cone1IM, cone2IM);

  // rocks
  const rockMat = new THREE.MeshStandardMaterial({ color: 0xb8a88f, roughness: 0.95, flatShading: true });
  const rockGeo = new THREE.DodecahedronGeometry(1, 0);
  const rockSpots = [[70, -40], [-70, 30], [60, 60], [-60, -60], [90, 10], [-88, -20], [20, 100], [-30, -90]];
  for (const [x, z] of rockSpots) {
    const s = 0.7 + rand() * 1.1;
    const m = new THREE.Mesh(rockGeo, rockMat);
    m.scale.set(s, s * 0.75, s);
    m.position.set(x, s * 0.45, z);
    m.rotation.y = rand() * Math.PI;
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    const rb = new CANNON.Body({ mass: 0, shape: new CANNON.Sphere(s * 0.7) });
    rb.position.set(x, s * 0.45, z);
    rb.updateAABB(); // static body posed after construction
    world.addBody(rb);
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
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.16, depthWrite: false });
  for (let i = 0; i < 34; i++) {
    const m = new THREE.Mesh(geo, mat.clone());
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
  g.ellipse(mx(0), my(0), ISLE_RX * W2M_X, ISLE_RZ * W2M_Z, 0, 0, Math.PI * 2);
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
  g.fillStyle = '#8aa065';
  for (const [x, z] of treePts) { g.beginPath(); g.arc(mx(x), my(z), 1.3, 0, Math.PI * 2); g.fill(); }
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

/* =====================================================================
   INPUT
   ===================================================================== */
const input = { fwd: false, back: false, left: false, right: false, turbo: false };
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
function tryJump() {
  const now = performance.now();
  if (now - lastJump < 900) return;
  const grounded = vehicle.wheelInfos.filter(w => w.isInContact).length >= 2;
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
let started = false;
function start() {
  if (started) return;
  started = true;
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
function inOcean(x, z) { return (x / EDGE_RX) ** 2 + (z / EDGE_RZ) ** 2 > 1; }
function inLake(x, z) { return ((x - LAKE.x) / LAKE.rx) ** 2 + ((z - LAKE.z) / LAKE.rz) ** 2 < 1; }

let splashLock = 0;
function checkWater(t) {
  if (t < splashLock) return;
  const p = chassisBody.position;
  if (inOcean(p.x, p.z)) {
    splashLock = t + 2;
    SFX.splash();
    toast('🌊 SPLASH! The ocean is not a shortcut…');
    resetCar();
  } else if (inLake(p.x, p.z) && p.y < 1.7) {
    splashLock = t + 2;
    SFX.splash();
    toast('🌊 Into the lake! Try the bridge.');
    resetCar(new CANNON.Vec3(10, 2.2, -48), Math.PI / 2);
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
function applyControls() {
  const speed = chassisBody.velocity.length();
  const cap = input.turbo ? TURBO_CAP : SPEED_CAP;
  const force = input.turbo ? TURBO_FORCE : MAX_FORCE;
  // cannon RaycastVehicle: negative engine force = local +z = where the headlights are
  const engine = (input.fwd && speed < cap) ? -force : input.back ? force * 0.6 : 0;
  const steer = input.left ? MAX_STEER : input.right ? -MAX_STEER : 0;
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
  if (engine !== 0 || steer !== 0) chassisBody.wakeUp();
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
const camTarget = new THREE.Vector3();
let padPulse = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 1 / 20);
  const t = clock.elapsedTime;

  if (started) applyControls();
  world.step(1 / 60, dt, 3);

  // truck
  carGroup.position.copy(chassisBody.position);
  carGroup.quaternion.copy(chassisBody.quaternion);
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

  // camera follow + turbo FOV kick
  camTarget.set(chassisBody.position.x, 0, chassisBody.position.z);
  camera.position.lerp(camTarget.clone().add(CAM_OFFSET), 0.08);
  camera.lookAt(camTarget.x, 1.2, camTarget.z);
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
  ocean.position.y = -0.12 + Math.sin(t * 0.5) * 0.03;
  lakeMesh.position.y = 0.05 + Math.sin(t * 0.7) * 0.012;
  updateWind(dt, t, input.turbo && input.fwd);
  updateConfetti(dt);

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
  drawMinimapBg();
  renderTasks();
  // deep-link straight into the game: #go, or #go=x,z to spawn elsewhere
  if (location.hash.startsWith('#go')) {
    const m = location.hash.match(/^#go=(-?\d+),(-?\d+)$/);
    if (m) resetCar(new CANNON.Vec3(+m[1], 2.2, +m[2]));
    start();
  }
  animate();
}
boot();
