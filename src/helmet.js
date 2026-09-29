import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// World scale: 1 scene unit = 12.5 cm, so the default shell is ~30 cm long.
export const UNIT_CM = 12.5;

export const FINISHES = {
  gloss: { label: 'Gloss', roughness: 0.2, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0 },
  satin: { label: 'Satin', roughness: 0.45, metalness: 0.05, clearcoat: 0.3, clearcoatRoughness: 0.4, iridescence: 0 },
  matte: { label: 'Matte', roughness: 0.85, metalness: 0.0, clearcoat: 0, clearcoatRoughness: 0, iridescence: 0 },
  metallic: { label: 'Metallic', roughness: 0.32, metalness: 0.75, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0 },
  pearl: { label: 'Pearl', roughness: 0.25, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, iridescence: 0.7 },
  chrome: { label: 'Chrome', roughness: 0.06, metalness: 1.0, clearcoat: 1, clearcoatRoughness: 0.02, iridescence: 0 },
};

export const VISORS = {
  clear: { label: 'Clear', color: '#ffffff', opacity: 0.12, metalness: 0, roughness: 0.02 },
  'light-smoke': { label: 'Light Smoke', color: '#2a2e33', opacity: 0.45, metalness: 0.1, roughness: 0.02 },
  'dark-smoke': { label: 'Dark Smoke', color: '#0b0c0e', opacity: 0.82, metalness: 0.2, roughness: 0.02 },
  'iridium-blue': { label: 'Iridium Blue', color: '#2f6bff', opacity: 0.85, metalness: 0.9, roughness: 0.05 },
  'iridium-gold': { label: 'Iridium Gold', color: '#e0a526', opacity: 0.85, metalness: 0.9, roughness: 0.05 },
  'iridium-red': { label: 'Iridium Red', color: '#ff3b3b', opacity: 0.85, metalness: 0.9, roughness: 0.05 },
  'iridium-silver': { label: 'Mirror Silver', color: '#d8dde3', opacity: 0.9, metalness: 1, roughness: 0.03 },
  rainbow: { label: 'Rainbow', color: '#8fa3ff', opacity: 0.85, metalness: 0.9, roughness: 0.05, iridescence: 1 },
};

export function applyFinish(material, finishId) {
  const f = FINISHES[finishId] || FINISHES.gloss;
  material.roughness = f.roughness;
  material.metalness = f.metalness;
  material.clearcoat = f.clearcoat;
  material.clearcoatRoughness = f.clearcoatRoughness;
  material.iridescence = f.iridescence;
  material.iridescenceIOR = 1.5;
}

// ---------------------------------------------------------------------------
// Procedural full-face helmet
// ---------------------------------------------------------------------------

const PI = Math.PI;
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Shell surface in spherical-ish coordinates.
// theta: azimuth, 0 = front (+Z). phi: polar angle, 0 = crown.
function shellPoint(theta, phi, target = new THREE.Vector3()) {
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const front = Math.max(Math.cos(theta), 0);
  const lower = smoothstep(0.5 * PI, 0.82 * PI, phi);
  const back = Math.max(-Math.cos(theta), 0);
  const narrow = 1 - 0.1 * smoothstep(0.55 * PI, 0.85 * PI, phi) * (0.5 + 0.5 * front);
  const x = 1.0 * s * Math.sin(theta) * narrow;
  const y = 1.04 * c + 0.05 - 0.1 * lower * front * front; // chin drops lower than the nape
  let z = 1.2 * s * Math.cos(theta);
  z += 0.2 * lower * front * front; // chin bar juts forward
  z -= 0.06 * lower * back; // tuck at the nape
  z -= 0.05 * smoothstep(0.1 * PI, 0.4 * PI, phi) * front * (1 - lower); // flatter brow above the eye port
  return target.set(x, y, z);
}

function shellNormal(theta, phi, target = new THREE.Vector3()) {
  const e = 1e-3;
  const a = shellPoint(theta, phi + e, new THREE.Vector3()).sub(shellPoint(theta, phi - e, new THREE.Vector3()));
  const b = shellPoint(theta + e, phi, new THREE.Vector3()).sub(shellPoint(theta - e, phi, new THREE.Vector3()));
  target.crossVectors(a, b);
  if (target.lengthSq() < 1e-12) return target.set(0, 1, 0);
  return target.normalize();
}

const bottomPhi = (theta) => {
  const c = Math.cos(theta);
  return 0.72 * PI + 0.1 * PI * Math.pow(Math.max(c, 0), 1.5) + 0.03 * PI * Math.max(-c, 0);
};

// Eye port as a superellipse in (theta, phi) parameter space.
const PORT = { a: 1.12, b: 0.085 * PI, c: 0.47 * PI, n: 4 };
const VISOR = { a: 1.28, b: 0.115 * PI, c: 0.47 * PI, n: 4 };

