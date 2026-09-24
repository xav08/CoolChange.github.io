import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { canopyFootprint, clampTreeCount, plantedTreeScale, plantingLocations, sampleStreetView } from "../../data/streetStory";
import type { Theme } from "../../hooks/useTheme";

export type StreetSceneController = {
  setProgress: (progress: number) => void;
  setTrees: (trees: number, immediate?: boolean) => void;
  setBefore: (before: boolean) => void;
  setTheme: (theme: Theme) => void;
  setReducedMotion: (reduced: boolean) => void;
  resize: () => void;
  getStillViews: () => string[];
  dispose: () => void;
};

type Tree = { group: THREE.Group; shade: THREE.Mesh; scale: number };

export function createStreetScene(
  canvas: HTMLCanvasElement,
  options: { theme: Theme; trees: number; before?: boolean; reduced: boolean; onFailure: () => void },
): StreetSceneController {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 180);
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const geometry = <T extends THREE.BufferGeometry>(value: T): T => { geometries.add(value); return value; };
  const material = (color: string, extra: THREE.MeshStandardMaterialParameters = {}) => {
    const value = new THREE.MeshStandardMaterial({ color, roughness: 0.92, ...extra });
    materials.add(value);
    return value;
  };
  const palette = {
    ground: material("#c3cfa9"), edge: material("#a9b691"), pavement: material("#e1dccb"),
    road: material("#77877e"), wall: material("#f2ead9"), wallAlt: material("#d4d8c7"),
    roof: material("#547361"), roofWarm: material("#b28167"), dark: material("#315145"),
    glass: material("#91b5aa", { metalness: 0.08, roughness: 0.35 }), trim: material("#f7f0df"),
    trunk: material("#8c7860"), leaf: material("#74975b"), leafLight: material("#99af71"),
    leafDark: material("#426c50"), orange: material("#d99b5b"), line: material("#dfddbf"),
  };
  const boxGeometry = geometry(new THREE.BoxGeometry(1, 1, 1));
  const sphereGeometry = geometry(new THREE.IcosahedronGeometry(1, 1));
  const cylinderGeometry = geometry(new THREE.CylinderGeometry(0.12, 0.2, 1, 7));
  const coneGeometry = geometry(new THREE.ConeGeometry(1, 1, 4));
  const diskGeometry = geometry(new THREE.CircleGeometry(1, 32));
  function box(parent: THREE.Object3D, mat: THREE.Material, x: number, y: number, z: number, w: number, h: number, d: number) {
    const mesh = new THREE.Mesh(boxGeometry, mat);
    mesh.position.set(x, y, z);
    mesh.scale.set(w, h, d);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }

  scene.add(new THREE.HemisphereLight(0xfff7e7, 0x81987d, 1.9));
  const sun = new THREE.DirectionalLight(0xfff0d5, 2.6);
  sun.position.set(12, 24, 14);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -27, right: 27, top: 27, bottom: -27, near: 1, far: 80 });
  sun.shadow.normalBias = 0.08;
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 3;
  scene.add(sun);

  const neighbourhood = new THREE.Group();
  scene.add(neighbourhood);
  const base = new THREE.Mesh(geometry(new RoundedBoxGeometry(37, 0.85, 25, 2, 0.3)), palette.edge);
  base.position.y = -0.4; base.receiveShadow = true; neighbourhood.add(base);
  box(neighbourhood, palette.ground, 0, 0, 0, 36.6, 0.12, 24.6);
  box(neighbourhood, palette.road, 0, 0.09, 0, 37.1, 0.08, 5.6);
  for (const side of [-1, 1]) {
    box(neighbourhood, palette.pavement, 0, 0.18, side * 3.6, 37.1, 0.25, 1.5);
    box(neighbourhood, palette.trim, 0, 0.21, side * 2.85, 37.1, 0.3, 0.13);
    for (let x = -17; x < 18; x += 2) {
      box(neighbourhood, palette.line, x, 0.313, side * 3.6, 0.025, 0.01, 1.4);
    }
  }
  for (let x = -17; x < 18; x += 3.2) box(neighbourhood, palette.line, x, 0.14, 0, 1.5, 0.012, 0.09);
  // A short crossing and a familiar stop anchor the same street in every view.
  for (let z = -2; z <= 2; z += 0.65) box(neighbourhood, palette.trim, -3.4, 0.15, z, 1.6, 0.02, 0.3);

  function house(x: number, z: number, index: number) {
    const home = new THREE.Group();
    home.position.set(x, 0.1, z);
    if (z < 0) home.rotation.y = Math.PI;
    neighbourhood.add(home);
    const height = 2.4 + (index % 3) * 0.28;
    box(home, index % 3 === 0 ? palette.wallAlt : palette.wall, 0, height / 2, 0, 4.3, height, 3.8);
    const roof = new THREE.Mesh(coneGeometry, index % 3 === 1 ? palette.roofWarm : palette.roof);
    roof.position.set(0, height + 0.72, 0);
    roof.rotation.y = Math.PI / 4;
    roof.scale.set(3.4, 1.6, 3.05);
    roof.castShadow = true;
    home.add(roof);
    box(home, palette.dark, 0.65, 0.85, -1.93, 0.68, 1.7, 0.08);
    for (const wx of [-1.2, 1.35]) {
      box(home, palette.trim, wx, 1.42, -1.94, 0.86, 1.13, 0.09);
      box(home, palette.glass, wx, 1.42, -2, 0.7, 0.97, 0.025);
      box(home, palette.trim, wx, 1.42, -2.03, 0.035, 0.98, 0.025);
    }
    box(home, palette.glass, 2.16, 1.5, 0.35, 0.03, 1, 1.3);
    box(home, palette.trim, 0.65, 0.11, -2.22, 1.15, 0.2, 0.55);
    box(home, palette.pavement, 0.65, 0.02, -2.85, 0.95, 0.08, 1.4);
    box(home, palette.roofWarm, -1.1, height + 0.65, 0.3, 0.45, 1.4, 0.5);
    // Low boundary fences distinguish private gardens from the public verge.
    for (const fx of [-2.6, 2.6]) {
      box(home, palette.trim, fx, 0.55, -0.3, 0.12, 0.8, 5.6);
      for (const fz of [-2.9, -0.5, 2.3]) box(home, palette.wallAlt, fx, 0.62, fz, 0.2, 1.2, 0.2);
    }
  }
  [-12, -4, 4, 12].forEach((x, i) => house(x, -8.8, i));
  [-12, -5, 12].forEach((x, i) => house(x, 8.8, i + 3));

  const stop = new THREE.Group();
  stop.position.set(0, 0.3, 3.8);
  neighbourhood.add(stop);
  for (const x of [-1.55, 1.55]) box(stop, palette.dark, x, 1.3, 0.5, 0.09, 2.6, 0.09);
  box(stop, palette.dark, 0, 2.65, 0.2, 3.7, 0.13, 1.8);
  const shelterGlass = material("#b2cbb8", { transparent: true, opacity: 0.22, depthWrite: false, roughness: 0.3 });
  box(stop, shelterGlass, 0, 1.5, 0.53, 3.05, 1.9, 0.07).castShadow = false;
  box(stop, palette.trim, 0, 0.7, 0.05, 2.4, 0.14, 0.55);
  box(stop, palette.trim, 0, 1, 0.28, 2.4, 0.45, 0.08);
  for (const x of [-0.9, 0.9]) box(stop, palette.dark, x, 0.35, 0.05, 0.09, 0.7, 0.38);
  box(stop, palette.dark, -2.1, 1.65, -0.4, 0.09, 3.3, 0.09);
  box(stop, palette.orange, -2.1, 2.9, -0.4, 0.68, 0.68, 0.1);
  box(stop, palette.trim, -2.1, 2.92, -0.46, 0.35, 0.19, 0.02);
  box(stop, palette.trim, -2.1, 1.9, -0.42, 0.37, 0.6, 0.07);

  // A tiny waiting resident provides scale without assigning a social identity.
  box(stop, palette.roofWarm, 0.2, 1.07, -0.28, 0.3, 0.67, 0.25);
  const head = new THREE.Mesh(sphereGeometry, palette.trunk);
  head.position.set(0.2, 1.57, -0.28); head.scale.setScalar(0.18); stop.add(head);
  for (const x of [0.11, 0.29]) box(stop, palette.dark, x, 0.49, -0.27, 0.12, 0.58, 0.13);

  function car(x: number, z: number, mat: THREE.Material) {
    const group = new THREE.Group(); group.position.set(x, 0.22, z); neighbourhood.add(group);
    box(group, mat, 0, 0.38, 0, 2.4, 0.55, 1.15);
    box(group, palette.glass, -0.15, 0.9, 0, 1.28, 0.6, 1.01);
    box(group, mat, -0.15, 1.23, 0, 1.45, 0.09, 1.1);
    for (const wx of [-0.73, 0.75]) for (const wz of [-0.57, 0.57]) {
      const wheel = new THREE.Mesh(sphereGeometry, palette.dark);
      wheel.position.set(wx, 0.14, wz); wheel.scale.set(0.27, 0.27, 0.13); group.add(wheel);
    }
  }
  car(-11, 1.55, palette.orange);
  car(9, -1.55, palette.trim);

  const shadeMaterial = new THREE.MeshBasicMaterial({ color: "#385237", transparent: true, opacity: 0.12, depthWrite: false });
  materials.add(shadeMaterial);
  function makeTree(x: number, z: number, variant: number): Tree {
    const group = new THREE.Group(); group.position.set(x, 0.1, z); neighbourhood.add(group);
    const trunk = new THREE.Mesh(cylinderGeometry, palette.trunk);
    trunk.position.y = 1.1; trunk.scale.y = 2.2; trunk.castShadow = true; group.add(trunk);
    const leaves = [palette.leaf, palette.leafLight, palette.leafDark];
    [[0, 3.45, 0, 1.4], [-0.58, 2.7, 0.15, 1.02], [0.65, 2.95, 0.12, 1.08]].forEach(([lx, ly, lz, s], index) => {
      const leaf = new THREE.Mesh(sphereGeometry, leaves[(variant + index) % leaves.length]);
      leaf.position.set(lx, ly, lz); leaf.scale.set(s, s * 1.08, s * 0.92);
      leaf.rotation.set(0.2 * variant, variant * 0.7, 0.2); leaf.castShadow = true; leaf.receiveShadow = true;
      group.add(leaf);
    });
    const shade = new THREE.Mesh(diskGeometry, shadeMaterial);
    shade.rotation.x = -Math.PI / 2; shade.position.set(x - 1.4, 0.335, z - 1.3);
    shade.scale.set(2.1, 1.45, 1); neighbourhood.add(shade);
    return { group, shade, scale: 1 };
  }
  const existingTrees = [[-10, -5.1], [10, -5.1], [-10, 5.1]].map(([x, z], index) => makeTree(x, z, index));
  const heroTree = makeTree(3.6, 5.2, 0);
  const plantedTrees = plantingLocations.map(([x, , z], index) => makeTree(x, z, index));
  const allTrees = [...existingTrees, heroTree, ...plantedTrees];
  const footprints = allTrees.map(() => new THREE.Vector4());
  // Saturated thermal contours belong to the surfaces, not a full-screen tint.
  // These are illustrative marks, not sampled temperature measurements.
  const heatMaterial = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false,
    uniforms: {
      strength: { value: 0 },
      warm: { value: new THREE.Color("#f5b337") },
      hot: { value: new THREE.Color("#df4825") },
      cool: { value: new THREE.Color("#729874") },
      footprints: { value: footprints },
    },
    vertexShader: `varying vec2 vUv; varying vec2 streetPosition;
      void main() {
        vUv = uv;
        vec4 world = modelMatrix * vec4(position, 1.0);
        streetPosition = world.xz;
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: `uniform float strength; uniform vec3 warm; uniform vec3 hot; uniform vec3 cool;
      uniform vec4 footprints[40];
      varying vec2 vUv; varying vec2 streetPosition;
      void main() {
        float radius = length(vUv * 2.0 - 1.0);
        float core = 1.0 - smoothstep(0.18, 0.85, radius);
        float alpha = (1.0 - smoothstep(0.78, 1.0, radius)) * strength;
        float contour = (1.0 - smoothstep(0.009, 0.022, abs(radius - 0.54))) * 0.23;
        vec3 color = mix(warm, hot, core);
        color = mix(color, warm, contour);
        // Existing canopy and the shelter interrupt the exposed-surface wash.
        float shade = 0.0;
        for (int i = 0; i < 40; i++) {
          vec4 footprint = footprints[i];
          if (footprint.z > 0.01) {
            float distanceToCanopy = length((streetPosition - footprint.xy) / footprint.zw);
            shade = max(shade, 1.0 - smoothstep(0.65, 1.0, distanceToCanopy));
          }
        }
        // Amber at the expanding edge, muted green within the canopy.
        color = mix(color, warm, smoothstep(0.0, 0.45, shade));
        color = mix(color, cool, smoothstep(0.3, 0.85, shade));
        vec2 shelter = abs(streetPosition - vec2(-0.6, 3.8)) / vec2(1.8, 0.8);
        float shelterShade = 1.0 - smoothstep(0.85, 1.05, max(shelter.x, shelter.y));
        gl_FragColor = vec4(color, alpha * (1.0 - shelterShade * 0.95));
        #include <colorspace_fragment>
      }`,
  });
  materials.add(heatMaterial);
  for (const [x, z, sx, sz, y] of [
    [-7, 0, 9, 2.65, 0.137], [9, 0, 8, 2.65, 0.137],
    [0, 3.65, 7, 0.72, 0.32], [10, 3.65, 5, 0.72, 0.32],
    [2, -3.65, 9, 0.72, 0.32],
  ]) {
    const patch = new THREE.Mesh(diskGeometry, heatMaterial);
    patch.rotation.x = -Math.PI / 2; patch.position.set(x, y, z); patch.scale.set(sx, sz, 1); neighbourhood.add(patch);
  }

  let progress = 0;
  let treeCount = clampTreeCount(options.trees);
  let before = options.before ?? false;
  let reduced = options.reduced;
  let mobile = false;
  let disposed = false;
  let frame = 0;
  let lastTime = 0;
  let immediateTrees = true;
  const lookAt = new THREE.Vector3();
  const cameraOffset = new THREE.Vector3();

  function applyTree(tree: Tree, scale: number) {
    tree.scale = scale;
    tree.group.visible = scale > 0.01;
    tree.group.scale.setScalar(Math.max(0.001, scale));
    tree.shade.visible = scale > 0.01;
    const [x, z, width, depth] = canopyFootprint(tree.group.position.x, tree.group.position.z, scale);
    tree.shade.position.set(x, 0.335, z);
    tree.shade.scale.set(width, depth, 1);
  }

  function draw(time: number) {
    frame = 0;
    if (disposed) return;
    const delta = Math.min(64, time - (lastTime || time)); lastTime = time;
    const view = sampleStreetView(progress, mobile, reduced);
    lookAt.set(...view.target);
    cameraOffset.set(...view.camera).sub(lookAt);
    // Preserve the composition in tall tablet canvases instead of cropping it.
    camera.position.copy(lookAt).addScaledVector(cameraOffset, Math.max(1, 1.05 / camera.aspect));
    camera.lookAt(lookAt);
    heatMaterial.uniforms.strength.value = view.heat;
    shadeMaterial.opacity = 0.12 + view.heat * 0.2;
    applyTree(heroTree, view.growth);
    let settling = false;
    plantedTrees.forEach((tree, index) => {
      const target = plantedTreeScale(index, treeCount, view.planting, before);
      if (reduced || immediateTrees) tree.scale = target;
      else {
        tree.scale += (target - tree.scale) * (1 - Math.exp(-delta / 130));
        if (Math.abs(target - tree.scale) > 0.002) settling = true;
        else tree.scale = target;
      }
      applyTree(tree, tree.scale);
    });
    existingTrees.forEach(tree => applyTree(tree, 1));
    allTrees.forEach((tree, index) => {
      footprints[index].set(...canopyFootprint(tree.group.position.x, tree.group.position.z, tree.scale));
    });
    immediateTrees = false;
    renderer.render(scene, camera);
    if (settling) invalidate();
  }
  function invalidate() {
    if (!frame && !disposed) frame = requestAnimationFrame(draw);
  }
  function resize() {
    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) return;
    mobile = window.matchMedia("(max-width: 767px)").matches;
    camera.aspect = width / height;
    camera.fov = mobile ? 42 : 36;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
    invalidate();
  }
  function setTheme(theme: Theme) {
    const dark = theme === "dark";
    palette.ground.color.set(dark ? "#617762" : "#c3cfa9");
    palette.edge.color.set(dark ? "#435d4b" : "#a9b691");
    palette.road.color.set(dark ? "#536c62" : "#77877e");
    // Keep daylight on the model in either interface theme.
    renderer.toneMappingExposure = dark ? 1 : 1.05;
    invalidate();
  }
  function contextLost(event: Event) {
    event.preventDefault();
    options.onFailure();
  }
  canvas.addEventListener("webglcontextlost", contextLost);
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  setTheme(options.theme);
  resize();

  return {
    setProgress(value) { progress = value; invalidate(); },
    setTrees(value, immediate = false) { treeCount = clampTreeCount(value); immediateTrees = immediate; invalidate(); },
    setBefore(value) { before = value; immediateTrees = true; invalidate(); },
    setTheme,
    setReducedMotion(value) { reduced = value; immediateTrees = true; invalidate(); },
    resize,
    getStillViews() {
      const savedProgress = progress;
      const views: string[] = [];
      for (let index = 0; index < 6; index++) {
        cancelAnimationFrame(frame); frame = 0;
        progress = index; immediateTrees = true;
        draw(performance.now());
        views.push(canvas.toDataURL("image/webp", 0.8));
      }
      progress = savedProgress;
      invalidate();
      return views;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      canvas.removeEventListener("webglcontextlost", contextLost);
      geometries.forEach(value => value.dispose());
      materials.forEach(value => value.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      scene.clear();
    },
  };
}
