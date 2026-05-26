// ===== Theme Toggle (run first to prevent flash) =====
const themeRoot = document.documentElement;
const themeBtn  = document.getElementById('theme-toggle');

themeBtn.addEventListener('click', () => {
  const next = themeRoot.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
  themeRoot.setAttribute('data-theme', next);
  localStorage.setItem('rp-theme', next);
});

// ===== Custom Cursor =====
const cur  = document.getElementById('cur');
const ring = document.getElementById('cur-ring');
let mx = innerWidth / 2, my = innerHeight / 2, rx = mx, ry = my;

document.addEventListener('mousemove', e => { mx = e.clientX; my = e.clientY; });

(function curLoop() {
  rx += (mx - rx) * 0.13;
  ry += (my - ry) * 0.13;
  cur.style.left  = mx + 'px';
  cur.style.top   = my + 'px';
  ring.style.left = rx + 'px';
  ring.style.top  = ry + 'px';
  requestAnimationFrame(curLoop);
})();

document.querySelectorAll('a,button,input,textarea').forEach(el => {
  el.addEventListener('mouseenter', () => {
    cur.style.transform  = 'translate(-50%,-50%) scale(2.2)';
    cur.style.opacity    = '.35';
    ring.style.transform = 'translate(-50%,-50%) scale(1.6)';
  });
  el.addEventListener('mouseleave', () => {
    cur.style.transform  = 'translate(-50%,-50%) scale(1)';
    cur.style.opacity    = '1';
    ring.style.transform = 'translate(-50%,-50%) scale(1)';
  });
});

// ===== Scroll Progress + Nav + Scroll-to-top =====
const navbar = document.getElementById('nav');
const sp     = document.getElementById('sp');
const stb    = document.getElementById('stb');
const sectionIds = ['hero', 'about', 'exp', 'proj', 'skills', 'edu', 'contact'];

window.addEventListener('scroll', () => {
  const pct = window.scrollY / (document.body.scrollHeight - innerHeight) * 100;
  sp.style.width = pct + '%';
  navbar.classList.toggle('scrolled', window.scrollY > 70);
  stb.classList.toggle('show', window.scrollY > 380);

  let curId = 'hero';
  sectionIds.forEach(id => {
    const el = document.getElementById(id);
    if (el && window.scrollY >= el.offsetTop - 110) curId = id;
  });
  document.querySelectorAll('.nl').forEach(a =>
    a.classList.toggle('active', a.getAttribute('href') === '#' + curId)
  );
});

stb.addEventListener('click', () => window.scrollTo({ top: 0, behavior: 'smooth' }));

// ===== Smooth Scroll =====
document.querySelectorAll('a[href^="#"]').forEach(a => {
  a.addEventListener('click', e => {
    const t = document.querySelector(a.getAttribute('href'));
    if (t) {
      e.preventDefault();
      window.scrollTo({ top: t.offsetTop - 66, behavior: 'smooth' });
    }
  });
});

// ===== Scroll Reveal =====
const rvObs = new IntersectionObserver(entries => {
  entries.forEach((en, i) => {
    if (en.isIntersecting) {
      setTimeout(() => en.target.classList.add('in'), i * 75);
      rvObs.unobserve(en.target);
    }
  });
}, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

document.querySelectorAll('.rv,.rv-l,.rv-r').forEach(el => rvObs.observe(el));

// ===== Typewriter =====
const roles  = ['ML/AI Engineer', 'LLM Specialist', 'RAG Expert', 'Agentic AI Builder', 'AI Solutions Architect'];
let ri = 0, ci = 0, del = false;
const typed = document.getElementById('typed');

function typo() {
  const cur = roles[ri];
  if (!del) {
    typed.textContent = cur.slice(0, ++ci);
    if (ci === cur.length) { del = true; return setTimeout(typo, 1800); }
  } else {
    typed.textContent = cur.slice(0, --ci);
    if (ci === 0) { del = false; ri = (ri + 1) % roles.length; return setTimeout(typo, 400); }
  }
  setTimeout(typo, del ? 42 : 88);
}
setTimeout(typo, 700);

// ===== 3D Tilt on Project Cards =====
document.querySelectorAll('.proj-card').forEach(card => {
  card.addEventListener('mousemove', e => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width  - 0.5;
    const y = (e.clientY - r.top)  / r.height - 0.5;
    card.style.transform = `perspective(900px) rotateX(${-y * 10}deg) rotateY(${x * 10}deg) translateY(-6px)`;
  });
  card.addEventListener('mouseleave', () => { card.style.transform = ''; });
});