const superellipse = (e, theta, phi) =>
  Math.pow(Math.abs(theta / e.a), e.n) + Math.pow(Math.abs((phi - e.c) / e.b), e.n);

// Build a parametric patch, cutting away a superellipse region (or keeping
// only the inside of it) and snapping boundary vertices onto the curve so the
// cut edge is smooth rather than stair-stepped.
function buildPatch({ segU, segV, param, region, keep, scale = 1 }) {
  const params = [];
  const inside = [];
  for (let j = 0; j <= segV; j++)
    for (let i = 0; i <= segU; i++) {
      const [theta, phi] = param(i / segU, j / segV);
      params.push([theta, phi]);
      inside.push(region ? superellipse(region, theta, phi) < 1 : false);
    }

  const idx = (i, j) => j * (segU + 1) + i;
  const tris = [];
  const drop = (a, b, c) => (keep === 'outside' ? inside[a] && inside[b] && inside[c] : !inside[a] && !inside[b] && !inside[c]);
  for (let j = 0; j < segV; j++)
    for (let i = 0; i < segU; i++) {
      const a = idx(i, j), b = idx(i + 1, j), c = idx(i + 1, j + 1), d = idx(i, j + 1);
      if (!region || !drop(a, d, b)) tris.push(a, d, b);
      if (!region || !drop(b, d, c)) tris.push(b, d, c);
    }

  if (region) {
    const used = new Uint8Array(params.length);
    for (const t of tris) used[t] = 1;
    for (let k = 0; k < params.length; k++) {
      if (!used[k]) continue;
      const wrongSide = keep === 'outside' ? inside[k] : !inside[k];
      if (!wrongSide) continue;
      const [theta, phi] = params[k];
      const g = superellipse(region, theta, phi);
      if (g < 1e-6) continue;
      const s = Math.pow(g, -1 / region.n);
      params[k] = [theta * s, region.c + (phi - region.c) * s];
    }
  }

  const pos = new Float32Array(params.length * 3);
  const nor = new Float32Array(params.length * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  params.forEach(([theta, phi], k) => {
    shellPoint(theta, phi, p).multiplyScalar(scale);
    shellNormal(theta, phi, n);
    pos.set([p.x, p.y, p.z], k * 3);
    nor.set([n.x, n.y, n.z], k * 3);
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(tris);
  return geo;
}

function superellipseCurve(e, offset, scale = 1, samples = 160) {
  const pts = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let k = 0; k < samples; k++) {
    const s = (k / samples) * 2 * PI;
    const cs = Math.cos(s), sn = Math.sin(s);
    const theta = e.a * Math.sign(cs) * Math.pow(Math.abs(cs), 2 / e.n);
    const phi = e.c + e.b * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / e.n);
    shellPoint(theta, phi, p);
    shellNormal(theta, phi, n);
    pts.push(p.clone().multiplyScalar(scale).addScaledVector(n, offset));
  }
  return new THREE.CatmullRomCurve3(pts, true);
}

function placeOnShell(object, theta, phi, lift = 0) {
  const p = shellPoint(theta, phi, new THREE.Vector3());
  const n = shellNormal(theta, phi, new THREE.Vector3());
  object.position.copy(p).addScaledVector(n, lift);
  object.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), n);
  return object;
}

