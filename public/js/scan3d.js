// Deixa um prato escaneado (app de escaneamento 3D por fotos) bonito e pronto para a realidade aumentada:
// nivela com a mesa, remove a mesa, limpa sujeirinhas soltas, coloca no tamanho real,
// reduz o peso sem perder a forma e mantém a textura em alta resolução.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { MeshoptSimplifier } from '../vendor/meshopt_simplifier.js';

export const QUALITY = {
  max: { label: 'Máxima', tris: 400000, tex: 4096 },
  bal: { label: 'Equilibrada', tris: 160000, tex: 2048 },
  light: { label: 'Leve', tris: 60000, tex: 1024 },
};

const UP = new THREE.Vector3(0, 1, 0);

// ---------- leitura ----------
// Junta todas as malhas do arquivo em "partes" já na posição do mundo, com posições em Float32.
export async function loadScan(file) {
  const buf = await file.arrayBuffer();
  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath(new URL('../vendor/three/addons/libs/draco/gltf/', import.meta.url).href);
  loader.setDRACOLoader(draco);
  loader.setMeshoptDecoder(MeshoptDecoder);
  let gltf;
  try { gltf = await loader.parseAsync(buf, ''); } finally { draco.dispose(); }
  gltf.scene.updateMatrixWorld(true);

  const parts = [];
  gltf.scene.traverse((o) => {
    if (!o.isMesh || !o.geometry?.attributes?.position) return;
    let g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    // as normais são recalculadas no fim (suaves); sem elas os vértices se juntam e a malha pode ser simplificada
    for (const name of Object.keys(g.attributes)) if (!['position', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
    g = mergeVertices(toFloat(g), 1e-7);
    const mat = Array.isArray(o.material) ? o.material[0] : o.material;
    parts.push({ geo: g, mat: prepareMaterial(mat) });
  });
  if (!parts.length) throw new Error('O arquivo não tem nenhum objeto 3D');
  const tris = parts.reduce((s, p) => s + p.geo.index.count / 3, 0);
  return { parts, tris, cache: null };
}

// Converte atributos compactados/intercalados em Float32 simples (o simplificador precisa disso).
function toFloat(g) {
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    const arr = new Float32Array(a.count * a.itemSize);
    for (let i = 0; i < a.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = a.getComponent(i, k);
    out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize));
  }
  if (g.index) out.setIndex(new THREE.BufferAttribute(Uint32Array.from(g.index.array), 1));
  return out;
}

function prepareMaterial(src) {
  const m = new THREE.MeshStandardMaterial({
    map: src?.map || null,
    color: src?.color ? src.color.clone() : new THREE.Color(0xffffff),
    vertexColors: !!src?.vertexColors,
    // escaneamento já traz a luz "pintada" na textura: superfície fosca fica mais natural
    roughness: Math.max(0.75, src?.roughness ?? 1),
    metalness: 0,
    side: THREE.FrontSide,
  });
  if (m.map) {
    m.map.colorSpace = THREE.SRGBColorSpace;
    m.map.userData.mimeType = 'image/jpeg'; // foto em JPEG: arquivo muito menor que PNG
    m.map.anisotropy = 8;
  }
  m.name = src?.name || 'escaneado';
  return m;
}

