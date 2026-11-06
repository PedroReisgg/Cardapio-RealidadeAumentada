// Gera os modelos 3D (.glb) e as fotos (renders) do cardápio de exemplo.
// Usa o mesmo gerador do app do dono (public/js/dish3d.js) dentro de um navegador headless.
//   npm run build:models            -> gera tudo
//   npm run build:models -- x-burger -> só um prato
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { startServer } from '../server/server.js';

// Playwright: usa o instalado no projeto ou o global do sistema.
const { chromium } = createRequire(import.meta.url)('playwright');

const ROOT = new URL('../public/', import.meta.url).pathname;
const menu = JSON.parse(readFileSync(ROOT + 'data/menu.json', 'utf8'));
const withRenders = process.argv.includes('--renders');
const only = process.argv.slice(2).filter((a) => !a.startsWith('--'));

// Modelos extras usados pelas variações (sabores).
const extras = [
  { model: 'models/frape-mocha.glb', spec: { type: 'template', template: 'frappe', options: { flavor: 'mocha' } } },
  { model: 'models/frape-morango.glb', spec: { type: 'template', template: 'frappe', options: { flavor: 'morango' } } },
  { model: 'models/frape-matcha.glb', spec: { type: 'template', template: 'frappe', options: { flavor: 'matcha' } } },
  { model: 'models/suco-limao.glb', spec: { type: 'template', template: 'suco', options: { color: '#c9d86a', slice: 'limao' } } },
  { model: 'models/suco-morango.glb', spec: { type: 'template', template: 'suco', options: { color: '#d7354f', slice: 'morango' } } },
];
const jobs = [
  ...menu.dishes.map((d) => ({ id: d.id, model: d.model, image: withRenders ? `img/render/${d.id}.webp` : null, spec: d.model3d })),
  ...extras.map((e) => ({ id: e.model, ...e })),
].filter((j) => !only.length || only.includes(j.id));

mkdirSync(ROOT + 'models', { recursive: true });
mkdirSync(ROOT + 'img/render', { recursive: true });

const server = await startServer({ port: 0, quiet: true });
const base = `http://localhost:${server.address().port}`;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 900, height: 700 }, deviceScaleFactor: 1 });
page.on('console', (m) => m.type() === 'error' && console.error('[browser]', m.text()));
page.on('pageerror', (e) => console.error('[browser]', e.message));
await page.goto(base + '/tools/render.html');
await page.waitForFunction(() => window.ready === true);

for (const job of jobs) {
  const b64 = await page.evaluate((spec) => window.makeGLB(spec), job.spec);
  writeFileSync(ROOT + job.model, Buffer.from(b64, 'base64'));
  let line = `✓ ${job.model} (${Math.round(b64.length * 0.75 / 1024)} KB)`;
  if (job.image) {
    await page.evaluate((src) => window.showModel(src), '/' + job.model);
    const png = ROOT + job.image.replace(/\.webp$/, '.png');
    await page.locator('#stage').screenshot({ path: png });
    execFileSync('convert', [png, '-quality', '82', ROOT + job.image]);
    execFileSync('rm', [png]);
    line += ` + ${job.image}`;
  }
  console.log(line);
}
await browser.close();
server.close();
