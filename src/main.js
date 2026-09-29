import * as THREE from 'three';
import { createStage } from './scene.js';
import { buildProceduralHelmet, loadHelmetModel, applyBase, FINISHES, VISORS, UNIT_CM } from './helmet.js';
import { AssetStore, newId, svgToDataUrl } from './assets.js';
import { DecalLayers, mirrorPlacement } from './decals.js';
import { PRESET_CATEGORIES, PRESETS, TEXT_PRESETS, FONTS } from './presets.js';
import { History } from './history.js';
import { renderProductionSheet, sheetSummary } from './printsheet.js';
import { quote, money, PRICING } from './pricing.js';

const MAX_LAYERS = 100;
const STORAGE_KEY = 'helmet-livery-studio:v2';
const COLORS = [
  { name: 'Alpine White', hex: '#f4f5f7' },
  { name: 'Silverstone', hex: '#c9ced6' },
  { name: 'Gunmetal', hex: '#5f656e' },
  { name: 'Jet Black', hex: '#111111' },
  { name: 'Race Red', hex: '#e10600' },
  { name: 'Burnt Orange', hex: '#ff5a1f' },
  { name: 'Solar Yellow', hex: '#ffd100' },
  { name: 'Acid Green', hex: '#9be22d' },
  { name: 'British Racing Green', hex: '#0b4d2c' },
  { name: 'Estoril Blue', hex: '#0091ff' },
  { name: 'Midnight Navy', hex: '#16275a' },
  { name: 'Violet', hex: '#7b3fe4' },
  { name: 'Hot Pink', hex: '#ff2d95' },
  { name: 'Petrol Teal', hex: '#00a3a3' },
  { name: 'Champagne Gold', hex: '#c9a227' },
  { name: 'Bronze', hex: '#8c5a2b' },
];
const colorName = (hex) => COLORS.find((c) => c.hex.toLowerCase() === hex.toLowerCase())?.name || 'Custom';
const TRIMS = { 'Gloss Black': '#111111', Graphite: '#3a3f47', White: '#e6e6e6', Red: '#a0000e' };
const MIN_CM = 0.5;
const MAX_CM = 45;

const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const round = (v, d = 4) => Math.round(v * 10 ** d) / 10 ** d;
const vec = (a) => new THREE.Vector3(...a);

// ---------------------------------------------------------------- setup
const stage = createStage($('#scene'));
const assets = new AssetStore(stage.renderer);
let helmet = buildProceduralHelmet();
stage.scene.add(helmet.group);
helmet.group.updateMatrixWorld(true);

const decals = new DecalLayers(stage.scene, assets, () => {
  renderLayerList();
  refreshProps();
});
decals.setHelmet(helmet);

const history = new History();
let state = null;
let selectedId = null;

const selected = () => state.layers.find((l) => l.id === selectedId) || null;
const snapshot = () => JSON.stringify({ base: state.base, layers: state.layers });

// ---------------------------------------------------------------- state flow
function apply() {
  applyBase(helmet, state.base);
  decals.sync(state.layers, state.base, selectedId);
}

function commit() {
  clearTimeout(commitTimer);
  apply();
  if (history.push(snapshot())) persist();
  renderAll();
}

let commitTimer = 0;
function commitSoon(ms = 500) {
  clearTimeout(commitTimer);
  commitTimer = setTimeout(commit, ms);
}

function restore(snap) {
  const data = JSON.parse(snap);
  state.base = data.base;
  state.layers = data.layers;
  if (!selected()) selectedId = null;
  apply();
  persist();
  renderAll();
}

function renderAll() {
  renderLayerList();
  refreshProps();
  refreshPaint();
  refreshHeader();
  if (step === 'summary') renderSummary();
  $('#btn-undo').disabled = !history.canUndo;
  $('#btn-redo').disabled = !history.canRedo;
}

let warnedStorage = false;
function persist() {
  try {
    const used = new Set(state.layers.filter((l) => l.kind === 'upload').map((l) => l.assetId));
    const uploads = [...used].map((id) => assets.uploads.get(id)).filter(Boolean);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ base: state.base, layers: state.layers, uploads }));
  } catch {
    if (!warnedStorage) toast('Design is too large to autosave in the browser — use Save to keep it.', true);
    warnedStorage = true;
  }
}

function select(id) {
  selectedId = id;
  decals.sync(state.layers, state.base, selectedId);
  if (id) goToStep('graphics');
  renderLayerList();
  refreshProps();
}

// ---------------------------------------------------------------- placement helpers
const raycaster = new THREE.Raycaster();
const canvas = $('#scene');

function setRayFromClient(x, y) {
  const r = canvas.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1), stage.camera);
}

function placeFromDirection(dir) {
  const d = new THREE.Vector3(...dir).normalize();
  raycaster.set(d.clone().multiplyScalar(6), d.clone().negate());
  return decals.hitSurface(raycaster);
}

// Where a newly added sticker lands: the paintable point nearest the middle of
// the view. Searches outward because the centre may be the eye port or visor.
function placementAtViewCentre() {
  const ndc = new THREE.Vector2();
  for (let radius = 0; radius <= 0.8; radius += 0.08) {
    const steps = radius === 0 ? 1 : 12;
    for (let k = 0; k < steps; k++) {
      const a = Math.PI / 2 + (k / steps) * Math.PI * 2; // start searching upward
      raycaster.setFromCamera(ndc.set(Math.cos(a) * radius, Math.sin(a) * radius), stage.camera);
      const hit = decals.hitSurface(raycaster);
      if (hit) return hit;
    }
  }
  return placeFromDirection([0, 1, 0.3]);
}

function toScreen(point) {
  const p = point.clone().project(stage.camera);
  const r = canvas.getBoundingClientRect();
  return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height };
}

// ---------------------------------------------------------------- layers
function baseLayer(fields) {
  return {
    id: newId('layer'),
    name: 'Sticker',
    kind: 'preset',
    assetId: null,
    text: null,
    color: '#ffffff',
    opacity: 1,
    finish: 'inherit',
    visible: true,
    locked: false,
    mirror: false,
    mirrorFlip: true,
    point: [0, 1, 0],
    normal: [0, 1, 0],
    rotation: 0,
    width: 1,
    height: 1,
    depth: 0.8,
    flipX: false,
    flipY: false,
    lockAspect: true,
    ...fields,
  };
}

