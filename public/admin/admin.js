// App do dono: cria e edita pratos, gera o 3D (realidade aumentada) e os QR Codes das mesas.
import {
  loadMenu, saveMenu, uploadFile, login, logout, isLoggedIn, getSettings, saveSettings,
  backendOf, assetUrl, menuPublicUrl, resetLocalMenu, formatPrice, SITE_ROOT,
} from '../js/store.js';
import { TEMPLATES, PLATE_PART_LABELS, FRAPPE_FLAVOR_LABELS, buildModel, exportGLB } from '../js/dish3d.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (k === 'value') n.value = v;
    else if (k === 'checked') n.checked = !!v;
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids.flat().filter((k) => k != null && k !== false));
  return n;
};
const isApp = !!window.Capacitor?.isNativePlatform?.();

let menu;
let toastTimer;
function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg; t.classList.toggle('err', err); t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2800);
}
const parsePrice = (s) => Number(String(s).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')) || 0;
const priceInput = (v) => (v ?? 0).toFixed(2).replace('.', ',');
const slug = (s) => (s || 'prato').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

async function persist(msg = 'Salvo!') {
  try { await saveMenu(menu); toast(msg); return true; } catch (e) { toast('Não salvou: ' + e.message, true); return false; }
}

// ================= LOGIN =================
function showLogin() {
  const mode = backendOf();
  $('#view-login').hidden = false; $('#view-app').hidden = true;
  $$('#login-form [data-mode]').forEach((f) => { f.hidden = f.dataset.mode !== mode; });
  const s = getSettings();
  $('#login-where').textContent = mode === 'supabase' ? 'Conectado à nuvem (Supabase).'
    : `Servidor local: ${s.serverUrl || (isApp ? 'não configurado' : location.host)}`;
  if (isApp && mode === 'local' && !s.serverUrl) openConnInLogin();
}
function openConnInLogin() {
  const form = $('#conn-form');
  if (form.parentElement.id !== 'view-login-conn') {
    const holder = el('div', { id: 'view-login-conn', class: 'login-conn' });
    $('.login-card').append(holder); holder.append(form);
  }
  fillConnForm();
}
$('#login-settings').onclick = openConnInLogin;

$('#login-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('#login-error').textContent = '';
  const btn = e.submitter; btn.disabled = true;
  try {
    await login({ pin: $('#login-pin').value.trim(), email: $('#login-email').value.trim(), password: $('#login-password').value });
    await startApp();
  } catch (err) {
    $('#login-error').textContent = /fetch|network|Failed|Erro 404|Erro 405/i.test(err.message)
      ? 'Não encontrei o servidor. Rode "npm run dev" no computador ou configure a nuvem em "Configurar conexão".' : err.message;
  } finally { btn.disabled = false; }
});

// ================= APP =================
async function startApp() {
  const holder = $('#view-login-conn');
  if (holder) { $('#tab-ajustes').append($('#conn-form')); holder.remove(); }
  $('#view-login').hidden = true; $('#view-app').hidden = false;
  const { menu: m, source, error } = await loadMenu();
  menu = m;
  const st = $('#source-status');
  st.className = 'status ' + (source === 'exemplo' && error ? 'err' : 'ok');
  st.textContent = {
    local: 'Salvando no servidor local (este computador).',
    supabase: 'Salvando na nuvem (Supabase).',
    exemplo: error ? `Sem conexão com o servidor (${error}). Mostrando o cardápio de exemplo; alterações não serão salvas.` : 'Cardápio de exemplo. Ao salvar, ele vai para a nuvem.',
  }[source];
  $('#open-menu').href = isApp ? (getSettings().publicMenuUrl || getSettings().serverUrl || SITE_ROOT) : SITE_ROOT;
  renderDishes(); renderRestaurant(); renderCats(); fillConnForm();
}

