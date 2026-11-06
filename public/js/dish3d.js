// Gerador de modelos 3D de pratos e bebidas.
// Tudo é feito em código (three.js), em escala real (metros), para aparecer
// do tamanho certo em cima da mesa na realidade aumentada.
// Usado pelo script de build (gera os .glb do cardápio de exemplo) e pelo
// app do dono (cria o 3D de um prato novo direto no celular).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const TAU = Math.PI * 2;

// ---------- utilidades ----------
function rng(seed = 1) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const noise3 = (x, y, z, f = 1) =>
  (Math.sin(x * 17.1 * f + y * 3.3) * Math.cos(z * 15.7 * f - x * 2.1) +
    Math.sin((x + z) * 31.3 * f + y * 9.1) * 0.5) / 1.5;

function mat(color, o = {}) {
  return new THREE.MeshStandardMaterial({
    color, roughness: o.roughness ?? 0.7, metalness: o.metalness ?? 0,
    transparent: o.opacity != null && o.opacity < 1, opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide, map: o.map ?? null, depthWrite: o.depthWrite ?? true,
    name: o.name ?? '',
  });
}
const glassMat = (tint = 0xffffff, opacity = 0.28) =>
  mat(tint, { roughness: 0.05, opacity, side: THREE.DoubleSide, depthWrite: false, name: 'vidro' });

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function lathe(points, segs = 64) {
  return new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segs);
}

function displace(geo, amount, freq = 1, seed = 0) {
  const p = geo.attributes.position;
  geo.computeVertexNormals();
  const n = geo.attributes.normal;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const d = noise3(x + seed, y, z, freq) * amount;
    p.setXYZ(i, x + n.getX(i) * d, y + n.getY(i) * d, z + n.getZ(i) * d);
  }
  geo.computeVertexNormals();
  return geo;
}

function mesh(geo, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(x, y, z);
  return m;
}

// Monte de comida (arroz, purê, molho...) – meia esfera achatada com relevo.
function mound(r, h, material, { bump = 0.004, freq = 1, seed = 0, sx = 1, sz = 1 } = {}) {
  const g = new THREE.SphereGeometry(1, 48, 20, 0, TAU, 0, Math.PI / 2);
  g.scale(r * sx, h, r * sz);
  displace(g, bump, freq, seed);
  return new THREE.Mesh(g, material);
}

// Junta muitas peças pequenas (grãos, palitos) em uma geometria só.
function scatter(count, make, place, seed = 1) {
  const R = rng(seed);
  const parts = [];
  for (let i = 0; i < count; i++) {
    const g = make(R, i);
    const m = new THREE.Matrix4();
    const { pos, rot, scale } = place(R, i);
    m.compose(pos, new THREE.Quaternion().setFromEuler(rot), scale ?? new THREE.Vector3(1, 1, 1));
    g.applyMatrix4(m);
    parts.push(g.index ? g.toNonIndexed() : g);
  }
  return mergeGeometries(parts);
}

// ---------- texturas ----------
const tex = {};
function woodTex() {
  return (tex.wood ??= canvasTex(512, (g, s) => {
    g.fillStyle = '#9b6a3c'; g.fillRect(0, 0, s, s);
    const R = rng(7);
    for (let i = 0; i < 140; i++) {
      const y = R() * s;
      g.strokeStyle = `rgba(${60 + R() * 40},${35 + R() * 20},${15},${0.15 + R() * 0.25})`;
      g.lineWidth = 1 + R() * 3;
      g.beginPath(); g.moveTo(0, y);
      for (let x = 0; x <= s; x += 32) g.lineTo(x, y + Math.sin(x / 60 + i) * 4);
      g.stroke();
    }
  }));
}
function riceTex() {
  return (tex.rice ??= canvasTex(512, (g, s) => {
    g.fillStyle = '#efe6d2'; g.fillRect(0, 0, s, s);
    const R = rng(3);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = R() > 0.5 ? 'rgba(255,255,250,0.9)' : 'rgba(214,200,170,0.7)';
      g.save(); g.translate(R() * s, R() * s); g.rotate(R() * TAU);
      g.beginPath(); g.ellipse(0, 0, 6, 2.2, 0, 0, TAU); g.fill(); g.restore();
    }
  }));
}
function speckTex(base, specks, n = 900, size = 3, seed = 5) {
  return canvasTex(256, (g, s) => {
    g.fillStyle = base; g.fillRect(0, 0, s, s);
    const R = rng(seed);
    for (let i = 0; i < n; i++) {
      g.fillStyle = specks[Math.floor(R() * specks.length)];
      g.beginPath(); g.arc(R() * s, R() * s, R() * size + 0.5, 0, TAU); g.fill();
    }
  });
}
function latteArtTex() {
  return (tex.latte ??= canvasTex(512, (g, s) => {
    const grd = g.createRadialGradient(s / 2, s / 2, 20, s / 2, s / 2, s / 2);
    grd.addColorStop(0, '#c08a5a'); grd.addColorStop(0.85, '#8a5530'); grd.addColorStop(1, '#5a3218');
    g.fillStyle = grd; g.fillRect(0, 0, s, s);
    g.fillStyle = '#f6ead8';
    g.beginPath();
    const cx = s / 2, cy = s / 2 + 20;
    g.moveTo(cx, cy + 110);
    g.bezierCurveTo(cx - 190, cy - 20, cx - 90, cy - 170, cx, cy - 70);
    g.bezierCurveTo(cx + 90, cy - 170, cx + 190, cy - 20, cx, cy + 110);
    g.fill();
    g.strokeStyle = '#a06a40'; g.lineWidth = 6;
    for (let i = 1; i < 4; i++) {
      g.beginPath(); g.ellipse(cx, cy - 10, 30 * i, 18 * i, 0, Math.PI * 1.1, Math.PI * 1.9); g.stroke();
    }
  }));
}
function citrusTex(peel, flesh) {
  return canvasTex(256, (g, s) => {
    g.fillStyle = peel; g.fillRect(0, 0, s, s);
    g.fillStyle = '#fbf3d0'; g.beginPath(); g.arc(s / 2, s / 2, s * 0.46, 0, TAU); g.fill();
    g.fillStyle = flesh;
    for (let i = 0; i < 10; i++) {
      g.beginPath(); g.moveTo(s / 2, s / 2);
      g.arc(s / 2, s / 2, s * 0.42, (i / 10) * TAU + 0.05, ((i + 1) / 10) * TAU - 0.05);
      g.closePath(); g.fill();
    }
  });
}

