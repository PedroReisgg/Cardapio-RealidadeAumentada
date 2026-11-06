// Realidade aumentada guiada (WebXR, Chrome no Android).
// 1. Lê a mesa mostrando a porcentagem e o que fazer (incline, chegue perto, vá para a esquerda…)
// 2. Coloca o prato sozinho quando a leitura chega a 100%
// 3. O prato fica parado na mesa (ancorado): o cliente anda em volta e vê todos os lados.
//    Se a câmera sair da mesa e voltar, o prato continua lá. Se ele sumir da tela, uma seta mostra onde está.
// No iPhone o menu.js usa o AR Quick Look da Apple; sem suporte, mostra o QR para abrir no celular.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ScanGuide, offscreenArrow } from './ar-guide.js';

const ARROW_TEXT = {
  esquerda: 'O prato está à esquerda', direita: 'O prato está à direita',
  cima: 'O prato está mais à frente', baixo: 'O prato está mais para baixo',
};

const ICONS = {
  track: '<svg viewBox="0 0 48 48"><rect x="16" y="8" width="16" height="30" rx="3"/><path d="M8 20c-3 3-3 7 0 10M40 20c3 3 3 7 0 10"/></svg>',
  down: '<svg viewBox="0 0 48 48"><g class="tilt"><rect x="16" y="6" width="16" height="28" rx="3"/></g><path d="M8 42h32" stroke-dasharray="3 3"/></svg>',
  sweep: '<svg viewBox="0 0 48 48"><g class="sweep"><rect x="17" y="10" width="14" height="24" rx="3"/></g><path d="M6 40h36" stroke-dasharray="3 3"/></svg>',
  wall: '<svg viewBox="0 0 48 48"><path d="M10 8v32M10 40h30"/><rect x="22" y="14" width="12" height="20" rx="2"/></svg>',
  closer: '<svg viewBox="0 0 48 48"><path d="M24 34V10M16 18l8-8 8 8"/><path d="M10 40h28"/></svg>',
  farther: '<svg viewBox="0 0 48 48"><path d="M24 10v24M16 26l8 8 8-8"/><path d="M10 40h28"/></svg>',
  left: '<svg viewBox="0 0 48 48"><g class="nudge-l"><path d="M30 12 18 24l12 12"/></g></svg>',
  right: '<svg viewBox="0 0 48 48"><g class="nudge-r"><path d="M18 12l12 12-12 12"/></g></svg>',
  hold: '<svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="10"/><circle cx="24" cy="24" r="2" fill="currentColor"/></svg>',
  done: '<svg viewBox="0 0 48 48"><path d="M12 25l8 8 16-17"/></svg>',
};

function buildOverlay(name) {
  const el = document.createElement('div');
  el.className = 'arx';
  el.innerHTML = `
    <div class="arx-top">
      <button class="arx-btn arx-close" aria-label="Sair da realidade aumentada">
        <svg viewBox="0 0 24 24" width="20" height="20"><path d="M6.4 5 12 10.6 17.6 5 19 6.4 13.4 12l5.6 5.6-1.4 1.4-5.6-5.6L6.4 19 5 17.6 10.6 12 5 6.4Z" fill="currentColor"/></svg>
      </button>
      <p class="arx-title"></p>
      <button class="arx-btn arx-move" hidden>Mudar de lugar</button>
    </div>
    <div class="arx-center">
      <div class="arx-ring">
        <svg viewBox="0 0 120 120"><circle class="arx-ring-bg" cx="60" cy="60" r="54"/><circle class="arx-ring-fg" cx="60" cy="60" r="54"/></svg>
        <div class="arx-icon"></div>
        <strong class="arx-pct">0%</strong>
      </div>
    </div>
    <div class="arx-side arx-side-l" aria-hidden="true"><svg viewBox="0 0 64 120"><path d="M44 20 16 60l28 40"/></svg></div>
    <div class="arx-side arx-side-r" aria-hidden="true"><svg viewBox="0 0 64 120"><path d="M20 20l28 40-28 40"/></svg></div>
    <div class="arx-arrow" hidden><svg viewBox="0 0 48 48"><path d="M14 10l20 14-20 14z"/></svg><span></span></div>
    <div class="arx-card">
      <p class="arx-step">Lendo a mesa</p>
      <p class="arx-msg">Abrindo a câmera…</p>
      <div class="arx-bar"><span></span></div>
    </div>
    <div class="arx-toast" hidden>
      <strong>Pronto! Seu prato está na mesa.</strong>
      <span>Ande em volta para ver todos os lados. Ele fica parado no lugar.</span>
    </div>`;
  el.querySelector('.arx-title').textContent = name;
  return el;
}

