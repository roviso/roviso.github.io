/* =====================================================================
   Ravi Prajapati — interactive 3D portfolio
   Drive a little car around a physics playground to explore the work.
   Three.js (render) + cannon-es (physics), fully static, no server.
   ===================================================================== */
import * as THREE from 'three';
import * as CANNON from 'cannon-es';

/* ------------------------------------------------ palette / config */
const C = {
  paper:  0xf4ead9,
  ground: 0xeadbc2,
  ink:    0x2b2016,
  orange: 0xe8921a,
  deep:   0x7a3000,
  rust:   0xc05010,
  cream:  0xfffaf1,
  sand:   0xd9c4a2,
};
const GRAVITY = -30;
const MAX_FORCE = 900;
const MAX_STEER = 0.55;
const BRAKE_FORCE = 18;
const SPAWN = new CANNON.Vec3(0, 1.6, 0);

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
scene.fog = new THREE.Fog(C.paper, 90, 220);

const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 400);
const CAM_OFFSET = new THREE.Vector3(14, 17, 14);
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

/* ------------------------------------------------ ground visual */
{
  const geo = new THREE.PlaneGeometry(600, 600);
  const mat = new THREE.MeshStandardMaterial({ color: C.ground, roughness: 1 });
  const ground = new THREE.Mesh(geo, mat);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // soft radial "spotlight" patch under spawn so the world has a centre
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
  patch.position.y = 0.01;
  scene.add(patch);
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
  if (opts.rotY) mesh.rotation.z = opts.rotY; // plane is rotated, z acts as yaw
  mesh.position.set(x, 0.02, z);
  scene.add(mesh);
  return mesh;
}

/* dynamic labelled cube (name letters, skill bricks) */
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
function staticBox(sx, sy, sz, x, y, z, color = C.sand, rotY = 0, rotX = 0) {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(sx, sy, sz),
    new THREE.MeshStandardMaterial({ color, roughness: 0.9 })
  );
  mesh.position.set(x, y, z);
  mesh.rotation.set(rotX, rotY, 0);
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);
  const body = new CANNON.Body({ mass: 0, shape: new CANNON.Box(new CANNON.Vec3(sx / 2, sy / 2, sz / 2)) });
  body.position.set(x, y, z);
  body.quaternion.setFromEuler(rotX, rotY, 0);
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
  // posts
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
const pads = []; // { pos: Vector3, r, tag, title, desc, url }
function pad({ x, z, r = 3.2, tag, title, desc, url }) {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(r - 0.35, r, 48),
    new THREE.MeshBasicMaterial({ color: C.orange, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.set(x, 0.03, z);
  scene.add(ring);
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(r - 0.4, 48),
    new THREE.MeshBasicMaterial({ color: C.cream, transparent: true, opacity: 0.35, depthWrite: false })
  );
  disc.rotation.x = -Math.PI / 2;
  disc.position.set(x, 0.025, z);
  scene.add(disc);
  pads.push({ pos: new THREE.Vector3(x, 0, z), r, tag, title, desc, url, ring });
}

/* =====================================================================
   THE CAR — cannon-es RaycastVehicle
   ===================================================================== */
const chassisBody = new CANNON.Body({ mass: 160 });
chassisBody.addShape(new CANNON.Box(new CANNON.Vec3(0.95, 0.45, 1.9)));
chassisBody.position.copy(SPAWN);
chassisBody.angularDamping = 0.4;

const vehicle = new CANNON.RaycastVehicle({
  chassisBody,
  indexRightAxis: 0,
  indexUpAxis: 1,
  indexForwardAxis: 2,
});
const wheelOptions = {
  radius: 0.5,
  directionLocal: new CANNON.Vec3(0, -1, 0),
  suspensionStiffness: 45,
  suspensionRestLength: 0.45,
  frictionSlip: 2.2,
  dampingRelaxation: 2.5,
  dampingCompression: 4.5,
  maxSuspensionForce: 100000,
  rollInfluence: 0.01,
  axleLocal: new CANNON.Vec3(-1, 0, 0),
  maxSuspensionTravel: 0.4,
  customSlidingRotationalSpeed: -30,
  useCustomSlidingRotationalSpeed: true,
};
// front wheels (indices 0,1) then rear (2,3) — front is +z
[[-0.95, 1.35], [0.95, 1.35], [-0.95, -1.35], [0.95, -1.35]].forEach(([wx, wz]) => {
  wheelOptions.chassisConnectionPointLocal = new CANNON.Vec3(wx, 0, wz);
  vehicle.addWheel({ ...wheelOptions });
});
vehicle.addToWorld(world);

/* --- car visual --- */
const carGroup = new THREE.Group();
{
  const bodyMat = new THREE.MeshStandardMaterial({ color: C.orange, roughness: 0.4, metalness: 0.1 });
  const darkMat = new THREE.MeshStandardMaterial({ color: 0x33251a, roughness: 0.6 });
  const main = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.7, 3.8), bodyMat);
  main.castShadow = true;
  carGroup.add(main);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.62, 1.8), darkMat);
  cabin.position.set(0, 0.62, -0.25);
  cabin.castShadow = true;
  carGroup.add(cabin);
  const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff2c9, emissive: 0xffe9a8, emissiveIntensity: 0.9 });
  for (const s of [-1, 1]) {
    const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.1), lightMat);
    lamp.position.set(s * 0.6, 0.1, 1.92);
    carGroup.add(lamp);
    const tail = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.16, 0.08),
      new THREE.MeshStandardMaterial({ color: 0xb02010, emissive: 0x801008, emissiveIntensity: 0.6 }));
    tail.position.set(s * 0.6, 0.12, -1.92);
    carGroup.add(tail);
  }
}
scene.add(carGroup);