$$('.tabbar button').forEach((b) => b.addEventListener('click', () => {
  $$('.tabbar button').forEach((x) => x.removeAttribute('aria-current'));
  b.setAttribute('aria-current', 'page');
  $$('.tab').forEach((t) => { t.hidden = t.id !== 'tab-' + b.dataset.tab; });
  $('#top-title').textContent = b.textContent.trim();
  if (b.dataset.tab === 'qr') initQr();
  scrollTo(0, 0);
}));

// ---------- lista de pratos ----------
function renderDishes() {
  const q = $('#dish-search').value.trim().toLowerCase();
  const out = [];
  const cats = [...menu.categories, { id: '__sem', name: 'Sem categoria' }];
  for (const c of cats) {
    const items = menu.dishes.filter((d) => (c.id === '__sem' ? !menu.categories.some((x) => x.id === d.category) : d.category === c.id)
      && (!q || d.name.toLowerCase().includes(q)));
    if (!items.length) continue;
    out.push(el('h2', { class: 'cat-title' }, `${c.name} · ${items.length}`));
    for (const d of items) {
      const sw = el('label', { class: 'switch', title: 'Disponível no cardápio', onclick: (e) => e.stopPropagation() },
        el('input', { type: 'checkbox', checked: d.available !== false, 'aria-label': `${d.name} disponível`,
          onchange: async (e) => { d.available = e.target.checked; row.classList.toggle('off', !d.available); await persist(d.available ? 'Prato visível no cardápio' : 'Prato escondido do cardápio'); } }),
        el('span'));
      const row = el('div', { class: 'dish-row' + (d.available === false ? ' off' : ''), role: 'button', tabindex: 0,
        onclick: () => openEditor(d), onkeydown: (e) => { if (e.key === 'Enter') openEditor(d); } },
        el('img', { src: assetUrl(d.image), alt: '', loading: 'lazy' }),
        el('div', {}, el('strong', {}, d.name, d.model ? el('span', { class: 'pill ar' }, '3D') : null, d.featured ? el('span', { class: 'pill' }, 'Destaque') : null),
          el('span', { class: 'meta' }, formatPrice(d.price), (d.variants || []).length ? ` · ${(d.variants || []).length} grupo(s) de opções` : '')),
        sw);
      out.push(row);
    }
  }
  if (!out.length) out.push(el('p', { class: 'muted' }, 'Nenhum prato ainda. Toque em "+ Novo prato".'));
  $('#dish-list').replaceChildren(...out);
}
$('#dish-search').addEventListener('input', renderDishes);
$('#new-dish').onclick = () => openEditor(null);

// ================= EDITOR =================
const ed = $('#editor');
const edMv = $('#ed-mv');
let editing, pending;

function catOptions(sel) {
  return menu.categories.map((c) => el('option', { value: c.id, selected: c.id === sel }, c.name));
}

// o visualizador 3D só carrega quando o editor abre (o app abre mais rápido)
let viewerLoading;
function openEditor(d) {
  viewerLoading ??= import('../vendor/model-viewer.min.js');
  const isNew = !d;
  editing = d ? structuredClone(d) : {
    id: '', name: '', price: 0, category: menu.categories[0]?.id, description: '', ingredients: [], tags: [],
    serves: '', variants: [], available: true, featured: false,
    model3d: { type: 'template', template: 'prato', options: { parts: ['arroz', 'feijao', 'bife', 'fritas'] } },
  };
  pending = { glb: null, usdz: null, photo: null, photoDataUrl: null, modelChanged: false };
  $('#ed-title').textContent = isNew ? 'Novo prato' : d.name;
  $('#ed-name').value = editing.name;
  $('#ed-price').value = priceInput(editing.price);
  $('#ed-category').replaceChildren(...catOptions(editing.category));
  $('#ed-desc').value = editing.description || '';
  $('#ed-ingredients').value = (editing.ingredients || []).join(', ');
  $('#ed-serves').value = editing.serves || '';
  $('#ed-tags').value = (editing.tags || []).join(', ');
  $('#ed-featured').checked = !!editing.featured;
  $('#ed-available').checked = editing.available !== false;
  $('#ed-delete').hidden = isNew;
  $('#ed-photo').src = assetUrl(editing.image) || '';
  renderVariants();

  const spec = editing.model3d || {};
  const mode = editing.model && !editing.model3d ? 'file' : spec.type === 'photo' ? 'photo' : 'template';
  setMode(mode, false);
  $('#tpl-select').value = spec.template || 'prato';
  if (spec.type === 'photo') $('#photo-kind').value = spec.options?.kind || 'prato';
  renderTplOptions(spec.type === 'template' ? spec.options : null);
  setPreview(editing.model ? assetUrl(editing.model) : null);
  $('#ar-status').textContent = editing.model ? 'Modelo 3D atual carregado.' : '';
  if (isNew) regenerate();
  ed.showModal();
  $('#ed-form').scrollTop = 0;
}

