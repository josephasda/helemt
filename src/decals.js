import * as THREE from 'three';
import { DecalGeometry } from 'three/examples/jsm/geometries/DecalGeometry.js';
import { applyFinish } from './helmet.js';

const Y = new THREE.Vector3(0, 1, 0);
const Z = new THREE.Vector3(0, 0, 1);

// Tangent frame for a sticker sitting on the surface with the given normal.
// "Up" follows world up where possible so stickers read naturally.
export function decalFrame(normal, rotationDeg) {
  const n = normal.clone().normalize();
  let up = Y.clone().addScaledVector(n, -n.dot(Y));
  if (up.lengthSq() < 0.06) up = Z.clone().addScaledVector(n, -n.dot(Z));
  up.normalize();
  const right = new THREE.Vector3().crossVectors(up, n).normalize();
  const r = THREE.MathUtils.degToRad(rotationDeg);
  const q = new THREE.Quaternion().setFromAxisAngle(n, r);
  right.applyQuaternion(q);
  up.applyQuaternion(q);
  return { right, up, normal: n };
}

export function mirrorPlacement(layer) {
  return {
    point: new THREE.Vector3(-layer.point[0], layer.point[1], layer.point[2]),
    normal: new THREE.Vector3(-layer.normal[0], layer.normal[1], layer.normal[2]),
    rotation: -layer.rotation,
    flipX: layer.flipX !== (layer.mirrorFlip !== false),
  };
}

// Caches world-space triangles for a mesh so we can hand DecalGeometry only
// the handful of triangles near the sticker. This keeps dragging smooth.
class TriangleCache {
  constructor(mesh) {
    mesh.updateMatrixWorld(true);
    const g = mesh.geometry;
    const pos = g.attributes.position;
    const nrm = g.attributes.normal;
    const index = g.index;
    const count = index ? index.count : pos.count;
    const T = Math.floor(count / 3);
    const nm = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    this.pos = new Float32Array(T * 9);
    this.nrm = new Float32Array(T * 9);
    this.cen = new Float32Array(T * 3);
    this.fn = new Float32Array(T * 3);
    this.count = T;
    let maxR = 0;
    const v = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
    const n = new THREE.Vector3();
    const e1 = new THREE.Vector3();
    const e2 = new THREE.Vector3();
    const fn = new THREE.Vector3();
    for (let t = 0; t < T; t++) {
      const ids = [0, 1, 2].map((k) => (index ? index.getX(t * 3 + k) : t * 3 + k));
      for (let k = 0; k < 3; k++) {
        v[k].fromBufferAttribute(pos, ids[k]).applyMatrix4(mesh.matrixWorld);
        this.pos.set([v[k].x, v[k].y, v[k].z], t * 9 + k * 3);
      }
      fn.crossVectors(e1.subVectors(v[1], v[0]), e2.subVectors(v[2], v[0]));
      if (fn.lengthSq() > 0) fn.normalize();
      this.fn.set([fn.x, fn.y, fn.z], t * 3);
      for (let k = 0; k < 3; k++) {
        if (nrm) n.fromBufferAttribute(nrm, ids[k]).applyMatrix3(nm).normalize();
        else n.copy(fn);
        this.nrm.set([n.x, n.y, n.z], t * 9 + k * 3);
      }
      const cx = (v[0].x + v[1].x + v[2].x) / 3;
      const cy = (v[0].y + v[1].y + v[2].y) / 3;
      const cz = (v[0].z + v[1].z + v[2].z) / 3;
      this.cen.set([cx, cy, cz], t * 3);
      for (const p of v) maxR = Math.max(maxR, Math.hypot(p.x - cx, p.y - cy, p.z - cz));
    }
    this.maxR = maxR;
  }

