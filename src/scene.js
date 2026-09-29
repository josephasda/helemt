import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/examples/jsm/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export const VIEWS = {
  front: [0, 0.35, 6.5],
  left: [6.5, 0.4, 0],
  right: [-6.5, 0.4, 0],
  back: [0, 0.6, -6.5],
  top: [0, 6.5, 0.4],
  three: [-4.6, 1.7, 4.4],
  rear: [4.0, 2.1, -4.7],
};

// A photo studio for reflections: dark room, big overhead softbox, tall strip
// lights either side and a rim light behind — like a car configurator stage.
function studioEnvironment() {
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(24, 14, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.1, 0.11), side: THREE.BackSide }));
  room.position.y = 4;
  env.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(24, 24), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.32, 0.32, 0.33) }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.9;
  env.add(floor);
  const panel = (w, h, intensity, pos, look) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(intensity), side: THREE.DoubleSide }));
    m.position.set(...pos);
    m.lookAt(...look);
    env.add(m);
  };
  panel(9, 6, 5, [0, 10.5, 0], [0, 0, 0]); // overhead softbox
  panel(1.4, 8, 9, [-8, 2.5, 3], [0, 1, 0]); // left strip
  panel(1.4, 8, 7, [8, 2.5, 3], [0, 1, 0]); // right strip
  panel(7, 2.2, 4, [0, 3, -9], [0, 1, 0]); // rim
  panel(5, 3, 2.2, [0, 1.5, 10], [0, 1, 0]); // soft front fill
  return env;
}

export function createStage(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: true, preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.NeutralToneMapping; // keeps chosen paint colours true
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.setClearColor(0x000000, 0);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(studioEnvironment(), 0.02).texture;
  scene.environmentIntensity = 1.0;

  const key = new THREE.DirectionalLight('#ffffff', 1.4);
  key.position.set(-2.5, 7, 3);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -2.2;
  key.shadow.camera.right = key.shadow.camera.top = 2.2;
  key.shadow.camera.near = 2;
  key.shadow.camera.far = 14;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  key.shadow.radius = 5;
  scene.add(key);
  scene.add(new THREE.HemisphereLight('#ffffff', '#3a3c40', 0.25));

  const FLOOR_Y = -1.2;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(12, 12), new THREE.ShadowMaterial({ opacity: 0.22 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = FLOOR_Y;
  ground.receiveShadow = true;
  scene.add(ground);

  // Soft contact shadow directly beneath the helmet
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 256;
  const sctx = shadowCanvas.getContext('2d');
  const grad = sctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(0.45, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  sctx.fillStyle = grad;
  sctx.fillRect(0, 0, 256, 256);
  const contact = new THREE.Mesh(
    new THREE.PlaneGeometry(2.6, 3.2),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(shadowCanvas), transparent: true, depthWrite: false, toneMapped: false }),
  );
  contact.rotation.x = -Math.PI / 2;
  contact.position.y = FLOOR_Y + 0.002;
  scene.add(contact);
  const shadow = new THREE.Group();
  shadow.add(ground, contact);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(...VIEWS.three);

  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, -0.15, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 3;
  controls.maxDistance = 11;
  controls.maxPolarAngle = Math.PI * 0.62; // don't dive under the floor
  controls.enablePan = false;
  controls.autoRotateSpeed = 1.0;

  // Post: MSAA scene render -> ground-truth AO in crevices -> tone map.
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  const renderPass = new RenderPass(scene, camera);
  renderPass.clearAlpha = 0;
  composer.addPass(renderPass);
  const gtao = new GTAOPass(scene, camera, 1, 1);
  gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.2, scale: 1, samples: 16 });
  gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
  gtao.blendIntensity = 0.85;
  composer.addPass(gtao);
  composer.addPass(new OutputPass());

  let tween = null;
  function flyTo(name) {
    const to = new THREE.Vector3(...VIEWS[name]);
    const dist = camera.position.distanceTo(controls.target);
    to.setLength(dist);
    tween = { from: camera.position.clone(), to, t: 0 };
  }

  function setSize(w, h, ratio) {
    renderer.setPixelRatio(ratio);
    renderer.setSize(w, h, false);
    composer.setPixelRatio(ratio);
    composer.setSize(w, h);
    camera.aspect = w / Math.max(h, 1);
    camera.updateProjectionMatrix();
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas.parentElement;
    setSize(w, h, Math.min(window.devicePixelRatio, 2));
  }
  new ResizeObserver(resize).observe(canvas.parentElement);
  resize();

  const beforeRender = [];
  function frame() {
    if (tween) {
      tween.t = Math.min(1, tween.t + 0.05);
      const k = 1 - Math.pow(1 - tween.t, 3);
      // Rotate around the target so the camera orbits rather than cutting through.
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
    composer.render();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  function screenshot({ width = 2048, height = 2048, background = null, hide = [] } = {}) {
    const prev = { w: canvas.parentElement.clientWidth, h: canvas.parentElement.clientHeight, ratio: renderer.getPixelRatio(), aspect: camera.aspect };
    const hidden = hide.filter((o) => o.visible);
    hidden.forEach((o) => (o.visible = false));
    setSize(width, height, 1);
    if (background) scene.background = new THREE.Color(background);
    composer.render();
    const url = renderer.domElement.toDataURL('image/png');
    scene.background = null;
    hidden.forEach((o) => (o.visible = true));
    setSize(prev.w, prev.h, prev.ratio);
    return url;
  }

  function setStudio(mode) {
    ground.material.opacity = mode === 'dark' ? 0.5 : 0.22;
  }

  return { renderer, scene, camera, controls, flyTo, screenshot, beforeRender, shadow, setStudio };
}
