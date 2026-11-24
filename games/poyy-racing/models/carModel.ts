import * as THREE from "three";
import { GLTFLoader, type GLTF } from "three/addons/loaders/GLTFLoader.js";

export type CarLivery = {
  id: string;
  name: string;
  bodyHex: number;
  accentHex: number;
};

export const CAR_LIVERIES: Record<string, CarLivery> = {
  player: { id: "player", name: "POYY Stealth", bodyHex: 0x16181f, accentHex: 0xe6392f },
  cobalt: { id: "cobalt", name: "Cobalt Apex", bodyHex: 0x2563eb, accentHex: 0x93c5fd },
  amber: { id: "amber", name: "Solar GT", bodyHex: 0xd97706, accentHex: 0xfde68a },
  emerald: { id: "emerald", name: "Emerald V8", bodyHex: 0x059669, accentHex: 0x6ee7b7 },
};

export type RacerCarRig = {
  root: THREE.Group;
  bodyTiltGroup: THREE.Group;
  frontWheels: THREE.Group[];
  allWheels: THREE.Group[];
  wheelRadius: number;
  headlightMaterial: THREE.MeshStandardMaterial;
  headlightBeams: THREE.Group;
  headlightSpots: THREE.SpotLight[];
  brakeMaterial: THREE.MeshStandardMaterial;
  reverseMaterial: THREE.MeshStandardMaterial;
  nitroFlames: THREE.Mesh[];
  driftSmoke: THREE.Group;
  dispose: () => void;
};

function createSoftShadowTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(64, 64, 12, 64, 64, 62);
  grad.addColorStop(0, "rgba(0,0,0,0.65)");
  grad.addColorStop(0.65, "rgba(0,0,0,0.28)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(canvas);
}

function createBeamFadeTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, "rgba(225, 242, 255, 0.75)");
  grad.addColorStop(0.35, "rgba(215, 238, 255, 0.32)");
  grad.addColorStop(1, "rgba(210, 235, 255, 0.0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 128);
  return new THREE.CanvasTexture(canvas);
}

let cachedShadowTex: THREE.CanvasTexture | undefined;
let cachedBeamTex: THREE.CanvasTexture | undefined;
let cachedMobilGltfPromise: Promise<GLTF> | null = null;

function loadMobilGltf(): Promise<GLTF> {
  if (!cachedMobilGltfPromise) {
    const loader = new GLTFLoader();
    cachedMobilGltfPromise = loader.loadAsync("/models/mobil.glb").catch((err) => {
      cachedMobilGltfPromise = null;
      throw err;
    });
  }
  return cachedMobilGltfPromise;
}

function createContactShadow() {
  if (!cachedShadowTex) cachedShadowTex = createSoftShadowTexture();
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.7, 5.1),
    new THREE.MeshBasicMaterial({ map: cachedShadowTex, transparent: true, depthWrite: false, opacity: 0.78 }),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = 0.04;
  return contactShadow;
}