async function sizeForArtwork(layer, longestCm) {
  const entry = await assets.get(assets.keyFor(layer));
  const aspect = entry.aspect;
  const longest = longestCm ?? (aspect > 3 || aspect < 1 / 3 ? 26 : 11);
  const L = longest / UNIT_CM;
  if (aspect >= 1) {
    layer.width = round(L);
    layer.height = round(L / aspect);
  } else {
    layer.height = round(L);
    layer.width = round(L * aspect);
  }
  return layer;
}

async function addLayer(fields, { longestCm, place = true } = {}) {
  if (state.layers.length >= MAX_LAYERS) {
    toast(`Layer limit reached (${MAX_LAYERS})`, true);
    return null;
  }
  const layer = baseLayer(fields);
  if (place) {
    const hit = placementAtViewCentre();
    if (hit) {
      layer.point = hit.point.toArray().map((v) => round(v));
      layer.normal = hit.normal.toArray().map((v) => round(v));
    }
  }
  if (layer.kind === 'preset' && fields.color === undefined) {
    // Pick a colour that contrasts with the shell.
    const shell = new THREE.Color(state.base.color);
    layer.color = shell.getHSL({}).l > 0.6 ? '#111111' : '#ffffff';
  }
  try {
    await sizeForArtwork(layer, longestCm);
  } catch (err) {
    toast(err.message, true);
    return null;
  }
  state.layers.push(layer);
  selectedId = layer.id;
  commit();
  goToStep('graphics');
  return layer;
}

function addPreset(presetId) {
  const preset = PRESETS.get(presetId);
  return addLayer({ kind: 'preset', assetId: presetId, name: preset.name });
}

function addText(textPreset) {
  const text = { ...textPreset.text };
  return addLayer({ kind: 'text', text, name: text.value, autoName: true }, { longestCm: Math.min(16, 4 + text.value.length * 2.2) });
}

async function addUploads(files) {
  const images = [...files].filter((f) => f.type.startsWith('image/'));
  for (const file of images) {
    try {
      const up = await assets.addUpload(file);
      await addLayer({ kind: 'upload', assetId: up.id, name: up.name });
    } catch (err) {
      toast(err.message, true);
    }
  }
  if (libraryMode) renderLibrary();
}

async function replaceArtwork(fields) {
  const layer = selected();
  if (!layer) return;
  const oldWidth = layer.width;
  Object.assign(layer, fields);
  if (fields.kind !== 'text') layer.text = null;
  const entry = await assets.get(assets.keyFor(layer));
  layer.width = oldWidth;
  layer.height = round(oldWidth / entry.aspect);
  commit();
}

function deleteSelected() {
  if (!selectedId) return;
  const i = state.layers.findIndex((l) => l.id === selectedId);
  state.layers.splice(i, 1);
  const next = state.layers[Math.min(i, state.layers.length - 1)];
  selectedId = next ? next.id : null;
  commit();
}

function duplicateSelected() {
  const layer = selected();
  if (!layer || state.layers.length >= MAX_LAYERS) return;
  const copy = structuredClone(layer);
  copy.id = newId('layer');
  copy.name = `${layer.name} copy`;
  copy.autoName = false;
  // Nudge the copy so it doesn't sit exactly on top of the original.
  const c = toScreen(vec(layer.point));
  setRayFromClient(c.x + 24, c.y + 24);
  const hit = decals.hitSurface(raycaster);
  if (hit) {
    copy.point = hit.point.toArray().map((v) => round(v));
    copy.normal = hit.normal.toArray().map((v) => round(v));
  }
  const i = state.layers.indexOf(layer);
  state.layers.splice(i + 1, 0, copy);
  selectedId = copy.id;
  commit();
}

function moveLayer(delta) {
  const i = state.layers.findIndex((l) => l.id === selectedId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= state.layers.length) return;
  const [layer] = state.layers.splice(i, 1);
  state.layers.splice(j, 0, layer);
  commit();
}

// ---------------------------------------------------------------- default design
function emptyDesign() {
  return { base: { color: '#f4f5f7', finish: 'gloss', visor: 'dark-smoke', trim: '#111111', showVisor: true }, layers: [] };
}

function starterBase() {
  return { color: '#f4f5f7', finish: 'carbon', visor: 'iridium-red', trim: '#111111', showVisor: true };
}

async function starterDesign() {
  const design = { base: starterBase(), layers: [] };
  const put = async (fields, dir, extra = {}) => {
    const hit = placeFromDirection(dir);
    const layer = baseLayer({ ...fields, point: hit.point.toArray().map((v) => round(v)), normal: hit.normal.toArray().map((v) => round(v)) });
    await sizeForArtwork(layer, extra.longestCm);
    Object.assign(layer, extra.after || {});
    design.layers.push(layer);
  };
  await put({ kind: 'preset', assetId: 'gt-stripe', name: 'Centre Stripe', color: '#e10600', rotation: 90, depth: 1.3 }, [0, 1, 0.12], { longestCm: 38 });
  await put({ kind: 'preset', assetId: 'swoosh', name: 'Side Swoosh', color: '#f4f5f7', mirror: true, rotation: -6 }, [1, -0.4, 0.1], { longestCm: 24 });
  await put({ kind: 'preset', assetId: 'roundel', name: 'Number Roundel', color: '#f4f5f7', mirror: true, mirrorFlip: false }, [1, 0.12, -0.7], { longestCm: 9 });
  await put({ kind: 'text', name: '46', autoName: true, text: { ...TEXT_PRESETS[0].text, fill: '#111111', strokeWidth: 0 }, mirror: true, mirrorFlip: false }, [1, 0.12, -0.7], { longestCm: 5.2 });
  await put({ kind: 'preset', assetId: 'checker-fade', name: 'Checker Fade', color: '#f4f5f7', rotation: 0 }, [0, -0.35, -1], { longestCm: 15 });
  await put({ kind: 'preset', assetId: 'bolt', name: 'Chin Bolt', color: '#e10600' }, [0, -0.9, 1], { longestCm: 5 });
  return design;
}

// ---------------------------------------------------------------- layer list UI
const thumbCache = new Map();
function thumbFor(layer) {
  const key = `${assets.keyFor(layer)}|${layer.color}`;
  if (thumbCache.has(key)) return thumbCache.get(key);
  if (!assets.peek(assets.keyFor(layer))) return '';
  const url = assets.thumbnail(layer);
  thumbCache.set(key, url);
  return url;
}

const ICONS = {
  eye: '<svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  eyeOff: '<svg viewBox="0 0 24 24"><path d="M3 3l18 18M10.6 5.1A10 10 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.2M6.6 6.6C3.9 8.4 2 12 2 12s3.6 7 10 7a9.6 9.6 0 0 0 5.4-1.6"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>',
  unlock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.5-2"/></svg>',
};

