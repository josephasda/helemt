import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export const VIEWS = {
  front: [0, 0.3, 5.6],
  left: [5.6, 0.35, 0],
  right: [-5.6, 0.35, 0],
  back: [0, 0.5, -5.6],
  top: [0, 5.6, 0.4],
  three: [3.8, 1.8, 3.8],
};

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const key = new THREE.DirectionalLight('#ffffff', 1.6);
  key.position.set(3, 5, 4);
  scene.add(key);
  const rim = new THREE.DirectionalLight('#9fd7ff', 0.9);
  rim.position.set(-4, 2, -3);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight('#ffffff', '#20242a', 0.4));

  // Soft contact shadow under the helmet
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 128;
  const sctx = shadowCanvas.getContext('2d');
  const grad = sctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 128, 128);
  const shadow = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 3.6),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -1.18;
  scene.add(shadow);

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
  camera.position.set(...VIEWS.three);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.05, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 2.6;
  controls.maxDistance = 10;
  controls.enablePan = false;
  controls.autoRotateSpeed = 1.2;

  let tween = null;
  function flyTo(name) {
    const to = new THREE.Vector3(...VIEWS[name]);
    const dist = camera.position.distanceTo(controls.target);
    to.setLength(dist);
    tween = { from: camera.position.clone(), to, t: 0 };
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas.parentElement;
    renderer.setSize(w, h, false);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(canvas.parentElement);
  resize();

  const beforeRender = [];
  function frame() {
    if (tween) {
      tween.t = Math.min(1, tween.t + 0.06);
      const k = 1 - Math.pow(1 - tween.t, 3);
      // Slerp around the target so the camera orbits rather than cutting through.
      const a = tween.from.clone().normalize();
      const b = tween.to.clone().normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(a, b);
      const partial = new THREE.Quaternion().slerp(q, k);
      const len = THREE.MathUtils.lerp(tween.from.length(), tween.to.length(), k);
      camera.position.copy(a.applyQuaternion(partial).multiplyScalar(len));
      if (tween.t >= 1) tween = null;
    }
    controls.update();
    for (const fn of beforeRender) fn();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function screenshot({ width = 2048, height = 2048, transparent = true, hide = [] } = {}) {
    const prevSize = renderer.getSize(new THREE.Vector2());
    const prevRatio = renderer.getPixelRatio();
    const prevAspect = camera.aspect;
    const hidden = hide.filter((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setClearColor(0x000000, transparent ? 0 : 1);
    if (!transparent) scene.background = new THREE.Color('#15181d');
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    scene.background = null;
    renderer.setClearColor(0x000000, 0);
    hidden.forEach((o) => (o.visible = true));
    renderer.setPixelRatio(prevRatio);
    renderer.setSize(prevSize.x, prevSize.y, false);
    camera.aspect = prevAspect;
    camera.updateProjectionMatrix();
    return url;
  }

  return { renderer, scene, camera, controls, flyTo, screenshot, beforeRender, shadow };
}
