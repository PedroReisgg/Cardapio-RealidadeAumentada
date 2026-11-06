// Cardápio do cliente: lista os pratos, abre o detalhe e mostra o prato em 3D / na mesa (realidade aumentada).
import { loadMenu, watchMenu, assetUrl, formatPrice, SITE_ROOT } from './store.js';

const $ = (s, root = document) => root.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids.flat().filter((k) => k != null && k !== false));
  return n;
};
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const pad = (n) => String(n).padStart(2, '0');

const params = new URLSearchParams(location.search);
const table = (params.get('mesa') || '').slice(0, 12);
let menu, currency = 'BRL';
const price = (v) => formatPrice(v, currency);

const ICON_3D = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9L12 3Zm0 2.2 5.8 3.3L12 11.8 6.2 8.5 12 5.2ZM6 10.2l5 2.8v5.6l-5-2.8v-5.6Zm7 8.4V13l5-2.8v5.6l-5 2.8Z" fill="currentColor"/></svg>';
const chip3d = () => el('span', { class: 'chip3d', html: ICON_3D + '3D' });

// ---------- aviso rápido ----------
let toastT;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), 2200);
}

// ---------- lista do cardápio ----------
const visibleDishes = () => menu.dishes.filter((d) => d.available !== false);

function item(d) {
  return el('button', { class: 'item', type: 'button', onclick: () => openDish(d), 'aria-label': `${d.name}, ${price(d.price)}` },
    el('div', {},
      el('p', { class: 'item-name' }, el('strong', {}, d.name)),
      d.description ? el('p', { class: 'item-desc' }, d.description) : null,
      el('div', { class: 'item-meta' }, el('span', { class: 'price' }, price(d.price)), (d.tags || [])[0] ? el('span', { class: 'tag' }, d.tags[0]) : null)),
    el('div', { class: 'item-thumb' },
      d.image ? el('img', { src: assetUrl(d.image), alt: '', loading: 'lazy', decoding: 'async', width: 92, height: 92 }) : null,
      d.model ? chip3d() : null));
}

function renderSignature() {
  const feat = visibleDishes().filter((d) => d.featured);
  $('#signature').hidden = !feat.length || !!norm($('#search').value);
  $('#sig-row').replaceChildren(...feat.map((d) => el('button', { class: 'sig', type: 'button', onclick: () => openDish(d), 'aria-label': `${d.name}, ${price(d.price)}` },
    d.image ? el('img', { src: assetUrl(d.image), alt: '', loading: 'lazy', decoding: 'async' }) : null,
    d.model ? chip3d() : null,
    el('div', { class: 'sig-body' }, el('strong', {}, d.name), el('span', {}, price(d.price))))));
}

let sections = []; // [{ id, el, link }]
function render() {
  const q = norm($('#search').value);
  const dishes = visibleDishes().filter((d) => !q || norm([d.name, d.description, ...(d.ingredients || []), ...(d.tags || [])].join(' ')).includes(q));
  let n = 0;
  const secs = menu.categories.map((c) => {
    const items = dishes.filter((d) => d.category === c.id);
    if (!items.length) return null;
    n++;
    return el('section', { class: 'cat-sec', id: 'cat-' + c.id, 'data-cat': c.id, 'aria-labelledby': 'h-' + c.id },
      el('header', { class: 'cat-head' },
        el('span', { class: 'num' }, pad(n)), el('h2', { id: 'h-' + c.id }, c.name),
        el('span', { class: 'count' }, `${items.length} ${items.length > 1 ? 'opções' : 'opção'}`)),
      items.map(item));
  }).filter(Boolean);
  $('#sections').replaceChildren(...secs);
  $('#empty').hidden = secs.length > 0;
  renderSignature();

  const links = secs.map((s) => {
    const c = menu.categories.find((x) => x.id === s.dataset.cat);
    return el('a', { class: 'cat-link', href: '#cat-' + c.id, 'data-cat': c.id, onclick: (e) => { e.preventDefault(); goTo(c.id); } }, c.name);
  });
  $('#cats').replaceChildren(...links);
  sections = secs.map((s, i) => ({ id: s.dataset.cat, el: s, link: links[i] }));
  active = null;
  spy();
}