let dragIndex = -1;
function renderLayerList() {
  const list = $('#layer-list');
  list.replaceChildren();
  $('#layer-count').textContent = `${state.layers.length} / ${MAX_LAYERS}`;
  $('#layers-empty').hidden = state.layers.length > 0;
  for (let i = state.layers.length - 1; i >= 0; i--) {
    const layer = state.layers[i];
    const li = document.createElement('li');
    li.className = 'layer';
    li.classList.toggle('selected', layer.id === selectedId);
    li.classList.toggle('hidden-layer', !layer.visible);
    li.draggable = true;
    li.dataset.index = i;
    const size = `${(layer.width * UNIT_CM).toFixed(1)}×${(layer.height * UNIT_CM).toFixed(1)} cm`;
    li.innerHTML = `
      <span class="grip">⋮⋮</span>
      <img alt="" />
      <div class="layer-name"><span></span><div class="layer-meta">${size}${layer.mirror ? ' · mirrored' : ''}</div></div>
      <div class="layer-toggles">
        <button class="mini ${layer.visible ? '' : 'on'}" data-act="vis" title="${layer.visible ? 'Hide' : 'Show'}">${layer.visible ? ICONS.eye : ICONS.eyeOff}</button>
        <button class="mini ${layer.locked ? 'on' : ''}" data-act="lock" title="${layer.locked ? 'Unlock' : 'Lock'}">${layer.locked ? ICONS.lock : ICONS.unlock}</button>
      </div>`;
    li.querySelector('.layer-name span').textContent = layer.name;
    const src = thumbFor(layer);
    if (src) li.querySelector('img').src = src;
    li.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (act === 'vis') layer.visible = !layer.visible;
      if (act === 'lock') layer.locked = !layer.locked;
      if (act) return commit();
      select(layer.id);
    });
    li.addEventListener('dragstart', (e) => {
      dragIndex = i;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', layer.id);
    });
    li.addEventListener('dragover', (e) => {
      if (dragIndex < 0) return;
      e.preventDefault();
      const r = li.getBoundingClientRect();
      const top = e.clientY < r.top + r.height / 2;
      li.classList.toggle('drag-over-top', top);
      li.classList.toggle('drag-over-bottom', !top);
    });
    li.addEventListener('dragleave', () => li.classList.remove('drag-over-top', 'drag-over-bottom'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragIndex < 0) return;
      const r = li.getBoundingClientRect();
      const above = e.clientY < r.top + r.height / 2; // visually above = higher index
      const [moved] = state.layers.splice(dragIndex, 1);
      let target = i + (above ? 1 : 0);
      if (dragIndex < target) target--;
      state.layers.splice(target, 0, moved);
      dragIndex = -1;
      commit();
    });
    li.addEventListener('dragend', () => (dragIndex = -1));
    list.appendChild(li);
  }
  const has = !!selectedId;
  const idx = state.layers.findIndex((l) => l.id === selectedId);
  $('#btn-up').disabled = !has || idx === state.layers.length - 1;
  $('#btn-down').disabled = !has || idx === 0;
  $('#btn-dup').disabled = !has;
  $('#btn-del').disabled = !has;
  list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
}

// ---------------------------------------------------------------- properties UI
// ---------------------------------------------------------------- configurator steps
const STEPS = ['model', 'paint', 'visor', 'graphics', 'summary'];
const STEP_LABELS = { model: 'Helmet', paint: 'Paint', visor: 'Visor', graphics: 'Graphics', summary: 'Summary' };
let step = 'model';

function goToStep(name) {
  if (!STEPS.includes(name)) return;
  const changed = step !== name;
  step = name;
  const i = STEPS.indexOf(name);
  $$('#steps button').forEach((b) => {
    const j = STEPS.indexOf(b.dataset.step);
    b.classList.toggle('active', j === i);
    b.classList.toggle('done', j < i);
  });
  $$('.step-body').forEach((b) => (b.hidden = b.dataset.body !== name));
  $('#btn-prev').style.visibility = i === 0 ? 'hidden' : 'visible';
  $('#btn-next').textContent = i === STEPS.length - 1 ? 'Request a quote' : `Next: ${STEP_LABELS[STEPS[i + 1]]}`;
  if (changed) $('.config-scroll').scrollTop = 0;
  if (name === 'summary') {
    if (selectedId) select(null);
    renderSummary();
  }
  // Frame the helmet the way each step is best judged.
  if (changed && name === 'visor') stage.flyTo('front');
}
$$('#steps button').forEach((b) => b.addEventListener('click', () => goToStep(b.dataset.step)));
$('#btn-prev').addEventListener('click', () => goToStep(STEPS[STEPS.indexOf(step) - 1]));
$('#btn-next').addEventListener('click', () => {
  const i = STEPS.indexOf(step);
  if (i === STEPS.length - 1) return openQuote();
  goToStep(STEPS[i + 1]);
});

function buildSwatches(el, onPick) {
  el.replaceChildren(
    ...COLORS.map((c) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.style.background = c.hex;
      b.dataset.color = c.hex;
      b.title = c.name;
      b.setAttribute('aria-label', c.name);
      b.addEventListener('click', () => onPick(c.hex));
      return b;
    }),
  );
}

function markSwatch(el, color) {
  el.querySelectorAll('.swatch').forEach((s) => s.classList.toggle('on', s.dataset.color.toLowerCase() === color.toLowerCase()));
}

buildSwatches($('#layer-swatches'), (c) => {
  const l = selected();
  if (!l) return;
  l.color = c;
  commit();
});

$('#prop-font').replaceChildren(
  ...FONTS.map((f) => {
    const o = document.createElement('option');
    o.value = o.textContent = f;
    o.style.fontFamily = `"${f}"`;
    return o;
  }),
);

$('#prop-finish').replaceChildren(
  ...[['inherit', 'Same as shell'], ...Object.entries(FINISHES).filter(([, v]) => !v.shellOnly).map(([k, v]) => [k, v.label])].map(([k, label]) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.value = k;
    b.textContent = label;
    b.addEventListener('click', () => {
      const l = selected();
      if (!l) return;
      l.finish = k;
      commit();
    });
    return b;
  }),
);

const setOut = (input, text) => (input.parentElement.querySelector('output').textContent = text);
const notFocused = (el) => document.activeElement !== el;

