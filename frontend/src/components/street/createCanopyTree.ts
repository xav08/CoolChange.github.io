import * as THREE from "three";
import { mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";

// The close-up tree shares the street's colours, with branches and layered
// foliage that remain readable when the welcome camera moves in.
export function createCanopyTree(geometries: Set<THREE.BufferGeometry>, materials: Set<THREE.Material>) {
  const ownGeometry = <T extends THREE.BufferGeometry>(value: T) => { geometries.add(value); return value; };
  const ownMaterial = (color: string) => {
    const value = new THREE.MeshStandardMaterial({ color, roughness: 0.96, transparent: true });
    materials.add(value);
    return value;
  };
  const bark = ownMaterial("#8c7860");
  const foliage = ownMaterial("#ffffff");
  foliage.vertexColors = true;
  const leafColors = ["#819d66", "#8ca66f", "#90a875", "#78965f", "#7e9b65"];
  const group = new THREE.Group();
  const crown = new THREE.Group();
  crown.position.y = 1.65;
  group.add(crown);
  const leaves: THREE.InstancedMesh[] = [];
  const limbs: THREE.Group[] = [];
  function taperedLimb(parent: THREE.Group, path: THREE.CatmullRomCurve3, baseRadius: number, tipRadius: number, segments = 12) {
    const radialSegments = 12;
    const shape = ownGeometry(new THREE.TubeGeometry(path, segments, 1, radialSegments, false));
    const points = shape.getAttribute("position");
    for (let i = 0; i < points.count; i++) {
      const t = Math.floor(i / (radialSegments + 1)) / segments;
      const centre = path.getPointAt(t);
      const radius = THREE.MathUtils.lerp(baseRadius, tipRadius, t);
      points.setXYZ(i, centre.x + (points.getX(i) - centre.x) * radius,
        centre.y + (points.getY(i) - centre.y) * radius,
        centre.z + (points.getZ(i) - centre.z) * radius);
    }
    shape.computeVertexNormals();
    const mesh = new THREE.Mesh(shape, bark);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
  }

  function branch(parent: THREE.Group, from: THREE.Vector3, to: THREE.Vector3, radius: number) {
    const bend = from.clone().lerp(to, 0.5);
    bend.y += 0.07;
    taperedLimb(parent, new THREE.CatmullRomCurve3([from, bend, to]), radius, radius * 0.35);
  }

  // A slightly bent, tapering trunk and root flare anchor the moving crown.
  const trunkPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(0, 0, 0), new THREE.Vector3(0.06, 0.65, -0.03),
    new THREE.Vector3(-0.04, 1.2, 0.03), new THREE.Vector3(0, 1.85, 0),
  ]);
  taperedLimb(group, trunkPath, 0.26, 0.125, 24);
  for (let i = 0; i < 5; i++) {
    const angle = i * Math.PI * 2 / 5 + 0.4;
    branch(group, new THREE.Vector3(Math.cos(angle) * 0.31, 0.025, Math.sin(angle) * 0.31),
      new THREE.Vector3(0.03, 0.35, 0), 0.065);
  }

  // Weld the sphere seams before computing normals so the close-up has a
  // continuous, matte surface, including at the poles.
  const sphere = new THREE.SphereGeometry(1, 32, 24);
  sphere.deleteAttribute("normal"); sphere.deleteAttribute("uv");
  const leafGeometry = ownGeometry(mergeVertices(sphere));
  sphere.dispose();
  const vertices = leafGeometry.getAttribute("position");
  for (let i = 0; i < vertices.count; i++) {
    const x = vertices.getX(i), y = vertices.getY(i), z = vertices.getZ(i);
    const r = 1 + 0.035 * Math.sin(x * 3 + z * 2) * Math.cos(y * 3 - z * 2);
    vertices.setXYZ(i, x * r, y * r, z * r);
  }
  leafGeometry.computeVertexNormals();
  const colors = new Float32Array(vertices.count * 3);
  for (let i = 0; i < vertices.count; i++) {
    const light = THREE.MathUtils.lerp(0.83, 1, (vertices.getY(i) + 1.04) / 2.08);
    colors.set([light, light, light], i * 3);
  }
  leafGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const transform = new THREE.Object3D();
  // Nine broad, overlapping masses form the silhouette. A few tucked-in lobes
  // soften their outline without turning the canopy into separate little balls.
  const tips = [
    [-1.12, 1.35, 0.12, 0.76], [-0.72, 1.7, -0.92, 0.83],
    [0.3, 1.85, -0.9, 0.86], [1.03, 1.45, -0.25, 0.79],
    [0.87, 1.1, 0.72, 0.7], [-0.17, 1.28, 1.02, 0.77],
    [-0.98, 1.02, 0.77, 0.66], [-0.15, 2.25, 0.02, 0.91],
    [0.56, 2.03, 0.52, 0.75],
  ];
  tips.forEach((definition, index) => {
    const [x, y, z, size] = definition.map(value => value * 0.9);
    const limb = new THREE.Group();
    limb.position.set(0, index % 3 * 0.13, 0);
    crown.add(limb); limbs.push(limb);
    const fork = new THREE.Vector3(x * 0.55, y * 0.57, z * 0.55);
    const tip = new THREE.Vector3(x, y, z);
    branch(limb, new THREE.Vector3(), fork, 0.095 - index % 3 * 0.012);
    branch(limb, fork, tip, 0.055);
    const count = index % 2 === 0 ? 2 : 1;
    const clusters = new THREE.InstancedMesh(leafGeometry, foliage, count);
    clusters.receiveShadow = true;
    for (let i = 0; i < count; i++) {
      const angle = i * 2.4 + index * 0.7;
      const offset = i === 0 ? 0 : size * 0.64;
      const radius = size * (i === 0 ? 1.15 : 0.57);
      transform.position.set(x + Math.cos(angle) * offset, y + (i === 0 ? 0 : -0.16), z + Math.sin(angle) * offset);
      transform.rotation.set(index * 0.09, angle, i * 0.08);
      transform.scale.set(radius * 1.12, radius * 0.81, radius);
      transform.updateMatrix(); clusters.setMatrixAt(i, transform.matrix);
      clusters.setColorAt(i, new THREE.Color(leafColors[index % leafColors.length]));
    }
    clusters.instanceMatrix.needsUpdate = true;
    if (clusters.instanceColor) clusters.instanceColor.needsUpdate = true;
    limb.add(clusters); leaves.push(clusters);
  });

  return {
    group, crown, scale: 1,
    animate(time: number, strength: number) {
      const seconds = time * 0.001;
      crown.rotation.z = Math.sin(seconds * 0.62) * 0.013 * strength;
      crown.rotation.x = Math.sin(seconds * 0.43 + 0.7) * 0.008 * strength;
      limbs.forEach((limb, index) => {
        // The shared slow gust arrives later at the outer branches.
        const gust = Math.sin(seconds * 0.85 - index * 0.32);
        limb.rotation.z = (gust * 0.025 + Math.sin(seconds * 1.23 + index) * 0.008) * strength;
        limb.rotation.x = Math.sin(seconds * 0.7 + index * 0.65) * 0.019 * strength;
      });
    },
    setCanopyShade(visible: boolean) { leaves.forEach(leaf => { leaf.castShadow = visible; }); },
    setOpacity(opacity: number) {
      group.visible = opacity > 0;
      for (const material of [bark, foliage]) {
        material.opacity = opacity;
        material.depthWrite = opacity > 0.5;
      }
    },
    dispose() { leaves.forEach(leaf => leaf.dispose()); },
  };
}
