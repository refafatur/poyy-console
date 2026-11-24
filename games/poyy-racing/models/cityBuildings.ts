import * as THREE from "three";
import { BARRIER_OFFSET, type TrackData } from "@/games/poyy-racing/track";

function createFacadeTextures(accentHex: string, maxAnisotropy: number) {
  const colorCanvas = document.createElement("canvas");
  colorCanvas.width = 256;
  colorCanvas.height = 512;
  const ctx = colorCanvas.getContext("2d")!;

  const emissiveCanvas = document.createElement("canvas");
  emissiveCanvas.width = 256;
  emissiveCanvas.height = 512;
  const eCtx = emissiveCanvas.getContext("2d")!;

  // Architectural concrete & dark curtain-wall base
  ctx.fillStyle = "#191c24";
  ctx.fillRect(0, 0, 256, 512);
  eCtx.fillStyle = "#000000";
  eCtx.fillRect(0, 0, 256, 512);

  // Horizontal floor slabs
  const cols = 8;
  const rows = 24;
  const padX = 6;
  const padY = 5;
  const cellW = 256 / cols;
  const cellH = 512 / rows;

  for (let r = 0; r < rows; r++) {
    // Structural spandrel beam
    ctx.fillStyle = "#262b36";
    ctx.fillRect(0, r * cellH, 256, 3);

    for (let c = 0; c < cols; c++) {
      const lit = Math.random() > 0.42;
      const warm = Math.random() > 0.35;
      const x = c * cellW + padX;
      const y = r * cellH + padY;
      const w = cellW - padX * 2;
      const h = cellH - padY * 1.4;

      if (lit) {
        const winColor = warm ? "#ffd8a8" : accentHex;
        ctx.fillStyle = winColor;
        ctx.fillRect(x, y, w, h);
        eCtx.fillStyle = winColor;
        eCtx.fillRect(x, y, w, h);
      } else {
        ctx.fillStyle = "#0f141d";
        ctx.fillRect(x, y, w, h);
      }
    }
  }

  const map = new THREE.CanvasTexture(colorCanvas);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.anisotropy = maxAnisotropy;

  const emissiveMap = new THREE.CanvasTexture(emissiveCanvas);
  emissiveMap.colorSpace = THREE.SRGBColorSpace;
  emissiveMap.wrapS = THREE.RepeatWrapping;
  emissiveMap.wrapT = THREE.RepeatWrapping;
  emissiveMap.anisotropy = maxAnisotropy;

  return { map, emissiveMap };
}

function createSteppedTower(
  width: number,
  depth: number,
  height: number,
  concreteMat: THREE.Material,
  glassMat: THREE.Material,
  beaconMat: THREE.Material,
) {
  const group = new THREE.Group();
  const h1 = height * 0.25;
  const h2 = height * 0.45;
  const h3 = height * 0.3;

  const podium = new THREE.Mesh(new THREE.BoxGeometry(width, h1, depth), concreteMat);
  podium.position.y = h1 * 0.5;
  podium.castShadow = true;
  podium.receiveShadow = true;

  const mid = new THREE.Mesh(new THREE.BoxGeometry(width * 0.78, h2, depth * 0.78), glassMat);
  mid.position.y = h1 + h2 * 0.5;
  mid.castShadow = true;

  const crown = new THREE.Mesh(new THREE.BoxGeometry(width * 0.54, h3, depth * 0.54), glassMat);
  crown.position.y = h1 + h2 + h3 * 0.5;
  crown.castShadow = true;

  const roofRim = new THREE.Mesh(new THREE.BoxGeometry(width * 0.58, 0.7, depth * 0.58), concreteMat);
  roofRim.position.y = height + 0.35;

  const spire = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.3, 4.5, 8), concreteMat);
  spire.position.y = height + 2.6;

  const beacon = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.6, 0.6), beaconMat);
  beacon.position.y = height + 5.0;

  group.add(podium, mid, crown, roofRim, spire, beacon);
  return group;
}