function refreshProps() {
  const l = selected();
  $('#no-selection').hidden = !!l;
  $('#props').hidden = !l;
  if (!l) return;
  $('#prop-thumb').src = thumbFor(l) || '';
  if (notFocused($('#prop-name'))) $('#prop-name').value = l.name;

  const isText = l.kind === 'text';
  $('#text-group').hidden = !isText;
  $('#color-group').hidden = l.kind !== 'preset';
  $('#upload-group').hidden = l.kind !== 'upload';
  if (isText) {
    if (notFocused($('#prop-text'))) $('#prop-text').value = l.text.value;
    $('#prop-font').value = l.text.font;
    $('#prop-italic').classList.toggle('on', !!l.text.italic);
    $('#prop-text-fill').value = l.text.fill;
    $('#prop-text-stroke').value = l.text.stroke;
    $('#prop-stroke-width').value = l.text.strokeWidth;
    setOut($('#prop-stroke-width'), l.text.strokeWidth);
    $('#prop-spacing').value = l.text.spacing;
    setOut($('#prop-spacing'), l.text.spacing);
  } else {
    $('#prop-color').value = l.color;
    $('#prop-color-hex').textContent = l.color.toUpperCase();
    markSwatch($('#layer-swatches'), l.color);
  }

  const wcm = l.width * UNIT_CM;
  const hcm = l.height * UNIT_CM;
  $('#prop-width').value = wcm;
  setOut($('#prop-width'), `${wcm.toFixed(1)} cm`);
  $('#prop-height').value = hcm;
  setOut($('#prop-height'), `${hcm.toFixed(1)} cm`);
  $('#prop-rotation').value = l.rotation;
  setOut($('#prop-rotation'), `${Math.round(l.rotation)}°`);
  $('#prop-depth').value = l.depth;
  setOut($('#prop-depth'), `${Math.round(l.depth * 100)}%`);
  $('#prop-opacity').value = l.opacity;
  setOut($('#prop-opacity'), `${Math.round(l.opacity * 100)}%`);

  $('#prop-lock-aspect').classList.toggle('on', l.lockAspect);
  $('#prop-flipx').classList.toggle('on', l.flipX);
  $('#prop-flipy').classList.toggle('on', l.flipY);
  $('#prop-mirror').classList.toggle('on', l.mirror);
  $('#prop-mirror-flip').classList.toggle('on', l.mirrorFlip);
  $('#prop-mirror-flip').disabled = !l.mirror;
  $('#prop-visible').classList.toggle('on', l.visible);
  $('#prop-locked').classList.toggle('on', l.locked);
  $$('#prop-finish .chip').forEach((c) => c.classList.toggle('on', c.dataset.value === l.finish));
}

// Live-updating slider: 'input' previews, 'change' commits to history.
function bindRange(id, setter) {
  const el = $(id);
  el.addEventListener('input', () => {
    const l = selected();
    if (!l) return;
    setter(l, parseFloat(el.value));
    apply();
    refreshProps();
  });
  el.addEventListener('change', () => selected() && commit());
}

function setSize(l, axis, cm) {
  const v = clamp(cm, MIN_CM, MAX_CM) / UNIT_CM;
  const ratio = l.width / l.height;
  if (axis === 'w') {
    l.width = round(v);
    if (l.lockAspect) l.height = round(v / ratio);
  } else {
    l.height = round(v);
    if (l.lockAspect) l.width = round(v * ratio);
  }
}

bindRange('#prop-width', (l, v) => setSize(l, 'w', v));
bindRange('#prop-height', (l, v) => setSize(l, 'h', v));
bindRange('#prop-rotation', (l, v) => (l.rotation = v));
bindRange('#prop-depth', (l, v) => (l.depth = v));
bindRange('#prop-opacity', (l, v) => (l.opacity = v));
bindRange('#prop-stroke-width', (l, v) => (l.text = { ...l.text, strokeWidth: v }));
bindRange('#prop-spacing', (l, v) => (l.text = { ...l.text, spacing: v }));

function bindColor(id, setter) {
  const el = $(id);
  el.addEventListener('input', () => {
    const l = selected();
    if (!l) return;
    setter(l, el.value);
    apply();
  });
  el.addEventListener('change', () => selected() && commit());
}
bindColor('#prop-color', (l, v) => (l.color = v));
bindColor('#prop-text-fill', (l, v) => (l.text = { ...l.text, fill: v }));
bindColor('#prop-text-stroke', (l, v) => (l.text = { ...l.text, stroke: v }));

function bindToggle(id, fn) {
  $(id).addEventListener('click', () => {
    const l = selected();
    if (!l) return;
    fn(l);
    commit();
  });
}
bindToggle('#prop-lock-aspect', (l) => (l.lockAspect = !l.lockAspect));
bindToggle('#prop-flipx', (l) => (l.flipX = !l.flipX));
bindToggle('#prop-flipy', (l) => (l.flipY = !l.flipY));
bindToggle('#prop-mirror', (l) => (l.mirror = !l.mirror));
bindToggle('#prop-mirror-flip', (l) => (l.mirrorFlip = !l.mirrorFlip));
bindToggle('#prop-visible', (l) => (l.visible = !l.visible));
bindToggle('#prop-locked', (l) => (l.locked = !l.locked));
bindToggle('#prop-italic', (l) => {
  l.text = { ...l.text, italic: !l.text.italic };
  refitText(l);
});
bindToggle('#prop-center', (l) => {
  const p = vec(l.point);
  const n = vec(l.normal);
  p.x = 0;
  n.x = 0;
  if (n.lengthSq() < 1e-4) n.set(0, 1, 0);
  const hit = decals.reproject(p, n.normalize());
  if (hit) {
    l.point = hit.point.toArray().map((v) => round(v));
    l.normal = [0, round(hit.normal.y), round(hit.normal.z)];
  }
  l.mirror = false;
});

$('#prop-reset-ratio').addEventListener('click', async () => {
  const l = selected();
  if (!l) return;
  const e = await assets.get(assets.keyFor(l));
  l.height = round(l.width / e.aspect);
  commit();
});

$('#prop-name').addEventListener('input', (e) => {
  const l = selected();
  if (!l) return;
  l.name = e.target.value || 'Sticker';
  l.autoName = false;
  commitSoon(800);
});

// Keeps text stickers the same height when their content changes width.
async function refitText(l) {
  const key = assets.keyFor(l);
  const e = await assets.get(key);
  if (assets.keyFor(l) !== key) return;
  l.width = round(l.height * e.aspect);
  apply();
  refreshProps();
}

