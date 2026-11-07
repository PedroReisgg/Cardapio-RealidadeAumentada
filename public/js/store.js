// Camada de dados: lê e salva o cardápio no servidor local ou na nuvem (Supabase).
import { CONFIG } from './config.js';

const SETTINGS_KEY = 'cardapio3d.settings';
const PIN_KEY = 'cardapio3d.pin';
export const SITE_ROOT = new URL('../', import.meta.url).href;

function safeGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
function safeSet(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch { /* sem storage */ } }

// Ajustes salvos no aparelho (usados pelo app do dono / APK) por cima do config.js.
export function getSettings() {
  let saved = {};
  try { saved = JSON.parse(safeGet(SETTINGS_KEY) || '{}'); } catch { /* ignora */ }
  return { ...CONFIG, serverUrl: '', publicMenuUrl: '', ...saved };
}
export function saveSettings(s) { safeSet(SETTINGS_KEY, JSON.stringify(s)); }

const hasSupabase = (s) => !!(s.supabaseUrl && s.supabaseAnonKey);
export function backendOf(s = getSettings()) {
  if (s.backend === 'supabase' || (s.backend === 'auto' && hasSupabase(s))) return 'supabase';
  return 'local';
}
function serverBase(s = getSettings()) {
  const u = (s.serverUrl || '').trim();
  return u ? (u.endsWith('/') ? u : u + '/') : SITE_ROOT;
}

// Converte o caminho de um modelo/foto em URL completa.
export function assetUrl(path, s = getSettings()) {
  if (!path) return '';
  if (/^(https?:|blob:|data:)/.test(path)) return path;
  const base = path.startsWith('uploads/') && backendOf(s) === 'local' ? serverBase(s) : SITE_ROOT;
  return new URL(path, base).href;
}

// ---------- Supabase ----------
let sbClient;
async function sb(s = getSettings()) {
  if (sbClient) return sbClient;
  if (!window.supabase) {
    await new Promise((res, rej) => {
      const el = document.createElement('script');
      el.src = new URL('vendor/supabase.js', SITE_ROOT).href;
      el.onload = res; el.onerror = () => rej(new Error('Não consegui carregar o Supabase'));
      document.head.append(el);
    });
  }
  sbClient = window.supabase.createClient(s.supabaseUrl, s.supabaseAnonKey);
  return sbClient;
}

