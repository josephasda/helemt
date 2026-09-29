import * as THREE from 'three';
import { PRESETS } from './presets.js';

const MAX_SIDE = 1024;
const PAD = 4; // transparent border so texture edges never smear

let uid = 0;
export const newId = (prefix) => `${prefix}-${Date.now().toString(36)}-${(uid++).toString(36)}`;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load image'));
    img.src = src;
  });
}

function imageToCanvas(img, maxSide = MAX_SIDE) {
  const w = img.naturalWidth || img.width;
  const h = img.naturalHeight || img.height;
  const k = Math.min(1, (maxSide - PAD * 2) / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * k));
  const ch = Math.max(1, Math.round(h * k));
  const canvas = document.createElement('canvas');
  canvas.width = cw + PAD * 2;
  canvas.height = ch + PAD * 2;
  canvas.getContext('2d').drawImage(img, PAD, PAD, cw, ch);
  return canvas;
}

export const svgToDataUrl = (svg) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

export class AssetStore {
  constructor(renderer) {
    this.maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
    this.entries = new Map(); // key -> { canvas, texture, tintable, aspect, alpha }
    this.pending = new Map();
    this.uploads = new Map(); // uploadId -> { id, name, src }
  }

  // ---- uploads ------------------------------------------------------------
  async addUpload(file) {
    if (!file.type.startsWith('image/')) throw new Error(`${file.name} is not an image`);
    const src = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error);
      r.readAsDataURL(file);
    });
    // Normalise to a PNG of bounded size so saved designs stay reasonable.
    const canvas = imageToCanvas(await loadImage(src));
    const id = newId('upload');
    const upload = { id, name: file.name.replace(/\.[^.]+$/, ''), src: canvas.toDataURL('image/png') };
    this.uploads.set(id, upload);
    this._store(`upload:${id}`, canvas, false);
    return upload;
  }

  registerUpload(upload) {
    if (!this.uploads.has(upload.id)) this.uploads.set(upload.id, upload);
  }

  // Makes a copy of an upload with near-white pixels turned transparent.
  async knockOutWhite(uploadId, threshold = 235) {
    const src = await this._canvasFor(`upload:${uploadId}`);
    const canvas = document.createElement('canvas');
    canvas.width = src.width;
    canvas.height = src.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(src, 0, 0);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const d = data.data;
    const soft = threshold - 35;
    for (let i = 0; i < d.length; i += 4) {
      const m = Math.min(d[i], d[i + 1], d[i + 2]);
      if (m >= threshold) d[i + 3] = 0;
      else if (m > soft) d[i + 3] = Math.round(d[i + 3] * (1 - (m - soft) / (threshold - soft)));
    }
    ctx.putImageData(data, 0, 0);
    const orig = this.uploads.get(uploadId);
    const id = newId('upload');
    const upload = { id, name: `${orig?.name || 'image'} (cut)`, src: canvas.toDataURL('image/png') };
    this.uploads.set(id, upload);
    this._store(`upload:${id}`, canvas, false);
    return upload;
  }

  // ---- keys ---------------------------------------------------------------
  keyFor(layer) {
    if (layer.kind === 'text') return `text:${JSON.stringify(layer.text)}`;
    if (layer.kind === 'upload') return `upload:${layer.assetId}`;
    return `preset:${layer.assetId}`;
  }

  isTintable(layer) {
    return layer.kind === 'preset';
  }

  // Returns a resolved entry synchronously when ready, otherwise null and
  // kicks off loading. `onReady` fires once loading completes.
  peek(key) {
    return this.entries.get(key) || null;
  }

  async get(key) {
    if (this.entries.has(key)) return this.entries.get(key);
    await this._canvasFor(key);
    return this.entries.get(key);
  }

  async _canvasFor(key) {
    if (this.entries.has(key)) return this.entries.get(key).canvas;
    if (this.pending.has(key)) return this.pending.get(key);
    const job = (async () => {
      const [type, ...rest] = key.split(':');
      const id = rest.join(':');
      let canvas;
      if (type === 'preset') {
        const preset = PRESETS.get(id);
        if (!preset) throw new Error(`Unknown preset ${id}`);
        const img = await loadImage(svgToDataUrl(preset.svg));
        const vb = preset.svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
        const [w, h] = vb ? [+vb[1], +vb[2]] : [img.width, img.height];
        const k = (MAX_SIDE - PAD * 2) / Math.max(w, h);
        canvas = document.createElement('canvas');
        canvas.width = Math.round(w * k) + PAD * 2;
        canvas.height = Math.round(h * k) + PAD * 2;
        canvas.getContext('2d').drawImage(img, PAD, PAD, canvas.width - PAD * 2, canvas.height - PAD * 2);
      } else if (type === 'upload') {
        const upload = this.uploads.get(id);
        if (!upload) throw new Error('Missing uploaded image');
        canvas = imageToCanvas(await loadImage(upload.src));
      } else if (type === 'text') {
        canvas = await renderText(JSON.parse(id));
      }
      this._store(key, canvas, type === 'preset');
      return canvas;
    })();
    this.pending.set(key, job);
    try {
      return await job;
    } finally {
      this.pending.delete(key);
    }
  }

  _store(key, canvas, tintable) {
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = this.maxAnisotropy;
    const entry = { canvas, texture, tintable, aspect: canvas.width / canvas.height, alpha: null };
    this.entries.set(key, entry);
    return entry;
  }

  // Alpha (0-255) at a UV coordinate, used for pixel-accurate picking.
  alphaAt(key, u, v) {
    const e = this.entries.get(key);
    if (!e) return 255;
    if (!e.alpha) {
      const small = document.createElement('canvas');
      small.width = Math.min(256, e.canvas.width);
      small.height = Math.max(1, Math.round(small.width / e.aspect));
      const ctx = small.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(e.canvas, 0, 0, small.width, small.height);
      e.alpha = { w: small.width, h: small.height, data: ctx.getImageData(0, 0, small.width, small.height).data };
    }
    const x = Math.min(e.alpha.w - 1, Math.max(0, Math.floor(u * e.alpha.w)));
    const y = Math.min(e.alpha.h - 1, Math.max(0, Math.floor((1 - v) * e.alpha.h)));
    return e.alpha.data[(y * e.alpha.w + x) * 4 + 3];
  }

  // Small tinted preview for UI lists.
  thumbnail(layer, size = 56) {
    const e = this.peek(this.keyFor(layer));
    const c = document.createElement('canvas');
    c.width = c.height = size;
    if (!e) return c.toDataURL();
    const ctx = c.getContext('2d');
    const k = Math.min(size / e.canvas.width, size / e.canvas.height);
    const w = e.canvas.width * k;
    const h = e.canvas.height * k;
    ctx.drawImage(e.canvas, (size - w) / 2, (size - h) / 2, w, h);
    if (e.tintable) {
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = layer.color;
      ctx.fillRect(0, 0, size, size);
    }
    return c.toDataURL();
  }

  // Full resolution, coloured artwork for print output.
  async printCanvas(layer, mirrored = false) {
    const e = await this.get(this.keyFor(layer));
    const c = document.createElement('canvas');
    c.width = e.canvas.width;
    c.height = e.canvas.height;
    const ctx = c.getContext('2d');
    const fx = (layer.flipX !== mirrored) ? -1 : 1;
    const fy = layer.flipY ? -1 : 1;
    ctx.translate(fx < 0 ? c.width : 0, fy < 0 ? c.height : 0);
    ctx.scale(fx, fy);
    ctx.drawImage(e.canvas, 0, 0);
    if (e.tintable) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.globalCompositeOperation = 'source-in';
      ctx.fillStyle = layer.color;
      ctx.fillRect(0, 0, c.width, c.height);
    }
    return c;
  }
}