$('#prop-text').addEventListener('input', (e) => {
  const l = selected();
  if (!l || l.kind !== 'text') return;
  l.text = { ...l.text, value: e.target.value || ' ' };
  if (l.autoName) l.name = e.target.value || 'Text';
  refitText(l).then(() => commitSoon(700));
});
$('#prop-font').addEventListener('change', (e) => {
  const l = selected();
  if (!l) return;
  l.text = { ...l.text, font: e.target.value };
  refitText(l).then(commit);
});
for (const id of ['#prop-stroke-width', '#prop-spacing']) $(id).addEventListener('change', () => selected() && refitText(selected()).then(commit));

$('#prop-knockout').addEventListener('click', async () => {
  const l = selected();
  if (!l || l.kind !== 'upload') return;
  const up = await assets.knockOutWhite(l.assetId);
  l.assetId = up.id;
  commit();
  toast('White background removed');
});

$('#btn-replace').addEventListener('click', () => openLibrary('replace'));

// ---------------------------------------------------------------- paint UI
buildSwatches($('#base-swatches'), (c) => {
  state.base.color = c;
  commit();
});
bindBase('#base-color', (v) => (state.base.color = v));
function bindBase(id, setter) {
  const el = $(id);
  el.addEventListener('input', () => {
    setter(el.value);
    apply();
    $('#base-color-hex').textContent = el.value.toUpperCase();
    $('#base-color-name').textContent = colorName(el.value);
  });
  el.addEventListener('change', commit);
}

function listItem(value, html, onClick) {
  const b = document.createElement('button');
  b.className = 'list-item';
  b.dataset.value = value;
  b.innerHTML = `${html}<span class="tick"></span>`;
  b.addEventListener('click', onClick);
  return b;
}

const finishBall = {
  gloss: 'radial-gradient(circle at 35% 30%, #fff 0 8%, #8a8f97 30%, #1b1d21 80%)',
  satin: 'radial-gradient(circle at 35% 30%, #d9dbe0 0 12%, #6d727a 45%, #2b2e33 90%)',
  matte: '#5d6168',
  metallic: 'radial-gradient(circle at 35% 30%, #fff 0 6%, #b9bec6 22%, #4a4f57 60%, #1a1c20 90%)',
  pearl: 'radial-gradient(circle at 35% 30%, #fff 0 8%, #dfe3ff 25%, #ffd9ef 50%, #b8c0cf 85%)',
  chrome: 'radial-gradient(circle at 35% 30%, #fff 0 10%, #9aa1ab 30%, #f2f4f7 55%, #3d424a 85%)',
  carbon: 'repeating-linear-gradient(45deg, #1a1a1c 0 3px, #3a3b3f 3px 6px)',
};
$('#base-finish').replaceChildren(
  ...Object.entries(FINISHES).map(([k, v]) =>
    listItem(k, `<i class="li-ball" style="background:${finishBall[k]}"></i><span class="li-text"><strong>${v.label}</strong><small>${v.note}</small></span>`, () => {
      state.base.finish = k;
      commit();
    }),
  ),
);

$('#base-visor').replaceChildren(
  ...Object.entries(VISORS).map(([k, v]) => {
    const bg = v.iridescence
      ? 'linear-gradient(90deg,#ff5f6d,#ffc371,#6dd5ed,#8e7dff)'
      : v.metalness > 0.5
        ? `linear-gradient(160deg, #fff 0%, ${v.color} 45%, #111 100%)`
        : `color-mix(in srgb, ${v.color} ${Math.round(v.opacity * 100)}%, #dfe3e8)`;
    const note = v.metalness > 0.5 ? 'Mirrored coating' : v.opacity < 0.2 ? 'Maximum light, night riding' : 'Tinted, daytime use';
    return listItem(k, `<i class="li-swatch" style="background:${bg}"></i><span class="li-text"><strong>${v.label}</strong><small>${note}</small></span>`, () => {
      state.base.visor = k;
      state.base.showVisor = true;
      commit();
    });
  }),
);

$('#base-trim').replaceChildren(
  ...Object.entries(TRIMS).map(([label, c]) => {
    const b = document.createElement('button');
    b.className = 'trim-opt';
    b.dataset.value = c;
    b.innerHTML = `<span class="swatch" style="background:${c}"></span>${label}`;
    b.addEventListener('click', () => {
      state.base.trim = c;
      commit();
    });
    return b;
  }),
);

$('#base-show-visor').addEventListener('change', (e) => {
  state.base.showVisor = e.target.checked;
  commit();
});

function refreshPaint() {
  const b = state.base;
  $('#base-color').value = b.color;
  $('#base-color-hex').textContent = b.color.toUpperCase();
  $('#base-color-name').textContent = colorName(b.color);
  markSwatch($('#base-swatches'), b.color);
  $$('#base-finish .list-item').forEach((c) => c.classList.toggle('on', c.dataset.value === b.finish));
  $$('#base-visor .list-item').forEach((c) => c.classList.toggle('on', c.dataset.value === b.visor));
  $$('#base-trim .trim-opt').forEach((c) => c.classList.toggle('on', c.dataset.value === b.trim));
  $('#base-show-visor').checked = b.showVisor !== false;
  $('#model-default').classList.toggle('selected', helmet.kind === 'procedural');
  $('#btn-model').classList.toggle('selected', helmet.kind !== 'procedural');
}

function specLine() {
  const b = state.base;
  const shell = b.finish === 'carbon' ? `Carbon${colorName(b.color) === 'Alpine White' ? '' : ` · ${colorName(b.color)} tint`}` : `${colorName(b.color)} ${FINISHES[b.finish].label}`;
  const n = state.layers.filter((l) => l.visible).length;
  return `${shell} · ${VISORS[b.visor].label} visor · ${n} graphic${n === 1 ? '' : 's'}`;
}

function refreshHeader() {
  $('#stage-model').textContent = helmet.kind === 'procedural' ? 'GP-R Track' : helmet.label || 'Custom helmet';
  $('#stage-spec').textContent = specLine();
  $('#price-total').textContent = money(quote(state.layers, state.base).total);
}

// ---------------------------------------------------------------- helmet model
async function swapHelmet(next) {
  stage.scene.remove(helmet.group);
  helmet = next;
  stage.scene.add(helmet.group);
  helmet.group.updateMatrixWorld(true);
  decals.setHelmet(helmet);
  for (const l of state.layers) {
    const hit = decals.reproject(vec(l.point), vec(l.normal));
    if (hit) {
      l.point = hit.point.toArray().map((v) => round(v));
      l.normal = hit.normal.toArray().map((v) => round(v));
    }
  }
  commit();
}

