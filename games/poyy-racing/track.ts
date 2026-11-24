import * as THREE from "three";

export const ROAD_HALF_WIDTH = 10.5;
export const CURB_WIDTH = 1.35;
export const BARRIER_OFFSET = ROAD_HALF_WIDTH + CURB_WIDTH + 0.35;

export type TrackSample = {
  distance: number;
  t: number;
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
  curvature: number;
};

export type TrackProjection = {
  sampleIndex: number;
  distance: number;
  signedLateral: number;
  position: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  up: THREE.Vector3;
};

export type TrackData = {
  curve: THREE.CatmullRomCurve3;
  lapLength: number;
  samples: TrackSample[];
  sampleAt: (distance: number, outPos: THREE.Vector3, outTan: THREE.Vector3, outRight: THREE.Vector3, outUp: THREE.Vector3) => number;
  projectOntoTrack: (x: number, z: number, hintIndex?: number) => TrackProjection;
  minDistanceToRoadXZ: (x: number, z: number) => number;
  minimapPoints: Array<{ x: number; y: number }>;
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);

const CONTROL_POINTS = [
  new THREE.Vector3(0, 0.0, 0),
  new THREE.Vector3(0, 0.6, -110),
  new THREE.Vector3(48, 3.4, -215),
  new THREE.Vector3(140, 5.8, -242),
  new THREE.Vector3(228, 3.8, -170),
  new THREE.Vector3(186, 1.4, -72),
  new THREE.Vector3(258, 0.4, 28),
  new THREE.Vector3(226, 2.4, 136),
  new THREE.Vector3(124, 3.6, 188),
  new THREE.Vector3(34, 1.6, 144),
  new THREE.Vector3(-42, 0.6, 188),
  new THREE.Vector3(-114, 0.0, 120),
  new THREE.Vector3(-56, 0.0, 48),
  new THREE.Vector3(-6, 0.0, 26),
];