const wheelMeshes = [];
{
  const wheelGeo = new THREE.CylinderGeometry(0.5, 0.5, 0.4, 20);
  wheelGeo.rotateZ(Math.PI / 2); // axis → x
  const tyreMat = new THREE.MeshStandardMaterial({ color: 0x2a2119, roughness: 0.9 });
  const hubGeo = new THREE.CylinderGeometry(0.26, 0.26, 0.42, 12);
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

function resetCar() {
  chassisBody.position.copy(SPAWN);
  chassisBody.quaternion.set(0, 0, 0, 1);
  chassisBody.velocity.setZero();
  chassisBody.angularVelocity.setZero();
  chassisBody.wakeUp();
}

/* =====================================================================
   WORLD CONTENT — built after fonts load so canvas textures use Inter
   ===================================================================== */
function buildWorld() {

/* ---- spawn area: name + hints ---- */
groundText('RAVI PRAJAPATI', 0, 7.5, 4.2, { color: '#5d4a30' });
groundText('ML/AI ENGINEER · FOUNDER OF THIMI TECH', 0, 11, 1.4, { color: '#8a6f4d' });
groundText('↑ PROJECTS', 0, -22, 2.2);
groundText('SKILLS →', 24, 0, 2.2, { rotY: -Math.PI / 2 });
groundText('← CONTACT & LINKS', -24, 0, 2.2, { rotY: Math.PI / 2 });
groundText('EXPERIENCE ↓', 0, 24, 2.2, { rotY: Math.PI });

/* pushable name letters ahead of spawn */
'RAVI'.split('').forEach((ch, i) => {
  labelledBox(ch, 1.7, 1.7, 1.7, (i - 1.5) * 2.4, 0.9, -12, { mass: 3, px: 78, bg: '#e8921a', fg: '#fffaf1' });
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
    labelledBox(s, bw, bh, bd,
      44,
      bh / 2 + row * (bh + 0.02),
      (col - 2) * (bw + 0.12) + offset - 8,
      { mass: 2, px: 40 });
  });
}
/* small ramp toward the wall for a run-up jump */
staticBox(8, 0.5, 6, 30, 0.4, -8, 0xdcc6a0, Math.PI / 2, 0);
{
  // wedge ramp: rotated static box
  const r = staticBox(7, 0.4, 9, 32, 1.1, -8, 0xd3b98c, Math.PI / 2, 0);
  r.mesh.rotation.z = 0.26;
  r.body.quaternion.setFromEuler(0, Math.PI / 2, 0.26);
  r.body.updateAABB();
}

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
  { title: 'Download CV', desc: 'Grab the latest PDF résumé.',                      url: '../ravi-cv-2026-updated.pdf' },
  { title: 'Classic portfolio', desc: 'The regular 2D version of this site.',       url: '../' },
];
socials.forEach((s, i) => {
  const col = i % 3, row = Math.floor(i / 3);
  const x = -40 - row * 10;
  const z = (col - 1) * 10;
  pad({ x, z, r: 2.6, tag: 'LINK', title: s.title, desc: s.desc, url: s.url });
  // little totem in the middle of each pad
  const totem = new THREE.Mesh(
    new THREE.CylinderGeometry(0.45, 0.6, 1.6, 14),
    new THREE.MeshStandardMaterial({ color: C.rust, roughness: 0.5 })
  );
  totem.position.set(x, 0.8, z - 0.0);
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
  let n = 0;
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
      n++;
    }
  }
  // a ball to push around
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