$('#btn-model').addEventListener('click', () => $('#file-model').click());
$('#file-model').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) loadModelFile(file);
});
async function loadModelFile(file) {
  try {
    toast('Loading model…');
    const next = await loadHelmetModel(file);
    next.label = file.name.replace(/\.[^.]+$/, '');
    $('#custom-model-name').textContent = file.name;
    await swapHelmet(next);
    toast(`Loaded ${file.name}`);
  } catch (err) {
    console.error(err);
    toast(`Could not load model: ${err.message}`, true);
  }
}
$('#model-default').addEventListener('click', () => {
  if (helmet.kind !== 'procedural') swapHelmet(buildProceduralHelmet());
});

// ---------------------------------------------------------------- library
let libraryMode = null; // 'add' | 'replace' | 'text'
let libraryTab = 'shapes';

function openLibrary(mode, tab) {
  libraryMode = mode;
  if (tab) libraryTab = tab;
  if (mode === 'replace' && libraryTab === 'text' && selected()?.kind !== 'text') libraryTab = 'shapes';
  $('#library-title').textContent = mode === 'replace' ? 'Swap Artwork' : 'Sticker Library';
  renderLibrary();
  $('#library').showModal();
}

function renderLibrary() {
  const tabs = [...PRESET_CATEGORIES.map((c) => [c.id, c.label]), ['text', 'Text'], ['uploads', 'My Uploads']];
  $('#lib-tabs').replaceChildren(
    ...tabs.map(([id, label]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.classList.toggle('on', id === libraryTab);
      b.addEventListener('click', () => {
        libraryTab = id;
        renderLibrary();
      });
      return b;
    }),
  );
  const grid = $('#lib-grid');
  grid.replaceChildren();
  const tile = (label, artNode, onClick, extraClass = '') => {
    const b = document.createElement('button');
    b.className = `lib-item ${extraClass}`;
    const art = document.createElement('div');
    art.className = 'art';
    if (artNode) art.appendChild(artNode);
    const name = document.createElement('span');
    name.textContent = label;
    b.append(art, name);
    b.addEventListener('click', onClick);
    grid.appendChild(b);
    return b;
  };
  const choose = (fields, addFn) => {
    $('#library').close();
    if (libraryMode === 'replace' && selected()) replaceArtwork(fields);
    else addFn();
  };

  const category = PRESET_CATEGORIES.find((c) => c.id === libraryTab);
  if (category) {
    for (const item of category.items) {
      const img = new Image();
      img.src = svgToDataUrl(item.svg);
      img.alt = '';
      tile(item.name, img, () => choose({ kind: 'preset', assetId: item.id, name: item.name }, () => addPreset(item.id)));
    }
  } else if (libraryTab === 'text') {
    for (const p of TEXT_PRESETS) {
      const s = document.createElement('span');
      s.className = 'text-sample';
      s.textContent = p.text.value;
      s.style.fontFamily = `"${p.text.font}"`;
      s.style.fontStyle = p.text.italic ? 'italic' : 'normal';
      s.style.fontWeight = p.text.weight;
      if (p.text.strokeWidth) s.style.webkitTextStroke = `1px ${p.text.stroke}`;
      tile(p.name, s, () => choose({ kind: 'text', text: { ...p.text }, name: p.text.value, autoName: true }, () => addText(p)));
    }
  } else {
    const up = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    up.setAttribute('viewBox', '0 0 24 24');
    up.innerHTML = '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>';
    tile('Upload image', up, () => $('#file-upload').click(), 'upload-tile');
    for (const u of assets.uploads.values()) {
      const img = new Image();
      img.src = u.src;
      img.alt = '';
      img.className = 'photo';
      tile(u.name, img, () => choose({ kind: 'upload', assetId: u.id, name: u.name }, () => addLayer({ kind: 'upload', assetId: u.id, name: u.name })));
    }
  }
}

$$('dialog [data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$$('dialog').forEach((d) =>
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close();
  }),
);
$('#library').addEventListener('close', () => (libraryMode = null));

$('#btn-add-sticker').addEventListener('click', () => openLibrary('add', PRESET_CATEGORIES.some((c) => c.id === libraryTab) ? libraryTab : 'shapes'));
$('#btn-add-text').addEventListener('click', () => openLibrary('add', 'text'));
$('#btn-upload').addEventListener('click', () => $('#file-upload').click());
$('#file-upload').addEventListener('change', (e) => {
  const files = [...e.target.files];
  e.target.value = '';
  if (libraryMode === 'replace') {
    $('#library').close();
    assets.addUpload(files[0]).then((u) => replaceArtwork({ kind: 'upload', assetId: u.id, name: u.name }), (err) => toast(err.message, true));
    return;
  }
  $('#library').open && $('#library').close();
  addUploads(files);
});

// ---------------------------------------------------------------- layer buttons
$('#btn-up').addEventListener('click', () => moveLayer(1));
$('#btn-down').addEventListener('click', () => moveLayer(-1));
$('#btn-dup').addEventListener('click', duplicateSelected);
$('#btn-del').addEventListener('click', deleteSelected);
$('#btn-undo').addEventListener('click', undo);
$('#btn-redo').addEventListener('click', redo);

function undo() {
  const s = history.undo();
  if (s) restore(s);
}
function redo() {
  const s = history.redo();
  if (s) restore(s);
}

// ---------------------------------------------------------------- views
$$('#views [data-view]').forEach((b) =>
  b.addEventListener('click', () => {
    stage.controls.autoRotate = false;
    $('#btn-spin').classList.remove('on');
    stage.flyTo(b.dataset.view);
    $$('#views [data-view]').forEach((x) => x.classList.toggle('on', x === b));
  }),
);
$('#btn-spin').addEventListener('click', (e) => {
  stage.controls.autoRotate = !stage.controls.autoRotate;
  e.currentTarget.classList.toggle('on', stage.controls.autoRotate);
});

// ---------------------------------------------------------------- 3D interaction
let drag = null;
let downAt = null;

function beginDrag(hit, e) {
  const l = state.layers.find((x) => x.id === hit.id);
  const placement = hit.mirror ? mirrorPlacement(l) : { point: vec(l.point) };
  const c = toScreen(placement.point);
  drag = {
    id: l.id,
    mirror: hit.mirror,
    mode: e.shiftKey ? 'rotate' : e.altKey ? 'scale' : 'move',
    startX: e.clientX,
    startY: e.clientY,
    dx: c.x - e.clientX,
    dy: c.y - e.clientY,
    rotation: l.rotation,
    width: l.width,
    height: l.height,
    moved: false,
  };
  decals.setSelectionVisible(true);
}