// Mantém só os vértices usados pelos triângulos.
function compact(g, indices) {
  const map = new Int32Array(g.attributes.position.count).fill(-1);
  let n = 0;
  const idx = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (map[v] < 0) map[v] = n++;
    idx[i] = map[v];
  }
  const out = new THREE.BufferGeometry();
  for (const [name, a] of Object.entries(g.attributes)) {
    const s = a.itemSize, src = a.array, arr = new Float32Array(n * s);
    for (let v = 0; v < map.length; v++) if (map[v] >= 0) for (let k = 0; k < s; k++) arr[map[v] * s + k] = src[v * s + k];
    out.setAttribute(name, new THREE.BufferAttribute(arr, s));
  }
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// ---------- ajuste automático ----------
// Acha o plano da mesa (o maior plano quase horizontal) e devolve como nivelar, onde cortar e o tamanho.
export function autoAdjust(scan) {
  const pts = samplePoints(scan.parts, 20000);
  const box = new THREE.Box3().setFromPoints(pts);
  const diag = box.getSize(new THREE.Vector3()).length() || 1;
  const thr = diag * 0.0025; // tolerância do plano da mesa (bem fina para não comer o fundo do prato)
  let best = null;
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), n = new THREE.Vector3();
  for (let it = 0; it < 300; it++) {
    const p0 = pts[(rnd() * pts.length) | 0], p1 = pts[(rnd() * pts.length) | 0], p2 = pts[(rnd() * pts.length) | 0];
    n.crossVectors(a.subVectors(p1, p0), b.subVectors(p2, p0));
    if (n.lengthSq() < 1e-12) continue;
    n.normalize();
    if (Math.abs(n.dot(UP)) < 0.7) continue; // só planos quase horizontais (até ~45°)
    const d = -n.dot(p0);
    let count = 0;
    for (let i = 0; i < pts.length; i += 2) if (Math.abs(n.dot(pts[i]) + d) < thr) count++;
    if (!best || count > best.count) best = { count, n: n.clone(), d };
  }
  let level = new THREE.Quaternion();
  let tableShare = 0;
  if (best) {
    // a normal aponta para o lado onde está o prato (a maior parte dos pontos fora do plano)
    let above = 0, below = 0;
    for (const p of pts) { const s = best.n.dot(p) + best.d; if (s > thr) above++; else if (s < -thr) below++; }
    if (below > above) { best.n.negate(); best.d = -best.d; }
    level = new THREE.Quaternion().setFromUnitVectors(best.n, UP);
    tableShare = (best.count * 2) / pts.length;
  }
  // altura da mesa depois de nivelar
  const leveled = pts.map((p) => p.clone().applyQuaternion(level));
  const lb = new THREE.Box3().setFromPoints(leveled);
  const h = lb.max.y - lb.min.y || 1;
  let cut = 0;
  if (best && tableShare > 0.08) {
    const tableY = -best.d; // depois de nivelar, a mesa fica em y = -d (distância ao longo da normal)
    cut = THREE.MathUtils.clamp((tableY + thr * 0.8 - lb.min.y) / h, 0, 0.6);
  }
  // tamanho: se o escaneamento já parece estar em metros (prato de 8 a 60 cm), mantém
  const kept = leveled.filter((p) => p.y > lb.min.y + cut * h);
  const kb = new THREE.Box3().setFromPoints(kept.length ? kept : leveled);
  const width = Math.max(kb.max.x - kb.min.x, kb.max.z - kb.min.z);
  const sizeCm = width >= 0.08 && width <= 0.6 ? Math.round(width * 1000) / 10 : 26;
  return { level: level.toArray(), cut: Math.round(cut * 1000) / 10, tiltX: 0, tiltZ: 0, turn: 0, sizeCm, clean: true };
}

function samplePoints(parts, max) {
  const total = parts.reduce((s, p) => s + p.geo.attributes.position.count, 0);
  const step = Math.max(1, Math.floor(total / max));
  const out = [];
  for (const p of parts) {
    const a = p.geo.attributes.position.array;
    for (let i = 0; i < a.length / 3; i += step) out.push(new THREE.Vector3(a[i * 3], a[i * 3 + 1], a[i * 3 + 2]));
  }
  return out;
}

// ---------- montar o prato final ----------
// opts: { level:[x,y,z,w], tiltX, tiltZ, turn (graus), cut (% da altura), sizeCm, clean, quality }
export async function buildScan(scan, opts) {
  // A parte pesada (girar, cortar, limpar e simplificar) só refaz quando muda algo que afeta o corte.
  // Girar a frente e mudar o tamanho é instantâneo.
  const key = JSON.stringify([opts.level, opts.tiltX, opts.tiltZ, opts.cut, opts.clean !== false, opts.quality]);
  if (scan.cache?.key !== key) scan.cache = { key, pieces: await cutAndSimplify(scan, opts) };
  const pieces = scan.cache.pieces;

  // tamanho real, centro e frente do prato
  const box = new THREE.Box3();
  for (const p of pieces) { p.geo.computeBoundingBox(); box.union(p.geo.boundingBox); }
  const width = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) || 1;
  const s = (opts.sizeCm || 26) / 100 / width;
  const cx = (box.max.x + box.min.x) / 2, cz = (box.max.z + box.min.z) / 2;
  const fix = new THREE.Matrix4().makeRotationY(THREE.MathUtils.degToRad(opts.turn || 0))
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-cx, -box.min.y, -cz));

  const group = new THREE.Group();
  group.name = 'prato-escaneado';
  let tris = 0;
  for (const p of pieces) {
    const g = p.geo.clone();
    g.applyMatrix4(fix);
    g.computeVertexNormals();
    tris += g.index.count / 3;
    group.add(new THREE.Mesh(g, p.mat));
  }
  const size = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());
  return { group, tris, size };
}