// ---------- peças base ----------
function plate({ r = 0.135, color = 0xfbfaf7 } = {}) {
  const k = r / 0.135;
  const pts = [[0, 0], [0.095, 0], [0.1, 0.003], [0.108, 0.012], [0.132, 0.019], [0.135, 0.022],
    [0.131, 0.023], [0.106, 0.016], [0.096, 0.008], [0, 0.008]].map(([a, b]) => [a * k, b]);
  return mesh(lathe(pts, 96), mat(color, { roughness: 0.25, name: 'porcelana' }));
}
const PLATE_TOP = 0.008;

function board({ w = 0.3, d = 0.2, round = false } = {}) {
  const m = mat(0xffffff, { map: woodTex(), roughness: 0.75, name: 'madeira' });
  if (round) return mesh(new THREE.CylinderGeometry(w / 2, w / 2, 0.016, 96), m, 0, 0.008, 0);
  return mesh(new RoundedBoxGeometry(w, 0.018, d, 3, 0.006), m, 0, 0.009, 0);
}

function friesPile({ count = 26, r = 0.04, seed = 4, len = 0.07 } = {}) {
  const g = scatter(count, (R) => new RoundedBoxGeometry(0.009, 0.009, len * (0.7 + R() * 0.5), 1, 0.002),
    (R, i) => {
      const a = R() * TAU, d = Math.sqrt(R()) * r;
      return {
        pos: new THREE.Vector3(Math.cos(a) * d, 0.006 + (i / count) * 0.025, Math.sin(a) * d),
        rot: new THREE.Euler((R() - 0.5) * 0.5, R() * Math.PI, (R() - 0.5) * 0.4),
      };
    }, seed);
  return new THREE.Mesh(g, mat(0xe9b44c, { roughness: 0.55, name: 'batata' }));
}

function rice(r = 0.055) {
  return mound(r, 0.03, mat(0xffffff, { map: riceTex(), roughness: 0.85, name: 'arroz' }), { bump: 0.004, freq: 1.4, seed: 1 });
}

function beans(r = 0.045) {
  const grp = new THREE.Group();
  grp.add(mound(r, 0.012, mat(0x3d2015, { roughness: 0.35, name: 'caldo' }), { bump: 0.002, seed: 2 }));
  const g = scatter(46, () => new THREE.SphereGeometry(0.0055, 10, 8), (R) => {
    const a = R() * TAU, d = Math.sqrt(R()) * r * 0.85;
    return {
      pos: new THREE.Vector3(Math.cos(a) * d, 0.009 * (1 - d / r) + 0.003, Math.sin(a) * d),
      rot: new THREE.Euler(R() * 3, R() * 3, R() * 3), scale: new THREE.Vector3(1.5, 0.8, 0.9),
    };
  }, 9);
  grp.add(new THREE.Mesh(g, mat(0x4a2318, { roughness: 0.3, name: 'feijao' })));
  return grp;
}

function blobShape(r, seed = 1, wobble = 0.15) {
  const R = rng(seed); const shape = new THREE.Shape();
  const phases = [R() * TAU, R() * TAU];
  for (let i = 0; i <= 48; i++) {
    const a = (i / 48) * TAU;
    const rr = r * (1 + wobble * Math.sin(a * 3 + phases[0]) * 0.6 + wobble * Math.sin(a * 5 + phases[1]) * 0.4);
    const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.75;
    i ? shape.lineTo(x, y) : shape.moveTo(x, y);
  }
  return shape;
}
function slab(r, h, material, seed = 1, wobble = 0.15) {
  const g = new THREE.ExtrudeGeometry(blobShape(r, seed, wobble),
    { depth: h, bevelEnabled: true, bevelThickness: h * 0.4, bevelSize: h * 0.5, bevelSegments: 3, curveSegments: 24 });
  g.rotateX(-Math.PI / 2);
  return new THREE.Mesh(g, material);
}

function steak() {
  return slab(0.045, 0.008, mat(0x6b3a1f, { roughness: 0.55, name: 'bife' }), 3, 0.18);
}
function grilledChicken() {
  return slab(0.042, 0.009, mat(0xd9a35f, { roughness: 0.6, name: 'frango' }), 8, 0.2);
}