  proxy(point, normal, radius) {
    const r = radius + this.maxR;
    const r2 = r * r;
    const keep = [];
    for (let t = 0; t < this.count; t++) {
      const dx = this.cen[t * 3] - point.x;
      const dy = this.cen[t * 3 + 1] - point.y;
      const dz = this.cen[t * 3 + 2] - point.z;
      if (dx * dx + dy * dy + dz * dz > r2) continue;
      const facing = this.fn[t * 3] * normal.x + this.fn[t * 3 + 1] * normal.y + this.fn[t * 3 + 2] * normal.z;
      if (facing < 0.08) continue; // never wrap round onto faces pointing away
      keep.push(t);
    }
    const pos = new Float32Array(keep.length * 9);
    const nrm = new Float32Array(keep.length * 9);
    keep.forEach((t, k) => {
      pos.set(this.pos.subarray(t * 9, t * 9 + 9), k * 9);
      nrm.set(this.nrm.subarray(t * 9, t * 9 + 9), k * 9);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
    return new THREE.Mesh(g);
  }
}

function frameTexture(aspect) {
  const w = aspect >= 1 ? 512 : Math.max(32, Math.round(512 * aspect));
  const h = aspect >= 1 ? Math.max(32, Math.round(512 / aspect)) : 512;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.strokeStyle = '#3ee6ff';
  ctx.lineWidth = 10;
  ctx.setLineDash([22, 12]);
  ctx.strokeRect(5, 5, w - 10, h - 10);
  ctx.setLineDash([]);
  ctx.fillStyle = '#3ee6ff';
  const s = 26;
  for (const [x, y] of [[0, 0], [w - s, 0], [0, h - s], [w - s, h - s]]) ctx.fillRect(x, y, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class DecalLayers {
  constructor(scene, assets, onChange) {
    this.scene = scene;
    this.assets = assets;
    this.onChange = onChange;
    this.group = new THREE.Group();
    this.group.name = 'decals';
    scene.add(this.group);
    this.records = new Map();
    this.caches = new Map();
    this.helmet = null;
    this.version = 0;
    this.raycaster = new THREE.Raycaster();
    this.frameMaterial = new THREE.MeshBasicMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
      polygonOffsetUnits: -8,
      toneMapped: false,
    });
    this.frameMesh = new THREE.Mesh(new THREE.BufferGeometry(), this.frameMaterial);
    this.frameMesh.renderOrder = 999;
    this.frameMesh.visible = false;
    this.group.add(this.frameMesh);
    this.frameAspect = null;
  }

  setHelmet(helmet) {
    this.helmet = helmet;
    this.caches.clear();
    this.version++;
  }

  cacheFor(mesh) {
    if (!this.caches.has(mesh)) this.caches.set(mesh, new TriangleCache(mesh));
    return this.caches.get(mesh);
  }

  // Ray-cast the helmet surface. Returns { point, normal, object } or null.
  hitSurface(raycaster) {
    const hits = raycaster.intersectObjects(this.helmet.paintables, false);
    const hit = hits[0];
    if (!hit) return null;
    const n = (hit.normal || hit.face.normal).clone().transformDirection(hit.object.matrixWorld);
    if (n.dot(raycaster.ray.direction) > 0) n.negate();
    return { point: hit.point.clone(), normal: n, object: hit.object };
  }

  // Find the paintable mesh under a stored placement.
  targetFor(point, normal) {
    const origin = point.clone().addScaledVector(normal, 0.6);
    this.raycaster.set(origin, normal.clone().negate());
    this.raycaster.far = 1.5;
    const hits = this.raycaster.intersectObjects(this.helmet.paintables, false);
    this.raycaster.far = Infinity;
    return hits[0]?.object || this.helmet.paintables[0];
  }

  // Snap a placement back onto the surface (used after model swaps and when
  // centring a sticker on the helmet's middle line).
  reproject(point, normal) {
    const origin = point.clone().addScaledVector(normal, 1.5);
    this.raycaster.set(origin, normal.clone().negate());
    const hit = this.hitSurface(this.raycaster);
    if (hit) return hit;
    // Fall back to casting toward the helmet centre.
    const dir = point.clone().normalize();
    this.raycaster.set(dir.clone().multiplyScalar(6), dir.clone().negate());
    return this.hitSurface(this.raycaster);
  }

  buildGeometry(placement, layer) {
    const { right, up, normal } = decalFrame(placement.normal, placement.rotation);
    const orientation = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, normal));
    const depth = Math.max(layer.width, layer.height) * (layer.depth ?? 0.8);
    const size = new THREE.Vector3(layer.width, layer.height, depth);
    const target = this.targetFor(placement.point, placement.normal);
    const proxy = this.cacheFor(target).proxy(placement.point, normal, size.length() / 2);
    const geo = new DecalGeometry(proxy, placement.point, orientation, size);
    proxy.geometry.dispose();
    const flipX = placement.flipX;
    if (flipX || layer.flipY) {
      const uv = geo.attributes.uv;
      for (let i = 0; i < uv.count; i++) {
        if (flipX) uv.setX(i, 1 - uv.getX(i));
        if (layer.flipY) uv.setY(i, 1 - uv.getY(i));
      }
    }
    return geo;
  }

