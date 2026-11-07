// Servidor local do Cardápio 3D (sem dependências).
// - Serve o site do cliente (/) e o app do dono (/admin)
// - Guarda o cardápio e os arquivos enviados em ./storage (modo "local")
//
//   npm run dev            -> http://localhost:3000
//   PORT=8080 OWNER_PIN=4321 npm run dev
import http from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { existsSync, createReadStream } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PUBLIC = join(ROOT, 'public');
const STORAGE = join(ROOT, 'storage');
const UPLOADS = join(STORAGE, 'uploads');
const DB = join(STORAGE, 'menu.json');
const SCANS = join(STORAGE, 'scans');
const PIN = process.env.OWNER_PIN || '1234';
const MAX_UPLOAD = 40 * 1024 * 1024;

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.usdz': 'model/vnd.usdz+zip', '.ico': 'image/x-icon',
};
const UPLOAD_EXT = new Set(['glb', 'usdz', 'jpg', 'jpeg', 'png', 'webp']);

async function readDb() {
  if (!existsSync(DB)) {
    await mkdir(UPLOADS, { recursive: true });
    await writeFile(DB, await readFile(join(PUBLIC, 'data/menu.json')));
  }
  return JSON.parse(await readFile(DB, 'utf8'));
}

function lanUrls(port) {
  return Object.values(networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${port}/`);
}

function send(res, code, body, type = 'application/json; charset=utf-8') {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(Object.assign(new Error('Arquivo grande demais'), { code: 413 })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const authed = (req) => req.headers['x-owner-pin'] === PIN;

async function api(req, res, url, port) {
  const route = `${req.method} ${url.pathname}`;
  if (route === 'GET /api/info') return send(res, 200, { mode: 'local', lanUrls: lanUrls(port), port });
  if (route === 'GET /api/menu') return send(res, 200, await readDb());
  if (route === 'POST /api/login') {
    const { pin } = JSON.parse((await readBody(req, 10_000)).toString() || '{}');
    return pin === PIN ? send(res, 200, { ok: true }) : send(res, 401, { error: 'PIN incorreto' });
  }
  if (!authed(req)) return send(res, 401, { error: 'Faça login no app do dono' });
  if (route === 'PUT /api/menu') {
    const menu = JSON.parse((await readBody(req, 5_000_000)).toString());
    if (!menu || !Array.isArray(menu.dishes)) return send(res, 400, { error: 'Cardápio inválido' });
    await mkdir(STORAGE, { recursive: true });
    await writeFile(DB, JSON.stringify(menu, null, 2));
    return send(res, 200, { ok: true });
  }
  if (route === 'POST /api/upload') {
    const ext = (url.searchParams.get('ext') || '').toLowerCase();
    if (!UPLOAD_EXT.has(ext)) return send(res, 400, { error: 'Tipo de arquivo não suportado' });
    const body = await readBody(req, MAX_UPLOAD);
    await mkdir(UPLOADS, { recursive: true });
    const name = `${randomUUID()}.${ext}`;
    await writeFile(join(UPLOADS, name), body);
    return send(res, 200, { url: `uploads/${name}` });
  }
  // Escaneamento 3D feito no app: as fotos ficam em storage/scans/<id>/images
  // e o motor (pasta motor/, rodando com --pasta storage/scans) monta o prato.glb.
  const sm = url.pathname.match(/^\/api\/scans(?:\/([0-9a-f-]{36}))?(?:\/(fotos|enviar|prato\.glb))?$/);
  if (sm) return scanApi(req, res, url, sm[1], sm[2]);
  if (route === 'POST /api/reset') {
    await writeFile(DB, await readFile(join(PUBLIC, 'data/menu.json')));
    return send(res, 200, { ok: true });
  }
  return send(res, 404, { error: 'Rota não encontrada' });
}

async function scanApi(req, res, url, id, acao) {
  const dir = id && join(SCANS, id);
  const jobFile = id && join(dir, 'job.json');
  const readJob = async () => JSON.parse(await readFile(jobFile, 'utf8'));
  const writeJob = (j) => writeFile(join(SCANS, j.id, 'job.json'), JSON.stringify({ ...j, updated_at: Date.now() / 1000 }));
  if (req.method === 'POST' && !id) {
    const nid = randomUUID();
    await mkdir(join(SCANS, nid, 'images'), { recursive: true });
    await writeJob({ id: nid, status: 'enviando', fotos: 0, created_at: Date.now() / 1000 });
    return send(res, 200, { id: nid });
  }
  if (!id || !existsSync(jobFile)) return send(res, 404, { error: 'Escaneamento não encontrado' });
  if (req.method === 'POST' && acao === 'fotos') {
    const n = String(url.searchParams.get('n') || '').replace(/\D/g, '').padStart(3, '0').slice(-3);
    await writeFile(join(dir, 'images', `${n}.jpg`), await readBody(req, 15 * 1024 * 1024));
    return send(res, 200, { ok: true });
  }
  if (req.method === 'POST' && acao === 'enviar') {
    const { fotos = 0 } = JSON.parse((await readBody(req, 10_000)).toString() || '{}');
    await writeJob({ ...(await readJob()), status: 'na_fila', etapa: 'na fila', fotos });
    return send(res, 200, { ok: true });
  }
  if (req.method === 'GET' && acao === 'prato.glb') {
    const f = join(dir, 'prato.glb');
    if (!existsSync(f)) return send(res, 404, { error: 'Ainda não ficou pronto' });
    return send(res, 200, await readFile(f), 'model/gltf-binary');
  }
  if (req.method === 'GET' && !acao) return send(res, 200, await readJob());
  return send(res, 404, { error: 'Rota não encontrada' });
}

async function serveStatic(req, res, url) {
  let path = decodeURIComponent(url.pathname);
  let base = PUBLIC;
  if (path.startsWith('/uploads/')) { base = STORAGE; }
  if (path.endsWith('/')) path += 'index.html';
  const file = normalize(join(base, path));
  if (!file.startsWith(base)) return send(res, 403, 'Proibido', 'text/plain');
  try {
    const st = await stat(file);
    if (st.isDirectory()) { res.writeHead(301, { Location: url.pathname + '/' }); return res.end(); }
    res.writeHead(200, { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
    createReadStream(file).pipe(res);
  } catch {
    send(res, 404, 'Não encontrado', 'text/plain; charset=utf-8');
  }
}

export function startServer({ port = Number(process.env.PORT) || 3000, quiet = false } = {}) {
  const server = http.createServer(async (req, res) => {
    // O app Android (APK) acessa este servidor de outra origem.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Owner-Pin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname.startsWith('/api/')) await api(req, res, url, server.address().port);
      else await serveStatic(req, res, url);
    } catch (err) {
      if (!quiet) console.error(err);
      if (!res.headersSent) send(res, err.code === 413 ? 413 : 500, { error: err.message });
    }
  });
  return server.listen(port, () => {
    if (quiet) return;
    const p = server.address().port;
    console.log('\n  Cardápio 3D rodando!\n');
    console.log(`  Cardápio do cliente:  http://localhost:${p}/`);
    console.log(`  App do dono:          http://localhost:${p}/admin/   (PIN: ${PIN})`);
    for (const u of lanUrls(p)) console.log(`  No celular (mesma Wi-Fi): ${u}`);
    console.log('');
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) startServer();