// Sombra suave redonda (fica bonita até sem luz real)
function contactShadow(radius) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  grd.addColorStop(0, 'rgba(0,0,0,0.55)'); grd.addColorStop(0.6, 'rgba(0,0,0,0.25)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 128, 128);
  const m = new THREE.Mesh(new THREE.PlaneGeometry(radius * 2.4, radius * 2.4),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false }));
  m.rotation.x = -Math.PI / 2; m.position.y = 0.001; m.renderOrder = -1;
  return m;
}

function reticleMesh(radius) {
  const grp = new THREE.Group();
  const gold = new THREE.MeshBasicMaterial({ color: 0xe6cfa8, transparent: true, opacity: 0.95, depthWrite: false });
  const ring = new THREE.Mesh(new THREE.RingGeometry(radius * 0.96, radius, 64).rotateX(-Math.PI / 2), gold);
  const dot = new THREE.Mesh(new THREE.CircleGeometry(0.008, 24).rotateX(-Math.PI / 2), gold);
  const fill = new THREE.Mesh(new THREE.CircleGeometry(radius, 64).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ color: 0xe6cfa8, transparent: true, opacity: 0.12, depthWrite: false }));
  grp.add(fill, ring, dot);
  grp.userData = { ring, fill };
  grp.matrixAutoUpdate = false;
  grp.visible = false;
  return grp;
}