function stroganoff(r = 0.05) {
  const grp = new THREE.Group();
  grp.add(mound(r, 0.016, mat(0xd39a5e, { roughness: 0.3, name: 'molho' }), { bump: 0.0035, freq: 2, seed: 5, sx: 1.15 }));
  const g = scatter(14, (R) => new RoundedBoxGeometry(0.014, 0.01, 0.012, 2, 0.003), (R) => {
    const a = R() * TAU, d = Math.sqrt(R()) * r * 0.7;
    return { pos: new THREE.Vector3(Math.cos(a) * d, 0.013 * (1 - d / r) + 0.003, Math.sin(a) * d), rot: new THREE.Euler(R(), R() * 3, R()) };
  }, 11);
  grp.add(new THREE.Mesh(g, mat(0xe1ad74, { roughness: 0.5, name: 'frango-cubos' })));
  const mush = scatter(6, () => new THREE.SphereGeometry(0.006, 10, 6, 0, TAU, 0, Math.PI / 2), (R) => {
    const a = R() * TAU, d = Math.sqrt(R()) * r * 0.6;
    return { pos: new THREE.Vector3(Math.cos(a) * d, 0.018 * (1 - d / r) + 0.004, Math.sin(a) * d), rot: new THREE.Euler(0.3, 0, 0.2) };
  }, 12);
  grp.add(new THREE.Mesh(mush, mat(0xb8956b, { roughness: 0.5, name: 'champignon' })));
  return grp;
}

function strawPotato(r = 0.035) {
  const g = scatter(90, () => new THREE.BoxGeometry(0.0018, 0.0018, 0.02), (R, i) => {
    const a = R() * TAU, d = Math.sqrt(R()) * r;
    return { pos: new THREE.Vector3(Math.cos(a) * d, 0.003 + R() * 0.012 * (1 - d / r), Math.sin(a) * d), rot: new THREE.Euler(R() * 0.6, R() * 3, R() * 0.6) };
  }, 13);
  return new THREE.Mesh(g, mat(0xf0bf4a, { roughness: 0.5, name: 'batata-palha' }));
}

function salad() {
  const grp = new THREE.Group();
  const leaf = scatter(7, (R) => {
    const g = new THREE.CircleGeometry(0.018, 16); g.scale(1.6, 1, 1);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) p.setZ(i, Math.sin(p.getX(i) * 300) * 0.002);
    return g;
  }, (R) => ({ pos: new THREE.Vector3((R() - 0.5) * 0.04, 0.004 + R() * 0.01, (R() - 0.5) * 0.04), rot: new THREE.Euler(-Math.PI / 2 + (R() - 0.5) * 0.8, 0, R() * 3) }), 21);
  grp.add(new THREE.Mesh(leaf, mat(0x6aa83a, { roughness: 0.5, side: THREE.DoubleSide, name: 'alface' })));
  for (let i = 0; i < 3; i++) {
    const t = mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.005, 24), mat(0xd23b2c, { roughness: 0.35, name: 'tomate' }), -0.01 + i * 0.012, 0.016 - i * 0.002, 0.004 * i);
    t.rotation.z = 0.25; grp.add(t);
  }
  return grp;
}

function parmegiana() {
  const grp = new THREE.Group();
  grp.add(slab(0.05, 0.008, mat(0xc4873d, { roughness: 0.8, map: speckTex('#c4873d', ['#9a5f22', '#e0a85a']), name: 'empanado' }), 4, 0.12));
  const sauce = slab(0.045, 0.002, mat(0xa8321e, { roughness: 0.35, name: 'molho-tomate' }), 4, 0.14);
  sauce.position.y = 0.013; grp.add(sauce);
  const cheese = slab(0.038, 0.002, mat(0xf3d27a, { roughness: 0.4, map: speckTex('#f3d27a', ['#d9a648', '#3f6b2a'], 160, 1.5), name: 'queijo' }), 9, 0.25);
  cheese.position.y = 0.017; grp.add(cheese);
  return grp;
}

// ---------- pratos ----------
const PLATE_PARTS = {
  arroz: { make: () => rice(), slot: 0 },
  feijao: { make: () => beans(), slot: 1 },
  fritas: { make: () => friesPile({ count: 18, r: 0.03, len: 0.06 }), slot: 2 },
  bife: { make: () => steak(), slot: 3 },
  frango: { make: () => grilledChicken(), slot: 3 },
  parmegiana: { make: () => parmegiana(), slot: 3 },
  estrogonofe: { make: () => stroganoff(), slot: 3 },
  'batata-palha': { make: () => strawPotato(), slot: 2 },
  salada: { make: () => salad(), slot: 4 },
};
export const PLATE_PART_LABELS = {
  arroz: 'Arroz', feijao: 'Feijão', fritas: 'Batata frita', bife: 'Bife', frango: 'Frango grelhado',
  parmegiana: 'Parmegiana', estrogonofe: 'Estrogonofe', 'batata-palha': 'Batata palha', salada: 'Salada',
};
// Posições no prato (x, z) para cada "lugar".
const SLOTS = [[-0.045, -0.035], [-0.05, 0.045], [0.055, 0.05], [0.035, -0.025], [0.075, -0.06]];

function platedMeal({ parts = ['arroz', 'feijao', 'bife', 'fritas'], plateColor } = {}) {
  const grp = new THREE.Group();
  grp.add(plate({ color: plateColor ?? 0xfbfaf7 }));
  const used = new Set();
  for (const key of parts) {
    const def = PLATE_PARTS[key]; if (!def) continue;
    let slot = def.slot;
    while (used.has(slot) && slot < SLOTS.length - 1) slot++;
    used.add(slot);
    const p = def.make();
    p.position.set(SLOTS[slot][0], PLATE_TOP, SLOTS[slot][1]);
    grp.add(p);
  }
  return grp;
}

const TOP_BUN = [[0, 0], [0.05, 0], [0.056, 0.002], [0.056, 0.009], [0.05, 0.022], [0.038, 0.035], [0.02, 0.0435], [0, 0.045]];
// Altura da superfície de cima de um perfil de torno no raio r.
function profileY(pts, r) {
  let best = 0;
  for (let i = 1; i < pts.length; i++) {
    const [r0, y0] = pts[i - 1], [r1, y1] = pts[i];
    if ((r >= Math.min(r0, r1)) && (r <= Math.max(r0, r1)) && r0 !== r1) best = Math.max(best, y0 + (y1 - y0) * (r - r0) / (r1 - r0));
  }
  return best;
}