function setPreview(src) {
  if (src) edMv.src = src; else edMv.removeAttribute('src');
  $('#ed-mv-empty').hidden = !!src;
}

// ---------- modos do 3D ----------
function setMode(mode, user = true) {
  $$('#ar-modes button').forEach((b) => b.setAttribute('aria-selected', b.dataset.mode === mode));
  $$('.ar-pane').forEach((p) => { p.hidden = p.dataset.pane !== mode; });
  if (user && mode === 'template') regenerate();
  if (user && mode === 'photo' && pending.photoDataUrl) regenerate();
}
$$('#ar-modes button').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
const currentMode = () => $('#ar-modes [aria-selected="true"]').dataset.mode;

$('#tpl-select').replaceChildren(...Object.entries(TEMPLATES).map(([k, t]) => el('option', { value: k }, t.label)));
$('#tpl-select').addEventListener('change', () => { renderTplOptions(null); regenerate(); });

function defaultsFor(tpl) {
  return { burger: { cheese: true, withFries: true }, prato: { parts: ['arroz', 'feijao', 'bife', 'fritas'] }, suco: { color: '#f39c12' }, refri: { color: '#3b1d0f' } }[tpl] || {};
}
function renderTplOptions(opts) {
  const tpl = $('#tpl-select').value;
  const o = opts || defaultsFor(tpl);
  const out = [];
  for (const [key, def] of Object.entries(TEMPLATES[tpl].options)) {
    const [kind, arg] = def.split(':');
    if (kind === 'bool') out.push(el('label', { class: 'check' }, el('input', { type: 'checkbox', 'data-opt': key, checked: !!o[key] }), arg));
    if (kind === 'select') {
      const pairs = arg.split(',').map((p) => p.split('='));
      out.push(el('label', { class: 'field' }, el('span', {}, key === 'size' ? 'Tamanho' : key === 'slice' ? 'Fruta na borda' : 'Sabor'),
        el('select', { 'data-opt': key }, pairs.map(([v, l]) => el('option', { value: v, selected: o[key] === v }, l)))));
    }
    if (kind === 'flavor') out.push(el('label', { class: 'field' }, el('span', {}, 'Sabor'),
      el('select', { 'data-opt': key }, Object.entries(FRAPPE_FLAVOR_LABELS).map(([v, l]) => el('option', { value: v, selected: o[key] === v }, l)))));
    if (kind === 'color') out.push(el('label', { class: 'field' }, el('span', {}, 'Cor da bebida'), el('input', { type: 'color', 'data-opt': key, value: o[key] || '#f39c12' })));
    if (kind === 'parts') out.push(el('p', { class: 'muted small' }, 'O que vai no prato:'), el('div', { class: 'parts' },
      Object.entries(PLATE_PART_LABELS).map(([v, l]) => el('label', { class: 'check' }, el('input', { type: 'checkbox', 'data-part': v, checked: (o.parts || []).includes(v) }), l))));
  }
  if (!out.length) out.push(el('p', { class: 'muted small' }, 'Este modelo não tem opções.'));
  $('#tpl-options').replaceChildren(...out);
}
function readTplOptions() {
  const o = {};
  $$('#tpl-options [data-opt]').forEach((i) => { o[i.dataset.opt] = i.type === 'checkbox' ? i.checked : i.value; });
  const parts = $$('#tpl-options [data-part]:checked').map((i) => i.dataset.part);
  if ($('#tpl-options [data-part]')) o.parts = parts;
  return o;
}
$('#tpl-options').addEventListener('change', () => regenerate());