// ---------- navegação entre categorias (sem travar) ----------
// O travamento vinha de rolar a barra de categorias com scrollIntoView enquanto a página rolava:
// isso interrompia a rolagem da página. Agora a barra rola sozinha (scrollLeft) e a página só rola quando você toca.
const nav = $('#catnav');
let active = null, navLock = 0, lockTimer;

function setActive(id) {
  if (id === active) return;
  active = id;
  for (const s of sections) s.link.setAttribute('aria-current', s.id === id ? 'true' : 'false');
  const link = sections.find((s) => s.id === id)?.link;
  if (!link) return;
  const cats = $('#cats');
  const left = link.offsetLeft - (cats.clientWidth - link.offsetWidth) / 2;
  cats.scrollTo({ left: Math.max(0, left), behavior: reduceMotion() ? 'auto' : 'smooth' });
}

function unlock() { navLock = 0; clearTimeout(lockTimer); }
function goTo(id) {
  const s = sections.find((x) => x.id === id);
  if (!s) return;
  setActive(id);
  const top = s.el.getBoundingClientRect().top + scrollY - nav.offsetHeight + 1;
  navLock = 1;
  clearTimeout(lockTimer);
  lockTimer = setTimeout(unlock, 1200);
  scrollTo({ top, behavior: reduceMotion() ? 'auto' : 'smooth' });
}
addEventListener('scrollend', unlock);
// se o cliente tocar na tela durante a rolagem, ele manda
addEventListener('touchstart', unlock, { passive: true });
addEventListener('wheel', unlock, { passive: true });

let spyQueued = false;
function spy() {
  spyQueued = false;
  if (navLock || !sections.length) return;
  const line = nav.offsetHeight + 80;
  let cur = sections[0].id;
  for (const s of sections) { if (s.el.getBoundingClientRect().top <= line) cur = s.id; else break; }
  // chegou no fim da página: marca a última
  if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) cur = sections.at(-1).id;
  setActive(cur);
}
addEventListener('scroll', () => { if (!spyQueued) { spyQueued = true; requestAnimationFrame(spy); } }, { passive: true });

// ---------- busca ----------
$('#search-toggle').onclick = () => {
  const row = $('#search-row');
  row.hidden = !row.hidden;
  $('#search-toggle').setAttribute('aria-expanded', String(!row.hidden));
  if (!row.hidden) {
    const top = nav.getBoundingClientRect().top + scrollY;
    if (scrollY < top) scrollTo({ top, behavior: 'auto' });
    $('#search').focus({ preventScroll: true });
  } else if ($('#search').value) { $('#search').value = ''; render(); }
};
let searchT;
$('#search').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(render, 120); });
$('#search').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); });

// ---------- detalhe do prato ----------
const dlg = $('#dish');
let current = null, qty = 1, view = 'photo';

function selectedOptions() {
  const out = [];
  (current.variants || []).forEach((v, vi) => {
    dlg.querySelectorAll(`[name="v${vi}"]:checked`).forEach((inp) => out.push({ group: v.name, ...v.options[+inp.value] }));
  });
  return out;
}
const unitPrice = () => current.price + selectedOptions().reduce((s, o) => s + (o.price || 0), 0);
const currentModel = () => selectedOptions().find((o) => o.model)?.model || current.model;

function update() {
  $('#qty').textContent = qty;
  $('#add-price').textContent = '· ' + price(unitPrice() * qty);
  $('#d-price').textContent = price(unitPrice());
  if (view === '3d') show3D();
}

