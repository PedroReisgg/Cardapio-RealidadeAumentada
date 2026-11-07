// Câmera guiada para escanear o prato dentro do próprio app.
// O dono dá voltas em volta do prato; o app tira as fotos sozinho em cada ângulo
// (3 alturas × 24 posições) e vai enviando para o motor de 3D enquanto ele fotografa.
import { scanCreate, scanUploadPhoto, scanSubmit } from '../js/store.js';

const SECTORS = 24;
// alturas da câmera (graus olhando para baixo): baixa, meio, de cima
const RINGS = [
  { name: 'baixa', label: 'quase na altura da mesa', min: 12, max: 36 },
  { name: 'meio', label: 'na altura do peito', min: 36, max: 58 },
  { name: 'alta', label: 'bem de cima', min: 58, max: 86 },
];
const ORDER = [1, 2, 0]; // ordem sugerida das voltas
const MIN_PHOTOS = 30;
const RAD = Math.PI / 180;

const $ = (s, el = document) => el.querySelector(s);

// Direção para onde a câmera traseira aponta, a partir da orientação do aparelho.
// Devolve { heading: 0..360, pitch: graus para baixo }.
function cameraDirection(alpha, beta, gamma) {
  const a = alpha * RAD, b = beta * RAD, g = gamma * RAD;
  const cA = Math.cos(a), sA = Math.sin(a), cB = Math.cos(b), sB = Math.sin(b), cG = Math.cos(g), sG = Math.sin(g);
  // R = Rz(alpha) · Rx(beta) · Ry(gamma); a câmera olha para -Z do aparelho → d = -(3ª coluna de R)
  const x = -(cA * sG + sA * sB * cG);
  const y = -(sA * sG - cA * sB * cG);
  const z = -(cB * cG);
  const pitch = Math.asin(Math.max(-1, Math.min(1, -z))) / RAD;
  const heading = (Math.atan2(x, y) / RAD + 360) % 360;
  return { heading, pitch };
}

// Nitidez da imagem (variância do laplaciano numa versão pequena): foto tremida dá valor baixo.
function sharpness(ctx, w, h) {
  const d = ctx.getImageData(0, 0, w, h).data;
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = d[i * 4] * 0.299 + d[i * 4 + 1] * 0.587 + d[i * 4 + 2] * 0.114;
  let sum = 0, sum2 = 0, n = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    const l = gray[i - 1] + gray[i + 1] + gray[i - w] + gray[i + w] - 4 * gray[i];
    sum += l; sum2 += l * l; n++;
  }
  const m = sum / n;
  return sum2 / n - m * m;
}

function ringSvg() {
  const parts = [];
  const radii = [36, 52, 68]; // baixa (dentro) → alta (fora)
  RINGS.forEach((_, r) => {
    for (let s = 0; s < SECTORS; s++) {
      const a0 = (s / SECTORS) * 360 + 1.4, a1 = ((s + 1) / SECTORS) * 360 - 1.4;
      const R = radii[r];
      const p = (a) => [80 + R * Math.sin(a * RAD), 80 - R * Math.cos(a * RAD)].map((v) => v.toFixed(2)).join(' ');
      parts.push(`<path data-r="${r}" data-s="${s}" d="M ${p(a0)} A ${R} ${R} 0 0 1 ${p(a1)}"/>`);
    }
  });
  return `<svg viewBox="0 0 160 160" aria-hidden="true">${parts.join('')}<circle class="cap-me" r="5" cx="80" cy="12"/></svg>`;
}

function buildUi() {
  const d = document.createElement('dialog');
  d.className = 'cap';
  d.innerHTML = `
    <video class="cap-video" playsinline muted autoplay></video>
    <div class="cap-frame" aria-hidden="true"><span></span></div>
    <div class="cap-flash" aria-hidden="true"></div>
    <header class="cap-top">
      <button type="button" class="cap-x" aria-label="Cancelar escaneamento">✕</button>
      <div class="cap-count"><strong>0</strong> fotos</div>
    </header>
    <p class="cap-tip" role="status" aria-live="polite"></p>
    <footer class="cap-bottom">
      <div class="cap-ring">${ringSvg()}<span class="cap-pct">0%</span></div>
      <div class="cap-legend"><span>Por dentro: baixa</span><span>Meio</span><span>Por fora: de cima</span></div>
      <div class="cap-actions">
        <button type="button" class="btn ghost-light cap-shot">Tirar foto</button>
        <button type="button" class="btn primary cap-done" disabled>Concluir</button>
      </div>
      <p class="cap-up" aria-live="polite"></p>
    </footer>
    <section class="cap-intro">
      <h2>Escanear o prato</h2>
      <ol>
        <li><strong>Luz boa e suave</strong>, perto de uma janela. Sem flash.</li>
        <li>Prato numa <strong>mesa fosca</strong>, que não seja branca. Não mexa no prato.</li>
        <li>Deixe o prato <strong>dentro do círculo</strong> e ande devagar em volta dele. O app tira as fotos sozinho.</li>
        <li>Faça <strong>3 voltas</strong>: na altura do peito, bem de cima e quase na altura da mesa. O anel mostra o que falta.</li>
      </ol>
      <button type="button" class="btn primary cap-start">Começar</button>
      <button type="button" class="btn link cap-cancel">Agora não</button>
    </section>`;
  document.body.append(d);
  return d;
}