// ===== Contact Form =====
document.getElementById('ct-form').addEventListener('submit', e => {
  e.preventDefault();
  const sbt = document.getElementById('sbt');
  sbt.textContent = 'Sent!';
  e.target.reset();
  setTimeout(() => { sbt.textContent = 'Send Message'; }, 3000);
});

// ===== Three.js Neural Network Hero =====
(function () {
  if (typeof THREE === 'undefined') return;

  const canvas   = document.getElementById('hero-canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 100);
  camera.position.z = 5.5;

  const N   = 110;
  const pos = new Float32Array(N * 3);
  const vel = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3]     = (Math.random() - 0.5) * 14;
    pos[i * 3 + 1] = (Math.random() - 0.5) * 9;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 3;
    vel[i * 3]     = (Math.random() - 0.5) * 0.006;
    vel[i * 3 + 1] = (Math.random() - 0.5) * 0.005;
  }

  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pMat = new THREE.PointsMaterial({ color: 0xe8921a, size: 0.065, transparent: true, opacity: 0.9 });
  scene.add(new THREE.Points(pGeo, pMat));

  const MAX = 380;
  const lp  = new Float32Array(MAX * 6);
  const lGeo = new THREE.BufferGeometry();
  lGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  lGeo.setDrawRange(0, 0);
  const lMat = new THREE.LineBasicMaterial({ color: 0xe8921a, transparent: true, opacity: 0.12 });
  scene.add(new THREE.LineSegments(lGeo, lMat));

  const kSph   = new THREE.SphereGeometry(0.065, 8, 8);
  const kNodes = Array.from({ length: 10 }, () => {
    const m = new THREE.Mesh(kSph, new THREE.MeshBasicMaterial({
      color: 0xf5c030, transparent: true, opacity: 0.7
    }));
    m.position.set(
      (Math.random() - 0.5) * 10,
      (Math.random() - 0.5) * 6,
      (Math.random() - 0.5) * 2
    );
    m.userData.ph = Math.random() * Math.PI * 2;
    scene.add(m);
    return m;
  });

  let tx = 0, ty = 0, cx = 0, cy = 0;
  document.addEventListener('mousemove', e => {
    tx = (e.clientX / innerWidth  - 0.5) * 1.1;
    ty = -(e.clientY / innerHeight - 0.5) * 0.75;
  });

  function resize() {
    const hero = document.getElementById('hero');
    const w = hero.offsetWidth, h = hero.offsetHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  resize();

  // Adapt particle opacity based on theme
  function adaptHeroColors() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    pMat.opacity = dark ? 0.85 : 0.72;
    lMat.opacity = dark ? 0.09 : 0.14;
  }
  adaptHeroColors();
  new MutationObserver(adaptHeroColors).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  let f = 0;
  (function loop() {
    requestAnimationFrame(loop);
    f++;

    for (let i = 0; i < N; i++) {
      pos[i * 3]     += vel[i * 3];
      pos[i * 3 + 1] += vel[i * 3 + 1];
      if (Math.abs(pos[i * 3])     > 7.2) vel[i * 3]     *= -1;
      if (Math.abs(pos[i * 3 + 1]) > 4.8) vel[i * 3 + 1] *= -1;
    }
    pGeo.attributes.position.needsUpdate = true;

    kNodes.forEach(n => {
      const s = 0.85 + Math.sin(f * 0.032 + n.userData.ph) * 0.15;
      n.scale.setScalar(s);
      n.material.opacity = 0.35 + Math.sin(f * 0.04 + n.userData.ph) * 0.3;
    });

    if (f % 3 === 0) {
      let c = 0;
      const T2 = 2.8 * 2.8;
      for (let i = 0; i < N && c < MAX - 1; i++) {
        for (let j = i + 1; j < N && c < MAX - 1; j++) {
          const dx = pos[i*3]   - pos[j*3];
          const dy = pos[i*3+1] - pos[j*3+1];
          const dz = pos[i*3+2] - pos[j*3+2];
          if (dx*dx + dy*dy + dz*dz < T2) {
            lp[c*6]   = pos[i*3];   lp[c*6+1] = pos[i*3+1]; lp[c*6+2] = pos[i*3+2];
            lp[c*6+3] = pos[j*3];   lp[c*6+4] = pos[j*3+1]; lp[c*6+5] = pos[j*3+2];
            c++;
          }
        }
      }
      lGeo.attributes.position.needsUpdate = true;
      lGeo.setDrawRange(0, c * 2);
    }

    cx += (tx - cx) * 0.025;
    cy += (ty - cy) * 0.025;
    camera.position.x = cx;
    camera.position.y = cy;
    camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  })();
})();