function openDish(d, { push = true } = {}) {
  current = d; qty = 1;
  $('#d-name').textContent = d.name;
  $('#d-desc').textContent = d.description || '';
  $('#d-tags').replaceChildren(...(d.tags || []).map((t) => el('span', { class: 'tag' }, t)));
  $('#d-ing').textContent = (d.ingredients || []).join(' · ');
  $('#d-ing-wrap').hidden = !(d.ingredients || []).length;
  $('#d-serves').textContent = d.serves ? `Porção · ${d.serves}` : '';
  $('#d-note').value = '';
  $('#d-photo').src = assetUrl(d.image);
  $('#d-photo').alt = `Foto de ${d.name}`;
  $('#d-variants').replaceChildren(...(d.variants || []).map((v, vi) => el('fieldset', { class: 'variant' },
    el('legend', {}, v.name, v.multiple ? el('small', {}, ' · opcional') : null),
    el('div', { class: 'opts' }, v.options.map((o, oi) => el('label', { class: 'opt' },
      el('input', { type: v.multiple ? 'checkbox' : 'radio', name: 'v' + vi, value: oi, checked: !v.multiple && oi === 0, onchange: update }),
      el('span', {}, o.label, o.price ? el('em', {}, (o.price > 0 ? '+' : '−') + price(Math.abs(o.price))) : null)))))));
  $('#ar-cta').hidden = !d.model;
  dlg.querySelector('.media-switch').hidden = !d.model;
  setView('photo');
  update();
  if (!dlg.open) dlg.showModal();
  $('#dish-scroll').scrollTop = 0;
  if (push) history.pushState({ dish: d.id }, '', '#' + d.id);
  // deixa pronto para abrir a câmera rápido
  if (d.model && arMode === 'webxr') loadAR();
  else if (d.model && arMode !== 'none') loadViewer();
}

// visualizador 3D (só carrega quando o cliente pede)
let viewerReady, mv;
function loadViewer() {
  viewerReady ??= import('../vendor/model-viewer.min.js').then(() => {
    mv = el('model-viewer', {
      'camera-controls': true, 'touch-action': 'pan-y', 'auto-rotate': true, 'auto-rotate-delay': 800, 'rotation-per-second': '20deg',
      'shadow-intensity': 1, 'shadow-softness': 0.9, exposure: 1.05, 'environment-image': 'neutral', 'interaction-prompt': 'none',
      'camera-orbit': '20deg 62deg auto', 'min-camera-orbit': 'auto 0deg auto', 'max-camera-orbit': 'auto 85deg auto',
      ar: true, 'ar-modes': 'webxr scene-viewer quick-look', 'ar-scale': 'fixed', 'ar-placement': 'floor',
    });
    $('#d-3d').append(mv);
    return mv;
  });
  return viewerReady;
}
async function show3D() {
  const m = await loadViewer();
  const src = assetUrl(currentModel());
  if (m.getAttribute('src') !== src) m.src = src;
  m.alt = `Modelo 3D de ${current.name}`;
}
function setView(v) {
  view = v;
  for (const b of dlg.querySelectorAll('[data-view]')) b.setAttribute('aria-selected', String(b.dataset.view === v));
  $('#d-photo').hidden = v !== 'photo';
  $('#d-3d').hidden = v !== '3d';
  if (v === '3d') show3D();
}
for (const b of dlg.querySelectorAll('[data-view]')) b.onclick = () => setView(b.dataset.view);

$('#qty-minus').onclick = () => { qty = Math.max(1, qty - 1); update(); };
$('#qty-plus').onclick = () => { qty = Math.min(20, qty + 1); update(); };
$('#add-btn').onclick = () => {
  list.push({ id: current.id, name: current.name, qty, unit: unitPrice(), options: selectedOptions().map((o) => o.label), note: $('#d-note').value.trim() });
  saveList();
  closeDish();
  toast(`${qty}× ${current.name} na sua lista`);
};
function closeDish() { if (dlg.open) dlg.close(); }