  makeMesh() {
    const mat = new THREE.MeshPhysicalMaterial({
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    this.group.add(mesh);
    return mesh;
  }

  sync(layers, base, selectedId) {
    if (!this.helmet) return;
    const seen = new Set();
    layers.forEach((layer, index) => {
      seen.add(layer.id);
      let rec = this.records.get(layer.id);
      if (!rec) {
        rec = { mesh: this.makeMesh(), mirror: null, geoKey: null, texKey: null, ready: false };
        rec.mesh.userData.layerId = layer.id;
        this.records.set(layer.id, rec);
      }

      // Texture
      const key = this.assets.keyFor(layer);
      if (rec.texKey !== key) {
        rec.texKey = key;
        const entry = this.assets.peek(key);
        if (entry) this.applyTexture(rec, entry);
        else {
          rec.ready = false;
          this.assets
            .get(key)
            .then((e) => {
              if (rec.texKey === key && this.records.get(layer.id) === rec) {
                this.applyTexture(rec, e);
                this.onChange?.('texture', layer.id);
              }
            })
            .catch((err) => console.warn(err));
        }
      }

      // Geometry
      const geoKey = JSON.stringify([layer.point, layer.normal, layer.rotation, layer.width, layer.height, layer.depth, layer.flipX, layer.flipY, layer.mirror, layer.mirrorFlip, this.version]);
      if (rec.geoKey !== geoKey) {
        rec.geoKey = geoKey;
        rec.mesh.geometry.dispose();
        rec.mesh.geometry = this.buildGeometry(
          { point: new THREE.Vector3(...layer.point), normal: new THREE.Vector3(...layer.normal), rotation: layer.rotation, flipX: layer.flipX },
          layer,
        );
        if (layer.mirror) {
          if (!rec.mirror) {
            rec.mirror = new THREE.Mesh(new THREE.BufferGeometry(), rec.mesh.material);
            rec.mirror.userData.layerId = layer.id;
            rec.mirror.userData.isMirror = true;
            this.group.add(rec.mirror);
          }
          rec.mirror.geometry.dispose();
          rec.mirror.geometry = this.buildGeometry(mirrorPlacement(layer), layer);
        } else if (rec.mirror) {
          this.group.remove(rec.mirror);
          rec.mirror.geometry.dispose();
          rec.mirror = null;
        }
      }

      // Material
      const mat = rec.mesh.material;
      const tintable = this.assets.isTintable(layer);
      mat.color.set(tintable ? layer.color : '#ffffff');
      mat.opacity = layer.opacity;
      applyFinish(mat, layer.finish === 'inherit' ? base.finish : layer.finish);
      rec.mesh.renderOrder = 10 + index;
      rec.mesh.visible = layer.visible && rec.ready;
      if (rec.mirror) {
        rec.mirror.renderOrder = 10 + index;
        rec.mirror.visible = rec.mesh.visible;
      }
    });

    for (const [id, rec] of this.records) {
      if (seen.has(id)) continue;
      this.group.remove(rec.mesh);
      rec.mesh.geometry.dispose();
      rec.mesh.material.dispose();
      if (rec.mirror) {
        this.group.remove(rec.mirror);
        rec.mirror.geometry.dispose();
      }
      this.records.delete(id);
    }

    // Selection frame
    const sel = selectedId && this.records.get(selectedId);
    const selLayer = selectedId && layers.find((l) => l.id === selectedId);
    if (sel && selLayer && selLayer.visible) {
      this.frameMesh.geometry = sel.mesh.geometry;
      const aspect = selLayer.width / selLayer.height;
      if (this.frameAspect === null || Math.abs(this.frameAspect - aspect) > 0.02) {
        this.frameMaterial.map?.dispose();
        this.frameMaterial.map = frameTexture(aspect);
        this.frameMaterial.needsUpdate = true;
        this.frameAspect = aspect;
      }
      this.frameMesh.visible = true;
    } else {
      this.frameMesh.visible = false;
    }
  }

  applyTexture(rec, entry) {
    rec.mesh.material.map = entry.texture;
    rec.mesh.material.needsUpdate = true;
    rec.ready = true;
  }

  setSelectionVisible(v) {
    this.frameMesh.visible = v && this.frameMesh.geometry.attributes.position?.count > 0;
  }

  // Returns the id of the top-most, unlocked, visible sticker under the ray,
  // ignoring fully transparent pixels.
  pick(raycaster, layers) {
    const byId = new Map(layers.map((l, i) => [l.id, { l, i }]));
    const meshes = [];
    for (const rec of this.records.values()) {
      if (!rec.mesh.visible) continue;
      meshes.push(rec.mesh);
      if (rec.mirror) meshes.push(rec.mirror);
    }
    const shell = raycaster.intersectObjects(this.helmet.paintables, false)[0];
    const hits = raycaster.intersectObjects(meshes, false);
    let best = null;
    for (const h of hits) {
      if (shell && h.distance > shell.distance + 0.02) continue; // hidden behind the shell
      const info = byId.get(h.object.userData.layerId);
      if (!info || info.l.locked) continue;
      if (h.uv && this.assets.alphaAt(this.assets.keyFor(info.l), h.uv.x, h.uv.y) < 16) continue;
      if (!best || info.i > best.i) best = { id: info.l.id, i: info.i, mirror: !!h.object.userData.isMirror };
    }
    return best;
  }
}