export function createTrackData(): TrackData {
  const curve = new THREE.CatmullRomCurve3(CONTROL_POINTS, true, "catmullrom", 0.5);
  const lapLength = curve.getLength();
  const sampleCount = 960;
  const samples: TrackSample[] = [];

  for (let i = 0; i < sampleCount; i++) {
    const t = i / sampleCount;
    const position = curve.getPointAt(t);
    const tangent = curve.getTangentAt(t).normalize();
    const right = new THREE.Vector3().crossVectors(tangent, WORLD_UP).normalize();
    const up = new THREE.Vector3().crossVectors(right, tangent).normalize();
    samples.push({
      distance: t * lapLength,
      t,
      position,
      tangent,
      right,
      up,
      curvature: 0,
    });
  }

  for (let i = 0; i < sampleCount; i++) {
    const prev = samples[(i - 2 + sampleCount) % sampleCount];
    const next = samples[(i + 2) % sampleCount];
    const dTan = new THREE.Vector3().subVectors(next.tangent, prev.tangent);
    samples[i].curvature = dTan.dot(samples[i].right);
  }

  const sampleAt = (
    rawDistance: number,
    outPos: THREE.Vector3,
    outTan: THREE.Vector3,
    outRight: THREE.Vector3,
    outUp: THREE.Vector3,
  ) => {
    const wrapped = ((rawDistance % lapLength) + lapLength) % lapLength;
    const floatIndex = (wrapped / lapLength) * sampleCount;
    const i0 = Math.floor(floatIndex) % sampleCount;
    const i1 = (i0 + 1) % sampleCount;
    const alpha = floatIndex - Math.floor(floatIndex);

    const s0 = samples[i0];
    const s1 = samples[i1];
    outPos.lerpVectors(s0.position, s1.position, alpha);
    outTan.lerpVectors(s0.tangent, s1.tangent, alpha).normalize();
    outRight.lerpVectors(s0.right, s1.right, alpha).normalize();
    outUp.lerpVectors(s0.up, s1.up, alpha).normalize();
    return THREE.MathUtils.lerp(s0.curvature, s1.curvature, alpha);
  };

  const minDistanceToRoadXZ = (x: number, z: number) => {
    let bestSq = Infinity;
    for (let i = 0; i < sampleCount; i += 2) {
      const p = samples[i].position;
      const dx = x - p.x;
      const dz = z - p.z;
      const dSq = dx * dx + dz * dz;
      if (dSq < bestSq) bestSq = dSq;
    }
    return Math.sqrt(bestSq);
  };

  const projPos = new THREE.Vector3();
  const projTan = new THREE.Vector3();
  const projRight = new THREE.Vector3();
  const projUp = new THREE.Vector3();

  const projectSegment = (idxA: number, x: number, z: number) => {
    const a = samples[idxA];
    const b = samples[(idxA + 1) % sampleCount];
    const abx = b.position.x - a.position.x;
    const abz = b.position.z - a.position.z;
    const abLenSq = abx * abx + abz * abz;
    const apx = x - a.position.x;
    const apz = z - a.position.z;
    const alpha = abLenSq > 1e-6 ? THREE.MathUtils.clamp((apx * abx + apz * abz) / abLenSq, 0, 1) : 0;
    const cx = a.position.x + abx * alpha;
    const cz = a.position.z + abz * alpha;
    const dx = x - cx;
    const dz = z - cz;
    return { idxA, alpha, distSq: dx * dx + dz * dz };
  };

  const projectOntoTrack = (x: number, z: number, hintIndex?: number): TrackProjection => {
    let bestIdx = 0;
    let bestSq = Infinity;

    if (hintIndex !== undefined) {
      const normalizedHint = ((hintIndex % sampleCount) + sampleCount) % sampleCount;
      for (let offset = -48; offset <= 48; offset++) {
        const idx = (normalizedHint + offset + sampleCount) % sampleCount;
        const p = samples[idx].position;
        const dx = x - p.x;
        const dz = z - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestSq) {
          bestSq = dSq;
          bestIdx = idx;
        }
      }
    }

    if (bestSq > 676) {
      bestSq = Infinity;
      for (let i = 0; i < sampleCount; i++) {
        const p = samples[i].position;
        const dx = x - p.x;
        const dz = z - p.z;
        const dSq = dx * dx + dz * dz;
        if (dSq < bestSq) {
          bestSq = dSq;
          bestIdx = i;
        }
      }
    }

    const prevIdx = (bestIdx - 1 + sampleCount) % sampleCount;
    const segPrev = projectSegment(prevIdx, x, z);
    const segNext = projectSegment(bestIdx, x, z);
    const chosen = segPrev.distSq < segNext.distSq ? segPrev : segNext;

    const i0 = chosen.idxA;
    const i1 = (i0 + 1) % sampleCount;
    const s0 = samples[i0];
    const s1 = samples[i1];
    const alpha = chosen.alpha;

    projPos.lerpVectors(s0.position, s1.position, alpha);
    projTan.lerpVectors(s0.tangent, s1.tangent, alpha).normalize();
    projRight.lerpVectors(s0.right, s1.right, alpha).normalize();
    projUp.lerpVectors(s0.up, s1.up, alpha).normalize();

    const endDist = i0 === sampleCount - 1 ? lapLength : s1.distance;
    const distance = THREE.MathUtils.lerp(s0.distance, endDist, alpha);
    const signedLateral = (x - projPos.x) * projRight.x + (z - projPos.z) * projRight.z;

    return {
      sampleIndex: i0,
      distance,
      signedLateral,
      position: projPos,
      tangent: projTan,
      right: projRight,
      up: projUp,
    };
  };

  // Compute normalized 0..100 SVG minimap coordinates
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < sampleCount; i += 8) {
    const p = samples[i].position;
    if (p.x < minX) minX = p.x;
    if (p.x > maxX) maxX = p.x;
    if (p.z < minZ) minZ = p.z;
    if (p.z > maxZ) maxZ = p.z;
  }
  const span = Math.max(maxX - minX, maxZ - minZ, 1);
  const padX = (span - (maxX - minX)) * 0.5;
  const padZ = (span - (maxZ - minZ)) * 0.5;
  const minimapPoints: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < sampleCount; i += 8) {
    const p = samples[i].position;
    minimapPoints.push({
      x: 10 + ((p.x - minX + padX) / span) * 80,
      y: 10 + ((p.z - minZ + padZ) / span) * 80,
    });
  }

  return { curve, lapLength, samples, sampleAt, projectOntoTrack, minDistanceToRoadXZ, minimapPoints };
}

