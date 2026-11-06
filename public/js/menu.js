// Cardápio do cliente: lista os pratos e abre o visualizador 3D / realidade aumentada.
import { loadMenu, assetUrl, formatPrice } from './store.js';

const $ = (s, el = document) => el.querySelector(s);
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') n.className = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) n.setAttribute(k, v === true ? '' : v);
  }
  n.append(...kids.flat().filter((k) => k != null && k !== false));
  return n;
};
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const params = new URLSearchParams(location.search);
const table = params.get('mesa');
let menu, currency = 'BRL';
const LIST_KEY = 'cardapio3d.lista';
let list = [];
try { list = JSON.parse(sessionStorage.getItem(LIST_KEY) || '[]'); } catch { list = []; }

const ICON_3D = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M12 2 3 7v10l9 5 9-5V7l-9-5Zm0 2.3L18.7 8 12 11.7 5.3 8 12 4.3ZM5 9.7l6 3.3v6.6l-6-3.3V9.7Zm8 9.9V13l6-3.3v6.6l-6 3.3Z" fill="currentColor"/></svg>';

function tagEl(t) { return el('span', { class: /mais pedido|da casa|clássico/i.test(t) ? 'tag hot' : 'tag' }, t); }

function card(d) {
  const thumb = el('div', { class: 'thumb' }, el('img', { src: assetUrl(d.image), alt: '', loading: 'lazy', width: 112, height: 112 }));
  if (d.model) { const b = el('span', { class: 'badge3d' }); b.innerHTML = ICON_3D + ' 3D'; thumb.append(b); }
  return el('button', { class: 'card', onclick: () => openDish(d), 'aria-label': `${d.name}, ${formatPrice(d.price, currency)}` },
    el('div', {},
      el('h3', {}, d.name),
      el('p', { class: 'desc' }, d.description),
      el('div', { class: 'row' }, el('p', { class: 'price' }, formatPrice(d.price, currency)), ...(d.tags || []).slice(0, 2).map(tagEl))),
    thumb);
}

function render() {
  const q = norm($('#search').value);
  const visible = menu.dishes.filter((d) => d.available !== false && (!q || norm([d.name, d.description, ...(d.ingredients || [])].join(' ')).includes(q)));
  const feat = menu.dishes.filter((d) => d.featured && d.available !== false);
  $('#featured-wrap').hidden = !!q || !feat.length;
  $('#featured').replaceChildren(...feat.map((d) => el('button', { class: 'feat', onclick: () => openDish(d) },
    el('img', { src: assetUrl(d.image), alt: '', loading: 'lazy' }),
    el('div', { class: 'feat-body' }, el('strong', {}, d.name), el('span', { class: 'price' }, formatPrice(d.price, currency))))));

  const sections = menu.categories.map((c) => {
    const items = visible.filter((d) => d.category === c.id);
    if (!items.length) return null;
    return el('section', { class: 'cat', id: 'cat-' + c.id, 'data-cat': c.id },
      el('h2', {}, c.name), el('div', { class: 'grid' }, items.map(card)));
  }).filter(Boolean);
  $('#sections').replaceChildren(...sections);
  $('#empty').hidden = sections.length > 0;
  $('#chips').replaceChildren(...sections.map((s) => {
    const c = menu.categories.find((x) => x.id === s.dataset.cat);
    return el('button', { class: 'chip', role: 'tab', 'aria-selected': 'false', 'data-cat': c.id,
      onclick: () => document.getElementById('cat-' + c.id).scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }) }, c.name);
  }));
  spy();
}

// Destaca a categoria visível na barra de chips.
let observer;
function spy() {
  observer?.disconnect();
  observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      const id = e.target.dataset.cat;
      for (const chip of document.querySelectorAll('.chip')) {
        const on = chip.dataset.cat === id;
        chip.setAttribute('aria-selected', on);
        if (on) chip.scrollIntoView({ block: 'nearest', inline: 'center' });
      }
    }
  }, { rootMargin: '-140px 0px -60% 0px' });
  document.querySelectorAll('.cat').forEach((s) => observer.observe(s));
}

// ---------- detalhe ----------
const dlg = $('#dish');
const mv = $('#mv');
let current, qty = 1;

function selectedOptions() {
  const out = [];
  (current.variants || []).forEach((v, vi) => {
    document.querySelectorAll(`[name="v${vi}"]:checked`).forEach((inp) => out.push({ group: v.name, ...v.options[+inp.value] }));
  });
  return out;
}
function unitPrice() { return current.price + selectedOptions().reduce((s, o) => s + (o.price || 0), 0); }
function updatePrice() {
  $('#dish-price').textContent = formatPrice(unitPrice() * qty, currency);
  $('#qty').textContent = qty;
  const withModel = selectedOptions().find((o) => o.model);
  const src = assetUrl(withModel?.model || current.model);
  if (src && mv.getAttribute('src') !== src) mv.src = src;
  if (current.modelIos && !withModel) mv.setAttribute('ios-src', assetUrl(current.modelIos)); else mv.removeAttribute('ios-src');
}

