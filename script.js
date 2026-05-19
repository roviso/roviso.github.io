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
  scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({
    color: 0xe8921a, size: 0.055, transparent: true, opacity: 0.85
  })));

  const MAX = 380;
  const lp  = new Float32Array(MAX * 6);
  const lGeo = new THREE.BufferGeometry();
  lGeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
  lGeo.setDrawRange(0, 0);
  scene.add(new THREE.LineSegments(lGeo, new THREE.LineBasicMaterial({
    color: 0xe8921a, transparent: true, opacity: 0.09
  })));

  const kSph   = new THREE.SphereGeometry(0.055, 8, 8);
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

console.log('%c👋 Hello! Thanks for checking out my portfolio!', 'color: #e8921a; font-size: 16px; font-weight: bold;');
console.log('%cBuilt with passion for AI/ML', 'color: #8a7a5e; font-size: 12px;');
