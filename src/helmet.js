import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { carbonWeave, metalFlake, orangePeel, quiltNormal } from './textures.js';

// World scale: 1 scene unit = 12.5 cm, so the default shell is ~31 cm long.
export const UNIT_CM = 12.5;

export const FINISHES = {
  gloss: { label: 'Gloss', note: 'Deep wet-look clear coat', roughness: 0.16, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.02 },
  satin: { label: 'Satin', note: 'Soft low-sheen lacquer', roughness: 0.42, metalness: 0.05, clearcoat: 0.35, clearcoatRoughness: 0.35 },
  matte: { label: 'Matte', note: 'Flat, no reflections', roughness: 0.78, metalness: 0.0, clearcoat: 0, clearcoatRoughness: 0 },
  metallic: { label: 'Metallic', note: 'Metal flake under clear', roughness: 0.34, metalness: 0.72, clearcoat: 1, clearcoatRoughness: 0.03, flake: 0.35 },
  pearl: { label: 'Pearl', note: 'Colour-shifting pearlescent', roughness: 0.28, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.03, flake: 0.2, iridescence: 0.75 },
  chrome: { label: 'Chrome', note: 'Mirror-polished', roughness: 0.04, metalness: 1.0, clearcoat: 1, clearcoatRoughness: 0.02 },
  carbon: { label: 'Carbon', note: 'Exposed 2×2 twill carbon fibre', roughness: 0.35, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.02, carbon: true, shellOnly: true },
};

export const VISORS = {
  clear: { label: 'Clear', color: '#ffffff', opacity: 0.1, metalness: 0, roughness: 0.02 },
  'light-smoke': { label: 'Light Smoke', color: '#2a2e33', opacity: 0.42, metalness: 0.1, roughness: 0.02 },
  'dark-smoke': { label: 'Dark Smoke', color: '#07080a', opacity: 0.8, metalness: 0.2, roughness: 0.02 },
  'iridium-blue': { label: 'Iridium Blue', color: '#2f6bff', opacity: 0.86, metalness: 0.9, roughness: 0.04 },
  'iridium-gold': { label: 'Iridium Gold', color: '#e0a526', opacity: 0.86, metalness: 0.9, roughness: 0.04 },
  'iridium-red': { label: 'Iridium Red', color: '#ff3b3b', opacity: 0.86, metalness: 0.9, roughness: 0.04 },
  'iridium-silver': { label: 'Mirror Silver', color: '#d8dde3', opacity: 0.9, metalness: 1, roughness: 0.03 },
  rainbow: { label: 'Rainbow', color: '#8fa3ff', opacity: 0.86, metalness: 0.9, roughness: 0.04, iridescence: 1 },
};