function openDish(d) {
  current = d; qty = 1;
  $('#dish-name').textContent = d.name;
  $('#dish-desc').textContent = d.description || '';
  $('#dish-tags').replaceChildren(...(d.tags || []).map(tagEl));
  $('#dish-ingredients').replaceChildren(...(d.ingredients || []).map((i) => el('li', {}, i)));
  $('#dish-ing-title').hidden = !(d.ingredients || []).length;
  $('#dish-serves').textContent = d.serves ? `Serve: ${d.serves}` : '';
  $('#dish-note').value = '';
  $('#dish-variants').replaceChildren(...(d.variants || []).map((v, vi) => el('fieldset', { class: 'variant' },
    el('legend', {}, v.name, ' ', el('small', {}, v.multiple ? '(opcional, escolha quantos quiser)' : '')),
    el('div', { class: 'opts' }, v.options.map((o, oi) => el('label', { class: 'opt' },
      el('input', { type: v.multiple ? 'checkbox' : 'radio', name: 'v' + vi, value: oi, checked: !v.multiple && oi === 0, onchange: updatePrice }),
      el('span', {}, o.label, o.price ? el('em', {}, (o.price > 0 ? '+' : '−') + formatPrice(Math.abs(o.price), currency)) : null)))))));
  mv.alt = `Modelo 3D de ${d.name}`;
  mv.poster = assetUrl(d.image);
  mv.removeAttribute('src');
  updatePrice();
  dlg.showModal();
  dlg.querySelector('.sheet-body').scrollTop = 0;
  history.pushState({ dish: d.id }, '', '#' + d.id);
}

mv.addEventListener('progress', (e) => { $('.mv-progress span').style.width = `${e.detail.totalProgress * 100}%`; if (e.detail.totalProgress === 1) setTimeout(() => { $('.mv-progress span').style.width = 0; }, 300); });
mv.addEventListener('load', () => {
  $('#viewer-hint').textContent = mv.canActivateAR ? 'Arraste para girar · toque em "Ver na mesa"' : 'Arraste para girar · abra no celular para ver na mesa';
});

$('#qty-minus').onclick = () => { qty = Math.max(1, qty - 1); updatePrice(); };
$('#qty-plus').onclick = () => { qty = Math.min(20, qty + 1); updatePrice(); };
$('#add-btn').onclick = () => {
  list.push({ id: current.id, name: current.name, qty, unit: unitPrice(), options: selectedOptions().map((o) => o.label), note: $('#dish-note').value.trim() });
  saveList(); dlg.close();
};

for (const d of document.querySelectorAll('dialog')) {
  d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
}
dlg.addEventListener('close', () => { if (location.hash) history.replaceState(null, '', location.pathname + location.search); });
addEventListener('popstate', () => { if (dlg.open) dlg.close(); });

// ---------- minha lista ----------
function saveList() {
  try { sessionStorage.setItem(LIST_KEY, JSON.stringify(list)); } catch { /* sem storage */ }
  renderList();
}
function renderList() {
  const count = list.reduce((s, i) => s + i.qty, 0);
  const total = list.reduce((s, i) => s + i.qty * i.unit, 0);
  $('#list-bar').hidden = !count;
  $('#list-count').textContent = count;
  $('#list-total').textContent = $('#list-total-2').textContent = formatPrice(total, currency);
  $('#list-table').textContent = table ? `Mesa ${table}` : '';
  $('#list-items').replaceChildren(...list.map((i, idx) => el('li', {},
    el('div', { class: 'li-name' }, `${i.qty}× ${i.name}`, el('small', {}, [...i.options, i.note && `Obs.: ${i.note}`].filter(Boolean).join(' · '))),
    el('span', {}, formatPrice(i.qty * i.unit, currency)),
    el('button', { class: 'rm', 'aria-label': `Remover ${i.name}`, onclick: () => { list.splice(idx, 1); saveList(); if (!list.length) $('#list').close(); } }, '✕'))));
  const phone = (menu?.restaurant?.whatsapp || '').replace(/\D/g, '');
  const wa = $('#list-whats');
  wa.hidden = !phone || !count;
  if (phone) {
    const text = [`Pedido${table ? ' · Mesa ' + table : ''}`, ...list.map((i) => `${i.qty}x ${i.name}${i.options.length ? ' (' + i.options.join(', ') + ')' : ''}${i.note ? ' – ' + i.note : ''}`), `Total: ${formatPrice(total, currency)}`].join('\n');
    wa.href = `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
  }
}
$('#list-bar').onclick = () => $('#list').showModal();
$('#list-clear').onclick = () => { list = []; saveList(); $('#list').close(); };

// ---------- início ----------
$('#search').addEventListener('input', render);
if (table) { const b = $('#table-badge'); b.hidden = false; b.textContent = `Mesa ${table}`; }

const { menu: data } = await loadMenu();
menu = data;
currency = menu.restaurant?.currency || 'BRL';
document.title = menu.restaurant?.name || 'Cardápio 3D';
$('#restaurant-name').textContent = menu.restaurant?.name || 'Cardápio 3D';
$('#restaurant-tagline').textContent = menu.restaurant?.tagline || '';
$('#hero-address').textContent = menu.restaurant?.address || '';
render();
renderList();
const deep = menu.dishes.find((d) => '#' + d.id === location.hash);
if (deep) openDish(deep);