for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
}
let keepHash = false;
dlg.addEventListener('close', () => {
  mv?.pause?.();
  if (!keepHash && location.hash) history.replaceState(null, '', location.pathname + location.search);
});
addEventListener('popstate', () => { if (dlg.open) { keepHash = true; dlg.close(); keepHash = false; } });

// ---------- realidade aumentada ----------
// Descobre o que o celular aceita sem baixar o 3D (o three.js só carrega quando a câmera abre).
const isIOS = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
async function arSupport() {
  try { if (navigator.xr && await navigator.xr.isSessionSupported('immersive-ar')) return 'webxr'; } catch { /* sem WebXR */ }
  if (isIOS() && document.createElement('a').relList?.supports?.('ar')) return 'quicklook';
  if (/Android/i.test(navigator.userAgent)) return 'sceneviewer';
  return 'none';
}
let arMode = 'none', arModule;
const loadAR = () => (arModule ??= import('./ar.js'));
const arReady = arSupport().then((m) => { arMode = m; return m; });
let arIntroSeen = false;
try { arIntroSeen = sessionStorage.getItem('cardapio3d.arIntro') === '1'; } catch { /* sem storage */ }

const NOTES = {
  webxr: 'A câmera mostra a porcentagem da leitura e para onde mover. Quando chegar a 100%, o prato aparece sozinho.',
  quicklook: 'No iPhone, a câmera da Apple mostra as instruções. Mova devagar até o prato aparecer na mesa.',
  sceneviewer: 'O Android vai abrir a câmera. Mova devagar até o prato aparecer na mesa.',
};

$('#ar-cta').onclick = async () => {
  const mode = await arReady;
  if (mode === 'none') return showQR();
  if (mode === 'webxr' && arIntroSeen) return startAR();
  $('#ar-intro-note').textContent = NOTES[mode];
  if (mode !== 'webxr') loadViewer().then(show3D);
  else fetch(assetUrl(currentModel())).catch(() => {}); // já baixa o modelo enquanto o cliente lê
  $('#ar-intro').showModal();
};
$('#how-btn').onclick = async () => {
  const mode = await arReady;
  $('#ar-intro-note').textContent = mode === 'none'
    ? 'No computador não dá para abrir a câmera na mesa. Abra este cardápio no celular.'
    : NOTES[mode];
  $('#ar-start').hidden = true;
  $('#ar-intro').showModal();
};
$('#ar-intro').addEventListener('close', () => { $('#ar-start').hidden = false; });
$('#ar-start').onclick = () => {
  $('#ar-intro').close();
  arIntroSeen = true;
  try { sessionStorage.setItem('cardapio3d.arIntro', '1'); } catch { /* sem storage */ }
  startAR();
};

async function startAR() {
  const mode = arMode;
  if (mode === 'webxr') {
    const dish = current;
    const { startWebXR } = await loadAR();
    try {
      keepHash = true; closeDish(); keepHash = false;
      await startWebXR({ modelUrl: assetUrl(currentModel()), name: dish.name, onEnd: () => openDish(dish, { push: false }) });
    } catch (err) {
      openDish(dish, { push: false });
      if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
        toast('Libere a câmera para ver o prato na mesa');
        return;
      }
      console.warn('WebXR falhou, usando o visualizador do Android:', err);
      arMode = 'sceneviewer';
      toast('Abrindo a câmera do Android…');
      await nativeAR();
    }
    return;
  }
  return nativeAR();
}
async function nativeAR() {
  await show3D();
  if (mv.canActivateAR) mv.activateAR();
  else toast('Seu celular não abriu a câmera. Tente pelo Chrome ou Safari.');
}

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = el('script', { src });
    s.onload = res; s.onerror = rej;
    document.head.append(s);
  });
}
let qrLib;
async function showQR() {
  qrLib ??= window.qrcode ? Promise.resolve() : loadScript(new URL('vendor/qrcode.js', SITE_ROOT).href);
  await qrLib;
  const url = location.href.split('#')[0] + '#' + current.id;
  const q = window.qrcode(0, 'M'); q.addData(url); q.make();
  $('#ar-qr').src = q.createDataURL(8, 2);
  $('#ar-desktop').showModal();
}