function burger({ bacon = false, cheese = true, double = false, withFries = true } = {}) {
  const grp = new THREE.Group();
  grp.add(board({ w: 0.28, d: 0.19 }));
  const b = new THREE.Group(); let y = 0.018;
  const bun = mat(0xd9973f, { roughness: 0.6, name: 'pao' });
  const bottom = mesh(lathe([[0, 0], [0.05, 0], [0.054, 0.005], [0.055, 0.013], [0.051, 0.019], [0, 0.019]]), bun, 0, y, 0);
  b.add(bottom); y += 0.019;
  const addPatty = () => {
    const g = lathe([[0, 0], [0.055, 0], [0.058, 0.004], [0.058, 0.012], [0.054, 0.016], [0, 0.016]]);
    displace(g, 0.0015, 3, 2);
    b.add(mesh(g, mat(0x4f2a18, { roughness: 0.85, name: 'carne' }), 0, y, 0)); y += 0.015;
    if (cheese) {
      const g2 = new THREE.PlaneGeometry(0.1, 0.1, 12, 12); g2.rotateX(-Math.PI / 2); g2.rotateY(Math.PI / 4);
      const p = g2.attributes.position;
      for (let i = 0; i < p.count; i++) {
        const d = Math.hypot(p.getX(i), p.getZ(i));
        p.setY(i, -(Math.max(0, d - 0.045) ** 2) * 6);
      }
      g2.computeVertexNormals();
      b.add(mesh(g2, mat(0xf2b632, { roughness: 0.35, side: THREE.DoubleSide, name: 'cheddar' }), 0, y + 0.001, 0)); y += 0.003;
    }
  };
  addPatty(); if (double) addPatty();
  if (bacon) {
    for (let i = 0; i < 3; i++) {
      const g = new THREE.PlaneGeometry(0.11, 0.02, 20, 1); g.rotateX(-Math.PI / 2);
      const p = g.attributes.position;
      for (let k = 0; k < p.count; k++) p.setY(k, Math.sin(p.getX(k) * 90 + i) * 0.003);
      g.computeVertexNormals();
      const m = mesh(g, mat(0x8f3b2b, { roughness: 0.45, side: THREE.DoubleSide, map: speckTex('#8f3b2b', ['#d98c6a', '#5e2015'], 300, 4, i + 30), name: 'bacon' }), 0, y + 0.002 + i * 0.001, (i - 1) * 0.022);
      m.rotation.y = 0.2 * (i - 1); b.add(m);
    }
    y += 0.006;
  }
  // alface
  const lg = new THREE.CircleGeometry(0.064, 64); lg.rotateX(-Math.PI / 2);
  const lp = lg.attributes.position;
  for (let i = 0; i < lp.count; i++) {
    const x = lp.getX(i), z = lp.getZ(i), a = Math.atan2(z, x), d = Math.hypot(x, z);
    const k = 1 + Math.sin(a * 9) * 0.06;
    lp.setXYZ(i, x * k, Math.sin(a * 13) * 0.004 * (d / 0.064), z * k);
  }
  lg.computeVertexNormals();
  b.add(mesh(lg, mat(0x6dab3c, { roughness: 0.5, side: THREE.DoubleSide, name: 'alface' }), 0, y + 0.002, 0)); y += 0.004;
  for (let i = 0; i < 2; i++) b.add(mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 32), mat(0xd63a2f, { roughness: 0.35, name: 'tomate' }), (i - 0.5) * 0.045, y + 0.003, 0));
  y += 0.006;
  const top = lathe(TOP_BUN);
  const topMat = mat(0xffffff, { roughness: 0.55, map: speckTex('#c97e2e', ['#d08a36', '#bd7428'], 500, 2.5, 77), name: 'pao' });
  b.add(mesh(top, topMat, 0, y, 0));
  const seeds = scatter(40, () => new THREE.SphereGeometry(0.0022, 8, 6), (R) => {
    const a = R() * TAU, t = Math.sqrt(R()) * 0.85, r = t * 0.052;
    const h = profileY(TOP_BUN, r);
    return { pos: new THREE.Vector3(Math.cos(a) * r, y + h + 0.0005, Math.sin(a) * r), rot: new THREE.Euler(0, a, R()), scale: new THREE.Vector3(1.6, 0.6, 1) };
  }, 17);
  b.add(new THREE.Mesh(seeds, mat(0xf6ecd2, { roughness: 0.6, name: 'gergelim' })));
  b.position.x = withFries ? -0.035 : 0;
  grp.add(b);
  if (withFries) { const f = friesPile({ count: 14, r: 0.03, len: 0.06 }); f.position.set(0.085, 0.018, 0.02); grp.add(f); }
  return grp;
}