export function buildProceduralHelmet() {
  const group = new THREE.Group();
  group.name = 'helmet';

  const paint = new THREE.MeshPhysicalMaterial({ color: '#e10600' });
  applyFinish(paint, 'gloss');
  const trim = new THREE.MeshStandardMaterial({ color: '#111111', roughness: 0.7, metalness: 0 });
  const liner = new THREE.MeshStandardMaterial({ color: '#1a1a1c', roughness: 0.95, side: THREE.BackSide });
  const visorMat = new THREE.MeshPhysicalMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });

  const shellGeo = buildPatch({
    segU: 200,
    segV: 110,
    // Seam sits off to one side at an odd angle so rays along the centre
    // line (used for centring and mirroring) never land exactly on it.
    param: (u, v) => {
      const theta = -0.5 * PI + 0.0137 + u * 2 * PI;
      return [theta, v * bottomPhi(theta)];
    },
    region: PORT,
    keep: 'outside',
  });
  const shell = new THREE.Mesh(shellGeo, paint);
  shell.name = 'shell';
  shell.userData.paintable = true;
  shell.castShadow = true;
  group.add(shell);

  const inner = new THREE.Mesh(shellGeo, liner);
  inner.scale.setScalar(0.95);
  inner.position.y = 0.0025;
  group.add(inner);

  const portTrim = new THREE.Mesh(new THREE.TubeGeometry(superellipseCurve(PORT, -0.012, 0.975), 240, 0.042, 12, true), trim);
  portTrim.name = 'eyeport-gasket';
  group.add(portTrim);

  const bottomPts = [];
  for (let k = 0; k < 200; k++) {
    const theta = -PI + (k / 200) * 2 * PI;
    bottomPts.push(shellPoint(theta, bottomPhi(theta)).multiplyScalar(0.975));
  }
  const neckTrim = new THREE.Mesh(
    new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bottomPts, true), 240, 0.05, 12, true),
    trim,
  );
  neckTrim.name = 'neck-gasket';
  group.add(neckTrim);

  const visorGeo = buildPatch({
    segU: 90,
    segV: 40,
    param: (u, v) => [(-1.35 + u * 2.7), (0.33 + v * 0.3) * PI],
    region: VISOR,
    keep: 'inside',
    scale: 1.045,
  });
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.name = 'visor';
  visor.renderOrder = 1000;
  group.add(visor);

  // Small hardware details
  const pivotGeo = new THREE.CylinderGeometry(0.1, 0.1, 0.04, 32).rotateX(PI / 2);
  for (const side of [-1, 1]) {
    const pivot = placeOnShell(new THREE.Mesh(pivotGeo, trim), side * 1.36, 0.47 * PI, 0.035);
    pivot.name = 'visor-pivot';
    group.add(pivot);
  }
  const tab = placeOnShell(new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.05, 0.05), trim), 0, 0.59 * PI, 0.06);
  group.add(tab);

  const chinVent = placeOnShell(new THREE.Mesh(new THREE.CapsuleGeometry(0.06, 0.26, 6, 16).rotateZ(PI / 2), trim), 0, 0.665 * PI, 0.015);
  chinVent.scale.z = 0.5;
  group.add(chinVent);

  for (const side of [-1, 1]) {
    const topVent = placeOnShell(new THREE.Mesh(new THREE.CapsuleGeometry(0.04, 0.14, 6, 16).rotateX(PI / 2), trim), side * 0.28, 0.2 * PI, 0.012);
    topVent.scale.z = 0.5;
    group.add(topVent);
  }

  const exhaust = placeOnShell(new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.42, 6, 16).rotateZ(PI / 2), trim), PI, 0.58 * PI, 0.01);
  exhaust.scale.z = 0.45;
  group.add(exhaust);

  return {
    group,
    paintables: [shell],
    paintMaterials: [paint],
    trimMaterials: [trim],
    visorMaterials: [visorMat],
    visors: [visor],
    kind: 'procedural',
  };
}

// ---------------------------------------------------------------------------
// Custom helmet models (.glb / .gltf)
//
// Mesh naming convention:
//   *visor*, *glass*, *lens*, *shield*       -> visor material, not paintable
//   *trim*, *rubber*, *gasket*, *liner*,
//   *strap*, *vent*, *hardware*, *nopaint*    -> keep original material
//   anything else                             -> painted shell, stickers allowed
// ---------------------------------------------------------------------------

const VISOR_RE = /visor|glass|lens|shield/i;
const KEEP_RE = /trim|rubber|gasket|liner|strap|vent|hardware|nopaint|pad/i;

export async function loadHelmetModel(file) {
  const url = URL.createObjectURL(file);
  try {
    const gltf = await new GLTFLoader().loadAsync(url);
    const root = gltf.scene;

    const box = new THREE.Box3().setFromObject(root);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const scale = 2.5 / Math.max(size.x, size.y, size.z);
    root.position.sub(center).multiplyScalar(scale);
    root.scale.multiplyScalar(scale);

    const group = new THREE.Group();
    group.name = 'helmet';
    group.add(root);
    group.updateMatrixWorld(true);

    const paint = new THREE.MeshPhysicalMaterial({ color: '#e10600' });
    applyFinish(paint, 'gloss');
    const visorMat = new THREE.MeshPhysicalMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const paintables = [];
    const visors = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      const name = `${o.name} ${o.material?.name || ''}`;
      if (VISOR_RE.test(name)) {
        o.material = visorMat;
        o.renderOrder = 1000;
        visors.push(o);
      } else if (!KEEP_RE.test(name)) {
        if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals();
        o.material = paint;
        o.userData.paintable = true;
        paintables.push(o);
      }
    });
    if (!paintables.length) throw new Error('No paintable meshes found in this model.');
    return { group, paintables, paintMaterials: [paint], trimMaterials: [], visorMaterials: [visorMat], visors, kind: 'custom' };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function applyBase(helmet, base) {
  for (const m of helmet.paintMaterials) {
    m.color.set(base.color);
    applyFinish(m, base.finish);
  }
  for (const m of helmet.trimMaterials) m.color.set(base.trim);
  const v = VISORS[base.visor] || VISORS['dark-smoke'];
  for (const m of helmet.visorMaterials) {
    m.color.set(v.color);
    m.opacity = v.opacity;
    m.metalness = v.metalness;
    m.roughness = v.roughness;
    m.iridescence = v.iridescence || 0;
    m.clearcoat = 1;
  }
  for (const vis of helmet.visors) vis.visible = base.showVisor !== false;
}