function createSkybridgeTwins(
  width: number,
  depth: number,
  height: number,
  concreteMat: THREE.Material,
  glassMat: THREE.Material,
  accentMat: THREE.Material,
) {
  const group = new THREE.Group();
  const gap = width * 0.48;
  const legW = width * 0.42;

  const leftTower = new THREE.Mesh(new THREE.BoxGeometry(legW, height, depth), glassMat);
  leftTower.position.set(-gap, height * 0.5, 0);
  leftTower.castShadow = true;

  const rightTower = new THREE.Mesh(new THREE.BoxGeometry(legW, height * 0.9, depth), glassMat);
  rightTower.position.set(gap, height * 0.45, 0);
  rightTower.castShadow = true;

  const bridge = new THREE.Mesh(new THREE.BoxGeometry(gap * 2 + legW * 0.5, 3.2, depth * 0.65), concreteMat);
  bridge.position.set(0, height * 0.62, 0);

  const strip = new THREE.Mesh(new THREE.BoxGeometry(gap * 2 + legW * 0.52, 0.35, depth * 0.68), accentMat);
  strip.position.set(0, height * 0.62 + 1.75, 0);

  const roofCap = new THREE.Mesh(new THREE.BoxGeometry(legW * 1.08, 1.0, depth * 1.08), concreteMat);
  roofCap.position.set(-gap, height + 0.5, 0);

  group.add(leftTower, rightTower, bridge, strip, roofCap);
  return group;
}

function createCantileverBlock(
  width: number,
  depth: number,
  height: number,
  concreteMat: THREE.Material,
  glassMat: THREE.Material,
  accentMat: THREE.Material,
) {
  const group = new THREE.Group();
  const baseH = height * 0.36;
  const upperH = height * 0.64;

  const base = new THREE.Mesh(new THREE.BoxGeometry(width * 0.68, baseH, depth * 0.72), concreteMat);
  base.position.y = baseH * 0.5;
  base.castShadow = true;

  const upper = new THREE.Mesh(new THREE.BoxGeometry(width, upperH, depth), glassMat);
  upper.position.set(width * 0.14, baseH + upperH * 0.5, 0);
  upper.castShadow = true;

  const trim = new THREE.Mesh(new THREE.BoxGeometry(width + 0.3, 0.45, depth + 0.3), accentMat);
  trim.position.set(width * 0.14, baseH + 0.25, 0);

  const hvac = new THREE.Mesh(new THREE.BoxGeometry(width * 0.4, 2.0, depth * 0.4), concreteMat);
  hvac.position.set(width * 0.14, height + 1.0, 0);

  group.add(base, upper, trim, hvac);
  return group;
}

function createPitGrandstand(concreteMat: THREE.Material, accentMat: THREE.Material, glassMat: THREE.Material) {
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(28, 3.2, 10), concreteMat);
  base.position.y = 1.6;
  const tiers = new THREE.Mesh(new THREE.BoxGeometry(26, 4.5, 6), glassMat);
  tiers.position.set(0, 5.2, 1.5);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(29, 0.6, 11.5), concreteMat);
  canopy.position.set(0, 9.5, 0);
  canopy.rotation.x = -0.14;
  const sign = new THREE.Mesh(new THREE.BoxGeometry(28.5, 0.7, 0.4), accentMat);
  sign.position.set(0, 9.1, -5.5);
  group.add(base, tiers, canopy, sign);
  return group;
}