let genTimer, genSeq = 0, lastUrl;
function regenerate() {
  clearTimeout(genTimer);
  genTimer = setTimeout(async () => {
    const seq = ++genSeq;
    const mode = currentMode();
    let spec;
    if (mode === 'template') spec = { type: 'template', template: $('#tpl-select').value, options: readTplOptions() };
    else if (mode === 'photo') {
      if (!pending.photoDataUrl) return;
      spec = { type: 'photo', options: { imageUrl: pending.photoDataUrl, kind: $('#photo-kind').value } };
    } else return;
    $('#ar-status').className = 'status'; $('#ar-status').textContent = 'Gerando 3D…';
    try {
      const obj = await buildModel(spec);
      const buf = await exportGLB(obj);
      if (seq !== genSeq) return;
      pending.glb = new Blob([buf], { type: 'model/gltf-binary' });
      pending.usdz = null;
      pending.modelChanged = true;
      editing.model3d = spec.type === 'photo' ? { type: 'photo', options: { kind: spec.options.kind } } : spec;
      if (lastUrl) URL.revokeObjectURL(lastUrl);
      lastUrl = URL.createObjectURL(pending.glb);
      setPreview(lastUrl);
      $('#ar-status').className = 'status ok';
      $('#ar-status').textContent = `3D pronto (${Math.round(pending.glb.size / 1024)} KB). Gire com o dedo para conferir.`;
    } catch (err) {
      $('#ar-status').className = 'status err'; $('#ar-status').textContent = 'Erro ao gerar o 3D: ' + err.message;
    }
  }, 250);
}

// Foto → 3D
async function resizeImage(file, max = 1200, type = 'image/jpeg') {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('Imagem inválida')); i.src = url; });
    const k = Math.min(1, max / Math.max(img.width, img.height));
    const c = el('canvas', { width: Math.round(img.width * k), height: Math.round(img.height * k) });
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise((res) => c.toBlob(res, type, 0.86));
    return { blob, dataUrl: c.toDataURL(type, 0.86) };
  } finally { URL.revokeObjectURL(url); }
}
$('#photo3d-input').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const { blob, dataUrl } = await resizeImage(f, 1024);
  pending.photoDataUrl = dataUrl;
  if (!editing.image && !pending.photo) { pending.photo = blob; $('#ed-photo').src = dataUrl; }
  regenerate(); e.target.value = '';
});
$('#photo-kind').addEventListener('change', () => pending.photoDataUrl && regenerate());

// Arquivo escaneado
$('#glb-input').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (!f) return;
  if (!/\.glb$/i.test(f.name)) { toast('Envie um arquivo .glb', true); return; }
  pending.glb = f; pending.modelChanged = true; editing.model3d = null;
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = URL.createObjectURL(f); setPreview(lastUrl);
  $('#ar-status').className = 'status ok'; $('#ar-status').textContent = `Arquivo carregado: ${f.name} (${Math.round(f.size / 1024)} KB)`;
  e.target.value = '';
});
$('#usdz-input').addEventListener('change', (e) => {
  const f = e.target.files[0]; if (!f) return;
  pending.usdz = f; toast('Arquivo .usdz pronto para salvar'); e.target.value = '';
});