$('#viewport').addEventListener(
  'pointerdown',
  (e) => {
    if (e.target !== canvas || e.button !== 0) return;
    downAt = { x: e.clientX, y: e.clientY };
    setRayFromClient(e.clientX, e.clientY);
    const hit = decals.pick(raycaster, state.layers);
    if (!hit) return;
    stage.controls.enabled = false;
    stage.controls.autoRotate = false;
    $('#btn-spin').classList.remove('on');
    if (hit.id !== selectedId) select(hit.id);
    beginDrag(hit, e);
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
  },
  { capture: true },
);

canvas.addEventListener('pointermove', (e) => {
  if (!drag) return hover(e);
  const l = state.layers.find((x) => x.id === drag.id);
  if (!l) return;
  const ddx = e.clientX - drag.startX;
  const ddy = e.clientY - drag.startY;
  if (Math.abs(ddx) + Math.abs(ddy) > 2) drag.moved = true;
  if (drag.mode === 'move') {
    setRayFromClient(e.clientX + drag.dx, e.clientY + drag.dy);
    const hit = decals.hitSurface(raycaster);
    if (!hit) return;
    if (drag.mirror) {
      hit.point.x *= -1;
      hit.normal.x *= -1;
    }
    l.point = hit.point.toArray().map((v) => round(v));
    l.normal = hit.normal.toArray().map((v) => round(v));
  } else if (drag.mode === 'rotate') {
    let r = drag.rotation + ddx * 0.5 * (drag.mirror ? -1 : 1);
    r = ((((r + 180) % 360) + 360) % 360) - 180;
    l.rotation = Math.round(r);
  } else {
    const k = Math.exp((ddx - ddy) * 0.005);
    const w = clamp(drag.width * k, MIN_CM / UNIT_CM, MAX_CM / UNIT_CM);
    l.width = round(w);
    l.height = round(drag.height * (w / drag.width));
  }
  apply();
  refreshProps();
});

function endDrag(e) {
  if (drag) {
    const moved = drag.moved;
    drag = null;
    stage.controls.enabled = true;
    canvas.style.cursor = '';
    if (moved) commit();
  } else if (downAt && e.target === canvas) {
    const dist = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y);
    if (dist < 5 && selectedId) select(null);
  }
  downAt = null;
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);

let hoverQueued = false;
function hover(e) {
  if (hoverQueued || e.buttons) return;
  hoverQueued = true;
  requestAnimationFrame(() => {
    hoverQueued = false;
    setRayFromClient(e.clientX, e.clientY);
    canvas.style.cursor = decals.pick(raycaster, state.layers) ? 'grab' : '';
  });
}

// Screen-space nudge for arrow keys.
function nudge(dx, dy) {
  const l = selected();
  if (!l) return;
  const c = toScreen(vec(l.point));
  setRayFromClient(c.x + dx, c.y + dy);
  const hit = decals.hitSurface(raycaster);
  if (!hit) return;
  l.point = hit.point.toArray().map((v) => round(v));
  l.normal = hit.normal.toArray().map((v) => round(v));
  apply();
  refreshProps();
  commitSoon(400);
}

window.addEventListener('keydown', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || $('dialog[open]')) return;
  const mod = e.ctrlKey || e.metaKey;
  const l = selected();
  const step = e.shiftKey ? 15 : 4;
  if (mod && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    return e.shiftKey ? redo() : undo();
  }
  if (mod && e.key.toLowerCase() === 'y') return e.preventDefault(), redo();
  if (mod && e.key.toLowerCase() === 'd') return e.preventDefault(), duplicateSelected();
  if (mod && e.key === ']') return e.preventDefault(), moveLayer(1);
  if (mod && e.key === '[') return e.preventDefault(), moveLayer(-1);
  if (e.key === 'Escape') return select(null);
  if (!l) return;
  switch (e.key) {
    case 'Delete':
    case 'Backspace':
      e.preventDefault();
      return deleteSelected();
    case 'ArrowLeft': e.preventDefault(); return nudge(-step, 0);
    case 'ArrowRight': e.preventDefault(); return nudge(step, 0);
    case 'ArrowUp': e.preventDefault(); return nudge(0, -step);
    case 'ArrowDown': e.preventDefault(); return nudge(0, step);
    case 'q': case 'Q': l.rotation = Math.max(-180, l.rotation - (e.shiftKey ? 15 : 5)); return commit();
    case 'e': case 'E': l.rotation = Math.min(180, l.rotation + (e.shiftKey ? 15 : 5)); return commit();
    case '[': setSize(l, 'w', l.width * UNIT_CM * 0.95); return commit();
    case ']': setSize(l, 'w', l.width * UNIT_CM * 1.05); return commit();
    case 'm': case 'M': l.mirror = !l.mirror; return commit();
    case 'h': case 'H': l.visible = !l.visible; return commit();
  }
});

// ---------------------------------------------------------------- files: drop & paste
const overlay = $('#drop-overlay');
let dragDepth = 0;
window.addEventListener('dragenter', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  dragDepth++;
  overlay.classList.add('show');
});
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth) overlay.classList.remove('show');
});
window.addEventListener('dragover', (e) => e.dataTransfer?.types.includes('Files') && e.preventDefault());
window.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.files.length) return;
  e.preventDefault();
  dragDepth = 0;
  overlay.classList.remove('show');
  const files = [...e.dataTransfer.files];
  const design = files.find((f) => f.name.endsWith('.json'));
  const model = files.find((f) => /\.(glb|gltf)$/i.test(f.name));
  if (design) return openDesignFile(design);
  if (model) return loadModelFile(model);
  addUploads(files);
});
window.addEventListener('paste', (e) => {
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA') return;
  const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
  if (files.length) addUploads(files);
});