export function createCitySkyline(track: TrackData, maxAnisotropy: number) {
  const group = new THREE.Group();

  // Terrain floor + distant mountain/canyon horizon silhouette
  const groundGeo = new THREE.PlaneGeometry(1400, 1400);
  groundGeo.rotateX(-Math.PI / 2);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x0d1016, roughness: 0.96, metalness: 0.04 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.position.set(80, -0.35, -30);
  ground.receiveShadow = true;
  group.add(ground);

  // Materials
  const facadeWarm = createFacadeTextures("#93c5fd", maxAnisotropy);
  const facadeAmber = createFacadeTextures("#fbbf24", maxAnisotropy);

  const glassBlueMat = new THREE.MeshStandardMaterial({
    map: facadeWarm.map,
    emissiveMap: facadeWarm.emissiveMap,
    emissive: 0xffffff,
    emissiveIntensity: 0.58,
    roughness: 0.25,
    metalness: 0.75,
  });

  const glassAmberMat = new THREE.MeshStandardMaterial({
    map: facadeAmber.map,
    emissiveMap: facadeAmber.emissiveMap,
    emissive: 0xffffff,
    emissiveIntensity: 0.55,
    roughness: 0.28,
    metalness: 0.72,
  });

  const concreteDark = new THREE.MeshStandardMaterial({ color: 0x222631, roughness: 0.84, metalness: 0.12 });
  const concreteLight = new THREE.MeshStandardMaterial({ color: 0x333947, roughness: 0.78, metalness: 0.16 });
  const crimsonAccent = new THREE.MeshStandardMaterial({
    color: 0xe6392f,
    emissive: 0xe6392f,
    emissiveIntensity: 1.4,
    roughness: 0.3,
  });
  const cyanAccent = new THREE.MeshStandardMaterial({
    color: 0x38bdf8,
    emissive: 0x38bdf8,
    emissiveIntensity: 1.25,
    roughness: 0.25,
  });

  // Grandstand beside start/finish straight
  const startSample = track.samples[0];
  const grandstand = createPitGrandstand(concreteLight, crimsonAccent, glassBlueMat);
  grandstand.position.copy(startSample.position).addScaledVector(startSample.right, -(BARRIER_OFFSET + 10));
  grandstand.position.y -= 0.1;
  grandstand.rotation.y = Math.PI / 2;
  group.add(grandstand);

  // Deterministic seeded placement around the winding circuit (never overlapping road!)
  let seed = 1337;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };

  let placed = 0;
  for (let i = 0; i < track.samples.length && placed < 78; i += 11) {
    const sample = track.samples[i];
    for (const side of [-1, 1]) {
      const distOut = BARRIER_OFFSET + 18 + rand() * 34;
      const wx = sample.position.x + sample.right.x * side * distOut + (rand() - 0.5) * 8;
      const wz = sample.position.z + sample.right.z * side * distOut + (rand() - 0.5) * 8;

      // Ensure ample clearance from ALL parts of the winding track
      if (track.minDistanceToRoadXZ(wx, wz) < BARRIER_OFFSET + 14) continue;

      const archetype = placed % 3;
      const width = 10 + rand() * 9;
      const depth = 10 + rand() * 9;
      const height = 24 + rand() * 58;
      const glassMat = placed % 2 === 0 ? glassBlueMat : glassAmberMat;
      const concreteMat = placed % 2 === 0 ? concreteDark : concreteLight;
      const accentMat = placed % 3 === 0 ? crimsonAccent : cyanAccent;

      let building: THREE.Group;
      if (archetype === 0) {
        building = createSteppedTower(width, depth, height, concreteMat, glassMat, crimsonAccent);
      } else if (archetype === 1) {
        building = createSkybridgeTwins(width, depth, height, concreteMat, glassMat, accentMat);
      } else {
        building = createCantileverBlock(width, depth, height, concreteMat, glassMat, accentMat);
      }

      building.position.set(wx, -0.35, wz);
      building.rotation.y = Math.atan2(sample.tangent.x, sample.tangent.z) + (rand() - 0.5) * 0.25;
      group.add(building);
      placed++;
    }
  }

  // Outer perimeter low-poly mountain/ridge silhouettes via InstancedMesh
  const ridgeCount = 44;
  const ridgeGeo = new THREE.ConeGeometry(28, 42, 6);
  const ridgeMat = new THREE.MeshStandardMaterial({ color: 0x151923, roughness: 0.95, metalness: 0.05 });
  const ridgeInst = new THREE.InstancedMesh(ridgeGeo, ridgeMat, ridgeCount);
  const dummy = new THREE.Object3D();
  for (let i = 0; i < ridgeCount; i++) {
    const angle = (i / ridgeCount) * Math.PI * 2;
    const radius = 340 + rand() * 140;
    const rx = 80 + Math.cos(angle) * radius;
    const rz = -30 + Math.sin(angle) * radius;
    dummy.position.set(rx, 14, rz);
    dummy.rotation.set(0, rand() * Math.PI, 0);
    const s = 0.8 + rand() * 1.4;
    dummy.scale.set(s * 1.3, s, s * 1.3);
    dummy.updateMatrix();
    ridgeInst.setMatrixAt(i, dummy.matrix);
  }
  ridgeInst.computeBoundingSphere();
  group.add(ridgeInst);

  return group;
}