// ---------- foto do cardápio ----------
$('#photo-input').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const { blob, dataUrl } = await resizeImage(f, 1000);
  pending.photo = blob; $('#ed-photo').src = dataUrl; e.target.value = '';
});
async function renderPhotoFrom3D() {
  if (!edMv.src || !edMv.loaded) { toast('Gere ou carregue o 3D primeiro', true); return null; }
  const shot = await edMv.toBlob({ mimeType: 'image/png', idealAspect: true });
  const img = await createImageBitmap(shot);
  const size = 800, c = el('canvas', { width: size, height: size }), g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size * 0.3, 0, size / 2, size * 0.3, size * 0.9);
  grd.addColorStop(0, '#fbf3e6'); grd.addColorStop(0.6, '#efdcc0'); grd.addColorStop(1, '#d9bd96');
  g.fillStyle = grd; g.fillRect(0, 0, size, size);
  const k = Math.max(size / img.width, size / img.height);
  g.drawImage(img, (size - img.width * k) / 2, (size - img.height * k) / 2, img.width * k, img.height * k);
  const blob = await new Promise((res) => c.toBlob(res, 'image/jpeg', 0.86));
  pending.photo = blob; $('#ed-photo').src = c.toDataURL('image/jpeg', 0.8);
  return blob;
}
$('#photo-from-3d').onclick = renderPhotoFrom3D;

// ---------- variações ----------
function renderVariants() {
  $('#ed-variants').replaceChildren(...(editing.variants || []).map((v, vi) => el('div', { class: 'variant-box' },
    el('div', { class: 'variant-head' },
      el('label', { class: 'field' }, el('span', {}, 'Nome do grupo'), el('input', { value: v.name, placeholder: 'Ex.: Tamanho', oninput: (e) => { v.name = e.target.value; } })),
      el('button', { type: 'button', class: 'rm', 'aria-label': 'Remover grupo', onclick: () => { editing.variants.splice(vi, 1); renderVariants(); } }, '🗑')),
    el('label', { class: 'check' }, el('input', { type: 'checkbox', checked: !!v.multiple, onchange: (e) => { v.multiple = e.target.checked; } }), 'Cliente pode escolher várias'),
    ...v.options.map((o, oi) => el('div', { class: 'opt-row' },
      el('input', { value: o.label, placeholder: 'Opção', 'aria-label': 'Nome da opção', oninput: (e) => { o.label = e.target.value; } }),
      el('input', { value: o.price ? priceInput(o.price) : '', placeholder: '+ R$', inputmode: 'decimal', 'aria-label': 'Preço adicional', oninput: (e) => { o.price = parsePrice(e.target.value); } }),
      el('button', { type: 'button', class: 'rm', 'aria-label': 'Remover opção', onclick: () => { v.options.splice(oi, 1); renderVariants(); } }, '✕'))),
    el('button', { type: 'button', class: 'btn small', onclick: () => { v.options.push({ label: '', price: 0 }); renderVariants(); } }, '+ Opção'))));
}
$('#add-variant').onclick = () => {
  editing.variants ||= [];
  editing.variants.push({ name: '', options: [{ label: '', price: 0 }, { label: '', price: 0 }] });
  renderVariants();
};

// ---------- salvar / excluir ----------
const extOf = (blob, fallback) => (blob.name?.split('.').pop() || { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[blob.type] || fallback).toLowerCase();

$('#ed-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#ed-name').value.trim();
  if (!name) { toast('Dê um nome ao prato', true); $('#ed-name').focus(); return; }
  const btn = $('#ed-save'); btn.disabled = true; btn.textContent = 'Salvando…';
  try {
    Object.assign(editing, {
      name, price: parsePrice($('#ed-price').value), category: $('#ed-category').value,
      description: $('#ed-desc').value.trim(),
      ingredients: $('#ed-ingredients').value.split(',').map((s) => s.trim()).filter(Boolean),
      tags: $('#ed-tags').value.split(',').map((s) => s.trim()).filter(Boolean),
      serves: $('#ed-serves').value.trim(), featured: $('#ed-featured').checked, available: $('#ed-available').checked,
    });
    editing.variants = (editing.variants || []).map((v) => ({ ...v, options: v.options.filter((o) => o.label.trim()) })).filter((v) => v.name.trim() && v.options.length);
    if (!editing.id) {
      let id = slug(name); while (menu.dishes.some((d) => d.id === id)) id = `${slug(name)}-${Math.random().toString(36).slice(2, 6)}`;
      editing.id = id;
    }
    if (pending.glb && pending.modelChanged) {
      editing.model = await uploadFile(pending.glb, 'glb');
      delete editing.modelIos;
    }
    if (pending.usdz) editing.modelIos = await uploadFile(pending.usdz, 'usdz');
    if (!pending.photo && !editing.image && editing.model) await renderPhotoFrom3D();
    if (pending.photo) editing.image = await uploadFile(pending.photo, extOf(pending.photo, 'jpg'));
    const i = menu.dishes.findIndex((d) => d.id === editing.id);
    if (i >= 0) menu.dishes[i] = editing; else menu.dishes.push(editing);
    if (await persist(`"${name}" salvo e publicado no cardápio`)) { ed.close(); renderDishes(); }
  } catch (err) {
    toast('Não salvou: ' + err.message, true);
  } finally { btn.disabled = false; btn.textContent = 'Salvar'; }
});

