import { UNIT_CM, FINISHES, VISORS } from './helmet.js';

const CM_PER_INCH = 2.54;

// Collects every sticker that needs printing, including mirrored copies.
export function sheetItems(layers) {
  const items = [];
  layers.forEach((layer, i) => {
    if (!layer.visible) return;
    const w = layer.width * UNIT_CM;
    const h = layer.height * UNIT_CM;
    items.push({ layer, n: i + 1, w, h, mirrored: false });
    if (layer.mirror) items.push({ layer, n: i + 1, w, h, mirrored: layer.mirrorFlip !== false, isCopy: true });
  });
  return items;
}

export function sheetSummary(layers) {
  const items = sheetItems(layers);
  const area = items.reduce((s, it) => s + it.w * it.h, 0);
  return { count: items.length, areaCm2: area };
}

// Renders a print-ready production sheet: each sticker at real size with a
// cut box and label. Returns a PNG Blob.
export async function renderProductionSheet({ layers, base, assets, dpi = 150, title = 'F1SHSTICKERS · Helmet kit', preview }) {
  const pxPerCm = dpi / CM_PER_INCH;
  const sheetW = 42; // A3 landscape width in cm
  const margin = 1.5;
  const gap = 1.2;
  const labelH = 0.9;
  const header = preview ? 9 : 3.4;

  const items = sheetItems(layers).sort((a, b) => b.h - a.h);

  // Simple shelf packing
  let x = margin;
  let y = margin + header;
  let shelfH = 0;
  for (const it of items) {
    const w = Math.min(it.w, sheetW - margin * 2);
    if (x + w > sheetW - margin) {
      x = margin;
      y += shelfH + gap + labelH;
      shelfH = 0;
    }
    it.x = x;
    it.y = y;
    x += w + gap;
    shelfH = Math.max(shelfH, it.h);
  }
  const sheetH = Math.max(y + shelfH + labelH + margin, 20);

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sheetW * pxPerCm);
  canvas.height = Math.round(sheetH * pxPerCm);
  const ctx = canvas.getContext('2d');
  const cm = (v) => v * pxPerCm;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Header
  ctx.fillStyle = '#111';
  ctx.font = `700 ${cm(0.8)}px "Titillium Web", sans-serif`;
  ctx.fillText(title.toUpperCase(), cm(margin), cm(margin + 0.6));
  ctx.font = `400 ${cm(0.42)}px "Titillium Web", sans-serif`;
  const info = [
    `Shell: ${base.color.toUpperCase()} ${FINISHES[base.finish]?.label || base.finish}`,
    `Visor: ${VISORS[base.visor]?.label || base.visor}`,
    `${items.length} stickers`,
    `Printed at ${dpi} DPI — sizes are flat-print approximations; test fit before production.`,
  ].join('   ·   ');
  ctx.fillText(info, cm(margin), cm(margin + 1.4));
  ctx.fillStyle = base.color;
  ctx.fillRect(cm(sheetW - margin - 1.6), cm(margin - 0.1), cm(1.6), cm(1.6));
  ctx.strokeStyle = '#999';
  ctx.strokeRect(cm(sheetW - margin - 1.6), cm(margin - 0.1), cm(1.6), cm(1.6));

  if (preview) {
    const img = new Image();
    img.src = preview;
    await img.decode();
    const ph = header - 2.4;
    const pw = (ph * img.width) / img.height;
    ctx.drawImage(img, cm(sheetW - margin - pw), cm(margin + 1.8), cm(pw), cm(ph));
  }

  // Checkerboard behind stickers so white vinyl stays visible.
  const checker = document.createElement('canvas');
  checker.width = checker.height = 16;
  const cctx = checker.getContext('2d');
  cctx.fillStyle = '#f1f1f1';
  cctx.fillRect(0, 0, 16, 16);
  cctx.fillStyle = '#dcdcdc';
  cctx.fillRect(0, 0, 8, 8);
  cctx.fillRect(8, 8, 8, 8);
  const pattern = ctx.createPattern(checker, 'repeat');

  for (const it of items) {
    const art = await assets.printCanvas(it.layer, it.mirrored);
    const w = Math.min(it.w, sheetW - margin * 2);
    const h = it.h * (w / it.w);
    ctx.fillStyle = pattern;
    ctx.fillRect(cm(it.x), cm(it.y), cm(w), cm(h));
    ctx.globalAlpha = it.layer.opacity;
    ctx.drawImage(art, cm(it.x), cm(it.y), cm(w), cm(h));
    ctx.globalAlpha = 1;
    ctx.setLineDash([cm(0.2), cm(0.12)]);
    ctx.strokeStyle = '#ff2d95';
    ctx.lineWidth = Math.max(1, cm(0.03));
    ctx.strokeRect(cm(it.x - 0.15), cm(it.y - 0.15), cm(w + 0.3), cm(h + 0.3));
    ctx.setLineDash([]);
    ctx.fillStyle = '#222';
    ctx.font = `600 ${cm(0.34)}px "Titillium Web", sans-serif`;
    const name = `#${it.n} ${it.layer.name}${it.isCopy ? ' (mirror)' : ''}`;
    ctx.fillText(name, cm(it.x), cm(it.y + h + 0.55), cm(Math.max(w, 4)));
    ctx.font = `400 ${cm(0.3)}px "Titillium Web", sans-serif`;
    const finish = it.layer.finish === 'inherit' ? base.finish : it.layer.finish;
    ctx.fillText(`${it.w.toFixed(1)} × ${it.h.toFixed(1)} cm · ${FINISHES[finish]?.label || finish}`, cm(it.x), cm(it.y + h + 0.9), cm(Math.max(w, 4)));
  }

  return new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
}