/* scattered deco cones so the empty ground feels alive */
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

} // end buildWorld

/* =====================================================================
   INPUT
   ===================================================================== */
const input = { fwd: false, back: false, left: false, right: false, brake: false };
let nearPad = null;

const KEYMAP = {
  KeyW: 'fwd', ArrowUp: 'fwd',
  KeyS: 'back', ArrowDown: 'back',
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  Space: 'brake',
};
window.addEventListener('keydown', (e) => {
  if (KEYMAP[e.code]) { input[KEYMAP[e.code]] = true; e.preventDefault(); }
  if (e.code === 'KeyR') resetCar();
  if (e.code === 'KeyE' && nearPad && nearPad.url) openPad(nearPad);
});
window.addEventListener('keyup', (e) => {
  if (KEYMAP[e.code]) input[KEYMAP[e.code]] = false;
});

function openPad(p) {
  if (p.url.startsWith('mailto:') || p.url.startsWith('../')) {
    window.location.href = p.url;
  } else {
    window.open(p.url, '_blank', 'noopener');
  }
}
panelOpen.addEventListener('click', () => { if (nearPad && nearPad.url) openPad(nearPad); });
document.getElementById('reset-btn').addEventListener('click', resetCar);

/* touch controls */
const isTouch = window.matchMedia('(pointer: coarse)').matches;
if (isTouch) {
  touchUI.classList.remove('hidden');
  touchUI.querySelectorAll('button').forEach((btn) => {
    const k = btn.dataset.k;
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
  overlay.classList.add('fade');
  hud.classList.remove('hidden');
  setTimeout(() => overlay.classList.add('hidden'), 700);
}
startBtn.addEventListener('click', start);
window.addEventListener('keydown', () => start(), { once: true });

/* =====================================================================
   LOOP
   ===================================================================== */
function applyControls() {
  // cannon RaycastVehicle: negative engine force = local +z = where the headlights are
  const speed = chassisBody.velocity.length();
  const atLimit = speed > 24; // arcade top-speed cap
  const engine = (input.fwd && !atLimit) ? -MAX_FORCE : input.back ? MAX_FORCE * 0.6 : 0;
  const steer = input.left ? MAX_STEER : input.right ? -MAX_STEER : 0;
  // rear-wheel drive
  vehicle.applyEngineForce(engine, 2);
  vehicle.applyEngineForce(engine, 3);
  vehicle.setSteeringValue(steer, 0);
  vehicle.setSteeringValue(steer, 1);
  const brake = input.brake ? BRAKE_FORCE : 0;
  for (let i = 0; i < 4; i++) vehicle.setBrake(brake, i);
  if (engine !== 0 || steer !== 0) chassisBody.wakeUp();
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

  if (started) applyControls();
  world.step(1 / 60, dt, 3);

  // car
  carGroup.position.copy(chassisBody.position);
  carGroup.quaternion.copy(chassisBody.quaternion);
  for (let i = 0; i < 4; i++) {
    vehicle.updateWheelTransform(i);
    const t = vehicle.wheelInfos[i].worldTransform;
    wheelMeshes[i].position.copy(t.position);
    wheelMeshes[i].quaternion.copy(t.quaternion);
  }
  // fell through / flew off? bring it home
  if (chassisBody.position.y < -15) resetCar();

  // dynamic props
  for (const s of synced) {
    s.mesh.position.copy(s.body.position);
    s.mesh.quaternion.copy(s.body.quaternion);
  }

  // camera follow (fixed isometric-ish offset, smooth)
  camTarget.set(chassisBody.position.x, 0, chassisBody.position.z);
  camera.position.lerp(camTarget.clone().add(CAM_OFFSET), 0.08);
  camera.lookAt(camTarget.x, 1.2, camTarget.z);

  // keep the sun's shadow box centred on the car
  sun.position.set(camTarget.x - 40, 70, camTarget.z + 30);
  sun.target.position.copy(camTarget);

  // pad pulse
  padPulse += dt * 2.4;
  const s = 1 + Math.sin(padPulse) * 0.045;
  for (const p of pads) p.ring.scale.set(s, s, 1);

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
  if (location.hash === '#go') start(); // deep-link straight into the game
  animate();
}
boot();