function friesBox({ cheddar = false, bacon = false } = {}) {
  const grp = new THREE.Group();
  if (cheddar) {
    // porção na travessa com cheddar e bacon
    const bowl = mesh(lathe([[0, 0], [0.08, 0], [0.095, 0.03], [0.092, 0.031], [0.077, 0.004], [0, 0.004]], 72), mat(0x2b2b2b, { roughness: 0.4, name: 'cumbuca' }));
    grp.add(bowl);
    const f = friesPile({ count: 40, r: 0.065, len: 0.07, seed: 8 }); f.position.y = 0.002; grp.add(f);
    const sauce = mound(0.055, 0.012, mat(0xf0a620, { roughness: 0.25, name: 'cheddar' }), { bump: 0.004, freq: 2, seed: 4 });
    sauce.position.y = 0.028; grp.add(sauce);
    if (bacon) {
      const bits = scatter(30, () => new RoundedBoxGeometry(0.008, 0.005, 0.007, 1, 0.0015), (R) => {
        const a = R() * TAU, d = Math.sqrt(R()) * 0.05;
        return { pos: new THREE.Vector3(Math.cos(a) * d, 0.038 + R() * 0.004, Math.sin(a) * d), rot: new THREE.Euler(R(), R() * 3, R()) };
      }, 19);
      grp.add(new THREE.Mesh(bits, mat(0x7a2b1c, { roughness: 0.5, name: 'bacon' })));
    }
    return grp;
  }
  const box = new THREE.CylinderGeometry(0.048, 0.034, 0.085, 4, 1, true); box.rotateY(Math.PI / 4);
  const paper = canvasTex(256, (g, s) => {
    g.fillStyle = '#c7262c'; g.fillRect(0, 0, s, s);
    g.fillStyle = '#f7e9cf';
    for (let i = 0; i < 8; i++) g.fillRect(i * 32 + 8, 0, 10, s);
  });
  const boxM = mesh(box, mat(0xffffff, { map: paper, roughness: 0.7, side: THREE.DoubleSide, name: 'embalagem' }), 0, 0.0425, 0);
  grp.add(boxM);
  grp.add(mesh(new THREE.BoxGeometry(0.048, 0.002, 0.048), mat(0xc7262c, { name: 'embalagem' }), 0, 0.001, 0));
  const f = scatter(34, (R) => new RoundedBoxGeometry(0.009, 0.009, 0.1 + R() * 0.03, 1, 0.002), (R) => ({
    pos: new THREE.Vector3((R() - 0.5) * 0.05, 0.065 + R() * 0.02, (R() - 0.5) * 0.05),
    rot: new THREE.Euler(Math.PI / 2 + (R() - 0.5) * 0.5, 0, (R() - 0.5) * 0.5),
  }), 23);
  grp.add(new THREE.Mesh(f, mat(0xe9b44c, { roughness: 0.55, name: 'batata' })));
  return grp;
}

function pizza({ kind = 'margherita' } = {}) {
  const grp = new THREE.Group();
  grp.add(board({ w: 0.36, round: true }));
  const y0 = 0.016;
  grp.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.008, 96), mat(0xe9c58a, { roughness: 0.8, name: 'massa' }), 0, y0 + 0.004, 0));
  const crust = new THREE.TorusGeometry(0.146, 0.012, 16, 120); crust.rotateX(Math.PI / 2); crust.scale(1, 0.8, 1);
  displace(crust, 0.0015, 4, 3);
  grp.add(mesh(crust, mat(0xffffff, { map: speckTex('#cf9348', ['#a86a2c', '#e5b06a', '#6e4318'], 600, 3, 41), roughness: 0.75, name: 'borda' }), 0, y0 + 0.009, 0));
  grp.add(mesh(new THREE.CylinderGeometry(0.137, 0.137, 0.003, 96), mat(0xb5341f, { roughness: 0.4, name: 'molho' }), 0, y0 + 0.009, 0));
  const cheeseColor = kind === 'calabresa' ? 0xf1d17c : 0xf6e2a6;
  const ch = slab(0.12, 0.002, mat(cheeseColor, { roughness: 0.35, name: 'mussarela' }), 5, 0.12);
  ch.scale.z = 1.33; ch.position.y = y0 + 0.01; grp.add(ch);
  if (kind === 'calabresa') {
    const g = scatter(16, () => new THREE.CylinderGeometry(0.016, 0.016, 0.004, 24), (R, i) => {
      const a = i * 2.4, d = 0.03 + (i % 3) * 0.035;
      return { pos: new THREE.Vector3(Math.cos(a) * d, y0 + 0.015, Math.sin(a) * d), rot: new THREE.Euler(0.05, 0, 0.05) };
    }, 3);
    grp.add(new THREE.Mesh(g, mat(0xffffff, { map: speckTex('#a33b2a', ['#e6a184', '#6a1d12'], 300, 3, 9), roughness: 0.45, name: 'calabresa' })));
  } else {
    const t = scatter(7, () => new THREE.CylinderGeometry(0.02, 0.02, 0.004, 24), (R, i) => {
      const a = (i / 7) * TAU; return { pos: new THREE.Vector3(Math.cos(a) * 0.08, y0 + 0.015, Math.sin(a) * 0.08), rot: new THREE.Euler() };
    }, 5);
    grp.add(new THREE.Mesh(t, mat(0xd8352a, { roughness: 0.35, name: 'tomate' })));
    const basil = scatter(9, () => { const g = new THREE.CircleGeometry(0.012, 12); g.scale(1.7, 1, 1); g.rotateX(-Math.PI / 2); return g; },
      (R, i) => { const a = (i / 9) * TAU + 0.3, d = i % 2 ? 0.04 : 0.11; return { pos: new THREE.Vector3(Math.cos(a) * d, y0 + 0.0175, Math.sin(a) * d), rot: new THREE.Euler(0, R() * 3, 0) }; }, 6);
    grp.add(new THREE.Mesh(basil, mat(0x2f7d32, { roughness: 0.45, side: THREE.DoubleSide, name: 'manjericao' })));
  }
  return grp;
}