// ===== Three.js Neural Sphere (About) — Icosahedron network =====
(function () {
  if (typeof THREE === 'undefined') return;
  const canvas = document.getElementById('about-canvas');
  if (!canvas) return;

  const SIZE = 280;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(SIZE, SIZE);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 100);
  camera.position.z = 3.8;

  // Wireframe icosahedron — neural model topology
  const icoGeo = new THREE.IcosahedronGeometry(1.25, 2);
  const icoMat = new THREE.MeshBasicMaterial({ color: 0xe8921a, wireframe: true, transparent: true, opacity: 0.22 });
  const ico = new THREE.Mesh(icoGeo, icoMat);
  scene.add(ico);

  // Bright nodes at vertices
  const verts = icoGeo.attributes.position;
  const nodeMesh = new THREE.InstancedMesh(
    new THREE.SphereGeometry(0.045, 6, 6),
    new THREE.MeshBasicMaterial({ color: 0xf5c030, transparent: true, opacity: 0.9 }),
    verts.count
  );
  const dummy = new THREE.Object3D();
  for (let i = 0; i < verts.count; i++) {
    dummy.position.set(verts.getX(i), verts.getY(i), verts.getZ(i));
    dummy.updateMatrix();
    nodeMesh.setMatrixAt(i, dummy.matrix);
  }
  nodeMesh.instanceMatrix.needsUpdate = true;
  scene.add(nodeMesh);

  // Outer orbital particles — represents data flowing around the model
  const N2 = 60;
  const orbPos = new Float32Array(N2 * 3);
  for (let i = 0; i < N2; i++) {
    const phi   = Math.acos(-1 + (2 * i) / N2);
    const theta = Math.sqrt(N2 * Math.PI) * phi;
    const r = 1.9 + (Math.random() - 0.5) * 0.3;
    orbPos[i*3]   = r * Math.cos(theta) * Math.sin(phi);
    orbPos[i*3+1] = r * Math.sin(theta) * Math.sin(phi);
    orbPos[i*3+2] = r * Math.cos(phi);
  }
  const orbGeo = new THREE.BufferGeometry();
  orbGeo.setAttribute('position', new THREE.BufferAttribute(orbPos, 3));
  const orbMat = new THREE.PointsMaterial({ color: 0xe8921a, size: 0.038, transparent: true, opacity: 0.55 });
  const orbs = new THREE.Points(orbGeo, orbMat);
  scene.add(orbs);

  // Inner core sphere — the model "brain"
  const coreMesh = new THREE.Mesh(
    new THREE.SphereGeometry(0.38, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xe8921a, transparent: true, opacity: 0.06, wireframe: false })
  );
  scene.add(coreMesh);

  function adaptAbout() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    icoMat.opacity    = dark ? 0.22 : 0.30;
    orbMat.opacity    = dark ? 0.55 : 0.65;
    coreMesh.material.opacity = dark ? 0.06 : 0.09;
  }
  adaptAbout();
  new MutationObserver(adaptAbout).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  let fa = 0;
  (function loopAbout() {
    requestAnimationFrame(loopAbout);
    fa++;
    ico.rotation.x      = fa * 0.006;
    ico.rotation.y      = fa * 0.009;
    nodeMesh.rotation.x = fa * 0.006;
    nodeMesh.rotation.y = fa * 0.009;
    orbs.rotation.x     = -fa * 0.004;
    orbs.rotation.y     = fa * 0.007;
    coreMesh.rotation.y = fa * 0.012;
    renderer.render(scene, camera);
  })();
})();