// ---------- minha lista ----------
const LIST_KEY = 'cardapio3d.lista';
let list = [];
try { list = JSON.parse(sessionStorage.getItem(LIST_KEY) || '[]'); } catch { list = []; }

function saveList() {
  try { sessionStorage.setItem(LIST_KEY, JSON.stringify(list)); } catch { /* sem storage */ }
  renderList();
}
function renderList() {
  const count = list.reduce((s, i) => s + i.qty, 0);
  const total = list.reduce((s, i) => s + i.qty * i.unit, 0);
  $('#list-bar').hidden = !count;
  $('#list-badge').hidden = !count;
  $('#list-badge').textContent = count;
  $('#list-count').textContent = count;
  $('#list-total').textContent = $('#list-total-2').textContent = price(total);
  $('#list-table').textContent = table ? `Mesa ${table}` : 'Seu pedido';
  $('#list-items').replaceChildren(...(list.length ? list.map((i, idx) => el('li', {},
    el('div', { class: 'li-name' }, `${i.qty}× ${i.name}`, el('small', {}, [...i.options, i.note && `Obs.: ${i.note}`].filter(Boolean).join(' · '))),
    el('span', {}, price(i.qty * i.unit)),
    el('button', { class: 'rm', type: 'button', 'aria-label': `Remover ${i.name}`, onclick: () => { list.splice(idx, 1); saveList(); } }, '✕')))
    : [el('li', { class: 'muted' }, 'Sua lista está vazia. Toque num prato para adicionar.')]));
  $('#list-clear').hidden = !count;
  const phone = (menu?.restaurant?.whatsapp || '').replace(/\D/g, '');
  const wa = $('#list-whats');
  wa.hidden = !phone || !count;
  $('#list-close').hidden = !wa.hidden;
  if (phone) {
    const text = [`Pedido${table ? ' · Mesa ' + table : ''}`, ...list.map((i) => `${i.qty}x ${i.name}${i.options.length ? ' (' + i.options.join(', ') + ')' : ''}${i.note ? ' – ' + i.note : ''}`), `Total: ${price(total)}`].join('\n');
    wa.href = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  }
}
const openList = () => $('#list').showModal();
$('#list-bar').onclick = openList;
$('#open-list').onclick = openList;
$('#list-clear').onclick = () => { list = []; saveList(); $('#list').close(); };

// ---------- início ----------
if (table) { const p = $('#table-pill'); p.hidden = false; p.textContent = `Mesa ${table}`; }

const { menu: data } = await loadMenu();
menu = data;
const r = menu.restaurant || {};
currency = r.currency || 'BRL';
const name = r.name || 'Cardápio 3D';
document.title = name;
$('#brand-name').textContent = name;
$('.footer .brand-name').textContent = name;
$('.brand-mark').textContent = name.split(/\s+/).map((w) => w[0]).join('').slice(0, 3).toUpperCase();
if (r.tagline) $('#hero-sub').textContent = r.tagline;
if (r.hero) $('#hero-img').src = assetUrl(r.hero);
if (r.aboutImage) $('#about-img').src = assetUrl(r.aboutImage);
if (r.about) $('#about-copy').textContent = r.about;
$('#footer-address').textContent = r.address || '';
render();
renderList();
const deep = menu.dishes.find((d) => '#' + d.id === location.hash);
if (deep) openDish(deep, { push: false });
// o dono salvou no app: atualiza o cardápio na hora
watchMenu((m) => { menu = m; currency = m.restaurant?.currency || currency; render(); renderList(); }).catch(() => {});