function pudim() {
  const grp = new THREE.Group();
  grp.add(plate({ r: 0.11 }));
  const pts = [[0.016, 0], [0.066, 0], [0.067, 0.004], [0.058, 0.044], [0.053, 0.05], [0.021, 0.05], [0.016, 0.046], [0.016, 0]];
  const g = lathe(pts, 96);
  const colors = []; const p = g.attributes.position;
  const body = new THREE.Color(0xe9b75c), top = new THREE.Color(0x8a4512);
  for (let i = 0; i < p.count; i++) { const c = p.getY(i) > 0.041 ? top : body; colors.push(c.r, c.g, c.b); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, name: 'pudim' });
  grp.add(mesh(g, m, 0, PLATE_TOP, 0));
  const pool = slab(0.075, 0.001, mat(0x9a5518, { roughness: 0.12, name: 'calda' }), 2, 0.08);
  pool.scale.z = 1.33; pool.position.y = PLATE_TOP; grp.add(pool);
  return grp;
}

function brownie() {
  const grp = new THREE.Group();
  grp.add(plate({ r: 0.11, color: 0x2e2e30 }));
  const b = mesh(new RoundedBoxGeometry(0.075, 0.035, 0.065, 3, 0.004),
    mat(0xffffff, { map: speckTex('#3a2114', ['#24130a', '#5a3522'], 700, 2.5, 51), roughness: 0.85, name: 'brownie' }), -0.015, PLATE_TOP + 0.0175, 0);
  b.rotation.y = 0.3; grp.add(b);
  const scoopG = new THREE.SphereGeometry(0.027, 40, 24); displace(scoopG, 0.0018, 4, 2);
  grp.add(mesh(scoopG, mat(0xf6ecd4, { roughness: 0.55, name: 'sorvete' }), 0.0, PLATE_TOP + 0.035 + 0.02, 0.005));
  const curve = new THREE.CatmullRomCurve3(Array.from({ length: 12 }, (_, i) => {
    const a = i * 1.3; return new THREE.Vector3(Math.cos(a) * 0.02, PLATE_TOP + 0.06 + 0.012 * Math.cos(i), Math.sin(a) * 0.02 + 0.005);
  }));
  grp.add(new THREE.Mesh(new THREE.TubeGeometry(curve, 120, 0.0025, 8), mat(0x2b170d, { roughness: 0.2, name: 'calda-chocolate' })));
  const leaf = new THREE.CircleGeometry(0.008, 12); leaf.scale(1.8, 1, 1);
  const lm = mesh(leaf, mat(0x2f8a3a, { side: THREE.DoubleSide, roughness: 0.5, name: 'hortela' }), 0.006, PLATE_TOP + 0.083, 0.004);
  lm.rotation.set(-1.2, 0, 0.4); grp.add(lm);
  return grp;
}

// ---------- bebidas ----------
function iceCubes(n, r, y, seed = 3, size = 0.022) {
  const g = scatter(n, () => new RoundedBoxGeometry(size, size, size, 2, 0.004), (R) => {
    const a = R() * TAU, d = Math.sqrt(R()) * r;
    return { pos: new THREE.Vector3(Math.cos(a) * d, y + R() * 0.02, Math.sin(a) * d), rot: new THREE.Euler(R(), R(), R()) };
  }, seed);
  return new THREE.Mesh(g, mat(0xeaf6ff, { roughness: 0.05, opacity: 0.55, depthWrite: false, name: 'gelo' }));
}
function citrusSlice(color, flesh, r = 0.025, wedge = false) {
  const g = wedge ? new THREE.CylinderGeometry(r, r, 0.008, 24, 1, false, 0, Math.PI) : new THREE.CylinderGeometry(r, r, 0.005, 32);
  const t = citrusTex(color, flesh);
  return new THREE.Mesh(g, [mat(color, { roughness: 0.5, name: 'casca' }), mat(0xffffff, { map: t, roughness: 0.35, name: 'fruta' }), mat(0xffffff, { map: t, roughness: 0.35, name: 'fruta' })]);
}
function mint(n = 4, seed = 2) {
  const g = scatter(n, () => { const l = new THREE.CircleGeometry(0.009, 12); l.scale(1.7, 1, 1); return l; },
    (R, i) => ({ pos: new THREE.Vector3((R() - 0.5) * 0.02, i * 0.004, (R() - 0.5) * 0.02), rot: new THREE.Euler(-1 + R(), R() * 3, R()) }), seed);
  return new THREE.Mesh(g, mat(0x2f8a3a, { roughness: 0.5, side: THREE.DoubleSide, name: 'hortela' }));
}
function straw(color, len, x, y, z, tilt = 0.2) {
  const m = mesh(new THREE.CylinderGeometry(0.003, 0.003, len, 12), mat(color, { roughness: 0.4, name: 'canudo' }), x, y, z);
  m.rotation.z = tilt; return m;
}
function glass(rb, rt, h, { bottom = 0.008, wall = 0.0025 } = {}) {
  return lathe([[0, 0], [rb, 0], [rt, h], [rt - wall, h], [rb - wall, bottom], [0, bottom]], 64);
}

function moscowMule() {
  const grp = new THREE.Group();
  const copper = mat(0xc8703f, { metalness: 1, roughness: 0.28, side: THREE.DoubleSide, name: 'cobre' });
  const mug = lathe([[0, 0], [0.036, 0], [0.04, 0.004], [0.044, 0.05], [0.045, 0.095], [0.0435, 0.096], [0.042, 0.06], [0.037, 0.008], [0, 0.008]], 72);
  displace(mug, 0.0006, 9, 1);
  grp.add(mesh(mug, copper));
  const handle = new THREE.TubeGeometry(new THREE.CatmullRomCurve3([
    new THREE.Vector3(0.043, 0.082, 0), new THREE.Vector3(0.07, 0.08, 0), new THREE.Vector3(0.074, 0.05, 0),
    new THREE.Vector3(0.065, 0.025, 0), new THREE.Vector3(0.041, 0.022, 0)]), 40, 0.005, 10);
  grp.add(new THREE.Mesh(handle, mat(0xb98a3e, { metalness: 1, roughness: 0.3, name: 'alca' })));
  grp.add(mesh(new THREE.CylinderGeometry(0.041, 0.041, 0.002, 48), mat(0xe8dcae, { roughness: 0.1, opacity: 0.85, name: 'drink' }), 0, 0.085, 0));
  grp.add(iceCubes(5, 0.022, 0.08, 5));
  const lime = citrusSlice(0x5f9e2a, '#b8d65a', 0.022, true); lime.position.set(0.012, 0.102, -0.01); lime.rotation.set(0.6, 0.4, 1.2); grp.add(lime);
  const m = mint(5, 4); m.position.set(-0.015, 0.103, 0.01); grp.add(m);
  return grp;
}

