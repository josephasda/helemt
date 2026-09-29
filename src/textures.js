import * as THREE from 'three';

// Procedurally generated surface detail textures. Created lazily and shared.

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Tileable value noise height field, 0..1.
function valueNoise(size, cells, seed) {
  const rand = rng(seed);
  const grid = Array.from({ length: cells * cells }, rand);
  const g = (x, y) => grid[((y % cells) + cells) % cells * cells + (((x % cells) + cells) % cells)];
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * cells;
      const fy = (y / size) * cells;
      const ix = Math.floor(fx);
      const iy = Math.floor(fy);
      let tx = fx - ix;
      let ty = fy - iy;
      tx = tx * tx * (3 - 2 * tx);
      ty = ty * ty * (3 - 2 * ty);
      const a = g(ix, iy) + (g(ix + 1, iy) - g(ix, iy)) * tx;
      const b = g(ix, iy + 1) + (g(ix + 1, iy + 1) - g(ix, iy + 1)) * tx;
      out[y * size + x] = a + (b - a) * ty;
    }
  return out;
}

function heightToNormal(h, size, strength) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const at = (x, y) => h[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const len = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = ((-dx / len) * 0.5 + 0.5) * 255;
      img.data[i + 1] = ((-dy / len) * 0.5 + 0.5) * 255;
      img.data[i + 2] = ((1 / len) * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  ctx.putImageData(img, 0, 0);
  return c;
}

function repeatTexture(canvas, repeat, colorSpace = THREE.NoColorSpace) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat[0], repeat[1]);
  t.colorSpace = colorSpace;
  t.anisotropy = 8;
  return t;
}

const cache = {};

// Very soft, low-frequency ripple you see in real sprayed clear coat.
export function orangePeel() {
  if (!cache.peel) {
    const size = 256;
    const a = valueNoise(size, 16, 3);
    const b = valueNoise(size, 32, 9);
    const h = a.map((v, i) => v * 0.7 + b[i] * 0.3);
    cache.peel = repeatTexture(heightToNormal(h, size, 1.2), [18, 9]);
  }
  return cache.peel;
}

// Per-pixel random normals: sparkle of metallic / pearl flake.
export function metalFlake() {
  if (!cache.flake) {
    const size = 256;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    const img = ctx.createImageData(size, size);
    const rand = rng(11);
    for (let i = 0; i < size * size; i++) {
      const x = (rand() - 0.5) * 0.9;
      const y = (rand() - 0.5) * 0.9;
      const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
      img.data[i * 4] = (x * 0.5 + 0.5) * 255;
      img.data[i * 4 + 1] = (y * 0.5 + 0.5) * 255;
      img.data[i * 4 + 2] = (z * 0.5 + 0.5) * 255;
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const t = repeatTexture(c, [60, 30]);
    t.magFilter = THREE.NearestFilter;
    cache.flake = t;
  }
  return cache.flake;
}

// 2x2 twill carbon weave, tiles seamlessly. Colour texture.
export function carbonWeave() {
  if (!cache.carbon) {
    const size = 512;
    const cells = 8;
    const cs = size / cells;
    const c = document.createElement('canvas');
    c.width = c.height = size;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#060606';
    ctx.fillRect(0, 0, size, size);
    for (let j = 0; j < cells; j++)
      for (let i = 0; i < cells; i++) {
        const horizontal = (((i - j) % 4) + 4) % 4 < 2;
        const x = i * cs;
        const y = j * cs;
        const g = horizontal ? ctx.createLinearGradient(0, y, 0, y + cs) : ctx.createLinearGradient(x, 0, x + cs, 0);
        const hi = horizontal ? '#46484d' : '#25272a';
        g.addColorStop(0, '#0b0b0c');
        g.addColorStop(0.35, hi);
        g.addColorStop(0.55, hi);
        g.addColorStop(1, '#0b0b0c');
        ctx.fillStyle = g;
        ctx.fillRect(x + 0.5, y + 0.5, cs - 1, cs - 1);
        // fibre streaks
        ctx.strokeStyle = 'rgba(255,255,255,0.05)';
        ctx.lineWidth = 1;
        for (let k = 3; k < cs; k += 4) {
          ctx.beginPath();
          if (horizontal) {
            ctx.moveTo(x + 1, y + k);
            ctx.lineTo(x + cs - 1, y + k);
          } else {
            ctx.moveTo(x + k, y + 1);
            ctx.lineTo(x + k, y + cs - 1);
          }
          ctx.stroke();
        }
      }
    cache.carbon = repeatTexture(c, [1, 1], THREE.SRGBColorSpace);
  }
  return cache.carbon;
}

// Diamond quilting for the comfort liner.
export function quiltNormal() {
  if (!cache.quilt) {
    const size = 256;
    const h = new Float32Array(size * size);
    const fine = valueNoise(size, 64, 5);
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const u = ((x + y) / size) * 4;
        const v = ((x - y + size) / size) * 4;
        const du = Math.abs((u % 1) - 0.5);
        const dv = Math.abs((v % 1) - 0.5);
        const puff = Math.sqrt(Math.max(0, 0.25 - Math.max(du, dv) ** 2 * 0.9)) * 2;
        h[y * size + x] = puff + fine[y * size + x] * 0.08;
      }
    cache.quilt = repeatTexture(heightToNormal(h, size, 3), [14, 6]);
  }
  return cache.quilt;
}