export async function renderText(t) {
  const fontSize = 200;
  const font = `${t.italic ? 'italic ' : ''}${t.weight || 400} ${fontSize}px "${t.font}", sans-serif`;
  try {
    await document.fonts.load(font, t.value || ' ');
  } catch {
    /* fall back to whatever is available */
  }
  const measure = document.createElement('canvas').getContext('2d');
  measure.font = font;
  if ('letterSpacing' in measure) measure.letterSpacing = `${t.spacing || 0}px`;
  const text = t.value || ' ';
  const m = measure.measureText(text);
  const stroke = (fontSize * (t.strokeWidth || 0)) / 100;
  const pad = Math.ceil(stroke + 12 + (t.italic ? fontSize * 0.15 : 0));
  const ascent = m.actualBoundingBoxAscent || fontSize * 0.8;
  const descent = m.actualBoundingBoxDescent || fontSize * 0.2;
  const left = m.actualBoundingBoxLeft || 0;
  const width = Math.max(1, (m.actualBoundingBoxRight || m.width) + left);
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(width + pad * 2);
  canvas.height = Math.ceil(ascent + descent + pad * 2);
  const ctx = canvas.getContext('2d');
  ctx.font = font;
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${t.spacing || 0}px`;
  ctx.textBaseline = 'alphabetic';
  const x = pad + left;
  const y = pad + ascent;
  if (stroke > 0) {
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.lineWidth = stroke * 2;
    ctx.strokeStyle = t.stroke;
    ctx.strokeText(text, x, y);
  }
  ctx.fillStyle = t.fill;
  ctx.fillText(text, x, y);
  return canvas;
}