function caipirinha() {
  const grp = new THREE.Group();
  grp.add(mesh(glass(0.036, 0.042, 0.09, { bottom: 0.012 }), glassMat()));
  grp.add(mesh(new THREE.CylinderGeometry(0.039, 0.034, 0.055, 48), mat(0xe6efc4, { roughness: 0.1, opacity: 0.55, depthWrite: false, name: 'drink' }), 0, 0.04, 0));
  const g = scatter(6, () => new THREE.CylinderGeometry(0.014, 0.014, 0.012, 16, 1, false, 0, Math.PI), (R) => ({
    pos: new THREE.Vector3((R() - 0.5) * 0.04, 0.02 + R() * 0.012, (R() - 0.5) * 0.04), rot: new THREE.Euler(R() * 3, R() * 3, R() * 3) }), 7);
  grp.add(new THREE.Mesh(g, mat(0x4f9a24, { roughness: 0.45, name: 'limao' })));
  grp.add(iceCubes(6, 0.02, 0.05, 6, 0.024));
  grp.add(straw(0x1d1d1d, 0.13, 0.015, 0.08, 0, 0.25));
  return grp;
}

function latte() {
  const grp = new THREE.Group();
  const white = mat(0xfbfaf7, { roughness: 0.22, side: THREE.DoubleSide, name: 'porcelana' });
  grp.add(mesh(lathe([[0, 0], [0.065, 0], [0.072, 0.008], [0.07, 0.009], [0.035, 0.004], [0, 0.004]], 72), white));
  grp.add(mesh(lathe([[0, 0], [0.025, 0], [0.04, 0.02], [0.047, 0.065], [0.0445, 0.066], [0.038, 0.022], [0.022, 0.008], [0, 0.008]], 72), white, 0, 0.004, 0));
  const h = new THREE.TorusGeometry(0.017, 0.0045, 12, 32, Math.PI * 1.3); h.rotateZ(-Math.PI * 0.65);
  grp.add(mesh(h, white, 0.056, 0.042, 0));
  const top = new THREE.CircleGeometry(0.043, 64); top.rotateX(-Math.PI / 2);
  grp.add(mesh(top, mat(0xffffff, { map: latteArtTex(), roughness: 0.45, name: 'cafe' }), 0, 0.064, 0));
  const spoon = mesh(new RoundedBoxGeometry(0.06, 0.002, 0.008, 1, 0.001), mat(0xcfd2d6, { metalness: 1, roughness: 0.2, name: 'colher' }), 0.04, 0.009, 0.045);
  spoon.rotation.y = -0.6; grp.add(spoon);
  return grp;
}

const FRAPPE_FLAVORS = {
  caramelo: { drink: 0xc79a6c, drizzle: 0xa8621c },
  mocha: { drink: 0x7a4f35, drizzle: 0x3a2014 },
  morango: { drink: 0xf0a3b5, drizzle: 0xc2263f },
  baunilha: { drink: 0xf1e3c4, drizzle: 0xd9b26a },
  matcha: { drink: 0x9fbf6a, drizzle: 0x5c7d2c },
};
export const FRAPPE_FLAVOR_LABELS = { caramelo: 'Caramelo', mocha: 'Mocha', morango: 'Morango', baunilha: 'Baunilha', matcha: 'Matcha' };

function frappe({ flavor = 'caramelo', size = 'M' } = {}) {
  const f = FRAPPE_FLAVORS[flavor] ?? FRAPPE_FLAVORS.caramelo;
  const k = { P: 0.85, M: 1, G: 1.15 }[size] ?? 1;
  const grp = new THREE.Group();
  const H = 0.13 * k;
  grp.add(mesh(glass(0.03, 0.044, H, { bottom: 0.004, wall: 0.0015 }), glassMat(0xffffff, 0.22)));
  grp.add(mesh(lathe([[0, 0.004], [0.029, 0.004], [0.0425, H - 0.004], [0, H - 0.004]], 64), mat(f.drink, { roughness: 0.4, opacity: 0.95, name: 'bebida' })));
  const cream = new THREE.Group();
  for (let i = 0; i < 4; i++) {
    const t = new THREE.TorusGeometry(0.036 - i * 0.008, 0.009 - i * 0.0012, 14, 48); t.rotateX(Math.PI / 2);
    cream.add(mesh(t, mat(0xfbf6ee, { roughness: 0.6, name: 'chantilly' }), 0, i * 0.0085, 0));
  }
  cream.add(mesh(new THREE.SphereGeometry(0.006, 16, 10), mat(0xfbf6ee, { roughness: 0.6, name: 'chantilly' }), 0, 0.034, 0));
  cream.position.y = H + 0.004; grp.add(cream);
  const drizzle = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(Array.from({ length: 16 }, (_, i) => {
    const a = i * 1.7, r = 0.034 - i * 0.0019; return new THREE.Vector3(Math.cos(a) * r, H + 0.014 + i * 0.0021, Math.sin(a) * r);
  })), 160, 0.0018, 8);
  grp.add(new THREE.Mesh(drizzle, mat(f.drizzle, { roughness: 0.15, name: 'calda' })));
  const lid = new THREE.SphereGeometry(0.0445, 48, 16, 0, TAU, 0, Math.PI / 2); lid.scale(1, 0.95, 1);
  grp.add(mesh(lid, glassMat(0xffffff, 0.15), 0, H, 0));
  grp.add(straw(0x1f7a4a, 0.12, 0.008, H + 0.04, 0, 0.12));
  return grp;
}