$('#ed-delete').onclick = async () => {
  if (!confirm(`Excluir "${editing.name}" do cardápio?`)) return;
  menu.dishes = menu.dishes.filter((d) => d.id !== editing.id);
  if (await persist('Prato excluído')) { ed.close(); renderDishes(); }
};
ed.addEventListener('click', (e) => { if (e.target.closest('[data-close]')) ed.close(); });

// ================= QR CODE =================
function qrDataUrl(text, cell = 8) {
  const q = window.qrcode(0, 'M'); q.addData(text); q.make();
  return q.createDataURL(cell, 2);
}
function tableUrl(base, n) {
  const u = new URL(base); if (n) u.searchParams.set('mesa', n); return u.href;
}
let qrReady = false;
async function initQr() {
  if (!qrReady) { $('#qr-url').value = await menuPublicUrl(); qrReady = true; }
  renderQr();
}
function renderQr() {
  const base = $('#qr-url').value.trim();
  const hint = $('#qr-url-hint');
  let valid = true;
  try { new URL(base); } catch { valid = false; }
  hint.textContent = !valid ? 'Digite um endereço válido (começando com http).'
    : /localhost|127\.0\.0\.1/.test(base) ? 'Atenção: "localhost" só abre neste aparelho. Use o IP da rede (mesma Wi-Fi) ou o endereço da Vercel.'
      : base.startsWith('http://') ? 'Dica: para a realidade aumentada funcionar em todos os celulares, use um endereço https (ex.: Vercel).' : '';
  if (!valid) { $('#qr-grid').replaceChildren(); return; }
  const n = Math.max(0, Math.min(80, parseInt($('#qr-tables').value, 10) || 0));
  const label = $('#qr-label').value;
  const name = menu.restaurant?.name || 'Cardápio 3D';
  const cards = [{ n: 0 }, ...Array.from({ length: n }, (_, i) => ({ n: i + 1 }))].map(({ n: t }) => el('div', { class: 'qr-card' },
    el('span', {}, name), el('img', { src: qrDataUrl(tableUrl(base, t)), alt: `QR Code ${t ? 'da mesa ' + t : 'do cardápio'}` }),
    el('strong', {}, t ? `Mesa ${t}` : 'Cardápio'), el('span', {}, label)));
  $('#qr-grid').replaceChildren(...cards);
}
['input', 'change'].forEach((ev) => {
  $('#qr-url').addEventListener(ev, () => { const s = getSettings(); s.publicMenuUrl = $('#qr-url').value.trim(); saveSettings(s); renderQr(); });
  $('#qr-tables').addEventListener(ev, renderQr);
  $('#qr-label').addEventListener(ev, renderQr);
});
$('#qr-print').onclick = () => { $('#print-area').replaceChildren(...$$('#qr-grid .qr-card').map((c) => c.cloneNode(true))); print(); };
$('#qr-download').onclick = async () => {
  const base = $('#qr-url').value.trim(); if (!base) return;
  const img = new Image(); img.src = qrDataUrl(base, 16); await img.decode();
  const c = el('canvas', { width: 900, height: 1100 }), g = c.getContext('2d');
  g.fillStyle = '#fffdf9'; g.fillRect(0, 0, 900, 1100);
  g.fillStyle = '#2a1f17'; g.textAlign = 'center';
  g.font = '600 64px Georgia, serif'; g.fillText(menu.restaurant?.name || 'Cardápio 3D', 450, 120);
  g.imageSmoothingEnabled = false; g.drawImage(img, 150, 180, 600, 600);
  g.font = '500 40px system-ui, sans-serif'; g.fillText($('#qr-label').value, 450, 870);
  g.fillStyle = '#7a6a5b'; g.font = '28px system-ui, sans-serif'; g.fillText('Aponte a câmera do celular', 450, 930);
  const a = el('a', { href: c.toDataURL('image/png'), download: 'qrcode-cardapio.png' }); a.click();
};