function createLightingAssembly(
  bodyTiltGroup: THREE.Group,
  options: {
    frontZ: number;
    headlightY: number;
    headlightX: number;
    rearZ: number;
    reverseY: number;
    reverseX: number;
    enableSpotLights: boolean;
  },
) {
  if (!cachedBeamTex) cachedBeamTex = createBeamFadeTexture();

  const headlightMaterial = new THREE.MeshStandardMaterial({
    color: 0xdbeafe,
    emissive: 0xe8f4ff,
    emissiveIntensity: 4.5,
    roughness: 0.15,
    metalness: 0.1,
  });

  const reverseMaterial = new THREE.MeshStandardMaterial({
    color: 0xe2e8f0,
    emissive: 0xffffff,
    emissiveIntensity: 0,
    roughness: 0.18,
    metalness: 0.1,
  });

  // Front LED headlight lenses precisely proportioned to the front bumper
  const lensGeo = new THREE.BoxGeometry(0.24, 0.055, 0.04);
  const leftLens = new THREE.Mesh(lensGeo, headlightMaterial);
  leftLens.position.set(-options.headlightX, options.headlightY, options.frontZ);
  leftLens.rotation.y = 0.15;

  const rightLens = new THREE.Mesh(lensGeo, headlightMaterial);
  rightLens.position.set(options.headlightX, options.headlightY, options.frontZ);
  rightLens.rotation.y = -0.15;
  bodyTiltGroup.add(leftLens, rightLens);

  // Volumetric headlight cone beams projecting forward along -Z
  const headlightBeams = new THREE.Group();
  const coneLen = 14.0;
  const coneGeo = new THREE.ConeGeometry(1.25, coneLen, 22, 1, true);
  coneGeo.translate(0, -coneLen * 0.5, 0);
  coneGeo.rotateX(-Math.PI / 2); // projects forward along -Z

  const beamMat = new THREE.MeshBasicMaterial({
    map: cachedBeamTex,
    color: 0xe0f2fe,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });

  const beamL = new THREE.Mesh(coneGeo, beamMat);
  beamL.position.set(-options.headlightX, options.headlightY, options.frontZ - 0.02);
  beamL.rotation.x = -0.03;

  const beamR = new THREE.Mesh(coneGeo, beamMat);
  beamR.position.set(options.headlightX, options.headlightY, options.frontZ - 0.02);
  beamR.rotation.x = -0.03;

  headlightBeams.add(beamL, beamR);
  bodyTiltGroup.add(headlightBeams);

  // Real dynamic SpotLights for player illumination
  const headlightSpots: THREE.SpotLight[] = [];
  if (options.enableSpotLights) {
    const createSpot = (xOffset: number) => {
      const spot = new THREE.SpotLight(0xf0f7ff, 48, 90, 0.4, 0.58, 1.25);
      spot.castShadow = false;
      spot.position.set(xOffset, options.headlightY + 0.04, options.frontZ - 0.02);
      spot.target.position.set(xOffset * 1.05, 0.04, options.frontZ - 32);
      bodyTiltGroup.add(spot, spot.target);
      headlightSpots.push(spot);
    };
    createSpot(-options.headlightX);
    createSpot(options.headlightX);
  }

  // Twin rear white reverse light emitters precisely proportioned to rear bumper
  const revGeo = new THREE.BoxGeometry(0.2, 0.045, 0.035);
  const revL = new THREE.Mesh(revGeo, reverseMaterial);
  revL.position.set(-options.reverseX, options.reverseY, options.rearZ);
  const revR = new THREE.Mesh(revGeo, reverseMaterial);
  revR.position.set(options.reverseX, options.reverseY, options.rearZ);
  bodyTiltGroup.add(revL, revR);

  return {
    headlightMaterial,
    headlightBeams,
    headlightSpots,
    reverseMaterial,
  };
}