export function openCapture({ onSent, onCancel } = {}) {
  const ui = buildUi();
  const video = $('.cap-video', ui);
  const tip = $('.cap-tip', ui);
  const up = $('.cap-up', ui);
  const doneBtn = $('.cap-done', ui);
  const grid = RINGS.map(() => new Array(SECTORS).fill(false));
  let stream, jobId, startHeading = null, last = null, stableSince = 0, busy = false, closed = false;
  let photos = 0, uploaded = 0, failed = 0, sharpAvg = 0, sensors = false, rafId;
  const uploads = [];
  const history = [];

  ui.showModal();

  const close = () => {
    if (closed) return; closed = true;
    cancelAnimationFrame(rafId);
    removeEventListener('deviceorientation', onOrient);
    stream?.getTracks().forEach((t) => t.stop());
    ui.close(); ui.remove();
  };
  ui.addEventListener('cancel', (e) => { e.preventDefault(); cancel(); });
  const cancel = () => { close(); onCancel?.(); };
  $('.cap-x', ui).onclick = cancel;
  $('.cap-cancel', ui).onclick = cancel;

  function setTip(t) { if (tip.textContent !== t) tip.textContent = t; }
  function updateUp() {
    up.textContent = failed ? `${failed} foto(s) não foram enviadas. Confira a internet.` : uploaded < photos ? `Enviando ${uploaded}/${photos}…` : '';
  }
  function coverage() {
    let n = 0; for (const r of grid) for (const v of r) n += v; return n / (RINGS.length * SECTORS);
  }
  function ringDone(r) { return grid[r].filter(Boolean).length / SECTORS; }
  function refreshCount() {
    $('.cap-count strong', ui).textContent = photos;
    $('.cap-pct', ui).textContent = Math.round(coverage() * 100) + '%';
    doneBtn.disabled = photos < MIN_PHOTOS;
    doneBtn.textContent = coverage() > 0.9 ? 'Concluir ✓' : 'Concluir';
  }

  async function start() {
    $('.cap-intro', ui).hidden = true;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 2560 }, height: { ideal: 1920 } },
      });
    } catch (err) {
      setTip('Não consegui abrir a câmera. Libere a câmera para o app nas configurações do celular.');
      return;
    }
    video.srcObject = stream;
    await video.play().catch(() => {});
    // foco contínuo, quando o celular deixa
    const track = stream.getVideoTracks()[0];
    try { await track.applyConstraints({ advanced: [{ focusMode: 'continuous' }] }); } catch { /* sem suporte */ }
    try {
      jobId = await scanCreate();
    } catch (err) {
      setTip('Não consegui começar o escaneamento: ' + err.message);
      return;
    }
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { await DeviceOrientationEvent.requestPermission(); } catch { /* segue sem sensores */ }
    }
    addEventListener('deviceorientation', onOrient);
    setTip('Aponte para o prato e deixe ele dentro do círculo.');
    setTimeout(() => { if (!sensors && !closed) setTip('Seu aparelho não mostra os ângulos. Tire uma foto a cada passinho em volta do prato (3 voltas, umas 60 fotos).'); }, 2500);
    loop();
  }
  $('.cap-start', ui).onclick = start;

  function onOrient(e) {
    if (e.alpha == null || e.beta == null) return;
    sensors = true;
    const dir = cameraDirection(e.alpha, e.beta, e.gamma || 0);
    if (startHeading == null) startHeading = dir.heading;
    const now = performance.now();
    history.push({ t: now, ...dir });
    while (history.length && now - history[0].t > 220) history.shift();
    last = dir;
  }

  function currentCell() {
    if (!last) return null;
    const ring = RINGS.findIndex((r) => last.pitch >= r.min && last.pitch < r.max);
    const rel = (last.heading - startHeading + 360) % 360;
    return { ring, sector: Math.floor(rel / (360 / SECTORS)) % SECTORS, rel };
  }

  function steady() {
    if (history.length < 3) return false;
    let dh = 0, dp = 0;
    const h0 = history[0];
    for (const h of history) {
      dh = Math.max(dh, Math.abs(((h.heading - h0.heading + 540) % 360) - 180));
      dp = Math.max(dp, Math.abs(h.pitch - h0.pitch));
    }
    return dh < 1.6 && dp < 1.6; // menos de ~7°/s: foto sem borrão
  }

  function guide(cell) {
    const next = ORDER.find((r) => ringDone(r) < 0.85);
    if (next == null) { setTip('Pronto! Todas as voltas foram feitas. Toque em Concluir.'); return; }
    const want = RINGS[next];
    if (cell.ring < 0) {
      setTip(last.pitch < RINGS[0].min ? 'Aponte mais para baixo, para o prato.' : 'Está muito de cima. Abaixe um pouco o celular.');
      return;
    }
    if (cell.ring !== next) {
      setTip(cell.ring < next ? `Suba o celular: agora a volta ${want.label}.` : `Desça o celular: agora a volta ${want.label}.`);
      return;
    }
    const pct = Math.round(ringDone(next) * 100);
    setTip(grid[cell.ring][cell.sector] ? `Ande devagar em volta do prato (volta ${want.label}: ${pct}%).` : 'Segure firme…');
  }

  function drawRing(cell) {
    for (const p of ui.querySelectorAll('.cap-ring path')) {
      const r = +p.dataset.r, s = +p.dataset.s;
      p.classList.toggle('on', grid[r][s]);
      p.classList.toggle('here', !!cell && cell.ring === r && cell.sector === s);
    }
    const me = $('.cap-me', ui);
    if (cell && cell.ring >= 0) {
      const R = [36, 52, 68][cell.ring];
      me.setAttribute('cx', (80 + R * Math.sin(cell.rel * RAD)).toFixed(1));
      me.setAttribute('cy', (80 - R * Math.cos(cell.rel * RAD)).toFixed(1));
      me.style.opacity = 1;
    } else me.style.opacity = 0;
  }

  function loop() {
    if (closed) return;
    rafId = requestAnimationFrame(loop);
    if (!sensors) return;
    const cell = currentCell();
    if (!cell) return;
    drawRing(cell);
    guide(cell);
    const now = performance.now();
    if (cell.ring >= 0 && !grid[cell.ring][cell.sector] && !busy) {
      if (steady()) {
        if (!stableSince) stableSince = now;
        if (now - stableSince > 100) shoot(cell);
      } else stableSince = 0;
    }
  }

  const small = document.createElement('canvas');
  small.width = 160; small.height = 120;
  const sctx = small.getContext('2d', { willReadFrequently: true });

  async function shoot(cell) {
    if (!video.videoWidth || busy) return;
    busy = true;
    try {
      sctx.drawImage(video, 0, 0, small.width, small.height);
      const sh = sharpness(sctx, small.width, small.height);
      if (cell && sharpAvg && sh < sharpAvg * 0.45) { setTip('Ficou tremido. Segure firme…'); return; }
      sharpAvg = sharpAvg ? sharpAvg * 0.85 + sh * 0.15 : sh;
      const c = document.createElement('canvas');
      c.width = video.videoWidth; c.height = video.videoHeight;
      c.getContext('2d').drawImage(video, 0, 0);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.92));
      if (!blob || closed) return;
      if (cell) grid[cell.ring][cell.sector] = true;
      const n = photos++;
      flash();
      refreshCount();
      const job = scanUploadPhoto(jobId, n, blob)
        .then(() => { uploaded++; })
        .catch(() => { failed++; })
        .finally(updateUp);
      uploads.push(job);
      updateUp();
    } finally {
      busy = false; stableSince = 0;
    }
  }

  function flash() {
    const f = $('.cap-flash', ui);
    f.classList.remove('go'); void f.offsetWidth; f.classList.add('go');
    try { navigator.vibrate?.(12); } catch { /* sem vibração */ }
  }

  $('.cap-shot', ui).onclick = () => {
    // foto manual: marca a posição atual se houver sensores
    const cell = sensors ? currentCell() : null;
    shoot(cell && cell.ring >= 0 ? cell : null);
  };

  doneBtn.onclick = async () => {
    if (!jobId) return;
    doneBtn.disabled = true;
    setTip('Enviando as últimas fotos…');
    cancelAnimationFrame(rafId);
    stream?.getTracks().forEach((t) => t.stop());
    await Promise.allSettled(uploads);
    if (uploaded < MIN_PHOTOS) {
      setTip(`Só ${uploaded} fotos chegaram. Confira a internet e tente de novo.`);
      doneBtn.disabled = false;
      return;
    }
    try {
      await scanSubmit(jobId, uploaded);
    } catch (err) {
      setTip('Não consegui enviar: ' + err.message);
      doneBtn.disabled = false;
      return;
    }
    const id = jobId;
    close();
    onSent?.(id, uploaded);
  };

  return { close };
}

export const _test = { cameraDirection };