// ---------------------------------------------------------------- save / open / export
function download(href, filename) {
  const a = document.createElement('a');
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

function designFile() {
  const used = new Set(state.layers.filter((l) => l.kind === 'upload').map((l) => l.assetId));
  return {
    app: 'helmet-livery-studio',
    version: 1,
    savedAt: new Date().toISOString(),
    base: state.base,
    layers: state.layers,
    uploads: [...used].map((id) => assets.uploads.get(id)).filter(Boolean),
  };
}

function saveDesign() {
  const blob = new Blob([JSON.stringify(designFile())], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  download(url, `helmet-livery-${new Date().toISOString().slice(0, 10)}.json`);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  toast('Design saved');
}

function loadDesignData(data) {
  if (!data || !Array.isArray(data.layers) || !data.base) throw new Error('Not a helmet design file');
  for (const u of data.uploads || []) assets.registerUpload(u);
  const fallback = emptyDesign().base;
  state = { base: { ...fallback, ...data.base }, layers: data.layers.map((l) => baseLayer(l)) };
  selectedId = null;
  apply();
  history.reset(snapshot());
  persist();
  renderAll();
}

async function openDesignFile(file) {
  try {
    loadDesignData(JSON.parse(await file.text()));
    toast(`Opened ${file.name}`);
  } catch (err) {
    toast(`Could not open design: ${err.message}`, true);
  }
}

$('#btn-save').addEventListener('click', saveDesign);
$('#btn-save-2').addEventListener('click', saveDesign);
$('#btn-open').addEventListener('click', () => $('#file-design').click());
$('#file-design').addEventListener('change', (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (f) openDesignFile(f);
});
$('#btn-new').addEventListener('click', () => {
  if (state.layers.length && !confirm('Start a new design? Unsaved changes to this one will be lost.')) return;
  selectedId = null;
  state = emptyDesign();
  commit();
});

let studioMode = 'light';
const studioBg = () => (studioMode === 'dark' ? '#16181b' : '#eceef1');
$('#btn-studio').addEventListener('click', (e) => {
  studioMode = studioMode === 'dark' ? 'light' : 'dark';
  document.body.classList.toggle('studio-dark', studioMode === 'dark');
  stage.setStudio(studioMode);
  e.currentTarget.classList.toggle('on', studioMode === 'dark');
});

let summaryTimer = 0;
function renderSummary() {
  const b = state.base;
  const rows = [
    ['Helmet', $('#stage-model').textContent],
    ['Shell colour', `${colorName(b.color)} (${b.color.toUpperCase()})`],
    ['Finish', FINISHES[b.finish].label],
    ['Visor', VISORS[b.visor].label],
    ['Trim', Object.entries(TRIMS).find(([, c]) => c === b.trim)?.[0] || b.trim],
    ['Graphics', `${state.layers.filter((l) => l.visible).length} layers`],
  ];
  const s = sheetSummary(state.layers);
  rows.push(['Stickers to print', `${s.count} pieces · ${(s.areaCm2 / 100).toFixed(1)} dm²`]);
  $('#summary-list').replaceChildren(...rows.flatMap(([k, v]) => [Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v })]));
  const q = quote(state.layers, state.base);
  const lines = q.lines.map((l) => [l.label, money(l.amount)]);
  if (!lines.length) lines.push(['Add graphics to see a price', '—']);
  const dl = $('#price-lines');
  dl.replaceChildren(...lines.flatMap(([k, v]) => [Object.assign(document.createElement('dt'), { textContent: k }), Object.assign(document.createElement('dd'), { textContent: v })]));
  dl.append(Object.assign(document.createElement('dt'), { textContent: 'Estimated total', className: 'total' }), Object.assign(document.createElement('dd'), { textContent: money(q.total), className: 'total' }));
  $('#sheet-summary').textContent = `${s.count} stickers at real size, with cut lines`;
  // Render the hero shot once the view has settled.
  clearTimeout(summaryTimer);
  summaryTimer = setTimeout(() => {
    $('#summary-shot').src = stage.screenshot({ width: 1200, height: 900, background: studioBg(), hide: [decals.frameMesh] });
  }, 150);
}

$('#btn-shot').addEventListener('click', () => {
  const transparent = $('#shot-transparent').checked;
  const url = stage.screenshot({ background: transparent ? null : studioBg(), hide: transparent ? [decals.frameMesh, stage.shadow] : [decals.frameMesh] });
  download(url, 'helmet-render.png');
});

// Quote request: no backend, so compose an email and hand over the files.
function openQuote() {
  $('#quote').showModal();
}
$('#btn-quote').addEventListener('click', openQuote);
$('#quote-form').addEventListener('submit', async (e) => {
  const f = new FormData(e.target);
  const q = quote(state.layers, state.base);
  const body = [
    `Name: ${f.get('name')}`,
    `Email: ${f.get('email')}`,
    `Helmet: ${f.get('helmet') || '-'}`,
    '',
    `Configuration: ${$('#stage-model').textContent} — ${specLine()}`,
    ...q.lines.map((l) => `${l.label}: ${money(l.amount)}`),
    `Estimated total: ${money(q.total)}`,
    '',
    `Notes: ${f.get('notes') || '-'}`,
    '',
    '(Design file and print sheet attached)',
  ].join('\n');
  saveDesign();
  await downloadSheet();
  if (PRICING.orderEmail) {
    location.href = `mailto:${PRICING.orderEmail}?subject=${encodeURIComponent('Helmet sticker quote request')}&body=${encodeURIComponent(body)}`;
    toast('Email opened — attach the downloaded files');
  } else {
    toast('Files downloaded. Set orderEmail in src/pricing.js to email requests.');
  }
});

async function downloadSheet() {
  const preview = stage.screenshot({ width: 900, height: 900, hide: [decals.frameMesh, stage.shadow] });
  const blob = await renderProductionSheet({ layers: state.layers, base: state.base, assets, dpi: +$('#sheet-dpi').value, preview });
  const url = URL.createObjectURL(blob);
  download(url, 'helmet-print-sheet.png');
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

$('#btn-sheet').addEventListener('click', async (e) => {
  const btn = e.currentTarget;
  btn.disabled = true;
  btn.textContent = 'Rendering…';
  try {
    await downloadSheet();
  } catch (err) {
    console.error(err);
    toast(`Could not render sheet: ${err.message}`, true);
  } finally {
    btn.disabled = false;
    btn.textContent = 'PNG';
  }
});

// ---------------------------------------------------------------- toast
let toastTimer = 0;
function toast(msg, error = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.toggle('error', error);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// ---------------------------------------------------------------- boot
async function boot() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
  } catch {
    saved = null;
  }
  if (saved?.layers) {
    try {
      loadDesignData(saved);
      return;
    } catch {
      /* fall through to the starter design */
    }
  }
  state = await starterDesign();
  apply();
  history.reset(snapshot());
  persist();
  renderAll();
}

state = emptyDesign();
goToStep('model');
renderAll();
boot();

// Handy for debugging from the console.
window.studio = { get state() { return state; }, stage, decals, assets, helmet: () => helmet };