function createEffects(bodyTiltGroup: THREE.Group, wheelBaseRearZ: number) {
  const flameGeo = new THREE.ConeGeometry(0.13, 1.25, 12);
  flameGeo.rotateX(Math.PI / 2);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.88 });
  const flameL = new THREE.Mesh(flameGeo, flameMat);
  flameL.position.set(-0.42, 0.3, wheelBaseRearZ + 1.25);
  flameL.visible = false;
  const flameR = new THREE.Mesh(flameGeo, flameMat);
  flameR.position.set(0.42, 0.3, wheelBaseRearZ + 1.25);
  flameR.visible = false;
  bodyTiltGroup.add(flameL, flameR);

  const driftSmoke = new THREE.Group();
  driftSmoke.visible = false;
  const puffMat = new THREE.MeshBasicMaterial({
    color: 0xd4d4d8,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const puffGeo = new THREE.CircleGeometry(0.62, 14);
  puffGeo.rotateX(-Math.PI / 2);
  const puffL = new THREE.Mesh(puffGeo, puffMat);
  puffL.position.set(-0.85, 0.11, wheelBaseRearZ + 0.35);
  const puffR = new THREE.Mesh(puffGeo, puffMat);
  puffR.position.set(0.85, 0.11, wheelBaseRearZ + 0.35);
  driftSmoke.add(puffL, puffR);

  return { nitroFlames: [flameL, flameR], driftSmoke };
}

function cloneMaterialsOnObject(root: THREE.Object3D) {
  const clonedMap = new Map<THREE.Material, THREE.Material>();
  root.traverse((obj) => {
    const mesh = obj as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const mapSingle = (mat: THREE.Material) => {
      let next = clonedMap.get(mat);
      if (!next) {
        next = mat.clone();
        clonedMap.set(mat, next);
      }
      return next;
    };

    if (Array.isArray(mesh.material)) {
      mesh.material = mesh.material.map(mapSingle);
    } else if (mesh.material) {
      mesh.material = mapSingle(mesh.material);
    }
  });
  return Array.from(clonedMap.values());
}

function buildMobilGlbContents(gltf: GLTF, livery: CarLivery, isPlayer: boolean) {
  const tempRoot = new THREE.Group();
  const bodyTiltGroup = new THREE.Group();
  const modelPivot = new THREE.Group();
  const clonedScene = gltf.scene.clone(true);

  const materials = cloneMaterialsOnObject(clonedScene);
  let brakeMaterial: THREE.MeshStandardMaterial | null = null;

  for (const mat of materials) {
    if (!(mat instanceof THREE.MeshStandardMaterial)) continue;
    if (mat.name === "Rear Lights") {
      mat.emissive.setHex(0xff1e1e);
      mat.emissiveIntensity = 0.9;
      mat.roughness = 0.25;
      brakeMaterial = mat;
    } else if (mat.name === "Car Texture") {
      if (livery.id !== "player") {
        mat.color.setHex(livery.bodyHex);
        mat.metalness = 0.68;
        mat.roughness = 0.2;
      } else {
        mat.metalness = Math.max(mat.metalness, 0.45);
        mat.roughness = 0.14;
      }
      mat.envMapIntensity = 1.45;
    } else if (mat.name === "Window Glass") {
      mat.color.setHex(0x0b121b);
      mat.metalness = 0.88;
      mat.roughness = 0.08;
      mat.envMapIntensity = 1.5;
    }
  }

  if (!brakeMaterial) {
    brakeMaterial = new THREE.MeshStandardMaterial({
      color: 0xdc2626,
      emissive: 0xff1e1e,
      emissiveIntensity: 0.9,
      roughness: 0.2,
    });
  }

  modelPivot.rotation.y = Math.PI;
  modelPivot.add(clonedScene);
  tempRoot.add(bodyTiltGroup);
  bodyTiltGroup.add(modelPivot);
  tempRoot.updateMatrixWorld(true);

  const wheelNames = ["FL", "FR", "RL", "RR"] as const;
  const wheelNodes = wheelNames
    .map((name) => ({ name, obj: clonedScene.getObjectByName(name) }))
    .filter((entry): entry is { name: (typeof wheelNames)[number]; obj: THREE.Object3D } => Boolean(entry.obj));

  const refBox = new THREE.Box3();
  const expandWithCoreMeshes = () => {
    refBox.makeEmpty();
    clonedScene.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (mat?.name === "Car Texture") {
        refBox.expandByObject(mesh);
      }
    });
    for (const { obj } of wheelNodes) {
      refBox.expandByObject(obj);
    }
    if (refBox.isEmpty()) {
      refBox.setFromObject(modelPivot);
    }
  };

  expandWithCoreMeshes();
  const initialSize = refBox.getSize(new THREE.Vector3());
  const targetLength = 4.55;
  const scaleFactor = targetLength / Math.max(initialSize.z, 0.1);
  modelPivot.scale.setScalar(scaleFactor);
  tempRoot.updateMatrixWorld(true);

  expandWithCoreMeshes();
  const wheelsBox = new THREE.Box3();
  for (const { obj } of wheelNodes) {
    wheelsBox.expandByObject(obj);
  }
  const refCenter = refBox.getCenter(new THREE.Vector3());
  const groundY = wheelsBox.isEmpty() ? refBox.min.y : wheelsBox.min.y;
  modelPivot.position.set(-refCenter.x, -groundY, -refCenter.z);
  tempRoot.updateMatrixWorld(true);

  const finalCarBox = new THREE.Box3().setFromObject(modelPivot);
  const carMinZ = finalCarBox.min.z;
  const carMaxZ = finalCarBox.max.z;
  const carMinX = finalCarBox.min.x;
  const carMaxX = finalCarBox.max.x;
  const carMinY = finalCarBox.min.y;
  const carMaxY = finalCarBox.max.y;

  const frontWheels: THREE.Group[] = [];
  const allWheels: THREE.Group[] = [];
  let rearWheelZ = 1.35;
  let measuredRadiusSum = 0;
  let measuredWheelCount = 0;

  for (const { name, obj } of wheelNodes) {
    const wBox = new THREE.Box3().setFromObject(obj);
    const wCenter = wBox.getCenter(new THREE.Vector3());
    const wSize = wBox.getSize(new THREE.Vector3());
    if (wSize.y > 0.1) {
      measuredRadiusSum += wSize.y * 0.5;
      measuredWheelCount += 1;
    }

    const steerPivot = new THREE.Group();
    steerPivot.position.copy(wCenter);
    const spinGroup = new THREE.Group();
    steerPivot.add(spinGroup);
    tempRoot.add(steerPivot);
    tempRoot.updateMatrixWorld(true);
    spinGroup.attach(obj);

    if (name === "FL" || name === "FR") {
      frontWheels.push(steerPivot);
    } else {
      rearWheelZ = Math.max(rearWheelZ, wCenter.z);
    }
    allWheels.push(spinGroup);
  }

  const wheelRadius = measuredWheelCount > 0 ? measuredRadiusSum / measuredWheelCount : 0.35;

  // Precisely align headlights at true front (carMinZ) and tail lights at true rear (carMaxZ)
  const lights = createLightingAssembly(bodyTiltGroup, {
    frontZ: carMinZ - 0.04,
    headlightY: carMinY + (carMaxY - carMinY) * 0.42,
    headlightX: Math.abs(carMaxX) * 0.62,
    rearZ: carMaxZ + 0.04,
    reverseY: carMinY + (carMaxY - carMinY) * 0.40,
    reverseX: Math.abs(carMaxX) * 0.52,
    enableSpotLights: isPlayer,
  });

  const contactShadow = createContactShadow();
  const { nitroFlames, driftSmoke } = createEffects(bodyTiltGroup, rearWheelZ);
  tempRoot.add(contactShadow, driftSmoke);

  return {
    children: [...tempRoot.children],
    bodyTiltGroup,
    frontWheels,
    allWheels,
    wheelRadius,
    ...lights,
    brakeMaterial,
    nitroFlames,
    driftSmoke,
  };
}

