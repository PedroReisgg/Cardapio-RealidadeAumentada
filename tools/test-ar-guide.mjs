// Testa a lógica do guia de realidade aumentada simulando o cliente movendo o celular.
//   node tools/test-ar-guide.mjs
import assert from 'node:assert/strict';
import { ScanGuide, offscreenArrow } from '../public/js/ar-guide.js';

const norm = (v) => { const l = Math.hypot(v.x, v.y, v.z); return { x: v.x / l, y: v.y / l, z: v.z / l }; };
const table = { x: 0, y: 0, z: -0.5 };
// câmera em volta da mesa, a 'r' metros, ângulo 'a', altura 'h', mirando o ponto 'look'
function camAt(a, r = 0.55, h = 0.45, look = table) {
  const pos = { x: table.x + Math.sin(a) * r, y: table.y + h, z: table.z + Math.cos(a) * r };
  return { pos, fwd: norm({ x: look.x - pos.x, y: look.y - pos.y, z: look.z - pos.z }) };
}
const hitAt = (jitter = 0) => ({ ...table, y: table.y + jitter, ny: 1 });

let t = 0;
const step = (g, args) => { t += 1 / 30; return g.update({ t, ...args }); };

// 1) celular apontando para a frente (sem inclinar) -> pede para inclinar
{
  const g = new ScanGuide(); t = 0;
  let r;
  for (let i = 0; i < 30; i++) r = step(g, { cam: { pos: { x: 0, y: 0.45, z: 0 }, fwd: { x: 0, y: 0, z: -1 } }, hit: null });
  assert.equal(r.hint, 'down'); assert.ok(r.progress < 0.05);
}
// 2) mirando a mesa mas sem achar superfície -> pede para varrer
{
  const g = new ScanGuide(); t = 0;
  let r;
  for (let i = 0; i < 40; i++) r = step(g, { cam: camAt(0), hit: null });
  assert.equal(r.hint, 'sweep');
}
// 3) muito longe -> pede para chegar perto
{
  const g = new ScanGuide(); t = 0;
  let r;
  for (let i = 0; i < 30; i++) r = step(g, { cam: camAt(0, 1.9, 0.6), hit: hitAt() });
  assert.equal(r.hint, 'closer');
}
// 4) parede -> avisa
{
  const g = new ScanGuide(); t = 0;
  let r;
  for (let i = 0; i < 30; i++) r = step(g, { cam: camAt(0), hit: { ...table, ny: 0.1 } });
  assert.equal(r.hint, 'wall');
}
// 5) fluxo completo: parado -> pede esquerda -> vai para esquerda -> pede direita -> vai -> pronto
{
  const g = new ScanGuide(); t = 0;
  let r;
  for (let i = 0; i < 45; i++) r = step(g, { cam: camAt(0), hit: hitAt((i % 3) * 0.001) });
  assert.equal(r.hint, 'left', 'deveria pedir esquerda, veio ' + r.hint);
  const mid = r.progress;
  for (let i = 0; i <= 30; i++) r = step(g, { cam: camAt(-0.2 * i / 30), hit: hitAt() });
  assert.equal(r.hint, 'right'); assert.ok(r.progress > mid);
  for (let i = 0; i <= 50; i++) r = step(g, { cam: camAt(-0.2 + 0.4 * i / 50), hit: hitAt() });
  for (let i = 0; i < 20; i++) r = step(g, { cam: camAt(0.2), hit: hitAt() });
  assert.equal(r.hint, 'done'); assert.equal(r.progress, 1); assert.ok(r.done);
  // depois de pronto, perder a mesa não volta a porcentagem
  r = step(g, { cam: camAt(0.2), hit: null });
  assert.equal(r.progress, 1);
}
// 6) instrução não pisca: segura pelo menos 0,55 s
{
  const g = new ScanGuide(); t = 0;
  let r = step(g, { cam: camAt(0, 1.9, 0.6), hit: hitAt() });
  const first = r.hint;
  r = step(g, { cam: camAt(0), hit: hitAt() });
  assert.equal(r.hint, first);
}
// 7) seta do prato fora da tela
assert.equal(offscreenArrow({ x: 0, y: 0 }, false), null);
assert.equal(offscreenArrow({ x: 1.5, y: 0 }, false).side, 'direita');
assert.equal(offscreenArrow({ x: -2, y: 0.2 }, false).side, 'esquerda');
assert.equal(offscreenArrow({ x: 0.3, y: 0 }, true).side, 'esquerda');

console.log('ar-guide: todos os testes passaram');