// ===== Three.js Torus Knot (Skills) — interconnected AI systems =====
(function () {
  if (typeof THREE === 'undefined') return;
  const canvas = document.getElementById('skills-canvas');
  if (!canvas) return;

  const SIZE = 400;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(SIZE, SIZE);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.z = 4.5;

  // Torus knot — represents the intricate interconnection of AI knowledge domains
  const tkGeo = new THREE.TorusKnotGeometry(1.2, 0.38, 120, 18);
  const tkMat = new THREE.MeshBasicMaterial({ color: 0xe8921a, wireframe: true, transparent: true, opacity: 0.28 });
  const tk = new THREE.Mesh(tkGeo, tkMat);
  scene.add(tk);

  // Scattered particles following torus knot surface — data points
  const posArr = tkGeo.attributes.position.array;
  const totalV = posArr.length / 3;
  const NP = 180;
  const pBuf = new Float32Array(NP * 3);
  for (let i = 0; i < NP; i++) {
    const idx = Math.floor(Math.random() * totalV);
    pBuf[i*3]   = posArr[idx*3];
    pBuf[i*3+1] = posArr[idx*3+1];
    pBuf[i*3+2] = posArr[idx*3+2];
  }
  const pGeo2 = new THREE.BufferGeometry();
  pGeo2.setAttribute('position', new THREE.BufferAttribute(pBuf, 3));
  const pMat2 = new THREE.PointsMaterial({ color: 0xf5c030, size: 0.055, transparent: true, opacity: 0.75 });
  const pts2 = new THREE.Points(pGeo2, pMat2);
  scene.add(pts2);

  // Outer ring of floating data orbs
  const ringN = 24;
  const ringPos = new Float32Array(ringN * 3);
  for (let i = 0; i < ringN; i++) {
    const a = (i / ringN) * Math.PI * 2;
    const r = 2.2 + (Math.random() - 0.5) * 0.4;
    ringPos[i*3]   = r * Math.cos(a);
    ringPos[i*3+1] = r * Math.sin(a) * 0.5;
    ringPos[i*3+2] = (Math.random() - 0.5) * 1.5;
  }
  const ringGeo = new THREE.BufferGeometry();
  ringGeo.setAttribute('position', new THREE.BufferAttribute(ringPos, 3));
  const ringMat = new THREE.PointsMaterial({ color: 0xe8921a, size: 0.06, transparent: true, opacity: 0.45 });
  scene.add(new THREE.Points(ringGeo, ringMat));

  function adaptSkills() {
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    tkMat.opacity   = dark ? 0.28 : 0.38;
    pMat2.opacity   = dark ? 0.75 : 0.85;
    ringMat.opacity = dark ? 0.45 : 0.55;
  }
  adaptSkills();
  new MutationObserver(adaptSkills).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  let fs = 0;
  (function loopSkills() {
    requestAnimationFrame(loopSkills);
    fs++;
    tk.rotation.x    = fs * 0.004;
    tk.rotation.y    = fs * 0.007;
    pts2.rotation.x  = fs * 0.004;
    pts2.rotation.y  = fs * 0.007;
    renderer.render(scene, camera);
  })();
})();

console.log('%c👋 Hello! Thanks for checking out my portfolio!', 'color: #e8921a; font-size: 16px; font-weight: bold;');
console.log('%cBuilt with passion for AI/ML', 'color: #8a7a5e; font-size: 12px;');