// ================= AJUSTES =================
function renderRestaurant() {
  const f = $('#restaurant-form');
  for (const k of ['name', 'tagline', 'address', 'whatsapp']) f.elements[k].value = menu.restaurant?.[k] || '';
}
$('#restaurant-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  menu.restaurant = { ...menu.restaurant, name: f.elements.name.value.trim(), tagline: f.elements.tagline.value.trim(), address: f.elements.address.value.trim(), whatsapp: f.elements.whatsapp.value.replace(/\D/g, '') };
  await persist('Dados do restaurante salvos');
});

function renderCats() {
  $('#cat-list').replaceChildren(...menu.categories.map((c, i) => el('li', {},
    el('input', { value: c.name, 'aria-label': 'Nome da categoria', onchange: async (e) => { c.name = e.target.value.trim() || c.name; await persist('Categoria renomeada'); renderDishes(); } }),
    el('button', { type: 'button', 'aria-label': 'Subir', disabled: i === 0, onclick: async () => { menu.categories.splice(i - 1, 0, menu.categories.splice(i, 1)[0]); renderCats(); await persist('Ordem salva'); renderDishes(); } }, '↑'),
    el('button', { type: 'button', 'aria-label': 'Descer', disabled: i === menu.categories.length - 1, onclick: async () => { menu.categories.splice(i + 1, 0, menu.categories.splice(i, 1)[0]); renderCats(); await persist('Ordem salva'); renderDishes(); } }, '↓'),
    el('button', { type: 'button', 'aria-label': `Excluir ${c.name}`, onclick: async () => {
      const n = menu.dishes.filter((d) => d.category === c.id).length;
      if (n) { toast(`Mova ou exclua os ${n} prato(s) dessa categoria antes`, true); return; }
      menu.categories.splice(i, 1); renderCats(); await persist('Categoria excluída');
    } }, '✕'))));
}
$('#cat-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const name = $('#cat-new').value.trim(); if (!name) return;
  let id = slug(name); while (menu.categories.some((c) => c.id === id)) id += '-2';
  menu.categories.push({ id, name }); $('#cat-new').value = '';
  renderCats(); await persist('Categoria criada');
});

function fillConnForm() {
  const s = getSettings(), f = $('#conn-form');
  for (const k of ['backend', 'serverUrl', 'supabaseUrl', 'supabaseAnonKey', 'publicMenuUrl']) f.elements[k].value = s[k] || '';
  $('#conn-status').textContent = `Agora: ${backendOf(s) === 'supabase' ? 'nuvem (Supabase)' : 'servidor local'}.`;
  $('#reset-menu').hidden = backendOf(s) !== 'local';
}
$('#conn-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = e.target, s = getSettings();
  for (const k of ['backend', 'serverUrl', 'supabaseUrl', 'supabaseAnonKey', 'publicMenuUrl']) s[k] = f.elements[k].value.trim();
  saveSettings(s);
  toast('Conexão salva');
  setTimeout(() => location.reload(), 600);
});
$('#reset-menu').onclick = async () => {
  if (!confirm('Apagar as alterações e voltar ao cardápio de exemplo?')) return;
  try { await resetLocalMenu(); toast('Cardápio de exemplo restaurado'); setTimeout(() => location.reload(), 600); } catch (err) { toast(err.message, true); }
};
$('#logout').onclick = async () => { await logout(); location.reload(); };

// ================= INÍCIO =================
if (await isLoggedIn()) await startApp().catch(() => showLogin());
else showLogin();