function buildFallbackRigContents(livery: CarLivery, isPlayer: boolean) {
  const tempRoot = new THREE.Group();
  const bodyTiltGroup = new THREE.Group();
  tempRoot.add(bodyTiltGroup);

  const paintMat = new THREE.MeshPhysicalMaterial({
    color: livery.bodyHex,
    metalness: 0.72,
    roughness: 0.22,
    clearcoat: 1.0,
    clearcoatRoughness: 0.08,
  });
  const carbonMat = new THREE.MeshStandardMaterial({ color: 0x16181d, metalness: 0.22, roughness: 0.72 });
  const canopyMat = new THREE.MeshPhysicalMaterial({ color: 0x0b121b, metalness: 0.9, roughness: 0.08, clearcoat: 1.0 });
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x121316, metalness: 0.05, roughness: 0.85 });
  const rimMat = new THREE.MeshStandardMaterial({ color: 0xd1d5db, metalness: 0.94, roughness: 0.16 });
  const brakeMaterial = new THREE.MeshStandardMaterial({
    color: 0xdc2626,
    emissive: 0xff1e1e,
    emissiveIntensity: 0.9,
    roughness: 0.2,
  });

  const hull = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.52, 4.35), paintMat);
  hull.position.set(0, 0.48, 0);
  hull.castShadow = true;
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.36, 1.8), canopyMat);
  cabin.position.set(0, 0.88, 0.12);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(1.64, 0.1, 0.08), brakeMaterial);
  tail.position.set(0, 0.56, 2.18);
  bodyTiltGroup.add(hull, cabin, tail);

  const wheelRadius = 0.36;
  const tireGeo = new THREE.CylinderGeometry(wheelRadius, wheelRadius, 0.28, 18);
  tireGeo.rotateZ(Math.PI / 2);
  const wheelCoords: Array<[number, number, number]> = [
    [-0.96, wheelRadius, -1.28],
    [0.96, wheelRadius, -1.28],
    [-0.96, wheelRadius, 1.28],
    [0.96, wheelRadius, 1.28],
  ];
  const frontWheels: THREE.Group[] = [];
  const allWheels: THREE.Group[] = [];
  wheelCoords.forEach(([x, y, z], index) => {
    const steerPivot = new THREE.Group();
    steerPivot.position.set(x, y, z);
    const spinGroup = new THREE.Group();
    const tire = new THREE.Mesh(tireGeo, tireMat);
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.26, 0.26), index % 2 === 0 ? rimMat : carbonMat);
    spinGroup.add(tire, hub);
    steerPivot.add(spinGroup);
    tempRoot.add(steerPivot);
    if (index < 2) frontWheels.push(steerPivot);
    allWheels.push(spinGroup);
  });

  const lights = createLightingAssembly(bodyTiltGroup, {
    frontZ: -2.18,
    headlightY: 0.52,
    headlightX: 0.68,
    rearZ: 2.18,
    reverseY: 0.48,
    reverseX: 0.46,
    enableSpotLights: isPlayer,
  });

  const { nitroFlames, driftSmoke } = createEffects(bodyTiltGroup, 1.35);
  tempRoot.add(createContactShadow(), driftSmoke);

  return {
    children: [...tempRoot.children],
    bodyTiltGroup,
    frontWheels,
    allWheels,
    wheelRadius,
    ...lights,
    brakeMaterial,
    nitroFlames,
    driftSmoke,
  };
}