function makeAsphaltTexture(maxAnisotropy: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext("2d")!;

  ctx.fillStyle = "#1c1e23";
  ctx.fillRect(0, 0, 512, 512);

  // Subtle asphalt aggregate noise
  for (let i = 0; i < 6500; i++) {
    const v = 22 + Math.floor(Math.random() * 24);
    ctx.fillStyle = `rgb(${v},${v + 1},${v + 3})`;
    ctx.fillRect(Math.random() * 512, Math.random() * 512, 2, 2);
  }

  // Subtle racing groove tire dark bands
  ctx.fillStyle = "rgba(10, 11, 14, 0.35)";
  ctx.fillRect(110, 0, 58, 512);
  ctx.fillRect(344, 0, 58, 512);

  // Crisp outer white boundary lines
  ctx.fillStyle = "#ece9e1";
  ctx.fillRect(14, 0, 8, 512);
  ctx.fillRect(490, 0, 8, 512);

  // Dashed lane lines
  ctx.fillStyle = "rgba(236, 233, 225, 0.55)";
  for (let y = 0; y < 512; y += 64) {
    ctx.fillRect(253, y + 8, 6, 36);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

function makeCurbTexture(maxAnisotropy: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 256;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#e6392f";
  ctx.fillRect(0, 0, 64, 128);
  ctx.fillStyle = "#f4f2ec";
  ctx.fillRect(0, 128, 64, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

function makeCheckeredTexture(maxAnisotropy: number) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const size = 32;
  for (let y = 0; y < 128; y += size) {
    for (let x = 0; x < 512; x += size) {
      const dark = ((x / size) + (y / size)) % 2 === 0;
      ctx.fillStyle = dark ? "#121318" : "#f4f2ec";
      ctx.fillRect(x, y, size, size);
    }
  }
  ctx.fillStyle = "rgba(230, 57, 47, 0.92)";
  ctx.fillRect(0, 44, 512, 40);
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 24px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("POYY GRAND PRIX CIRCUIT", 256, 64);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  return texture;
}

function buildRibbonGeometry(
  samples: TrackSample[],
  lapLength: number,
  leftOffset: number,
  rightOffset: number,
  yOffset: number,
  uvRepeatLength: number,
) {
  const count = samples.length;
  const positions = new Float32Array((count + 1) * 2 * 3);
  const normals = new Float32Array((count + 1) * 2 * 3);
  const uvs = new Float32Array((count + 1) * 2 * 2);
  const indices: number[] = [];

  for (let i = 0; i <= count; i++) {
    const sample = samples[i % count];
    const vCoord = (i === count ? lapLength : sample.distance) / uvRepeatLength;

    const lx = sample.position.x + sample.right.x * leftOffset + sample.up.x * yOffset;
    const ly = sample.position.y + sample.right.y * leftOffset + sample.up.y * yOffset;
    const lz = sample.position.z + sample.right.z * leftOffset + sample.up.z * yOffset;

    const rx = sample.position.x + sample.right.x * rightOffset + sample.up.x * yOffset;
    const ry = sample.position.y + sample.right.y * rightOffset + sample.up.y * yOffset;
    const rz = sample.position.z + sample.right.z * rightOffset + sample.up.z * yOffset;

    const pIdx = i * 6;
    positions[pIdx] = lx;
    positions[pIdx + 1] = ly;
    positions[pIdx + 2] = lz;
    positions[pIdx + 3] = rx;
    positions[pIdx + 4] = ry;
    positions[pIdx + 5] = rz;

    normals[pIdx] = sample.up.x;
    normals[pIdx + 1] = sample.up.y;
    normals[pIdx + 2] = sample.up.z;
    normals[pIdx + 3] = sample.up.x;
    normals[pIdx + 4] = sample.up.y;
    normals[pIdx + 5] = sample.up.z;

    const uvIdx = i * 4;
    uvs[uvIdx] = 0;
    uvs[uvIdx + 1] = vCoord;
    uvs[uvIdx + 2] = 1;
    uvs[uvIdx + 3] = vCoord;

    if (i < count) {
      const a = i * 2;
      const b = a + 1;
      const c = a + 2;
      const d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

function buildBarrierWallGeometry(samples: TrackSample[], offset: number, height: number, thickness: number) {
  const count = samples.length;
  const positions = new Float32Array((count + 1) * 4 * 3);
  const indices: number[] = [];

  for (let i = 0; i <= count; i++) {
    const s = samples[i % count];
    const inner = offset;
    const outer = offset + Math.sign(offset) * thickness;

    const p0x = s.position.x + s.right.x * inner;
    const p0y = s.position.y + s.right.y * inner;
    const p0z = s.position.z + s.right.z * inner;

    const p1x = p0x + s.up.x * height;
    const p1y = p0y + s.up.y * height;
    const p1z = p0z + s.up.z * height;

    const p2x = s.position.x + s.right.x * outer + s.up.x * height;
    const p2y = s.position.y + s.right.y * outer + s.up.y * height;
    const p2z = s.position.z + s.right.z * outer + s.up.z * height;

    const p3x = s.position.x + s.right.x * outer;
    const p3y = s.position.y + s.right.y * outer;
    const p3z = s.position.z + s.right.z * outer;

    const idx = i * 12;
    positions[idx] = p0x; positions[idx + 1] = p0y; positions[idx + 2] = p0z;
    positions[idx + 3] = p1x; positions[idx + 4] = p1y; positions[idx + 5] = p1z;
    positions[idx + 6] = p2x; positions[idx + 7] = p2y; positions[idx + 8] = p2z;
    positions[idx + 9] = p3x; positions[idx + 10] = p3y; positions[idx + 11] = p3z;

    if (i < count) {
      const base = i * 4;
      const next = base + 4;
      // Inner face, top face, outer face
      indices.push(base, next, base + 1, base + 1, next, next + 1);
      indices.push(base + 1, next + 1, base + 2, base + 2, next + 1, next + 2);
      indices.push(base + 2, next + 2, base + 3, base + 3, next + 2, next + 3);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

export function createTrackMeshes(track: TrackData, maxAnisotropy: number) {
  const group = new THREE.Group();
  const { samples, lapLength } = track;

  // 1. Main winding asphalt deck
  const asphaltTex = makeAsphaltTexture(maxAnisotropy);
  const roadGeo = buildRibbonGeometry(samples, lapLength, -ROAD_HALF_WIDTH, ROAD_HALF_WIDTH, 0.04, 18);
  const roadMat = new THREE.MeshStandardMaterial({
    map: asphaltTex,
    roughness: 0.78,
    metalness: 0.08,
    side: THREE.DoubleSide,
  });
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // 2. Red-white FIA curbs on both shoulders
  const curbTex = makeCurbTexture(maxAnisotropy);
  const curbMat = new THREE.MeshStandardMaterial({
    map: curbTex,
    roughness: 0.65,
    metalness: 0.05,
    side: THREE.DoubleSide,
  });
  const leftCurb = new THREE.Mesh(
    buildRibbonGeometry(samples, lapLength, -ROAD_HALF_WIDTH - CURB_WIDTH, -ROAD_HALF_WIDTH, 0.06, 6),
    curbMat,
  );
  leftCurb.receiveShadow = true;
  const rightCurb = new THREE.Mesh(
    buildRibbonGeometry(samples, lapLength, ROAD_HALF_WIDTH, ROAD_HALF_WIDTH + CURB_WIDTH, 0.06, 6),
    curbMat,
  );
  rightCurb.receiveShadow = true;
  group.add(leftCurb, rightCurb);

  // 3. Elevated roadbed under-deck so elevated hill sections look solid
  const bedMat = new THREE.MeshStandardMaterial({ color: 0x16181e, roughness: 0.9, metalness: 0.15, side: THREE.DoubleSide });
  const underDeck = new THREE.Mesh(
    buildRibbonGeometry(samples, lapLength, -BARRIER_OFFSET - 1.2, BARRIER_OFFSET + 1.2, -0.35, 30),
    bedMat,
  );
  group.add(underDeck);

  // 4. Metallic guardrails + crimson safety strips
  const railMat = new THREE.MeshStandardMaterial({ color: 0x8f96a3, metalness: 0.78, roughness: 0.32, side: THREE.DoubleSide });
  const leftRail = new THREE.Mesh(buildBarrierWallGeometry(samples, -BARRIER_OFFSET, 0.92, 0.45), railMat);
  const rightRail = new THREE.Mesh(buildBarrierWallGeometry(samples, BARRIER_OFFSET, 0.92, 0.45), railMat);
  leftRail.castShadow = true;
  rightRail.castShadow = true;
  group.add(leftRail, rightRail);

  const stripMat = new THREE.MeshStandardMaterial({
    color: 0xe6392f,
    emissive: 0xe6392f,
    emissiveIntensity: 0.75,
    roughness: 0.3,
    side: THREE.DoubleSide,
  });
  const leftStrip = new THREE.Mesh(
    buildRibbonGeometry(samples, lapLength, -BARRIER_OFFSET - 0.05, -BARRIER_OFFSET + 0.15, 0.95, 10),
    stripMat,
  );
  const rightStrip = new THREE.Mesh(
    buildRibbonGeometry(samples, lapLength, BARRIER_OFFSET - 0.15, BARRIER_OFFSET + 0.05, 0.95, 10),
    stripMat,
  );
  group.add(leftStrip, rightStrip);

  // 5. Start / Finish Architectural Gantry + Checkered Line
  const start = samples[0];
  const gantry = new THREE.Group();
  const basis = new THREE.Matrix4().makeBasis(start.right, start.up, start.tangent.clone().negate());
  gantry.position.copy(start.position);
  gantry.quaternion.setFromRotationMatrix(basis);

  const pillarMat = new THREE.MeshStandardMaterial({ color: 0x20232b, metalness: 0.85, roughness: 0.25 });
  const pillarGeo = new THREE.BoxGeometry(0.9, 8.8, 1.1);
  const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
  leftPillar.position.set(-BARRIER_OFFSET - 0.4, 4.4, 0);
  leftPillar.castShadow = true;
  const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
  rightPillar.position.set(BARRIER_OFFSET + 0.4, 4.4, 0);
  rightPillar.castShadow = true;

  const bannerTex = makeCheckeredTexture(maxAnisotropy);
  const headerGeo = new THREE.BoxGeometry(BARRIER_OFFSET * 2 + 1.8, 2.0, 1.4);
  const headerMesh = new THREE.Mesh(headerGeo, [
    pillarMat,
    pillarMat,
    pillarMat,
    pillarMat,
    new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.35, metalness: 0.1 }),
    new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.35, metalness: 0.1 }),
  ]);
  headerMesh.position.set(0, 8.2, 0);
  headerMesh.castShadow = true;

  // Checkered tarmac strip at start line
  const startStrip = new THREE.Mesh(
    new THREE.PlaneGeometry(ROAD_HALF_WIDTH * 2, 2.8),
    new THREE.MeshStandardMaterial({ map: bannerTex, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -1 }),
  );
  startStrip.rotation.x = -Math.PI / 2;
  startStrip.position.set(0, 0.08, 0);
  gantry.add(leftPillar, rightPillar, headerMesh, startStrip);
  group.add(gantry);

  // 6. Instanced Streetlights along outer curves
  const poleStride = 16;
  const poleCount = Math.floor(samples.length / poleStride);
  const poleGeo = new THREE.CylinderGeometry(0.11, 0.15, 7.2, 8);
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x2a2e38, metalness: 0.85, roughness: 0.3 });
  const poleInst = new THREE.InstancedMesh(poleGeo, poleMat, poleCount);

  const armGeo = new THREE.BoxGeometry(2.6, 0.14, 0.16);
  const armInst = new THREE.InstancedMesh(armGeo, poleMat, poleCount);

  const bulbGeo = new THREE.BoxGeometry(0.95, 0.12, 0.36);
  const bulbMat = new THREE.MeshStandardMaterial({
    color: 0xffd7a1,
    emissive: 0xffb366,
    emissiveIntensity: 2.2,
    roughness: 0.2,
  });
  const bulbInst = new THREE.InstancedMesh(bulbGeo, bulbMat, poleCount);

  const dummy = new THREE.Object3D();
  const mat4 = new THREE.Matrix4();
  const pos = new THREE.Vector3();
  for (let i = 0; i < poleCount; i++) {
    const s = samples[i * poleStride];
    const side = i % 2 === 0 ? -1 : 1;
    const baseOffset = side * (BARRIER_OFFSET + 0.9);
    mat4.makeBasis(s.right, s.up, s.tangent.clone().negate());
    dummy.quaternion.setFromRotationMatrix(mat4);

    pos.copy(s.position).addScaledVector(s.right, baseOffset).addScaledVector(s.up, 3.6);
    dummy.position.copy(pos);
    dummy.updateMatrix();
    poleInst.setMatrixAt(i, dummy.matrix);

    pos.copy(s.position).addScaledVector(s.right, baseOffset - side * 1.1).addScaledVector(s.up, 7.15);
    dummy.position.copy(pos);
    dummy.updateMatrix();
    armInst.setMatrixAt(i, dummy.matrix);

    pos.copy(s.position).addScaledVector(s.right, baseOffset - side * 2.1).addScaledVector(s.up, 7.05);
    dummy.position.copy(pos);
    dummy.updateMatrix();
    bulbInst.setMatrixAt(i, dummy.matrix);
  }
  poleInst.computeBoundingSphere();
  armInst.computeBoundingSphere();
  bulbInst.computeBoundingSphere();
  group.add(poleInst, armInst, bulbInst);

  return group;
}
