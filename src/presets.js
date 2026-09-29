// Preset vinyl library. Every preset is drawn in white on a transparent
// background so it can be tinted to any colour on the helmet.

const svg = (w, h, inner) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><g fill="#fff">${inner}</g></svg>`;

const poly = (pts) => `<polygon points="${pts}"/>`;

function starPoints(points, outer, inner, cx = 50, cy = 50, rot = -Math.PI / 2) {
  const out = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (i * Math.PI) / points;
    out.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return out.join(' ');
}

function regularPolygon(sides, r, cx = 50, cy = 50, rot = -Math.PI / 2) {
  const out = [];
  for (let i = 0; i < sides; i++) {
    const a = rot + (i * 2 * Math.PI) / sides;
    out.push(`${(cx + r * Math.cos(a)).toFixed(2)},${(cy + r * Math.sin(a)).toFixed(2)}`);
  }
  return out.join(' ');
}

// Deterministic pseudo random so patterns look identical every load.
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function checker(cols, rows, size) {
  let out = '';
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++)
      if ((x + y) % 2 === 0) out += `<rect x="${x * size}" y="${y * size}" width="${size}" height="${size}"/>`;
  return out;
}

function checkerFade() {
  let out = '';
  const size = 20;
  for (let x = 0; x < 16; x++) {
    const s = size * (1 - x / 17);
    for (let y = 0; y < 5; y++) {
      if ((x + y) % 2) continue;
      const o = (size - s) / 2;
      out += `<rect x="${x * size + o}" y="${y * size + o}" width="${s}" height="${s}"/>`;
    }
  }
  return out;
}

function halftone() {
  let out = '';
  const step = 16;
  for (let x = 0; x < 25; x++) {
    const r = (step / 2) * (1 - x / 25) * 1.05;
    if (r < 0.6) continue;
    for (let y = 0; y < 7; y++) {
      const cy = y * step + step / 2 + (x % 2 ? step / 2 : 0);
      if (cy > 7 * step) continue;
      out += `<circle cx="${x * step + step / 2}" cy="${cy}" r="${r.toFixed(2)}"/>`;
    }
  }
  return out;
}

function hexGrid() {
  let out = '';
  const r = 12;
  const w = Math.sqrt(3) * r;
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 9; col++) {
      const cx = col * w + (row % 2 ? w / 2 : 0) + w / 2;
      const cy = row * r * 1.5 + r;
      out += `<polygon points="${regularPolygon(6, r - 1.5, cx, cy, Math.PI / 6)}" fill="none" stroke="#fff" stroke-width="2.4"/>`;
    }
  return out;
}

function camo() {
  const rand = rng(7);
  let out = '';
  for (let i = 0; i < 26; i++) {
    const cx = rand() * 200;
    const cy = rand() * 200;
    const pts = [];
    const n = 7;
    const base = 10 + rand() * 18;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const r = base * (0.6 + rand() * 0.7);
      pts.push([cx + Math.cos(a) * r * 1.4, cy + Math.sin(a) * r]);
    }
    // Smooth closed blob through the points.
    let d = `M${((pts[0][0] + pts[n - 1][0]) / 2).toFixed(1)},${((pts[0][1] + pts[n - 1][1]) / 2).toFixed(1)}`;
    for (let k = 0; k < n; k++) {
      const p = pts[k];
      const q = pts[(k + 1) % n];
      d += ` Q${p[0].toFixed(1)},${p[1].toFixed(1)} ${((p[0] + q[0]) / 2).toFixed(1)},${((p[1] + q[1]) / 2).toFixed(1)}`;
    }
    out += `<path d="${d}Z"/>`;
  }
  return out;
}

function pixelFade() {
  const rand = rng(42);
  let out = '';
  const s = 10;
  for (let x = 0; x < 40; x++)
    for (let y = 0; y < 10; y++)
      if (rand() > x / 40) out += `<rect x="${x * s}" y="${y * s}" width="${s - 1}" height="${s - 1}"/>`;
  return out;
}

function triangleFade() {
  let out = '';
  const s = 20;
  for (let x = 0; x < 20; x++) {
    const k = 1 - x / 21;
    for (let y = 0; y < 5; y++) {
      const cx = x * s + s / 2;
      const cy = y * s + s / 2;
      const h = (s / 2) * k;
      out += poly(`${cx - h},${cy + h} ${cx + h},${cy + h} ${cx},${cy - h}`);
    }
  }
  return out;
}

function diagonalPinstripes() {
  let out = '';
  for (let i = -10; i < 20; i++) out += poly(`${i * 14},0 ${i * 14 + 5},0 ${i * 14 + 105},100 ${i * 14 + 100},100`);
  return `<clipPath id="c"><rect width="200" height="100"/></clipPath><g clip-path="url(#c)">${out}</g>`;
}

function carbonWeave() {
  let out = '';
  const s = 12;
  for (let y = 0; y < 10; y++)
    for (let x = 0; x < 10; x++) {
      const horiz = (x + y) % 2 === 0;
      out += horiz
        ? `<rect x="${x * s + 0.5}" y="${y * s + 2}" width="${s - 1}" height="${s - 4}" rx="2" opacity="0.85"/>`
        : `<rect x="${x * s + 2}" y="${y * s + 0.5}" width="${s - 4}" height="${s - 1}" rx="2" opacity="0.45"/>`;
    }
  return out;
}

function speedLines() {
  const rows = [
    [120, 400], [40, 400], [200, 400], [80, 400], [160, 400], [20, 400],
  ];
  return rows
    .map(([x0, x1], i) => `<rect x="${x0}" y="${i * 20 + 4}" width="${x1 - x0}" height="10" rx="5"/>`)
    .join('');
}

function fadeBars() {
  let out = '';
  let x = 0;
  for (let i = 0; i < 12; i++) {
    const w = 30 * Math.pow(0.8, i);
    out += `<rect x="${x.toFixed(1)}" y="0" width="${w.toFixed(1)}" height="100"/>`;
    x += w + 8 * Math.pow(0.85, i) + 4;
  }
  return out;
}

function chevronStripe() {
  let out = '';
  for (let i = 0; i < 8; i++) {
    const x = i * 50;
    out += poly(`${x},0 ${x + 22},0 ${x + 52},40 ${x + 22},80 ${x},80 ${x + 30},40`);
  }
  return out;
}

function sharkTeeth() {
  const pts = ['0,0'];
  for (let i = 0; i <= 10; i++) pts.push(`${i * 40},0`, `${i * 40 + 20},60`);
  pts.push('400,0');
  return poly(pts.join(' '));
}

function wave() {
  let d = 'M0,40';
  for (let x = 0; x <= 400; x += 5) d += ` L${x},${(40 + Math.sin((x / 400) * Math.PI * 4) * 22).toFixed(2)}`;
  return `<path d="${d}" fill="none" stroke="#fff" stroke-width="14" stroke-linecap="round"/>`;
}

const wingPath =
  'M100 40 C80 20 50 8 0 10 C18 18 28 22 36 27 C20 27 10 31 2 38 C22 39 34 41 44 45 C30 47 20 53 14 60 C38 57 58 57 74 60 C88 62 96 60 100 56Z';

export const PRESET_CATEGORIES = [
  {
    id: 'shapes',
    label: 'Shapes',
    items: [
      { id: 'circle', name: 'Circle', svg: svg(100, 100, '<circle cx="50" cy="50" r="50"/>') },
      { id: 'ring', name: 'Ring', svg: svg(100, 100, '<circle cx="50" cy="50" r="44" fill="none" stroke="#fff" stroke-width="12"/>') },
      { id: 'square', name: 'Square', svg: svg(100, 100, '<rect width="100" height="100"/>') },
      { id: 'rounded', name: 'Rounded Box', svg: svg(100, 100, '<rect width="100" height="100" rx="20"/>') },
      { id: 'triangle', name: 'Triangle', svg: svg(100, 88, poly('50,0 100,88 0,88')) },
      { id: 'star', name: 'Star', svg: svg(100, 100, poly(starPoints(5, 50, 20, 50, 53))) },
      { id: 'burst', name: 'Star Burst', svg: svg(100, 100, poly(starPoints(14, 50, 34))) },
      { id: 'hexagon', name: 'Hexagon', svg: svg(100, 100, poly(regularPolygon(6, 50))) },
      { id: 'diamond', name: 'Diamond', svg: svg(70, 100, poly('35,0 70,50 35,100 0,50')) },
      { id: 'heart', name: 'Heart', svg: svg(100, 88, '<path d="M50 88 C20 65 0 48 0 28 C0 12 12 0 27 0 C38 0 46 6 50 14 C54 6 62 0 73 0 C88 0 100 12 100 28 C100 48 80 65 50 88Z"/>') },
      { id: 'chevron', name: 'Chevron', svg: svg(100, 100, poly('0,0 40,0 100,50 40,100 0,100 60,50')) },
      { id: 'arrow', name: 'Arrow', svg: svg(100, 100, poly('0,35 60,35 60,10 100,50 60,90 60,65 0,65')) },
      { id: 'bolt', name: 'Lightning', svg: svg(100, 100, poly('58,0 14,58 44,58 30,100 86,36 56,36 72,0')) },
      { id: 'crescent', name: 'Crescent', svg: svg(100, 100, '<mask id="m"><rect width="100" height="100" fill="#fff"/><circle cx="68" cy="40" r="40" fill="#000"/></mask><circle cx="50" cy="50" r="50" mask="url(#m)"/>') },
      { id: 'cross', name: 'Plus', svg: svg(100, 100, poly('35,0 65,0 65,35 100,35 100,65 65,65 65,100 35,100 35,65 0,65 0,35 35,35')) },
      { id: 'shield', name: 'Shield', svg: svg(100, 100, '<path d="M50 0 L95 15 V45 C95 72 75 90 50 100 C25 90 5 72 5 45 V15Z"/>') },
    ],
  },
  {
    id: 'stripes',
    label: 'Stripes',
    items: [
      { id: 'stripe', name: 'Stripe', svg: svg(400, 40, '<rect width="400" height="40"/>') },
      { id: 'twin', name: 'Twin Stripe', svg: svg(400, 100, '<rect width="400" height="40"/><rect y="60" width="400" height="40"/>') },
      { id: 'triple', name: 'Triple Stripe', svg: svg(400, 100, '<rect width="400" height="26"/><rect y="37" width="400" height="26"/><rect y="74" width="400" height="26"/>') },
      { id: 'gt-stripe', name: 'GT Stripe', svg: svg(400, 100, '<rect width="400" height="6"/><rect y="14" width="400" height="72"/><rect y="94" width="400" height="6"/>') },
      { id: 'pinstripe', name: 'Pinstripe', svg: svg(400, 20, '<rect width="400" height="6"/><rect y="14" width="400" height="6"/>') },
      { id: 'swoosh', name: 'Swoosh', svg: svg(400, 60, '<path d="M0 50 C120 20 280 0 400 0 C300 20 150 45 0 60Z"/>') },
      { id: 'blade', name: 'Blade', svg: svg(200, 90, '<path d="M0 50 C60 45 110 20 200 0 C150 30 120 45 110 55 C140 58 170 70 200 90 C130 78 70 62 0 50Z"/>') },
      { id: 'speed', name: 'Speed Lines', svg: svg(400, 120, speedLines()) },
      { id: 'slash', name: 'Slashes', svg: svg(200, 100, poly('0,100 40,0 70,0 30,100') + poly('55,100 95,0 125,0 85,100') + poly('110,100 150,0 180,0 140,100')) },
      { id: 'fade-bars', name: 'Fade Bars', svg: svg(200, 100, fadeBars()) },
      { id: 'chevron-stripe', name: 'Chevron Band', svg: svg(402, 80, chevronStripe()) },
      { id: 'teeth', name: 'Shark Teeth', svg: svg(400, 60, sharkTeeth()) },
      { id: 'wave', name: 'Wave', svg: svg(400, 80, wave()) },
    ],
  },
  {
    id: 'racing',
    label: 'Racing',
    items: [
      { id: 'checkered', name: 'Checkered Flag', svg: svg(160, 100, checker(8, 5, 20)) },
      { id: 'checker-fade', name: 'Checker Fade', svg: svg(320, 100, checkerFade()) },
      { id: 'roundel', name: 'Number Roundel', svg: svg(100, 100, '<circle cx="50" cy="50" r="47" fill="none" stroke="#fff" stroke-width="6"/><circle cx="50" cy="50" r="38"/>') },
      { id: 'plate', name: 'Number Plate', svg: svg(140, 100, '<rect x="3" y="3" width="134" height="94" rx="22" fill="none" stroke="#fff" stroke-width="6"/><rect x="13" y="13" width="114" height="74" rx="14"/>') },
      { id: 'flame', name: 'Flames', svg: svg(300, 120, '<path d="M0 60 C40 40 70 55 100 40 C120 30 130 10 160 5 C145 25 150 35 175 30 C200 25 215 10 245 12 C225 25 230 38 260 40 C280 42 290 50 300 55 C270 60 250 58 230 70 C250 72 265 85 280 95 C245 92 220 82 195 88 C175 93 165 105 140 115 C150 98 140 90 120 92 C90 95 60 100 0 60Z"/>') },
      { id: 'wings', name: 'Wings', svg: svg(200, 70, `<path d="${wingPath}"/><path d="${wingPath}" transform="translate(200 0) scale(-1 1)"/>`) },
      { id: 'target', name: 'Target', svg: svg(100, 100, '<circle cx="50" cy="50" r="46" fill="none" stroke="#fff" stroke-width="8"/><circle cx="50" cy="50" r="28" fill="none" stroke="#fff" stroke-width="8"/><circle cx="50" cy="50" r="10"/>') },
      { id: 'crown', name: 'Crown', svg: svg(100, 80, poly('0,20 25,45 50,0 75,45 100,20 90,70 10,70') + '<rect x="10" y="74" width="80" height="6"/>') },
      { id: 'skull', name: 'Skull', svg: svg(100, 110, '<mask id="m"><rect width="100" height="110" fill="#fff"/><ellipse cx="32" cy="50" rx="13" ry="15" fill="#000"/><ellipse cx="68" cy="50" rx="13" ry="15" fill="#000"/><path d="M50 64 L43 78 H57Z" fill="#000"/><rect x="36" y="92" width="5" height="18" fill="#000"/><rect x="48" y="92" width="5" height="18" fill="#000"/><rect x="60" y="92" width="5" height="18" fill="#000"/></mask><g mask="url(#m)"><path d="M50 0 C80 0 100 20 100 50 C100 68 92 78 82 84 V110 H18 V84 C8 78 0 68 0 50 C0 20 20 0 50 0Z"/></g>') },
      { id: 'number-1', name: 'Pole Position', svg: svg(100, 100, '<mask id="m"><rect width="100" height="100" fill="#fff"/><path d="M42 22 H58 V78 H44 V38 L34 44 V30Z" fill="#000"/></mask><circle cx="50" cy="50" r="50" mask="url(#m)"/>') },
    ],
  },
  {
    id: 'patterns',
    label: 'Patterns',
    items: [
      { id: 'checker-grid', name: 'Checker', svg: svg(160, 160, checker(8, 8, 20)) },
      { id: 'halftone', name: 'Halftone Fade', svg: svg(400, 112, halftone()) },
      { id: 'hex', name: 'Hex Grid', svg: svg(195, 190, hexGrid()) },
      { id: 'camo', name: 'Camo', svg: svg(200, 200, camo()) },
      { id: 'pixels', name: 'Pixel Fade', svg: svg(400, 100, pixelFade()) },
      { id: 'tri-fade', name: 'Triangle Fade', svg: svg(400, 100, triangleFade()) },
      { id: 'diag', name: 'Diagonal Lines', svg: svg(200, 100, diagonalPinstripes()) },
      { id: 'carbon', name: 'Carbon Weave', svg: svg(120, 120, carbonWeave()) },
    ],
  },
];

export const PRESETS = new Map(PRESET_CATEGORIES.flatMap((c) => c.items.map((i) => [i.id, i])));

// Quick-start text styles offered in the library's Text tab.
export const TEXT_PRESETS = [
  { name: 'Pixel Number', text: { value: '99', font: 'Bitcount Single', italic: false, weight: 700, fill: '#ffffff', stroke: '#111111', strokeWidth: 0, spacing: 4 } },
  { name: 'Race Number', text: { value: '46', font: 'Russo One', italic: true, weight: 400, fill: '#ffffff', stroke: '#111111', strokeWidth: 6, spacing: 0 } },
  { name: 'Rider Name', text: { value: 'YOUR NAME', font: 'Bebas Neue', italic: false, weight: 400, fill: '#ffffff', stroke: '#111111', strokeWidth: 0, spacing: 6 } },
  { name: 'Signature', text: { value: 'Signature', font: 'Permanent Marker', italic: false, weight: 400, fill: '#ffffff', stroke: '#111111', strokeWidth: 0, spacing: 0 } },
  { name: 'Tech', text: { value: 'RACING', font: 'Orbitron', italic: false, weight: 800, fill: '#ffffff', stroke: '#111111', strokeWidth: 0, spacing: 4 } },
  { name: 'Speed Italic', text: { value: 'FAST', font: 'Racing Sans One', italic: true, weight: 400, fill: '#ffffff', stroke: '#e10600', strokeWidth: 8, spacing: 0 } },
  { name: 'Chunky', text: { value: 'MOTO', font: 'Bungee', italic: false, weight: 400, fill: '#ffffff', stroke: '#111111', strokeWidth: 0, spacing: 0 } },
];

export const FONTS = ['Bitcount Single', 'Russo One', 'Bebas Neue', 'Permanent Marker', 'Orbitron', 'Racing Sans One', 'Bungee', 'Teko', 'Titillium Web', 'Arial', 'Impact'];