export function createRacerCarMesh(livery: CarLivery): RacerCarRig {
  const isPlayer = livery.id === "player";
  const root = new THREE.Group();
  const fallback = buildFallbackRigContents(livery, isPlayer);
  fallback.children.forEach((child) => root.add(child));

  let isDisposed = false;

  const rig: RacerCarRig = {
    root,
    bodyTiltGroup: fallback.bodyTiltGroup,
    frontWheels: fallback.frontWheels,
    allWheels: fallback.allWheels,
    wheelRadius: fallback.wheelRadius,
    headlightMaterial: fallback.headlightMaterial,
    headlightBeams: fallback.headlightBeams,
    headlightSpots: fallback.headlightSpots,
    brakeMaterial: fallback.brakeMaterial,
    reverseMaterial: fallback.reverseMaterial,
    nitroFlames: fallback.nitroFlames,
    driftSmoke: fallback.driftSmoke,
    dispose: () => {
      isDisposed = true;
    },
  };

  loadMobilGltf()
    .then((gltf) => {
      if (isDisposed) return;
      const glbRig = buildMobilGlbContents(gltf, livery, isPlayer);
      root.clear();
      glbRig.children.forEach((child) => root.add(child));
      rig.bodyTiltGroup = glbRig.bodyTiltGroup;
      rig.frontWheels = glbRig.frontWheels;
      rig.allWheels = glbRig.allWheels;
      rig.wheelRadius = glbRig.wheelRadius;
      rig.headlightMaterial = glbRig.headlightMaterial;
      rig.headlightBeams = glbRig.headlightBeams;
      rig.headlightSpots = glbRig.headlightSpots;
      rig.brakeMaterial = glbRig.brakeMaterial;
      rig.reverseMaterial = glbRig.reverseMaterial;
      rig.nitroFlames = glbRig.nitroFlames;
      rig.driftSmoke = glbRig.driftSmoke;
    })
    .catch((err) => {
      console.warn("Unable to load /models/mobil.glb, keeping fallback mesh:", err);
    });

  return rig;
}