async function cutAndSimplify(scan, opts) {
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(
    THREE.MathUtils.degToRad(opts.tiltX || 0), 0, THREE.MathUtils.degToRad(opts.tiltZ || 0), 'XYZ'));
  q.multiply(new THREE.Quaternion().fromArray(opts.level || [0, 0, 0, 1]));
  const m = new THREE.Matrix4().makeRotationFromQuaternion(q);

  // 1) nivela e acha a altura
  const rotated = scan.parts.map((p) => { const g = p.geo.clone(); g.applyMatrix4(m); return { g, mat: p.mat }; });
  const all = new THREE.Box3();
  for (const r of rotated) { r.g.computeBoundingBox(); all.union(r.g.boundingBox); }
  const h = all.max.y - all.min.y || 1;
  const cutY = all.min.y + ((opts.cut || 0) / 100) * h;

  // 2) corta a mesa e achata a base
  let pieces = [];
  for (const r of rotated) {
    const pos = r.g.attributes.position.array;
    const src = r.g.index.array;
    const keep = [];
    for (let i = 0; i < src.length; i += 3) {
      const a = src[i], b = src[i + 1], c = src[i + 2];
      if (Math.max(pos[a * 3 + 1], pos[b * 3 + 1], pos[c * 3 + 1]) > cutY + 1e-9) keep.push(a, b, c);
    }
    if (!keep.length) continue;
    for (let v = 0; v < pos.length / 3; v++) if (pos[v * 3 + 1] < cutY) pos[v * 3 + 1] = cutY;
    pieces.push({ g: r.g, idx: Uint32Array.from(keep), mat: r.mat });
  }
  if (!pieces.length) throw new Error('Cortou demais: diminua "Remover a mesa"');

  // 3) tira pedacinhos soltos
  await MeshoptSimplifier.ready;
  if (opts.clean !== false) removeSpecks(pieces);

  // 4) simplifica só o que sobrou (o prato), mantendo o detalhe da comida
  const total = pieces.reduce((s, p) => s + p.idx.length / 3, 0);
  const ratio = Math.min(1, QUALITY[opts.quality || 'bal'].tris / total);
  pieces = pieces.map((p) => {
    let idx = p.idx;
    if (ratio < 0.999) {
      const want = Math.max(3, Math.floor((idx.length * ratio) / 3) * 3);
      [idx] = MeshoptSimplifier.simplify(idx, p.g.attributes.position.array, 3, want, 0.01, []);
    }
    return { geo: compact(p.g, idx), mat: p.mat };
  });
  return pieces;
}

// Remove "ilhas" pequenas (sujeira do escaneamento flutuando em volta do prato).
// Conta o tamanho de cada pedaço solto: o que for bem menor que o maior pedaço sai.
function removeSpecks(pieces) {
  const comps = [];
  for (const p of pieces) {
    const pos = p.g.attributes.position.array;
    const remap = MeshoptSimplifier.generatePositionRemap(pos, 3); // une vértices na mesma posição (costuras da textura)
    const parent = new Int32Array(pos.length / 3).map((_, i) => i);
    const find = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
    const join = (x, y) => { x = find(x); y = find(y); if (x !== y) parent[x] = y; };
    for (let i = 0; i < p.idx.length; i += 3) {
      const a = remap[p.idx[i]], b = remap[p.idx[i + 1]], c = remap[p.idx[i + 2]];
      join(a, b); join(b, c);
    }
    const boxes = new Map(); // raiz -> [minx,miny,minz,maxx,maxy,maxz]
    for (const v of p.idx) {
      const r = find(remap[v]);
      let bb = boxes.get(r);
      if (!bb) boxes.set(r, (bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]));
      for (let k = 0; k < 3; k++) { const x = pos[v * 3 + k]; if (x < bb[k]) bb[k] = x; if (x > bb[k + 3]) bb[k + 3] = x; }
    }
    const diag = new Map([...boxes].map(([r, bb]) => [r, Math.hypot(bb[3] - bb[0], bb[4] - bb[1], bb[5] - bb[2])]));
    comps.push({ p, remap, find, diag });
  }
  const biggest = Math.max(...comps.flatMap((c) => [...c.diag.values()]));
  const min = biggest * 0.12;
  for (const c of comps) {
    const keep = [];
    for (let i = 0; i < c.p.idx.length; i += 3) {
      if (c.diag.get(c.find(c.remap[c.p.idx[i]])) >= min) keep.push(c.p.idx[i], c.p.idx[i + 1], c.p.idx[i + 2]);
    }
    c.p.idx = Uint32Array.from(keep);
  }
  for (let i = pieces.length - 1; i >= 0; i--) if (!pieces[i].idx.length) pieces.splice(i, 1);
}

export async function scanToGLB(group, quality = 'bal') {
  const buf = await new GLTFExporter().parseAsync(group, { binary: true, maxTextureSize: QUALITY[quality].tex });
  return new Blob([buf], { type: 'model/gltf-binary' });
}
