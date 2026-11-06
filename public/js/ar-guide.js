// Guia da leitura da mesa (realidade aumentada).
// Recebe, a cada quadro, a posição/direção da câmera e o ponto onde a câmera "acerta" a mesa,
// e devolve a porcentagem lida e a instrução para o cliente (incline, chegue perto, vá para a esquerda…).
// Não depende do navegador: dá para testar no Node (tools/test-ar-guide.mjs).

const DEG = Math.PI / 180;

export const HINTS = {
  track: 'Movimente o celular devagar para começar',
  down: 'Incline o celular para baixo, mirando a mesa',
  sweep: 'Procurando a mesa… mova o celular devagar, de um lado para o outro',
  wall: 'Isso parece uma parede. Aponte para o tampo da mesa',
  closer: 'Chegue um pouco mais perto da mesa',
  farther: 'Afaste um pouco o celular da mesa',
  left: 'Agora mova o celular devagar para a esquerda',
  right: 'Agora mova o celular devagar para a direita',
  hold: 'Segure firme só um instante…',
  done: 'Mesa reconhecida!',
};

export const LIMITS = {
  minPitch: -0.22, // forward.y acima disso = celular "em pé" demais
  maxDist: 1.6, // metros
  minDist: 0.2,
  sweepAngle: 9 * DEG, // quanto andar para cada lado (em volta do ponto da mesa)
  goodFrames: 40,
  noHitSeconds: 0.8,
  holdSeconds: 0.55, // tempo mínimo de cada instrução na tela (evita piscar)
};

const clamp01 = (v) => Math.max(0, Math.min(1, v));

export class ScanGuide {
  constructor(limits = {}) {
    this.L = { ...LIMITS, ...limits };
    this.reset();
  }

  reset() {
    this.goodFrames = 0;
    this.center = null; // ponto médio da mesa lido
    this.baseAngle = null; // ângulo inicial da câmera em volta do ponto
    this.minA = 0; this.maxA = 0;
    this.lastHitAt = -1;
    this.ys = [];
    this.shown = { hint: 'track', since: -10 };
    this.progress = 0;
    this.done = false;
  }

  // cam: {pos:{x,y,z}, fwd:{x,y,z}}  hit: null | {x,y,z, ny}  t: segundos
  update({ tracking = true, cam, hit, t }) {
    const L = this.L;
    let want;
    let distance = null;

    if (!tracking || !cam) {
      want = 'track';
    } else {
      if (hit) {
        distance = Math.hypot(hit.x - cam.pos.x, hit.y - cam.pos.y, hit.z - cam.pos.z);
        this.lastHitAt = t;
      }
      const flatSurface = hit && hit.ny > 0.85;
      const inRange = distance != null && distance <= L.maxDist && distance >= L.minDist;

      if (flatSurface && inRange) {
        this.goodFrames++;
        this.ys.push(hit.y); if (this.ys.length > 30) this.ys.shift();
        // centro da mesa: média móvel dos pontos acertados
        if (!this.center) this.center = { x: hit.x, y: hit.y, z: hit.z };
        else { const k = 0.08; this.center.x += (hit.x - this.center.x) * k; this.center.y += (hit.y - this.center.y) * k; this.center.z += (hit.z - this.center.z) * k; }
      }
      if (this.center) {
        // ângulo da câmera em volta do ponto da mesa (visto de cima)
        const a = Math.atan2(cam.pos.x - this.center.x, cam.pos.z - this.center.z);
        if (this.baseAngle == null) this.baseAngle = a;
        let d = a - this.baseAngle;
        while (d > Math.PI) d -= 2 * Math.PI;
        while (d < -Math.PI) d += 2 * Math.PI;
        this.minA = Math.min(this.minA, d); this.maxA = Math.max(this.maxA, d);
      }

      const p = this.parts();
      if (cam.fwd.y > L.minPitch) want = 'down';
      else if (!hit && (this.lastHitAt < 0 || t - this.lastHitAt > L.noHitSeconds)) want = 'sweep';
      else if (hit && !flatSurface) want = 'wall';
      else if (distance != null && distance > L.maxDist) want = 'closer';
      else if (distance != null && distance < L.minDist) want = 'farther';
      else if (p.left < 1 && p.left <= p.right) want = 'left';
      else if (p.right < 1) want = 'right';
      else if (p.frames < 1 || p.stable < 1) want = 'hold';
      else want = 'done';
    }

    const p = this.parts();
    const raw = 0.3 * p.frames + 0.25 * p.left + 0.25 * p.right + 0.2 * p.stable;
    this.progress = Math.max(this.progress, clamp01(raw)); // nunca volta para trás
    if (want === 'done' && this.progress >= 0.999) this.done = true;
    if (this.done) want = 'done';

    // segura a instrução um tempo mínimo na tela
    if (want !== this.shown.hint && (want === 'done' || t - this.shown.since >= L.holdSeconds)) {
      this.shown = { hint: want, since: t };
    }
    return {
      progress: this.done ? 1 : Math.min(this.progress, 0.99),
      hint: this.shown.hint,
      message: HINTS[this.shown.hint],
      distance,
      done: this.done,
    };
  }

  parts() {
    const L = this.L;
    let stable = 0;
    if (this.ys.length >= 10) {
      const m = this.ys.reduce((s, v) => s + v, 0) / this.ys.length;
      const sd = Math.sqrt(this.ys.reduce((s, v) => s + (v - m) ** 2, 0) / this.ys.length);
      stable = clamp01(1 - (sd - 0.006) / 0.02);
    }
    return {
      frames: clamp01(this.goodFrames / L.goodFrames),
      left: clamp01(-this.minA / L.sweepAngle),
      right: clamp01(this.maxA / L.sweepAngle),
      stable,
    };
  }
}

// Direção (na tela) para onde o cliente deve virar para reencontrar o prato.
// ndc: posição do prato projetada na tela (-1..1), behind: se está atrás da câmera.
export function offscreenArrow(ndc, behind) {
  let { x, y } = ndc;
  if (behind) { x = -x; y = -y; if (Math.abs(x) < 0.01 && Math.abs(y) < 0.01) x = 1; }
  const visible = !behind && Math.abs(x) < 0.9 && Math.abs(y) < 0.9;
  if (visible) return null;
  const angle = Math.atan2(-y, x); // radianos, 0 = direita (tela)
  const side = Math.abs(x) > Math.abs(y) ? (x > 0 ? 'direita' : 'esquerda') : (y > 0 ? 'cima' : 'baixo');
  return { angle, side };
}