function juice({ color = 0xf39c12, slice = 'laranja' } = {}) {
  const grp = new THREE.Group();
  grp.add(mesh(glass(0.03, 0.036, 0.14, { bottom: 0.01 }), glassMat()));
  grp.add(mesh(new THREE.CylinderGeometry(0.0335, 0.028, 0.115, 48), mat(color, { roughness: 0.2, opacity: 0.92, name: 'suco' }), 0, 0.0675, 0));
  const peel = slice === 'limao' ? [0x5f9e2a, '#c8dd78'] : slice === 'morango' ? [0xc2263f, '#e8566e'] : [0xf08a12, '#f6b23c'];
  const s = citrusSlice(peel[0], peel[1], 0.024); s.position.set(0.03, 0.13, 0); s.rotation.set(Math.PI / 2, 0, 0.3); grp.add(s);
  grp.add(straw(0xf5f5f5, 0.17, -0.012, 0.11, 0.004, -0.15));
  return grp;
}

function soda({ color = 0x3b1d0f } = {}) {
  const grp = new THREE.Group();
  grp.add(mesh(glass(0.032, 0.04, 0.13, { bottom: 0.012 }), glassMat()));
  grp.add(mesh(new THREE.CylinderGeometry(0.0375, 0.0305, 0.1, 48), mat(color, { roughness: 0.1, opacity: 0.9, name: 'refrigerante' }), 0, 0.062, 0));
  grp.add(iceCubes(5, 0.018, 0.09, 8));
  const s = citrusSlice(0x5f9e2a, '#d8e88a', 0.022); s.position.set(-0.035, 0.12, 0); s.rotation.set(Math.PI / 2, 0, -0.4); grp.add(s);
  grp.add(straw(0xd32f2f, 0.17, 0.012, 0.11, 0, 0.18));
  return grp;
}

// ---------- foto → 3D ----------
// Coloca a foto do prato (tirada de cima) em um prato de verdade, com leve volume.
async function photoPlate({ imageUrl, kind = 'prato' } = {}) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = imageUrl; });
  const t = canvasTex(1024, (g, s) => {
    const side = Math.min(img.width, img.height);
    g.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, s, s);
  });
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  const grp = new THREE.Group();
  if (kind === 'tabua') grp.add(board({ w: 0.3, d: 0.3, round: true }));
  else grp.add(plate());
  const r = kind === 'tabua' ? 0.14 : 0.1;
  const dome = new THREE.CircleGeometry(r, 96, 0, TAU);
  dome.rotateX(-Math.PI / 2);
  const p = dome.attributes.position;
  for (let i = 0; i < p.count; i++) { const d = Math.hypot(p.getX(i), p.getZ(i)) / r; p.setY(i, 0.018 * (1 - d * d)); }
  dome.computeVertexNormals();
  grp.add(mesh(dome, mat(0xffffff, { map: t, roughness: 0.6, name: 'foto' }), 0, kind === 'tabua' ? 0.017 : PLATE_TOP + 0.001, 0));
  return grp;
}

// ---------- catálogo de modelos ----------
export const TEMPLATES = {
  burger: { label: 'Hambúrguer', build: burger, options: { cheese: 'bool:Queijo', bacon: 'bool:Bacon', double: 'bool:Carne dupla', withFries: 'bool:Fritas ao lado' } },
  fritas: { label: 'Batata frita', build: friesBox, options: { cheddar: 'bool:Cheddar', bacon: 'bool:Bacon' } },
  prato: { label: 'Prato montado', build: platedMeal, options: { parts: 'parts' } },
  pizza: { label: 'Pizza', build: pizza, options: { kind: 'select:margherita=Margherita,calabresa=Calabresa' } },
  pudim: { label: 'Pudim', build: pudim, options: {} },
  brownie: { label: 'Brownie com sorvete', build: brownie, options: {} },
  mule: { label: 'Drink na caneca de cobre', build: moscowMule, options: {} },
  caipirinha: { label: 'Drink no copo baixo', build: caipirinha, options: {} },
  latte: { label: 'Café / Latte', build: latte, options: {} },
  frappe: { label: 'Frapê / bebida gelada', build: frappe, options: { flavor: 'flavor', size: 'select:P=Pequeno,M=Médio,G=Grande' } },
  suco: { label: 'Suco', build: juice, options: { color: 'color', slice: 'select:laranja=Laranja,limao=Limão,morango=Morango' } },
  refri: { label: 'Refrigerante', build: soda, options: { color: 'color' } },
};

export async function buildModel(spec) {
  if (spec.type === 'photo') return photoPlate(spec.options);
  const t = TEMPLATES[spec.template];
  if (!t) throw new Error('Modelo desconhecido: ' + spec.template);
  const opts = { ...(spec.options || {}) };
  if (typeof opts.color === 'string') opts.color = new THREE.Color(opts.color).getHex();
  return t.build(opts);
}

export async function exportGLB(object) {
  object.updateMatrixWorld(true);
  return new GLTFExporter().parseAsync(object, { binary: true, onlyVisible: true });
}

export async function specToGLBBlob(spec) {
  const obj = await buildModel(spec);
  const buf = await exportGLB(obj);
  return new Blob([buf], { type: 'model/gltf-binary' });
}