// Adds triplanar carbon weave support to a physical material, driven by a
// uniform so switching finishes never recompiles the shader.
function enableCarbon(material) {
  const uniforms = { triMap: { value: carbonWeave() }, triStrength: { value: 0 }, triScale: { value: 6.5 } };
  material.userData.carbon = uniforms;
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTriPos;\nvarying vec3 vTriNormal;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvTriPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvTriNormal = normalize(mat3(modelMatrix) * objectNormal);',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform sampler2D triMap;\nuniform float triStrength;\nuniform float triScale;\nvarying vec3 vTriPos;\nvarying vec3 vTriNormal;',
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
        if (triStrength > 0.0) {
          vec3 bw = pow(abs(vTriNormal), vec3(4.0));
          bw /= (bw.x + bw.y + bw.z);
          vec3 p = vTriPos * triScale;
          vec3 weave = texture2D(triMap, p.zy).rgb * bw.x + texture2D(triMap, p.xz).rgb * bw.y + texture2D(triMap, p.xy).rgb * bw.z;
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * weave * 1.7, triStrength);
        }`,
      );
  };
  material.customProgramCacheKey = () => 'carbon-tri';
}

export function applyFinish(material, finishId) {
  let f = FINISHES[finishId] || FINISHES.gloss;
  if (f.shellOnly && !material.userData.carbon) f = FINISHES.gloss;
  material.roughness = f.roughness;
  material.metalness = f.metalness;
  material.clearcoat = f.clearcoat;
  material.clearcoatRoughness = f.clearcoatRoughness;
  material.iridescence = f.iridescence || 0;
  material.iridescenceIOR = 1.5;
  const normalMap = f.flake ? metalFlake() : null;
  const peel = f.clearcoat > 0 ? orangePeel() : null;
  if (material.normalMap !== normalMap || material.clearcoatNormalMap !== peel) {
    material.normalMap = normalMap;
    material.clearcoatNormalMap = peel;
    material.needsUpdate = true;
  }
  if (f.flake) material.normalScale.setScalar(f.flake);
  material.clearcoatNormalScale.setScalar(0.08);
  if (material.userData.carbon) material.userData.carbon.triStrength.value = f.carbon ? 1 : 0;
}

// ---------------------------------------------------------------------------
// Procedural race helmet, styled on modern track helmets (long tail, big
// integrated spoiler, sculpted visor pods, brow intakes, pointed chin bar).
// ---------------------------------------------------------------------------

const PI = Math.PI;
const smoothstep = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// theta: azimuth, 0 = front (+Z), +PI/2 = +X. phi: polar angle, 0 = crown.
function shellPoint(theta, phi, target = new THREE.Vector3()) {
  const s = Math.sin(phi);
  const c = Math.cos(phi);
  const ct = Math.cos(theta);
  const front = Math.max(ct, 0);
  const back = Math.max(-ct, 0);
  const lower = smoothstep(0.5 * PI, 0.88 * PI, phi);
  const chin = lower * Math.pow(front, 2);
  const brow = smoothstep(0.08 * PI, 0.42 * PI, phi) * (1 - smoothstep(0.42 * PI, 0.5 * PI, phi));
  const nape = smoothstep(0.58 * PI, 0.74 * PI, phi) * back;

  // Long, slightly tapering tail; narrow, pointed chin.
  const narrow = 1 - 0.13 * lower * Math.pow(front, 1.4) - 0.04 * lower;
  const x = 1.0 * s * Math.sin(theta) * narrow * (1 + 0.035 * nape);
  let y = 1.02 * c + 0.06;
  let z = (1.2 - 0.05 * ct) * s * ct;

  z += 0.24 * chin; // chin bar pushes forward…
  y -= 0.13 * chin; // …and down
  z -= 0.06 * brow * front * front; // flatter brow over the eye port
  y += 0.035 * Math.exp(-((phi - 0.2 * PI) ** 2) / 0.06) * back; // raised crown line leading into the spoiler
  z -= 0.05 * nape * (1 - 0.6 * smoothstep(0.7 * PI, 0.74 * PI, phi)); // tucked nape…
  y -= 0.03 * nape;
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

// Lower edge: low at the chin, rising along the jaw, with a short rear lip.
const bottomPhi = (theta) => {
  const c = Math.cos(theta);
  return 0.745 * PI + 0.125 * PI * Math.pow(Math.max(c, 0), 1.4) - 0.035 * PI * Math.max(-c, 0);
};

// Regions are superellipses in (theta, phi) space with separate top/bottom
// heights, so the eye port can have a straight brow and a deeper lower edge.
const PORT = { t: 0, a: 1.16, bTop: 0.074 * PI, bBot: 0.1 * PI, c: 0.462 * PI, n: 4 };
const VISOR = { t: 0, a: 1.31, bTop: 0.098 * PI, bBot: 0.128 * PI, c: 0.462 * PI, n: 4 };

function superellipse(e, theta, phi) {
  const b = phi < e.c ? e.bTop : e.bBot;
  return Math.pow(Math.abs((theta - e.t) / e.a), e.n) + Math.pow(Math.abs((phi - e.c) / b), e.n);
}

// Parametric patch over the shell. Optionally cuts away (keep: 'outside') or
// keeps only (keep: 'inside') a superellipse region, snapping boundary
// vertices onto the curve for a smooth edge. `lift(theta, phi, g)` raises the
// surface along the normal for sculpted pads.
function buildPatch({ segU, segV, param, region, keep, scale = 1, lift, uvScale = [1, 1] }) {
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
      params[k] = [region.t + (theta - region.t) * s, region.c + (phi - region.c) * s];
    }
  }

  const count = params.length;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const edge = new Float32Array(count);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  params.forEach(([theta, phi], k) => {
    shellPoint(theta, phi, p).multiplyScalar(scale);
    shellNormal(theta, phi, n);
    const g = region ? superellipse(region, theta, phi) : 0;
    if (lift) p.addScaledVector(n, lift(theta, phi, g));
    pos.set([p.x, p.y, p.z], k * 3);
    nor.set([n.x, n.y, n.z], k * 3);
    uv.set([(k % (segU + 1)) / segU * uvScale[0], Math.floor(k / (segU + 1)) / segV * uvScale[1]], k * 2);
    edge[k] = g;
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('edge', new THREE.BufferAttribute(edge, 1));
  geo.setIndex(tris);
  if (lift) geo.computeVertexNormals();
  return geo;
}

// A raised, sculpted pad sitting on the shell (visor pods, vent housings).
function buildPad({ t, c, a, b, n = 3, height, wall = 0.75, segs = 48 }) {
  const region = { t, a, bTop: b, bBot: b, c, n };
  return buildPatch({
    segU: segs,
    segV: segs,
    param: (u, v) => [t - a * 1.05 + u * a * 2.1, c - b * 1.05 + v * b * 2.1],
    region,
    keep: 'inside',
    lift: (th, ph, g) => height * (1 - smoothstep(wall, 1, g)) + 0.002,
  });
}

function regionCurve(e, offset, scale = 1, samples = 180, liftFn) {
  const pts = [];
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let k = 0; k < samples; k++) {
    const s = (k / samples) * 2 * PI;
    const cs = Math.cos(s), sn = Math.sin(s);
    const theta = e.t + e.a * Math.sign(cs) * Math.pow(Math.abs(cs), 2 / e.n);
    const b = sn < 0 ? e.bTop : e.bBot;
    const phi = e.c + b * Math.sign(sn) * Math.pow(Math.abs(sn), 2 / e.n);
    shellPoint(theta, phi, p);
    shellNormal(theta, phi, n);
    pts.push(p.clone().multiplyScalar(scale).addScaledVector(n, offset + (liftFn ? liftFn(theta, phi) : 0)));
  }
  return new THREE.CatmullRomCurve3(pts, true);
}

function placeOnShell(object, theta, phi, lift = 0, spin = 0) {
  const p = shellPoint(theta, phi, new THREE.Vector3());
  const n = shellNormal(theta, phi, new THREE.Vector3());
  object.position.copy(p).addScaledVector(n, lift);
  // Orient +Z along the normal and +Y towards the crown so parts line up.
  const up = new THREE.Vector3(0, 1, 0).addScaledVector(n, -n.y);
  if (up.lengthSq() < 1e-4) up.set(0, 0, 1);
  up.normalize();
  const right = new THREE.Vector3().crossVectors(up, n);
  object.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n));
  if (spin) object.rotateZ(spin);
  return object;
}

// Grid surface from a point function f(u, v) -> Vector3.
function gridGeometry(nu, nv, f, flip = false) {
  const pos = [];
  const uv = [];
  for (let j = 0; j <= nv; j++)
    for (let i = 0; i <= nu; i++) {
      const p = f(i / nu, j / nv);
      pos.push(p.x, p.y, p.z);
      uv.push(i / nu, j / nv);
    }
  const index = [];
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const a = j * (nu + 1) + i, b = a + 1, c = a + nu + 2, d = a + nu + 1;
      if (flip) index.push(a, b, d, b, c, d);
      else index.push(a, d, b, b, d, c);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

// Integrated rear spoiler: rises out of the crown and kicks up past the tail,
// with endplates at each side.
function buildSpoiler() {
  const SPAN = 0.5;
  const PHI0 = 0.16 * PI;
  const DPHI = 0.28 * PI;
  const span = (s) => 1 - 0.3 * Math.pow(Math.abs(s), 3);
  // Upper skin rises out of the crown; the lower skin peels away from the
  // shell over the back half, leaving a deep air channel under the lip.
  const upper = (c, s) => (0.3 * Math.pow(c, 2.1) + 0.02 * Math.sin(c * PI)) * span(s);
  const lower = (c, s) => 0.255 * Math.pow(smoothstep(0.35, 1, c), 1.5) * span(s);
  const at = (s, c, h) => {
    const theta = PI + s * SPAN * (1 - 0.15 * c);
    const phi = PHI0 + c * DPHI;
    const p = shellPoint(theta, phi, new THREE.Vector3());
    return p.addScaledVector(shellNormal(theta, phi, new THREE.Vector3()), h);
  };
  const top = gridGeometry(80, 40, (u, v) => {
    const s = u * 2 - 1;
    return at(s, v, upper(v, s));
  });
  const under = gridGeometry(80, 30, (u, v) => {
    const s = u * 2 - 1;
    return at(s, v, lower(v, s) + 0.001);
  }, true);
  const trailing = gridGeometry(80, 4, (u, v) => {
    const s = u * 2 - 1;
    return at(s, 1, THREE.MathUtils.lerp(upper(1, s), lower(1, s), v));
  });
  const plates = [-1, 1].map((s) =>
    gridGeometry(30, 4, (u, v) => {
      // Endplates reach slightly below the wing like small fins.
      const c = u;
      const lo = Math.max(0, lower(c, s) - 0.06 * smoothstep(0.4, 1, c));
      return at(s, c, THREE.MathUtils.lerp(upper(c, s), lo, v));
    }, s > 0),
  );
  return { top, under, trailing, plates };
}

function capsuleSlot(len, radius, depth) {
  const g = new THREE.CapsuleGeometry(radius, len, 6, 20).rotateZ(PI / 2);
  g.scale(1, 1, depth / radius);
  return g;
}

export function buildProceduralHelmet() {
  const group = new THREE.Group();
  group.name = 'helmet';

  const paint = new THREE.MeshPhysicalMaterial({ color: '#e10600' });
  enableCarbon(paint);
  applyFinish(paint, 'gloss');
  // Same paint for spoiler undersides/endplates, visible from both sides.
  const paintBoth = new THREE.MeshPhysicalMaterial({ color: '#e10600', side: THREE.DoubleSide });
  enableCarbon(paintBoth);
  applyFinish(paintBoth, 'gloss');
  // Moulded plastic parts (pods, vents): take the "trim" colour.
  const hardware = new THREE.MeshPhysicalMaterial({ color: '#111111', roughness: 0.32, metalness: 0.1, clearcoat: 0.6, clearcoatRoughness: 0.15 });
  const ventDark = new THREE.MeshStandardMaterial({ color: '#030304', roughness: 0.9 });
  const ventDarkBoth = new THREE.MeshStandardMaterial({ color: '#0a0a0b', roughness: 0.6, side: THREE.DoubleSide });
  const rubber = new THREE.MeshPhysicalMaterial({ color: '#0b0b0c', roughness: 0.82, sheen: 0.4, sheenRoughness: 0.8, sheenColor: new THREE.Color('#333') });
  const liner = new THREE.MeshPhysicalMaterial({
    color: '#1d1e21',
    roughness: 0.9,
    sheen: 1,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color('#6b6f78'),
    normalMap: quiltNormal(),
    normalScale: new THREE.Vector2(0.9, 0.9),
    side: THREE.BackSide,
  });
  const visorMat = new THREE.MeshPhysicalMaterial({
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    envMapIntensity: 1.4,
  });

  const cast = (m) => ((m.castShadow = true), (m.receiveShadow = true), m);

  // Shell -------------------------------------------------------------------
  const shellGeo = buildPatch({
    segU: 260,
    segV: 140,
    // Seam sits off to one side at an odd angle so rays along the centre
    // line (used for centring and mirroring) never land exactly on it.
    param: (u, v) => {
      const theta = -0.5 * PI + 0.0137 + u * 2 * PI;
      return [theta, v * bottomPhi(theta)];
    },
    region: PORT,
    keep: 'outside',
    uvScale: [1, 1],
  });
  const shell = cast(new THREE.Mesh(shellGeo, paint));
  shell.name = 'shell';
  shell.userData.paintable = true;
  group.add(shell);

  const inner = new THREE.Mesh(shellGeo, liner);
  inner.scale.setScalar(0.94);
  inner.position.y = 0.004;
  group.add(inner);

  // Spoiler (paintable, takes stickers) ---------------------------------------
  const sp = buildSpoiler();
  const spoiler = cast(new THREE.Mesh(sp.top, paint));
  spoiler.name = 'spoiler';
  spoiler.userData.paintable = true;
  group.add(spoiler);
  group.add(cast(new THREE.Mesh(sp.under, ventDarkBoth)));
  for (const g of [sp.trailing, ...sp.plates]) group.add(cast(new THREE.Mesh(g, paintBoth)));

  // Rear exhaust slots, tucked under the spoiler
  for (const side of [-1, 1]) {
    const slot = placeOnShell(new THREE.Mesh(capsuleSlot(0.16, 0.022, 0.012), ventDark), PI + side * 0.17, 0.43 * PI, 0.004);
    group.add(slot);
  }

  // Gaskets -----------------------------------------------------------------
  const portTrim = new THREE.Mesh(new THREE.TubeGeometry(regionCurve(PORT, -0.018, 0.985), 320, 0.03, 14, true), rubber);
  portTrim.name = 'eyeport-gasket';
  group.add(portTrim);

  const bottomPts = [];
  const bp = new THREE.Vector3();
  const bn = new THREE.Vector3();
  for (let k = 0; k < 240; k++) {
    const theta = -PI + (k / 240) * 2 * PI;
    const phi = bottomPhi(theta);
    shellPoint(theta, phi, bp);
    shellNormal(theta, phi, bn);
    bottomPts.push(bp.clone().multiplyScalar(0.985).addScaledVector(bn, -0.02));
  }
  const neckGeo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(bottomPts, true), 320, 0.055, 16, true);
  const neck = cast(new THREE.Mesh(neckGeo, rubber));
  neck.name = 'neck-roll';
  group.add(neck);

  // Visor pods (pivot covers) -------------------------------------------------
  for (const side of [-1, 1]) {
    const pod = cast(new THREE.Mesh(buildPad({ t: side * 1.4, c: 0.47 * PI, a: 0.3, b: 0.078 * PI, n: 2.6, height: 0.048, wall: 0.5 }), hardware));
    pod.name = 'visor-pod';
    group.add(pod);
    const screw = placeOnShell(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.02, 24).rotateX(PI / 2), ventDark), side * 1.43, 0.47 * PI, 0.052);
    group.add(screw);
  }

  // Brow intakes ------------------------------------------------------------
  for (const side of [-1, 1]) {
    const t = side * 0.3;
    const pad = cast(new THREE.Mesh(buildPad({ t, c: 0.25 * PI, a: 0.12, b: 0.095 * PI, n: 3, height: 0.045, wall: 0.55 }), hardware));
    pad.name = 'brow-vent';
    group.add(pad);
    const slot = placeOnShell(new THREE.Mesh(capsuleSlot(0.1, 0.018, 0.012), ventDark), t, 0.315 * PI, 0.046);
    slot.rotateX(-0.5);
    group.add(slot);
    const slider = placeOnShell(new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.035, 0.02), ventDark), t, 0.22 * PI, 0.047);
    group.add(slider);
  }

  // Chin vents ----------------------------------------------------------------
  const chinPad = cast(new THREE.Mesh(buildPad({ t: 0, c: 0.665 * PI, a: 0.24, b: 0.045 * PI, n: 3, height: 0.03, wall: 0.55 }), hardware));
  chinPad.name = 'chin-vent';
  group.add(chinPad);
  for (let k = -1; k <= 1; k++) {
    const slot = placeOnShell(new THREE.Mesh(capsuleSlot(0.07, 0.012, 0.01), ventDark), k * 0.1, 0.667 * PI, 0.031);
    group.add(slot);
  }
  for (const side of [-1, 1]) {
    const intake = placeOnShell(new THREE.Mesh(capsuleSlot(0.13, 0.02, 0.012), ventDark), side * 0.34, 0.8 * PI, 0.004, side * 0.5);
    group.add(intake);
  }

  // Visor -------------------------------------------------------------------
  const visorGeo = buildPatch({
    segU: 120,
    segV: 50,
    param: (u, v) => [-1.4 + u * 2.8, (0.3 + v * 0.36) * PI],
    region: VISOR,
    keep: 'inside',
    scale: 1.042,
  });
  visorGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(visorGeo.attributes.position.count * 4), 4));
  const visor = new THREE.Mesh(visorGeo, visorMat);
  visor.name = 'visor';
  visor.renderOrder = 1000;
  const visorGroup = new THREE.Group();
  visorGroup.add(visor);
  // Tear-off posts and the lock tab
  for (const side of [-1, 1]) {
    const post = placeOnShell(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 16).rotateX(PI / 2), hardware), side * 1.02, 0.39 * PI, 0.066);
    visorGroup.add(post);
  }
  const lock = placeOnShell(new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.035), hardware), -0.32, 0.585 * PI, 0.07);
  visorGroup.add(lock);
  group.add(visorGroup);

  return {
    group,
    paintables: [shell, spoiler],
    paintMaterials: [paint, paintBoth],
    trimMaterials: [hardware],
    visorMaterials: [visorMat],
    visors: [visorGroup],
    visorMeshes: [visor],
    kind: 'procedural',
  };
}

// Visor tint lives in RGBA vertex colours so the printed black border band
// stays opaque while the lens area takes the tint's transparency.
function paintVisorVertices(mesh, tint) {
  const g = mesh.geometry;
  const edge = g.attributes.edge;
  const col = g.attributes.color;
  if (!edge || !col) return;
  for (let i = 0; i < col.count; i++) {
    const border = smoothstep(0.7, 0.8, edge.getX(i));
    const shade = 1 - border * 0.985;
    col.setXYZW(i, shade, shade, shade, THREE.MathUtils.lerp(tint.opacity, 1, border));
  }
  col.needsUpdate = true;
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
    enableCarbon(paint);
    applyFinish(paint, 'gloss');
    const visorMat = new THREE.MeshPhysicalMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1 });
    const paintables = [];
    const visors = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = o.receiveShadow = true;
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
    return { group, paintables, paintMaterials: [paint], trimMaterials: [], visorMaterials: [visorMat], visors, visorMeshes: [], kind: 'custom' };
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
    m.opacity = m.vertexColors ? 1 : v.opacity;
    m.metalness = v.metalness;
    m.roughness = v.roughness;
    m.iridescence = v.iridescence || 0;
  }
  if (helmet._visorKey !== base.visor) {
    for (const mesh of helmet.visorMeshes || []) paintVisorVertices(mesh, v);
    helmet._visorKey = base.visor;
  }
  for (const vis of helmet.visors) vis.visible = base.showVisor !== false;
}