// ---------- leitura ----------
async function fetchJson(url, opts) {
  const r = await fetch(url, opts);
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Erro ${r.status}`);
  return body;
}

export async function loadMenu() {
  const s = getSettings();
  try {
    if (backendOf(s) === 'supabase') {
      const c = await sb(s);
      const { data, error } = await c.from('menus').select('data').eq('id', s.menuId).maybeSingle();
      if (error) throw error;
      if (data) return { menu: data.data, source: 'supabase' };
      // Primeira vez: ainda não há cardápio na nuvem, usa o de exemplo.
      return { menu: await fetchJson(new URL('data/menu.json', SITE_ROOT)), source: 'exemplo' };
    }
    return { menu: await fetchJson(new URL('api/menu', serverBase(s))), source: 'local' };
  } catch (err) {
    console.warn('Usando o cardápio de exemplo:', err.message);
    return { menu: await fetchJson(new URL('data/menu.json', SITE_ROOT)), source: 'exemplo', error: err.message };
  }
}

// Avisa quando o dono salva o cardápio na nuvem (o cardápio do cliente atualiza sem recarregar).
export async function watchMenu(onChange) {
  const s = getSettings();
  if (backendOf(s) !== 'supabase') return;
  const c = await sb(s);
  c.channel('cardapio-' + s.menuId)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'menus', filter: `id=eq.${s.menuId}` }, (p) => { if (p.new?.data) onChange(p.new.data); })
    .subscribe();
}

// ---------- dono ----------
export async function login({ pin, email, password }) {
  const s = getSettings();
  if (backendOf(s) === 'supabase') {
    const c = await sb(s);
    const { error } = await c.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'E-mail ou senha incorretos' : error.message);
    return true;
  }
  await fetchJson(new URL('api/login', serverBase(s)), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin }) });
  safeSet(PIN_KEY, pin);
  return true;
}

export async function isLoggedIn() {
  const s = getSettings();
  if (backendOf(s) === 'supabase') {
    const c = await sb(s);
    const { data } = await c.auth.getSession();
    return !!data.session;
  }
  return !!safeGet(PIN_KEY);
}

export async function logout() {
  const s = getSettings();
  safeSet(PIN_KEY, null);
  if (backendOf(s) === 'supabase') await (await sb(s)).auth.signOut();
}

const pinHeader = () => ({ 'X-Owner-Pin': safeGet(PIN_KEY) || '' });

export async function saveMenu(menu) {
  const s = getSettings();
  if (backendOf(s) === 'supabase') {
    const c = await sb(s);
    const { error } = await c.from('menus').upsert({ id: s.menuId, data: menu, updated_at: new Date().toISOString() });
    if (error) throw new Error(error.message);
    return;
  }
  await fetchJson(new URL('api/menu', serverBase(s)), {
    method: 'PUT', headers: { 'Content-Type': 'application/json', ...pinHeader() }, body: JSON.stringify(menu),
  });
}

export async function uploadFile(blob, ext) {
  const s = getSettings();
  if (backendOf(s) === 'supabase') {
    const c = await sb(s);
    const path = `${s.menuId}/${crypto.randomUUID()}.${ext}`;
    const { error } = await c.storage.from(s.bucket).upload(path, blob, { contentType: blob.type || undefined, upsert: false });
    if (error) throw new Error(error.message);
    return c.storage.from(s.bucket).getPublicUrl(path).data.publicUrl;
  }
  const { url } = await fetchJson(new URL(`api/upload?ext=${ext}`, serverBase(s)), {
    method: 'POST', headers: pinHeader(), body: blob,
  });
  return url;
}

// ---------- escaneamento 3D feito no app ----------
// As fotos vão para a nuvem (ou para o servidor local) e o motor (pasta motor/) devolve o prato.glb.
export async function scanCreate() {
  const s = getSettings();
  if (backendOf(s) === 'supabase') {
    const c = await sb(s);
    const { data, error } = await c.from('scan_jobs').insert({}).select('id').single();
    if (error) throw new Error(error.message);
    return data.id;
  }
  return (await fetchJson(new URL('api/scans', serverBase(s)), { method: 'POST', headers: pinHeader() })).id;
}

export async function scanUploadPhoto(id, n, blob) {
  const s = getSettings();
  const name = String(n).padStart(3, '0');
  if (backendOf(s) === 'supabase') {
    const c = await sb(s);
    const { error } = await c.storage.from('scans').upload(`${id}/images/${name}.jpg`, blob, { contentType: 'image/jpeg', upsert: true });
    if (error) throw new Error(error.message);
    return;
  }
  await fetchJson(new URL(`api/scans/${id}/fotos?n=${name}`, serverBase(s)), { method: 'POST', headers: pinHeader(), body: blob });
}

export async function scanSubmit(id, fotos) {
  const s = getSettings();
  if (backendOf(s) === 'supabase') {
    const c = await sb(s);
    const { error } = await c.from('scan_jobs').update({ status: 'na_fila', etapa: 'na fila', fotos, updated_at: new Date().toISOString() }).eq('id', id);
    if (error) throw new Error(error.message);
    return;
  }
  await fetchJson(new URL(`api/scans/${id}/enviar`, serverBase(s)), {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...pinHeader() }, body: JSON.stringify({ fotos }),
  });
}

export async function scanStatus(id) {
  const s = getSettings();
  if (backendOf(s) === 'supabase') {
    const c = await sb(s);
    const { data, error } = await c.from('scan_jobs').select('*').eq('id', id).single();
    if (error) throw new Error(error.message);
    return data;
  }
  return fetchJson(new URL(`api/scans/${id}`, serverBase(s)), { headers: pinHeader() });
}

export async function scanResult(id, job) {
  const s = getSettings();
  if (backendOf(s) === 'supabase') {
    const c = await sb(s);
    const { data, error } = await c.storage.from('scans').download(job.arquivo || `${id}/prato.glb`);
    if (error) throw new Error(error.message);
    return data;
  }
  const r = await fetch(new URL(`api/scans/${id}/prato.glb`, serverBase(s)), { headers: pinHeader() });
  if (!r.ok) throw new Error(`Erro ${r.status}`);
  return r.blob();
}

export async function resetLocalMenu() {
  await fetchJson(new URL('api/reset', serverBase()), { method: 'POST', headers: pinHeader() });
}

// Endereço público do cardápio (para o QR Code).
export async function menuPublicUrl() {
  const s = getSettings();
  if (s.publicMenuUrl) return s.publicMenuUrl;
  if (backendOf(s) === 'local') {
    try {
      const info = await fetchJson(new URL('api/info', serverBase(s)));
      const host = new URL(serverBase(s)).hostname;
      if ((host === 'localhost' || host === '127.0.0.1') && info.lanUrls?.length) return info.lanUrls[0];
      return serverBase(s);
    } catch { /* sem servidor */ }
  }
  return SITE_ROOT;
}

export const formatPrice = (v, currency = 'BRL') =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(v || 0);