export async function startWebXR({ modelUrl, name, onEnd }) {
  const overlay = buildOverlay(name);
  document.body.append(overlay);
  const $ = (s) => overlay.querySelector(s);

  let session;
  try {
    session = await navigator.xr.requestSession('immersive-ar', {
      requiredFeatures: ['hit-test', 'local'],
      optionalFeatures: ['dom-overlay', 'anchors'],
      domOverlay: { root: overlay },
    });
  } catch (err) {
    overlay.remove();
    throw err;
  }
  document.documentElement.classList.add('arx-on');

  let renderer = null, pmrem = null, hitSource = null;
  session.addEventListener('end', () => {
    renderer?.setAnimationLoop(null);
    hitSource?.cancel?.();
    renderer?.dispose(); pmrem?.dispose();
    renderer?.domElement.remove();
    overlay.remove();
    document.documentElement.classList.remove('arx-on');
    onEnd?.();
  });
  try {
    await setup();
  } catch (err) {
    session.end().catch(() => {});
    throw err;
  }

  async function setup() {

  renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.xr.enabled = true;
  renderer.xr.setReferenceSpaceType('local');
  renderer.domElement.className = 'arx-canvas';
  document.body.append(renderer.domElement);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.01, 30);
  pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.add(new THREE.HemisphereLight(0xfff4e6, 0x3a2a1e, 0.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.2); sun.position.set(0.4, 1, 0.3); scene.add(sun);

  // carrega o prato
  $('.arx-msg').textContent = 'Preparando o prato…';
  const gltf = await new GLTFLoader().loadAsync(modelUrl);
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.set(-center.x, -box.min.y, -center.z); // base do prato em y=0, centralizado
  const radius = Math.max(size.x, size.z) / 2 || 0.12;
  const dish = new THREE.Group();
  dish.add(contactShadow(radius), model);
  dish.visible = false;
  scene.add(dish);

  const reticle = reticleMesh(radius);
  scene.add(reticle);

  // pontinhos da leitura da mesa
  const MAXP = 160;
  const pts = new Float32Array(MAXP * 3);
  const pGeo = new THREE.BufferGeometry(); pGeo.setAttribute('position', new THREE.BufferAttribute(pts, 3)); pGeo.setDrawRange(0, 0);
  const pCloud = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xf3e3c6, size: 0.006, transparent: true, opacity: 0.8, depthWrite: false }));
  scene.add(pCloud);
  let pCount = 0, pNext = 0, lastPt = null;

  const guide = new ScanGuide();
  let state = 'scan'; // scan -> placed (-> move -> placed)
  let lastHit = null, lastHitPose = null, anchor = null, dropT = 0, hintShown = '';
  const viewerSpace = await session.requestReferenceSpace('viewer');
  hitSource = await session.requestHitTestSource({ space: viewerSpace });
  await renderer.xr.setSession(session);

  const ring = $('.arx-ring-fg');
  const CIRC = 2 * Math.PI * 54;
  ring.style.strokeDasharray = CIRC;
  const setProgress = (p) => {
    ring.style.strokeDashoffset = CIRC * (1 - p);
    $('.arx-pct').textContent = Math.round(p * 100) + '%';
    $('.arx-bar span').style.transform = `scaleX(${p})`;
  };
  const setHint = (hint, msg) => {
    if (hint === hintShown) return;
    hintShown = hint;
    $('.arx-icon').innerHTML = ICONS[hint] || '';
    $('.arx-msg').textContent = msg;
    overlay.dataset.hint = hint;
    if (navigator.vibrate && (hint === 'done')) navigator.vibrate(30);
  };

  const place = (fromHit) => {
    if (!lastHitPose) return;
    const m = new THREE.Matrix4().fromArray(lastHitPose.transform.matrix);
    const pos = new THREE.Vector3().setFromMatrixPosition(m);
    const camPos = new THREE.Vector3().setFromMatrixPosition(camera.matrixWorld);
    dish.position.copy(pos);
    dish.rotation.set(0, Math.atan2(camPos.x - pos.x, camPos.z - pos.z), 0); // frente do prato para o cliente
    dish.visible = true;
    dropT = performance.now();
    anchor?.delete?.(); anchor = null;
    // âncora: o celular "prende" o prato naquele ponto da mesa
    try { fromHit.createAnchor?.()?.then((a) => { anchor = a; }).catch(() => {}); } catch { /* sem âncoras: fica parado no mundo mesmo assim */ }
    state = 'placed';
    overlay.dataset.state = 'placed';
    reticle.visible = false; pCloud.visible = false;
    $('.arx-move').hidden = false;
    $('.arx-toast').hidden = false;
    setTimeout(() => { $('.arx-toast').hidden = true; }, 4200);
  };

  $('.arx-move').addEventListener('click', (e) => {
    e.stopPropagation();
    state = 'move'; overlay.dataset.state = 'move';
    dish.visible = false; reticle.visible = true;
    $('.arx-move').hidden = true;
    $('.arx-step').textContent = 'Mudar de lugar';
    $('.arx-msg').textContent = 'Mire onde quer o prato e toque na tela';
    hintShown = '';
  });
  // toque na tela (evento "select" do WebXR) coloca o prato no ponto mirado
  session.addEventListener('select', () => {
    if ((state === 'move' || (state === 'scan' && guide.progress > 0.6)) && lastHit) place(lastHit);
  });
  $('.arx-close').addEventListener('click', (e) => { e.stopPropagation(); session.end(); });
  // toque nos botões não conta como "colocar o prato"
  overlay.addEventListener('beforexrselect', (e) => { if (e.target.closest?.('button')) e.preventDefault(); });

  const tmpM = new THREE.Matrix4(), tmpV = new THREE.Vector3(), fwd = new THREE.Vector3();
  let lostSince = null;

  renderer.setAnimationLoop((time, frame) => {
    if (!frame) return;
    const ref = renderer.xr.getReferenceSpace();
    const viewer = frame.getViewerPose(ref);
    const t = time / 1000;
    const tracking = !!viewer && !viewer.emulatedPosition;

    let hit = null, hitPose = null, r = null;
    if (viewer) {
      const results = frame.getHitTestResults(hitSource);
      if (results.length) {
        hitPose = results[0].getPose(ref);
        if (hitPose) { lastHit = results[0]; lastHitPose = hitPose; hit = hitPose; }
      } else { lastHit = null; lastHitPose = null; }
    }

    if (state === 'scan' || state === 'move') {
      if (hit) {
        tmpM.fromArray(hit.transform.matrix);
        reticle.matrix.copy(tmpM); reticle.visible = true;
        const ny = new THREE.Vector3(0, 1, 0).applyMatrix4(new THREE.Matrix4().extractRotation(tmpM)).y;
        tmpV.setFromMatrixPosition(tmpM);
        // pontos da leitura
        if (!lastPt || lastPt.distanceTo(tmpV) > 0.015) {
          pts.set([tmpV.x, tmpV.y + 0.001, tmpV.z], pNext * 3);
          pNext = (pNext + 1) % MAXP; pCount = Math.min(MAXP, pCount + 1);
          pGeo.setDrawRange(0, pCount); pGeo.attributes.position.needsUpdate = true;
          lastPt = tmpV.clone();
        }
        if (state === 'scan') {
          const cam = viewer.transform;
          const cm = new THREE.Matrix4().fromArray(cam.matrix);
          fwd.set(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(cm));
          r = guide.update({ tracking, t, cam: { pos: cam.position, fwd }, hit: { x: tmpV.x, y: tmpV.y, z: tmpV.z, ny } });
        }
      } else {
        reticle.visible = false;
        if (state === 'scan' && viewer) {
          const cm = new THREE.Matrix4().fromArray(viewer.transform.matrix);
          fwd.set(0, 0, -1).applyMatrix4(new THREE.Matrix4().extractRotation(cm));
          r = guide.update({ tracking, t, cam: { pos: viewer.transform.position, fwd }, hit: null });
        }
      }
      if (state === 'scan' && r) {
        setProgress(r.progress);
        setHint(r.hint, r.message);
        overlay.dataset.state = 'scan';
        reticle.userData.fill.material.opacity = 0.08 + r.progress * 0.2;
        if (r.done && lastHit) place(lastHit);
      }
    }

    if (state === 'placed') {
      // segue a âncora (se o celular corrigir a posição da mesa, o prato acompanha a mesa, não a câmera)
      if (anchor && frame.trackedAnchors?.has(anchor)) {
        const ap = frame.getPose(anchor.anchorSpace, ref);
        if (ap) { tmpM.fromArray(ap.transform.matrix); dish.position.setFromMatrixPosition(tmpM); }
      }
      // pequena animação de "pousar" na mesa
      const k = Math.min(1, (performance.now() - dropT) / 450);
      model.position.y = -box.min.y + (1 - k) ** 3 * 0.04;

      // seta quando o prato sai da tela
      camera.updateMatrixWorld();
      const p = dish.position.clone().project(renderer.xr.getCamera());
      const inFront = dish.position.clone().applyMatrix4(renderer.xr.getCamera().matrixWorldInverse).z < 0;
      const arrow = offscreenArrow({ x: p.x, y: p.y }, !inFront);
      const el = $('.arx-arrow');
      if (arrow) {
        el.hidden = false;
        el.style.setProperty('--a', `${-arrow.angle}rad`);
        el.querySelector('span').textContent = ARROW_TEXT[arrow.side] || 'Procure o prato';
      } else el.hidden = true;

      // rastreamento perdido
      if (!tracking) { lostSince ??= t; } else lostSince = null;
      const lost = lostSince != null && t - lostSince > 0.6;
      if (lost && overlay.dataset.lost !== '1') {
        $('.arx-step').textContent = 'Seu prato continua na mesa';
        $('.arx-msg').textContent = 'Aponte de novo para a mesa, devagar';
      }
      overlay.dataset.lost = lost ? '1' : '';
    }

    renderer.render(scene, camera);
  });

  }
}
